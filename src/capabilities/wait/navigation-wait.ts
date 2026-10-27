import { ToolExecutionError } from "#sdk/background/tools";
export interface NavigationResult { status: string; waited: boolean; url?: string; title?: string }

/** Listen before acknowledging a flow watch, including same-URL reloads. */
export function waitForNavigation(tabId: number, timeoutMs: number, next: boolean, signal?: AbortSignal, ready?: () => void): Promise<NavigationResult> {
  return new Promise((resolve, reject) => {
    let started = false, settled = false, armed = false;
    const cleanup = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(updated);
      chrome.tabs.onRemoved.removeListener(removed);
      signal?.removeEventListener("abort", abort);
    };
    const finish = (result?: NavigationResult, error?: Error) => {
      if (settled) return;
      settled = true; cleanup();
      if (error) reject(error); else resolve(result!);
    };
    const abort = () => finish(undefined, new ToolExecutionError("OPERATION_ABORTED", "Navigation wait stopped.", { tabId }));
    const removed = (id: number) => { if (id === tabId) finish(undefined, new ToolExecutionError("SESSION_TAB_TARGET_DENIED", "The navigation target was closed.", { tabId })); };
    const updated = (id: number, change: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => {
      if (id !== tabId || !armed) return;
      if (change.status === "loading" || change.url) started = true;
      if ((change.status === "complete" || (change.url && tab.status === "complete")) && (!next || started)) finish({ status: "complete", waited: true, url: tab.url, title: tab.title });
    };
    const timer = setTimeout(() => finish({ status: "timeout", waited: true }), timeoutMs);
    chrome.tabs.onUpdated.addListener(updated);
    chrome.tabs.onRemoved.addListener(removed);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    void chrome.tabs.get(tabId).then(tab => {
      if (settled) return;
      armed = true;
      if (!next && tab.status === "complete") finish({ status: "already_complete", waited: false, url: tab.url, title: tab.title });
      ready?.();
    }, error => finish(undefined, error));
  });
}
