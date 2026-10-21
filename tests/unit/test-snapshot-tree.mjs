import assert from "node:assert/strict";
import { registerAccessibilityTools } from "../../src/capabilities/accessibility/tools.ts";
import { forgetTabFrames } from "../../src/background/tools/frame-sessions.ts";
import { ToolExecutionError } from "../../src/background/tools/arguments.ts";

function axNode(nodeId, role, name, extra = {}) {
  return {
    nodeId,
    childIds: extra.childIds || [],
    parentId: extra.parentId,
    backendDOMNodeId: extra.backend,
    role: { value: role },
    name: name ? { value: name } : undefined,
  };
}

function hostFor(send, refs) {
  let definition;
  registerAccessibilityTools({
    registerTool: value => { definition = value; },
    ToolExecutionError,
    clampLimit: (value, min, max) => Math.max(min, Math.min(value, max)),
    makeSnapshotId: () => "snapshot",
    elementTargetForUid: uid => `uid:${uid}`,
    registerElementRef: ref => refs.push(ref),
    resolveElementReference: async () => ({ tabId: 8, target: "css:button", selector: "button", index: 0 }),
    backendNodeIdForSelector: async () => 0,
    makeSessionTabTargetError: code => new ToolExecutionError(code, code),
    sendToContent: async () => ({ title: "Page", url: "https://example.com/", actions: [], headings: [], canvases: [] }),
    subscribeDebuggerEvents: (_tabId, listener) => {
      hostFor.listener = listener;
      return () => { hostFor.listener = null; };
    },
    withDebugger: async (_id, fn) => fn({}, send),
    elementTargetGrammar: "target grammar",
  });
  return definition;
}

async function run(send, args = {}) {
  forgetTabFrames(8);
  const refs = [];
  const definition = hostFor(send, refs);
  const result = await definition.execute({ tabId: 8, ...args }, null, { sessionId: "owner", runId: "run" });
  return { result, refs };
}

const page = async (nodes, { frames = false } = {}) => {
  const send = async (method, _params, sessionId) => {
    if (method === "Target.setAutoAttach") {
      if (frames) hostFor.listener?.("Target.attachedToTarget", {
        sessionId: "session-a",
        targetInfo: { type: "iframe", targetId: "child" },
      });
      return {};
    }
    if (method === "Page.getFrameTree") {
      if (sessionId) return { frameTree: { frame: { id: "child", url: "https://guest.example/" } } };
      return { frameTree: { frame: { id: "main" }, childFrames: [] } };
    }
    if (method === "DOM.getFrameOwner") return { backendNodeId: 9 };
    if (method === "Accessibility.getFullAXTree") {
      if (sessionId) return { nodes: [
        axNode("croot", "RootWebArea", "Guest", { backend: 1, childIds: ["go"] }),
        axNode("go", "button", "Inside frame", { parentId: "croot", backend: 1 }),
      ] };
      return { nodes };
    }
    return {};
  };
  return run(send);
};

const limited = await run(async (method) => {
  if (method === "Target.setAutoAttach" || method === "DOM.getFrameOwner") return method === "DOM.getFrameOwner" ? { backendNodeId: 0 } : {};
  if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "main" }, childFrames: [] } };
  if (method === "Accessibility.getFullAXTree") {
    const siblings = Array.from({ length: 18 }, (_, index) => `b${index}`);
    return { nodes: [
      axNode("root", "RootWebArea", "Page", { backend: 1, childIds: ["left", ...siblings] }),
      axNode("left", "group", "Left", { parentId: "root", backend: 2, childIds: ["deep"] }),
      axNode("deep", "button", "Deep", { parentId: "left", backend: 3 }),
      ...siblings.map((id, index) => axNode(id, "button", `Sibling ${index}`, { parentId: "root", backend: 10 + index })),
    ] };
  }
  return {};
}, { limit: 20 });
assert.match(limited.result.snapshot, /button "Sibling 17"/, "the budget covers the next sibling before a deeper node");
assert.doesNotMatch(limited.result.snapshot, /button "Deep"/);
assert.match(limited.result.snapshot, /\(truncated\)/);

const visible = await page([
  axNode("root", "RootWebArea", "Page", { backend: 1, childIds: ["seen", "hidden"] }),
  axNode("seen", "button", "Seen", { parentId: "root", backend: 2 }),
  axNode("hidden", "button", "Below fold", { parentId: "root", backend: 3 }),
]);
assert.match(visible.result.snapshot, /button "Below fold"/, "nodes outside the viewport stay in the snapshot");

const framed = await page([
  axNode("root", "RootWebArea", "Host", { backend: 1, childIds: ["frame"] }),
  axNode("frame", "Iframe", "Guest", { parentId: "root", backend: 9 }),
], { frames: true });
assert.match(framed.result.snapshot, /button "Inside frame" frame=1/);
const inner = framed.refs.find(ref => ref.name === "Inside frame");
assert.equal(inner.frameId, "child");
assert.equal(inner.oopif, true);
assert.equal(inner.backendNodeId, 1, "a frame-local backend id stays distinct from the top document");

const cyclic = await page([
  axNode("root", "RootWebArea", "Cycle", { backend: 1, childIds: ["loop"] }),
  axNode("loop", "group", "Loop", { parentId: "root", backend: 2, childIds: ["root", "button"] }),
  axNode("button", "button", "Still here", { parentId: "loop", backend: 3 }),
]);
assert.match(cyclic.result.snapshot, /button "Still here"/, "a cyclic accessibility tree still renders");

console.log("existing snapshot walker keeps its budget and gains frame trees");
