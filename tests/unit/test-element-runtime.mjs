import assert from "node:assert/strict";

let currentUrl = "https://example.test/page#one";
const listeners = new Set();
const commands = [];
globalThis.chrome = {
  tabs: { async get(tabId) { return { id: tabId, url: currentUrl }; } },
  debugger: {
    onEvent: {
      addListener(listener) { listeners.add(listener); },
      removeListener(listener) { listeners.delete(listener); },
    },
    async sendCommand() { return {}; },
  },
};

const { createElementRuntime } = await import("../../src/background/tools/element-runtime.js");

class ToolExecutionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const resolveCalls = [];
const runtime = createElementRuntime({
  ToolExecutionError,
  getToolRuntimeDependencies() {
    return {
      sessions: {
        async resolveTargetTab(input) {
          resolveCalls.push(input);
          return { ok: true };
        },
      },
    };
  },
  makeSessionTabTargetError(code, details = {}) { return new ToolExecutionError(code, code, details); },
  async assertTabAllowed() {},
  async withDebugger(tabId, callback) {
    return await callback({ tabId }, async (method, params = {}) => {
      commands.push(method);
      if (method === "Runtime.enable") {
        for (const listener of listeners) {
          listener({ tabId }, "Runtime.executionContextCreated", {
            context: { id: 7, auxData: { isDefault: false, frameId: "main" } },
          });
        }
        return {};
      }
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: params.frameId || "main", loaderId: "loader-live" } } };
      if (method === "Runtime.evaluate") {
        const expression = String(params.expression || "");
        if (expression.includes("__qzContentBuild")) return { result: { value: "2026-10-22-direct-node" } };
        if (expression.includes("__qzCount")) return { result: { value: expression.includes("twice") ? { matched: 2 } : { matched: 1 } } };
        if (expression.includes("__qzNode")) return { result: { objectId: "css-node" } };
      }
      if (method === "DOM.resolveNode") return { object: { objectId: "uid-node" } };
      if (method === "Runtime.callFunctionOn") return { result: { value: { ok: true, action: params.arguments?.[0]?.value?.action || "" } } };
      if (method === "Runtime.releaseObject") return {};
      throw new Error(`unexpected CDP method ${method}`);
    });
  },
});

runtime.registerElementRef({
  uid: "t5_ax_1",
  tabId: 5,
  sessionId: "session-a",
  pageUrl: "https://example.test/page",
  selector: "button.primary",
  backendNodeId: 41,
  loaderId: "loader-live",
  frameId: "main",
});

const resolved = await runtime.resolveElementReference(undefined, { target: "uid:t5_ax_1" }, { sessionId: "session-a" });
assert.equal(resolved.tabId, 5);
assert.equal(resolved.selector, "");
assert.equal(resolved.ref.backendNodeId, 41);
assert.equal(resolved.target, "uid:t5_ax_1");
assert.equal(resolveCalls.length, 1);
assert.equal(commands.length, 0, "resolving a uid must not query or generate a selector");

const css = await runtime.resolveElementReference(5, { target: "css:main > button", index: 2 }, { sessionId: "session-a" });
assert.equal(css.selector, "main > button");
assert.equal(css.index, 2);

await assert.rejects(
  runtime.resolveElementReference(5, {}, { sessionId: "session-a" }),
  error => error?.code === "MISSING_ELEMENT_REFERENCE",
  "an empty read_image target path must still fail before page access",
);
await assert.rejects(
  runtime.resolveElementReference(5, { target: "uid:missing" }, { sessionId: "session-a" }),
  error => error?.code === "STALE_ELEMENT_UID",
);
await assert.rejects(
  runtime.resolveElementReference(5, { target: "uid:t5_ax_1" }, { sessionId: "session-b" }),
  error => error?.code === "ELEMENT_UID_SESSION_MISMATCH",
);

currentUrl = "https://example.test/other";
await assert.rejects(
  runtime.resolveElementReference(5, { target: "uid:t5_ax_1" }, { sessionId: "session-a" }),
  error => error?.code === "STALE_ELEMENT_UID_PAGE_CHANGED",
);
currentUrl = "https://example.test/page#two";

const called = await runtime.callElement(5, resolved, "inspectElement", {}, { sessionId: "session-a" });
assert.equal(called.ok, true);
assert.equal(called.action, "inspectElement");
assert.ok(commands.includes("DOM.resolveNode"));
assert.ok(commands.includes("Runtime.callFunctionOn"));
assert.equal(commands.includes("DOM.querySelector"), false);
assert.equal(commands.includes("DOM.describeNode"), false);
assert.equal(runtime.selectorFromBackendNode, undefined);

runtime.registerElementRef({
  uid: "t5_ax_old",
  tabId: 5,
  sessionId: "session-a",
  pageUrl: "https://example.test/page",
  selector: "button.primary",
  backendNodeId: 41,
  loaderId: "loader-previous",
  frameId: "main",
});
const beforeStale = commands.length;
const staleRef = { backendNodeId: 41, loaderId: "loader-previous", frameId: "main" };
await assert.rejects(
  runtime.callElement(5, { tabId: 5, uid: "t5_ax_old", target: "uid:t5_ax_old", ref: staleRef }, "inspectElement", {}, { sessionId: "session-a" }),
  error => error?.code === "STALE_ELEMENT_UID" && /get_ax_tree/.test(error.message),
);
assert.equal(commands.slice(beforeStale).includes("DOM.resolveNode"), false, "a replaced document must not be rematched");
await assert.rejects(
  runtime.callElement(5, { tabId: 5, uid: "t5_ax_1", target: "uid:t5_ax_1", ref: { backendNodeId: 41, loaderId: "loader-live", frameId: "child" } }, "inspectElement", {}, { sessionId: "session-a" }),
  error => error?.code === "ELEMENT_CONTEXT_UNSUPPORTED",
);

const indexed = await runtime.callElement(5, { tabId: 5, selector: "button.twice", index: 1, target: "css:button.twice" }, "inspectElement", {}, { sessionId: "session-a" });
assert.equal(indexed.ok, true);
await assert.rejects(
  runtime.callElement(5, { tabId: 5, selector: "button.twice", target: "css:button.twice" }, "inspectElement", {}, { sessionId: "session-a" }),
  error => error?.code === "ELEMENT_INDEX_REQUIRED",
);

assert.equal(runtime.isUidElementTarget("uid:t5_ax_1"), true);
assert.equal(runtime.elementTargetForSelector("#save"), "css:#save");

console.log("element runtime ownership tests passed");
