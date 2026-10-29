import type { ToolContext, ToolErrorConstructor } from "../../sdk/background.js";
import type { CdpCommand } from "../../sdk/background/browser.js";
import type { GetToolRuntimeDependencies } from "../../sdk/background/services.js";
import { firefoxBeforeunloadDialogSupported, javascriptDialogT, normalizeJavaScriptDialogType, type JavaScriptDialogResult, type JavaScriptDialogType } from "../../shared/javascript-dialog.js";
import { firefoxExtension } from "../../shared/product-text.js";
import { withLanguage, getLanguage } from "../../shared/i18n/index.js";

type Fields = Record<string, unknown>;
type DialogOpeningParams = { message?: string; type?: string; defaultPrompt?: string };

interface DialogHandlerHost {
  ToolExecutionError: ToolErrorConstructor;
  getToolRuntimeDependencies: GetToolRuntimeDependencies;
}

const FIREFOX_HOOK = "__qzJsDialogBridgeV1";

/** Pause page tools on native dialogs until the user decides in the wait card. */
export function createJavaScriptDialogHandler({
  ToolExecutionError,
  getToolRuntimeDependencies,
}: DialogHandlerHost) {
  function localized<T>(context: ToolContext, run: () => T) {
    return withLanguage(context.language || getLanguage(), run);
  }

  async function installFirefoxHooks(tabId: number) {
    if (!firefoxExtension()) return;
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        world: "MAIN",
        injectImmediately: true,
        func: (flag: string) => {
          const root = globalThis as unknown as Record<string, unknown>;
          if (root[flag]) return;
          const bridge = {
            next: 0,
            pending: new Map<number, { type: string; message: string; defaultPrompt: string }>(),
            answers: new Map<number, { accept: boolean; promptText: string }>(),
          };
          root[flag] = bridge;
          const waitFor = (ticket: number) => {
            const deadline = Date.now() + 7 * 24 * 60 * 60 * 1000;
            while (!bridge.answers.has(ticket)) {
              if (Date.now() > deadline) {
                bridge.answers.set(ticket, { accept: false, promptText: "" });
                break;
              }
            }
            const answer = bridge.answers.get(ticket) || { accept: false, promptText: "" };
            bridge.answers.delete(ticket);
            bridge.pending.delete(ticket);
            return answer;
          };
          const open = (type: string, message: string, defaultPrompt = "") => {
            const ticket = ++bridge.next;
            bridge.pending.set(ticket, { type, message, defaultPrompt });
            (root as unknown as EventTarget).dispatchEvent(new CustomEvent("qz-js-dialog-open", { detail: { ticket, type, message, defaultPrompt } }));
            return waitFor(ticket);
          };
          root.alert = (message?: unknown) => { open("alert", String(message ?? "")); };
          root.confirm = (message?: unknown) => open("confirm", String(message ?? "")).accept;
          root.prompt = (message?: unknown, defaultPrompt?: unknown) => {
            const answer = open("prompt", String(message ?? ""), String(defaultPrompt ?? ""));
            return answer.accept ? answer.promptText : null;
          };
        },
        args: [FIREFOX_HOOK],
      });
    } catch {
      // Best-effort: pages that reject MAIN injection keep native dialog behavior.
    }
  }

  async function resolveFirefoxHook(tabId: number, ticket: number, accept: boolean, promptText: string) {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "MAIN",
      injectImmediately: true,
      func: (flag: string, id: number, accepted: boolean, text: string) => {
        const bridge = (globalThis as unknown as Record<string, { answers: Map<number, { accept: boolean; promptText: string }> }>)[flag];
        bridge?.answers?.set(id, { accept: accepted, promptText: text });
      },
      args: [FIREFOX_HOOK, ticket, accept, promptText],
    }).catch(() => {});
  }

  async function readFirefoxOpening(tabId: number): Promise<(DialogOpeningParams & { ticket: number }) | null> {
    const [frame] = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "MAIN",
      injectImmediately: true,
      func: (flag: string) => {
        const bridge = (globalThis as unknown as Record<string, {
          pending: Map<number, { type: string; message: string; defaultPrompt: string }>;
        }>)[flag];
        if (!bridge?.pending?.size) return null;
        const ticket = Math.min(...bridge.pending.keys());
        const entry = bridge.pending.get(ticket);
        if (!entry) return null;
        return { ticket, type: entry.type, message: entry.message, defaultPrompt: entry.defaultPrompt };
      },
      args: [FIREFOX_HOOK],
    }).catch(() => []);
    const value = frame?.result;
    return value && typeof value === "object" ? value as DialogOpeningParams & { ticket: number } : null;
  }

  async function handleOpening(
    tabId: number,
    send: CdpCommand,
    params: DialogOpeningParams,
    context: ToolContext,
    firefoxTicket: number | null,
    collected: JavaScriptDialogResult[],
  ) {
    const { sessions, emit } = getToolRuntimeDependencies(context);
    const sessionId = String(context.sessionId || "");
    const runId = String(context.runId || "");
    const type = normalizeJavaScriptDialogType(params.type);
    const message = String(params.message || "").trim();
    if (!message) return;
    if (type === "beforeunload" && !firefoxBeforeunloadDialogSupported()) {
      await send("Page.handleJavaScriptDialog", { accept: false }).catch(() => {});
      throw new ToolExecutionError("JAVASCRIPT_DIALOG_UNSUPPORTED", localized(context, () => javascriptDialogT("hint")), {
        tabId, type, message,
      });
    }
    if (!sessionId || !runId || !sessions?.beginUserWait || !emit) {
      await send("Page.handleJavaScriptDialog", { accept: false }).catch(() => {});
      throw new ToolExecutionError("JAVASCRIPT_DIALOG_USER_WAIT_UNAVAILABLE", "A page dialog opened but user wait is unavailable", {
        tabId, type, message,
      });
    }
    if (sessions.isWaitingForUser?.(sessionId)) {
      await send("Page.handleJavaScriptDialog", { accept: false }).catch(() => {});
      throw new ToolExecutionError("JAVASCRIPT_DIALOG_WAIT_CONFLICT", "Answer the pending sidebar request before handling this page dialog", {
        sessionId, runId, tabId,
      });
    }
    const defaultPrompt = String(params.defaultPrompt || "");
    const waitId = `js_dialog_${crypto.randomUUID()}`;
    const title = localized(context, () => javascriptDialogT("title"));
    const form: Fields = {
      title,
      javascriptDialog: { type, message, ...(defaultPrompt ? { defaultPrompt } : {}) },
      ...(type === "prompt" ? {
        fields: [{
          id: "promptText",
          type: "text",
          label: localized(context, () => javascriptDialogT("promptLabel")),
          defaultValue: defaultPrompt,
          required: false,
        }],
      } : {}),
    };
    const pending = sessions.beginUserWait(sessionId, {
      waitId,
      runId,
      signal: context.signal,
      onSettled: reason => emit({ type: "user_wait_resolved", sessionId, runId, waitId, reason }),
    });
    emit({
      type: "waiting_for_user",
      sessionId,
      runId,
      waitId,
      message,
      form,
    });
    let accept = false;
    let promptText = defaultPrompt;
    try {
      const outcome = record(await pending);
      const cancelled = outcome.reason === "cancelled" || outcome.reason === "aborted";
      accept = !cancelled;
      if (accept && type === "prompt") {
        promptText = String(record(outcome.answers).promptText ?? defaultPrompt);
      }
    } catch (error) {
      await send("Page.handleJavaScriptDialog", { accept: false }).catch(() => {});
      if (firefoxTicket != null) await resolveFirefoxHook(tabId, firefoxTicket, false, "");
      throw error;
    }
    await send("Page.handleJavaScriptDialog", {
      accept,
      ...(type === "prompt" && accept ? { promptText } : {}),
    }).catch(() => {});
    if (firefoxTicket != null) await resolveFirefoxHook(tabId, firefoxTicket, accept, accept ? promptText : "");
    collected.push({
      type,
      message,
      accepted: accept,
      ...(type === "prompt" && accept ? { promptText } : {}),
    });
  }

  async function withDialogGuard<T>(
    tabId: number,
    context: ToolContext,
    run: (send: CdpCommand, bind: (underlying: CdpCommand) => void) => Promise<T>,
  ): Promise<{ value: T; dialogs: JavaScriptDialogResult[] }> {
    const collected: JavaScriptDialogResult[] = [];
    let chain = Promise.resolve();
    let disposed = false;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let underlying: CdpCommand | null = null;

    const send: CdpCommand = async (method, params = {}) => {
      if (!underlying) {
        throw new ToolExecutionError("JAVASCRIPT_DIALOG_SEND_UNBOUND", "Page debugger send is not bound yet", { tabId });
      }
      const result = await underlying(method, params);
      if (firefoxExtension() && method !== "Page.handleJavaScriptDialog") {
        const opening = await readFirefoxOpening(tabId);
        if (opening) {
          chain = chain.then(() => handleOpening(tabId, send, opening, context, opening.ticket, collected));
          await chain;
        }
      }
      return result;
    };

    const onEvent = (source: chrome.debugger.Debuggee, method: string, params?: object) => {
      if (disposed || Number(source.tabId) !== tabId) return;
      if (method !== "Page.javascriptDialogOpening") return;
      chain = chain.then(() => handleOpening(tabId, send, params as DialogOpeningParams, context, null, collected));
    };

    chrome.debugger?.onEvent?.addListener(onEvent);
    await installFirefoxHooks(tabId);
    if (firefoxExtension()) {
      pollTimer = setInterval(() => {
        void readFirefoxOpening(tabId).then(opening => {
          if (!opening || disposed) return;
          chain = chain.then(() => handleOpening(tabId, send, opening, context, opening.ticket, collected));
          return chain;
        }).catch(() => {});
      }, 100);
    }

    try {
      const value = await run(send, real => {
        underlying = real;
        void send("Page.enable", {}).catch(() => {});
      });
      await chain;
      return { value, dialogs: collected };
    } finally {
      disposed = true;
      if (pollTimer) clearInterval(pollTimer);
      chrome.debugger?.onEvent?.removeListener(onEvent);
    }
  }

  function attachDialogResults<T extends Fields>(result: T, dialogs: JavaScriptDialogResult[]): T {
    if (!dialogs.length) return result;
    if (dialogs.length === 1) return { ...result, dialog: dialogs[0] };
    return { ...result, dialog: dialogs[dialogs.length - 1], dialogs };
  }

  return { withDialogGuard, attachDialogResults };
}

function record(value: unknown): Fields {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Fields : {};
}
