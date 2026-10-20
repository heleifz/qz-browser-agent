import assert from "node:assert/strict";
import { buildPageSnapshot } from "../../src/capabilities/accessibility/snapshot-tree.ts";

const view = { width: 800, height: 600 };

function node(nodeId, role, name, extra = {}) {
  return {
    nodeId,
    childIds: extra.childIds || [],
    parentId: extra.parentId,
    backendDOMNodeId: extra.backend,
    role: { value: role },
    name: name ? { value: name } : undefined,
    ignored: extra.ignored,
  };
}

function build(sources, options = {}) {
  return buildPageSnapshot(sources, {
    snapshotId: "s",
    limit: options.limit ?? 20,
    maxDepth: options.maxDepth ?? 16,
    scope: options.scope ?? "viewport",
    viewport: view,
    boxes: options.boxes || [],
    rootBackendNodeId: options.rootBackendNodeId,
    rootFrameId: options.rootFrameId,
    subtree: options.subtree,
  });
}

function box(frameId, backendNodeId, x, y, w = 40, h = 20) {
  return { frameId, backendNodeId, x, y, w, h };
}

const repeatedText = build([{
  frameId: "main",
  nodes: [
    node("root", "RootWebArea", "Page", { childIds: ["button", "text", "inline"], backend: 1 }),
    node("button", "button", "Save", { parentId: "root", backend: 2, childIds: ["label"] }),
    node("label", "StaticText", "Save", { parentId: "button", childIds: ["word"], backend: 3 }),
    node("word", "InlineTextBox", "Save", { parentId: "label", backend: 4 }),
    node("text", "StaticText", "Intro", { parentId: "root", backend: 5 }),
    node("inline", "InlineTextBox", "Intro", { parentId: "root", backend: 6 }),
  ],
}], { boxes: [box("main", 1, 0, 0, 800, 600), box("main", 2, 10, 10), box("main", 5, 10, 40)] });

assert.equal(repeatedText.snapshot.includes("InlineTextBox"), false, "inline text boxes are omitted");
assert.equal(repeatedText.snapshot.split("\n").filter(line => line.includes('"Save"')).length, 1, "a button does not repeat its own name as StaticText");
assert.match(repeatedText.snapshot, /StaticText "Intro"/, "text that is not a duplicate of its parent stays");

const wrapped = build([{
  frameId: "main",
  nodes: [
    node("root", "RootWebArea", "Page", { backend: 1, childIds: ["solo", "group"] }),
    node("solo", "group", "", { parentId: "root", backend: 2, childIds: ["only"] }),
    node("only", "button", "Only", { parentId: "solo", backend: 3 }),
    node("group", "group", "Pair", { parentId: "root", backend: 4, childIds: ["a", "b"] }),
    node("a", "button", "A", { parentId: "group", backend: 5 }),
    node("b", "button", "B", { parentId: "group", backend: 6 }),
  ],
}], { boxes: [1, 2, 3, 4, 5, 6].map(id => box("main", id, 0, 0)) });
assert.match(wrapped.snapshot, /button "Only"/);
assert.equal(wrapped.snapshot.split("\n").filter(line => /\sgroup(?:\s|$)/.test(line)).length, 1, "the named group stays and the single-child wrapper does not");
assert.match(wrapped.snapshot, /button "A"/);
assert.match(wrapped.snapshot, /button "B"/);

const table = build([{
  frameId: "main",
  nodes: [
    node("root", "RootWebArea", "News", { backend: 1, childIds: ["table"] }),
    node("table", "LayoutTable", "", { parentId: "root", backend: 2, childIds: ["row"] }),
    node("row", "LayoutTableRow", "", { parentId: "table", backend: 3, childIds: ["cell"] }),
    node("cell", "LayoutTableCell", "Story", { parentId: "row", backend: 4, childIds: ["link"] }),
    node("link", "link", "Story", { parentId: "cell", backend: 5 }),
  ],
}], { limit: 4, boxes: [box("main", 1, 0, 0, 800, 40), box("main", 5, 0, 10)] });
assert.match(table.snapshot, /link "Story"/, "a layout table does not consume the budget before its link");
assert.equal(table.snapshot.includes("LayoutTable"), false);

const viewport = build([{
  frameId: "main",
  nodes: [
    node("root", "RootWebArea", "Page", { backend: 1, childIds: ["seen", "hidden"] }),
    node("seen", "button", "Seen", { parentId: "root", backend: 2 }),
    node("hidden", "button", "Hidden", { parentId: "root", backend: 3 }),
  ],
}], {
  boxes: [box("main", 1, 0, 0, 800, 600), box("main", 2, 10, 10), box("main", 3, 10, 900)],
});
assert.match(viewport.snapshot, /button "Seen"/);
assert.doesNotMatch(viewport.snapshot, /button "Hidden"/);
assert.equal(viewport.offscreenBelow, 1);
assert.match(viewport.snapshot, /offscreen above=0 below=1/);

const page = build([{
  frameId: "main",
  nodes: [
    node("root", "RootWebArea", "Page", { backend: 1, childIds: ["seen", "hidden"] }),
    node("seen", "button", "Seen", { parentId: "root", backend: 2 }),
    node("hidden", "button", "Hidden", { parentId: "root", backend: 3 }),
  ],
}], {
  scope: "page",
  boxes: [box("main", 1, 0, 0, 800, 600), box("main", 2, 10, 10), box("main", 3, 10, 900)],
});
assert.match(page.snapshot, /button "Hidden"/, "scope page brings back the offscreen button");
assert.equal(page.snapshot.includes("offscreen "), false, "a page-scope snapshot does not claim the nodes were omitted");

const subtree = build([{
  frameId: "main",
  nodes: [
    node("root", "RootWebArea", "Page", { backend: 1, childIds: ["panel"] }),
    node("panel", "group", "Panel", { parentId: "root", backend: 2, childIds: ["far"] }),
    node("far", "button", "Far", { parentId: "panel", backend: 3 }),
  ],
}], {
  subtree: true,
  rootBackendNodeId: 2,
  boxes: [box("main", 2, 10, 900), box("main", 3, 10, 940)],
});
assert.equal(subtree.rootFound, true);
assert.match(subtree.snapshot, /button "Far"/, "an explicit subtree keeps elements outside the viewport");

const framed = build([
  {
    frameId: "main",
    nodes: [
      node("root", "RootWebArea", "Host", { backend: 1, childIds: ["frame"] }),
      node("frame", "Iframe", "Guest", { parentId: "root", backend: 9 }),
    ],
  },
  {
    frameId: "child",
    oopif: true,
    parentFrameId: "main",
    iframeBackendNodeId: 9,
    nodes: [
      node("croot", "RootWebArea", "Guest", { backend: 1, childIds: ["go"] }),
      node("go", "button", "Inside frame", { parentId: "croot", backend: 1 }),
    ],
  },
], { boxes: [box("main", 1, 0, 0, 800, 600), box("main", 9, 20, 20, 300, 200), box("child", 1, 30, 40)] });
assert.match(framed.snapshot, /Iframe "Guest"/);
assert.match(framed.snapshot, /button "Inside frame" frame=1/);
const inner = framed.nodes.find(item => item.name === "Inside frame");
assert.equal(inner.frameId, "child");
assert.equal(inner.oopif, true);
assert.equal(inner.backendNodeId, 1, "a frame-local backend id stays distinct from the top document");

const unmeasuredSources = [
  {
    frameId: "main",
    nodes: [
      node("root", "RootWebArea", "Host", { backend: 1, childIds: ["go", "frame"] }),
      node("go", "button", "Main action", { parentId: "root", backend: 2 }),
      node("frame", "Iframe", "Guest", { parentId: "root", backend: 9 }),
    ],
  },
  {
    frameId: "child",
    parentFrameId: "main",
    iframeBackendNodeId: 9,
    nodes: [
      node("croot", "RootWebArea", "Guest", { backend: 1, childIds: ["inner"] }),
      node("inner", "button", "Unmeasured frame action", { parentId: "croot", backend: 2 }),
    ],
  },
];
const noGeometry = build(unmeasuredSources);
assert.match(noGeometry.snapshot, /button "Main action"/, "a page without layout data keeps its nodes");
assert.match(noGeometry.snapshot, /button "Unmeasured frame action"/);
const unmeasuredFrame = build(unmeasuredSources, { boxes: [box("main", 1, 0, 0, 800, 600), box("main", 9, 0, 100, 300, 200)] });
assert.doesNotMatch(unmeasuredFrame.snapshot, /button "Main action"/, "an unboxed node in a measured frame is treated as not rendered");
assert.match(unmeasuredFrame.snapshot, /button "Unmeasured frame action"/, "a frame without layout data is not hidden");

const cyclic = build([{
  frameId: "main",
  nodes: [
    node("root", "RootWebArea", "Cycle", { backend: 1, childIds: ["loop"] }),
    node("loop", "group", "Loop", { parentId: "root", backend: 2, childIds: ["root", "button"] }),
    node("button", "button", "Still here", { parentId: "loop", backend: 3 }),
  ],
}], { boxes: [box("main", 1, 0, 0, 800, 600), box("main", 2, 0, 0), box("main", 3, 10, 10)] });
assert.match(cyclic.snapshot, /button "Still here"/, "a cyclic accessibility tree still renders");

console.log("snapshot tree pruning, budget, viewport and frame graft tests passed");
