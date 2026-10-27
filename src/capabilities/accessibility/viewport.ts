import { directChildFrames, type CdpCommand } from "#sdk/background/browser";

type Fields = Record<string, unknown>;
interface Node {
  nodeId: string; parentId?: string; childIds?: string[]; backendDOMNodeId?: number;
  documentFrameId?: string; documentLoaderId?: string;
}
interface Rect { left: number; top: number; right: number; bottom: number }
const record = (value: unknown): Fields => value && typeof value === "object" ? value as Fields : {};
const key = (node: Node) => `${node.documentFrameId || ""}:${node.backendDOMNodeId}`;
const intersects = (a: Rect, b: Rect) => a.right > a.left && a.bottom > a.top && b.right > b.left && b.bottom > b.top
  && a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
function rect(quad: unknown): Rect | null {
  if (!Array.isArray(quad) || quad.length !== 8 || !quad.every(Number.isFinite)) return null;
  return { left: Math.min(quad[0], quad[2], quad[4], quad[6]), right: Math.max(quad[0], quad[2], quad[4], quad[6]),
    top: Math.min(quad[1], quad[3], quad[5], quad[7]), bottom: Math.max(quad[1], quad[3], quad[5], quad[7]) };
}

/** Uses the shared debugger's box-model operation (also implemented by the Firefox host).
 * Retains structural ancestors of visible nodes, not their offscreen descendants.
 * The bounded geometry scan is independent of the returned semantic-node budget.
 */
export async function viewportTree<T extends Node>(send: CdpCommand, nodes: T[], actions: Node[], signal?: AbortSignal) {
  const metrics = record(await send("Page.getLayoutMetrics"));
  const viewport = record(metrics.cssVisualViewport || metrics.visualViewport);
  const width = Number(viewport.clientWidth), height = Number(viewport.clientHeight);
  if (!(width > 0 && height > 0)) throw new Error("Viewport geometry unavailable; request scope:full_page instead.");
  const view: Rect = { left: Number(viewport.offsetX) || 0, top: Number(viewport.offsetY) || 0,
    right: (Number(viewport.offsetX) || 0) + width, bottom: (Number(viewport.offsetY) || 0) + height };
  const frames = new Map((await directChildFrames(send)).map(frame => [frame.id, frame]));
  const frameRects = new Map<string, Rect>();
  for (const id of new Set(nodes.map(node => node.documentFrameId).filter((id): id is string => !!id))) {
    signal?.throwIfAborted();
    const owner = record(await send("DOM.getFrameOwner", { frameId: id }));
    const box = record(record(await send("DOM.getBoxModel", { backendNodeId: owner.backendNodeId })).model);
    const bounds = rect(box.content);
    if (bounds) frameRects.set(id, bounds);
  }
  const candidates = [...new Map([...nodes, ...actions].filter(node => node.backendDOMNodeId).map(node => [key(node), node])).values()];
  const visible = new Set<string>();
  let cursor = 0, stopped = false;
  // Limit concurrent protocol work and honor the enclosing observation's five-second deadline.
  const max = Math.min(candidates.length, 2000);
  await Promise.all(Array.from({ length: Math.min(8, max) }, async () => {
    while (!stopped && cursor < max) {
      signal?.throwIfAborted();
      const node = candidates[cursor++], frameId = node.documentFrameId || "";
      const frame = frames.get(frameId), frameRect = frameRects.get(frameId);
      if (frameId && (!frame || !frameRect || !intersects(frameRect, view) || frame.loaderId !== node.documentLoaderId)) continue;
      let box: Fields;
      try { box = record(record(await (frame?.send || send)("DOM.getBoxModel", { backendNodeId: node.backendDOMNodeId })).model); }
      catch (error) {
        // Document/inline AX nodes may have no layout box. Protocol/permission failures remain failures.
        if (/could not compute box model|layout object|no layout|could not find node|no node with given id/i.test(String(error))) continue;
        stopped = true;
        throw error;
      }
      const bounds = rect(box.border || box.content);
      if (!bounds) continue;
      if (frame?.sessionId && frameRect) {
        bounds.left += frameRect.left; bounds.right += frameRect.left;
        bounds.top += frameRect.top; bounds.bottom += frameRect.top;
      }
      const clip = frameRect ? { left: Math.max(view.left, frameRect.left), top: Math.max(view.top, frameRect.top),
        right: Math.min(view.right, frameRect.right), bottom: Math.min(view.bottom, frameRect.bottom) } : view;
      if (intersects(bounds, clip)) visible.add(key(node));
    }
  }));
  signal?.throwIfAborted();
  const byId = new Map(nodes.map(node => [node.nodeId, node]));
  const kept = new Set<string>();
  const inViewport = (node: Node) => visible.has(key(node));
  for (const node of nodes) {
    // InlineTextBox nodes have no DOM id and inherit the measured text node's visibility.
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (!inViewport(node) && !(!node.backendDOMNodeId && parent && inViewport(parent))) continue;
    let current: T | undefined = node;
    while (current && !kept.has(current.nodeId)) {
      kept.add(current.nodeId); current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }
  return { nodes: nodes.filter(node => kept.has(node.nodeId)), inViewport, truncated: candidates.length > max };
}
