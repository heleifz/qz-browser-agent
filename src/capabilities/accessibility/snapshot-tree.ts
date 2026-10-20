/** Pure page-snapshot tree: pruning, budget, and viewport scope. No browser calls. */

export interface AxNode {
  nodeId: string;
  parentId?: string;
  childIds?: string[];
  backendDOMNodeId?: number;
  ignored?: boolean;
  role?: { value?: unknown };
  name?: { value?: unknown };
  description?: { value?: unknown };
  value?: { value?: unknown };
  properties?: { name?: string; value?: { value?: unknown } }[];
}

export interface SnapshotSource {
  frameId: string;
  oopif?: boolean;
  parentFrameId?: string;
  iframeBackendNodeId?: number;
  nodes: AxNode[];
}

/** Box in the top page's viewport coordinates. */
export interface ViewportBox {
  frameId: string;
  backendNodeId: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface CompactNode {
  nodeId: string;
  backendNodeId?: number;
  ignored: boolean;
  role: string;
  name: string;
  description: string;
  value: string;
  url: string;
  flags: string[];
  frameId: string;
  oopif: boolean;
}

interface SemanticNode {
  compact: CompactNode;
  depth: number;
  parent: SemanticNode | null;
  children: SemanticNode[];
}

export interface SnapshotDisplayNode {
  uid: string;
  target: string;
  depth: number;
  nodeId: string;
  parentUid?: string;
  truncated?: boolean;
  backendNodeId?: number;
  frameId?: string;
  oopif?: boolean;
  role?: string;
  name?: string;
  value?: string;
  description?: string;
  url?: string;
  flags?: string[];
  ignored?: boolean;
}

export interface BuiltSnapshot {
  snapshot: string;
  nodes: SnapshotDisplayNode[];
  nodeCount: number;
  semanticNodeCount: number;
  returnedNodeCount: number;
  truncatedNodeCount: number;
  outlineTruncated: boolean;
  rootFound: boolean;
  scope: "viewport" | "page";
  offscreenAbove: number;
  offscreenBelow: number;
}

export const INTERACTIVE_ROLES = new Set([
  "button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox", "listbox", "option",
  "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "switch", "slider", "spinbutton", "treeitem",
]);

const LAYOUT_ROLES = new Set(["LayoutTable", "LayoutTableRow", "LayoutTableCell"]);
const CONTAINER_ROLES = new Set([
  "generic", "none", "group", "section", "Section", "LabelText", "list", "listitem",
  "row", "cell", "paragraph", "Div", "Pre", "Abbr", "Ruby", "time", "Figcaption",
]);

export function buildPageSnapshot(sources: SnapshotSource[], options: {
  snapshotId: string;
  limit: number;
  maxDepth: number;
  scope: "viewport" | "page";
  viewport: { width: number; height: number };
  boxes: ViewportBox[];
  rootBackendNodeId?: number;
  rootFrameId?: string;
  subtree?: boolean;
}): BuiltSnapshot {
  const scope = options.scope === "page" ? "page" : "viewport";
  const subtree = options.subtree === true;
  const boxes = new Map<string, ViewportBox>();
  for (const box of options.boxes || []) {
    if (!box || !Number.isFinite(box.backendNodeId)) continue;
    const key = boxKey(box.frameId, box.backendNodeId);
    const prev = boxes.get(key);
    if (!prev || box.w * box.h > prev.w * prev.h) boxes.set(key, box);
  }
  const mainFrameId = sources[0]?.frameId || "";
  const grafted = graftFrames(sources, options.maxDepth);
  let roots = grafted.roots;
  let rootFound = true;
  if (options.rootBackendNodeId) {
    const wantedFrame = options.rootFrameId || "";
    const match = grafted.nodes.find(node =>
      node.compact.backendNodeId === options.rootBackendNodeId
      && (!wantedFrame || node.compact.frameId === wantedFrame));
    roots = match ? [match] : [];
    rootFound = !!match;
    if (match) {
      match.parent = null;
      setDepth(match, 0);
    }
  }
  roots = roots.map(node => dedupText(node)).map(node => relink(node));
  roots = roots.flatMap(node => collapse(node, true)).map(node => relink(node));
  const semanticNodes = flatten(roots);
  const offscreen = countOffscreen(semanticNodes, boxes, options.viewport);
  const viewportReady = options.viewport.width > 0 && options.viewport.height > 0;
  const prune = scope === "viewport" && !subtree && !options.rootBackendNodeId && viewportReady;
  if (prune) {
    roots = pruneToViewport(roots, boxes, options.viewport).map(node => relink(node));
  }
  const place = scope === "page" && !subtree
    ? (node: SemanticNode) => viewportPlace(node, boxes, options.viewport)
    : () => 0;
  const included = selectSnapshotNodes(roots, options.limit, place);
  const frameIndex = new Map<string, number>();
  let nextFrame = 1;
  for (const source of sources) {
    if (!source.frameId || source.frameId === mainFrameId || frameIndex.has(source.frameId)) continue;
    frameIndex.set(source.frameId, nextFrame);
    nextFrame += 1;
  }
  const nodes: SnapshotDisplayNode[] = [];
  let counter = 0;
  const emit = (node: SemanticNode, parentUid: string | null) => {
    if (!included.has(node)) return;
    const uid = `${options.snapshotId}_${counter++}`;
    const compact = node.compact;
    const item: SnapshotDisplayNode = {
      uid,
      target: `uid:${uid}`,
      depth: node.depth,
      nodeId: compact.nodeId,
    };
    if (parentUid) item.parentUid = parentUid;
    if (compact.backendNodeId) item.backendNodeId = compact.backendNodeId;
    if (compact.frameId && compact.frameId !== mainFrameId) {
      item.frameId = compact.frameId;
      if (compact.oopif) item.oopif = true;
    }
    if (compact.role) item.role = compact.role;
    if (compact.name) item.name = compact.name;
    if (compact.value) item.value = compact.value;
    if (compact.description) item.description = compact.description;
    if (compact.url) item.url = compact.url;
    if (compact.flags.length) item.flags = compact.flags;
    if (compact.ignored) item.ignored = true;
    if (node.children.some(child => !included.has(child))) item.truncated = true;
    nodes.push(item);
    for (const child of node.children) emit(child, uid);
  };
  for (const root of roots) emit(root, null);
  const lines = nodes.map(node => formatSnapshotLine(node, frameIndex));
  if (prune && (offscreen.above || offscreen.below)) {
    lines.push(`offscreen above=${offscreen.above} below=${offscreen.below}`);
  }
  const truncatedNodeCount = Math.max(0, semanticNodes.length - nodes.length);
  return {
    snapshot: lines.join("\n"),
    nodes,
    nodeCount: sources.reduce((sum, source) => sum + (source.nodes?.length || 0), 0),
    semanticNodeCount: semanticNodes.length,
    returnedNodeCount: nodes.length,
    truncatedNodeCount,
    outlineTruncated: truncatedNodeCount > 0,
    rootFound,
    scope: prune ? "viewport" : scope,
    offscreenAbove: offscreen.above,
    offscreenBelow: offscreen.below,
  };
}

/** Prefer interactive nodes, then headings and named leaves. Ancestors are included so the result stays a tree. */
export function selectSnapshotNodes(roots: SemanticNode[], limit: number, place: (node: SemanticNode) => number = () => 0) {
  const order: SemanticNode[] = [];
  const seen = new Set<SemanticNode>();
  const walk = (node: SemanticNode) => {
    if (seen.has(node)) return;
    seen.add(node);
    order.push(node);
    for (const child of node.children) walk(child);
  };
  for (const root of roots) walk(root);
  const rank = (node: SemanticNode) => {
    if (INTERACTIVE_ROLES.has(node.compact.role)) return 0;
    if (node.compact.role === "heading" || (node.compact.name && node.children.length === 0)) return 1;
    return 2;
  };
  const ranked = order
    .map((node, index) => ({ node, index, rank: rank(node), place: place(node) }))
    .sort((a, b) => a.rank - b.rank || a.place - b.place || a.index - b.index);
  const maxNodes = Math.max(0, Number(limit) || 0);
  const included = new Set<SemanticNode>();
  for (const entry of ranked) {
    const chain: SemanticNode[] = [];
    for (let current: SemanticNode | null = entry.node; current && !included.has(current); current = current.parent) {
      chain.push(current);
    }
    if (included.size + chain.length > maxNodes) continue;
    for (const node of chain) included.add(node);
    if (included.size >= maxNodes) break;
  }
  return included;
}

function graftFrames(sources: SnapshotSource[], maxDepth: number) {
  const built = new Map<string, { roots: SemanticNode[]; nodes: SemanticNode[] }>();
  const building = new Set<string>();
  const build = (source: SnapshotSource, depthLeft: number) => {
    if (building.has(source.frameId)) return built.get(source.frameId) || { roots: [], nodes: [] };
    building.add(source.frameId);
    const tree = buildSemanticTree(source, depthLeft);
    built.set(source.frameId, tree);
    for (const child of sources) {
      if (!child.parentFrameId || child.parentFrameId !== source.frameId) continue;
      const host = child.iframeBackendNodeId
        ? tree.nodes.find(node => node.compact.backendNodeId === child.iframeBackendNodeId)
        : undefined;
      const left = host ? Math.max(1, depthLeft - host.depth - 1) : depthLeft;
      const childTree = build(child, left);
      const parent = host || tree.roots[0];
      if (!parent) continue;
      for (const root of childTree.roots) {
        root.parent = parent;
        parent.children.push(root);
        setDepth(root, parent.depth + 1);
      }
    }
    return tree;
  };
  const main = sources[0];
  if (!main) return { roots: [] as SemanticNode[], nodes: [] as SemanticNode[] };
  build(main, maxDepth);
  const roots = built.get(main.frameId)?.roots || [];
  return { roots, nodes: flatten(roots) };
}

function buildSemanticTree(source: SnapshotSource, maxDepth: number) {
  const nodeMap = new Map<string, AxNode>();
  for (const node of source.nodes || []) {
    if (node?.nodeId) nodeMap.set(node.nodeId, node);
  }
  const roots = [...nodeMap.values()].filter(node => !node.parentId || !nodeMap.has(node.parentId));
  const semanticRoots: SemanticNode[] = [];
  const semanticNodes: SemanticNode[] = [];
  const seen = new Set<string>();
  // Ignored nodes do not advance semantic depth. Walk with an explicit stack so a deep or cyclic
  // raw tree cannot overflow the call stack.
  const stack: Array<{ raw: AxNode; depth: number; parent: SemanticNode | null; rawDepth: number }> = [];
  for (let index = roots.length - 1; index >= 0; index -= 1) {
    stack.push({ raw: roots[index], depth: 0, parent: null, rawDepth: 0 });
  }
  while (stack.length) {
    const current = stack.pop();
    if (!current || seen.has(current.raw.nodeId) || current.rawDepth > 400) continue;
    seen.add(current.raw.nodeId);
    const compact = compactAxNode(current.raw, source);
    const keep = shouldKeepAxNode(compact, current.depth);
    let nextDepth = current.depth;
    let nextParent = current.parent;
    if (keep) {
      const semantic: SemanticNode = { compact, depth: current.depth, parent: current.parent, children: [] };
      semanticNodes.push(semantic);
      if (current.parent) current.parent.children.push(semantic);
      else semanticRoots.push(semantic);
      nextDepth = current.depth + 1;
      nextParent = semantic;
    }
    if (nextDepth >= maxDepth) continue;
    const childIds = current.raw.childIds || [];
    for (let index = childIds.length - 1; index >= 0; index -= 1) {
      const child = nodeMap.get(childIds[index]);
      if (child) stack.push({ raw: child, depth: nextDepth, parent: nextParent, rawDepth: current.rawDepth + 1 });
    }
  }
  return { roots: semanticRoots, nodes: semanticNodes };
}

function compactAxNode(node: AxNode, source: SnapshotSource): CompactNode {
  const props = axPropertiesToObject(node.properties || []);
  return {
    nodeId: node.nodeId,
    backendNodeId: node.backendDOMNodeId,
    ignored: !!node.ignored,
    role: cleanAxValue(node.role?.value),
    name: cleanAxValue(node.name?.value),
    description: cleanAxValue(node.description?.value),
    value: cleanAxValue(node.value?.value),
    url: cleanAxValue(props.url),
    flags: ["focused", "disabled", "expanded", "checked", "selected", "editable", "readonly", "required"]
      .map(key => formatAxFlag(key, props[key]))
      .filter(Boolean),
    frameId: source.frameId,
    oopif: source.oopif === true,
  };
}

function shouldKeepAxNode(node: CompactNode, depth: number) {
  if (!node) return false;
  if (depth === 0) return true;
  if (node.ignored) return false;
  const role = String(node.role || "");
  if (role === "InlineTextBox") return false;
  const hasContent = hasOwnContent(node);
  if ((role === "none" || role === "generic") && !hasContent) return false;
  if (!role && !hasContent) return false;
  return true;
}

function hasOwnContent(node: CompactNode) {
  return !!(node.name || node.value || node.description || node.url || node.flags?.length);
}

function dedupText(node: SemanticNode, seen = new Set<SemanticNode>()): SemanticNode {
  if (seen.has(node)) return node;
  seen.add(node);
  const children = node.children
    .filter(child => child.compact.role !== "InlineTextBox")
    .filter(child => !(
      child.compact.role === "StaticText"
      && node.compact.name
      && child.compact.name === node.compact.name
      && child.children.every(grand => grand.compact.role === "InlineTextBox")
    ))
    .map(child => dedupText(child, seen));
  return { ...node, children };
}

function collapse(node: SemanticNode, isRoot: boolean, seen = new Set<SemanticNode>()): SemanticNode[] {
  if (seen.has(node)) return [];
  seen.add(node);
  const children = node.children.flatMap(child => collapse(child, false, seen));
  if (isRoot) return [{ ...node, children }];
  if (LAYOUT_ROLES.has(node.compact.role)) return children;
  if (CONTAINER_ROLES.has(node.compact.role) && !hasOwnContent(node.compact)) {
    if (children.length === 0) return [];
    if (children.length === 1) return children;
  }
  return [{ ...node, children }];
}

function relink(node: SemanticNode, parent: SemanticNode | null = null, depth = 0, seen = new Set<SemanticNode>()): SemanticNode {
  if (seen.has(node)) return node;
  seen.add(node);
  const next: SemanticNode = { compact: node.compact, parent, depth, children: [] };
  next.children = node.children.map(child => relink(child, next, depth + 1, seen));
  return next;
}

function setDepth(node: SemanticNode, depth: number, seen = new Set<SemanticNode>()) {
  if (seen.has(node)) return;
  seen.add(node);
  node.depth = depth;
  for (const child of node.children) setDepth(child, depth + 1, seen);
}

function flatten(roots: SemanticNode[]) {
  const nodes: SemanticNode[] = [];
  const seen = new Set<SemanticNode>();
  const walk = (node: SemanticNode) => {
    if (seen.has(node)) return;
    seen.add(node);
    nodes.push(node);
    for (const child of node.children) walk(child);
  };
  for (const root of roots) walk(root);
  return nodes;
}

function boxFor(node: SemanticNode, boxes: Map<string, ViewportBox>) {
  if (!node.compact.backendNodeId) return undefined;
  return boxes.get(boxKey(node.compact.frameId, node.compact.backendNodeId));
}

function intersectsViewport(box: ViewportBox, viewport: { width: number; height: number }) {
  return box.w > 0 && box.h > 0
    && box.x + box.w > 0 && box.y + box.h > 0
    && box.x < viewport.width && box.y < viewport.height;
}

function pruneToViewport(roots: SemanticNode[], boxes: Map<string, ViewportBox>, viewport: { width: number; height: number }) {
  const keep = (node: SemanticNode): SemanticNode | null => {
    const children = node.children.map(keep).filter((child): child is SemanticNode => !!child);
    const box = boxFor(node, boxes);
    const self = !!box && intersectsViewport(box, viewport);
    if (!self && children.length === 0 && node.depth !== 0) return null;
    return { ...node, children };
  };
  return roots.map(keep).filter((node): node is SemanticNode => !!node);
}

function viewportPlace(node: SemanticNode, boxes: Map<string, ViewportBox>, viewport: { width: number; height: number }) {
  const box = boxFor(node, boxes);
  if (!box || box.w <= 0 || box.h <= 0) return 2;
  if (intersectsViewport(box, viewport)) return 0;
  return box.y >= viewport.height ? 1 : 2;
}

function countOffscreen(nodes: SemanticNode[], boxes: Map<string, ViewportBox>, viewport: { width: number; height: number }) {
  let above = 0;
  let below = 0;
  for (const node of nodes) {
    if (!INTERACTIVE_ROLES.has(node.compact.role)) continue;
    const box = boxFor(node, boxes);
    if (!box || box.w <= 0 || box.h <= 0) continue;
    if (box.y + box.h <= 0) above += 1;
    else if (box.y >= viewport.height) below += 1;
  }
  return { above, below };
}

function formatSnapshotLine(node: SnapshotDisplayNode, frameIndex: Map<string, number>) {
  const attrs = [`target=${node.target}`];
  if (node.role) attrs.push(node.role);
  if (node.name) attrs.push(`"${truncateInline(node.name, 90)}"`);
  if (node.value && node.value !== node.name) attrs.push(`value="${truncateInline(node.value, 80)}"`);
  if (node.url) attrs.push(`url="${truncateInline(node.url, 120)}"`);
  const frame = node.frameId ? frameIndex.get(node.frameId) : 0;
  if (frame) attrs.push(`frame=${frame}`);
  for (const flag of node.flags || []) attrs.push(flag);
  if (node.truncated) attrs.push("(truncated)");
  return `${"  ".repeat(Math.max(0, Number(node.depth) || 0))}${attrs.join(" ")}`;
}

function truncateInline(value: unknown, max: number) {
  const text = cleanAxValue(value);
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function cleanAxValue(value: unknown) {
  if (value == null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function axPropertiesToObject(properties: NonNullable<AxNode["properties"]>) {
  const out: Record<string, unknown> = {};
  for (const prop of properties || []) {
    if (!prop?.name) continue;
    out[prop.name] = prop.value?.value;
  }
  return out;
}

function formatAxFlag(key: string, value: unknown) {
  if (value == null) return "";
  if (key === "expanded") return value ? "expanded" : "collapsed";
  if (key === "checked") return value === true ? "checked" : value === false ? "unchecked" : String(value);
  if (value === false) return "";
  return value === true ? key : `${key}=${cleanAxValue(value)}`;
}

function boxKey(frameId: string, backendNodeId: number) {
  return `${frameId}\u0000${backendNodeId}`;
}
