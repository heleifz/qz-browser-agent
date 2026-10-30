import type { ToolContext, ToolErrorConstructor } from "../../sdk/background.js";
import type { CdpCommand } from "../../sdk/background/browser.js";
import type { GetToolRuntimeDependencies } from "../../sdk/background/services.js";
import { javascriptDialogT, normalizeJavaScriptDialogType, type JavaScriptDialogResult } from "../../shared/javascript-dialog.js";
import { firefoxExtension } from "../../shared/product-text.js";
import { withLanguage, getLanguage } from "../../shared/i18n/index.js";

type Fields = Record<string, unknown>;
type DialogOpeningParams = { message?: string; type?: string; defaultPrompt?: string };
interface PendingDialog {
  sessionId: string;
  closed?: { accepted: boolean; promptText: string };
  settleClosed?(): void;
  ready: Promise<void>;
  releaseWait(): void;
  dismiss(): Promise<unknown>;
}

interface DialogHandlerHost {
  ToolExecutionError: ToolErrorConstructor;
  getToolRuntimeDependencies: GetToolRuntimeDependencies;
  dismissDialog?(send: CdpCommand): Promise<unknown>;
}

/** Pause page tools on native dialogs until the user decides in the wait card. */
export function createJavaScriptDialogHandler({ ToolExecutionError, getToolRuntimeDependencies,
  dismissDialog = send => send("Page.handleJavaScriptDialog", { accept: false }),
}: DialogHandlerHost) {
  const waitTurns = new Map<string, Promise<void>>();
  function reserveWait(context: ToolContext) {
    const key = JSON.stringify([context.sessionId, context.runId]);
    const ready = waitTurns.get(key) || Promise.resolve();
    let release = () => {};
    const done = new Promise<void>(resolve => { release = resolve; });
    const tail = ready.then(() => done);
    waitTurns.set(key, tail);
    void tail.then(() => { if (waitTurns.get(key) === tail) waitTurns.delete(key); });
    const resumeDeadline = context.pauseDeadline?.();
    let released = false;
    return { ready, releaseWait() {
      if (released) return;
      released = true;
      resumeDeadline?.();
      release();
    } };
  }

  function localized<T>(context: ToolContext, run: () => T) {
    return withLanguage(context.language || getLanguage(), run);
  }

  async function handleOpening(
    tabId: number,
    send: CdpCommand,
    params: DialogOpeningParams,
    context: ToolContext,
    signal: AbortSignal,
    collected: JavaScriptDialogResult[],
    dialog: PendingDialog,
  ) {
    await dialog.ready;
    signal.throwIfAborted();
    const { sessions, emit } = getToolRuntimeDependencies(context);
    const sessionId = String(context.sessionId || "");
    const runId = String(context.runId || "");
    const type = normalizeJavaScriptDialogType(params.type);
    const message = String(params.message ?? "");
    const dismiss = dialog.dismiss;
    const collectClosed = () => {
      if (!dialog.closed) return false;
      const { accepted, promptText } = dialog.closed;
      collected.push({ type, message, accepted, ...(type === "prompt" && accepted ? { promptText } : {}) });
      return true;
    };
    if (collectClosed()) return;
    if (!sessionId || !runId || !sessions?.beginUserWait || !sessions.resolveUserWait || !emit) {
      await dismiss();
      throw new ToolExecutionError("JAVASCRIPT_DIALOG_USER_WAIT_UNAVAILABLE", "A page dialog opened but user wait is unavailable", { tabId, type, message });
    }
    if (sessions.isWaitingForUser?.(sessionId)) {
      await dismiss();
      throw new ToolExecutionError("JAVASCRIPT_DIALOG_WAIT_CONFLICT", "Answer the pending sidebar request before handling this page dialog", { sessionId, runId, tabId });
    }
    const resolveUserWait = sessions.resolveUserWait;
    const defaultPrompt = String(params.defaultPrompt ?? "");
    const waitId = `js_dialog_${crypto.randomUUID()}`;
    const title = localized(context, () => javascriptDialogT("title"));
    const form: Fields = {
      title,
      javascriptDialog: { type, message, ...(defaultPrompt ? { defaultPrompt } : {}) },
      ...(type === "prompt" ? {
        fields: [{ id: "promptText", type: "text", label: localized(context, () => javascriptDialogT("promptLabel")), defaultValue: defaultPrompt, required: false }],
      } : {}),
    };
    try {
      const pending = sessions.beginUserWait(sessionId, {
        waitId, runId, signal,
        onSettled: reason => emit({ type: "user_wait_resolved", sessionId, runId, waitId, reason }),
      });
      // Observe rejection even if publishing the card itself fails.
      void pending.catch(() => {});
      // The native dialog can also be answered in Chrome. Retire this exact card
      // without sending a second answer (which could reach a subsequent dialog).
      dialog.settleClosed = () => resolveUserWait({ sessionId, waitId, payload: { reason: "dialog_closed" } });
      emit({ type: "waiting_for_user", sessionId, runId, waitId, message, form });
      const outcome = record(await pending);
      // Only human decision time is unbounded. Browser acknowledgement and the
      // rest of the action still share the call's remaining deadline.
      dialog.releaseWait();
      const accept = outcome.reason !== "cancelled" && outcome.reason !== "aborted";
      const promptText = String(record(outcome.answers).promptText ?? defaultPrompt);
      signal.throwIfAborted();
      if (collectClosed()) return;
      // Do not publish a successful receipt if the browser rejected the answer.
      await send("Page.handleJavaScriptDialog", { accept, ...(type === "prompt" && accept ? { promptText } : {}) });
      collected.push({ type, message, accepted: accept, ...(type === "prompt" && accept ? { promptText } : {}) });
    } catch (error) {
      await dismiss();
      throw error;
    } finally {
      dialog.settleClosed = undefined;
      dialog.releaseWait();
    }
  }

  async function withDialogGuard<T>(
    tabId: number,
    context: ToolContext,
    run: (send: CdpCommand, bind: (underlying: CdpCommand) => Promise<void>) => Promise<T>,
  ): Promise<{ value: T; dialogs: JavaScriptDialogResult[] }> {
    const collected: JavaScriptDialogResult[] = [];
    const controller = new AbortController();
    let chain = Promise.resolve();
    const pendingDialogs: PendingDialog[] = [];
    let disposed = false;
    let underlying: CdpCommand | null = null;
    let guarded: CdpCommand | null = null;
    let fail: (error: unknown) => void = () => {};
    const failure = new Promise<never>((_, reject) => { fail = reject; });
    // The listener can fail before run() has returned its promise.
    void failure.catch(() => {});
    const abort = () => {
      const error = new ToolExecutionError("OPERATION_ABORTED", "Operation aborted while waiting for page input", { tabId });
      controller.abort(error);
      fail(error);
    };
    const drain = async () => {
      let observed;
      do { observed = chain; await observed; } while (observed !== chain);
    };
    const wrap = (real: CdpCommand): CdpCommand => {
      const wrapped: CdpCommand = async (method, params = {}) => {
        if (disposed) throw new ToolExecutionError("OPERATION_ABORTED", "Page input guard is closed", { tabId });
        controller.signal.throwIfAborted();
        const result = await real(method, params);
        await drain();
        return result;
      };
      wrapped.tabId = real.tabId;
      wrapped.connectionId = real.connectionId;
      if (real.inSession) wrapped.inSession = id => wrap(real.inSession!(id));
      return wrapped;
    };
    const send: CdpCommand = (method, params = {}) => {
      if (!guarded) throw new ToolExecutionError("JAVASCRIPT_DIALOG_SEND_UNBOUND", "Page debugger send is not bound yet", { tabId });
      return guarded(method, params);
    };
    const onEvent = (source: chrome.debugger.Debuggee & { sessionId?: string }, method: string, params?: object) => {
      if (disposed || !underlying || Number(source.tabId) !== tabId) return;
      const sessionId = source.sessionId || "";
      if (method === "Page.javascriptDialogClosed") {
        const dialog = pendingDialogs.find(item => item.sessionId === sessionId && !item.closed);
        if (dialog) {
          dialog.closed = { accepted: record(params).result === true, promptText: String(record(params).userInput ?? "") };
          dialog.settleClosed?.();
        }
        return;
      }
      if (method !== "Page.javascriptDialogOpening") return;
      const dialogSend = sessionId ? underlying.inSession?.(sessionId) : underlying;
      if (!dialogSend) return;
      let dismissal: Promise<unknown> | undefined;
      const dialog: PendingDialog = {
        sessionId,
        // A Session has one user-input slot. Queue only dialog decisions, not
        // independent tool execution, and suspend queued dialogs' deadlines too.
        ...reserveWait(context),
        dismiss: () => dismissal ??= Promise.resolve().then(() => dialog.closed ? undefined : dismissDialog(dialogSend)).catch(() => {}),
      };
      pendingDialogs.push(dialog);
      chain = chain.then(() => handleOpening(tabId, dialogSend, record(params), context, controller.signal, collected, dialog))
        .catch(error => { void dialog.dismiss(); throw error; })
        .finally(() => { dialog.releaseWait(); pendingDialogs.splice(pendingDialogs.indexOf(dialog), 1); });
      void chain.catch(fail);
    };
    const onDetach = (source: chrome.debugger.Debuggee) => {
      if (disposed || Number(source.tabId) !== tabId) return;
      abort();
    };

    // Firefox has no native dialog events/handling API. Keep its native functions intact:
    // a synchronous page-thread loop cannot receive an asynchronous extension reply.
    const nativeEvents = !firefoxExtension();
    if (nativeEvents) {
      chrome.debugger?.onEvent?.addListener(onEvent);
      chrome.debugger?.onDetach?.addListener(onDetach);
    }
    context.signal?.addEventListener("abort", abort, { once: true });
    try {
      if (context.signal?.aborted) abort();
      controller.signal.throwIfAborted();
      const execution = run(send, async real => {
        underlying = real;
        guarded = wrap(real);
        Object.assign(send, guarded);
        await real("Page.enable", {});
      });
      const value = await Promise.race([execution, failure]);
      await Promise.race([drain(), failure]);
      return { value, dialogs: collected };
    } finally {
      disposed = true;
      context.signal?.removeEventListener("abort", abort);
      if (nativeEvents) {
        chrome.debugger?.onEvent?.removeListener(onEvent);
        chrome.debugger?.onDetach?.removeListener(onDetach);
      }
      controller.abort();
      // Also retire dialogs queued behind a failed answer or opened just before
      // cancellation, before handleOpening could install their user wait.
      for (const dialog of pendingDialogs) {
        dialog.releaseWait();
        void dialog.dismiss();
      }
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
