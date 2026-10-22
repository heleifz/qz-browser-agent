import { toolT } from "./tool-messages.js";
import { t } from "./i18n.js";
import type { ToolExtension, ToolExtensionAPI } from "#sdk/background";
import { isElementReply, type ElementReply } from "#sdk/shared/browser";
import type { SecurityGuardrails } from "#sdk/shared/security";
import type { CdpCommand, ElementCallOptions, ElementTarget, PageState, PreparedNavigation } from "#sdk/background/browser";
import type { ToolContext } from "#sdk/background";
export type { PageState, PreparedNavigation, PageNavigationHost } from "#sdk/background/browser";
type PageElementHost = Pick<ToolExtensionAPI,
  "registerTool" | "ToolExecutionError" | "sendToContent" | "clickPointReady"
  | "clickNotReadyResult" | "sendCdp" | "withDebugger" | "getPageContext" | "getTabPageState" | "pageStateDelta"
  | "prepareKnownPageNavigation" | "commitObservedPageNavigation"> & Pick<ToolExtensionAPI["element"],
  "resolveSelectorTarget" | "resolveElementReference" | "addElementTargetsToFindResult" | "elementTargetForRef"
  | "elementTargetForSelector" | "elementTargetGrammar" | "getElementTargetDescription" | "callElement" | "withElement">;
import { getSecurityGuardrails } from "#sdk/shared/security";
import { isCdpFallbackForbiddenError } from "#sdk/background/browser";
import { createCdpKeyboard, createCdpTouch } from "#sdk/background/browser";

/** Registers page reading, element inspection/action, and scrolling tools. */
export function registerPageElementTools({
  registerTool,
  ToolExecutionError,
  sendToContent: sendContent,
  resolveSelectorTarget,
  resolveElementReference,
  callElement: callBoundElement,
  withElement: withBoundElement,
  addElementTargetsToFindResult,
  elementTargetForRef,
  elementTargetForSelector,
  elementTargetGrammar: ELEMENT_TARGET_GRAMMAR,
  getElementTargetDescription,
  getTabPageState,
  pageStateDelta,
  prepareKnownPageNavigation,
  commitObservedPageNavigation,
  clickPointReady,
  clickNotReadyResult,
  sendCdp,
  withDebugger,
  getPageContext,
}: PageElementHost) {
async function sendToContent(tabId: number | undefined, action: string, params: Record<string, unknown>): Promise<ElementReply> {
  const result = await sendContent(tabId, action, params);
  if (!isElementReply(result)) throw new ToolExecutionError("CONTENT_SCRIPT_MESSAGE_FAILED", t("contentScriptReturnedAnInvalidResponse", { action: String(action) }), { tabId, action });
  return result;
}
async function callElement(tabId: number | undefined, binding: ElementTarget, action: string, params: Record<string, unknown> = {}, context: ToolContext = {}, options: ElementCallOptions = {}) {
  const result = await callBoundElement(tabId, binding, action, params, context, options);
  if (!isElementReply(result)) throw new ToolExecutionError("CONTENT_SCRIPT_MESSAGE_FAILED", t("contentScriptReturnedAnInvalidResponse", { action }), { tabId, action });
  return result;
}
function unknownInput(identity: Record<string, unknown>) {
  return { ...identity, error: t("inputResultUnknown"), code: "INPUT_RESULT_UNKNOWN", resultUnknown: true };
}
async function withElement<T>(tabId: number | undefined, binding: ElementTarget, context: ToolContext, options: ElementCallOptions, fn: (send: CdpCommand, call: (action: string, params?: Record<string, unknown>) => Promise<ElementReply>) => Promise<T>) {
  return withBoundElement(tabId, binding, context, options, (send, call) => fn(send, async (action, params = {}) => {
    const result = await call(action, params);
    if (!isElementReply(result)) throw new ToolExecutionError("CONTENT_SCRIPT_MESSAGE_FAILED", t("contentScriptReturnedAnInvalidResponse", { action }), { tabId, action });
    return result;
  }));
}
async function observeElementNavigation(tabId: number, pageBefore: PageState, prepared: PreparedNavigation | null, guardrails: SecurityGuardrails) {
  await new Promise(resolve => setTimeout(resolve, 180));
  const pageAfter = await getTabPageState(tabId);
  return {
    pageDelta: pageStateDelta(pageBefore, pageAfter),
    observedNavigation: commitObservedPageNavigation({ pageBefore, pageAfter, prepared, guardrails, toolName: "act_on_element", tabId }),
  };
}
const keyboard = createCdpKeyboard({ sendCdp, ToolExecutionError });
const touch = createCdpTouch({ ToolExecutionError });
// ===========================================================================
// Page content
// ===========================================================================

registerTool({
  name: "read_article",
  get description() { return toolT("readArticleDescription"); },
  get parameters() { return {
    type: "object",
    properties: {
      tabId: { type: "number", description: toolT("readArticleTabId") },
      source: { type: "string", enum: ["auto", "selection", "article", "selector", "body"], description: toolT("readArticleSource") },
      selector: { type: "string", description: toolT("readArticleSelector") },
      offset: { type: "number", description: toolT("readArticleOffset") },
      limit: { type: "number", description: toolT("readArticleLimit") },
    },
    required: ["limit"],
  } as const; },
  page: "readOnly",
  timeout: { defaultMs: 30000, maxMs: 300000 },
  execute: async ({ tabId, source = "auto", selector = "", offset = 0, limit }, _signal, context = {}) => {
    if (source === "selector" && !String(selector || "").trim()) {
      throw new ToolExecutionError(
        "MISSING_SELECTOR",
        t("readArticleRequiresASelectorWhenSourceSelector"),
        { source, required: "selector" },
      );
    }
    const raw = String(selector || "").trim();
    if (!raw || (source !== "selector" && !/^(uid|css):/i.test(raw))) {
      return sendToContent(tabId, "readArticle", { source, selector: raw, offset, limit });
    }
    const target = await resolveSelectorTarget(tabId, raw, undefined, context);
    return callElement(target.tabId, target, "readArticle", { source, offset, limit, selector: target.selector || raw }, context, { scope: true });
  },
});

registerTool({
  name: "read_dom",
  get description() { return toolT("readDomDescription"); },
  get parameters() { return {
    type: "object",
    properties: {
      tabId: { type: "number", description: toolT("readArticleTabId") },
      offset: { type: "number", description: toolT("readDomOffset") },
      limit: { type: "number", description: toolT("readDomLimit") },
      selector: { type: "string", description: toolT("readDomSelector") },
    },
  } as const; },
  page: "readOnly",
  timeout: { defaultMs: 30000, maxMs: 300000 },
  execute: async ({ tabId, offset = 1, limit = 200, selector = "body" }, _signal, context = {}) => {
    const raw = String(selector || "body").trim();
    if (!raw || raw === "body") return sendToContent(tabId, "readDom", { offset, limit, selector: "body" });
    const target = await resolveSelectorTarget(tabId, raw, undefined, context);
    return callElement(target.tabId, target, "readDom", { offset, limit, selector: target.selector || raw }, context, { scope: true });
  },
});

registerTool({
  name: "find_elements",
  get description() { return toolT("findElementsDescription"); },
  get parameters() { return {
    type: "object",
    properties: {
      tabId: { type: "number", description: toolT("readArticleTabId") },
      pattern: { type: "string", description: toolT("findElementsPattern") },
      flags: { type: "string", description: toolT("findElementsFlags") },
      selector: { type: "string", description: toolT("findElementsSelector") },
      roles: { type: "array", items: { type: "string" }, description: toolT("findElementsRoles") },
      tags: { type: "array", items: { type: "string" }, description: toolT("findElementsTags") },
      types: { type: "array", items: { type: "string" }, description: toolT("findElementsTypes") },
      limit: { type: "number", description: toolT("findElementsLimit") },
      includeHidden: { type: "boolean", description: toolT("findElementsIncludeHidden") },
    },
  } as const; },
  page: "readOnly",
  timeout: { defaultMs: 30000, maxMs: 300000 },
  execute: async ({ tabId, pattern = "", flags = "i", selector = "body", roles = [], tags = [], types = [], limit = 20, includeHidden = false }, _signal, context = {}) => {
    const raw = String(selector || "body").trim();
    if (!raw || raw === "body") {
      const page = await sendToContent(tabId, "findElements", {
        pattern, flags, selector: "body", roles, tags, types, limit, includeHidden,
      });
      return addElementTargetsToFindResult(page);
    }
    const target = await resolveSelectorTarget(tabId, raw, undefined, context);
    const result = await callElement(target.tabId, target, "findElements", {
      pattern, flags, selector: target.selector || raw, roles, tags, types, limit, includeHidden,
    }, context, { scope: true });
    return addElementTargetsToFindResult(result);
  },
});

registerTool({
  name: "inspect_element",
  get description() { return toolT("inspectElementDescription", { targetGrammar: ELEMENT_TARGET_GRAMMAR }); },
  get parameters() { return {
    type: "object",
    properties: {
      tabId: { type: "number", description: toolT("readArticleTabId") },
      target: { type: "string", description: getElementTargetDescription() },
      index: { type: "number", description: toolT("inspectElementIndex") },
    },
    required: ["target"],
  } as const; },
  page: "readOnly",
  timeout: { defaultMs: 30000, maxMs: 300000 },
  execute: async ({ tabId, target = "", index }, _signal, context = {}) => {
    const ref = await resolveElementReference(tabId, { target, index }, context);
    const inspection = await callElement(ref.tabId, ref, "inspectElement", {}, context);
    return {
      ...inspection,
      tabId: ref.tabId,
      target: ref.target || elementTargetForRef(inspection) || elementTargetForSelector(ref.selector),
      uid: ref.uid || undefined,
      selector: inspection?.selector || ref.selector,
    };
  },
});

// ===========================================================================
// Page interaction
// ===========================================================================

registerTool({
  name: "act_on_element",
  behavior: { mayUnloadPage: args => {
    const action = String(args.action || "").trim().toLowerCase();
    const key = String(args.key || args.value || "").trim().toLowerCase();
    return action === "click" || (action === "fill" && args.submit === true)
      || (action === "press" && ["enter", "return", "space"].includes(key));
  } },
  effects: (_args, result) => result && typeof result === "object"
    && (("navigated" in result && result.navigated === true) || ("href" in result && Boolean(result.href)) || ("url" in result && Boolean(result.url)))
    ? [{ type: "context.siteChanged" }] : [],
  get description() { return toolT("actOnElementDescription", { targetGrammar: ELEMENT_TARGET_GRAMMAR }); },
  get parameters() { return {
    type: "object",
    properties: {
      tabId: { type: "number", description: toolT("readArticleTabId") },
      target: { type: "string", description: getElementTargetDescription() },
      index: { type: "number", description: toolT("inspectElementIndex") },
      action: { type: "string", enum: ["click", "fill", "press", "select", "check", "uncheck", "scroll"] },
      value: { type: "string", description: toolT("actOnElementValue") },
      key: { type: "string", description: toolT("actOnElementKey") },
      submit: { type: "boolean", description: toolT("actOnElementSubmit") },
    },
    required: ["target", "action"],
  } as const; },
  page: "owned",
  timeout: args => String(args.action || "").trim().toLowerCase() === "click" ? { defaultMs: 1800000, maxMs: 7200000 } : { defaultMs: 20000, maxMs: 120000 },
  execute: async ({ tabId, target = "", index, action, value = "", key = "", submit = false }, _signal, context = {}) => {
    const normalizedAction = String(action || "").trim().toLowerCase();
    const allowed = new Set(["click", "fill", "press", "select", "check", "uncheck", "scroll"]);
    if (!allowed.has(normalizedAction)) {
      return {
        error: `Unsupported act_on_element action: ${action}`,
        code: "UNSUPPORTED_ELEMENT_ACTION",
        details: {
          action,
          allowedActions: [...allowed],
          examples: [
            { target: "css:input[name=\"q\"]", action: "fill", value: t("searchTerms") },
            { target: "css:input[name=\"q\"]", action: "press", key: "Enter" },
            { target: "uid:t1887138561_ax_42", action: "click" },
          ],
        },
      };
    }

    const ref = await resolveElementReference(tabId, { target, index }, context);
    tabId = ref.tabId;
    const selector = ref.selector || "";
    index = ref.index ?? 0;
    const resolvedTarget = ref.target || elementTargetForSelector(selector);
    const toolArgsForUpdates = { tabId, target, index, action, value, key, submit };
    if (!tabId) throw new ToolExecutionError("NO_ACTIVE_TAB", t("noActiveTabIsAvailable"), { target: resolvedTarget, selector, action });

    const inspected = await callElement(tabId, ref, "inspectElement", {}, context);
    if (inspected.error) return withElementActionHelp(inspected, normalizedAction);

    if (normalizedAction === "click") {
      const pageBefore = await getTabPageState(tabId);
      const securityGuardrails = await getSecurityGuardrails();
      let current = inspected;
      let pointSelector = selector;
      let pointIndex = index;
      let resolved: ElementReply | null = null;

      if (!clickPointReady(current)) {
        const scrolled = await callElement(tabId, ref, "scrollElementIntoView", { block: "center" }, context);
        if (scrolled.error) return withElementActionHelp(scrolled, normalizedAction);
        current = scrolled;
      }

      if (!clickPointReady(current)) {
        resolved = await callElement(tabId, ref, "resolveClickTarget", {}, context);
        if (resolved.error) return withElementActionHelp(resolved, normalizedAction);
        if (resolved.navigateUrl) {
          const preparedNavigation = await prepareKnownPageNavigation({
            url: resolved.navigateUrl,
            pageBefore,
            guardrails: securityGuardrails,
            context,
            signal: _signal,
            toolName: "act_on_element",
            toolArgs: toolArgsForUpdates,
            tabId,
            source: "resolved_href",
          });
          const navigationUrl = preparedNavigation?.url || resolved.navigateUrl;
          await chrome.tabs.update(tabId, { url: navigationUrl });
          const { pageDelta, observedNavigation } = await observeElementNavigation(tabId, pageBefore, preparedNavigation, securityGuardrails);
          return {
            action: "click",
            target: resolvedTarget,
            selector,
            uid: ref.uid || undefined,
            index,
            tabId,
            clickDispatched: false,
            navigated: pageDelta.urlChanged,
            method: "href_navigation",
            href: navigationUrl,
            ...pageDelta,
            ...(observedNavigation ? { observedNavigation } : {}),
            element: resolved.element || current,
            originalElement: inspected,
          };
        }
        if (resolved.resolvedSelector) {
          try {
            const resolvedInspection = await callElement(tabId, {
              tabId, selector: resolved.resolvedSelector, index: 0, target: elementTargetForSelector(resolved.resolvedSelector),
            }, "scrollElementIntoView", { block: "center" }, context);
            if (!resolvedInspection.error) {
              current = resolvedInspection;
              pointSelector = resolved.resolvedSelector;
              pointIndex = 0;
            }
          } catch (err) {
            if (isCdpFallbackForbiddenError(err)) throw err;
          }
        }
        if (!clickPointReady(current) && resolved.clickablePoint) {
          current = {
            ...current,
            clickablePoint: resolved.clickablePoint,
            href: resolved.href || current.href,
          };
        }
      }

      if (!clickPointReady(current)) {
        return clickNotReadyResult({
          target: resolvedTarget,
          selector,
          index,
          inspection: current,
          originalInspection: inspected,
          resolved,
        });
      }

      const point = current.clickablePoint;
      const preparedNavigation = await prepareKnownPageNavigation({
        url: current.href || resolved?.href || "",
        pageBefore,
        guardrails: securityGuardrails,
        context,
        signal: _signal,
        toolName: "act_on_element",
        toolArgs: toolArgsForUpdates,
        tabId,
        source: "href",
      });
      let touchInput = false;
      let dispatched = false;
      try {
        await withDebugger(tabId, async (_target, send) => {
          dispatched = true;
          touchInput = getPageContext(tabId).pageMode === "mobile";
          if (touchInput) { await touch(send, point, { signal: _signal }); return; }
          await send("Input.dispatchMouseEvent", {
            type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1,
          });
          await send("Input.dispatchMouseEvent", {
            type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1,
          });
        }, context);
        const { pageDelta, observedNavigation } = await observeElementNavigation(tabId, pageBefore, preparedNavigation, securityGuardrails);
        return {
          action: "click",
          target: resolvedTarget,
          selector,
          uid: ref.uid || undefined,
          index,
          tabId,
          clickDispatched: true,
          navigated: pageDelta.urlChanged,
          method: pointSelector !== selector ? "cdp_resolved" : "cdp",
          href: current.href || resolved?.href || undefined,
          clickedSelector: pointSelector,
          clickedIndex: pointIndex,
          ...pageDelta,
          ...(observedNavigation ? { observedNavigation } : {}),
          element: current,
          originalElement: current !== inspected ? inspected : undefined,
        };
      } catch (err) {
        if (isCdpFallbackForbiddenError(err)) throw err;
        if (dispatched || touchInput) return { ...unknownInput({ action: "click", target: resolvedTarget, selector, uid: ref.uid || undefined, index, tabId }), clickDispatched: true };
        const fallback = await callElement(tabId, ref, "actOnElement", { elementAction: normalizedAction, value, key, submit }, context);
        const { pageDelta, observedNavigation } = await observeElementNavigation(tabId, pageBefore, preparedNavigation, securityGuardrails);
        return {
          ...fallback,
          target: resolvedTarget,
          selector,
          uid: ref.uid || undefined,
          index,
          tabId,
          clickDispatched: fallback.error ? false : Boolean(fallback.clicked || fallback.navigated),
          navigated: Boolean(fallback.navigated) || pageDelta.urlChanged,
          method: fallback.error ? "content_failed" : "content_fallback",
          cdpError: err instanceof Error ? err.message : String(err),
          ...pageDelta,
          ...(observedNavigation ? { observedNavigation } : {}),
        };
      }
    }

    const identity = { action: normalizedAction, target: resolvedTarget, selector, uid: ref.uid || undefined, index, tabId };
    const assertActive = () => {
      if (_signal?.aborted) throw new ToolExecutionError("OPERATION_ABORTED", t("elementActionCancelled"), identity);
    };
    if (normalizedAction === "fill") {
      assertActive();
      const pageBefore = submit ? await getTabPageState(tabId) : null;
      const guardrails = submit ? await getSecurityGuardrails() : null;
      return withElement(tabId, ref, context, { editingHost: true }, async (send, call) => {
        assertActive();
        const prepared = await call("prepareElementFill", { value });
        assertActive();
        if (prepared.error) return withElementActionHelp(prepared, normalizedAction);
        const textInput = prepared.fillMode === "text";
        const inputKeyboard = createCdpKeyboard({ ToolExecutionError, sendCdp: (_tabId, method, params) => {
          if (params.type !== "keyUp") assertActive();
          return send(method, params);
        } });
        let fill: unknown;
        let dispatched = false;
        try {
          if (textInput) {
            dispatched = true;
            if (value) await send("Input.insertText", { text: value });
            else await inputKeyboard.press(tabId, "Backspace", context);
          } else {
            const result = await call("actOnElement", { elementAction: "fill", value, submit: false });
            if (result.error) return withElementActionHelp(result, normalizedAction);
            fill = result.fill;
          }
          assertActive();
          const actual = await call("readElementActionState", {});
          assertActive();
          if (actual.error) return withElementActionHelp(actual, normalizedAction);
          // Chromium uses NBSP to preserve boundary spaces in contenteditable text.
          const equivalentText = (text: string) => prepared.contentEditable ? text.replace(/\u00a0/g, " ") : text;
          if (textInput && (typeof actual.value !== "string"
            || equivalentText(actual.value) !== equivalentText(value.replace(/\r\n?/g, "\n")))) {
            return { ...identity, error: t("elementValueMismatch"), code: "ELEMENT_VALUE_MISMATCH",
              filled: false, value: actual.value, submitDispatched: false, element: actual };
          }
          if (submit) {
            if (!actual.focused) return { ...identity, error: t("elementFocusLost"), code: "ELEMENT_FOCUS_FAILED",
              filled: true, value: actual.value, submitDispatched: false, element: actual };
            dispatched = true;
            await inputKeyboard.press(tabId, "Enter", context);
            assertActive();
          }
          const navigation = pageBefore && guardrails
            ? await observeElementNavigation(tabId, pageBefore, null, guardrails) : null;
          assertActive();
          return { ...identity, filled: true, value: actual.value, fill, submitDispatched: submit,
            method: textInput ? "cdp" : "content", element: actual,
            ...(navigation ? { ...navigation.pageDelta, navigated: navigation.pageDelta.urlChanged,
              ...(navigation.observedNavigation ? { observedNavigation: navigation.observedNavigation } : {}) } : {}) };
        } catch (err) {
          if (isCdpFallbackForbiddenError(err)) throw err;
          if (dispatched) return { ...unknownInput(identity), filled: false, submitDispatched: false };
          throw err;
        }
      });
    }

    if (normalizedAction === "check" || normalizedAction === "uncheck") {
      assertActive();
      const desired = normalizedAction === "check";
      if (inspected.tag !== "input" || !["checkbox", "radio"].includes(String(inspected.type))) {
        return { ...identity, error: t("elementNotCheckable"), code: "NOT_CHECKABLE_ELEMENT", element: inspected };
      }
      if (inspected.checked === desired) return { ...identity, checked: desired, changed: false, element: inspected };
      if (inspected.type === "radio" && !desired) {
        return { ...identity, error: t("radioCannotBeUnchecked"), code: "ELEMENT_CHECK_STATE_MISMATCH", element: inspected };
      }
      return withDebugger(tabId, async (_target, send) => {
        assertActive();
        const current = await callElement(tabId, ref, "resolveCheckTarget", {}, context);
        assertActive();
        if (current.error) return withElementActionHelp(current, normalizedAction);
        if (current.tag !== "input" || current.type !== inspected.type) {
          return { ...identity, error: t("elementNotCheckable"), code: "NOT_CHECKABLE_ELEMENT", element: current };
        }
        if (current.checked === desired) return { ...identity, checked: desired, changed: false, element: current };
        const clickTarget = !current.disabled && isElementReply(current.element) ? current.element : current;
        if (!clickPointReady(clickTarget)) return clickNotReadyResult({ target: resolvedTarget, selector, index,
          inspection: clickTarget, originalInspection: current, resolved: null });
        const point = clickTarget.clickablePoint;
        let dispatched = false;
        try {
          if (getPageContext(tabId).pageMode === "mobile") {
            dispatched = true;
            await touch(send, point, { signal: _signal });
          } else {
            let released = false;
            try {
              dispatched = true;
              await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
              assertActive();
              await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
              released = true;
            } finally {
              if (!released) {
                // Release a possibly held button outside the control without completing its click.
                try { await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: -1, y: -1, button: "left", clickCount: 1 }); } catch { /* The run may have lost its lease. */ }
              }
            }
          }
        } catch (err) {
          if (isCdpFallbackForbiddenError(err)) throw err;
          if (dispatched) return { ...unknownInput(identity), checked: undefined };
          throw err;
        }
        assertActive();
        const actual = await callElement(tabId, ref, "readElementActionState", {}, context);
        assertActive();
        if (actual.error) return withElementActionHelp(actual, normalizedAction);
        if (actual.tag !== "input" || actual.type !== inspected.type || actual.checked !== desired) return { ...identity, error: t("elementCheckStateMismatch"),
          code: "ELEMENT_CHECK_STATE_MISMATCH", checked: actual.checked, element: actual };
        return { ...identity, checked: desired, changed: true, method: "cdp", element: actual };
      }, context);
    }

    if (normalizedAction === "press") {
      const pressedKey = key || value;
      if (!pressedKey) {
        return {
          error: "key is required for press action",
          code: "MISSING_KEY",
          details: { target: resolvedTarget, selector, index, action: "press", examples: [{ key: "Enter" }, { key: "Escape" }, { key: "Tab" }] },
          element: inspected,
        };
      }
      const preparedKey = keyboard.normalize(pressedKey);
      let dispatched = false;
      try {
        if (inspected.clickablePoint) {
          dispatched = true;
          await sendCdp(tabId, "Input.dispatchMouseEvent", {
            type: "mousePressed", x: inspected.clickablePoint.x, y: inspected.clickablePoint.y, button: "left", clickCount: 1,
          }, context);
          await sendCdp(tabId, "Input.dispatchMouseEvent", {
            type: "mouseReleased", x: inspected.clickablePoint.x, y: inspected.clickablePoint.y, button: "left", clickCount: 1,
          }, context);
        }
        dispatched = true;
        await keyboard.press(tabId, preparedKey, context);
        return { action: "press", target: resolvedTarget, selector, uid: ref.uid || undefined, index, tabId, key: pressedKey, pressed: true, method: "cdp", element: inspected };
      } catch (err) {
        if (isCdpFallbackForbiddenError(err)) throw err;
        if (dispatched) return { ...unknownInput(identity), key: pressedKey, element: inspected };
        throw err;
      }
    }

    const fallback = await callElement(tabId, ref, "actOnElement", { elementAction: normalizedAction, value, key, submit }, context);
    return {
      ...fallback,
      target: resolvedTarget,
      selector,
      uid: ref.uid || undefined,
      index,
      tabId,
      method: fallback.error ? "content_failed" : "content",
      element: fallback.element || inspected,
    };
  },
});

function withElementActionHelp(result: ElementReply, action: string) {
  if (!result || !result.error) return result;
  return {
    ...result,
    hint: "Use find_elements to refresh selectors, inspect_element to verify the target, then act_on_element with one of: click/fill/press/select/check/uncheck/scroll.",
    requestedAction: action,
  };
}

registerTool({
  name: "scroll_page",
  get description() { return toolT("scrollPageDescription"); },
  get parameters() { return {
    type: "object",
    properties: {
      tabId: { type: "number" },
      direction: { type: "string", enum: ["up", "down", "top", "bottom"] },
      pixels: { type: "number", description: toolT("scrollPagePixels") },
      target: { type: "string", description: toolT("scrollPageTarget", { targetDescription: getElementTargetDescription() }) },
      index: { type: "number", description: toolT("scrollPageIndex") },
    },
  } as const; },
  page: "owned",
  timeout: { defaultMs: 20000, maxMs: 120000 },
  execute: async ({ tabId, direction = "down", pixels = 500, target = "", index }, _signal, context = {}) => {
    if (!String(target || "").trim()) return sendToContent(tabId, "scrollPage", { direction, pixels });
    const ref = await resolveElementReference(tabId, { target, index }, context);
    const scrolled = await callElement(ref.tabId, ref, "scrollPage", { direction, pixels, selector: ref.selector || "*" }, context);
    return { ...scrolled, tabId: ref.tabId, target: ref.target, selector: scrolled.selector || ref.selector, index: ref.index ?? 0 };
  },
});


}


export default ((host) => { registerPageElementTools({ ...host, ...host.element }); }) satisfies ToolExtension;
