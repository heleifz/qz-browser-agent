import assert from "node:assert/strict";
import test from "node:test";
import { registerPageElementTools } from "../../src/capabilities/page/tools.js";
import { ToolExecutionError } from "../../src/background/tools/arguments.js";
import { createToolRegistry } from "../../src/background/tools/registry.js";

const flush = () => new Promise(resolve => setImmediate(resolve));
const empty = { results: [], matches: 0 };
const matched = { results: [{ target: "uid:t7.000001.1", role: "button", name: "Download" }], matches: 1 };
const failure = code => new ToolExecutionError(code, code);

function fixture(read = async () => empty) {
  let definition, reads = 0, bindings = 0;
  const controller = new AbortController(), seen = [];
  const authority = Symbol("authority");
  const context = { requestedTabRef: "page", signal: controller.signal, [authority]: "session-permit" };
  registerPageElementTools({
    registerTool(value) { if (value.name === "find_elements") definition = value; },
    ToolExecutionError,
    async resolveSelectorTarget(tabId, target, _index, observing) {
      assert.equal(observing[authority], "session-permit");
      return { tabId, target, selector: "#scope", ...(target.trim().startsWith("uid:") ? { uid: target, ref: {} } : {}) };
    },
    async useElement(_tabId, _target, observing, run) { return run((action, params) => send(7, action, params, observing)); },
    sendToContent: send,
    async addElementTargetsToFindResult(result) { bindings++; return result; },
  });
  async function send(_tabId, action, params, observing) {
    assert.equal(action, "findElements");
    seen.push({ params, observing });
    return read(++reads, observing);
  }
  return { definition, controller, context, seen,
    get reads() { return reads; }, get bindings() { return bindings; },
    run: args => definition.execute({ tabId: 7, target: "css:#scope", ...args }, controller.signal, context),
  };
}

test("default find returns its empty observation without waiting", async () => {
  const f = fixture();
  assert.equal(await f.run({}), empty);
  assert.equal(f.reads, 1);
});

test("match wait retains filters and returns the first nonempty observation with usable targets", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  const f = fixture(async count => count < 3 ? empty : matched);
  const pending = f.run({ waitFor: "match", roles: ["button"], pattern: "^Download$", includeHidden: true, limit: 1 });
  await flush();
  assert.equal(f.bindings, 0);
  for (let i = 0; i < 2; i++) { t.mock.timers.tick(100); await flush(); }
  assert.equal(await pending, matched);
  assert.equal(f.reads, 3);
  assert.equal(f.bindings, 1, "only the successful observation registers element references");
  assert.deepEqual(f.seen[2].params, { selector: "#scope", pattern: "^Download$", flags: "i", roles: ["button"], tags: [], types: [], limit: 1, includeHidden: true });
  assert.equal(Object.getPrototypeOf(f.seen[0].observing), f.context);
});

for (const code of ["ELEMENT_NOT_FOUND", "CONTENT_SCRIPT_NOT_READY", "CONTENT_SCRIPT_MESSAGE_FAILED", "EMPTY_CONTENT_RESPONSE"]) {
  test(`match wait retries temporary observation failure ${code}`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const f = fixture(async count => {
      if (count > 1) return matched;
      if (code === "ELEMENT_NOT_FOUND") return { code, message: "Scope is not attached yet" };
      throw failure(code);
    });
    const pending = f.run({ waitFor: "match" });
    await flush(); t.mock.timers.tick(100);
    assert.equal(await pending, matched);
    assert.equal(f.reads, 2);
  });
}

for (const code of ["INVALID_SELECTOR", "STALE_ELEMENT_UID", "SESSION_TAB_UNAVAILABLE", "SECURITY_GUARDRAIL_BLOCKED"]) {
  test(`match wait preserves permanent failure ${code}`, async () => {
    const error = failure(code), f = fixture(async () => { throw error; });
    await assert.rejects(f.run({ waitFor: "match" }), received => received === error);
    assert.equal(f.reads, 1);
    assert.equal(f.bindings, 0);
  });
}

test("a missing UID scope fails without rebinding to a replacement node", async () => {
  const error = failure("ELEMENT_NOT_FOUND"), f = fixture(async () => { throw error; });
  await assert.rejects(f.run({ target: " uid:t7.000001.8 ", waitFor: "match" }), received => received === error);
  assert.equal(f.reads, 1);
});

test("invalid regex fails before looking for a missing CSS scope", async () => {
  const f = fixture(async () => { throw failure("ELEMENT_NOT_FOUND"); });
  await assert.rejects(f.run({ waitFor: "match", pattern: "[" }), error => error.code === "INVALID_REGEX" && Boolean(error.hint));
  assert.equal(f.reads, 0);
});

test("malformed replies are not accepted as an empty match set", async () => {
  const f = fixture(async () => ({ matches: 0 }));
  await assert.rejects(f.run({ waitFor: "match" }), { code: "INVALID_CONTENT_RESPONSE" });
  assert.equal(f.reads, 1);
});

test("match wait has one ten-second default deadline and echoes the caller's references", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  const f = fixture();
  const rejected = assert.rejects(f.run({ waitFor: "match" }), error => {
    assert.equal(error.code, "TOOL_TIMEOUT");
    assert.deepEqual(error.details, { tabRef: "page", target: "css:#scope", timeout: 10 });
    assert.ok(error.hint);
    return true;
  });
  await flush(); t.mock.timers.tick(10000); await rejected;
  const reads = f.reads;
  t.mock.timers.tick(10000); await flush();
  assert.equal(f.reads, reads);
});

test("cancellation during a pending scan prevents late reference registration", async () => {
  let release;
  const f = fixture(() => new Promise(resolve => { release = resolve; }));
  const rejected = assert.rejects(f.run({ waitFor: "match" }), { code: "OPERATION_ABORTED" });
  await flush(); f.controller.abort(); await rejected;
  release(matched); await flush();
  assert.equal(f.bindings, 0);
  assert.equal(f.reads, 1);
});

test("host timeout retains snapshot partials but rejects an unfinished match wait", async () => {
  globalThis.chrome = {
    runtime: { getURL: path => `chrome-extension://test/${path}` },
    storage: { local: { async get() { return {}; } } },
    tabs: { async get(id) { return { id, url: "https://example.test/", title: "Fixture", status: "complete" }; } },
    scripting: { async executeScript() { return [{ documentId: "doc", result: { readyState: "complete" } }]; } },
  };
  const { createToolRuntime, resolveToolDefinition } = await import("../../src/background/tools/runtime.js");
  const registry = createToolRegistry();
  registry.forCapability("wait-test")({ ...resolveToolDefinition("find_elements"), timeout: 20,
    execute: () => new Promise(() => {}),
  });
  const runtime = createToolRuntime({ sessions: {
    isRunCurrent: () => true,
    resolveTargetTab: async input => ({ ok: true, tabId: input.tabId }),
  } });
  const context = { sessionId: "session", runId: "run", toolRegistrySnapshot: registry.snapshot() };
  for (const timeout of [0, -1, 301, Infinity, NaN]) {
    await assert.rejects(runtime.execute("find_elements", { tabRef: 7, waitFor: "match", timeout }, undefined, context), { code: "INVALID_TIMEOUT" });
  }
  await assert.rejects(runtime.execute("find_elements", { tabRef: 7, waitFor: "visible" }, undefined, context), { code: "INVALID_ARGUMENTS" });
  assert.equal((await runtime.execute("find_elements", { tabRef: 7 }, undefined, context)).incomplete.reason, "timeout");
  await assert.rejects(runtime.execute("find_elements", { tabRef: 7, waitFor: "match" }, undefined, context), { code: "TOOL_TIMEOUT" });
});
