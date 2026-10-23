/** Map sidePanel.open and the toolbar click onto Firefox sidebarAction. */

const SIDEBAR_PROMPT_ID = "qz-open-sidebar";

export function installWorkspacePanel(chromeApi: WorkspaceChrome): void {
  const sidebar = chromeApi.sidebarAction;
  if (!sidebar || typeof sidebar.open !== "function" || chromeApi.sidePanel?.open) return;
  const prompt = installSidebarPrompt(chromeApi, sidebar);
  const panelUrl = () => {
    try { return chromeApi.runtime?.getURL?.("sidepanel/sidepanel.html") || "sidepanel/sidepanel.html"; }
    catch { return "sidepanel/sidepanel.html"; }
  };
  const callOpen = () => {
    try {
      // Firefox 158 sidebarAction.open() takes no arguments and uses the current window.
      const opened = sidebar.open();
      if (opened && typeof (opened as Promise<unknown>).then === "function") {
        return (opened as Promise<unknown>).then(value => {
          prompt.clear();
          return value;
        }, (error: unknown) => refuseSidebarOpen(error, prompt));
      }
      prompt.clear();
      return Promise.resolve(opened);
    } catch (error) {
      return refuseSidebarOpen(error, prompt);
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
          prompt.clear();
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

function refuseSidebarOpen(error: unknown, prompt: SidebarPrompt): Promise<never> {
  const explained = explainSidebarError(error);
  if (isSidebarGestureError(error)) prompt.show();
  return Promise.reject(explained);
}

function installSidebarPrompt(chromeApi: WorkspaceChrome, sidebar: NonNullable<WorkspaceChrome["sidebarAction"]>): SidebarPrompt {
  let prompted = false;
  const clear = () => {
    prompted = false;
    try { void chromeApi.action?.setBadgeText?.({ text: "" }); } catch { /* The notification can still be cleared. */ }
    try {
      const cleared = chromeApi.notifications?.clear?.(SIDEBAR_PROMPT_ID);
      if (isPromise(cleared)) void cleared.then(() => {}, () => {});
    } catch { /* A cleared badge is enough when notifications.clear is missing. */ }
  };
  const show = () => {
    if (prompted) return;
    prompted = true;
    const copy = sidebarPromptCopy(chromeApi);
    console.error("[轻舟] firefox sidebar did not open:", copy.message);
    try { void chromeApi.action?.setBadgeText?.({ text: "!" }); } catch { /* The notification still explains the click. */ }
    if (typeof chromeApi.notifications?.create !== "function") return;
    try {
      const iconUrl = chromeApi.runtime?.getURL?.("icons/icon128.png") || "";
      const created = chromeApi.notifications.create(SIDEBAR_PROMPT_ID, {
        type: "basic",
        ...(iconUrl ? { iconUrl } : {}),
        title: copy.title,
        message: copy.message,
      });
      if (isPromise(created)) void created.then(() => {}, () => {});
    } catch { /* The badge remains on the toolbar button. */ }
  };
  chromeApi.notifications?.onClicked?.addListener(notificationId => {
    if (notificationId !== SIDEBAR_PROMPT_ID) return;
    try {
      // This click is a user-input handler. Open before any other await.
      const opened = sidebar.open();
      clear();
      void Promise.resolve(opened).catch(error => {
        const explained = explainSidebarError(error);
        console.error("[轻舟] firefox sidebar did not open:", explained instanceof Error ? explained.message : explained);
      });
    } catch (error) {
      const explained = explainSidebarError(error);
      console.error("[轻舟] firefox sidebar did not open:", explained instanceof Error ? explained.message : explained);
    }
  });
  return { show, clear };
}

function sidebarPromptCopy(chromeApi: WorkspaceChrome): { title: string; message: string } {
  let language = "";
  try { language = chromeApi.i18n?.getUILanguage?.() || ""; } catch { language = ""; }
  if (language.toLowerCase().startsWith("zh")) {
    return { title: "轻舟", message: "点击此通知打开侧边栏。" };
  }
  return { title: "qz", message: "Click this notification to open the sidebar." };
}

function isPromise(value: unknown): value is Promise<unknown> {
  return Boolean(value) && typeof (value as Promise<unknown>).then === "function";
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

interface SidebarPrompt { show(): void; clear(): void }
interface WorkspaceChrome {
  runtime?: { getURL?(path: string): string };
  i18n?: { getUILanguage?(): string };
  sidebarAction?: {
    open(): unknown;
    toggle?(): unknown;
    setPanel?(details: { tabId?: number; panel?: string | null }): unknown;
  };
  sidePanel?: { open?(options?: { windowId?: number; tabId?: number }): unknown; setPanelBehavior?(): unknown };
  action?: {
    onClicked?: { addListener(listener: () => void): void };
    setBadgeText?(details: { text: string }): unknown;
  };
  notifications?: {
    create?(notificationId: string, options: { type: string; iconUrl?: string; title: string; message: string }): unknown;
    clear?(notificationId: string): unknown;
    onClicked?: { addListener(listener: (notificationId: string) => void): void };
  };
}
