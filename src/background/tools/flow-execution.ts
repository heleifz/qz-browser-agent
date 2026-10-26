import type { ToolContext } from "../../sdk/background.js";
import { ToolExecutionError } from "./arguments.js";

type Fields = Record<string, unknown>;
const executions = new Map<string, FlowExecution>();
// Shared between flow invocations, including concurrent calls in the same run.
const tabTails = new Map<number, Promise<unknown>>();
const supported = new Set(["open_tab", "close_tab", "navigate", "find_elements", "inspect_element",
  "act_on_element", "get_ax_tree", "screenshot", "wait_for_element", "wait_for_network_idle", "data_store", "run_script"]);
const aborted = () => new ToolExecutionError("OPERATION_ABORTED", "Flow stopped; inspect the page before retrying.");

export function waitForFlow<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void promise.catch(() => {});
    return Promise.reject(aborted());
  }
  return new Promise((resolve, reject) => {
    const abort = () => reject(aborted());
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export class FlowExecution {
  private readonly controller = new AbortController();
  readonly signal: AbortSignal;
  private readonly pending = new Set<Promise<unknown>>();
  private readonly tabs = new Set<number>();
  observe?: (tabId: number) => Promise<unknown>;
  constructor(readonly context: ToolContext, parent?: AbortSignal) {
    this.signal = parent ? AbortSignal.any([parent, this.controller.signal]) : this.controller.signal;
  }
  allows(name: string) { return supported.has(name); }
  async call<T>(name: string, args: Fields, execute: () => Promise<T>): Promise<T> {
    if (this.signal.aborted) throw aborted();
    if (!this.allows(name) || (name === "run_script" && (String(args.target || "page").trim().toLowerCase() !== "page" || args.mutatesPage === true))) {
      throw new ToolExecutionError("FLOW_TOOL_UNSUPPORTED", "Flow supports browser tools, data_store and leaf page reads. Call other tools separately.", { toolName: name });
    }
    const page = name !== "open_tab" && name !== "data_store";
    const tabId = Number(args.tabId);
    if (page && (!Number.isInteger(tabId) || tabId <= 0)) {
      throw new ToolExecutionError("FLOW_TAB_REQUIRED", "Pass an explicit owned tabId to each flow page tool, including UID actions.", { toolName: name });
    }
    const previous = page ? tabTails.get(tabId) : undefined;
    const operation = (async () => {
      if (previous) await waitForFlow(previous.catch(() => {}), this.signal);
      if (this.signal.aborted) throw aborted();
      // Even a failed action may have changed the page before its observation failed.
      if (page) { this.tabs.delete(tabId); this.tabs.add(tabId); }
      // Keep the lock until the runtime settles, even if the caller stops waiting.
      const result = await execute();
      if (this.signal.aborted) throw aborted();
      const output = result && typeof result === "object" ? result as Fields : {};
      if (name === "close_tab" && output.ok !== false && !output.error) this.tabs.delete(tabId);
      else {
        const touched = page ? tabId : name === "open_tab" ? Number(output.id) : 0;
        if (touched > 0) { this.tabs.delete(touched); this.tabs.add(touched); }
      }
      return result;
    })();
    this.pending.add(operation);
    const tail = Promise.allSettled([previous, operation]);
    if (page) tabTails.set(tabId, tail);
    void operation.finally(() => this.pending.delete(operation)).catch(() => {});
    void tail.then(() => {
      if (page && tabTails.get(tabId) === tail) tabTails.delete(tabId);
    });
    return waitForFlow(operation, this.signal);
  }
  async finish() {
    await waitForFlow(Promise.allSettled([...this.pending]), this.signal);
    const tabId = [...this.tabs].at(-1);
    if (!tabId || !this.observe) return { available: false, code: "FLOW_NO_OPEN_TAB", message: "No remaining flow tab to observe." };
    try {
      const snapshot = await this.call("get_ax_tree", { tabId }, () => this.observe!(tabId));
      return { tabId, snapshot };
    } catch (error) {
      if (this.signal.aborted) throw aborted();
      return { tabId, available: false, code: "FLOW_OBSERVATION_FAILED", message: String(error), recovery: "Inspect this tab with get_ax_tree or screenshot." };
    }
  }
  dispose() { this.controller.abort(); }
}

export function registerFlowExecution(requestId: string, context: ToolContext, signal?: AbortSignal) {
  const execution = new FlowExecution(context, signal);
  executions.set(requestId, execution);
  return { execution, dispose() { executions.delete(requestId); execution.dispose(); } };
}

export function resolveFlowExecution(requestId: string, sessionId: string, runId: string) {
  const execution = executions.get(requestId);
  if (!execution || execution.signal.aborted || execution.context.sessionId !== sessionId || execution.context.runId !== runId) {
    throw new ToolExecutionError("FLOW_EXECUTION_EXPIRED", "Flow execution has ended. Start a new flow to continue.");
  }
  return execution;
}
