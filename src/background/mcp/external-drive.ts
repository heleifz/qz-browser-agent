import { DOCUMENT_TOOL_CORE_NAMES, getDocumentSkillToolName } from "../../capabilities/documents/skill-contract.js";
import { t } from "../../shared/i18n/backend.js";
import { getLanguage } from "../../shared/i18n/index.js";
import type { ToolBatchTabPolicy } from "../../shared/contracts/tool.js";
import { planTabBatch } from "../tools/tab-batch.js";
import { scheduleToolCalls } from "../tools/tool-scheduler.js";

/** Same-session batch cap. The scheduler also refuses to run more than ten at once. */
export const DRIVE_MAX_CALLS = 10;
const DRIVE_IDLE_MS = 30 * 60 * 1000;

const DOCUMENT_DRIVE_NAMES = DOCUMENT_TOOL_CORE_NAMES.flatMap((name) => {
  const skillName = getDocumentSkillToolName(name);
  return skillName ? [name, skillName] : [name];
});

const ALLOWED = new Set([
  "open_tab", "close_tab", "navigate", "list_tabs", "use_tab",
  "get_ax_tree", "read_article", "find_elements", "inspect_element",
  "act_on_element", "scroll_page", "screenshot",
  "wait", "wait_for_element", "wait_for_navigation", "wait_until", "wait_for_network_idle", "wait_for_response",
  "load_skill", "load_skill_resource", "run_skill_script", "run_script",
  "data_store", "save_file", "download_url",
  ...DOCUMENT_DRIVE_NAMES,
]);

const FORBIDDEN = new Set([
  "ask_llm", "manage_sessions", "manage_settings", "manage_guardrails",
  "qingzhou_call", "create_skill", "wait_for_user", "ask_user", "send_message",
]);

export interface DriveCall { id: string; name: string; args: Record<string, unknown> }
export interface DriveImage { mimeType: string; data: string }
type Fields = Record<string, unknown>;
type ModelPolicy = { projectResult?(result: unknown): unknown } | null | undefined;
export type DriveParse =
  | { ok: false; error: Error }
  | { ok: true; mode: "legacy"; name: string; timeoutSeconds: number | null; maxCalls: number }
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

function forbidden(name: string) {
  return FORBIDDEN.has(name) || name.startsWith("mcp_");
}

function allowed(name: string) {
  return ALLOWED.has(name);
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
    if (forbidden(name) || !allowed(name)) {
      if (forbidden(name)) return { ok: false, error: driveError("DRIVE_TOOL_FORBIDDEN", t("drive.toolForbidden", { name })) };
      return { ok: true, mode: "legacy", name, timeoutSeconds, maxCalls: budget };
    }
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
    if (forbidden(callName) || !allowed(callName)) {
      return { ok: false, error: driveError("DRIVE_TOOL_FORBIDDEN", t("drive.toolForbidden", { name: callName })) };
    }
    calls.push({ id, name: callName, args: record(call.args) });
  }
  if (!calls.length) return { ok: false, error: driveError("DRIVE_ARGUMENTS", t("drive.callShape")) };
  if (calls.length > budget) return { ok: false, error: driveError("DRIVE_TOO_MANY_CALLS", t("drive.tooManyCalls", { limit: budget })) };
  return { ok: true, mode: "batch", calls, timeoutSeconds, maxCalls: budget };
}

const DATA_URL = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/u;

/** Apply the tool's model projection, then keep screenshot bytes out of the JSON body. */
export function projectDriveResult(result: unknown, policy: ModelPolicy = null): { value: unknown; images: DriveImage[] } {
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
  return { value, images };
}

interface DriveOutcome {
  call: DriveCall;
  id: string;
  name: string;
  args: unknown;
  isError: boolean;
  result: unknown;
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
  signal: AbortSignal;
  maxInFlight?: number;
}) {
  const canCommit = Boolean(deps.commitToolResult && deps.discardToolResult);
  const batch = planTabBatch(calls, call => {
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
      settled.set(outcome.call, current);
    },
  });
  const results = calls.map(call => {
    const outcome = settled.get(call) || failed(call, { message: t("agent.toolStopped"), code: "OPERATION_ABORTED" });
    const projected = projectDriveResult(outcome.result, deps.getModelPolicy?.(call.name));
    return {
      id: outcome.id,
      name: outcome.name,
      result: projected.value,
      isError: outcome.isError,
      ...(projected.images.length ? { images: projected.images } : {}),
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
  clearRunId?(sessionId: string): void;
};

let activeCoordinator: ReturnType<typeof createExternalDriveCoordinator> | null = null;

/** One in-flight batch per drive session. Idle close uses the same 30 minute window as the MCP HTTP session. */
export function createExternalDriveCoordinator({
  idleMs = DRIVE_IDLE_MS,
  stop,
  getRuntime,
  setRuntime,
  mintRunId,
  clearRunId,
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
      clearRunId?.(sessionId);
      controllers.get(sessionId)?.abort(driveError("OPERATION_ABORTED", t("agent.toolStopped")));
      busy.delete(sessionId);
      controllers.delete(sessionId);
      void stop(sessionId, { source: "drive_idle", cascade: false, keepTabs: false });
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
    clearRunId?.(sessionId);
  }

  const coordinator = {
    isBusy(sessionId: string) { return busy.has(sessionId); },
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
      if (!sessionId) return;
      if (meta.source === "drive_idle" && active.has(sessionId)) return;
      invalidate(sessionId);
    },
  };
  activeCoordinator = coordinator;
  return coordinator;
}

export function noteExternalDriveStopped(sessionId: string, meta: Fields = {}) {
  activeCoordinator?.noteStopped(sessionId, meta);
}
