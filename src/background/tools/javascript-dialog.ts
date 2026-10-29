import type { ToolContext, ToolErrorConstructor } from "../../sdk/background.js";
import type { CdpCommand } from "../../sdk/background/browser.js";
import type { GetToolRuntimeDependencies } from "../../sdk/background/services.js";
import { javascriptDialogT, normalizeJavaScriptDialogType, type JavaScriptDialogResult } from "../../shared/javascript-dialog.js";
import { firefoxExtension } from "../../shared/product-text.js";
import { withLanguage, getLanguage } from "../../shared/i18n/index.js";

type Fields = Record<string, unknown>;
type DialogOpeningParams = { message?: string; type?: string; defaultPrompt?: string };

interface DialogHandlerHost {
  ToolExecutionError: ToolErrorConstructor;
  getToolRuntimeDependencies: GetToolRuntimeDependencies;
}

/** Pause page tools on native dialogs until the user decides in the wait card. */
export function createJavaScriptDialogHandler({ ToolExecutionError, getToolRuntimeDependencies }: DialogHandlerHost) {
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
  ) {
    signal.throwIfAborted();
    const { sessions, emit } = getToolRuntimeDependencies(context);
    const sessionId = String(context.sessionId || "");
    const runId = String(context.runId || "");
    const type = normalizeJavaScriptDialogType(params.type);
    const message = String(params.message ?? "");
    const dismiss = () => send("Page.handleJavaScriptDialog", { accept: false }).catch(() => {});
    if (!sessionId || !runId || !sessions?.beginUserWait || !emit) {
      await dismiss();
      throw new ToolExecutionError("JAVASCRIPT_DIALOG_USER_WAIT_UNAVAILABLE", "A page dialog opened but user wait is unavailable", { tabId, type, message });
    }
    if (sessions.isWaitingForUser?.(sessionId)) {
      await dismiss();
      throw new ToolExecutionError("JAVASCRIPT_DIALOG_WAIT_CONFLICT", "Answer the pending sidebar request before handling this page dialog", { sessionId, runId, tabId });
    }
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
    const resumeDeadline = context.pauseDeadline?.();
    try {
      const pending = sessions.beginUserWait(sessionId, {
        waitId, runId, signal,
        onSettled: reason => emit({ type: "user_wait_resolved", sessionId, runId, waitId, reason }),
      });
      // Observe rejection even if publishing the card itself fails.
      void pending.catch(() => {});
      emit({ type: "waiting_for_user", sessionId, runId, waitId, message, form });
      const outcome = record(await pending);
      const accept = outcome.reason !== "cancelled" && outcome.reason !== "aborted";
      const promptText = String(record(outcome.answers).promptText ?? defaultPrompt);
      signal.throwIfAborted();
      // Do not publish a successful receipt if the browser rejected the answer.
      await send("Page.handleJavaScriptDialog", { accept, ...(type === "prompt" && accept ? { promptText } : {}) });
      collected.push({ type, message, accepted: accept, ...(type === "prompt" && accept ? { promptText } : {}) });
    } catch (error) {
      await dismiss();
      throw error;
    } finally {
      resumeDeadline?.();
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
      if (disposed || !underlying || Number(source.tabId) !== tabId || method !== "Page.javascriptDialogOpening") return;
      const dialogSend = source.sessionId ? underlying.inSession?.(source.sessionId) : underlying;
      if (!dialogSend) return;
      chain = chain.then(() => handleOpening(tabId, dialogSend, record(params), context, controller.signal, collected));
      void chain.catch(fail);
    };

    // Firefox has no native dialog events/handling API. Keep its native functions intact:
    // a synchronous page-thread loop cannot receive an asynchronous extension reply.
    const nativeEvents = !firefoxExtension();
    if (nativeEvents) chrome.debugger?.onEvent?.addListener(onEvent);
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
      if (nativeEvents) chrome.debugger?.onEvent?.removeListener(onEvent);
      controller.abort();
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
