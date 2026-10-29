import type { CdpCommand } from "../../sdk/background/browser.js";

/** A renderer ack waits inside a modal dialog. Close it before this, or the input command never returns. */
export const JAVASCRIPT_DIALOG_STALL_MS = 2000;
export const JAVASCRIPT_DIALOG_GRACE_MS = 1000;
export const JAVASCRIPT_DIALOG_TIMEOUT = "JAVASCRIPT_DIALOG_TIMEOUT";

export interface JavaScriptDialogInfo {
  type: string;
  message: string;
  url?: string;
  defaultPrompt?: string;
  accepted: true;
}

interface DialogCapture { id: number; dialogs: JavaScriptDialogInfo[] }
interface PageDialogGuard {
  dialogs: JavaScriptDialogInfo[];
  restore(): void;
}
interface PageDialogScope {
  alert: (message?: unknown) => void;
  confirm: (message?: unknown) => boolean;
  prompt: (message?: unknown, defaultText?: unknown) => string | null;
  location?: { href?: string };
  __qzPageDialogGuard?: PageDialogGuard;
}

const captures = new Map<number, DialogCapture>();
const pageEventsReady = new Set<string>();
let nextCapture = 1;

/** Record dialogs for one tab until the matching take. A newer capture replaces an abandoned one. */
export function beginJavaScriptDialogCapture(tabId: number): number {
  const id = nextCapture;
  nextCapture += 1;
  captures.set(tabId, { id, dialogs: [] });
  return id;
}

export function takeJavaScriptDialogs(tabId: number, id: number): JavaScriptDialogInfo[] {
  const capture = captures.get(tabId);
  if (!capture || capture.id !== id) return [];
  captures.delete(tabId);
  return capture.dialogs;
}

export function forgetJavaScriptDialogs(tabId: number) {
  captures.delete(tabId);
}

/** Accept the dialog so the blocked command can finish, and keep it when a tool is listening. */
export function noteJavaScriptDialogOpening(tabId: number, params: unknown): { accept: true; promptText?: string } {
  const source = record(params);
  const type = String(source.type || "alert");
  const message = String(source.message ?? "");
  const url = typeof source.url === "string" && source.url ? source.url : "";
  const defaultPrompt = typeof source.defaultPrompt === "string" ? source.defaultPrompt : undefined;
  const dialog: JavaScriptDialogInfo = {
    type,
    message,
    accepted: true,
    ...(url ? { url } : {}),
    ...(defaultPrompt !== undefined ? { defaultPrompt } : {}),
  };
  const capture = captures.get(tabId);
  if (capture && capture.dialogs.length < 20) capture.dialogs.push(dialog);
  if (type === "prompt") return { accept: true, promptText: defaultPrompt ?? "" };
  return { accept: true };
}

export function javascriptDialogFields(dialogs: readonly JavaScriptDialogInfo[]): { dialog: JavaScriptDialogInfo; dialogs?: JavaScriptDialogInfo[] } | null {
  if (!dialogs.length) return null;
  const dialog = dialogs[0];
  if (dialogs.length === 1) return { dialog };
  return { dialog, dialogs: [...dialogs] };
}

/** Page domain events are what deliver javascriptDialogOpening. One enable per live connection. */
export async function ensureJavaScriptDialogEvents(send: CdpCommand): Promise<void> {
  const tabId = Number(send.tabId);
  const connectionId = Number(send.connectionId);
  const tracked = Number.isInteger(tabId) && tabId > 0 && Number.isInteger(connectionId) && connectionId > 0;
  const key = `${tabId}:${connectionId}`;
  if (tracked && pageEventsReady.has(key)) return;
  try {
    await send("Page.enable", {});
    if (tracked) pageEventsReady.add(key);
  } catch {
    // The input stall still tries to close a dialog when the event never arrives.
  }
}

export function forgetJavaScriptDialogConnection(tabId: number, connectionId: number) {
  pageEventsReady.delete(`${tabId}:${connectionId}`);
  forgetJavaScriptDialogs(tabId);
}

/**
 * Input commands wait for a renderer ack. A modal dialog never sends one.
 * After a short stall, try to close it; if the command is still stuck, fail instead of waiting forever.
 */
export async function watchBlockedDialogCommand<T>(
  command: Promise<T>,
  closeDialog: () => Promise<unknown>,
  timeoutError: () => Error,
): Promise<T> {
  let grace: ReturnType<typeof setTimeout> | undefined;
  let stall: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
    if (stall) clearTimeout(stall);
    if (grace) clearTimeout(grace);
    stall = undefined;
    grace = undefined;
  };
  return await new Promise<T>((resolve, reject) => {
    command.then(value => {
      cancel();
      resolve(value);
    }, error => {
      cancel();
      reject(error);
    });
    stall = setTimeout(() => {
      void (async () => {
        if (cancelled) return;
        try {
          await closeDialog();
        } catch (error) {
          if (cancelled) return;
          if (hasCode(error)) {
            void command.then(() => {}, () => {});
            cancel();
            reject(error);
            return;
          }
        }
        if (cancelled) return;
        grace = setTimeout(() => {
          if (cancelled) return;
          void command.then(() => {}, () => {});
          cancel();
          reject(timeoutError());
        }, JAVASCRIPT_DIALOG_GRACE_MS);
      })().catch(error => {
        if (!cancelled) {
          void command.then(() => {}, () => {});
          cancel();
          reject(error);
        }
      });
    }, JAVASCRIPT_DIALOG_STALL_MS);
  });
}

/** Page-world dialog hooks. Click listeners call the page's alert, which an isolated-world override cannot see. */
export function installPageDialogGuard(): void {
  const page = globalThis as unknown as PageDialogScope;
  if (page.__qzPageDialogGuard) return;
  const original = { alert: page.alert, confirm: page.confirm, prompt: page.prompt };
  const dialogs: JavaScriptDialogInfo[] = [];
  const pageUrl = () => {
    try { return String(page.location?.href || ""); }
    catch { return ""; }
  };
  const push = (type: string, message: unknown, defaultPrompt?: string) => {
    const url = pageUrl();
    dialogs.push({
      type,
      message: String(message ?? ""),
      accepted: true,
      ...(url ? { url } : {}),
      ...(defaultPrompt !== undefined ? { defaultPrompt } : {}),
    });
  };
  page.alert = (message?: unknown) => { push("alert", message); };
  page.confirm = (message?: unknown) => { push("confirm", message); return true; };
  page.prompt = (message?: unknown, defaultText?: unknown) => {
    const defaultPrompt = defaultText == null ? "" : String(defaultText);
    push("prompt", message, defaultPrompt);
    return defaultPrompt;
  };
  page.__qzPageDialogGuard = {
    dialogs,
    restore() {
      page.alert = original.alert;
      page.confirm = original.confirm;
      page.prompt = original.prompt;
      delete page.__qzPageDialogGuard;
    },
  };
}

export function readPageDialogGuard(): JavaScriptDialogInfo[] {
  const page = globalThis as unknown as PageDialogScope;
  const guard = page.__qzPageDialogGuard;
  if (!guard) return [];
  return guard.dialogs.splice(0, guard.dialogs.length);
}

export function removePageDialogGuard(): void {
  const page = globalThis as unknown as PageDialogScope;
  page.__qzPageDialogGuard?.restore();
}

function hasCode(error: unknown) {
  return !!error && typeof error === "object" && "code" in error && Boolean((error as { code?: unknown }).code);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
