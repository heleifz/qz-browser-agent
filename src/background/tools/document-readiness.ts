import type { ToolContext } from "../../sdk/background.js";
import { ToolExecutionError } from "./arguments.js";

/** Wait for parsing/deferred scripts, independently of images, child frames and network idle. */
export async function waitForParsedDocument(tabId: number, context: ToolContext = {}) {
  const signal = context.signal;
  const abortError = () => signal?.reason || new ToolExecutionError("OPERATION_ABORTED", "Document observation was cancelled");
  if (signal?.aborted) throw abortError();
  const finish = context.measurePhase?.("readiness");
  let onAbort = () => {};
  try {
    const ready = chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] }, injectImmediately: true,
      func: async () => {
        const doc = (globalThis as unknown as { document: {
          readyState: string; addEventListener(type: string, listener: () => void, options: { once: boolean }): void;
        } }).document;
        if (doc.readyState === "complete") return;
        const navigation = performance.getEntriesByType("navigation")[0] as { domContentLoadedEventStart?: number } | undefined;
        if (doc.readyState === "interactive" && (!navigation || Number(navigation.domContentLoadedEventStart) > 0)) return;
        // A cancelled host stops awaiting this listener; it never triggers a capture or extraction.
        await new Promise<void>(resolve => doc.addEventListener("DOMContentLoaded", () => resolve(), { once: true }));
      },
    });
    if (!signal) { await ready; return; }
    await Promise.race([ready, new Promise<never>((_, reject) => {
      onAbort = () => reject(abortError());
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    })]);
    if (signal.aborted) throw abortError();
  } finally { signal?.removeEventListener("abort", onAbort); finish?.(); }
}
