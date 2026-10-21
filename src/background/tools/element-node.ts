import type { ToolContext, ToolErrorConstructor } from "../../sdk/background.js";
import type { CdpCommand, ElementTarget } from "../../sdk/background/browser.js";
import { elementPageFunction } from "./page-scripts.js";
import { isCdpFallbackForbiddenError } from "./cdp-runtime.js";

type Send = CdpCommand;
type ToolError = ToolErrorConstructor;

export interface NodeBinding {
  tabId?: number;
  target?: string;
  uid?: string;
  index?: number;
  selector?: string;
  backendNodeId?: number;
  loaderId?: string;
  frameId?: string;
}

export interface NodeSession {
  send: Send;
  objectId: string;
  backendNodeId?: number;
  call(request: Record<string, unknown>, hitObjectId?: string): Promise<Record<string, unknown>>;
}

interface NodeHost {
  ToolExecutionError: ToolError;
  withDebugger: (tabId: unknown, fn: (target: chrome.debugger.Debuggee, send: Send) => Promise<unknown>, context?: ToolContext) => Promise<unknown>;
}

const STALE = "Take a fresh get_ax_tree snapshot, then retry with a new target.";

export function bindingFromTarget(target: ElementTarget): NodeBinding {
  const stored = target.ref || {};
  const backendNodeId = Number(stored.backendNodeId || 0) || undefined;
  return {
    tabId: target.tabId,
    target: target.target,
    uid: target.uid,
    index: target.index || 0,
    // A UID that already names a backend node must not be operated through a cached selector.
    selector: backendNodeId ? "" : String(target.selector || stored.selector || ""),
    backendNodeId,
    loaderId: stored.loaderId ? String(stored.loaderId) : "",
    frameId: stored.frameId ? String(stored.frameId) : "",
  };
}

/** Resolve one DOM node for this operation, run `fn`, then release the CDP object. */
export async function withBoundElement<T>(
  host: NodeHost,
  binding: NodeBinding,
  context: ToolContext,
  fn: (session: NodeSession) => Promise<T>,
): Promise<T> {
  const tabId = Number(binding.tabId || 0);
  if (!tabId) throw new host.ToolExecutionError("MISSING_TAB_ID", "Element action requires a tab", { target: binding.target });
  return host.withDebugger(tabId, async (_target, send) => {
    if (binding.frameId) {
      throw new host.ToolExecutionError("FRAME_CONTENT_READONLY", "This target is inside an iframe and cannot be used with act_on_element or inspect_element. Take a fresh get_ax_tree snapshot to read it, or open its url.", {
        target: binding.target,
        frameId: binding.frameId,
      });
    }
    if (binding.loaderId) {
      const loaderId = await mainLoaderId(send);
      if (loaderId && loaderId !== binding.loaderId) {
        throw new host.ToolExecutionError("STALE_ELEMENT_UID", `Element target belongs to a previous document. ${STALE}`, {
          target: binding.target,
          reason: "document-changed",
        });
      }
    }
    const objectId = binding.backendNodeId
      ? await objectForBackendNode(host.ToolExecutionError, send, binding)
      : await objectForSelector(host.ToolExecutionError, send, binding);
    try {
      const session: NodeSession = {
        send,
        objectId,
        backendNodeId: binding.backendNodeId,
        call: (request, hitObjectId) => callNode(send, objectId, request, hitObjectId),
      };
      const probed = await session.call({ action: "inspect" });
      if (probed.inFrame === true) {
        throw new host.ToolExecutionError("FRAME_CONTENT_READONLY", "This target is inside an iframe and cannot be used with act_on_element or inspect_element. Take a fresh get_ax_tree snapshot to read it, or open its url.", {
          target: binding.target,
        });
      }
      if (probed.missing === true) {
        throw new host.ToolExecutionError("STALE_ELEMENT_UID", `Element node is no longer connected. ${STALE}`, {
          target: binding.target,
          reason: "node-replaced",
        });
      }
      return await fn(session);
    } finally {
      await send("Runtime.releaseObject", { objectId }).catch(() => {});
    }
  }, context) as Promise<T>;
}

async function objectForBackendNode(ToolExecutionError: ToolError, send: Send, binding: NodeBinding): Promise<string> {
  try {
    const resolved = record(await send("DOM.resolveNode", { backendNodeId: binding.backendNodeId }));
    const objectId = String(record(resolved.object).objectId || "");
    if (!objectId) throw new Error("resolveNode returned no object");
    return objectId;
  } catch (error) {
    if (isCdpFallbackForbiddenError(error)) throw error;
    throw new ToolExecutionError("STALE_ELEMENT_UID", `Element node was replaced or no longer exists. ${STALE}`, {
      target: binding.target,
      reason: "node-replaced",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function objectForSelector(ToolExecutionError: ToolError, send: Send, binding: NodeBinding): Promise<string> {
  const selector = String(binding.selector || "");
  const index = Math.max(0, Math.floor(Number(binding.index) || 0));
  if (!selector) {
    throw new ToolExecutionError("UID_SELECTOR_UNAVAILABLE", `Element target cannot be resolved: ${binding.target || ""}. ${STALE}`, {
      target: binding.target,
    });
  }
  if (selector.startsWith("shadow:")) {
    throw new ToolExecutionError("SHADOW_PATH_UNSUPPORTED", "A shadow path is not an operation target. Use the uid from get_ax_tree.", {
      target: binding.target,
      selector,
    });
  }
  let described: Record<string, unknown>;
  try {
    const preview = record(await send("Runtime.evaluate", {
      expression: `(() => { const selector = ${JSON.stringify(selector)}; const index = ${index}; let nodes; try { nodes = document.querySelectorAll(selector); } catch (error) { return { error: "INVALID_SELECTOR", message: String(error && error.message || error) }; } return { matched: nodes.length, found: index < nodes.length }; })()`,
      returnByValue: true,
    }));
    described = record(record(preview.result).value);
  } catch (error) {
    if (isCdpFallbackForbiddenError(error)) throw error;
    throw new ToolExecutionError("INVALID_SELECTOR", error instanceof Error ? error.message : String(error), { selector });
  }
  if (described.error) {
    throw new ToolExecutionError(String(described.error), String(described.message || "CSS query failed"), {
      selector,
      index,
    });
  }
  if (!described.found) {
    throw new ToolExecutionError("ELEMENT_NOT_FOUND", `Element not found at selector/index: ${selector}[${index}]`, {
      selector,
      index,
      matched: described.matched,
    });
  }
  const picked = record(await send("Runtime.evaluate", {
    expression: `document.querySelectorAll(${JSON.stringify(selector)})[${index}]`,
    returnByValue: false,
  }));
  const objectId = String(record(picked.result).objectId || "");
  if (!objectId) {
    throw new ToolExecutionError("ELEMENT_NOT_FOUND", `Element not found at selector/index: ${selector}[${index}]`, { selector, index });
  }
  return objectId;
}

export async function callNode(send: Send, objectId: string, request: Record<string, unknown>, hitObjectId?: string): Promise<Record<string, unknown>> {
  const evaluated = record(await send("Runtime.callFunctionOn", {
    objectId,
    returnByValue: true,
    awaitPromise: true,
    functionDeclaration: elementPageFunction("act"),
    arguments: [{ value: request }, ...(hitObjectId ? [{ objectId: hitObjectId }] : [])],
  }));
  return record(record(evaluated.result).value);
}

/** True when the viewport element at this point is the bound node, a descendant, or its label. */
export async function hitBelongsToNode(send: Send, objectId: string, point: { x: number; y: number }): Promise<boolean> {
  let hitObjectId = "";
  try {
    await send("DOM.getDocument", { depth: 0 }).catch(() => {});
    const located = record(await send("DOM.getNodeForLocation", { x: point.x, y: point.y }));
    const backendNodeId = Number(located.backendNodeId || 0);
    const nodeId = Number(located.nodeId || 0);
    if (!backendNodeId && !nodeId) return false;
    const resolved = record(await send("DOM.resolveNode", backendNodeId ? { backendNodeId } : { nodeId }));
    hitObjectId = String(record(resolved.object).objectId || "");
    if (!hitObjectId) return false;
    const answer = await callNode(send, objectId, { action: "acceptsHit" }, hitObjectId);
    return answer.ok === true;
  } catch {
    return false;
  } finally {
    if (hitObjectId) await send("Runtime.releaseObject", { objectId: hitObjectId }).catch(() => {});
  }
}

async function mainLoaderId(send: Send): Promise<string> {
  try {
    const tree = record(await send("Page.getFrameTree"));
    return String(record(record(tree.frameTree).frame).loaderId || "");
  } catch {
    return "";
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
