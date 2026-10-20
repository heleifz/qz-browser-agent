type Send = (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<unknown>;

export interface SnapshotFrameSource {
  frameId: string;
  oopif?: boolean;
  parentFrameId?: string;
  iframeBackendNodeId?: number;
  nodes: Record<string, unknown>[];
}

export interface LayoutBox {
  frameId: string;
  backendNodeId: number;
  x: number;
  y: number;
  w: number;
  h: number;
}
type DebuggerListener = (method: string, params: Record<string, unknown>) => void;

interface TrackedTab {
  /** OOPIF target id, which equals its frame id, mapped to the flat child session. */
  sessions: Map<string, string>;
  stop: () => void;
}

// Chrome announces each auto-attached OOPIF once per debugger attachment, so the
// listener lives until the attachment ends rather than for one discovery call.
const trackedTabs = new Map<number, TrackedTab>();

export function forgetTabFrames(tabId: number) {
  trackedTabs.get(tabId)?.stop();
  trackedTabs.delete(tabId);
}

function trackTab(tabId: number, subscribe: (listener: DebuggerListener) => () => void) {
  const existing = trackedTabs.get(tabId);
  if (existing) return { tracked: existing, fresh: false };
  const sessions = new Map<string, string>();
  const stop = subscribe((method, params) => {
    const sessionId = typeof params.sessionId === "string" ? params.sessionId : "";
    if (!sessionId) return;
    if (method === "Target.attachedToTarget") {
      const info = record(params.targetInfo);
      if (info.type === "iframe" && typeof info.targetId === "string") sessions.set(info.targetId, sessionId);
    } else if (method === "Target.detachedFromTarget") {
      for (const [frameId, current] of sessions) if (current === sessionId) sessions.delete(frameId);
    }
  });
  const tracked = { sessions, stop };
  trackedTabs.set(tabId, tracked);
  return { tracked, fresh: true };
}

export interface DiscoveredFrame {
  frameId: string;
  oopif: boolean;
  parentFrameId?: string;
  iframeBackendNodeId?: number;
  sessionId?: string;
  url?: string;
}

interface FrameTreeNode {
  frame?: { id?: string; url?: string };
  childFrames?: FrameTreeNode[];
}

/** Same-process frames come from the page frame tree. Cross-process frames arrive through flat auto-attach. */
export async function discoverFrames(tabId: number, send: Send, subscribe: (listener: DebuggerListener) => () => void): Promise<{
  mainFrameId: string;
  frames: DiscoveredFrame[];
}> {
  const { tracked, fresh } = trackTab(tabId, subscribe);
  if (fresh) {
    try {
      await send("Target.setAutoAttach", {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true,
      });
      // Existing iframe targets are reported on the debugger event stream after the command returns.
      await new Promise(resolve => setTimeout(resolve, 150));
    } catch {
      // A target that cannot auto-attach still exposes same-process frames.
    }
  }

  const tree = record(await send("Page.getFrameTree"));
  const frameTree = record(tree.frameTree) as FrameTreeNode;
  const mainFrameId = String(frameTree.frame?.id || "");
  const frames: DiscoveredFrame[] = [];
  const known = new Set<string>();
  const walk = (node: FrameTreeNode | undefined, parentId?: string) => {
    const frameId = String(node?.frame?.id || "");
    if (!node || !frameId) return;
    if (parentId) {
      known.add(frameId);
      frames.push({ frameId, oopif: false, parentFrameId: parentId, url: node.frame?.url });
    }
    for (const child of node.childFrames || []) walk(child, frameId);
  };
  walk(frameTree);

  for (const [targetId, sessionId] of [...tracked.sessions]) {
    try {
      const childTree = record(record(await send("Page.getFrameTree", {}, sessionId)).frameTree) as FrameTreeNode;
      const frameId = String(childTree.frame?.id || "");
      if (!frameId || known.has(frameId)) continue;
      known.add(frameId);
      let iframeBackendNodeId = 0;
      try {
        iframeBackendNodeId = Number(record(await send("DOM.getFrameOwner", { frameId })).backendNodeId || 0);
      } catch { /* The owner can sit in another process. */ }
      if (frameId !== targetId) {
        tracked.sessions.delete(targetId);
        tracked.sessions.set(frameId, sessionId);
      }
      frames.push({
        frameId,
        oopif: true,
        sessionId,
        iframeBackendNodeId: iframeBackendNodeId || undefined,
        url: childTree.frame?.url,
      });
    } catch {
      tracked.sessions.delete(targetId);
    }
  }

  for (const frame of frames) {
    if (frame.oopif || frame.iframeBackendNodeId) continue;
    try {
      frame.iframeBackendNodeId = Number(record(await send("DOM.getFrameOwner", { frameId: frame.frameId })).backendNodeId || 0) || undefined;
    } catch { /* Owner lookup is best-effort; the frame tree is still usable. */ }
  }
  return { mainFrameId, frames };
}

export async function sessionForFrame(tabId: number, send: Send, subscribe: (listener: DebuggerListener) => () => void, frameId: string) {
  if (!frameId) return undefined;
  const cached = trackedTabs.get(tabId)?.sessions.get(frameId);
  if (cached) return cached;
  const discovered = await discoverFrames(tabId, send, subscribe);
  return discovered.frames.find(frame => frame.oopif && frame.frameId === frameId)?.sessionId;
}

export async function collectSnapshotInputs(tabId: number, send: Send, subscribe: (listener: DebuggerListener) => () => void, depth: number): Promise<{
  mainFrameId: string;
  sources: SnapshotFrameSource[];
  boxes: LayoutBox[];
  viewport: { width: number; height: number };
  frames: DiscoveredFrame[];
}> {
  const discovered = await discoverFrames(tabId, send, subscribe);
  const viewport = await readViewport(send);
  const read = await readBoxes(send);
  const boxes = read.boxes;
  for (const box of boxes) {
    if (!box.frameId) box.frameId = discovered.mainFrameId;
  }
  for (const frame of discovered.frames) {
    if (frame.oopif && frame.sessionId) {
      boxes.push(...(await readBoxes(send, frame.sessionId)).boxes);
    }
    const origin = await iframeContentOrigin(send, frame);
    if (!origin) continue;
    for (const box of boxes) {
      if (box.frameId === frame.frameId) {
        box.x += origin.x;
        box.y += origin.y;
      }
    }
  }
  const main = record(await send("Accessibility.getFullAXTree", { depth }));
  const sources: SnapshotFrameSource[] = [{
    frameId: discovered.mainFrameId,
    oopif: false,
    nodes: arrayRecord(main.nodes),
  }];
  for (const frame of discovered.frames) {
    try {
      const ax = frame.oopif
        ? record(await send("Accessibility.getFullAXTree", { depth }, frame.sessionId))
        : record(await send("Accessibility.getFullAXTree", { depth, frameId: frame.frameId }));
      sources.push({
        frameId: frame.frameId,
        oopif: frame.oopif,
        parentFrameId: frame.parentFrameId || discovered.mainFrameId,
        iframeBackendNodeId: frame.iframeBackendNodeId,
        nodes: arrayRecord(ax.nodes),
      });
    } catch { /* Skip a frame whose accessibility tree is unavailable. */ }
  }
  return { mainFrameId: discovered.mainFrameId, sources, boxes, viewport, frames: discovered.frames };
}

async function readViewport(send: Send) {
  try {
    const evaluated = record(await send("Runtime.evaluate", {
      expression: "({width: window.innerWidth, height: window.innerHeight})",
      returnByValue: true,
    }));
    const value = record(record(evaluated.result).value);
    const width = Number(value.width);
    const height = Number(value.height);
    if (width > 0 && height > 0) return { width, height };
  } catch { /* Fall through to a desktop-sized viewport. */ }
  return { width: 1280, height: 800 };
}

async function readBoxes(send: Send, sessionId?: string): Promise<{ boxes: LayoutBox[]; error?: string; documents: number }> {
  let snapshot: Record<string, unknown>;
  try {
    snapshot = record(await send("DOMSnapshot.captureSnapshot", { computedStyles: [] }, sessionId));
  } catch (error) {
    return { boxes: [], documents: 0, error: error instanceof Error ? error.message : String(error) };
  }
  const boxes: LayoutBox[] = [];
  const documents = arrayRecord(snapshot.documents);
  const strings = Array.isArray(snapshot.strings) ? snapshot.strings.map(item => String(item)) : [];
  for (const document of documents) {
    const doc = record(document);
    const frameId = snapshotString(doc.frameId, strings);
    const scrollX = Number(doc.scrollOffsetX || 0);
    const scrollY = Number(doc.scrollOffsetY || 0);
    const nodes = record(doc.nodes);
    const backendIds = Array.isArray(nodes.backendNodeId) ? nodes.backendNodeId : [];
    const layout = record(doc.layout);
    const nodeIndex = Array.isArray(layout.nodeIndex) ? layout.nodeIndex : [];
    const bounds = Array.isArray(layout.bounds) ? layout.bounds : [];
    nodeIndex.forEach((rawIndex, index) => {
      const backendNodeId = Number(backendIds[Number(rawIndex)] || 0);
      const bound = bounds[index];
      if (!backendNodeId || !Array.isArray(bound) || bound.length < 4) return;
      const [x, y, w, h] = bound.map(Number);
      if (![x, y, w, h].every(Number.isFinite)) return;
      boxes.push({ frameId, backendNodeId, x: x - scrollX, y: y - scrollY, w, h });
    });
  }
  return { boxes, documents: documents.length, error: boxes.length ? undefined : `empty snapshot keys=${Object.keys(snapshot).join(",")}` };
}

async function iframeContentOrigin(send: Send, frame: DiscoveredFrame) {
  if (!frame.iframeBackendNodeId) return null;
  try {
    const resolved = record(await send("DOM.resolveNode", { backendNodeId: frame.iframeBackendNodeId }));
    const objectId = String(record(resolved.object).objectId || "");
    if (!objectId) return null;
    const evaluated = record(await send("Runtime.callFunctionOn", {
      objectId,
      returnByValue: true,
      functionDeclaration: "function(){ const rect = this.getBoundingClientRect(); return { x: rect.left + this.clientLeft, y: rect.top + this.clientTop }; }",
    }));
    const value = record(record(evaluated.result).value);
    const x = Number(value.x);
    const y = Number(value.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  } catch {
    return null;
  }
}

function snapshotString(value: unknown, strings: string[]) {
  if (typeof value === "number" && strings[value]) return strings[value];
  return typeof value === "string" ? value : "";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayRecord(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(item => item && typeof item === "object") as Record<string, unknown>[] : [];
}
