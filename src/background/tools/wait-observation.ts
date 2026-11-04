import type { ToolContext } from "../../sdk/background.js";
import { isToolFailure } from "../../shared/contracts/tool-error.js";
import { ToolExecutionError } from "./arguments.js";

export interface WaitObservation<T> { result: Promise<T>; dispose(): void }
export interface WaitTrigger { name: string; args?: Record<string, unknown> }
export const waitTriggerParameter = { type: "object", properties: {
  name: { type: "string", minLength: 1 }, args: { type: "object" },
}, required: ["name"] } as const;

/** Arm once, then invoke the action; the action and observation share one deadline. */
export async function runWaitWithTrigger<T>({ tool, timeoutMs, trigger, signal, context, details = {} }: {
  tool: string; timeoutMs: number; trigger?: WaitTrigger; signal?: AbortSignal; context: ToolContext;
  details?: Record<string, unknown>;
}, arm: (signal: AbortSignal) => WaitObservation<T> | Promise<WaitObservation<T>>): Promise<T> {
  const controller = new AbortController();
  const current = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const stopped = () => typeof current.reason?.code === "string" ? current.reason : Object.assign(
    new ToolExecutionError(current.reason?.name === "TimeoutError" ? "TOOL_TIMEOUT" : "OPERATION_ABORTED", `Stopped waiting for ${tool}.`, details),
    { hint: "Inspect the page state before retrying the wait." });
  const timeout = Object.assign(new ToolExecutionError("TOOL_TIMEOUT", `Timed out waiting for ${tool}.`, {
    ...details, timeout: timeoutMs / 1000,
  }), { hint: "Check the page state, then retry with the required condition or a longer timeout." });
  const timer = setTimeout(() => controller.abort(timeout), timeoutMs);
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(stopped());
  current.addEventListener("abort", onAbort, { once: true });
  let observation: WaitObservation<T> | undefined, finished = false;
  try {
    if (current.aborted) throw stopped();
    const armed = await Promise.race([Promise.resolve(arm(current)).then(value => {
      observation = value;
      if (finished) { void value.result.catch(() => {}); value.dispose(); throw stopped(); }
      return value;
    }), aborted]);
    // Observe rejections immediately while the triggering action is still running.
    const outcome = armed.result.then(value => ({ value }), error => ({ error }));
    if (current.aborted) throw stopped();
    if (trigger) {
      if (!context.invokeTool) throw new ToolExecutionError("TOOL_EXECUTION_FAILED", "Nested tool execution is unavailable.");
      const action = await Promise.race([context.invokeTool(trigger.name, trigger.args || {}, { signal: current }), aborted]);
      if (isToolFailure(action)) throw action;
    }
    const settled = await Promise.race([outcome, aborted]);
    if ("error" in settled) throw settled.error;
    return settled.value;
  } finally {
    finished = true;
    clearTimeout(timer);
    current.removeEventListener("abort", onAbort);
    observation?.dispose();
    controller.abort();
  }
}
