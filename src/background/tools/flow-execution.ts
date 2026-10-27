import type { ToolContext } from "../../sdk/background.js";
import type { PageSnapshotOptions } from "../../sdk/background/browser.js";
import type { ToolBehavior, ToolPageAccess } from "../../shared/contracts/tool.js";
import { compactFlowValue, FLOW_MAX_PENDING, FLOW_PROGRESS_CHARS, FLOW_STEP_CHARS, FLOW_DISPLAY_STEPS, type FlowDisplay, type FlowStepDisplay, flowValueSize } from "../../shared/flow-script.js";
import { ToolExecutionError } from "./arguments.js";

type Fields = Record<string, unknown>;
export interface FlowToolPolicy {
  page?: ToolPageAccess | ((args: Fields) => ToolPageAccess);
  behavior?: Readonly<ToolBehavior>;
  source?: string;
  hidden?: boolean;
}
const executions = new Map<string, FlowExecution>();
const tabTails = new Map<number, Promise<unknown>>();
const record = (value: unknown): Fields => value && typeof value === "object" ? value as Fields : {};
const aborted = () => new ToolExecutionError("OPERATION_ABORTED", "Flow stopped; inspect the page before retrying.");

export function waitForFlow<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void promise.catch(() => {}); return Promise.reject(aborted()); }
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
  private readonly watches = new Map<string, { controller: AbortController; result: Promise<Fields> }>();
  readonly checkpoints: unknown[] = [];
  private sequence = 0;
  private lastPublished = 0;
  private stepSequence = 0;
  private readonly steps: FlowStepDisplay[] = [];
  private progressTimer?: ReturnType<typeof setTimeout>;
  display(): FlowDisplay {
    return { version: 1, total: this.stepSequence, omitted: this.stepSequence - this.steps.length,
      steps: this.steps.map(step => ({ ...step })) };
  }
  observe?: (tabId: number, signal: AbortSignal, options: PageSnapshotOptions) => Promise<unknown>;
  constructor(readonly context: ToolContext, parent?: AbortSignal, private readonly publish?: (progress: Fields) => void) {
    this.signal = parent ? AbortSignal.any([parent, this.controller.signal]) : this.controller.signal;
    const tabId = Number(context.workingTabId);
    if (Number.isInteger(tabId) && tabId > 0) this.tabs.add(tabId);
  }
  allows(name: string, policy: FlowToolPolicy = {}) {
    return !policy.hidden && policy.source !== "plugin" && !["run_flow", "run_skill_script"].includes(name);
  }
  emit(value: unknown) {
    if (this.signal.aborted) throw aborted();
    const checkpoint = { sequence: ++this.sequence, value: compactFlowValue(value, FLOW_PROGRESS_CHARS) };
    this.checkpoints.push(checkpoint);
    if (this.checkpoints.length > 16) this.checkpoints.shift();
    this.progress({ checkpoint }, true);
    return checkpoint;
  }
  private progress(value: Fields, explicit = false) {
    if (this.signal.aborted || !this.publish) return;
    if (!explicit && Date.now() - this.lastPublished < 200) {
      this.progressTimer ??= setTimeout(() => {
        this.progressTimer = undefined;
        this.progress({}, true);
      }, 200);
      return;
    }
    clearTimeout(this.progressTimer);
    this.progressTimer = undefined;
    this.lastPublished = Date.now();
    this.publish?.({ ...value, checkpoints: [...this.checkpoints], flow: this.display() });
  }
  async call<T>(name: string, args: Fields, execute: () => Promise<T>, policy: FlowToolPolicy = { page: ["open_tab", "data_store"].includes(name) ? false : "owned" }, signal = this.signal): Promise<T> {
    if (signal.aborted) throw aborted();
    if (!this.allows(name, policy) || (name === "run_script" && String(args.target || "page").trim().toLowerCase() !== "page")) {
      throw new ToolExecutionError("FLOW_TOOL_UNSUPPORTED", "Use core tools and leaf page scripts in a flow; recursive/Skill scripts run separately.", { toolName: name });
    }
    if (this.pending.size >= FLOW_MAX_PENDING) throw new ToolExecutionError("FLOW_CAPACITY", "Await pending flow calls before starting more.");
    const page = typeof policy.page === "function" ? policy.page(args) : policy.page;
    const tabId = Number(args.tabId);
    if (page && (!Number.isInteger(tabId) || tabId <= 0)) {
      throw new ToolExecutionError("FLOW_TAB_REQUIRED", "Pass an explicit owned tabId to every page call, including UID actions.", { toolName: name });
    }
    const waiter = policy.behavior?.flowWait === true;
    const previous = page && !waiter ? tabTails.get(tabId) : undefined;
    // Allocate identity in invocation order, including queued and concurrent waits.
    const step: FlowStepDisplay | undefined = name.startsWith("__") ? undefined : {
      id: ++this.stepSequence, tool: name.slice(0, 100), state: "queued",
      target: [args.action, args.target ?? args.selector ?? args.url ?? args.table, args.text]
        .filter(value => typeof value === "string").map(value => String(value).slice(0, 160)).join(" · ").slice(0, 320),
      ...(page ? { tabId } : {}),
    };
    if (step) {
      if (this.steps.length >= FLOW_DISPLAY_STEPS) {
        const index = this.steps.findIndex(item => !["queued", "running"].includes(item.state));
        this.steps.splice(Math.max(0, index), 1);
      }
      this.steps.push(step);
      this.progress({});
    }
    const operation = (async () => {
      if (previous) await waitForFlow(previous.catch(() => {}), signal);
      if (signal.aborted) throw aborted();
      if (page) { this.tabs.delete(tabId); this.tabs.add(tabId); }
      const startedAt = Date.now();
      if (step) { step.state = "running"; this.progress({}); }
      try {
        const result = await execute();
        if (signal.aborted) throw aborted();
        const output = record(result);
        if (output.ok === false || output.error != null || output.isError === true || output.timedOut === true || output.status === "timeout") {
          throw new ToolExecutionError(String(output.code || (output.timedOut || output.status === "timeout" ? "FLOW_STEP_TIMEOUT" : "FLOW_STEP_FAILED")),
            String(output.error || "Flow step failed; inspect its observation before retrying.").slice(0, 2048), { result: compactFlowValue(result, 8192) });
        }
        // Images use the existing image budget, not the structured-data budget.
        const { _image, _display, ...data } = output;
        if (flowValueSize(typeof result === "object" && result !== null && !Array.isArray(result) ? data : result) > FLOW_STEP_CHARS) {
          throw new ToolExecutionError("FLOW_RESULT_TOO_LARGE", "Store large data in Data/files; request a smaller page/tool result.", { toolName: name, maxCharacters: FLOW_STEP_CHARS });
        }
        if (name === "close_tab") this.tabs.delete(tabId);
        else {
          const touched = page ? tabId : name === "open_tab" ? Number(output.id) : 0;
          if (touched > 0) { this.tabs.delete(touched); this.tabs.add(touched); }
        }
        if (step) {
          step.state = "completed";
          step.elapsedMs = Date.now() - startedAt;
          if (output.urlChanged === true) step.outcome = "navigated";
          else if (name === "wait_for_navigation") step.outcome = output.status === "already_complete" ? "already_complete" : "loaded";
          else if (waiter) step.outcome = "condition_met";
          this.progress({});
        }
        return result;
      } catch (error) {
        if (step) {
          step.state = signal.aborted ? "aborted" : "error";
          step.elapsedMs = Date.now() - startedAt;
          step.code = String(record(error).code || "FLOW_STEP_FAILED").slice(0, 100);
          this.progress({}, true);
        }
        if (signal.aborted) throw aborted();
        // Observe before releasing an action's tab lock. Waiters acquire a separate
        // observation turn so they cannot take a snapshot in the middle of an action.
        const observation = page ? await (waiter ? this.snapshot(tabId, { scope: "viewport" }) : this.observeSafely(tabId)) : undefined;
        const failure = record(error);
        throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
          details: { ...record(failure.details), ...(observation ? { observation } : {}) },
        });
      }
    })();
    this.pending.add(operation);
    const tail = Promise.allSettled([previous, operation]);
    if (page && !waiter) tabTails.set(tabId, tail);
    void operation.finally(() => this.pending.delete(operation)).catch(() => {});
    void tail.then(() => { if (page && tabTails.get(tabId) === tail) tabTails.delete(tabId); });
    return waitForFlow(operation, signal);
  }
  private async observeSafely(tabId: number, signal = this.signal, options: PageSnapshotOptions = { scope: "viewport" }) {
    signal = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
    try {
      if (!this.observe) throw new Error("No observation host");
      const snapshot = compactFlowValue(await waitForFlow(this.observe(tabId, signal, options), signal), 16000);
      return { tabId, snapshot };
    } catch (error) {
      if (this.signal.aborted) throw aborted();
      return { tabId, available: false, code: "FLOW_OBSERVATION_FAILED", message: String(error).slice(0, 2048), recovery: "Inspect this tab with get_ax_tree or screenshot." };
    }
  }
  private snapshot(tabId: number, options: PageSnapshotOptions) {
    const signal = AbortSignal.any([this.signal, AbortSignal.timeout(5000)]);
    return this.call("__flow_snapshot__", { tabId }, () => this.observeSafely(tabId, signal, options), { page: "owned" }, signal).catch(error => {
      if (this.signal.aborted) throw aborted();
      return { tabId, available: false, code: "FLOW_OBSERVATION_FAILED", message: String(error).slice(0, 2048), recovery: "Inspect this tab after its current operation finishes." };
    });
  }
  async watch(run: (ready: () => void, signal: AbortSignal) => Promise<Fields>) {
    if (this.watches.size >= 32) throw new ToolExecutionError("FLOW_CAPACITY", "Consume or cancel existing watches first.");
    const id = `watch_${++this.sequence}`;
    const controller = new AbortController();
    let ready!: () => void;
    const armed = new Promise<void>(resolve => { ready = resolve; });
    const result = run(ready, AbortSignal.any([this.signal, controller.signal]));
    this.watches.set(id, { controller, result });
    // A waiter that completes/fails before arming must not strand its caller.
    void result.then(ready, ready);
    await waitForFlow(armed, this.signal);
    return { id };
  }
  async consumeWatch(id: string, cancel = false): Promise<Fields> {
    const watch = this.watches.get(id);
    if (!watch) throw new ToolExecutionError("FLOW_WATCH_EXPIRED", "This watch was consumed or cancelled. Arm a new watch.");
    this.watches.delete(id);
    if (cancel) { watch.controller.abort(); return { ok: true, result: { cancelled: true } }; }
    return waitForFlow(watch.result, this.signal);
  }
  async finish({ observe = true, tabId: requestedTabId, scope = "viewport", root = "root" }: PageSnapshotOptions & { observe?: boolean; tabId?: number } = {}) {
    for (const watch of this.watches.values()) watch.controller.abort();
    this.watches.clear();
    await waitForFlow(Promise.allSettled([...this.pending]), this.signal);
    if (!observe) return { available: false, reason: "disabled" };
    const tabId = requestedTabId ?? [...this.tabs].at(-1);
    if (!tabId) return { available: false, code: "FLOW_NO_OPEN_TAB", message: "No remaining flow tab to observe." };
    return { purpose: "next_turn_start", ...await this.snapshot(tabId, { scope, root }) };
  }
  dispose() {
    clearTimeout(this.progressTimer);
    this.progressTimer = undefined;
    this.controller.abort();
    for (const watch of this.watches.values()) watch.controller.abort();
    this.watches.clear();
  }
}

export function registerFlowExecution(requestId: string, context: ToolContext, signal?: AbortSignal, publish?: (progress: Fields) => void) {
  const execution = new FlowExecution(context, signal, publish);
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
