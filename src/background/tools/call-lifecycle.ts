import type { ToolContext } from "../../sdk/background.js";

const calls = new Map<string, ToolContext>();

/** Opaque bridge identity grants only the live parent call's lifetime and budget. */
export function getToolCallParent(id: unknown, sessionId: string, runId: string): ToolContext | undefined {
  const parent = typeof id === "string" ? calls.get(id) : undefined;
  return parent && !parent.signal?.aborted && parent.sessionId === sessionId && parent.runId === runId ? parent : undefined;
}

export async function withToolCallLifecycle<T>(context: ToolContext, run: (context: ToolContext) => Promise<T>): Promise<T> {
  const toolExecutionId = crypto.randomUUID();
  const controller = new AbortController();
  const signal = context.signal ? AbortSignal.any([context.signal, controller.signal]) : controller.signal;
  const scoped = { ...context, toolExecutionId, signal };
  const revoke = () => { calls.delete(toolExecutionId); };
  if (!signal.aborted) calls.set(toolExecutionId, scoped);
  signal.addEventListener("abort", revoke, { once: true });
  try { return await run(scoped); }
  finally {
    signal.removeEventListener("abort", revoke);
    revoke();
    // Even a successful script can have unawaited child calls. Revoke them too.
    controller.abort();
  }
}
