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
