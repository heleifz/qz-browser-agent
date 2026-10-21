import type { ToolContext, ToolErrorConstructor } from "#sdk/background";
import type { CdpCommand } from "#sdk/background/browser";
import { createCdpKeyboard, sessionForFrame } from "#sdk/background/browser";
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
  key: string;
  submit: boolean;
  ref: ElementReference;
}

/** Act on a shadow, frame, or non-unique light-DOM node through its backend node. */
export async function actOnRemoteElement(input: RemoteActionRequest, deps: {
  withDebugger: (tabId: number, fn: (target: chrome.debugger.Debuggee, send: Send) => Promise<unknown>, context?: Record<string, unknown>) => Promise<unknown>;
  subscribeDebuggerEvents?: Subscribe;
  ToolExecutionError: ToolErrorConstructor;
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
      if (input.action === "click") return clickElement(send, objectId, backendNodeId, sessionId, identity);
      if (input.action === "fill") return fillElement(send, objectId, backendNodeId, sessionId, input, identity);
      if (input.action === "press") return pressElement(send, objectId, backendNodeId, sessionId, input, identity, deps);
      if (input.action === "select") return selectElement(send, objectId, sessionId, input, identity);
      if (input.action === "check" || input.action === "uncheck") return checkElement(send, objectId, sessionId, input, identity);
      if (input.action === "scroll") return scrollElement(send, objectId, backendNodeId, sessionId, identity);
      return { ...identity, error: `Unsupported act_on_element action: ${input.action}`, code: "UNSUPPORTED_ELEMENT_ACTION" };
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

async function pressElement(send: Send, objectId: string, backendNodeId: number, sessionId: string | undefined, input: RemoteActionRequest, identity: Record<string, unknown>, deps: {
  ToolExecutionError: ToolErrorConstructor;
  context?: Record<string, unknown>;
}) {
  const pressedKey = input.key || input.value;
  if (!pressedKey) {
    return { ...identity, error: "key is required for press action", code: "MISSING_KEY" };
  }
  const keyboard = createCdpKeyboard({
    ToolExecutionError: deps.ToolExecutionError,
    sendCdp: (_tabId, method, params) => send(method, params, sessionId),
  });
  const mapped = keyboard.normalize(pressedKey);
  if (!(await focusElement(send, objectId, backendNodeId, sessionId))) {
    return { ...identity, error: "Element did not take focus.", code: "ELEMENT_FOCUS_FAILED", clickDispatched: false };
  }
  const before = record(await evaluate(send, objectId, READ_STATE_FN, sessionId));
  await keyboard.press(input.tabId, mapped, (deps.context || {}) as ToolContext);
  const after = record(await evaluate(send, objectId, READ_STATE_FN, sessionId));
  const insertsText = mapped.text.length === 1 && mapped.text !== "\r" && isTextField(before);
  if (insertsText && String(after.value ?? "") === String(before.value ?? "")) {
    return { ...identity, error: "Pressed key did not change the field.", code: "ELEMENT_VALUE_MISMATCH", pressed: false, key: pressedKey, value: after.value, clickDispatched: false };
  }
  return { ...identity, key: pressedKey, pressed: true, method: "backend-node", clickDispatched: false, value: after.value, element: after };
}

async function selectElement(send: Send, objectId: string, sessionId: string | undefined, input: RemoteActionRequest, identity: Record<string, unknown>) {
  const selected = record(await evaluate(send, objectId, SELECT_OPTION_FN, sessionId, [input.value]));
  if (selected.ok !== true) {
    const code = selected.reason === "missing" ? "OPTION_NOT_FOUND" : "NOT_SELECT_ELEMENT";
    const error = code === "OPTION_NOT_FOUND" ? "No option matched that value or label." : "Element is not a select.";
    return { ...identity, error, code, options: selected.options };
  }
  const actual = record(await evaluate(send, objectId, READ_STATE_FN, sessionId));
  if (actual.selected !== selected.selected) {
    return { ...identity, error: "Selected value did not stick.", code: "ELEMENT_VALUE_MISMATCH", selected: actual.selected };
  }
  return { ...identity, selected: actual.selected, selectedLabel: actual.selectedLabel, method: "backend-node" };
}

async function checkElement(send: Send, objectId: string, sessionId: string | undefined, input: RemoteActionRequest, identity: Record<string, unknown>) {
  const desired = input.action === "check";
  const changed = record(await evaluate(send, objectId, SET_CHECKED_FN, sessionId, [desired]));
  if (changed.reason === "radio-uncheck") {
    return { ...identity, error: "A radio button cannot be unchecked.", code: "ELEMENT_CHECK_STATE_MISMATCH" };
  }
  if (changed.reason === "disabled") {
    return { ...identity, error: "Element is disabled.", code: "ELEMENT_DISABLED" };
  }
  if (changed.reason === "not-checkable") {
    return { ...identity, error: "Element is not a checkbox or radio button.", code: "NOT_CHECKABLE_ELEMENT" };
  }
  const actual = record(await evaluate(send, objectId, READ_STATE_FN, sessionId));
  if (actual.checked !== desired) {
    return { ...identity, error: "Check state did not stick.", code: "ELEMENT_CHECK_STATE_MISMATCH", checked: actual.checked };
  }
  return { ...identity, checked: desired, changed: changed.changed === true, method: "backend-node" };
}

async function scrollElement(send: Send, objectId: string, backendNodeId: number, sessionId: string | undefined, identity: Record<string, unknown>) {
  try {
    await send("DOM.scrollIntoViewIfNeeded", { backendNodeId }, sessionId);
  } catch { /* A node without a layout box still gets the element scroll below. */ }
  let place = record(await evaluate(send, objectId, VIEWPORT_FN, sessionId));
  if (place.inView !== true) {
    await evaluate(send, objectId, SCROLL_FN, sessionId);
    place = record(await evaluate(send, objectId, VIEWPORT_FN, sessionId));
  }
  if (place.inView !== true) {
    return { ...identity, error: "Element is not visible.", code: "ELEMENT_NOT_VISIBLE" };
  }
  return { ...identity, scrolledTo: true, method: "backend-node", element: place };
}

async function focusElement(send: Send, objectId: string, backendNodeId: number, sessionId: string | undefined) {
  await send("DOM.focus", { backendNodeId }, sessionId);
  return record(await evaluate(send, objectId, FOCUS_FN, sessionId)).focused === true;
}

function isTextField(state: Record<string, unknown>) {
  if (state.tag === "textarea") return true;
  if (state.tag !== "input") return false;
  const type = String(state.type || "text").toLowerCase();
  return ["text", "search", "email", "password", "tel", "url", "number", ""].includes(type);
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

async function evaluate(send: Send, objectId: string, expression: string, sessionId?: string, args?: unknown[]) {
  const payload: Record<string, unknown> = {
    objectId,
    returnByValue: true,
    functionDeclaration: expression,
  };
  if (args) payload.arguments = args.map(value => ({ value }));
  const evaluated = record(await send("Runtime.callFunctionOn", payload, sessionId));
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

const FOCUS_FN = `function() {
  const el = this;
  if (!el) return { focused: false };
  const root = el.getRootNode();
  const active = root instanceof ShadowRoot ? root.activeElement : el.ownerDocument.activeElement;
  return { focused: active === el };
}`;

const READ_STATE_FN = `function() {
  const el = this;
  if (!el) return {};
  const selected = el instanceof HTMLSelectElement ? el.options[el.selectedIndex] : null;
  return {
    tag: el.localName || "",
    type: el.type || "",
    value: typeof el.value === "string" ? el.value : "",
    checked: "checked" in el ? !!el.checked : undefined,
    selected: el instanceof HTMLSelectElement ? el.value : "",
    selectedLabel: selected ? String(selected.label || "").trim() : "",
  };
}`;

const SELECT_OPTION_FN = `function(raw) {
  const el = this;
  if (!(el instanceof HTMLSelectElement)) return { ok: false, reason: "not-select", tag: el && el.localName };
  const rawWanted = String(raw ?? "");
  const labelWanted = rawWanted.trim();
  const options = Array.from(el.options);
  let matchIndex = options.findIndex(option => option.value === rawWanted);
  if (matchIndex < 0 && labelWanted) matchIndex = options.findIndex(option => String(option.label || "").trim() === labelWanted);
  if (matchIndex < 0) return {
    ok: false,
    reason: "missing",
    options: options.slice(0, 20).map(option => ({ value: option.value, label: String(option.label || "").trim() })),
  };
  el.selectedIndex = matchIndex;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, selected: options[matchIndex].value };
}`;

const SET_CHECKED_FN = `function(desired) {
  const el = this;
  if (!(el instanceof HTMLInputElement) || (el.type !== "checkbox" && el.type !== "radio")) {
    return { ok: false, reason: "not-checkable" };
  }
  if (el.disabled) return { ok: false, reason: "disabled" };
  if (el.type === "radio" && desired !== true) return { ok: false, reason: "radio-uncheck" };
  const before = el.checked;
  if (before !== desired) {
    el.checked = desired;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return { ok: el.checked === desired, checked: el.checked, changed: before !== el.checked };
}`;

const VIEWPORT_FN = `function() {
  const el = this;
  if (!el || !el.getBoundingClientRect) return { inView: false };
  const rect = el.getBoundingClientRect();
  const view = el.ownerDocument.defaultView;
  const inView = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0
    && rect.top < view.innerHeight && rect.left < view.innerWidth;
  return { inView, top: rect.top, left: rect.left };
}`;

const SCROLL_FN = `function() {
  if (this && this.scrollIntoView) this.scrollIntoView({ block: "center", inline: "center" });
  return true;
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
