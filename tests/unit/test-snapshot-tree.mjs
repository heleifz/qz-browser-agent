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

function hostFor(send, refs, { resolved, actions = [] } = {}) {
  let definition;
  registerAccessibilityTools({
    registerTool: value => { definition = value; },
    ToolExecutionError,
    clampLimit: (value, min, max) => Math.max(min, Math.min(value, max)),
    makeSnapshotId: () => "snapshot",
    elementTargetForUid: uid => `uid:${uid}`,
    registerElementRef: ref => refs.push(ref),
    resolveElementReference: async () => resolved || ({ tabId: 8, target: "css:button", selector: "button", index: 0 }),
    backendNodeIdForSelector: async () => 0,
    makeSessionTabTargetError: code => new ToolExecutionError(code, code),
    sendToContent: async () => ({ title: "Page", url: "https://example.com/", actions, headings: [{ level: 1, text: "Top heading" }], canvases: [] }),
    subscribeDebuggerEvents: (_tabId, listener) => {
      hostFor.listener = listener;
      return () => { hostFor.listener = null; };
    },
    withDebugger: async (_id, fn) => fn({}, send),
    elementTargetGrammar: "target grammar",
  });
  return definition;
}

async function run(send, args = {}, options = {}) {
  forgetTabFrames(8);
  const refs = [];
  const definition = hostFor(send, refs, options);
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
const inside = framed.result.snapshot.split("\n").find(line => line.includes("Inside frame"));
assert.doesNotMatch(inside, /target=/, "iframe content is readable and has no actionable target");
assert.equal(framed.refs.find(ref => ref.name === "Inside frame"), undefined);

// Page > cross-process "outer" > same-process "inner" and cross-process "deep"; the same name appears at every level.
const nestedSend = async (method, params = {}, sessionId) => {
  if (method === "Target.setAutoAttach") {
    if (!sessionId) hostFor.listener?.("Target.attachedToTarget", { sessionId: "s-outer", targetInfo: { type: "iframe", targetId: "outer" } });
    if (sessionId === "s-outer") hostFor.listener?.("Target.attachedToTarget", { sessionId: "s-deep", targetInfo: { type: "iframe", targetId: "deep" } });
    return {};
  }
  if (method === "Page.getFrameTree") {
    if (!sessionId) return { frameTree: { frame: { id: "main", loaderId: "L-main" } } };
    if (sessionId === "s-outer") return { frameTree: {
      frame: { id: "outer", parentId: "main", loaderId: "L-outer" },
      childFrames: [{ frame: { id: "inner", parentId: "outer", loaderId: "L-inner" } }],
    } };
    return { frameTree: { frame: { id: "deep", parentId: "outer", loaderId: "L-deep" } } };
  }
  if (method === "DOM.getFrameOwner") {
    const owner = { "main:outer": 9, "s-outer:inner": 5, "s-outer:deep": 6 }[`${sessionId || "main"}:${params.frameId}`];
    if (!owner) throw new Error("Frame with the given id does not belong to the target.");
    return { backendNodeId: owner };
  }
  if (method === "Accessibility.getFullAXTree") {
    if (!sessionId) return { nodes: [
      axNode("root", "RootWebArea", "Host", { backend: 1, childIds: ["send", "frame"] }),
      axNode("send", "button", "Publish", { parentId: "root", backend: 2 }),
      axNode("frame", "Iframe", "Outer", { parentId: "root", backend: 9 }),
    ] };
    if (sessionId === "s-outer" && params.frameId === "inner") return { nodes: [
      axNode("iroot", "RootWebArea", "Inner doc", { backend: 1, childIds: ["ibtn"] }),
      axNode("ibtn", "button", "Send", { parentId: "iroot", backend: 2 }),
    ] };
    if (sessionId === "s-outer") return { nodes: [
      axNode("oroot", "RootWebArea", "Outer doc", { backend: 1, childIds: ["obtn", "ihost", "dhost"] }),
      axNode("obtn", "button", "Send", { parentId: "oroot", backend: 2 }),
      axNode("ihost", "Iframe", "Inner", { parentId: "oroot", backend: 5 }),
      axNode("dhost", "Iframe", "Deep", { parentId: "oroot", backend: 6 }),
    ] };
    return { nodes: [
      axNode("droot", "RootWebArea", "Deep doc", { backend: 1, childIds: ["dbtn"] }),
      axNode("dbtn", "button", "Deep send", { parentId: "droot", backend: 2 }),
    ] };
  }
  return {};
};
const sendAction = [{ role: "button", name: "Send", selector: "#send" }];
const nested = await run(nestedSend, {}, { actions: sendAction });
const lines = nested.result.snapshot.split("\n");
const lineIndex = text => lines.findIndex(line => line.includes(text));
assert.ok(lineIndex('Iframe "Inner"') < lineIndex('RootWebArea "Inner doc"'), "a same-process child of a cross-process frame hangs under its host");
assert.ok(lineIndex('Iframe "Deep"') < lineIndex('button "Deep send"'), "a cross-process grandchild hangs under its host in the parent frame");
assert.match(lines[lineIndex('button "Deep send"')], /^ {6,}/, "the grandchild is indented below its host");
const deepLine = lines[lineIndex('button "Deep send"')];
assert.match(deepLine, /frame=3/);
assert.doesNotMatch(deepLine, /target=/);
assert.equal(nested.refs.find(ref => ref.frameId), undefined, "iframe nodes are not registered as targets");
assert.equal(nested.refs.find(ref => ref.name === "Publish")?.loaderId, "L-main", "main-document refs carry the page document");
const actionRef = nested.refs.filter(ref => ref.selector === "#send").at(-1);
assert.deepEqual([actionRef.frameId, actionRef.backendNodeId, actionRef.loaderId], [undefined, undefined, undefined],
  "a top-level action never adopts a same-named frame node");
assert.equal(nested.refs.filter(ref => ref.name === "Send" && ref.selector !== "#send").length, 0,
  "same-named controls inside frames get no target");
assert.deepEqual(nested.result.frames.map(frame => [frame.index, frame.frameId, frame.parentFrameId, frame.oopif]).sort(), [
  [1, "outer", "main", true], [2, "inner", "outer", true], [3, "deep", "outer", true],
]);

const scoped = await run(nestedSend, { root: "uid:frame-host" }, {
  actions: sendAction,
  resolved: { tabId: 8, target: "uid:frame-host", selector: "", index: 0, ref: { backendNodeId: 9, remoteAction: true } },
});
assert.deepEqual(scoped.result.actions, [], "an iframe element root does not list top-level actions");
assert.deepEqual(scoped.result.headings, []);
assert.match(scoped.result.snapshot, /RootWebArea "Inner doc"/);
assert.match(scoped.result.snapshot, /button "Deep send"/);
assert.doesNotMatch(scoped.result.snapshot, /button "Publish"/, "the subtree stays inside the iframe element");
assert.ok(scoped.result.snapshot.split("\n").filter(line => /frame=\d+/.test(line)).every(line => !/target=/.test(line)));
assert.ok(scoped.refs.every(ref => !ref.frameId), "a frame subtree registers no iframe content");

const cyclic = await page([
  axNode("root", "RootWebArea", "Cycle", { backend: 1, childIds: ["loop"] }),
  axNode("loop", "group", "Loop", { parentId: "root", backend: 2, childIds: ["root", "button"] }),
  axNode("button", "button", "Still here", { parentId: "loop", backend: 3 }),
]);
assert.match(cyclic.result.snapshot, /button "Still here"/, "a cyclic accessibility tree still renders");

console.log("existing snapshot walker keeps its budget and gains frame trees");
