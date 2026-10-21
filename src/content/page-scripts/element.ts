/** Compiled together for CDP injection; helpers may share this module, never Background closures. */
function elementSelector(target: Element, { includeRoot = false, maxParts = Infinity, ancestorIdTag = false } = {}): string {
  if (target.id) return `#${escapeIdentifier(target.id)}`;
  const parts: string[] = [];
  let node: Element | null = target;
  while (node && node.nodeType === Node.ELEMENT_NODE && (includeRoot || node !== document.documentElement) && parts.length < maxParts) {
    let part = node.localName || node.tagName.toLowerCase();
    if (!part) break;
    if (node.id) {
      parts.unshift(`${ancestorIdTag ? part : ''}#${escapeIdentifier(node.id)}`);
      break;
    }
    const parent: Element | null = node.parentElement;
    if (parent) {
      const localName = node.localName;
      const siblings = Array.from(parent.children).filter(child => child.localName === localName);
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    node = parent;
  }
  return parts.join(' > ');
}
function escapeIdentifier(value: string): string {
  return typeof globalThis.CSS?.escape === 'function' ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, char => `\\${char}`);
}

const MAX_PATH_PARTS = 40;
const MAX_SHADOW_HOSTS = 8;

/** Full path from this node to its document or shadow root. Empty when that path cannot be completed. */
function pathWithinRoot(node: Element): string {
  const parts: string[] = [];
  let current: Element | null = node;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    if (parts.length >= MAX_PATH_PARTS) return '';
    let part = current.localName || '';
    if (!part) return '';
    const root = current.getRootNode();
    if (current.id) {
      const id = `#${escapeIdentifier(current.id)}`;
      try {
        const owner: ParentNode = root instanceof ShadowRoot ? root : document;
        if (owner.querySelectorAll(id).length === 1) {
          parts.unshift(id);
          return parts.join(' > ');
        }
      } catch { /* A duplicate or invalid id keeps the structural path. */ }
    }
    const parent: Element | null = current.parentElement;
    const container: ParentNode | null = parent || (current.parentNode instanceof ShadowRoot ? current.parentNode : null);
    if (container) {
      const localName = current.localName;
      const siblings = Array.from(container.children).filter(child => child.localName === localName);
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    }
    parts.unshift(part);
    if (!parent || parent.getRootNode() !== root) return parts.join(' > ');
    current = parent;
  }
  return parts.join(' > ');
}

/**
 * Selector for a connected element in the current window.
 * A shadow result is `host >>> inner`, and each step reaches its own root so querySelector matches once.
 */
export function describeElement(value: unknown) {
  const el = value instanceof Element ? value : value instanceof Node ? value.parentElement : null;
  if (!el || !el.isConnected) return { missing: true as const };
  const steps: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === Node.ELEMENT_NODE && steps.length < MAX_SHADOW_HOSTS) {
    const step = pathWithinRoot(node);
    if (!step) return { missing: true as const };
    steps.unshift(step);
    const root: Node = node.getRootNode();
    if (!(root instanceof ShadowRoot)) break;
    const host: Element = root.host;
    if (!(host instanceof Element)) return { missing: true as const };
    node = host;
  }
  if (el.getRootNode() instanceof ShadowRoot) {
    if (node?.getRootNode() instanceof ShadowRoot) return { missing: true as const };
    return { shadowPath: steps.join(' >>> ') };
  }
  const selector = steps[0] || '';
  if (!selector) return { missing: true as const };
  try {
    const matches = document.querySelectorAll(selector);
    if (matches.length === 1 && matches[0] === el) return { selector };
  } catch { /* An unusable selector is not a target. */ }
  return { ambiguous: true as const };
}

/** Page-world entry for a backend node. A child frame is reported instead of being given a top-document selector. */
export function locate(value: unknown) {
  const el = value instanceof Element ? value : value instanceof Node ? value.parentElement : null;
  if (!el || !el.isConnected) return { missing: true as const };
  try {
    if (window.top !== window) return { inFrame: true as const };
  } catch {
    return { inFrame: true as const };
  }
  return describeElement(el);
}
function nodeOf(value: unknown): Element | null {
  return value instanceof Element ? value : null;
}

function nodeOpenShadow(element: Element): ShadowRoot | null {
  return element.shadowRoot || null;
}

function nodeDeepActive(): Element | null {
  let node = document.activeElement;
  const seen = new Set<Element>();
  while (node && !seen.has(node)) {
    seen.add(node);
    const inner = nodeOpenShadow(node)?.activeElement || null;
    if (!inner || inner === node) break;
    node = inner;
  }
  return node;
}

function nodeComposedParent(node: Node): Element | null {
  if (node instanceof Element && node.parentElement) return node.parentElement;
  const root = node.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

function nodeContains(ancestor: Element, node: Node | null): boolean {
  let current: Node | null = node;
  const seen = new Set<Node>();
  while (current && !seen.has(current)) {
    if (current === ancestor) return true;
    seen.add(current);
    current = nodeComposedParent(current);
  }
  return false;
}

function nodeTopAt(x: number, y: number): Element | null {
  let hit = document.elementFromPoint(x, y);
  const seen = new Set<Element>();
  while (hit && !seen.has(hit)) {
    seen.add(hit);
    const inner = nodeOpenShadow(hit)?.elementFromPoint(x, y) || null;
    if (!inner || inner === hit) break;
    hit = inner;
  }
  return hit;
}

function nodeDisabled(el: Element): boolean {
  return ("disabled" in el && !!el.disabled) || !!el.closest(":disabled") || el.getAttribute("aria-disabled") === "true";
}

function nodeReadOnly(el: Element): boolean {
  return ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.readOnly)
    || el.getAttribute("aria-readonly") === "true";
}

function nodeRect(el: Element) {
  const rect = el.getBoundingClientRect();
  return { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) };
}

function nodeControlPoints(el: Element): { x: number; y: number }[] {
  return [...el.getClientRects()]
    .filter(rect => rect.width > 0 && rect.height > 0)
    .flatMap(rect => {
      const y = Math.round(rect.top + rect.height / 2);
      const inset = Math.min(6, rect.width / 3);
      return [rect.left + inset, rect.left + rect.width / 2, rect.right - inset].map(x => ({ x: Math.round(x), y }));
    });
}

function nodePoint(el: Element): { x: number; y: number } | null {
  const rects = [...el.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
  const rect = rects.find(item => item.width > 1 && item.height > 1) || rects[0];
  if (!rect) return null;
  return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
}

function nodeInViewport(point: { x: number; y: number } | null): boolean {
  if (!point) return false;
  return point.x >= 0 && point.y >= 0 && point.x <= window.innerWidth && point.y <= window.innerHeight;
}

function nodeVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) !== 0;
}

/** The resolved node accepts this hit when the hit is itself, a descendant, or its own label. */
export function acceptsHit(value: unknown, hit: unknown): boolean {
  const el = nodeOf(value);
  const target = hit instanceof Element ? hit : null;
  if (!el || !target) return false;
  if (blocksControl(target, el)) return false;
  if (target === el || nodeContains(el, target)) return true;
  if (el instanceof HTMLInputElement) {
    const labels = [...(el.labels || [])];
    const ancestor = el.closest("label");
    if (ancestor && !labels.includes(ancestor)) labels.push(ancestor);
    return labels.some(label => (target === label || nodeContains(label, target)) && !blocksControl(target, el));
  }
  return false;
}

function blocksControl(hit: Element, control: Element): boolean {
  let node: Element | null = hit;
  const seen = new Set<Element>();
  while (node && node !== control && !seen.has(node)) {
    seen.add(node);
    if (node.matches("a[href], area[href], button, input, select, textarea, [contenteditable]:not([contenteditable='false']), [role='button'], [role='link']")) {
      return true;
    }
    node = nodeComposedParent(node);
  }
  return false;
}

function nodeSummary(el: Element) {
  const root = el.getRootNode();
  const point = nodePoint(el);
  const rect = nodeRect(el);
  return {
    tag: el.tagName.toLowerCase(),
    type: el.getAttribute("type") || "",
    role: el.getAttribute("role") || "",
    name: el.getAttribute("aria-label") || el.getAttribute("alt") || "",
    value: el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
      ? String(el.value || "")
      : (el instanceof HTMLElement && el.isContentEditable ? el.textContent || "" : ""),
    visible: nodeVisible(el),
    disabled: nodeDisabled(el),
    readonly: nodeReadOnly(el),
    checked: "checked" in el ? !!el.checked : undefined,
    href: el instanceof HTMLAnchorElement ? el.href : (el.getAttribute("href") || ""),
    rect,
    clickablePoint: point,
    inShadowRoot: root instanceof ShadowRoot,
    shadowMode: root instanceof ShadowRoot ? root.mode : undefined,
    focused: nodeDeepActive() === el,
    state: {
      inViewport: rect.w > 0 && rect.x < window.innerWidth && rect.y < window.innerHeight && rect.x + rect.w > 0 && rect.y + rect.h > 0,
      clickablePointInViewport: nodeInViewport(point),
      obscuredAtCenter: nodeObscured(el, point),
    },
  };
}

/** Closed-shadow occlusion is decided by the CDP hit node, which can see inside the root. */
function nodeObscured(el: Element, point: { x: number; y: number } | null): boolean {
  if (!point) return false;
  const root = el.getRootNode();
  if (root instanceof ShadowRoot && root.mode === "closed") return false;
  const top = nodeTopAt(point.x, point.y);
  return !!top && !acceptsHit(el, top);
}

function nodeClickPlan(el: Element) {
  if (nodeDisabled(el)) return { ...nodeSummary(el), code: "ELEMENT_DISABLED", error: "Element is disabled" };
  el.scrollIntoView({ behavior: "instant", block: "center", inline: "center" });
  const summary = nodeSummary(el);
  const point = summary.clickablePoint;
  if (!point) {
    const href = summary.href;
    if (href) return { ...summary, navigateUrl: href, href };
    return { ...summary, code: "NO_CLICKABLE_TARGET", error: "Element has no visible clickable box" };
  }
  if (summary.state.obscuredAtCenter) {
    return { ...summary, code: "ELEMENT_OBSCURED", error: "Element is covered by another element" };
  }
  return summary;
}

function nodeCheckPlan(el: Element) {
  if (!(el instanceof HTMLInputElement) || !["checkbox", "radio"].includes(el.type)) {
    return { ...nodeSummary(el), code: "NOT_CHECKABLE_ELEMENT", error: "Element is not a checkbox or radio" };
  }
  if (nodeDisabled(el)) return { ...nodeSummary(el), code: "ELEMENT_DISABLED", error: "Element is disabled" };
  const labels = [...(el.labels || [])].filter(label => label.control === el);
  const ancestor = el.closest("label");
  if (ancestor && !labels.includes(ancestor)) labels.push(ancestor);
  const closed = el.getRootNode() instanceof ShadowRoot && (el.getRootNode() as ShadowRoot).mode === "closed";
  for (const candidate of [...labels, el]) {
    if (!nodeVisible(candidate)) continue;
    candidate.scrollIntoView({ behavior: "instant", block: "center", inline: "center" });
    const points = nodeControlPoints(candidate);
    for (const point of points) {
      if (!nodeInViewport(point)) continue;
      const top = nodeTopAt(point.x, point.y);
      if (!(closed || (top && acceptsHit(el, top)))) continue;
      const summary = nodeSummary(el);
      return {
        ...summary,
        visible: true,
        clickablePoint: point,
        state: { ...summary.state, inViewport: true, obscuredAtCenter: false, clickablePointInViewport: true },
      };
    }
  }
  return { ...nodeSummary(el), state: { ...nodeSummary(el).state, obscuredAtCenter: true }, code: "ELEMENT_OBSCURED", error: "Checkbox has no clickable point on itself or its label" };
}

function nodePrepareFill(el: Element, value: string) {
  if (nodeDisabled(el)) return { code: "ELEMENT_DISABLED", error: "Element is disabled", ...nodeSummary(el) };
  const target = el instanceof HTMLElement && el.isContentEditable ? contentEditableRoot(el) : el;
  if (nodeDisabled(target) || nodeReadOnly(el) || nodeReadOnly(target)) {
    return { code: nodeReadOnly(el) || nodeReadOnly(target) ? "ELEMENT_READONLY" : "ELEMENT_DISABLED", error: "Element cannot be edited", ...nodeSummary(target) };
  }
  const editable = target instanceof HTMLTextAreaElement
    || (target instanceof HTMLInputElement && ["text", "search", "tel", "url", "password", "email", "number"].includes(target.type))
    || (target instanceof HTMLElement && target.isContentEditable);
  if (!editable) return { code: "NOT_EDITABLE_ELEMENT", error: "Element is not editable", ...nodeSummary(el) };
  target.scrollIntoView({ behavior: "instant", block: "center" });
  if (target instanceof HTMLElement) target.focus({ preventScroll: true });
  if (nodeDeepActive() !== target) return { code: "ELEMENT_FOCUS_FAILED", error: "Element could not receive focus", ...nodeSummary(target) };
  const multiline = /\r|\n/.test(value) && target instanceof HTMLElement && target.isContentEditable;
  if (!multiline && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) target.select();
  if (!multiline && target instanceof HTMLElement && target.isContentEditable && !selectContents(target)) {
    return { code: "ELEMENT_SELECTION_FAILED", error: "Element contents could not be selected", ...nodeSummary(target) };
  }
  if (nodeDeepActive() !== target) return { code: "ELEMENT_FOCUS_FAILED", error: "Element lost focus while selecting its contents", ...nodeSummary(target) };
  return { ...nodeSummary(target), fillMode: multiline ? "content" : "text", contentEditable: target instanceof HTMLElement && target.isContentEditable };
}

function contentEditableRoot(el: HTMLElement): HTMLElement {
  let node: HTMLElement | null = el;
  while (node) {
    if (node.hasAttribute("contenteditable") && node.contentEditable !== "false") return node;
    node = node.parentElement;
  }
  return el;
}

function selectContents(el: Element): boolean {
  const selection = window.getSelection();
  if (!selection) return false;
  const range = document.createRange();
  range.selectNodeContents(el);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

function nodeFillRich(el: Element, value: string) {
  const target = el instanceof HTMLElement && el.isContentEditable ? contentEditableRoot(el) : el;
  if (!(target instanceof HTMLElement)) return { code: "NOT_EDITABLE_ELEMENT", error: "Element is not editable" };
  const text = String(value ?? "").replace(/\r\n?/g, "\n");
  const html = text.split("\n").map(line => `<p>${line ? line.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char] || char)) : "<br>"}</p>`).join("");
  target.focus();
  selectContents(target);
  let method = "innerHTML";
  try {
    if (document.execCommand("insertHTML", false, html)) method = "insertHTML";
    else target.innerHTML = html;
  } catch {
    target.innerHTML = html;
  }
  target.dispatchEvent(new Event("input", { bubbles: true }));
  target.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, method, ...nodeSummary(target) };
}

function nodeSelect(el: Element, value: string) {
  if (!(el instanceof HTMLSelectElement)) return { code: "NOT_SELECT_ELEMENT", error: "Element is not a select", ...nodeSummary(el) };
  if (nodeDisabled(el)) return { code: "ELEMENT_DISABLED", error: "Element is disabled", ...nodeSummary(el) };
  const rawWanted = String(value ?? "");
  const labelWanted = rawWanted.trim();
  const options = Array.from(el.options);
  let matchIndex = options.findIndex(option => option.value === rawWanted);
  if (matchIndex < 0 && labelWanted) matchIndex = options.findIndex(option => String(option.label || "").trim() === labelWanted);
  if (matchIndex < 0) {
    return { code: "OPTION_NOT_FOUND", error: `No option matched value or label: ${labelWanted}`, ...nodeSummary(el) };
  }
  el.selectedIndex = matchIndex;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  const selected = options[matchIndex];
  return { ...nodeSummary(el), selected: selected?.value || "", selectedLabel: String(selected?.label || "").trim() };
}

function nodeImage(el: Element) {
  const img = el instanceof HTMLImageElement ? el : el.querySelector("img");
  if (!(img instanceof HTMLImageElement)) return { code: "NO_IMAGE_ELEMENT", error: "Element is not an image", ...nodeSummary(el) };
  return {
    ...nodeSummary(img),
    src: img.currentSrc || img.src || "",
    currentSrc: img.currentSrc || img.src || "",
    alt: img.alt || "",
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
  };
}

/**
 * One operation against the already resolved DOM node.
 * The caller releases the CDP object after this returns. No selector is consulted.
 */
export function act(value: unknown, request: { action?: string; value?: string } = {}, hit: unknown = null) {
  const el = nodeOf(value);
  if (!el || !el.isConnected) return { missing: true as const };
  try {
    if (window.top !== window) return { inFrame: true as const };
  } catch {
    return { inFrame: true as const };
  }
  const action = String(request.action || "");
  if (action === "inspect") return nodeSummary(el);
  if (action === "clickPlan" || action === "pressPlan") return nodeClickPlan(el);
  if (action === "checkPlan") return nodeCheckPlan(el);
  if (action === "prepareFill") return nodePrepareFill(el, String(request.value || ""));
  if (action === "readState") {
    // A click handler may roll the control back on the next frame. Read after that frame.
    return new Promise(resolve => {
      window.setTimeout(() => window.requestAnimationFrame(() => resolve(nodeSummary(el))), 50);
    });
  }
  if (action === "fillRich") return nodeFillRich(el, String(request.value || ""));
  if (action === "select") return nodeSelect(el, String(request.value || ""));
  if (action === "scroll") {
    el.scrollIntoView({ behavior: "instant", block: "center", inline: "center" });
    return { scrolledTo: true, ...nodeSummary(el) };
  }
  if (action === "focus") {
    if (el instanceof HTMLElement) el.focus({ preventScroll: true });
    return { ...nodeSummary(el), focused: nodeDeepActive() === el };
  }
  if (action === "image") return nodeImage(el);
  if (action === "acceptsHit") return { ok: acceptsHit(el, hit) };
  if (action === "containsPoint") {
    const [x, y] = String(request.value || "").split(",").map(Number);
    return { ok: acceptsHit(el, nodeTopAt(x, y)) };
  }
  return { code: "UNKNOWN_ELEMENT_ACTION", error: `Unknown element action: ${action}` };
}

export function selector(value: unknown): string {
  const element = value instanceof Element ? value : value instanceof Node ? value.parentElement : null;
  return element ? elementSelector(element, { includeRoot: true, maxParts: 12, ancestorIdTag: true }) : '';
}
export function bounds(value: unknown) {
  if (!(value instanceof Element)) return { error: 'Resolved node is not an Element' };
  const rect = value.getBoundingClientRect();
  const box = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  if (rect.width <= 0 || rect.height <= 0) return { error: 'Element has no rendered box to screenshot', rect: box };
  const vv = window.visualViewport;
  const pageX = vv && Number.isFinite(vv.pageLeft) ? vv.pageLeft : window.scrollX;
  const pageY = vv && Number.isFinite(vv.pageTop) ? vv.pageTop : window.scrollY;
  return {
    selector: elementSelector(value),
    bounds: { x: rect.left + pageX, y: rect.top + pageY, width: rect.width, height: rect.height },
    rect: box,
    viewport: {
      pageX, pageY, scrollX: window.scrollX, scrollY: window.scrollY,
      scale: vv && Number.isFinite(vv.scale) ? vv.scale : 1,
      width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio || 1,
    },
  };
}
