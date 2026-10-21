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
export function selector(value: unknown): string {
  const element = value instanceof Element ? value : value instanceof Node ? value.parentElement : null;
  return element ? elementSelector(element, { includeRoot: true, maxParts: 12, ancestorIdTag: true }) : '';
}
/** Reads a node in its own document, including closed shadow roots and frames a selector cannot reach. */
export function inspect(value: unknown) {
  const el = value instanceof Element ? value : value instanceof Node ? value.parentElement : null;
  if (!el || !el.isConnected) return { error: 'Element is not connected' };
  const root = el.getRootNode();
  const active = root instanceof ShadowRoot || root instanceof Document ? root.activeElement : null;
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  const attrs: Record<string, string> = {};
  for (const name of ['id', 'class', 'name', 'type', 'role', 'aria-label', 'placeholder', 'title', 'href', 'data-testid']) {
    const attr = el.getAttribute(name);
    if (attr) attrs[name] = attr.slice(0, 240);
  }
  let link: Element | null = null;
  for (let node: Node | null = el; node; node = node.parentNode || (node instanceof ShadowRoot ? node.host : null)) {
    if (node instanceof HTMLAnchorElement || node instanceof HTMLAreaElement) {
      if (node.hasAttribute('href')) { link = node; break; }
    }
  }
  const field = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement ? el : null;
  const form = field?.form || el.closest('form');
  const parentText = el.parentElement?.textContent?.trim().replace(/\s+/g, ' ').slice(0, 300) || '';
  return {
    tag: el.localName,
    type: el.getAttribute('type') || '',
    text: el.textContent?.trim().replace(/\s+/g, ' ').slice(0, 160) || '',
    value: field ? field.value : '',
    placeholder: el.getAttribute('placeholder') || '',
    href: link ? (link as HTMLAnchorElement).href : '',
    visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) !== 0,
    disabled: el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true',
    readonly: (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) ? el.readOnly : el.getAttribute('aria-readonly') === 'true',
    editable: (el instanceof HTMLInputElement && el.type !== 'file') || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
      || (el instanceof HTMLElement && el.isContentEditable),
    checked: el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio') ? el.checked : undefined,
    focused: active === el,
    inShadowRoot: root instanceof ShadowRoot,
    shadowMode: root instanceof ShadowRoot ? root.mode : undefined,
    attrs,
    form: form ? { action: form.getAttribute('action') || '', method: form.getAttribute('method') || 'get' } : null,
    nearbyText: parentText,
    frameRect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
  };
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
