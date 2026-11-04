import type { ToolContext } from "../../sdk/background.js";
import type { TraceRow } from "../../shared/contracts/inner-runner.js";
import type { ToolResultPresentation } from "../../shared/contracts/tool-result-presentation.js";

const MAX_ROWS = 80;
const MAX_CHARS = 12000;
const MAX_MESSAGE = 1000;
interface TraceScope {
  parent?: TraceScope;
  rows: TraceRow[];
  callId?: string;
  parentCallId?: string;
  omitted: number;
  nextSequence: number;
  closed: boolean;
}
const scopes = new WeakMap<ToolResultPresentation, TraceScope>();
const parents = new WeakMap<ToolResultPresentation, string>();
const requests = new Map<string, { scope: TraceScope; lastIndex: number }>();
const fields = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const scopeFor = (context?: ToolContext) => context?.resultPresentation ? scopes.get(context.resultPresentation) : undefined;

/** Context copies retain the host-owned presentation object; child calls get a new one. */
export function inheritScriptTrace(parent: ToolContext | undefined, child: ToolContext): void {
  const scope = scopeFor(parent);
  if (scope && child.resultPresentation) {
    scopes.set(child.resultPresentation, scope);
    const parentId = parent?.toolCallId || parent?.toolExecutionId;
    if (parentId) parents.set(child.resultPresentation, parentId);
  }
}

export function beginScriptTrace(context: ToolContext, requestId: string) {
  const presentation = context.resultPresentation ??= {};
  const parent = scopes.get(presentation);
  const scope: TraceScope = { parent, rows: [], callId: context.toolCallId || context.toolExecutionId,
    parentCallId: parents.get(presentation) || parent?.callId, omitted: 0, nextSequence: 0, closed: false };
  scopes.set(presentation, scope);
  const display = fields(presentation._display);
  presentation._display = { ...display, script: { ...fields(display.script), trace: scope.rows } };
  requests.set(requestId, { scope, lastIndex: 0 });
  return {
    finish(rows: unknown): TraceRow[] {
      // Final rows also cover transports that buffered their diagnostics until completion.
      if (Array.isArray(rows)) for (const row of rows) acceptScriptTrace(requestId, row);
      return scope.rows.slice();
    },
    close() { scope.closed = true; requests.delete(requestId); },
  };
}

/** Only a registered execution can publish rows; call identity always comes from its host context. */
export function acceptScriptTrace(requestId: string, value: unknown): void {
  const request = requests.get(requestId);
  if (!request || request.scope.closed) return;
  const row = fields(value), index = Number(row.traceIndex);
  if (Number.isInteger(index) && index > 0) {
    if (index <= request.lastIndex) return;
    request.lastIndex = index;
  }
  // Bridge lifecycle owns tool rows. Worker/user metadata cannot forge another tool's identity.
  if (String(row.level || "").startsWith("tool.")) return;
  append(request.scope, diagnostic(row, request.scope));
}

/** Page evaluations use the same trusted presentation channel without an offscreen execution. */
export function collectScriptResultTrace(parent: ToolContext | undefined, child: ToolContext): void {
  const scope = scopeFor(parent);
  if (!scope || scopeFor(child) !== scope) return;
  const rows = fields(fields(child.resultPresentation?._display).script).trace;
  if (!Array.isArray(rows)) return;
  const identity = { callId: child.toolCallId || child.toolExecutionId, parentCallId: parent?.toolCallId || parent?.toolExecutionId };
  for (const row of rows) {
    const value = fields(row);
    if (!String(value.level || "").startsWith("tool.")) append(scope, diagnostic(value, identity));
  }
}

export function recordScriptToolTrace(parent: ToolContext | undefined, input: {
  phase: "start" | "end"; name: string; toolCallId: string; parentCallId?: string;
  tabRef?: unknown; isError?: boolean; message?: string; sequence?: number;
}): number | undefined {
  const scope = scopeFor(parent);
  if (!scope || scope.closed) return;
  const sequence = input.phase === "start" ? ++scope.nextSequence : input.sequence;
  append(scope, {
    time: new Date().toISOString(), level: input.phase === "start" ? "tool.start" : input.isError ? "tool.error" : "tool.end",
    message: input.name + (input.isError && input.message ? ` ${input.message}` : ""),
    toolCallId: input.toolCallId,
    ...(sequence == null ? {} : { sequence }),
    ...(input.parentCallId ? { parentCallId: input.parentCallId } : {}),
    ...(typeof input.tabRef === "string" || typeof input.tabRef === "number" ? { tabRef: input.tabRef } : {}),
  });
  return sequence;
}

function diagnostic(row: Record<string, unknown>, identity: { callId?: string; parentCallId?: string }): TraceRow {
  return { time: typeof row.time === "string" ? row.time.slice(0, 40) : new Date().toISOString(),
    level: typeof row.level === "string" ? row.level.slice(0, 32) : "trace", message: String(row.message ?? ""),
    ...(identity.callId ? { toolCallId: identity.callId } : {}),
    ...(identity.parentCallId ? { parentCallId: identity.parentCallId } : {}),
  };
}

function append(scope: TraceScope, row: TraceRow): void {
  if (scope.closed) return;
  const message = row.message.length > MAX_MESSAGE ? row.message.slice(0, MAX_MESSAGE) + "…[truncated]" : row.message;
  const item = { ...row, message };
  for (let current: TraceScope | undefined = scope; current && !current.closed; current = current.parent) {
    const rows = current.rows;
    if (current.omitted) rows.shift();
    rows.push(item);
    let chars = rows.reduce((sum, entry) => sum + entry.message.length, 0);
    while (rows.length > MAX_ROWS - 1 || chars > MAX_CHARS - 100) {
      chars -= rows.shift()!.message.length;
      current.omitted++;
    }
    if (current.omitted) rows.unshift({ time: item.time, level: "trace", message: `[trace truncated: ${current.omitted} earlier entries omitted]` });
  }
}
