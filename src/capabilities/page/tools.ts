import { toolT } from "./tool-messages.js";
import { t } from "./i18n.js";
import type { ToolExtension, ToolExtensionAPI } from "#sdk/background";
import { isElementReply, type ElementReply } from "#sdk/shared/browser";
import type { SecurityGuardrails } from "#sdk/shared/security";
import type { PageState, PreparedNavigation } from "#sdk/background/browser";
export type { PageState, PreparedNavigation, PageNavigationHost } from "#sdk/background/browser";
type PageElementHost = Pick<ToolExtensionAPI,
  "registerTool" | "ToolExecutionError" | "sendToContent" | "clickPointReady"
  | "clickNotReadyResult" | "sendCdp" | "withDebugger" | "getPageContext" | "getTabPageState" | "pageStateDelta"
  | "prepareKnownPageNavigation" | "commitObservedPageNavigation"> & Pick<ToolExtensionAPI["element"],
  "resolveSelectorTarget" | "resolveElementReference" | "addElementTargetsToFindResult" | "elementTargetForRef"
  | "elementTargetForSelector" | "elementTargetGrammar" | "getElementTargetDescription">;
import { getSecurityGuardrails } from "#sdk/shared/security";
import { isCdpFallbackForbiddenError, bindingFromTarget, withBoundElement, hitBelongsToNode } from "#sdk/background/browser";
import { createCdpKeyboard, createCdpTouch } from "#sdk/background/browser";

/** Registers page reading, element inspection/action, and scrolling tools. */
export function registerPageElementTools({
  registerTool,
  ToolExecutionError,
  sendToContent: sendContent,
  resolveSelectorTarget,
  resolveElementReference,
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
    const target = source === "selector"
      ? await resolveSelectorTarget(tabId, selector, 0, context)
      : { tabId, selector };
    return sendToContent(target.tabId, "readArticle", { source, selector: target.selector, offset, limit });
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
    const target = await resolveSelectorTarget(tabId, selector, 0, context);
    return sendToContent(target.tabId, "readDom", { offset, limit, selector: target.selector || "body" });
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
    const target = await resolveSelectorTarget(tabId, selector, 0, context);
    const result = await sendToContent(target.tabId, "findElements", {
      pattern, flags, selector: target.selector || "body", roles, tags, types, limit, includeHidden,
    });
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
  execute: async ({ tabId, target = "", index = 0 }, _signal, context = {}) => {
    const ref = await resolveElementReference(tabId, { target, index, allowBackendOnly: true }, context);
    const inspection = await withBoundElement({ ToolExecutionError, withDebugger }, bindingFromTarget(ref), context, node => node.call({ action: "inspect" }));
    return {
      ...inspection,
      tabId: ref.tabId,
      target: ref.target || elementTargetForRef(inspection) || elementTargetForSelector(ref.selector),
      uid: ref.uid || undefined,
      selector: ref.selector || undefined,
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
  execute: async ({ tabId, target = "", index = 0, action, value = "", key = "", submit = false }, signal, context = {}) => {
    const normalizedAction = String(action || "").trim().toLowerCase();
    const allowed = new Set(["click", "fill", "press", "select", "check", "uncheck", "scroll"]);
    if (normalizedAction === "press" && !String(key || value || "").trim()) {
      return { error: "key is required for press action", code: "MISSING_KEY", inputDispatched: false, action: "press" };
    }
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

    const ref = await resolveElementReference(tabId, { target, index, allowBackendOnly: true }, context);
    tabId = ref.tabId;
    const binding = bindingFromTarget({ ...ref, index: ref.index });
    const resolvedTarget = ref.target || elementTargetForSelector(binding.selector || "");
    const toolArgsForUpdates = { tabId, target, index, action, value, key, submit };
    if (!tabId) throw new ToolExecutionError("NO_ACTIVE_TAB", t("noActiveTabIsAvailable"), { target: resolvedTarget, action });
    const identity = { action: normalizedAction, target: resolvedTarget, uid: ref.uid || undefined, index: ref.index, tabId };
    const unknownAfterInput = (error: unknown) => ({
      ...identity,
      inputDispatched: true,
      code: "INPUT_RESULT_UNKNOWN",
      error: "Input was already dispatched and the result is unknown. Do not send it again. Take a fresh get_ax_tree snapshot, then retry with a new target.",
      cause: error instanceof Error ? error.message : String(error),
    });

    return withBoundElement({ ToolExecutionError, withDebugger }, binding, context, async (node) => {
      const assertActive = () => {
        if (signal?.aborted) throw new ToolExecutionError("OPERATION_ABORTED", t("elementActionCancelled"), identity);
      };
      assertActive();

      if (normalizedAction === "scroll") {
        const scrolled = await node.call({ action: "scroll" });
        if (scrolled.error) return withElementActionHelp(scrolled as ElementReply, normalizedAction);
        return { ...identity, scrolledTo: true, method: "node", element: scrolled };
      }

      if (normalizedAction === "select") {
        const selected = await node.call({ action: "select", value: String(value || "") });
        if (selected.error) return withElementActionHelp(selected as ElementReply, normalizedAction);
        return { ...identity, ...selected, method: "node" };
      }

      if (normalizedAction === "fill") {
        const pageBefore = submit ? await getTabPageState(tabId) : null;
        const guardrails = submit ? await getSecurityGuardrails() : null;
        const prepared = await node.call({ action: "prepareFill", value: String(value ?? "") });
        assertActive();
        if (prepared.error) return withElementActionHelp(prepared as ElementReply, normalizedAction);
        let dispatched = false;
        try {
          if (prepared.fillMode === "content") {
            dispatched = true;
            const filled = await node.call({ action: "fillRich", value: String(value ?? "") });
            if (filled.error) return unknownAfterInput(filled.error);
          } else if (value) {
            dispatched = true;
            await node.send("Input.insertText", { text: String(value) });
          } else {
            dispatched = true;
            await keyboard.press(tabId, "Backspace", context);
          }
          assertActive();
          const actual = await node.call({ action: "readState" });
          if (actual.error || actual.missing) return unknownAfterInput(actual.error || "node missing after input");
          const equivalentText = (text: string) => prepared.contentEditable ? text.replace(/\u00a0/g, " ") : text;
          const expected = String(value ?? "").replace(/\r\n?/g, "\n");
          if (prepared.fillMode === "text" && (typeof actual.value !== "string" || equivalentText(actual.value) !== equivalentText(expected))) {
            return { ...identity, error: t("elementValueMismatch"), code: "ELEMENT_VALUE_MISMATCH",
              filled: false, inputDispatched: true, value: actual.value, submitDispatched: false, element: actual };
          }
          if (submit) {
            if (!actual.focused) return { ...identity, error: t("elementFocusLost"), code: "ELEMENT_FOCUS_FAILED",
              filled: true, inputDispatched: true, value: actual.value, submitDispatched: false, element: actual };
            await keyboard.press(tabId, "Enter", context);
          }
          const navigation = pageBefore && guardrails
            ? await observeElementNavigation(tabId, pageBefore, null, guardrails) : null;
          return { ...identity, filled: true, value: actual.value, submitDispatched: submit, method: prepared.fillMode === "text" ? "cdp" : "node", element: actual,
            ...(navigation ? { ...navigation.pageDelta, navigated: navigation.pageDelta.urlChanged,
              ...(navigation.observedNavigation ? { observedNavigation: navigation.observedNavigation } : {}) } : {}) };
        } catch (error) {
          if (isCdpFallbackForbiddenError(error) && !dispatched) throw error;
          if (dispatched) return unknownAfterInput(error);
          throw error;
        }
      }

      const pointing = normalizedAction === "check" || normalizedAction === "uncheck" ? "checkPlan" : "clickPlan";
      const desired = normalizedAction === "check";
      if (normalizedAction === "check" || normalizedAction === "uncheck") {
        const inspected = await node.call({ action: "inspect" });
        if (inspected.tag !== "input" || !["checkbox", "radio"].includes(String(inspected.type))) {
          return { ...identity, error: t("elementNotCheckable"), code: "NOT_CHECKABLE_ELEMENT", element: inspected };
        }
        if (inspected.checked === desired) return { ...identity, checked: desired, changed: false, element: inspected };
        if (inspected.type === "radio" && !desired) {
          return { ...identity, error: t("radioCannotBeUnchecked"), code: "ELEMENT_CHECK_STATE_MISMATCH", element: inspected };
        }
      }

      const pageBefore = normalizedAction === "click" ? await getTabPageState(tabId) : null;
      const securityGuardrails = normalizedAction === "click" ? await getSecurityGuardrails() : null;
      const plan = await node.call({ action: pointing });
      if (plan.navigateUrl && normalizedAction === "click" && pageBefore && securityGuardrails) {
        const preparedNavigation = await prepareKnownPageNavigation({
          url: String(plan.navigateUrl),
          pageBefore,
          guardrails: securityGuardrails,
          context,
          signal,
          toolName: "act_on_element",
          toolArgs: toolArgsForUpdates,
          tabId,
          source: "resolved_href",
        });
        const navigationUrl = preparedNavigation?.url || String(plan.navigateUrl);
        await chrome.tabs.update(tabId, { url: navigationUrl });
        const { pageDelta, observedNavigation } = await observeElementNavigation(tabId, pageBefore, preparedNavigation, securityGuardrails);
        return { ...identity, clickDispatched: false, navigated: pageDelta.urlChanged, method: "href_navigation", href: navigationUrl, ...pageDelta,
          ...(observedNavigation ? { observedNavigation } : {}), element: plan };
      }
      if (!clickPointReady(plan as ElementReply)) {
        return clickNotReadyResult({
          target: resolvedTarget,
          selector: binding.selector || resolvedTarget,
          index: ref.index,
          inspection: plan as ElementReply,
          originalInspection: plan as ElementReply,
          resolved: null,
        });
      }
      const point = (plan as ElementReply & { clickablePoint: { x: number; y: number } }).clickablePoint;
      assertActive();
      const cdpHit = await hitBelongsToNode(node.send, node.objectId, point);
      const pageHit = cdpHit ? null : await node.call({ action: "containsPoint", value: `${point.x},${point.y}` });
      const closedShadow = plan.inShadowRoot === true && plan.shadowMode === "closed";
      if (closedShadow ? !cdpHit : !cdpHit && pageHit?.ok !== true) {
        return { ...identity, error: "Element is covered by another element", code: "ELEMENT_OBSCURED", element: plan, inputDispatched: false };
      }
      let dispatched = false;
      try {
        const preparedNavigation = pageBefore && securityGuardrails ? await prepareKnownPageNavigation({
          url: String(plan.href || ""),
          pageBefore,
          guardrails: securityGuardrails,
          context,
          signal,
          toolName: "act_on_element",
          toolArgs: toolArgsForUpdates,
          tabId,
          source: "href",
        }) : null;
        if (getPageContext(tabId).pageMode === "mobile") {
          dispatched = true;
          await touch(node.send, point, { signal });
        } else {
          await node.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
          dispatched = true;
          assertActive();
          await node.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
        }
        if (normalizedAction === "press") {
          const pressedKey = key || value;
          if (!pressedKey) return { ...identity, error: "key is required for press action", code: "MISSING_KEY", inputDispatched: true, element: plan };
          await keyboard.press(tabId, keyboard.normalize(String(pressedKey)), context);
          return { ...identity, key: pressedKey, pressed: true, method: "cdp", element: plan, inputDispatched: true };
        }
        if (normalizedAction === "check" || normalizedAction === "uncheck") {
          const actual = await node.call({ action: "readState" });
          if (actual.checked !== desired) {
            return { ...identity, error: t("elementCheckStateMismatch"), code: "ELEMENT_CHECK_STATE_MISMATCH", checked: actual.checked, inputDispatched: true, element: actual };
          }
          return { ...identity, checked: desired, changed: true, method: "cdp", element: actual, inputDispatched: true };
        }
        const observed = pageBefore && securityGuardrails
          ? await observeElementNavigation(tabId, pageBefore, preparedNavigation, securityGuardrails) : null;
        return { ...identity, clickDispatched: true, method: "cdp", href: plan.href || undefined, element: plan,
          ...(observed ? { ...observed.pageDelta, navigated: observed.pageDelta.urlChanged,
            ...(observed.observedNavigation ? { observedNavigation: observed.observedNavigation } : {}) } : {}) };
      } catch (error) {
        if (isCdpFallbackForbiddenError(error) && !dispatched) throw error;
        if (dispatched) return unknownAfterInput(error);
        return { ...identity, error: error instanceof Error ? error.message : String(error), code: "ELEMENT_ACTION_FAILED", inputDispatched: false, element: plan };
      }
    });
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
  execute: async ({ tabId, direction = "down", pixels = 500, target = "", index = 0 }, _signal, context = {}) => {
    if (!String(target || "").trim()) return sendToContent(tabId, "scrollPage", { direction, pixels });
    const ref = await resolveElementReference(tabId, { target, index, allowBackendOnly: true }, context);
    const scrolled = await withBoundElement({ ToolExecutionError, withDebugger }, bindingFromTarget(ref), context, node => node.call({ action: "scroll" }));
    return { ...scrolled, tabId: ref.tabId, target: ref.target, uid: ref.uid || undefined, index: ref.index, direction, pixels };
  },
});


}


export default ((host) => { registerPageElementTools({ ...host, ...host.element }); }) satisfies ToolExtension;
