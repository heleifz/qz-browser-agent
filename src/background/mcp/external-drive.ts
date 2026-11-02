import { t } from "../../shared/i18n/backend.js";
import { getLanguage } from "../../shared/i18n/index.js";
import type { ToolBatchTabPolicy } from "../../shared/contracts/tool.js";
import { planTabBatch } from "../tools/tab-batch.js";
import { scheduleToolCalls } from "../tools/tool-scheduler.js";

/** Same-session batch cap. The scheduler also refuses to run more than ten at once. */
export const DRIVE_MAX_CALLS = 10;
const DRIVE_IDLE_MS = 30 * 60 * 1000;

const FORBIDDEN = new Set([
  "ask_llm", "manage_sessions", "manage_settings", "manage_guardrails", "manage_skill_settings",
  "manage_goal", "example_echo",
  "qingzhou_call", "create_skill", "update_skill", "delete_skill", "manage_skill",
  "edit_skill_resource", "import_skill_from_page_zip", "import_git_skill_repository",
  "install_skill_to_git", "import_page_zip", "import_git_repository", "manage_bookmarks",
  "wait_for_user", "ask_user", "send_message",
]);

/** Default qz tools / list_tools / tools.$list tier. Guide-tier names stay callable by name. */
const DRIVE_DEFAULT_TOOLS = new Set([
  "open_tab", "navigate", "list_tabs", "close_tab", "use_tab", "get_working_tab",
  "get_ax_tree", "find_elements", "read_article", "act_on_element", "scroll_page",
  "screenshot", "wait_for_element", "wait_for_navigation", "wait_until",
  "run_script", "load_skill", "list_skills",
]);

const TAB_IDENTITY = new Set(["open_tab", "list_tabs", "get_working_tab", "use_tab", "close_tab", "navigate"]);

export interface DriveCall { id: string; name: string; args: Record<string, unknown> }
export interface DriveImage { mimeType: string; data: string }
type Fields = Record<string, unknown>;
type ModelPolicy = { projectResult?(result: unknown): unknown } | null | undefined;
export type DriveParse =
  | { ok: false; error: Error }
  | { ok: true; mode: "single"; name: string; timeoutSeconds: number | null; maxCalls: number }
  | { ok: true; mode: "batch"; calls: DriveCall[]; timeoutSeconds: number | null; maxCalls: number };

const record = (value: unknown): Fields => value && typeof value === "object" && !Array.isArray(value) ? value as Fields : {};

function driveError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

export function driveGroupTitle(clientName: unknown) {
  const raw = String(clientName ?? "").replace(/[\r\n\t]+/gu, " ").replace(/\s+/gu, " ").trim();
  const display = (raw === "qz-cli" ? "CLI" : raw || "MCP").slice(0, 40);
  return `轻舟 · ${display}`;
}

function toolLocalName(name: string) {
  const separator = name.lastIndexOf("__");
  return separator >= 0 ? name.slice(separator + 2) : name;
}

/** True when direct drive must not call this tool. Matches the full name and the segment after the last "__". */
export function isDriveToolForbidden(name: string) {
  const local = toolLocalName(name);
  return FORBIDDEN.has(name) || FORBIDDEN.has(local) || name.startsWith("mcp_") || local.startsWith("mcp_");
}

/** True when a drive catalog or in-script $list should show this tool without asking for it by name. */
export function isDriveToolDefault(name: string) {
  if (isDriveToolForbidden(name)) return false;
  const local = toolLocalName(name);
  return DRIVE_DEFAULT_TOOLS.has(name) || DRIVE_DEFAULT_TOOLS.has(local);
}

/** Direct-drive run_script is page-only and must name a tabRef. Built-in inner batches do not use this. */
export function prepareDriveToolCall(name: string, args: unknown): { ok: true; args: Fields } | { ok: false; error: Error } {
  const input = record(args);
  if (toolLocalName(name) !== "run_script") return { ok: true, args: input };
  const target = String(input.target ?? "").trim();
  if (target && target !== "page") {
    return { ok: false, error: driveError("DRIVE_RUN_SCRIPT_TARGET", t("drive.runScriptPageOnly")) };
  }
  const tabRef = input.tabRef;
  if (tabRef == null || (typeof tabRef === "string" && tabRef.trim() === "")) {
    return { ok: false, error: driveError("DRIVE_TAB_REF_REQUIRED", t("drive.tabRefRequired")) };
  }
  return { ok: true, args: { ...input, target: "page", tabRef: typeof tabRef === "string" ? tabRef.trim() : tabRef } };
}

/** One-line signature plus the first description line. Drive catalogs and tools.$list share this shape. */
export function driveToolSignature(tool: { name: string; description?: string; parameters?: unknown }) {
  const parameters = record(tool.parameters);
  const properties = record(parameters.properties);
  const required = new Set(Array.isArray(parameters.required) ? parameters.required.map(item => String(item)) : []);
  const args = Object.entries(properties).map(([key, spec]) => {
    const schema = record(spec);
    const type = Array.isArray(schema.enum)
      ? schema.enum.map(item => JSON.stringify(item)).join("|")
      : Array.isArray(schema.type)
        ? schema.type.filter(item => item !== "null").join("|") || "any"
        : typeof schema.type === "string" && schema.type ? schema.type : "any";
    return `${key}${required.has(key) ? "" : "?"}:${type}`;
  });
  const description = String(tool.description || "").split("\n").map(line => line.trim()).find(Boolean)?.slice(0, 240) || "";
  return { name: tool.name, signature: `${tool.name}({${args.join(", ")}})`, description };
}

function positiveSeconds(value: unknown) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function callBudget(limits: unknown) {
  const requested = Number(record(limits).maxCalls);
  if (!Number.isFinite(requested)) return DRIVE_MAX_CALLS;
  if (!Number.isInteger(requested) || requested < 1 || requested > DRIVE_MAX_CALLS) {
    return { error: driveError("DRIVE_TOO_MANY_CALLS", t("drive.tooManyCalls", { limit: DRIVE_MAX_CALLS })) };
  }
  return requested;
}

/** Classify one execute_tool request. Forbidden names stop before any tool runs. */
export function parseDriveRequest(params: Fields = {}): DriveParse {
  const name = String(params.name || params.toolName || "").trim();
  const hasCalls = Array.isArray(params.calls);
  if (hasCalls && name) return { ok: false, error: driveError("DRIVE_ARGUMENTS", t("drive.nameOrCalls")) };
  if (params.calls != null && !hasCalls) return { ok: false, error: driveError("DRIVE_ARGUMENTS", t("drive.callShape")) };
  const budget = callBudget(params.limits);
  if (typeof budget !== "number") return { ok: false, error: budget.error };
  const timeoutSeconds = positiveSeconds(record(params.limits).timeoutSeconds);
  if (!hasCalls) {
    if (!name) return { ok: false, error: driveError("DRIVE_ARGUMENTS", "execute_tool requires name") };
    if (isDriveToolForbidden(name)) return { ok: false, error: driveError("DRIVE_TOOL_FORBIDDEN", t("drive.toolForbidden", { name })) };
    return { ok: true, mode: "single", name, timeoutSeconds, maxCalls: budget };
  }
  const calls: DriveCall[] = [];
  for (const item of params.calls as unknown[]) {
    const call = record(item);
    const id = String(call.id ?? "").trim();
    const callName = String(call.name ?? "").trim();
    if (!id || !callName || (call.args != null && (typeof call.args !== "object" || Array.isArray(call.args)))) {
      return { ok: false, error: driveError("DRIVE_ARGUMENTS", t("drive.callShape")) };
    }
    if (isDriveToolForbidden(callName)) {
      return { ok: false, error: driveError("DRIVE_TOOL_FORBIDDEN", t("drive.toolForbidden", { name: callName })) };
    }
    calls.push({ id, name: callName, args: record(call.args) });
  }
  if (!calls.length) return { ok: false, error: driveError("DRIVE_ARGUMENTS", t("drive.callShape")) };
  if (calls.length > budget) return { ok: false, error: driveError("DRIVE_TOO_MANY_CALLS", t("drive.tooManyCalls", { limit: budget })) };
  return { ok: true, mode: "batch", calls, timeoutSeconds, maxCalls: budget };
}

const DATA_URL = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/u;

const DRIVE_PAGE_KEYS = new Set(["_tabId", "_pageTitle", "_pageUrl", "_pageContext", "sessionId", "runId"]);
const DRIVE_GEOMETRY_KEYS = new Set(["rect", "clickablePoint", "parent", "lineRange", "actionable"]);

function compactDriveValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compactDriveValue);
  if (!value || typeof value !== "object") return value;
  const out: Fields = {};
  for (const [key, child] of Object.entries(value as Fields)) {
    if (DRIVE_PAGE_KEYS.has(key) || DRIVE_GEOMETRY_KEYS.has(key)) continue;
    out[key] = compactDriveValue(child);
  }
  return out;
}

/** Apply the tool's model projection, then keep screenshot bytes and per-item page noise out of the JSON body. */
export function projectDriveResult(result: unknown, policy: ModelPolicy = null, options: { verbose?: boolean } = {}): { value: unknown; images: DriveImage[] } {
  let projected = result;
  try {
    if (policy?.projectResult) projected = policy.projectResult(result);
  } catch {
    projected = result;
  }
  if (!projected || typeof projected !== "object" || Array.isArray(projected)) return { value: projected, images: [] };
  const value = { ...(projected as Fields) };
  delete value._display;
  delete value._debug;
  delete value._rawCdp;
  if (Array.isArray(value.nodes) && "snapshot" in value) delete value.nodes;
  const images: DriveImage[] = [];
  const raw = value._image;
  delete value._image;
  delete value._imageDetail;
  if (typeof raw === "string") {
    const match = DATA_URL.exec(raw);
    if (match?.[1] && match[2]) images.push({ mimeType: match[1], data: match[2].replace(/\s+/gu, "") });
  }
  return { value: options.verbose ? value : compactDriveValue(value), images };
}

export const DRIVE_RESULT_CHAR_LIMIT = 48_000;

const SCRIPT_SUCCESS_PREFIX = '{"ok":true,"result":';

function capDriveValue(value: unknown): unknown {
  let text = "";
  try { text = JSON.stringify(value) ?? ""; }
  catch { return value; }
  if (text.length <= DRIVE_RESULT_CHAR_LIMIT) return value;
  const previewText = text.startsWith(SCRIPT_SUCCESS_PREFIX) ? text.slice(SCRIPT_SUCCESS_PREFIX.length) : text;
  return {
    truncated: true,
    totalChars: text.length,
    limitChars: DRIVE_RESULT_CHAR_LIMIT,
    preview: previewText.slice(0, DRIVE_RESULT_CHAR_LIMIT),
  };
}

const GENERIC_SCRIPT_ERRORS = new Set([
  "脚本执行失败。",
  "The script failed.",
  "脚本语法错误。",
  "The script has a syntax error.",
  "内部脚本执行失败。",
  "The internal script failed.",
]);

function isGenericScriptError(text: string) {
  const normalized = text.replace(/\s+/gu, " ").trim();
  return GENERIC_SCRIPT_ERRORS.has(normalized)
    || normalized.startsWith("脚本语法错误，请检查引号")
    || normalized.startsWith("Check quotes, line breaks");
}

/** Prefer the engine text, line, and column over a rewritten catalog sentence. */
function scriptFailureText(body: Fields) {
  const details = { ...record(record(body.result).details), ...record(body.details) };
  const current = typeof body.error === "string" ? body.error.trim() : "";
  const original = typeof details.originalError === "string" ? details.originalError.trim() : "";
  let text = original && isGenericScriptError(current) ? original : (current || original || "script failed");
  const line = Number(details.lineNumber ?? details.line);
  const column = Number(details.columnNumber ?? details.column);
  const hasLine = Number.isFinite(line) && line > 0;
  const hasColumn = Number.isFinite(column) && column > 0;
  if (hasLine) {
    const loc = `(${line}:${hasColumn ? column : 1})`;
    if (!text.includes(loc)) text = `${text} ${loc}`;
  }
  const stack = typeof details.stack === "string" ? details.stack : typeof body.stack === "string" ? body.stack : "";
  if (stack) {
    const lines = stack.split(/\r?\n/u).map(row => row.trimEnd()).filter(row => row.trim()).slice(0, 8);
    const extra = lines.filter(line => !text.includes(line.trim()));
    const summary = extra.join("\n").slice(0, 1500);
    if (summary) text = `${text}\n${summary}`;
  }
  return {
    error: text,
    ...(hasLine ? { line } : {}),
    ...(hasColumn ? { column } : {}),
  };
}

function projectRunScriptDriveResult(result: unknown): unknown {
  const value = record(result);
  const nested = record(value.result);
  const envelope = value.__runScriptEnvelope === true ? value : nested.__runScriptEnvelope === true ? nested : null;
  const body = envelope || value;
  const failed = body.ok === false || (typeof body.error === "string" && body.error.length > 0 && body.ok !== true);
  if (!failed) return { ok: true, result: Object.hasOwn(body, "result") ? body.result : body };
  const trace = Array.isArray(body.trace) ? body.trace.slice(-5) : [];
  const failure = scriptFailureText(body);
  return {
    ok: false,
    code: String(body.code || "TOOL_EXECUTION_FAILED"),
    error: failure.error,
    ...(failure.line ? { line: failure.line } : {}),
    ...(failure.column ? { column: failure.column } : {}),
    ...(body.diagnostic ? { diagnostic: body.diagnostic } : {}),
    ...(trace.length ? { trace } : {}),
  };
}

function aliasForTab(id: unknown, aliases?: Readonly<Record<string, number>>) {
  const numeric = Number(id);
  if (!aliases || !Number.isFinite(numeric)) return "";
  return Object.entries(aliases).find(([, tabId]) => tabId === numeric)?.[0] || "";
}

function compactDriveTabs(value: unknown, aliases?: Readonly<Record<string, number>>): unknown {
  const tabs = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray(record(value).tabs)
      ? record(value).tabs as unknown[]
      : null;
  if (!tabs) return value;
  const rows = tabs.filter((tab): tab is Fields => Boolean(tab) && typeof tab === "object" && !Array.isArray(tab));
  const marked = rows.some(tab => Object.hasOwn(tab, "ownedByCurrentTask") || Object.hasOwn(tab, "usable"));
  if (!marked) return value;
  const owned = rows.filter(tab => tab.ownedByCurrentTask === true);
  return {
    tabs: owned.map(tab => {
      const alias = String(tab.alias || tab.tabAlias || aliasForTab(tab.id, aliases) || "");
      return { tabRef: tab.id, ...(alias ? { alias } : {}), title: tab.title || "", url: tab.url || "" };
    }),
    count: owned.length,
    foreign: rows.length - owned.length,
  };
}

/** Drive-facing result: script success is {ok, result}, tabs default to this session, and every body is capped. */
export function projectNamedDriveResult(name: string, args: unknown, result: unknown, policy: ModelPolicy = null, options: { aliases?: Readonly<Record<string, number>> } = {}): { value: unknown; images: DriveImage[] } {
  const input = record(args);
  const verbose = input.verbose === true;
  const script = name === "run_script" || record(result).__runScriptEnvelope === true || record(record(result).result).__runScriptEnvelope === true;
  if (script) return { value: capDriveValue(projectRunScriptDriveResult(result)), images: [] };
  const projected = projectDriveResult(result, policy, { verbose });
  const value = name === "list_tabs" && input.scope !== "all" && !verbose
    ? compactDriveTabs(projected.value, options.aliases)
    : projected.value;
  return { value: capDriveValue(exposeTabRef(name, value)), images: projected.images };
}

function withTabRef(row: unknown): unknown {
  if (!row || typeof row !== "object" || Array.isArray(row) || !Object.hasOwn(row as Fields, "id")) return row;
  const { id, ...rest } = row as Fields;
  return { tabRef: id, ...rest };
}

/** Drive results name the tab with tabRef. Internal execution still uses numeric tabId. */
function exposeTabRef(name: string, value: unknown): unknown {
  if (!TAB_IDENTITY.has(toolLocalName(name))) return value;
  if (Array.isArray(value)) return value.map(withTabRef);
  if (!value || typeof value !== "object") return value;
  const body = value as Fields;
  if (Array.isArray(body.tabs)) return { ...body, tabs: body.tabs.map(withTabRef) };
  return withTabRef(body);
}

interface DriveOutcome {
  call: DriveCall;
  id: string;
  name: string;
  args: unknown;
  isError: boolean;
  result: unknown;
  projected?: { value: unknown; images: DriveImage[] };
}

function failed(call: DriveCall, error: unknown, args: unknown = call.args): DriveOutcome {
  const err = record(error);
  const aborted = err.name === "AbortError" || err.name === "TimeoutError";
  return {
    call,
    id: call.id,
    name: call.name,
    args,
    isError: true,
    result: {
      error: typeof err.message === "string" && err.message ? err.message : String(error),
      code: aborted ? "OPERATION_ABORTED" : String(err.code || "TOOL_EXECUTION_FAILED"),
    },
  };
}

/** Run one calls batch through the same tab planner and scheduler the built-in agent uses. */
export async function runDriveCalls(calls: readonly DriveCall[], deps: {
  execute(name: string, args: unknown, signal: AbortSignal, context: Fields): Promise<unknown>;
  getBatchTabPolicy?(name: string, args: unknown): ToolBatchTabPolicy | null;
  getModelPolicy?(name: string): ModelPolicy;
  commitToolResult?(result: unknown, signal: AbortSignal, context: Fields): Promise<unknown>;
  discardToolResult?(result: unknown, context: Fields): Promise<unknown>;
  aliases?: Readonly<Record<string, number>>;
  context?: Fields;
  refreshContext?(context: Fields): Fields;
  onSettled?(call: { id: string; name: string; args: unknown; isError: boolean; result: unknown; images: DriveImage[] }): void;
  signal: AbortSignal;
  maxInFlight?: number;
}) {
  const canCommit = Boolean(deps.commitToolResult && deps.discardToolResult);
  function publish(outcome: DriveOutcome) {
    if (outcome.projected) return outcome;
    const projected = projectNamedDriveResult(outcome.name, outcome.args, outcome.result, deps.getModelPolicy?.(outcome.name) ?? null, { aliases: deps.aliases });
    const published = { ...outcome, projected };
    deps.onSettled?.({
      id: published.id,
      name: published.name,
      args: published.args,
      isError: published.isError,
      result: projected.value,
      images: projected.images,
    });
    return published;
  }
  const blocked = new Map<DriveCall, DriveOutcome>();
  const plannedBySource = new Map<DriveCall, DriveCall>();
  const planned: DriveCall[] = [];
  for (const call of calls) {
    const ready = prepareDriveToolCall(call.name, call.args);
    if (!ready.ok) {
      blocked.set(call, failed(call, ready.error));
      continue;
    }
    const next = { ...call, args: ready.args };
    plannedBySource.set(call, next);
    planned.push(next);
  }
  const batch = planTabBatch(planned, call => {
    let policy = deps.getBatchTabPolicy?.(call.name, call.args) ?? null;
    if (policy?.kind === "create" && policy.parallel && !canCommit) policy = { ...policy, parallel: false };
    return { args: call.args, policy };
  }, getLanguage(), deps.aliases || {});
  const settled = new Map<DriveCall, DriveOutcome>();
  await scheduleToolCalls<DriveCall, DriveOutcome>(batch.ordered, {
    signal: deps.signal,
    maxInFlight: deps.maxInFlight,
    dependencies: batch.dependencies,
    independent: batch.independent,
    completed: (call, outcome) => batch.complete(call, outcome.result, outcome.isError),
    cancelled: call => failed(call, { message: t("agent.toolStopped"), code: "OPERATION_ABORTED" }),
    tab: call => {
      try { return batch.observation(call) ? Number(record(batch.args(call)).tabId) || null : null; }
      catch { return null; }
    },
    reject: (call, error) => failed(call, error),
    execute: async (call, callSignal, parallel) => {
      let args: unknown = call.args;
      try { args = batch.args(call); }
      catch (error) { return failed(call, error); }
      const base: Fields = {
        ...(deps.context || {}),
        preserveWorkingTab: batch.observation(call) === true,
        deferToolCommit: parallel,
        deferCreatedTabSelection: batch.parallelCreate(call) === true,
        createdTabResult: batch.executionParent(call),
      };
      const context = deps.refreshContext ? deps.refreshContext(base) : base;
      try {
        const result = await deps.execute(call.name, args, callSignal, context);
        const value = record(result);
        return {
          call, id: call.id, name: call.name, args, result,
          isError: Boolean(value.error || value.ok === false || value.isError === true),
        };
      } catch (error) {
        await deps.discardToolResult?.(undefined, context);
        return failed(call, error, args);
      }
    },
    commit: async outcome => {
      let current = outcome;
      try {
        batch.assertDependenciesCommitted(outcome.call);
        if (!current.isError) await deps.commitToolResult?.(current.result, deps.signal, deps.context || {});
      } catch (error) {
        current = failed(outcome.call, error, outcome.args);
      }
      await deps.discardToolResult?.(outcome.result, deps.context || {});
      batch.settle(outcome.call, current.result, current.isError);
      settled.set(outcome.call, publish(current));
    },
  });
  const results = calls.map(call => {
    const plannedCall = plannedBySource.get(call);
    const outcome = publish(blocked.get(call) || (plannedCall && settled.get(plannedCall)) || failed(call, { message: t("agent.toolStopped"), code: "OPERATION_ABORTED" }));
    const images = outcome.projected?.images || [];
    return {
      id: outcome.id,
      name: outcome.name,
      result: outcome.projected?.value,
      isError: outcome.isError,
      ...(images.length ? { images } : {}),
    };
  });
  return { results };
}

type DriveCoordinatorOptions = {
  idleMs?: number;
  stop?(sessionId: string, meta?: Fields): Promise<unknown> | unknown;
  getRuntime?(sessionId: string): Fields | null;
  setRuntime?(sessionId: string, patch: Fields): unknown;
  mintRunId?(sessionId: string): string;
  takeRunId?(sessionId: string): string;
};

let activeCoordinator: ReturnType<typeof createExternalDriveCoordinator> | null = null;

/** One in-flight batch per drive session. Idle close uses the same 30 minute window as the MCP HTTP session. */
export function createExternalDriveCoordinator({
  idleMs = DRIVE_IDLE_MS,
  stop,
  getRuntime,
  setRuntime,
  mintRunId,
  takeRunId,
}: DriveCoordinatorOptions = {}) {
  const busy = new Set<string>();
  const controllers = new Map<string, AbortController>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const generation = new Map<string, number>();
  const active = new Map<string, number>();

  function generationOf(sessionId: string) {
    return generation.get(sessionId) || 0;
  }

  function clearIdle(sessionId: string) {
    const timer = timers.get(sessionId);
    if (timer) clearTimeout(timer);
    timers.delete(sessionId);
  }

  function touch(sessionId: string, token: number) {
    if (!sessionId || !stop) return;
    clearIdle(sessionId);
    const timer = setTimeout(() => {
      timers.delete(sessionId);
      if (generationOf(sessionId) !== token || active.has(sessionId)) return;
      generation.set(sessionId, token + 1);
      const driveRunId = takeRunId?.(sessionId) || "";
      controllers.get(sessionId)?.abort(driveError("OPERATION_ABORTED", t("agent.toolStopped")));
      busy.delete(sessionId);
      controllers.delete(sessionId);
      active.delete(sessionId);
      void stop(sessionId, {
        source: "drive_idle",
        cascade: false,
        keepTabs: false,
        driveRunCaptured: true,
        driveRunId,
      });
    }, idleMs);
    (timer as unknown as { unref?: () => void }).unref?.();
    timers.set(sessionId, timer);
  }

  function invalidate(sessionId: string) {
    if (!sessionId) return;
    generation.set(sessionId, generationOf(sessionId) + 1);
    clearIdle(sessionId);
    busy.delete(sessionId);
    active.delete(sessionId);
    controllers.get(sessionId)?.abort(driveError("OPERATION_ABORTED", t("agent.toolStopped")));
    controllers.delete(sessionId);
  }

  const coordinator = {
    isBusy(sessionId: string) { return busy.has(sessionId); },
    hasActiveLease(sessionId: string) { return active.has(sessionId); },
    begin(sessionId: string, signal?: AbortSignal) {
      if (sessionId && busy.has(sessionId)) throw driveError("DRIVE_SESSION_BUSY", t("drive.sessionBusy"));
      const token = sessionId ? generationOf(sessionId) : 0;
      if (sessionId) {
        busy.add(sessionId);
        active.set(sessionId, token);
        clearIdle(sessionId);
      }
      const controller = new AbortController();
      if (sessionId) controllers.set(sessionId, controller);
      const onAbort = () => controller.abort(signal?.reason);
      signal?.addEventListener("abort", onAbort);
      const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      const driveRunId = sessionId && mintRunId ? String(mintRunId(sessionId) || "") : "";
      return {
        signal: combined,
        driveRunId,
        release() {
          signal?.removeEventListener("abort", onAbort);
          if (!sessionId || generationOf(sessionId) !== token || active.get(sessionId) !== token) return;
          busy.delete(sessionId);
          active.delete(sessionId);
          if (controllers.get(sessionId) === controller) controllers.delete(sessionId);
          touch(sessionId, token);
        },
      };
    },
    abort(sessionId: string) {
      controllers.get(sessionId)?.abort(driveError("OPERATION_ABORTED", t("agent.toolStopped")));
    },
    markHandoff(sessionId: string, tabId: number) {
      const id = Number(tabId);
      if (!sessionId || !Number.isInteger(id) || id <= 0 || !setRuntime) return;
      const runtime = getRuntime?.(sessionId) || {};
      const current = Array.isArray(runtime.driveHandoffTabIds) ? runtime.driveHandoffTabIds.map(Number) : [];
      if (current.includes(id)) return;
      setRuntime(sessionId, { driveHandoffTabIds: [...current, id] });
    },
    noteStopped(sessionId: string, meta: Fields = {}) {
      if (!sessionId) return false;
      if (meta.source === "drive_idle" && active.has(sessionId)) return false;
      invalidate(sessionId);
      return true;
    },
  };
  activeCoordinator = coordinator;
  return coordinator;
}

export function noteExternalDriveStopped(sessionId: string, meta: Fields = {}) {
  if (!activeCoordinator) return true;
  return activeCoordinator.noteStopped(sessionId, meta);
}

/** True while a newer execute_tool lease owns this session. A late stop must not close its tabs. */
export function externalDriveLeaseActive(sessionId: string) {
  return Boolean(sessionId && activeCoordinator?.hasActiveLease(sessionId));
}
