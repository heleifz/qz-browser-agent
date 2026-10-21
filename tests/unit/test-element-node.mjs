import assert from "node:assert/strict";

globalThis.ELEMENT_PAGE_SCRIPT_SOURCE = "";
const { withBoundElement } = await import("../../src/background/tools/element-node.ts");

class ToolExecutionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function hostFor(send) {
  return {
    ToolExecutionError,
    async withDebugger(_tabId, fn) { return fn({ tabId: 3 }, send); },
  };
}

const binding = {
  tabId: 3,
  target: "uid:t3_ax_1",
  uid: "t3_ax_1",
  backendNodeId: 40,
  loaderId: "doc-a",
  selector: "#buy",
};

{
  const calls = [];
  const send = async (method, params = {}) => {
    calls.push(method);
    if (method === "Page.getFrameTree") return { frameTree: { frame: { loaderId: "doc-b" } } };
    if (method === "DOM.resolveNode" || method === "Runtime.evaluate") throw new Error("selector fallback");
    return {};
  };
  await assert.rejects(
    withBoundElement(hostFor(send), binding, {}, async () => ({})),
    error => error.code === "STALE_ELEMENT_UID" && /get_ax_tree/.test(error.message) && error.details.reason === "document-changed",
    "a same-url document change invalidates the uid",
  );
  assert.deepEqual(calls, ["Page.getFrameTree"], "a stale document does not resolve or query a selector");
}

{
  const calls = [];
  const send = async (method) => {
    calls.push(method);
    if (method === "Page.getFrameTree") return { frameTree: { frame: { loaderId: "doc-a" } } };
    if (method === "DOM.resolveNode") throw new Error("No node with given id found");
    if (method === "Runtime.evaluate") throw new Error("selector fallback");
    return {};
  };
  await assert.rejects(
    withBoundElement(hostFor(send), binding, {}, async () => ({})),
    error => error.code === "STALE_ELEMENT_UID" && error.details.reason === "node-replaced" && /get_ax_tree/.test(error.message),
    "a replaced node is not recovered through its old selector",
  );
  assert.equal(calls.includes("Runtime.evaluate"), false);
}

{
  const calls = [];
  let released = "";
  const send = async (method, params = {}) => {
    calls.push(method);
    if (method === "Page.getFrameTree") return { frameTree: { frame: { loaderId: "doc-a" } } };
    if (method === "DOM.resolveNode") return { object: { objectId: "obj-1" } };
    if (method === "Runtime.callFunctionOn") return { result: { value: { tag: "button", visible: true } } };
    if (method === "Runtime.releaseObject") released = params.objectId;
    return {};
  };
  const seen = await withBoundElement(hostFor(send), binding, {}, async (node) => {
    assert.equal(node.objectId, "obj-1");
    return node.call({ action: "inspect" });
  });
  assert.equal(seen.tag, "button");
  assert.equal(released, "obj-1", "the object id is released when the operation ends");
  assert.equal(calls.filter(method => method === "Runtime.evaluate").length, 0, "the uid path does not query a selector");
}

{
  const send = async (method, params = {}) => {
    if (method === "Runtime.evaluate" && params.returnByValue) return { result: { value: { matched: 2, found: true } } };
    if (method === "Runtime.evaluate") return { result: { objectId: "css-obj" } };
    if (method === "Runtime.callFunctionOn") return { result: { value: { tag: "input" } } };
    return {};
  };
  const seen = await withBoundElement(hostFor(send), {
    tabId: 3,
    target: "css:#shared-field",
    selector: "#shared-field",
    index: 1,
  }, {}, async (node) => node.objectId);
  assert.equal(seen, "css-obj", "an explicit css target queries the current document");
}

console.log("element node binding passed");
