import assert from "node:assert/strict";
import { buildPageSnapshot } from "../../src/capabilities/accessibility/snapshot-tree.ts";

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
    rootBackendNodeId: options.rootBackendNodeId,
    rootFrameId: options.rootFrameId,
  });
}

const page = [{
  frameId: "main",
  nodes: [
    node("root", "RootWebArea", "Page", { backend: 1, childIds: ["seen", "hidden", "text"] }),
    node("seen", "button", "Seen", { parentId: "root", backend: 2 }),
    node("hidden", "button", "Below fold", { parentId: "root", backend: 3 }),
    node("text", "StaticText", "Seen", { parentId: "root", backend: 4 }),
  ],
}];
const kept = build(page);
assert.match(kept.snapshot, /button "Seen"/);
assert.match(kept.snapshot, /button "Below fold"/, "nodes outside the viewport stay in the snapshot");
assert.match(kept.snapshot, /StaticText "Seen"/, "text nodes stay even when they repeat a sibling name");

const breadth = build([{
  frameId: "main",
  nodes: [
    node("root", "RootWebArea", "Page", { backend: 1, childIds: ["left", "right"] }),
    node("left", "group", "Left", { parentId: "root", backend: 2, childIds: ["deep"] }),
    node("deep", "button", "Deep", { parentId: "left", backend: 3 }),
    node("right", "button", "Right", { parentId: "root", backend: 4 }),
  ],
}], { limit: 3 });
assert.match(breadth.snapshot, /button "Right"/, "the budget covers the next sibling before a deeper node");
assert.doesNotMatch(breadth.snapshot, /button "Deep"/);
assert.match(breadth.snapshot, /\(truncated\)/);

const subtree = build([{
  frameId: "main",
  nodes: [
    node("root", "RootWebArea", "Page", { backend: 1, childIds: ["panel"] }),
    node("panel", "group", "Panel", { parentId: "root", backend: 2, childIds: ["far"] }),
    node("far", "button", "Far", { parentId: "panel", backend: 3 }),
  ],
}], { rootBackendNodeId: 2, maxDepth: 2 });
assert.equal(subtree.rootFound, true);
assert.match(subtree.snapshot, /button "Far"/);
assert.doesNotMatch(subtree.snapshot, /RootWebArea/);

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
]);
assert.match(framed.snapshot, /Iframe "Guest"/);
assert.match(framed.snapshot, /button "Inside frame" frame=1/);
const inner = framed.nodes.find(item => item.name === "Inside frame");
assert.equal(inner.frameId, "child");
assert.equal(inner.oopif, true);
assert.equal(inner.backendNodeId, 1, "a frame-local backend id stays distinct from the top document");

const cyclic = build([{
  frameId: "main",
  nodes: [
    node("root", "RootWebArea", "Cycle", { backend: 1, childIds: ["loop"] }),
    node("loop", "group", "Loop", { parentId: "root", backend: 2, childIds: ["root", "button"] }),
    node("button", "button", "Still here", { parentId: "loop", backend: 3 }),
  ],
}]);
assert.match(cyclic.snapshot, /button "Still here"/, "a cyclic accessibility tree still renders");

console.log("snapshot tree breadth-first budget and frame graft tests passed");
