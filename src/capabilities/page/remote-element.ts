import type { ToolContext, ToolErrorConstructor } from "#sdk/background";
import type { CdpCommand, ElementReference, FramePath } from "#sdk/background/browser";
import { createCdpKeyboard, elementPageFunction, resolveFramePath } from "#sdk/background/browser";

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

/** Page-level link policy for a click; `prepare` throws for a blocked destination. */
export interface RemoteClickNavigation {
  prepare(href: string): Promise<unknown>;
  observe(prepared: unknown): Promise<Record<string, unknown>>;
}

interface RemoteDeps {
  withDebugger: (tabId: number, fn: (target: chrome.debugger.Debuggee, send: Send) => Promise<unknown>, context?: Record<string, unknown>) => Promise<unknown>;
  subscribeDebuggerEvents?: Subscribe;
  ToolExecutionError: ToolErrorConstructor;
  context?: Record<string, unknown>;
}

/** A backend node resolved in the document and target session that own it. */
interface RemoteTarget {
  send: Send;
  objectId: string;
  backendNodeId: number;
  path: FramePath;
  sessionId?: string;
}

type Identity = Record<string, unknown>;
type Point = { x: number; y: number };

/** Act on a shadow, frame, or non-unique light-DOM node through its backend node. */
export async function actOnRemoteElement(input: RemoteActionRequest, deps: RemoteDeps & { navigation?: RemoteClickNavigation }) {
  const identity = {
    action: input.action,
    target: input.target,
    selector: input.selector,
    uid: input.uid,
    index: input.index,
    tabId: input.tabId,
    frameId: input.ref.frameId,
  };
  if (!Number(input.ref.backendNodeId || 0)) {
    return { ...identity, error: "Element has no backend node. Take a fresh snapshot.", code: "STALE_ELEMENT_UID" };
  }
  const click = { dispatched: false, prepared: null as unknown };
  try {
    const result = await deps.withDebugger(input.tabId, async (_target, send) => {
      const target = await locateRemote(send, input.tabId, input.ref, deps);
      if ("code" in target) return { ...identity, ...target };
      if (input.action === "scroll" && target.path.oopif) {
        return {
          ...identity,
          error: "Scroll cannot confirm visibility inside a cross-process iframe.",
          code: "IFRAME_SCROLL_UNAVAILABLE",
        };
      }
      if (input.action === "click") {
        const outcome = await clickElement(target, identity, input.ref, deps);
        click.dispatched = outcome.dispatched;
        click.prepared = outcome.prepared;
        return outcome.result;
      }
      if (input.action === "fill") return fillElement(target, input, identity);
      if (input.action === "press") return pressElement(target, input, identity, deps);
      if (input.action === "select") return selectElement(target, input, identity);
      if (input.action === "check" || input.action === "uncheck") return checkElement(target, input, identity);
      if (input.action === "scroll") return scrollElement(target, identity);
      return { ...identity, error: `Unsupported act_on_element action: ${input.action}`, code: "UNSUPPORTED_ELEMENT_ACTION" };
    }, deps.context) as Record<string, unknown>;
    const navigation = click.dispatched && deps.navigation ? await deps.navigation.observe(click.prepared) : null;
    return navigation ? { ...result, ...navigation } : result;
  } catch (error) {
    // Tool errors carry ownership, policy, argument, and cancellation decisions; protocol failures do not.
    if (error instanceof deps.ToolExecutionError) throw error;
    return { ...identity, error: error instanceof Error ? error.message : String(error), code: "REMOTE_ELEMENT_ACTION_FAILED" };
  }
}

/** Inspect a node that has no top-level selector, reading it in its own frame. */
export async function inspectRemoteElement(input: { tabId: number; target: string; uid?: string; ref: ElementReference }, deps: RemoteDeps) {
  const identity = { tabId: input.tabId, target: input.target, uid: input.uid, frameId: input.ref.frameId };
  try {
    return await deps.withDebugger(input.tabId, async (_target, send) => {
      const target = await locateRemote(send, input.tabId, input.ref, deps);
      if ("code" in target) return { ...identity, ...target };
      const details = record(await evaluate(target, elementPageFunction("inspect")));
      if (details.error) return { ...identity, error: String(details.error), code: "STALE_ELEMENT_UID" };
      const ax = arrayValue(record(await target.send("Accessibility.getPartialAXTree", {
        backendNodeId: target.backendNodeId,
        fetchRelatives: false,
      }, target.sessionId).catch(() => ({}))).nodes).map(record)[0] || {};
      const local = await quadCenter(target, target.backendNodeId);
      const point = local ? await toPagePoint(target, local) : null;
      const covered = point ? !(await hitsTarget(target, point, local!, CONTAINS_FN)) : false;
      return {
        ...identity,
        ...details,
        role: String(record(ax.role).value || ""),
        name: String(record(ax.name).value || ""),
        oopif: target.path.oopif || undefined,
        clickablePoint: point ? { x: Math.round(point.x), y: Math.round(point.y) } : null,
        state: { focused: details.focused === true, clickablePointReachable: !!point && !covered, obscuredAtCenter: covered },
        method: "backend-node",
      };
    }, deps.context);
  } catch (error) {
    if (error instanceof deps.ToolExecutionError) throw error;
    return { ...identity, error: error instanceof Error ? error.message : String(error), code: "REMOTE_ELEMENT_ACTION_FAILED" };
  }
}

async function locateRemote(send: Send, tabId: number, ref: ElementReference, deps: RemoteDeps): Promise<RemoteTarget | { error: string; code: string }> {
  const backendNodeId = Number(ref.backendNodeId || 0);
  const frameId = String(ref.frameId || "");
  let path: FramePath | null = { frameId: "", loaderId: "", oopif: false, owners: [] };
  if (frameId) {
    path = await resolveFramePath(tabId, send, listener => {
      if (!deps.subscribeDebuggerEvents) throw new Error("Frame sessions are unavailable");
      return deps.subscribeDebuggerEvents(tabId, listener);
    }, frameId);
    if (!path) return { error: "The frame for this element is gone. Take a fresh snapshot.", code: "STALE_ELEMENT_UID" };
    if (ref.loaderId && path.loaderId !== ref.loaderId) {
      return { error: "The frame for this element has navigated. Take a fresh snapshot.", code: "STALE_ELEMENT_UID" };
    }
  }
  const objectId = await resolveObject(send, backendNodeId, path.sessionId);
  const target = { send, objectId, backendNodeId, path, sessionId: path.sessionId };
  if (!objectId || (await evaluate(target, CONNECTED_FN)) !== true) {
    return { error: "Element node is gone. Take a fresh snapshot.", code: "STALE_ELEMENT_UID" };
  }
  return target;
}

async function clickElement(target: RemoteTarget, identity: Identity, ref: ElementReference, deps: RemoteDeps & { navigation?: RemoteClickNavigation }) {
  const href = String(await evaluate(target, LINK_HREF_FN) || "");
  const reachable = async () => {
    await scrollIntoView(target, target.backendNodeId);
    const point = await pagePoint(target, target.backendNodeId, CONTAINS_FN);
    if (!point) return { error: "Element is not visible.", code: "ELEMENT_NOT_VISIBLE" };
    if (point.covered) return { error: "Another element covers this target.", code: "ELEMENT_OBSCURED" };
    return point;
  };
  let point = await reachable();
  if ("code" in point) return { dispatched: false, prepared: null, result: { ...identity, ...point } };
  // Blocked or rate-limited destinations are decided before any input reaches the page.
  const prepared = deps.navigation ? await deps.navigation.prepare(href) : null;
  if (href) {
    // A rate-limit wait can outlast the layout the point was measured against.
    point = await reachable();
    if ("code" in point) return { dispatched: false, prepared, result: { ...identity, ...point } };
  }
  await dispatchClick(target.send, point);
  return {
    dispatched: true,
    prepared,
    result: { ...identity, clickDispatched: true, method: "backend-node", frameId: ref.frameId, ...(href ? { href } : {}) },
  };
}

async function fillElement(target: RemoteTarget, input: RemoteActionRequest, identity: Identity) {
  const state = record(await evaluate(target, FILL_STATE_FN));
  if (state.reason === "not-editable") return { ...identity, error: "Element is not editable.", code: "NOT_EDITABLE_ELEMENT" };
  if (state.reason === "disabled") return { ...identity, error: "Element is disabled.", code: "ELEMENT_DISABLED" };
  if (state.reason === "readonly") return { ...identity, error: "Element is readonly.", code: "ELEMENT_READONLY" };
  // A child of a contenteditable region is edited through its editing host.
  const hostId = await objectFor(target, EDIT_HOST_FN);
  if (!hostId) return { ...identity, error: "Element is not editable.", code: "NOT_EDITABLE_ELEMENT" };
  const host: RemoteTarget = { ...target, objectId: hostId, backendNodeId: await backendIdFor(target, hostId) || target.backendNodeId };
  await scrollIntoView(host, host.backendNodeId);
  const point = await pagePoint(host, host.backendNodeId, CONTAINS_FN);
  if (!point) return { ...identity, error: "Element is not visible.", code: "ELEMENT_NOT_VISIBLE" };
  if (point.covered) return { ...identity, error: "Another element covers this target.", code: "ELEMENT_OBSCURED" };
  await target.send("DOM.focus", { objectId: hostId }, target.sessionId);
  // A page may move focus while the target gains it; text is only typed where focus and selection are verified.
  const prepared = record(await evaluate(host, SELECT_CONTENTS_FN));
  if (prepared.focused !== true || !(await ownersFocused(target))) {
    return { ...identity, error: "Element did not keep focus.", code: "ELEMENT_FOCUS_FAILED", filled: false };
  }
  if (prepared.selected !== true) {
    return { ...identity, error: "Element contents could not be selected.", code: "ELEMENT_SELECTION_FAILED", filled: false };
  }
  if (input.value) await target.send("Input.insertText", { text: input.value }, target.sessionId);
  else {
    await target.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 }, target.sessionId);
    await target.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 }, target.sessionId);
  }
  const actual = String(await evaluate(host, READ_VALUE_FN) ?? "");
  const expected = input.value.replace(/\r\n?/g, "\n");
  if (actual.replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n") !== expected) {
    return { ...identity, error: "Filled value did not stick.", code: "ELEMENT_VALUE_MISMATCH", filled: false, value: actual };
  }
  if (input.submit) {
    if (record(await evaluate(host, FOCUS_FN)).focused !== true) {
      return { ...identity, error: "Element lost focus before submit.", code: "ELEMENT_FOCUS_FAILED", filled: true, value: actual, submitDispatched: false };
    }
    await target.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" }, target.sessionId);
    await target.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }, target.sessionId);
  }
  return { ...identity, filled: true, value: actual, method: "backend-node", submitDispatched: input.submit };
}

async function pressElement(target: RemoteTarget, input: RemoteActionRequest, identity: Identity, deps: RemoteDeps) {
  const pressedKey = input.key || input.value;
  if (!pressedKey) {
    return { ...identity, error: "key is required for press action", code: "MISSING_KEY" };
  }
  const keyboard = createCdpKeyboard({
    ToolExecutionError: deps.ToolExecutionError,
    sendCdp: (_tabId, method, params) => target.send(method, params, target.sessionId),
  });
  const mapped = keyboard.normalize(pressedKey);
  await target.send("DOM.focus", { backendNodeId: target.backendNodeId }, target.sessionId);
  if (record(await evaluate(target, FOCUS_FN)).focused !== true || !(await ownersFocused(target))) {
    return { ...identity, error: "Element did not take focus.", code: "ELEMENT_FOCUS_FAILED", clickDispatched: false };
  }
  const before = record(await evaluate(target, READ_STATE_FN));
  try {
    await keyboard.press(input.tabId, mapped, (deps.context || {}) as ToolContext);
  } catch (error) {
    if (!readLostToNavigation(error)) throw error;
    return { ...identity, key: pressedKey, pressed: true, method: "backend-node", clickDispatched: false, navigated: true };
  }
  let after: Record<string, unknown>;
  try {
    after = record(await evaluate(target, READ_STATE_FN));
  } catch (error) {
    if (!readLostToNavigation(error)) throw error;
    return { ...identity, key: pressedKey, pressed: true, method: "backend-node", clickDispatched: false, navigated: true };
  }
  const insertsText = mapped.text.length === 1 && mapped.text !== "\r" && isTextField(before);
  if (insertsText && String(after.value ?? "") === String(before.value ?? "")) {
    return { ...identity, error: "Pressed key did not change the field.", code: "ELEMENT_VALUE_MISMATCH", pressed: false, key: pressedKey, value: after.value, clickDispatched: false };
  }
  return { ...identity, key: pressedKey, pressed: true, method: "backend-node", clickDispatched: false, value: after.value, element: after };
}

async function selectElement(target: RemoteTarget, input: RemoteActionRequest, identity: Identity) {
  const selected = record(await evaluate(target, SELECT_OPTION_FN, [input.value]));
  if (selected.ok !== true) {
    if (selected.reason === "disabled") return { ...identity, error: "Element is disabled.", code: "ELEMENT_DISABLED" };
    const code = selected.reason === "missing" ? "OPTION_NOT_FOUND" : "NOT_SELECT_ELEMENT";
    const error = code === "OPTION_NOT_FOUND" ? "No option matched that value or label." : "Element is not a select.";
    return { ...identity, error, code, options: selected.options };
  }
  const actual = record(await evaluate(target, READ_STATE_FN));
  if (actual.selected !== selected.selected) {
    return { ...identity, error: "Selected value did not stick.", code: "ELEMENT_VALUE_MISMATCH", selected: actual.selected };
  }
  return { ...identity, selected: actual.selected, selectedLabel: actual.selectedLabel, method: "backend-node" };
}

/** A trusted click keeps page click handlers and `preventDefault()` in charge of the final state. */
async function checkElement(target: RemoteTarget, input: RemoteActionRequest, identity: Identity) {
  const desired = input.action === "check";
  const state = record(await evaluate(target, CHECK_STATE_FN));
  if (state.reason === "not-checkable") {
    return { ...identity, error: "Element is not a checkbox or radio button.", code: "NOT_CHECKABLE_ELEMENT" };
  }
  if (state.reason === "disabled") return { ...identity, error: "Element is disabled.", code: "ELEMENT_DISABLED" };
  if (state.checked === desired) return { ...identity, checked: desired, changed: false, method: "backend-node" };
  if (state.type === "radio" && !desired) {
    return { ...identity, error: "A radio button cannot be unchecked.", code: "ELEMENT_CHECK_STATE_MISMATCH" };
  }
  const control = target.objectId;
  let point: (Point & { covered: boolean }) | null = null;
  let clickedLabel = false;
  let sawBox = false;
  for (let index = -1; index < Number(state.labels || 0) && !point; index += 1) {
    const candidateId = index < 0 ? target.objectId : await objectFor(target, LABEL_AT_FN, [index]);
    if (!candidateId) continue;
    const candidate: RemoteTarget = { ...target, objectId: candidateId, backendNodeId: await backendIdFor(target, candidateId) };
    if (!candidate.backendNodeId) continue;
    await scrollIntoView(candidate, candidate.backendNodeId);
    const locals = index < 0
      ? [await quadCenter(candidate, candidate.backendNodeId)].filter((item): item is Point => !!item)
      : await labelPoints(candidate);
    for (const local of locals) {
      sawBox = true;
      const page = await toPagePoint(candidate, local);
      if (!page) continue;
      if (await hitsTarget(candidate, page, local, SAFE_CHECK_HIT_FN, control)) {
        point = { ...page, covered: false };
        clickedLabel = index >= 0;
        break;
      }
    }
  }
  if (!point) {
    return sawBox
      ? { ...identity, error: "Another element covers this control and its labels.", code: "ELEMENT_OBSCURED" }
      : { ...identity, error: "Element and its labels are not visible.", code: "ELEMENT_NOT_VISIBLE" };
  }
  await dispatchClick(target.send, point);
  const actual = record(await evaluate(target, SETTLED_STATE_FN, undefined, true));
  if (actual.checked !== desired) {
    return { ...identity, error: "Check state did not change; the page may have prevented it.", code: "ELEMENT_CHECK_STATE_MISMATCH", checked: actual.checked };
  }
  return { ...identity, checked: desired, changed: true, method: "backend-node", clickedLabel };
}

async function scrollElement(target: RemoteTarget, identity: Identity) {
  try {
    await target.send("DOM.scrollIntoViewIfNeeded", { backendNodeId: target.backendNodeId }, target.sessionId);
  } catch { /* A node without a layout box still gets the element scroll below. */ }
  let place = record(await evaluate(target, VIEWPORT_FN));
  if (place.inView !== true) {
    await evaluate(target, SCROLL_FN);
    place = record(await evaluate(target, VIEWPORT_FN));
  }
  if (place.inView !== true) {
    return { ...identity, error: "Element is not visible.", code: "ELEMENT_NOT_VISIBLE" };
  }
  return { ...identity, scrolledTo: true, method: "backend-node", element: place };
}

/** Every iframe element between the target's document and the page must hold focus in its own document. */
async function ownersFocused(target: RemoteTarget) {
  for (const owner of target.path.owners) {
    const objectId = await resolveObject(target.send, owner.backendNodeId, owner.sessionId);
    if (!objectId) return false;
    const focused = record(await evaluate({ ...target, objectId, sessionId: owner.sessionId }, FOCUS_FN));
    if (focused.focused !== true) return false;
  }
  return true;
}

async function scrollIntoView(target: RemoteTarget, backendNodeId: number) {
  for (const owner of [...target.path.owners].reverse()) {
    try {
      await target.send("DOM.scrollIntoViewIfNeeded", { backendNodeId: owner.backendNodeId }, owner.sessionId);
    } catch { /* The owner may have no layout box; the hit test decides visibility. */ }
  }
  await target.send("DOM.scrollIntoViewIfNeeded", { backendNodeId }, target.sessionId);
}

async function dispatchClick(send: Send, point: Point) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "none", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
}

function readLostToNavigation(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /navigat|context was destroyed|Cannot find context|Session with given id not found|No session with given id|target closed|detached while/i.test(message);
}

function isTextField(state: Record<string, unknown>) {
  if (state.tag === "textarea") return true;
  if (state.tag !== "input") return false;
  const type = String(state.type || "text").toLowerCase();
  return ["text", "search", "email", "password", "tel", "url", "number", ""].includes(type);
}

async function pagePoint(target: RemoteTarget, backendNodeId: number, accepts: string) {
  const local = await quadCenter(target, backendNodeId);
  if (!local) return null;
  const page = await toPagePoint(target, local);
  if (!page) return null;
  return { ...page, covered: !(await hitsTarget(target, page, local, accepts)) };
}

/** Content quads start at the target's local root; each cross-process iframe adds its content-box origin. */
async function toPagePoint(target: RemoteTarget, local: Point) {
  let x = local.x;
  let y = local.y;
  for (const owner of target.path.owners) {
    if (!owner.boundary) continue;
    const origin = await contentOrigin(target.send, owner.backendNodeId, owner.sessionId);
    if (!origin) return null;
    x += origin.x;
    y += origin.y;
  }
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

async function contentOrigin(send: Send, backendNodeId: number, sessionId?: string) {
  try {
    const content = arrayNumbers(record(record(await send("DOM.getBoxModel", { backendNodeId }, sessionId)).model).content);
    return content.length >= 2 ? { x: content[0], y: content[1] } : null;
  } catch {
    return null;
  }
}

/**
 * Walks the dispatched point from the page into the target's document: each cross-process
 * level must hit the next iframe element, and the innermost hit must satisfy `accepts`.
 */
async function hitsTarget(target: RemoteTarget, page: Point, local: Point, accepts: string, extra?: string) {
  try {
    const boundaries = target.path.owners.filter(owner => owner.boundary).reverse();
    let point = { ...page };
    let sessionId: string | undefined;
    for (let index = 0; index < boundaries.length; index += 1) {
      const owner = boundaries[index];
      const hit = await nodeAt(target.send, point, sessionId);
      if (hit !== owner.backendNodeId) return false;
      const origin = await contentOrigin(target.send, owner.backendNodeId, owner.sessionId);
      if (!origin) return false;
      point = { x: point.x - origin.x, y: point.y - origin.y };
      sessionId = boundaries[index + 1]?.sessionId ?? target.sessionId;
    }
    if (boundaries.length && (Math.abs(point.x - local.x) > 1 || Math.abs(point.y - local.y) > 1)) return false;
    const hitId = await nodeAt(target.send, point, sessionId);
    if (!hitId) return false;
    const hitObject = await resolveObject(target.send, hitId, target.sessionId);
    if (!hitObject) return false;
    const args = [{ objectId: hitObject }, ...(extra ? [{ objectId: extra }] : [])];
    const evaluated = record(await target.send("Runtime.callFunctionOn", {
      objectId: target.objectId,
      returnByValue: true,
      arguments: args,
      functionDeclaration: accepts,
    }, target.sessionId));
    return record(evaluated.result).value === true;
  } catch {
    return false;
  }
}

/** Quads are viewport coordinates, but hit testing takes document coordinates of the session's local root. */
async function nodeAt(send: Send, point: Point, sessionId?: string) {
  const scroll = record(record(await send("Page.getLayoutMetrics", {}, sessionId)).cssLayoutViewport);
  const hit = record(await send("DOM.getNodeForLocation", {
    x: Math.round(point.x + Number(scroll.pageX || 0)),
    y: Math.round(point.y + Number(scroll.pageY || 0)),
    ignorePointerEventsNone: true,
  }, sessionId));
  return Number(hit.backendNodeId || 0);
}

/** The first line box keeps a wrapped inline link clickable; its overall bounding box center may sit on other text. */
async function quadCenter(target: RemoteTarget, backendNodeId: number) {
  let quads: unknown[];
  try {
    quads = arrayValue(record(await target.send("DOM.getContentQuads", { backendNodeId }, target.sessionId)).quads);
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

/** Label text points come from the label's frame; its content quads translate them to the local root. */
async function labelPoints(label: RemoteTarget) {
  let quads: number[][];
  try {
    quads = arrayValue(record(await label.send("DOM.getContentQuads", { backendNodeId: label.backendNodeId }, label.sessionId)).quads)
      .map(arrayNumbers).filter(points => points.length >= 8);
  } catch {
    return [];
  }
  if (!quads.length) return [];
  const left = Math.min(...quads.flatMap(points => [points[0], points[2], points[4], points[6]]));
  const top = Math.min(...quads.flatMap(points => [points[1], points[3], points[5], points[7]]));
  const offsets = arrayValue(await evaluate(label, LABEL_POINTS_FN)).map(record);
  return offsets.map(offset => ({ x: left + Number(offset.dx), y: top + Number(offset.dy) }))
    .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
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

async function backendIdFor(target: RemoteTarget, objectId: string) {
  try {
    return Number(record(record(await target.send("DOM.describeNode", { objectId }, target.sessionId)).node).backendNodeId || 0);
  } catch {
    return 0;
  }
}

/** Calls a page function that returns an element and keeps the result as a remote object. */
async function objectFor(target: RemoteTarget, expression: string, args?: unknown[]) {
  const payload: Record<string, unknown> = { objectId: target.objectId, functionDeclaration: expression };
  if (args) payload.arguments = args.map(value => ({ value }));
  const result = record(record(await target.send("Runtime.callFunctionOn", payload, target.sessionId)).result);
  return result.subtype === "node" ? String(result.objectId || "") : "";
}

async function evaluate(target: Pick<RemoteTarget, "send" | "objectId" | "sessionId">, expression: string, args?: unknown[], awaitPromise = false) {
  const payload: Record<string, unknown> = {
    objectId: target.objectId,
    returnByValue: true,
    functionDeclaration: expression,
  };
  if (args) payload.arguments = args.map(value => ({ value }));
  if (awaitPromise) payload.awaitPromise = true;
  const evaluated = record(await target.send("Runtime.callFunctionOn", payload, target.sessionId));
  return record(evaluated.result).value;
}

const CONNECTED_FN = `function() {
  return !!this && this.isConnected === true;
}`;

const CONTAINS_FN = `function(hit) {
  for (let node = hit; node; node = node.parentNode || (node instanceof ShadowRoot ? node.host : null)) {
    if (node === this) return true;
  }
  return false;
}`;

// Mirrors the content script's label rule: nested links and independent controls do not toggle the input.
const INDEPENDENT_CONTROL = "a[href], area[href], button, input, select, textarea, [contenteditable]:not([contenteditable='false']), [role='button'], [role='link']";

const SAFE_CHECK_HIT_FN = `function(hit, control) {
  for (let node = hit; node; node = node.parentNode || (node instanceof ShadowRoot ? node.host : null)) {
    if (node === control || node === this) return true;
    if (node.nodeType === 1 && node.matches(${JSON.stringify(INDEPENDENT_CONTROL)})) return false;
  }
  return false;
}`;

const LINK_HREF_FN = `function() {
  for (let node = this; node; node = node.parentNode || (node instanceof ShadowRoot ? node.host : null)) {
    if ((node.localName === "a" || node.localName === "area") && node.hasAttribute("href")) return String(node.href || "");
  }
  return "";
}`;

const FILL_STATE_FN = `function() {
  const el = this;
  const text = el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type !== "file" && el.type !== "checkbox" && el.type !== "radio");
  if (!text && !(el instanceof HTMLElement && el.isContentEditable)) return { reason: "not-editable" };
  if (el.matches(":disabled") || el.getAttribute("aria-disabled") === "true") return { reason: "disabled" };
  if ((text && el.readOnly) || el.getAttribute("aria-readonly") === "true") return { reason: "readonly" };
  return { ok: true };
}`;

const EDIT_HOST_FN = `function() {
  const el = this;
  if (!(el instanceof HTMLElement) || !el.isContentEditable) return el;
  for (let node = el; node; node = node.parentElement) {
    if (node.hasAttribute("contenteditable") && node.contentEditable !== "false") return node;
  }
  return el;
}`;

// Composed focus: the element is active in its own tree and every enclosing shadow host is active in its tree.
const FOCUS_FN = `function() {
  let node = this;
  if (!node || !node.isConnected) return { focused: false };
  for (;;) {
    const root = node.getRootNode();
    if (!root || root.activeElement !== node) return { focused: false };
    if (!(root instanceof ShadowRoot)) return { focused: true };
    node = root.host;
  }
}`;

const SELECT_CONTENTS_FN = `function() {
  const el = this;
  const focused = (${FOCUS_FN}).call(el).focused === true;
  if (!focused) return { focused: false };
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.select();
    const length = el.value.length;
    const measurable = el.selectionStart !== null && el.selectionEnd !== null;
    const selected = !measurable || (el.selectionStart === 0 && el.selectionEnd === length);
    return { focused: (${FOCUS_FN}).call(el).focused === true, selected };
  }
  if (el.isContentEditable) {
    const root = el.getRootNode();
    const selection = typeof root.getSelection === "function" ? root.getSelection() : el.ownerDocument.getSelection();
    if (!selection) return { focused, selected: false };
    const range = el.ownerDocument.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
    const current = selection.rangeCount ? selection.getRangeAt(0) : null;
    const inside = !!current && (current.commonAncestorContainer === el || el.contains(current.commonAncestorContainer));
    return { focused: (${FOCUS_FN}).call(el).focused === true, selected: inside };
  }
  return { focused, selected: false };
}`;

const READ_VALUE_FN = `function() {
  const el = this;
  if (!el) return "";
  if (typeof el.value === "string") return el.value;
  return el.textContent || "";
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
  if (el.matches(":disabled")) return { ok: false, reason: "disabled" };
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

const CHECK_STATE_FN = `function() {
  const el = this;
  if (!(el instanceof HTMLInputElement) || (el.type !== "checkbox" && el.type !== "radio")) return { reason: "not-checkable" };
  if (el.matches(":disabled")) return { reason: "disabled" };
  const labels = Array.from(el.labels || []).filter(label => label.control === el);
  return { type: el.type, checked: el.checked, labels: labels.length };
}`;

const LABEL_AT_FN = `function(index) {
  const labels = Array.from(this.labels || []).filter(label => label.control === this);
  return labels[index] || null;
}`;

// Offsets from the label's box: its own text first, then its line boxes, skipping text inside nested controls.
const LABEL_POINTS_FN = `function() {
  const label = this;
  const box = label.getBoundingClientRect();
  const root = label.getRootNode();
  const blocked = ${JSON.stringify(INDEPENDENT_CONTROL)};
  const points = [];
  const walker = label.ownerDocument.createTreeWalker(label, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text && points.length < 12; text = walker.nextNode()) {
    if (!text.textContent.trim()) continue;
    const parent = text.parentElement;
    if (parent && parent !== label && parent.closest(blocked) && label.contains(parent.closest(blocked))) continue;
    const range = label.ownerDocument.createRange();
    range.selectNodeContents(text);
    for (const rect of range.getClientRects()) {
      if (rect.width > 1 && rect.height > 1) points.push({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    }
  }
  for (const rect of label.getClientRects()) {
    if (rect.width > 1 && rect.height > 1) points.push({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  }
  const usable = points.filter(point => {
    const hit = typeof root.elementFromPoint === "function" ? root.elementFromPoint(point.x, point.y) : null;
    for (let node = hit; node; node = node.parentNode || (node instanceof ShadowRoot ? node.host : null)) {
      if (node === label || node === label.control) return true;
      if (node.nodeType === 1 && node.matches(blocked)) return false;
    }
    return false;
  });
  return usable.map(point => ({ dx: point.x - box.left, dy: point.y - box.top }));
}`;

// Click handlers, including ones that call preventDefault(), finish before the state is read.
const SETTLED_STATE_FN = `function() {
  const el = this;
  const view = el.ownerDocument.defaultView;
  return new Promise(resolve => {
    const done = () => resolve({ checked: !!el.checked });
    const timeout = view.setTimeout(() => { view.cancelAnimationFrame(frame); done(); }, 50);
    const frame = view.requestAnimationFrame(() => { view.clearTimeout(timeout); done(); });
  });
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
