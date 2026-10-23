/** Map sidePanel.open and the toolbar click onto Firefox sidebarAction. */

export function installWorkspacePanel(chromeApi: WorkspaceChrome): void {
  const sidebar = chromeApi.sidebarAction;
  if (typeof sidebar?.open !== "function" || chromeApi.sidePanel?.open) return;
  const panelUrl = () => {
    try { return chromeApi.runtime?.getURL?.("sidepanel/sidepanel.html") || "sidepanel/sidepanel.html"; }
    catch { return "sidepanel/sidepanel.html"; }
  };
  const callOpen = () => {
    try {
      // Firefox 158 sidebarAction.open() takes no arguments and uses the current window.
      const opened = sidebar.open();
      if (opened && typeof (opened as Promise<unknown>).then === "function") {
        return (opened as Promise<unknown>).then(value => value, (error: unknown) => Promise.reject(explainSidebarError(error)));
      }
      return Promise.resolve(opened);
    } catch (error) {
      return Promise.reject(explainSidebarError(error));
    }
  };
  const openSidebar = (options?: { windowId?: number; tabId?: number }) => {
    const tabId = Number(options?.tabId);
    if (Number.isInteger(tabId) && tabId > 0 && typeof sidebar.setPanel === "function") {
      try {
        const pending = sidebar.setPanel({ tabId, panel: panelUrl() });
        if (pending && typeof (pending as Promise<unknown>).then === "function") void (pending as Promise<unknown>).then(() => {}, () => {});
      } catch { /* The window sidebar panel remains in place. */ }
    }
    return callOpen();
  };
  let toolbarBound = false;
  chromeApi.sidePanel = {
    open: options => openSidebar(options),
    setPanelBehavior() {
      if (!toolbarBound && chromeApi.action?.onClicked?.addListener) {
        toolbarBound = true;
        chromeApi.action.onClicked.addListener(() => {
          const opened = typeof sidebar.toggle === "function" ? sidebar.toggle() : sidebar.open();
          void Promise.resolve(opened).catch(error => {
            const explained = explainSidebarError(error);
            console.error("[轻舟] firefox sidebar did not open:", explained instanceof Error ? explained.message : explained);
          });
        });
      }
      return Promise.resolve();
    },
  };
}

function isSidebarGestureError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return /user gesture|user input|user activation|transient activation/i.test(message);
}

function explainSidebarError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error || "sidebarAction.open failed");
  if (!isSidebarGestureError(error)) return error instanceof Error ? error : new Error(message);
  return new Error(`Firefox opens the sidebar only during a user gesture, such as a toolbar click, shortcut, or notification click. ${message}`);
}

interface WorkspaceChrome {
  runtime?: { getURL?(path: string): string };
  sidebarAction?: {
    open(): unknown;
    toggle?(): unknown;
    setPanel?(details: { tabId?: number; panel?: string | null }): unknown;
  };
  sidePanel?: { open?(options?: { windowId?: number; tabId?: number }): unknown; setPanelBehavior?(): unknown };
  action?: { onClicked?: { addListener(listener: () => void): void } };
}
