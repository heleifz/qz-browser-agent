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
  const local = await quadCenter(send, backendNodeId, sessionId);
  if (!local) return null;
  let origin = { x: 0, y: 0 };
  if (sessionId) {
    // Quads are relative to the frame's local root; an OOPIF is its own local root.
    const tree = record(await send("Page.getFrameTree", {}, sessionId));
    const frameId = String(record(record(tree.frameTree).frame).id || "");
    const ownerId = frameId ? Number(record(await send("DOM.getFrameOwner", { frameId })).backendNodeId || 0) : 0;
    if (!ownerId) return null;
    await send("DOM.scrollIntoViewIfNeeded", { backendNodeId: ownerId });
    const content = arrayNumbers(record(record(await send("DOM.getBoxModel", { backendNodeId: ownerId })).model).content);
    if (content.length < 2) return null;
    origin = { x: content[0], y: content[1] };
    const again = await quadCenter(send, backendNodeId, sessionId);
    if (!again) return null;
    local.x = again.x;
    local.y = again.y;
  }
  const x = origin.x + local.x;
  const y = origin.y + local.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const covered = !(await hitsTarget(send, objectId, x, y, local, sessionId));
  return { x, y, covered };
}

async function quadCenter(send: Send, backendNodeId: number, sessionId: string | undefined) {
  let quads: unknown[];
  try {
    quads = arrayValue(record(await send("DOM.getContentQuads", { backendNodeId }, sessionId)).quads);
  } catch {
    return null;
  }
  const quad = quads.map(arrayNumbers).find(points => points.length >= 8 && quadArea(points) > 1);
  if (!quad) return null;
  return {
    x: (quad[0] + quad[2] + quad[4] + quad[6]) / 4,
    y: (quad[1] + quad[3] + quad[5] + quad[7]) / 4,
  };
}

/** The dispatched point must land on the target or its composed descendant, in the target's own frame. */
async function hitsTarget(send: Send, objectId: string, x: number, y: number, local: { x: number; y: number }, sessionId: string | undefined) {
  try {
    const top = record(await send("DOM.getNodeForLocation", { x: Math.round(x), y: Math.round(y), ignorePointerEventsNone: true }));
    let hitId = Number(top.backendNodeId || 0);
    if (sessionId) {
      const inner = record(await send("DOM.getNodeForLocation", { x: Math.round(local.x), y: Math.round(local.y), ignorePointerEventsNone: true }, sessionId));
      if (!(await ownsFrame(send, hitId, sessionId))) return false;
      hitId = Number(inner.backendNodeId || 0);
    }
    if (!hitId) return false;
    const hitObject = await resolveObject(send, hitId, sessionId);
    if (!hitObject) return false;
    const evaluated = record(await send("Runtime.callFunctionOn", {
      objectId,
      returnByValue: true,
      arguments: [{ objectId: hitObject }],
      functionDeclaration: CONTAINS_FN,
    }, sessionId));
    return record(evaluated.result).value === true;
  } catch {
    return false;
  }
}

async function ownsFrame(send: Send, hitId: number, sessionId: string) {
  const tree = record(await send("Page.getFrameTree", {}, sessionId));
  const frameId = String(record(record(tree.frameTree).frame).id || "");
  const owner = Number(record(await send("DOM.getFrameOwner", { frameId })).backendNodeId || 0);
  return owner !== 0 && owner === hitId;
}

function quadArea(points: number[]) {
  let area = 0;
  for (let index = 0; index < 4; index += 1) {
    const next = (index + 1) % 4;
    area += points[index * 2] * points[next * 2 + 1] - points[next * 2] * points[index * 2 + 1];
  }
  return Math.abs(area) / 2;
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

const CONTAINS_FN = `function(hit) {
  for (let node = hit; node; node = node.parentNode || (node instanceof ShadowRoot ? node.host : null)) {
    if (node === this) return true;
  }
  return false;
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

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function arrayNumbers(value: unknown): number[] {
  return arrayValue(value).map(Number).filter(Number.isFinite);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
