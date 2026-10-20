import type { CdpCommand } from "#sdk/background/browser";
import { sessionForFrame } from "#sdk/background/browser";
import type { ElementReference } from "#sdk/background/browser";

type Send = CdpCommand;
type Subscribe = (tabId: number, listener: (method: string, params: Record<string, unknown>) => void) => () => void;

export interface RemoteActionRequest {
  tabId: number;
  target: string;
  selector: string;
  index: number;
  uid?: string;
  action: string;
  value: string;
  submit: boolean;
  ref: ElementReference;
}

/** Click and fill a shadow or frame element through its backend node, never through a document selector. */
export async function actOnRemoteElement(input: RemoteActionRequest, deps: {
  withDebugger: (tabId: number, fn: (target: chrome.debugger.Debuggee, send: Send) => Promise<unknown>, context?: Record<string, unknown>) => Promise<unknown>;
  subscribeDebuggerEvents?: Subscribe;
  context?: Record<string, unknown>;
}) {
  const identity = {
    action: input.action,
    target: input.target,
    selector: input.selector,
    uid: input.uid,
    index: input.index,
    tabId: input.tabId,
    frameId: input.ref.frameId,
  };
  if (input.action !== "click" && input.action !== "fill") {
    return {
      ...identity,
      error: `Action ${input.action} is not available for a shadow or frame target. Use click or fill.`,
      code: "REMOTE_ELEMENT_ACTION_UNSUPPORTED",
    };
  }
  const backendNodeId = Number(input.ref.backendNodeId || 0);
  if (!backendNodeId) {
    return { ...identity, error: "Element has no backend node. Take a fresh snapshot.", code: "STALE_ELEMENT_UID" };
  }
  try {
    return await deps.withDebugger(input.tabId, async (_target, send) => {
      const sessionId = input.ref.oopif
        ? await sessionForFrame(input.tabId, send, listener => {
          if (!deps.subscribeDebuggerEvents) throw new Error("Frame sessions are unavailable");
          return deps.subscribeDebuggerEvents(input.tabId, listener);
        }, String(input.ref.frameId || ""))
        : undefined;
      if (input.ref.oopif && !sessionId) {
        return { ...identity, error: "The frame for this element is gone. Take a fresh snapshot.", code: "STALE_ELEMENT_UID" };
      }
      const objectId = await resolveObject(send, backendNodeId, sessionId);
      if (!objectId) {
        return { ...identity, error: "Element node is gone. Take a fresh snapshot.", code: "STALE_ELEMENT_UID" };
      }
      if (input.action === "fill") return fillElement(send, objectId, backendNodeId, sessionId, input, identity);
      return clickElement(send, objectId, backendNodeId, sessionId, identity);
    }, deps.context);
  } catch (error) {
    const code = String((error as { code?: string })?.code || "");
    if (code.startsWith("SESSION_TAB_") || code === "CDP_RUN_RELEASED" || code === "CDP_RUN_CONTEXT_REQUIRED" || code === "OPERATION_ABORTED" || code === "SECURITY_GUARDRAIL_BLOCKED") throw error;
    return { ...identity, error: error instanceof Error ? error.message : String(error), code: "REMOTE_ELEMENT_ACTION_FAILED" };
  }
}

async function clickElement(send: Send, objectId: string, backendNodeId: number, sessionId: string | undefined, identity: Record<string, unknown>) {
  await send("DOM.scrollIntoViewIfNeeded", { backendNodeId }, sessionId);
  const point = await pagePoint(send, objectId, backendNodeId, sessionId);
  if (!point) return { ...identity, error: "Element is not visible.", code: "ELEMENT_NOT_VISIBLE" };
  if (point.covered) return { ...identity, error: "Another element covers this target.", code: "ELEMENT_OBSCURED" };
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "none", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  return { ...identity, clickDispatched: true, method: "backend-node", frameId: identity.frameId };
}

async function fillElement(send: Send, objectId: string, backendNodeId: number, sessionId: string | undefined, input: RemoteActionRequest, identity: Record<string, unknown>) {
  await send("DOM.scrollIntoViewIfNeeded", { backendNodeId }, sessionId);
  const point = await pagePoint(send, objectId, backendNodeId, sessionId);
  if (!point) return { ...identity, error: "Element is not visible.", code: "ELEMENT_NOT_VISIBLE" };
  if (point.covered) return { ...identity, error: "Another element covers this target.", code: "ELEMENT_OBSCURED" };
  await send("DOM.focus", { backendNodeId }, sessionId);
  await evaluate(send, objectId, SELECT_TEXT_FN, sessionId);
  if (input.value) await send("Input.insertText", { text: input.value }, sessionId);
  else {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 }, sessionId);
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 }, sessionId);
  }
  const actual = String(await evaluate(send, objectId, READ_VALUE_FN, sessionId) ?? "");
  const expected = input.value.replace(/\r\n?/g, "\n");
  if (actual.replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n") !== expected) {
    return { ...identity, error: "Filled value did not stick.", code: "ELEMENT_VALUE_MISMATCH", filled: false, value: actual };
  }
  if (input.submit) {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" }, sessionId);
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }, sessionId);
  }
  return { ...identity, filled: true, value: actual, method: "backend-node", submitDispatched: input.submit, frameId: identity.frameId };
}

async function pagePoint(send: Send, objectId: string, backendNodeId: number, sessionId: string | undefined) {
  const local = record(await evaluate(send, objectId, POINT_FN, sessionId));
  if (local.ok !== true) return null;
  if (local.covered === true) return { x: 0, y: 0, covered: true };
  if (!sessionId) {
    const x = Number(local.pageX);
    const y = Number(local.pageY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y, covered: false };
  }
  const tree = record(await send("Page.getFrameTree", {}, sessionId));
  const frameId = String(record(record(tree.frameTree).frame).id || "");
  if (!frameId) return null;
  const owner = record(await send("DOM.getFrameOwner", { frameId }));
  const ownerId = Number(owner.backendNodeId || 0);
  if (!ownerId) return null;
  await send("DOM.scrollIntoViewIfNeeded", { backendNodeId: ownerId });
  const ownerObject = await resolveObject(send, ownerId);
  const origin = record(await evaluate(send, ownerObject, "function(){ const rect = this.getBoundingClientRect(); return { x: rect.left + this.clientLeft, y: rect.top + this.clientTop }; }"));
  const again = record(await evaluate(send, objectId, POINT_FN, sessionId));
  if (again.ok !== true) return null;
  const x = Number(origin.x) + Number(again.x);
  const y = Number(origin.y) + Number(again.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const covered = await parentCoversFrame(send, x, y);
  return { x, y, covered };
}

async function parentCoversFrame(send: Send, x: number, y: number) {
  const evaluated = record(await send("Runtime.evaluate", {
    expression: `(() => { const hit = document.elementFromPoint(${JSON.stringify(x)}, ${JSON.stringify(y)}); return hit ? hit.localName : ""; })()`,
    returnByValue: true,
  }));
  const tag = String(record(evaluated.result).value || "");
  return tag !== "" && tag !== "iframe";
}

async function resolveObject(send: Send, backendNodeId: number, sessionId?: string) {
  try {
    const resolved = record(await send("DOM.resolveNode", { backendNodeId }, sessionId));
    return String(record(resolved.object).objectId || "");
  } catch {
    return "";
  }
}

async function evaluate(send: Send, objectId: string, expression: string, sessionId?: string) {
  const evaluated = record(await send("Runtime.callFunctionOn", {
    objectId,
    returnByValue: true,
    functionDeclaration: expression,
  }, sessionId));
  return record(evaluated.result).value;
}

const POINT_FN = `function() {
  const el = this instanceof Element ? this : null;
  if (!el) return { ok: false, reason: "not-element" };
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return { ok: false, reason: "no-box" };
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const root = el.getRootNode();
  const hit = (root instanceof ShadowRoot ? root : el.ownerDocument).elementFromPoint(x, y);
  if (hit !== el && !(hit && el.contains(hit))) return { ok: false, reason: "obscured" };
  let inFrame = false;
  try { inFrame = window.top !== window; } catch (error) { inFrame = true; }
  if (!inFrame) {
    const topHit = document.elementFromPoint(x, y);
    let node = el;
    let accepts = false;
    while (node) {
      if (node === topHit) { accepts = true; break; }
      if (node.parentElement) node = node.parentElement;
      else {
        const owner = node.getRootNode();
        node = owner instanceof ShadowRoot ? owner.host : null;
      }
    }
    return { ok: true, covered: !accepts, x, y, pageX: x, pageY: y };
  }
  try {
    const frame = window.frameElement;
    if (!frame) return { ok: true, covered: false, x, y, pageX: x, pageY: y };
    const frameRect = frame.getBoundingClientRect();
    const pageX = frameRect.left + frame.clientLeft + x;
    const pageY = frameRect.top + frame.clientTop + y;
    const topHit = window.parent.document.elementFromPoint(pageX, pageY);
    const covered = !!topHit && topHit !== frame && !frame.contains(topHit);
    return { ok: true, covered, x, y, pageX, pageY };
  } catch (error) {
    return { ok: true, covered: false, x, y, pageX: x, pageY: y };
  }
}`;

const SELECT_TEXT_FN = `function() {
  const el = this;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) { el.focus(); el.select(); return true; }
  if (el && el.isContentEditable) {
    el.focus();
    const range = el.ownerDocument.createRange();
    range.selectNodeContents(el);
    const selection = el.ownerDocument.defaultView.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }
  return false;
}`;

const READ_VALUE_FN = `function() {
  const el = this;
  if (!el) return "";
  if (typeof el.value === "string") return el.value;
  return el.textContent || "";
}`;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
