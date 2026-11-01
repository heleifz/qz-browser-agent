import assert from "node:assert/strict";
import test from "node:test";

globalThis.SCRIPT_RUNTIME_SOURCE = "const QZ_SCRIPT_RUNTIME = { safeValueForMessage(value) { return value; }, installSecurityGuards() { return () => {}; } };";
const tabs = new Map([[7, { id: 7, windowId: 2, url: "https://example.test/page", title: "Page", status: "complete" }]]);
const bridgeMessages = [];
let bridgeListener;
const bridgeWindow = {
  addEventListener(_type, listener) { bridgeListener = listener; },
  postMessage() {},
};
globalThis.window = bridgeWindow;
globalThis.chrome = {
  runtime: {
    getURL: path => `chrome-extension://test/${path}`,
    async sendMessage(message) {
      bridgeMessages.push(message);
      return { ok: true };
    },
    lastError: undefined,
  },
  storage: { local: { async get() { return {}; } } },
  offscreen: {
    Reason: { BLOBS: "BLOBS", USER_MEDIA: "USER_MEDIA", AUDIO_PLAYBACK: "AUDIO_PLAYBACK" },
    async hasDocument() { return true; },
    async createDocument() { return {}; },
  },
  debugger: {
    onDetach: { addListener() {} },
    async attach() {},
    async detach() {},
    async sendCommand() { return {}; },
  },
  tabs: {
    async get(id) {
      if (!tabs.has(id)) throw new Error("No tab");
      return { ...tabs.get(id) };
    },
    onUpdated: { addListener() {}, removeListener() {} },
    async sendMessage() { return { ok: true }; },
  },
  scripting: {
    async executeScript() {
      return [{ documentId: "doc", result: { readyState: "complete", title: "Page", url: "https://example.test/page", observedAt: 1 } }];
    },
  },
};

const { createToolRuntime } = await import("../../src/background/tools/runtime.js");
await import("../../src/content/run-script-tool-bridge.ts");

const rows = count => Array.from({ length: count }, (_, index) => ({ level: "trace", message: `row-${index}` }));
const runtime = createToolRuntime({
  sessions: {
    isRunCurrent: () => true,
    async resolveTargetTab({ tabId }) {
      return tabs.has(tabId) ? { ok: true, tabId, ownedByCurrentTask: true } : { ok: false, code: "SESSION_TAB_UNAVAILABLE" };
    },
    async updateWorkingTab() { return { ok: true }; },
    listOwnedTabIds: () => [...tabs.keys()],
  },
});
const context = { sessionId: "timeout-trace", runId: "run", workingTabId: 7 };

test("script timeouts return the last five traces collected before the deadline", async () => {
  bridgeMessages.length = 0;
  bridgeListener({ source: bridgeWindow, data: { source: "qz-run-script-trace", parentCallId: "parent", trace: rows(6) } });
  assert.equal(bridgeMessages[0].type, "run_script_page_trace");
  assert.equal(bridgeMessages[0].parentCallId, "parent");
  assert.deepEqual(bridgeMessages[0].trace.map(row => row.message), ["row-1", "row-2", "row-3", "row-4", "row-5"]);
  bridgeListener({ source: bridgeWindow, data: { source: "unrelated" } });
  assert.equal(bridgeMessages.length, 1);

  chrome.runtime.sendMessage = async message => {
    if (message.type === "run_script_inner_ping") return { ok: true, ready: true };
    if (message.type === "run_script_inner_execute") {
      runtime.handleRunScriptInnerRuntimeMessage({
        type: "run_script_inner_script_trace",
        requestId: message.requestId,
        trace: rows(6),
      });
      return { ok: true, accepted: true };
    }
    return { ok: true };
  };
  const inner = await runtime.execute("run_script", {
    target: "inner",
    timeout: 1,
    code: "async () => { await new Promise(() => {}); }",
  }, undefined, context);
  assert.equal(inner.code, "TOOL_TIMEOUT");
  assert.deepEqual(inner.trace.map(row => row.message), ["row-1", "row-2", "row-3", "row-4", "row-5"]);

  chrome.debugger.sendCommand = async (_target, method, params) => {
    if (method !== "Runtime.evaluate") return {};
    const expression = String(params?.expression || "");
    const match = expression.match(/__qzTraceParentCallId = ("[^"]*")/);
    assert.ok(match, "page script should carry its call id");
    runtime.handleRunScriptInnerRuntimeMessage({
      type: "run_script_page_trace",
      parentCallId: JSON.parse(match[1]),
      trace: rows(6),
    });
    return new Promise(() => {});
  };
  const page = await runtime.execute("run_script", {
    timeout: 1,
    tabId: 7,
    code: "async () => { await new Promise(() => {}); }",
  }, undefined, context);
  assert.equal(page.code, "TOOL_TIMEOUT");
  assert.deepEqual(page.trace.map(row => row.message), ["row-1", "row-2", "row-3", "row-4", "row-5"]);
});
