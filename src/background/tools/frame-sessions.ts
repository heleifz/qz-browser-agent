type Send = (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<unknown>;

export interface SnapshotFrameSource {
  frameId: string;
  oopif?: boolean;
  parentFrameId?: string;
  iframeBackendNodeId?: number;
  loaderId?: string;
  nodes: Record<string, unknown>[];
}

type DebuggerListener = (method: string, params: Record<string, unknown>) => void;
type Subscribe = (listener: DebuggerListener) => () => void;

interface TrackedTab {
  /** Child target id, which equals its root frame id, mapped to the flat child session. */
  sessions: Map<string, string>;
  /** The page target is auto-attached once per debugger attachment. */
  attached: boolean;
  stop: () => void;
}

const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: false, flatten: true };
const ATTACH_SETTLE_MS = 150;

// Chrome announces each auto-attached frame target once per debugger attachment, so the
// listener lives until the attachment ends rather than for one discovery call.
const trackedTabs = new Map<number, TrackedTab>();

export function forgetTabFrames(tabId: number) {
  trackedTabs.get(tabId)?.stop();
  trackedTabs.delete(tabId);
}

function trackTab(tabId: number, subscribe: Subscribe) {
  const existing = trackedTabs.get(tabId);
  if (existing) return existing;
  const sessions = new Map<string, string>();
  const autoAttached = new Set<string>();
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
  const tracked = { sessions, attached: false, stop };
  trackedTabs.set(tabId, tracked);
  return tracked;
}

export interface DiscoveredFrame {
  frameId: string;
  /** The frame is the root document of a child target. */
  targetRoot: boolean;
  parentFrameId?: string;
  /** The iframe element in the parent frame's document. */
  iframeBackendNodeId?: number;
  /** Target session that owns this frame's document; absent for the page target. */
  sessionId?: string;
  loaderId?: string;
  url?: string;
}

interface FrameTreeNode {
  frame?: { id?: string; parentId?: string; loaderId?: string; url?: string };
  childFrames?: FrameTreeNode[];
}

/**
 * Lists frames the page target can see.
 * Same-process frames come from each target's frame tree. One auto-attach on the page
 * reports cross-process frames directly under the page; frames inside those are not attached.
 */
export async function discoverFrames(tabId: number, send: Send, subscribe: Subscribe): Promise<{
  mainFrameId: string;
  mainLoaderId: string;
  frames: DiscoveredFrame[];
}> {
  const tracked = trackTab(tabId, subscribe);
  if (!tracked.attached) {
    tracked.attached = true;
    try {
      await send("Target.setAutoAttach", AUTO_ATTACH);
    } catch { /* The page target still exposes its same-process frames. */ }
    // Existing frame targets are reported on the debugger event stream after the command returns.
    await new Promise(resolve => setTimeout(resolve, ATTACH_SETTLE_MS));
  }

  const tree = record(record(await send("Page.getFrameTree")).frameTree) as FrameTreeNode;
  const mainFrameId = String(tree.frame?.id || "");
  const frames = new Map<string, DiscoveredFrame>();
  const walk = (node: FrameTreeNode, sessionId: string | undefined, parentId: string | undefined, root: boolean) => {
    const frameId = String(node.frame?.id || "");
    if (!frameId) return;
    if (parentId) {
      frames.set(frameId, {
        frameId,
        targetRoot: root,
        parentFrameId: parentId,
        sessionId,
        loaderId: node.frame?.loaderId,
        url: node.frame?.url,
      });
    }
    for (const child of node.childFrames || []) walk(child, sessionId, frameId, false);
  };
  walk(tree, undefined, undefined, false);

  for (const [targetId, sessionId] of [...tracked.sessions]) {
    let childTree: FrameTreeNode;
    try {
      childTree = record(record(await send("Page.getFrameTree", {}, sessionId)).frameTree) as FrameTreeNode;
    } catch {
      tracked.sessions.delete(targetId);
      continue;
    }
    const frameId = String(childTree.frame?.id || "");
    if (!frameId) continue;
    if (frameId !== targetId) {
      tracked.sessions.delete(targetId);
      tracked.sessions.set(frameId, sessionId);
    }
    walk(childTree, sessionId, String(childTree.frame?.parentId || "") || mainFrameId, true);
  }

  // The owner element lives in the parent frame's document, so ask the target that owns the parent.
  for (const frame of frames.values()) {
    const parentSession = frame.parentFrameId === mainFrameId ? undefined : frames.get(frame.parentFrameId || "")?.sessionId;
    if (frame.parentFrameId !== mainFrameId && !frames.has(frame.parentFrameId || "")) continue;
    try {
      const owner = record(await send("DOM.getFrameOwner", { frameId: frame.frameId }, parentSession));
      frame.iframeBackendNodeId = Number(owner.backendNodeId || 0) || undefined;
    } catch { /* Owner lookup is best-effort; the frame tree is still usable. */ }
  }
  return { mainFrameId, mainLoaderId: String(tree.frame?.loaderId || ""), frames: [...frames.values()] };
}

/** Reads each frame's accessibility tree for a read-only snapshot. Actions stay in the main document. */
export async function collectSnapshotInputs(tabId: number, send: Send, subscribe: Subscribe, depth: number): Promise<{
  mainFrameId: string;
  sources: SnapshotFrameSource[];
  frames: DiscoveredFrame[];
}> {
  const discovered = await discoverFrames(tabId, send, subscribe);
  const main = record(await send("Accessibility.getFullAXTree", { depth }));
  const sources: SnapshotFrameSource[] = [{
    frameId: discovered.mainFrameId,
    oopif: false,
    loaderId: discovered.mainLoaderId,
    nodes: arrayRecord(main.nodes),
  }];
  for (const frame of discovered.frames) {
    try {
      const params = frame.targetRoot ? { depth } : { depth, frameId: frame.frameId };
      const ax = record(await send("Accessibility.getFullAXTree", params, frame.sessionId));
      sources.push({
        frameId: frame.frameId,
        oopif: !!frame.sessionId,
        parentFrameId: frame.parentFrameId || discovered.mainFrameId,
        iframeBackendNodeId: frame.iframeBackendNodeId,
        loaderId: frame.loaderId,
        nodes: arrayRecord(ax.nodes),
      });
    } catch { /* Skip a frame whose accessibility tree is unavailable. */ }
  }
  return { mainFrameId: discovered.mainFrameId, sources, frames: discovered.frames };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayRecord(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(item => item && typeof item === "object") as Record<string, unknown>[] : [];
}
