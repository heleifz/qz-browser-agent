import type { ToolContext, ToolErrorConstructor } from '../../sdk/background.js';
import type { GetToolRuntimeDependencies } from '../../sdk/background/services.js';
import type { createCdpRuntime } from './cdp-runtime.js';
export interface ElementReference {
  uid?: string; selector?: string; tabId?: number; sessionId?: string; pageUrl?: string;
  index?: number; imageSrc?: string; imageIndex?: number; backendNodeId?: number; role?: string; name?: string; createdAt?: number;
  loaderId?: string; frameId?: string;
  [field: string]: unknown;
}
interface ElementBinding {
  tabId?: number; selector?: string; index?: number; target?: string; uid?: string; ref?: ElementReference;
}
interface ElementCallOptions { editingHost?: boolean; scope?: boolean }
type CdpSend = (method: string, params?: Record<string, unknown>) => Promise<unknown>;
type ElementCaller = (action: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;
const CONTENT_MARK = "direct-node";
const contextsByTab = new Map<number, Set<number>>();
function rememberExecutionContext(source: { tabId?: number } | undefined, method: string, params: unknown) {
  if (method !== "Runtime.executionContextCreated") return;
  const id = Number(record(record(params).context).id);
  if (!Number.isInteger(id) || id <= 0) return;
  const tabId = Number(source?.tabId);
  const key = Number.isInteger(tabId) && tabId > 0 ? tabId : 0;
  const found = contextsByTab.get(key) || new Set<number>();
  found.add(id);
  contextsByTab.set(key, found);
}
// Contexts are emitted when the debugger attaches. A listener added later never sees them.
chrome.debugger?.onEvent?.addListener((source, method, params) => rememberExecutionContext(source, method, params));
chrome.debugger?.onDetach?.addListener(source => {
  const tabId = Number(source?.tabId);
  if (Number.isInteger(tabId)) contextsByTab.delete(tabId);
});
interface ElementRuntimeHost {
  ToolExecutionError: ToolErrorConstructor;
  getToolRuntimeDependencies: GetToolRuntimeDependencies;
  makeSessionTabTargetError(code: string, details: Record<string, unknown>): Error;
  assertTabAllowed(tabId: number, details: Record<string, unknown>): Promise<unknown>;
  withDebugger: ReturnType<typeof createCdpRuntime>['withDebugger'];
}
import { isCdpFallbackForbiddenError } from "./cdp-runtime.js";
import { getEffectiveTabUrl } from "../../shared/tab-utils.js";
import { getLanguage } from "../../shared/i18n/index.js";
import { t } from "./messages.js";

/** Owns stable element references and page/tab/session validation. */
export function createElementRuntime({
  ToolExecutionError,
  getToolRuntimeDependencies,
  makeSessionTabTargetError,
  assertTabAllowed: assertTabAllowedBySecurityGuardrails,
  withDebugger,
}: ElementRuntimeHost) {
// ---------------------------------------------------------------------------
// Page snapshot element refs
// ---------------------------------------------------------------------------

const elementRefRegistry = new Map<string, ElementReference>();
const ELEMENT_REF_TTL_MS = 30 * 60 * 1000;
const ELEMENT_REF_MAX = 5000;
const ELEMENT_TARGET_GRAMMAR = 'target = "uid:" <element_uid> | "css:" <css_selector>';
function getElementTargetExamples() {
return [
  "uid:t1887138561_ax_42",
  "uid:t1887138561_a7",
  `css:button[aria-label="${t("nextPageSelector")}"]`,
  'css:a[href*="page=2"]',
  'css:input[name="q"]',
  `css:textarea[placeholder*="${t("commentSelector")}"]`,
  'css:[data-testid="submit"]',
];
}
function getElementTargetDescription() {
return t("elementReference", {
  grammar: ELEMENT_TARGET_GRAMMAR,
  examples: getElementTargetExamples().join(getLanguage() === "zh-CN" ? "；" : "; "),
});

}

function makeSnapshotId(tabId: number) {
  return `t${tabId}_${Date.now().toString(36)}`;
}

function registerElementRef(ref: ElementReference) {
  if (!ref?.uid) return;
  cleanupElementRefs();
  elementRefRegistry.set(ref.uid, {
    ...ref,
    createdAt: Date.now(),
  });
}

function cleanupElementRefs() {
  const now = Date.now();
  for (const [uid, ref] of elementRefRegistry.entries()) {
    if (now - Number(ref.createdAt || 0) > ELEMENT_REF_TTL_MS) {
      elementRefRegistry.delete(uid);
    }
  }
  while (elementRefRegistry.size > ELEMENT_REF_MAX) {
    const first = elementRefRegistry.keys().next().value;
    if (!first) break;
    elementRefRegistry.delete(first);
  }
}

function elementTargetForUid(uid: unknown) {
  const value = normalizeElementUid(uid);
  return value ? `uid:${value}` : "";
}

function elementTargetForSelector(selector: unknown) {
  const value = String(selector || "").trim();
  return value ? `css:${value}` : "";
}

function elementTargetForRef(ref: ElementReference = {}) {
  return elementTargetForUid(ref.uid) || elementTargetForSelector(ref.selector);
}

function isElementTarget(value: unknown) {
  return /^(uid|css):/i.test(String(value || "").trim());
}

function isUidElementTarget(value: unknown) {
  return /^uid:/i.test(String(value || "").trim());
}

function parseElementTarget(target = "") {
  const raw = String(target || "").trim();
  if (!raw) return { uid: "", selector: "" };
  const separator = raw.indexOf(":");
  const kind = separator >= 0 ? raw.slice(0, separator).trim().toLowerCase() : "";
  const value = separator >= 0 ? raw.slice(separator + 1).trim() : "";
  if (kind === "uid" && value) return { uid: value, selector: "" };
  if (kind === "css" && value) return { uid: "", selector: value };
  throw new ToolExecutionError("INVALID_ELEMENT_TARGET", `Invalid element target: ${raw}`, {
    target: raw,
    expected: ELEMENT_TARGET_GRAMMAR,
    examples: getElementTargetExamples(),
  });
}

function addElementTargetsToFindResult(result: unknown) {
  if (!isRecord(result)) return result;
  const addTarget = (item: unknown) => {
    if (!isRecord(item)) return item;
    const target = item.target || elementTargetForUid(item.uid) || elementTargetForSelector(item.selector);
    return target ? { ...item, target } : item;
  };
  if (Array.isArray(result.results)) {
    return { ...result, results: result.results.map(addTarget) };
  }
  if (Array.isArray(result.elements)) {
    return { ...result, elements: result.elements.map(addTarget) };
  }
  return addTarget(result);
}

async function resolveSelectorTarget(tabId: number | undefined, selector = "", index?: number, context: ToolContext = {}) {
  const raw = String(selector || "").trim();
  if (!raw) return { tabId, selector: "" };
  if (!isElementTarget(raw)) return { tabId, selector: raw, index };
  const parsed = parseElementTarget(raw);
  if (parsed.selector) return { tabId, selector: parsed.selector, index };
  const ref = await resolveElementReference(tabId, { target: raw, index }, context);
  return { tabId: ref.tabId, selector: ref.selector, index: ref.index, target: ref.target, uid: ref.uid, ref: ref.ref };
}

async function resolveElementReference(tabId: number | undefined, { target = "", index }: { target?: string; index?: number } = {}, context: ToolContext = {}) {
  const normalized = parseElementTarget(target);
  const requestedUid = normalizeElementUid(normalized.uid);
  const requestedSelector = String(normalized.selector || "").trim();
  if (!requestedUid && !requestedSelector) {
    throw new ToolExecutionError("MISSING_ELEMENT_REFERENCE", "Element reference requires target: uid:<element_uid> or css:<css_selector>", {
      target,
      expected: ELEMENT_TARGET_GRAMMAR,
      examples: getElementTargetExamples(),
    });
  }

  if (!requestedUid) {
    return { tabId, selector: requestedSelector, index, target: elementTargetForSelector(requestedSelector) };
  }

  cleanupElementRefs();
  const ref = elementRefRegistry.get(requestedUid);
  if (!ref) {
    throw new ToolExecutionError(
      "STALE_ELEMENT_UID",
      `Element target is stale or unknown: uid:${requestedUid}. Take a fresh get_ax_tree snapshot, then retry with a new target.`,
      { target: elementTargetForUid(requestedUid) },
    );
  }

  const currentSessionId = String(context.sessionId || "").trim();
  const refSessionId = String(ref.sessionId || "").trim();
  if (currentSessionId && refSessionId && currentSessionId !== refSessionId) {
    throw new ToolExecutionError(
      "ELEMENT_UID_SESSION_MISMATCH",
      `Element target belongs to another session. Take a fresh get_ax_tree snapshot in this session, then retry.`,
      { target: elementTargetForUid(requestedUid), sessionId: currentSessionId, refSessionId },
    );
  }

  const resolvedTabId = Number(tabId || ref.tabId);
  if (!Number.isFinite(resolvedTabId) || resolvedTabId <= 0) {
    throw new ToolExecutionError("MISSING_TAB_ID", `Element target has no usable tabId: uid:${requestedUid}`, {
      target: elementTargetForUid(requestedUid),
      refTabId: ref.tabId,
    });
  }
  const sessions = getToolRuntimeDependencies(context).sessions;
  if (currentSessionId && typeof sessions?.resolveTargetTab === "function") {
    const resolved = await sessions.resolveTargetTab({
      sessionId: currentSessionId,
      tabId: resolvedTabId,
      source: "element_uid_reference",
    });
    if (!resolved?.ok) {
      throw makeSessionTabTargetError(resolved?.code || "SESSION_TAB_TARGET_DENIED", {
        toolName: "element_uid_reference",
        sessionId: currentSessionId,
        tabId: resolvedTabId,
        ownerSessionId: resolved?.ownerSessionId || "",
        reason: resolved?.reason || "",
        message: resolved?.error || "",
      });
    }
  }
  if (ref.pageUrl) {
    let currentUrl = "";
    try {
      const tab = await chrome.tabs.get(resolvedTabId);
      currentUrl = getEffectiveTabUrl(tab);
    } catch(_e) {
      currentUrl = "";
    }
    if (currentUrl && !samePageUrl(currentUrl, ref.pageUrl)) {
      throw new ToolExecutionError(
        "STALE_ELEMENT_UID_PAGE_CHANGED",
        `Element target belongs to a previous page state. Take a fresh get_ax_tree snapshot, then retry.`,
        { target: elementTargetForUid(requestedUid), tabId: resolvedTabId, currentUrl, snapshotUrl: ref.pageUrl },
      );
    }
  }
  if (tabId && Number(tabId) !== Number(ref.tabId)) {
    throw new ToolExecutionError("ELEMENT_UID_TAB_MISMATCH", `Element target belongs to tab ${ref.tabId}, not tab ${tabId}`, {
      target: elementTargetForUid(requestedUid),
      tabId,
      refTabId: ref.tabId,
    });
  }
  await assertTabAllowedBySecurityGuardrails(resolvedTabId, { tool: "element_target", source: "uid_target" });
  return {
    tabId: resolvedTabId,
    selector: "",
    index,
    uid: requestedUid,
    target: elementTargetForUid(requestedUid),
    ref,
  };
}

function normalizeElementUid(uid: unknown) {
  const value = String(uid || "").trim();
  if (!value) return "";
  if (elementRefRegistry.has(value)) return value;
  const match = value.match(/\bt\d+_[a-z0-9]+_\d+\b/i);
  return match ? match[0] : value;
}

async function backendNodeIdForSelector(tabId: number, selector: string, context: ToolContext = {}) {
  try {
    return await withDebugger(tabId, async (_target, send) => {
      const root = record(await send("DOM.getDocument", { depth: 0, pierce: true }));
      const documentNodeId = record(root.root).nodeId;
      if (!documentNodeId) return 0;
      const queried = record(await send("DOM.querySelector", { nodeId: documentNodeId, selector }));
      const nodeId = Number(queried?.nodeId || 0);
      if (!nodeId) return 0;
      const described = record(await send("DOM.describeNode", { nodeId }));
      const node = record(described.node);
      return Number(node.backendNodeId || node.backendDOMNodeId || 0);
    }, context);
  } catch(err) {
    if (isCdpFallbackForbiddenError(err)) throw err;
    return 0;
  }
}

/** Hand the original node to the existing content handler. Object ids live for this call only. */
async function callElement(tabId: number | undefined, binding: ElementBinding, action: string, params: Record<string, unknown> = {}, context: ToolContext = {}, options: ElementCallOptions = {}) {
  return withElement(tabId, binding, context, options, (_send, call) => call(action, params));
}

async function withElement<T>(tabId: number | undefined, binding: ElementBinding, context: ToolContext, options: ElementCallOptions, run: (send: CdpSend, call: ElementCaller) => Promise<T>): Promise<T> {
  const id = Number(binding.tabId || tabId);
  if (!Number.isInteger(id) || id <= 0) throw new ToolExecutionError("MISSING_TAB_ID", "Element target has no usable tabId", { target: binding.target || "" });
  return withDebugger(id, async (_target, send) => {
    await assertSameDocument(send, binding.ref);
    const held = new Set<string>();
    try {
      let objectId = binding.uid
        ? await objectFromBackend(id, send, binding)
        : await objectFromSelector(id, send, String(binding.selector || ""), binding.index, options.scope === true);
      if (objectId) held.add(objectId);
      if (options.editingHost && objectId) objectId = await adoptEditingHost(send, objectId, held);
      return await run(send, (action, params = {}) => invokeBound(send, objectId, action, params));
    } finally {
      for (const objectId of held) {
        try { await send("Runtime.releaseObject", { objectId }); } catch { /* The node may already be gone. */ }
      }
    }
  }, context);
}

async function assertSameDocument(send: CdpSend, ref?: ElementReference) {
  if (!ref?.loaderId && !ref?.frameId) return;
  const frame = record(record(record(await send("Page.getFrameTree")).frameTree).frame);
  const frameId = String(frame.id || "");
  const loaderId = String(frame.loaderId || "");
  if (ref.frameId && frameId && ref.frameId !== frameId) {
    throw new ToolExecutionError("ELEMENT_CONTEXT_UNSUPPORTED", t("elementContextUnsupported"), { frameId: ref.frameId });
  }
  if (ref.loaderId && loaderId && ref.loaderId !== loaderId) throw staleElement(ref.uid || "");
}

async function objectFromBackend(tabId: number, send: CdpSend, binding: ElementBinding) {
  const backendNodeId = Number(binding.ref?.backendNodeId || 0);
  if (!backendNodeId) throw staleElement(binding.target || "");
  const contextId = await contentContextId(tabId, send);
  try {
    const resolved = record(await send("DOM.resolveNode", { backendNodeId, executionContextId: contextId }));
    const objectId = String(record(resolved.object).objectId || "");
    if (!objectId) throw staleElement(binding.target || "");
    return objectId;
  } catch (err) {
    if (isCdpFallbackForbiddenError(err) || err instanceof ToolExecutionError) throw err;
    throw staleElement(binding.target || "");
  }
}

async function objectFromSelector(tabId: number, send: CdpSend, selector: string, index: number | undefined, scope: boolean) {
  if (!selector.trim()) throw new ToolExecutionError("MISSING_SELECTOR", "selector is required", { selector });
  const contextId = await contentContextId(tabId, send);
  const counted = record(await send("Runtime.evaluate", {
    contextId, returnByValue: true, expression: `globalThis.__qzCount(${JSON.stringify(selector)})`,
  }));
  const count = record(record(counted.result).value);
  if (count.error) throw new ToolExecutionError(String(count.code || "ELEMENT_NOT_FOUND"), String(count.error), { selector });
  const matched = Number(count.matched || 0);
  const chosen = Number.isInteger(index) && Number(index) >= 0 ? Number(index) : undefined;
  if (matched > 1 && chosen === undefined) {
    throw new ToolExecutionError("ELEMENT_INDEX_REQUIRED", t(scope ? "elementIndexRequiredScope" : "elementIndexRequired", { count: String(matched) }), { selector, matched });
  }
  if (!matched) throw new ToolExecutionError("ELEMENT_NOT_FOUND", `Element not found: ${selector}`, { selector, matched });
  const picked = record(await send("Runtime.evaluate", {
    contextId, returnByValue: false, expression: `globalThis.__qzNode(${JSON.stringify(selector)}, ${chosen ?? 0})`,
  }));
  const objectId = String(record(picked.result).objectId || "");
  if (!objectId) throw new ToolExecutionError("ELEMENT_NOT_FOUND", `Element not found: ${selector}[${chosen ?? 0}]`, { selector, index: chosen ?? 0, matched });
  return objectId;
}

async function contentContextId(tabId: number, send: CdpSend) {
  await send("Runtime.enable");
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const ids = new Set<number>([...(contextsByTab.get(tabId) || []), ...(contextsByTab.get(0) || [])]);
    for (const id of ids) {
      let probed: Record<string, unknown> = {};
      try {
        probed = record(await send("Runtime.evaluate", { contextId: id, expression: "globalThis.__qzContentBuild", returnByValue: true }));
      } catch (err) {
        if (isCdpFallbackForbiddenError(err)) throw err;
        continue;
      }
      if (String(record(probed.result).value || "").includes(CONTENT_MARK)) return id;
    }
    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new ToolExecutionError("CONTENT_SCRIPT_UNAVAILABLE", t("contentScriptUnavailable"), { tabId });
}

async function adoptEditingHost(send: CdpSend, objectId: string, held: Set<string>) {
  const remote = record(await send("Runtime.callFunctionOn", {
    objectId, returnByValue: false, functionDeclaration: "function(){return globalThis.__qzEditingHost(this)}",
  }));
  const next = String(record(remote.result).objectId || "");
  if (!next) return objectId;
  held.add(next);
  return next;
}

async function invokeBound(send: CdpSend, objectId: string, action: string, params: Record<string, unknown>) {
  const remote = record(await send("Runtime.callFunctionOn", {
    objectId, awaitPromise: true, returnByValue: true,
    functionDeclaration: "function(payload){return globalThis.__qzInvoke(this,payload)}",
    arguments: [{ value: { ...params, action, index: 0 } }],
  }));
  const details = record(remote.exceptionDetails);
  if (details.text || details.exception) {
    throw new ToolExecutionError("CONTENT_SCRIPT_UNAVAILABLE", t("contentScriptUnavailable"), { action, message: String(details.text || "") });
  }
  return record(record(remote.result).value);
}

function staleElement(target: unknown) {
  return new ToolExecutionError(
    "STALE_ELEMENT_UID",
    "Element target is stale or unknown. The document changed or the node is gone. Take a fresh get_ax_tree snapshot, then retry.",
    { target },
  );
}

function samePageUrl(a: unknown, b: unknown) {
  const left = String(a || "").split("#")[0];
  const right = String(b || "").split("#")[0];
  return !!left && !!right && left === right;
}


  return Object.freeze({
    elementTargetGrammar: ELEMENT_TARGET_GRAMMAR,
    getElementTargetDescription,
    makeSnapshotId,
    registerElementRef,
    elementTargetForUid,
    elementTargetForSelector,
    elementTargetForRef,
    isUidElementTarget,
    resolveSelectorTarget,
    resolveElementReference,
    addElementTargetsToFindResult,
    backendNodeIdForSelector,
    callElement,
    withElement,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function record(value: unknown): Record<string, unknown> { return isRecord(value) ? value : {}; }
