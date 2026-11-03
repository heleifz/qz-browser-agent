import { toolT } from "./tool-messages.js";
import { t } from "./i18n.js";
import type { ToolExtension, ToolExtensionAPI } from "#sdk/background";
import { isElementReply, createElementObservation, type ElementObservation, type ElementReply } from "#sdk/shared/browser";
import type { SecurityGuardrails } from "#sdk/shared/security";
import type { CdpCommand, ElementTarget, PageState, PreparedNavigation } from "#sdk/background/browser";
import type { ToolContext } from "#sdk/background";
import { bindToolResultPresentation, requireToolFields, toolError } from "#sdk/background/tools";
export type { PageState, PreparedNavigation, PageNavigationHost } from "#sdk/background/browser";
type PageElementHost = Pick<ToolExtensionAPI,
  "registerTool" | "ToolExecutionError" | "sendToContent" | "clickPointReady"
  | "clickNotReadyResult" | "sendCdp" | "withDebugger"
  | "getPageContext" | "getTabPageState" | "pageStateDelta"
  | "prepareKnownPageNavigation" | "commitObservedPageNavigation"> & Pick<ToolExtensionAPI["element"],
  "resolveSelectorTarget" | "resolveElementReference" | "addElementTargetsToFindResult"
  | "elementTargetForSelector" | "elementTargetGrammar" | "getElementTargetDescription" | "useElement">;
import { getSecurityGuardrails } from "#sdk/shared/security";
import { armPageInputReceipt, beginPageNavigationObservation, ensurePageSurface, frameContentOrigin, isCdpFallbackForbiddenError, openChildFrame, pageInputDelivered, readPageInputReceipt } from "#sdk/background/browser";
import { createCdpKeyboard, createCdpTouch } from "#sdk/background/browser";

interface PageViewport { width: number; height: number }
interface FrameOrigin { x: number; y: number }

/** Iframe content scripts report iframe-local points. Shift them by the iframe content origin only at dispatch. */
async function framedPagePoint(send: CdpCommand, point: { x: number; y: number }, frameId: string) {
  if (!frameId) return point;
  const origin = await frameContentOrigin(send, frameId);
  if (!origin) throw new Error("The iframe content origin is unavailable");
  return { x: point.x + origin.x, y: point.y + origin.y };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Root layout viewport in CSS pixels, the same space as Input.dispatchMouseEvent. */
async function readPageViewport(send: CdpCommand): Promise<PageViewport | null> {
  try {
    const metrics = asRecord(await send("Page.getLayoutMetrics"));
    const viewport = asRecord(metrics.cssLayoutViewport || metrics.layoutViewport);
    const width = Number(viewport.clientWidth);
    const height = Number(viewport.clientHeight);
    if (!(width > 0) || !(height > 0)) return null;
    return { width, height };
  } catch {
    return null;
  }
}

function readRect(value: unknown): { x: number; y: number; w: number; h: number } | null {
  const box = asRecord(value);
  const x = Number(box.x);
  const y = Number(box.y);
  const w = Number(box.w);
  const h = Number(box.h);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  return { x, y, w, h };
}

function pointInPageViewport(point: { x: number; y: number } | null | undefined, viewport: PageViewport): boolean {
  return !!point && point.x >= 0 && point.y >= 0 && point.x <= viewport.width && point.y <= viewport.height;
}

function rectInPageViewport(rect: { x: number; y: number; w: number; h: number }, origin: FrameOrigin, viewport: PageViewport) {
  const left = rect.x + origin.x;
  const top = rect.y + origin.y;
  return top + rect.h >= 0 && left + rect.w >= 0 && top <= viewport.height && left <= viewport.width;
}

/**
 * Content scripts measure the iframe document. Callers that trust inViewport need the root page.
 * A mouse point outside that viewport is not delivered to the framed element; dispatch can still
 * hit the root document, so the input receipt must not turn that miss into success.
 */
function applyFramePageViewport(element: ElementReply, origin: FrameOrigin | null, viewport: PageViewport | null): ElementReply {
  if (!element || element.error || !origin || !viewport) return element;
  const rect = readRect(element.rect);
  const local = element.clickablePoint;
  const shifted = local ? { x: local.x + origin.x, y: local.y + origin.y } : null;
  const clickablePointInViewport = pointInPageViewport(shifted, viewport);
  // The click lands at the point. A point inside the page viewport is in view even when a rounded rect misses it.
  const inViewport = clickablePointInViewport || (rect ? rectInPageViewport(rect, origin, viewport) : false);
  element.inViewport = inViewport;
  element.state = { ...(element.state || {}), inViewport, clickablePointInViewport };
  return element;
}

function framePointMissesPage(element: ElementReply, origin: FrameOrigin | null, viewport: PageViewport | null) {
  const point = element.clickablePoint;
  if (!origin || !viewport || !point) return false;
  return !pointInPageViewport({ x: point.x + origin.x, y: point.y + origin.y }, viewport);
}

/** Cross-site iframe input uses that frame's viewport, the same space as the content-script point. */
async function remoteFrameInput(send: CdpCommand, frameId: string): Promise<CdpCommand | null> {
  const opened = await openChildFrame(send, frameId);
  return opened?.sessionId ? opened.send : null;
}

/** Registers page reading, element inspection/action, and scrolling tools. */
export function registerPageElementTools({
  registerTool,
  ToolExecutionError,
  sendToContent: sendContent,
  resolveSelectorTarget,
  resolveElementReference,
  useElement,
  addElementTargetsToFindResult,
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
async function sendToContent(tabId: number | undefined, action: string, params: Record<string, unknown>, call?: (action: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>, context?: ToolContext): Promise<ElementReply> {
  const result = await (call ? call(action, params) : sendContent(tabId, action, params, context));
  if (!isElementReply(result)) throw new ToolExecutionError("CONTENT_SCRIPT_MESSAGE_FAILED", t("contentScriptReturnedAnInvalidResponse", { action: String(action) }), { action });
  return result;
}
function inputNotDelivered(details: Record<string, unknown>) {
  return { ...toolError("INPUT_NOT_DELIVERED", t("inputNotDelivered"), {
    hint: "Use find_elements to refresh the target before retrying the action.",
    details: { ...details, clickDispatched: true, inputDelivered: false },
  }) };
}
async function inputWasDelivered(tabId: number, receiptId = "") {
  // An unreadable receipt is not evidence the input missed the page.
  if (!receiptId) return true;
  const count = await readPageInputReceipt(tabId, receiptId);
  return count == null || count > 0;
}
function scopedSelector(binding: ElementTarget, fallback = "body") {
  const selector = String(binding.selector || "").trim();
  // A uid with no selector must not widen into the whole page.
  if (binding.uid) return selector;
  return selector || fallback;
}
function rethrowStaleElement(err: unknown): void {
  if (err instanceof ToolExecutionError && String(err.code || "").startsWith("STALE_ELEMENT_UID")) throw err;
}
function readBound<T>(binding: ElementTarget, context: ToolContext, fn: (call?: (action: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>) => Promise<T>) {
  if (!binding.uid) return fn();
  return useElement(binding.tabId, binding, context, call => fn(call));
}
async function observeElementNavigation(tabId: number, pageBefore: PageState, prepared: PreparedNavigation | null,
  guardrails: SecurityGuardrails, observation: Awaited<ReturnType<typeof beginPageNavigationObservation>>) {
  const { pageBefore: dispatchPage, pageAfter, documentChanged, navigationPending, navigationStarted } = await observation.finish(pageBefore);
  const delta = pageStateDelta(dispatchPage, pageAfter);
  return {
    pageDelta: { ...delta, navigationPending,
      navigated: delta.urlChanged || documentChanged === true
        || (navigationPending || navigationStarted === null ? null : documentChanged ?? (navigationStarted ? null : false)) },
    observedNavigation: commitObservedPageNavigation({ pageBefore: dispatchPage, pageAfter, prepared, guardrails, toolName: "act_on_element", tabId }),
  };
}
const keyboard = createCdpKeyboard({ sendCdp, ToolExecutionError });
const touch = createCdpTouch({ ToolExecutionError });
// ===========================================================================
// Page content
// ===========================================================================

registerTool({
  name: "read_article",
  argumentValueAliases: { source: { selector: "target" } },
  argumentAliases: { selector: "target" },
  behavior: { parallelRead: true, timeoutResult: { kind: "read", pending: "article extraction" } },
  get description() { return toolT("readArticleDescription"); },
  get parameters() { return {
    type: "object",
    properties: {
      tabRef: { type: ["integer", "string"], description: toolT("readArticleTabId") },
      source: { type: "string", enum: ["auto", "selection", "article", "target", "body"], description: toolT("readArticleSource") },
      target: { type: "string", description: toolT("readArticleSelector") },
      offset: { type: "number", description: toolT("readArticleOffset") },
      limit: { type: "number", description: toolT("readArticleLimit") },
    },
    required: ["limit", "tabRef"],
  } as const; },
  page: "readOnly",
  timeout: { defaultMs: 30000, maxMs: 300000 },
  validateArgs: args => {
    if (args.source === "target") requireToolFields("read_article", args, ["target"], { requiredWhen: "source=target" });
  },
  execute: async ({ tabId, source = "auto", target: selector = "", offset = 0, limit }, _signal, context = {}) => {
    const target = selector ? await resolveSelectorTarget(tabId, selector, 0, context) : { tabId, selector };
    const mode = source === "target" || (source === "auto" && selector) ? "selector" : source;
    return readBound(target, context, async call => {
      const article = await sendToContent(target.tabId, "readArticle", { source: mode, selector: target.selector, offset, limit }, call, context);
      if (article.error) return { ...toolError(String(article.code || "ARTICLE_READ_FAILED"), String(article.error), {
        hint: "Use find_elements to refresh the target, then retry read_article.", details: 'target' in target ? { target: target.target } : undefined,
      }) };
      const { _display, ...content } = article;
      return bindToolResultPresentation(mode === 'selector' && 'target' in target ? { ...content, target: target.target } : content, { _display });
    });
  },
});

registerTool({
  name: "read_dom",
  argumentAliases: { selector: "target" },
  behavior: { timeoutResult: { kind: "read", pending: "DOM extraction" } },
  get description() { return toolT("readDomDescription"); },
  get parameters() { return {
    type: "object",
    properties: {
      tabRef: { type: ["integer", "string"], description: toolT("readArticleTabId") },
      offset: { type: "number", description: toolT("readDomOffset") },
      limit: { type: "number", description: toolT("readDomLimit") },
      target: { type: "string", description: toolT("readDomSelector") },
    },
    required: ["tabRef"],
  } as const; },
  page: "readOnly",
  timeout: { defaultMs: 30000, maxMs: 300000 },
  execute: async ({ tabId, offset = 1, limit = 200, target: selector = "body" }, _signal, context = {}) => {
    const target = await resolveSelectorTarget(tabId, selector, 0, context);
    return readBound(target, context, async call => {
      const result = await sendToContent(target.tabId, "readDom", { offset, limit, selector: scopedSelector(target) }, call, context);
      if (result.error) return { ...toolError(String(result.code || "DOM_READ_FAILED"), String(result.error), {
        hint: "Use find_elements to refresh the target, then retry read_dom.", details: { target: target.target },
      }) };
      return { ...result, target: target.target };
    });
  },
});

registerTool({
  name: "find_elements",
  argumentAliases: { selector: "target" },
  behavior: { parallelRead: true, timeoutResult: { kind: "read", pending: "element scan" } },
  get description() { return toolT("findElementsDescription"); },
  get parameters() { return {
    type: "object",
    properties: {
      tabRef: { type: ["integer", "string"], description: toolT("readArticleTabId") },
      pattern: { type: "string", description: toolT("findElementsPattern") },
      flags: { type: "string", description: toolT("findElementsFlags") },
      target: { type: "string", description: toolT("findElementsSelector") },
      roles: { type: "array", items: { type: "string" }, description: toolT("findElementsRoles") },
      tags: { type: "array", items: { type: "string" }, description: toolT("findElementsTags") },
      types: { type: "array", items: { type: "string" }, description: toolT("findElementsTypes") },
      limit: { type: "number", description: toolT("findElementsLimit") },
      includeHidden: { type: "boolean", description: toolT("findElementsIncludeHidden") },
    },
    required: ["tabRef"],
  } as const; },
  page: "readOnly",
  timeout: { defaultMs: 30000, maxMs: 300000 },
  execute: async ({ tabId, pattern = "", flags = "i", target: selector = "body", roles = [], tags = [], types = [], limit = 20, includeHidden = false }, _signal, context = {}) => {
    const target = await resolveSelectorTarget(tabId, selector, 0, context);
    const result = await readBound(target, context, call => sendToContent(target.tabId, "findElements", {
      pattern, flags, selector: scopedSelector(target), roles, tags, types, limit, includeHidden,
    }, call, context));
    return addElementTargetsToFindResult(result, target.tabId, context, target.ref);
  },
});

registerTool({
  name: "inspect_element",
  argumentAliases: { selector: "target" },
  behavior: { timeoutResult: { kind: "read", pending: "element inspection" } },
  get description() { return toolT("inspectElementDescription", { targetGrammar: ELEMENT_TARGET_GRAMMAR }); },
  get parameters() { return {
    type: "object",
    properties: {
      tabRef: { type: ["integer", "string"], description: toolT("readArticleTabId") },
      target: { type: "string", description: getElementTargetDescription() },
      index: { type: "number", description: toolT("inspectElementIndex") },
    },
    required: ["target", "tabRef"],
  } as const; },
  page: "readOnly",
  timeout: { defaultMs: 30000, maxMs: 300000 },
  execute: async ({ tabId, target = "", index = 0 }, _signal, context = {}) => {
    const ref = await resolveElementReference(tabId, { target, index }, context);
    return readBound(ref, context, async call => {
      const inspection = await sendToContent(ref.tabId, "inspectElement", { selector: ref.selector, index: ref.index }, call, context);
      const frameId = String(ref.ref?.frameId || "");
      if (frameId && ref.tabId && !inspection.error) {
        try {
          await withDebugger(ref.tabId, async (_target, send) => {
            applyFramePageViewport(inspection, await frameContentOrigin(send, frameId), await readPageViewport(send));
          }, context);
        } catch (error) {
          if (isCdpFallbackForbiddenError(error)) throw error;
        }
      }
      const result = await addElementTargetsToFindResult({ ...inspection, selector: inspection?.selector || ref.selector }, ref.tabId, context, ref.ref);
      return result;
    });
  },
});

// ===========================================================================
// Page interaction
// ===========================================================================

registerTool({
  name: "act_on_element",
  argumentAliases: { selector: "target" },
  behavior: { parallelTab: true, timeoutResult: { kind: "action", pending: "action outcome confirmation" }, mayUnloadPage: args => {
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
      tabRef: { type: ["integer", "string"], description: toolT("readArticleTabId") },
      target: { type: "string", description: getElementTargetDescription() },
      index: { type: "number", description: toolT("inspectElementIndex") },
      action: { type: "string", enum: ["click", "fill", "press", "select", "check", "uncheck", "scroll"] },
      value: { type: "string", description: toolT("actOnElementValue") },
      key: { type: "string", description: toolT("actOnElementKey") },
      submit: { type: "boolean", description: toolT("actOnElementSubmit") },
    },
    required: ["target", "action", "tabRef"],
  } as const; },
  page: "owned",
  timeout: args => String(args.action || "").trim().toLowerCase() === "click" ? { defaultMs: 1800000, maxMs: 7200000 } : { defaultMs: 20000, maxMs: 120000 },
  execute: async ({ tabId, target = "", index = 0, action, value = "", key = "", submit = false }, _signal, context = {}) => {
    const normalizedAction = String(action || "").trim().toLowerCase();
    const allowed = new Set(["click", "fill", "press", "select", "check", "uncheck", "scroll"]);
    if (!allowed.has(normalizedAction)) {
      return { ...toolError("UNSUPPORTED_ELEMENT_ACTION", `Unsupported act_on_element action: ${action}`, {
        hint: "Use click, fill, press, select, check, uncheck, or scroll.", details: { target },
      }) };
    }

    const ref = await resolveElementReference(tabId, { target, index }, context);
    const selector = ref.selector;
    index = ref.index;
    let resolvedTarget = ref.target || elementTargetForSelector(selector);
    if (!ref.tabId) throw new ToolExecutionError("TAB_REF_REQUIRED", "Pass tabRef for the page containing the element.", { target: resolvedTarget });
    tabId = ref.tabId;
    const toolArgsForUpdates = { tabId, target, index, action, value, key, submit };
    let bound: ((action: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>) | undefined;
    let observedElement: ElementObservation | undefined;
    let observedSelector = '';
    const actionElement = (candidate: unknown): ElementObservation | undefined => {
      if (!isElementReply(candidate)) return undefined;
      const handle = !candidate.selector || candidate.selector === observedSelector
        ? observedElement?.target || resolvedTarget : elementTargetForSelector(candidate.selector);
      return createElementObservation(candidate, handle);
    };
    const contentOutcome = (reply: ElementReply) => ({
      action: normalizedAction, target: resolvedTarget,
      clicked: reply.clicked, filled: reply.filled,
      submitted: reply.submitted, checked: reply.checked, selected: reply.selected, pressed: reply.pressed,
      key: reply.key, href: reply.href, navigated: reply.navigated, scrolledTo: reply.scrolledTo,
      element: actionElement(reply.element), originalElement: actionElement(reply.originalElement),
    });
    const fillToken = normalizedAction === "fill" && ref.uid
      ? `${ref.uid}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}` : "";
    if (ref.uid) {
      return useElement(tabId, ref, context, async call => {
        bound = (actionName, params = {}) => call(actionName, normalizedAction === "fill" ? { ...params, editingHost: true, fillToken } : params);
        try {
          return await perform();
        } finally {
          if (fillToken && Number(ref.ref?.backendNodeId || 0) > 0) {
            try { await call("releaseFillRoot", { fillToken }); }
            catch { /* A missed release must not change the fill result. */ }
          }
          bound = undefined;
        }
      });
    }
    return perform();
    async function perform() {
    const frameId = String(ref.ref?.frameId || "");

    const inspected = await sendToContent(tabId, "inspectElement", { selector, index }, bound, context);
    if (inspected.error) return withElementActionHelp(inspected, normalizedAction, resolvedTarget);
    // Bind the observed node before the action can navigate or replace it. Never rebind
    // an action's old summary against a new document after the side effect.
    if (inspected._elementRef) {
      const described = await addElementTargetsToFindResult(inspected, tabId, context, ref.ref);
      if (described && typeof described === 'object') observedElement = described as ElementObservation;
    } else observedElement = createElementObservation(inspected, resolvedTarget);
    observedSelector = String(inspected.selector || '');
    resolvedTarget = observedElement?.target || resolvedTarget;

    if (normalizedAction === "click") {
      const pageBefore = await getTabPageState(tabId);
      const securityGuardrails = await getSecurityGuardrails();
      let current = inspected;
      let pointSelector = selector;
      let pointIndex = index;
      let resolved: ElementReply | null = null;

      if (!clickPointReady(current)) {
        const scrolled = await sendToContent(tabId, "scrollElementIntoView", { selector, index, block: "center" }, bound, context);
        if (scrolled.error) return withElementActionHelp(scrolled, normalizedAction, resolvedTarget);
        current = scrolled;
      }

      if (!clickPointReady(current)) {
        resolved = await sendToContent(tabId, "resolveClickTarget", { selector, index }, bound, context);
        if (resolved.error) return withElementActionHelp(resolved, normalizedAction, resolvedTarget);
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
          const observation = await beginPageNavigationObservation(tabId, _signal);
          try {
            await chrome.tabs.update(tabId, { url: navigationUrl });
            const { pageDelta, observedNavigation } = await observeElementNavigation(tabId, pageBefore, preparedNavigation, securityGuardrails, observation);
            return {
              action: "click",
              target: resolvedTarget,
              index,
              clickDispatched: false,
              method: "href_navigation",
              href: navigationUrl,
              ...pageDelta,
              ...(observedNavigation ? { observedNavigation } : {}),
              element: actionElement(resolved.element || current),
              originalElement: actionElement(inspected),
            };
          } finally { observation.dispose(); }
        }
        if (resolved.resolvedSelector) {
          const resolvedInspection = await sendToContent(tabId, "scrollElementIntoView", {
            selector: resolved.resolvedSelector,
            index: 0,
            block: "center",
          }, undefined, context);
          if (!resolvedInspection.error) {
            current = resolvedInspection;
            pointSelector = resolved.resolvedSelector;
            pointIndex = 0;
          }
        } else if (resolved.clickablePoint) {
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
      let observation: Awaited<ReturnType<typeof beginPageNavigationObservation>> | undefined;
      let touchInput = false;
      let receiptId = "";
      let dispatched = false;
      let frameFailure: ElementReply | null = null;
      let frameViewportBlocked = false;
      let movedFrameIntoPage = false;
      try {
        await withDebugger(tabId, async (_target, send) => {
          await ensurePageSurface(tabId, send, { frameId });
          const sameTarget = pointSelector === selector && pointIndex === index;
          const refreshed = await sendToContent(tabId, "inspectElement", { selector: pointSelector, index: pointIndex }, sameTarget ? bound : undefined, context);
          if (!refreshed.error && clickPointReady(refreshed)) current = refreshed;
          if (frameId) {
            const readGeometry = async () => ({
              origin: await frameContentOrigin(send, frameId),
              viewport: await readPageViewport(send),
            });
            let geometry = await readGeometry();
            // The pre-scroll inspection stays on originalElement when the page has to move.
            applyFramePageViewport(inspected, geometry.origin, geometry.viewport);
            applyFramePageViewport(current, geometry.origin, geometry.viewport);
            if (framePointMissesPage(current, geometry.origin, geometry.viewport)) {
              const scrolled = await sendToContent(tabId, "scrollElementIntoView", { selector: pointSelector, index: pointIndex, block: "center" }, bound, context);
              if (scrolled.error) { frameFailure = scrolled; return; }
              current = scrolled;
              movedFrameIntoPage = true;
              geometry = await readGeometry();
              applyFramePageViewport(current, geometry.origin, geometry.viewport);
            }
            if (framePointMissesPage(current, geometry.origin, geometry.viewport)) {
              frameViewportBlocked = true;
              return;
            }
          }
          if (!clickPointReady(current)) return;
          // The preparatory capture can run while this frame is still outside the page viewport.
          if (movedFrameIntoPage) await ensurePageSurface(tabId, send, { frameId });
          const point = await framedPagePoint(send, current.clickablePoint, frameId);
          if (frameId) {
            const viewport = await readPageViewport(send);
            if (viewport && !pointInPageViewport(point, viewport)) {
              current.inViewport = false;
              current.state = { ...(current.state || {}), inViewport: false, clickablePointInViewport: false };
              frameViewportBlocked = true;
              return;
            }
          }
          const localPoint = current.clickablePoint;
          const remoteSend = movedFrameIntoPage && localPoint ? await remoteFrameInput(send, frameId) : null;
          const dispatchSend = remoteSend || send;
          const dispatchPoint = remoteSend && localPoint ? localPoint : point;
          touchInput = getPageContext(tabId).pageMode === "mobile";
          receiptId = await armPageInputReceipt(tabId, { observeSubmission: true });
          observation = await beginPageNavigationObservation(tabId, _signal);
          if (_signal?.aborted) throw new ToolExecutionError("OPERATION_ABORTED", t("elementActionCancelled"), { target: resolvedTarget });
          dispatched = true;
          if (touchInput) { await touch(dispatchSend, dispatchPoint, { signal: _signal }); }
          else {
            await dispatchSend("Input.dispatchMouseEvent", {
              type: "mousePressed", x: dispatchPoint.x, y: dispatchPoint.y, button: "left", clickCount: 1,
            });
            await dispatchSend("Input.dispatchMouseEvent", {
              type: "mouseReleased", x: dispatchPoint.x, y: dispatchPoint.y, button: "left", clickCount: 1,
            });
          }
        }, context);
        if (frameFailure) return withElementActionHelp(frameFailure, normalizedAction, resolvedTarget);
        if (frameViewportBlocked || !clickPointReady(current)) {
          return clickNotReadyResult({
            target: resolvedTarget,
            selector,
            index,
            inspection: current,
            originalInspection: inspected,
            resolved,
          });
        }
        // Default actions can submit or navigate even when an earlier page listener
        // hid every pointer event. Keep the receipt alive through this bounded observation.
        const { pageDelta, observedNavigation } = await observeElementNavigation(tabId, pageBefore, preparedNavigation, securityGuardrails, observation!);
        const receipt = receiptId ? await readPageInputReceipt(tabId, receiptId) : null;
        receiptId = "";
        if (_signal?.aborted) throw new ToolExecutionError("OPERATION_ABORTED", t("elementActionCancelled"), { target: resolvedTarget });
        if (!pageInputDelivered({ receipt, committed: pageDelta.navigated === true })) {
          return inputNotDelivered({ action: "click", target: resolvedTarget, index });
        }
        return {
          action: "click",
          target: resolvedTarget,
          index,
          clickDispatched: true,
          inputDelivered: true,
          method: pointSelector !== selector ? "cdp_resolved" : "cdp",
          href: current.href || resolved?.href || undefined,
          ...pageDelta,
          ...(observedNavigation ? { observedNavigation } : {}),
          element: actionElement(current),
          originalElement: current !== inspected ? actionElement(inspected) : undefined,
        };
      } catch (err) {
        rethrowStaleElement(err);
        if (_signal?.aborted) throw new ToolExecutionError("OPERATION_ABORTED", t("elementActionCancelled"), { target: resolvedTarget });
        if (frameId || dispatched || touchInput || isCdpFallbackForbiddenError(err)) throw err;
        observation ??= await beginPageNavigationObservation(tabId, _signal);
        const fallback = await sendToContent(tabId, "actOnElement", { selector, index, elementAction: normalizedAction, value, key, submit }, bound, context);
      if (fallback.error) return withElementActionHelp(fallback, normalizedAction, resolvedTarget);
        const { pageDelta, observedNavigation } = await observeElementNavigation(tabId, pageBefore, preparedNavigation, securityGuardrails, observation);
        return {
          ...contentOutcome(fallback),
          index,
          clickDispatched: fallback.error ? false : Boolean(fallback.clicked || fallback.navigated),
          method: fallback.error ? "content_failed" : "content_fallback",
          cdpError: err instanceof Error ? err.message : String(err),
          ...pageDelta,
          ...(observedNavigation ? { observedNavigation } : {}),
        };
      } finally {
        observation?.dispose();
        if (receiptId) await readPageInputReceipt(tabId, receiptId);
      }
    }

    const identity = { action: normalizedAction, target: resolvedTarget, index };
    const assertActive = () => {
      if (_signal?.aborted) throw new ToolExecutionError("OPERATION_ABORTED", t("elementActionCancelled"), identity);
    };
    if (normalizedAction === "fill") {
      assertActive();
      const pageBefore = submit ? await getTabPageState(tabId) : null;
      const guardrails = submit ? await getSecurityGuardrails() : null;
      return withDebugger(tabId, async (_target, send): Promise<Record<string, unknown>> => {
        assertActive();
        // Hidden Chrome tabs may accept insertText without a composited keyboard
        // input surface. Prepare it without activating the tab or clicking the field.
        if (submit) await ensurePageSurface(tabId, send, { frameId });
        const prepared = await sendToContent(tabId, "prepareElementFill", { selector, index, value,
          ...(submit ? { submit } : {}) }, bound, context);
        assertActive();
        if (prepared.error) return withElementActionHelp(prepared, normalizedAction, resolvedTarget);
        // Preparation may resolve an inherited contenteditable child to its editing host.
        const field = prepared.selector ? { selector: prepared.selector, index: 0 } : { selector, index };
        const textInput = prepared.fillMode === "text";
        const inputKeyboard = createCdpKeyboard({ ToolExecutionError, sendCdp: (_tabId, method, params) => {
          if (params.type !== "keyUp") assertActive();
          return send(method, params);
        } });
        let fill: unknown;
        if (textInput) {
          assertActive();
          if (value) await send("Input.insertText", { text: value });
          else await inputKeyboard.press(tabId, "Backspace", context);
          assertActive();
        } else {
          // Rich-text paragraphs and non-keyboard fields retain their specialized writer.
          const result = await sendToContent(tabId, "actOnElement", { ...field, elementAction: "fill", value, submit: false }, bound, context);
          if (result.error) return withElementActionHelp(result, normalizedAction, resolvedTarget);
          fill = result.fill;
        }
        const observation = submit ? await beginPageNavigationObservation(tabId, _signal) : null;
        try {
          assertActive();
          const actual = await sendToContent(tabId, "readElementActionState", field, bound, context);
          assertActive();
          if (actual.error) return withElementActionHelp(actual, normalizedAction, resolvedTarget);
          // Chromium uses NBSP to preserve boundary spaces in contenteditable text.
          const equivalentText = (text: string) => prepared.contentEditable ? text.replace(/\u00a0/g, " ") : text;
          const valueMatches = !textInput || (typeof actual.value === "string"
            && equivalentText(actual.value) === equivalentText(value.replace(/\r\n?/g, "\n")));
          if (!valueMatches) return { ...toolError("ELEMENT_VALUE_MISMATCH", t("elementValueMismatch"), {
            hint: "Inspect the target and verify its current value before retrying.", details: { ...identity, value: actual.value, submitDispatched: false },
          }) };
          if (submit) {
            if (!actual.focused) return { ...toolError("ELEMENT_FOCUS_FAILED", t("elementFocusLost"), {
              hint: "Inspect the target and restore focus before submitting.", details: { ...identity, filled: true, value: actual.value, submitDispatched: false },
            }) };
            // Enter preserves page key handlers and native form validation. Never replay after a CDP failure.
            await inputKeyboard.press(tabId, "Enter", context);
            assertActive();
          }
          const navigation = pageBefore && guardrails && observation
            ? await observeElementNavigation(tabId, pageBefore, null, guardrails, observation) : null;
          assertActive();
          return { ...identity, filled: true, value: actual.value, fill, submitDispatched: submit,
            method: textInput ? "cdp" : "content", element: actionElement(actual),
            ...(navigation ? { ...navigation.pageDelta,
              ...(navigation.observedNavigation ? { observedNavigation: navigation.observedNavigation } : {}) } : {}) };
        } finally { observation?.dispose(); }
      }, context);
    }

    if (normalizedAction === "check" || normalizedAction === "uncheck") {
      assertActive();
      const desired = normalizedAction === "check";
      if (inspected.tag !== "input" || !["checkbox", "radio"].includes(String(inspected.type))) {
        return { ...toolError("NOT_CHECKABLE_ELEMENT", t("elementNotCheckable"), { hint: "Use find_elements to choose a checkbox or radio target.", details: identity }) };
      }
      if (inspected.checked === desired) return { ...identity, checked: desired, changed: false, element: actionElement(inspected) };
      if (inspected.type === "radio" && !desired) {
        return { ...toolError("ELEMENT_CHECK_STATE_MISMATCH", t("radioCannotBeUnchecked"), { hint: "Select another radio option to change this group.", details: identity }) };
      }
      return withDebugger(tabId, async (_target, send): Promise<Record<string, unknown>> => {
        assertActive();
        await ensurePageSurface(tabId, send, { frameId });
        const current = await sendToContent(tabId, "resolveCheckTarget", { selector, index }, bound, context);
        assertActive();
        if (current.error) return withElementActionHelp(current, normalizedAction, resolvedTarget);
        if (current.tag !== "input" || current.type !== inspected.type) {
          return { ...toolError("NOT_CHECKABLE_ELEMENT", t("elementNotCheckable"), { hint: "Use find_elements to choose a checkbox or radio target.", details: identity }) };
        }
        if (current.checked === desired) return { ...identity, checked: desired, changed: false, element: actionElement(current) };
        const clickTarget = !current.disabled && isElementReply(current.element) ? current.element : current;
        if (!clickPointReady(clickTarget)) return clickNotReadyResult({ target: resolvedTarget, selector, index,
          inspection: clickTarget, originalInspection: current, resolved: null }) as Record<string, unknown>;
        const point = await framedPagePoint(send, clickTarget.clickablePoint, frameId);
        const receiptId = await armPageInputReceipt(tabId);
        let delivered = false;
        try {
          if (getPageContext(tabId).pageMode === "mobile") {
            await touch(send, point, { signal: _signal });
          } else {
            let released = false;
            try {
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
        } finally { delivered = await inputWasDelivered(tabId, receiptId); }
        assertActive();
        if (!delivered) return inputNotDelivered(identity);
        const actual = await sendToContent(tabId, "readElementActionState", { selector, index }, bound, context);
        assertActive();
        if (actual.error) return withElementActionHelp(actual, normalizedAction, resolvedTarget);
        if (actual.tag !== "input" || actual.type !== inspected.type || actual.checked !== desired) return { ...toolError("ELEMENT_CHECK_STATE_MISMATCH", t("elementCheckStateMismatch"), {
          hint: "Inspect the target’s checked state before retrying.", details: { ...identity, checked: actual.checked },
        }) };
        return { ...identity, checked: desired, changed: true, method: "cdp", inputDelivered: true, element: actionElement(actual) };
      }, context);
    }

    if (normalizedAction === "press") {
      const pressedKey = key || value;
      if (!pressedKey) return { ...toolError("MISSING_KEY", "key is required for press action", {
        hint: "Pass key, for example Enter, Escape, or Tab.", details: { target: resolvedTarget },
      }) };
      const preparedKey = keyboard.normalize(pressedKey);
      const observeNavigation = preparedKey.key === "Enter" && preparedKey.modifiers === 0;
      const pageBefore = observeNavigation ? await getTabPageState(tabId) : null;
      const guardrails = observeNavigation ? await getSecurityGuardrails() : null;
      let observation: Awaited<ReturnType<typeof beginPageNavigationObservation>> | undefined;
      const startObservation = async () => {
        observation ??= await beginPageNavigationObservation(tabId!, _signal);
        assertActive();
      };
      const finishPress = async (result: Record<string, unknown>) => {
        const navigation = pageBefore && guardrails && observation
          ? await observeElementNavigation(tabId!, pageBefore, null, guardrails, observation) : null;
        return { ...result,
          ...(navigation ? { ...navigation.pageDelta,
            ...(navigation.observedNavigation ? { observedNavigation: navigation.observedNavigation } : {}) } : {}) };
      };
      let dispatched = false;
      try {
        let delivered = !inspected.clickablePoint;
        await withDebugger(tabId, async (_target, send) => {
          if (inspected.clickablePoint) {
            await ensurePageSurface(tabId, send, { frameId });
            const refreshed = await sendToContent(tabId, "inspectElement", { selector, index }, bound, context);
            const localPoint = !refreshed.error && clickPointReady(refreshed) ? refreshed.clickablePoint : inspected.clickablePoint;
            if (!localPoint) return;
            const point = await framedPagePoint(send, localPoint, frameId);
            const receiptId = await armPageInputReceipt(tabId);
            try {
              if (observeNavigation) await startObservation();
              dispatched = true;
              await send("Input.dispatchMouseEvent", {
                type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1,
              });
              await send("Input.dispatchMouseEvent", {
                type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1,
              });
            } finally { delivered = await inputWasDelivered(tabId, receiptId); }
          }
          if (delivered) {
            if (observeNavigation) await startObservation();
            dispatched = true;
            const guardedKeyboard = createCdpKeyboard({ ToolExecutionError, sendCdp: (_id, method, params) => send(method, params) });
            await guardedKeyboard.press(tabId!, preparedKey, context);
          }
        }, context);
        if (!delivered) return inputNotDelivered({ action: "press", target: resolvedTarget, index, key: pressedKey });
        const result = { action: "press", target: resolvedTarget, index, key: pressedKey, pressed: true, method: "cdp", inputDelivered: true, element: actionElement(inspected) };
        return observeNavigation ? await finishPress(result) : result;
      } catch (err) {
        rethrowStaleElement(err);
        assertActive();
        if (dispatched || frameId || isCdpFallbackForbiddenError(err)) throw err;
        if (observeNavigation) await startObservation();
        const fallback = await sendToContent(tabId, "actOnElement", { selector, index, elementAction: "press", value, key: pressedKey, submit }, bound, context);
      if (fallback.error) return withElementActionHelp(fallback, normalizedAction, resolvedTarget);
        const result = { ...contentOutcome(fallback), index, method: fallback.error ? "content_failed" : "content_fallback", cdpError: err instanceof Error ? err.message : String(err), element: actionElement(fallback.element || inspected) };
        return observeNavigation ? await finishPress(result) : result;
      } finally { observation?.dispose(); }
    }

    const contentAction = async () => {
      const fallback = await sendToContent(tabId, "actOnElement", { selector, index, elementAction: normalizedAction, value, key, submit }, bound, context);
      if (fallback.error) return withElementActionHelp(fallback, normalizedAction, resolvedTarget);
      return {
        ...contentOutcome(fallback),
        index,
        method: fallback.error ? "content_failed" : "content",
        element: actionElement(fallback.element || inspected),
      };
    };
    return contentAction();
    }
  },
});

function withElementActionHelp(result: ElementReply, action: string, target: string) {
  return { ...toolError(String(result.code || "ELEMENT_ACTION_FAILED"), String(result.error || result.message || "Element action failed"), {
    hint: "Use find_elements to refresh targets, inspect_element to verify the target, then act_on_element with one of: click/fill/press/select/check/uncheck/scroll.",
    details: { target, action },
  }) };
}

registerTool({
  name: "scroll_page",
  argumentAliases: { selector: "target" },
  behavior: { timeoutResult: { kind: "action", pending: "scroll outcome confirmation" } },
  get description() { return toolT("scrollPageDescription"); },
  get parameters() { return {
    type: "object",
    properties: {
      tabRef: { type: ["integer", "string"] },
      direction: { type: "string", enum: ["up", "down", "top", "bottom"] },
      pixels: { type: "number", description: toolT("scrollPagePixels") },
      target: { type: "string", description: toolT("scrollPageTarget", { targetDescription: getElementTargetDescription() }) },
      index: { type: "number", description: toolT("scrollPageIndex") },
    },
    required: ["tabRef"],
  } as const; },
  page: "owned",
  timeout: { defaultMs: 20000, maxMs: 120000 },
  execute: async ({ tabId, direction = "down", pixels = 500, target = "", index = 0 }, _signal, context = {}) => {
    const ref = String(target || "").trim() ? await resolveElementReference(tabId, { target, index }, context) : null;
    const scrolled = ref
      ? await readBound(ref, context, call => sendToContent(ref.tabId, "scrollPage", { direction, pixels, selector: ref.selector }, call, context))
      : await sendToContent(tabId, "scrollPage", { direction, pixels }, undefined, context);
    if (scrolled.error) return { ...toolError(String(scrolled.code || "SCROLL_FAILED"), String(scrolled.error), {
      hint: "Use find_elements to refresh the target, then retry scroll_page.", details: ref ? { target: ref.target } : undefined,
    }) };
    return ref ? { ...scrolled, target: ref.target, index: ref.index } : scrolled;
  },
});


}


export default ((host) => { registerPageElementTools({ ...host, ...host.element }); }) satisfies ToolExtension;
