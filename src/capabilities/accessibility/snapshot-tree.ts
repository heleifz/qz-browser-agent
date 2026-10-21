/** Accessibility snapshot tree. Frame trees are grafted in; the node budget stays breadth-first. */

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
}

export function buildPageSnapshot(sources: SnapshotSource[], options: {
  snapshotId: string;
  limit: number;
  maxDepth: number;
  rootBackendNodeId?: number;
  rootFrameId?: string;
}): BuiltSnapshot {
  const buildDepth = options.rootBackendNodeId ? 400 : options.maxDepth;
  const grafted = graftFrames(sources, buildDepth);
  let roots = grafted.roots;
  let rootFound = true;
  if (options.rootBackendNodeId) {
    const wantedFrame = options.rootFrameId || "";
    const match = grafted.nodes.find(node =>
      node.compact.backendNodeId === options.rootBackendNodeId
      && (!wantedFrame || node.compact.frameId === wantedFrame));
    if (match) {
      match.parent = null;
      limitDepth(match, options.maxDepth);
      roots = [match];
    } else {
      roots = [];
    }
    rootFound = !!match;
  }
  const semanticNodes = flatten(roots);
  const included = selectSemanticNodesByBreadth(roots, options.limit);
  const mainFrameId = sources[0]?.frameId || "";
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
  const truncatedNodeCount = Math.max(0, semanticNodes.length - nodes.length);
  return {
    snapshot: nodes.map(node => formatSnapshotLine(node, frameIndex)).join("\n"),
    nodes,
    nodeCount: sources.reduce((sum, source) => sum + (source.nodes?.length || 0), 0),
    semanticNodeCount: semanticNodes.length,
    returnedNodeCount: nodes.length,
    truncatedNodeCount,
    outlineTruncated: truncatedNodeCount > 0,
    rootFound,
  };
}

/** Cover more sibling branches before going deeper. Output is still emitted in tree order. */
export function selectSemanticNodesByBreadth(roots: SemanticNode[], limit: number) {
  const maxNodes = Math.max(0, Number(limit) || 0);
  const included = new Set<SemanticNode>();
  const queue = Array.isArray(roots) ? roots.slice() : [];
  for (let index = 0; index < queue.length && included.size < maxNodes; index += 1) {
    const node = queue[index];
    if (!node || included.has(node)) continue;
    included.add(node);
    for (const child of node.children) queue.push(child);
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

function limitDepth(node: SemanticNode, maxDepth: number) {
  const prune = (current: SemanticNode, depth: number) => {
    current.depth = depth;
    if (depth + 1 >= maxDepth) current.children = [];
    else for (const child of current.children) prune(child, depth + 1);
  };
  node.parent = null;
  prune(node, 0);
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
  const hasContent = !!(node.name || node.value || node.description || node.url || node.flags.length);
  if ((role === "none" || role === "generic") && !hasContent) return false;
  if (!role && !hasContent) return false;
  return true;
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
