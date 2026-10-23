/** Map sidePanel.open and the toolbar click onto Firefox sidebarAction. */

export function installWorkspacePanel(chromeApi: WorkspaceChrome): void {
  const sidebar = chromeApi.sidebarAction;
  if (typeof sidebar?.open !== "function" || chromeApi.sidePanel?.open) return;
  const openSidebar = (options?: { windowId?: number; tabId?: number }) => {
    const windowId = Number(options?.windowId);
    if (!Number.isInteger(windowId) || windowId < 0) return Promise.resolve(sidebar.open());
    try {
      const opened = sidebar.open({ windowId });
      if (opened && typeof (opened as Promise<unknown>).then === "function") {
        return (opened as Promise<unknown>).catch(() => sidebar.open());
      }
      return Promise.resolve(opened);
    } catch {
      return Promise.resolve(sidebar.open());
    }
  };
  let toolbarBound = false;
  chromeApi.sidePanel = {
    open: options => openSidebar(options),
    setPanelBehavior() {
      if (!toolbarBound && chromeApi.action?.onClicked?.addListener) {
        toolbarBound = true;
        chromeApi.action.onClicked.addListener(() => { void openSidebar(); });
      }
      return Promise.resolve();
    },
  };
}

interface WorkspaceChrome {
  sidebarAction?: { open(options?: { windowId?: number }): unknown };
  sidePanel?: { open?(options?: { windowId?: number; tabId?: number }): unknown; setPanelBehavior?(): unknown };
  action?: { onClicked?: { addListener(listener: () => void): void } };
}
