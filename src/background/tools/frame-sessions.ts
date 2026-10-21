type Send = (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<unknown>;

export interface SnapshotFrameSource {
  frameId: string;
  oopif?: boolean;
  parentFrameId?: string;
  iframeBackendNodeId?: number;
  nodes: Record<string, unknown>[];
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
  frames: DiscoveredFrame[];
}> {
  const discovered = await discoverFrames(tabId, send, subscribe);
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
  return { mainFrameId: discovered.mainFrameId, sources, frames: discovered.frames };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayRecord(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(item => item && typeof item === "object") as Record<string, unknown>[] : [];
}
