import assert from "node:assert/strict";
import test from "node:test";
import { registerPageElementTools } from "../../src/capabilities/page/tools.js";
import { ToolExecutionError } from "../../src/background/tools/arguments.js";
import { createToolRegistry } from "../../src/background/tools/registry.js";
import { createQzSdk } from "../../src/shared/qz-script-sdk.js";
import { createToolOperation, withToolOperationFailure } from "../../src/background/tools/tool-operation.js";
import { withToolCallLifecycle } from "../../src/background/tools/call-lifecycle.js";
import { createRunScriptBridge } from "../../src/background/tools/run-script-bridge.js";
import { localizeToolFailurePayload } from "../../src/shared/tools/tool-error-localization.js";
import { withLanguage } from "../../src/shared/i18n/index.js";

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
    assert.deepEqual(error.details, { tabRef: "page", target: "css:#scope", timeoutMs: 10000 });
    return true;
  });
  await flush(); t.mock.timers.tick(10000); await rejected;
  const reads = f.reads;
  t.mock.timers.tick(10000); await flush();
  assert.equal(f.reads, reads);
});

test("literal query fields reach the page only when supplied", async () => {
  const f = fixture();
  await f.run({ text: "Tomorrow", exact: false, limit: 8 });
  await f.run({ roles: ["link"], name: "Download" });
  assert.deepEqual(f.seen[0].params, { text: "Tomorrow", exact: false, selector: "#scope", pattern: "", flags: "i", roles: [], tags: [], types: [], limit: 8, includeHidden: false });
  assert.deepEqual(f.seen[1].params, { name: "Download", selector: "#scope", pattern: "", flags: "i", roles: ["link"], tags: [], types: [], limit: 20, includeHidden: false });
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

test("find rejects unknown query fields before page access and retains canonical filters and hidden aliases", async () => {
  globalThis.chrome = {
    runtime: { getURL: path => `chrome-extension://test/${path}` },
    storage: { local: { async get() { return {}; } } },
    tabs: {
      async get(id) { return { id, url: "https://example.test/", title: "Fixture", status: "complete" }; },
      async sendMessage(_id, message) {
        if (message.action === "ping") return { ok: true, contentType: "text/html", elementRefs: 1 };
        assert.equal(message.action, "elementPresence");
        return { found: true };
      },
    },
  };
  const { createToolRuntime, resolveToolDefinition } = await import("../../src/background/tools/runtime.js");
  const registry = createToolRegistry(), calls = [], accesses = [];
  const definition = resolveToolDefinition("find_elements");
  registry.forCapability("query-test")({ ...definition, execute: args => { calls.push(args); return { results: [] }; } });
  const runtime = createToolRuntime({ sessions: {
    isRunCurrent: () => true, getTabAliases: () => ({ page: 7 }),
    async resolveTargetTab(input) { accesses.push(input); return { ok: true, tabId: input.tabId }; },
  } });
  const context = { sessionId: "session", runId: "run", language: "en", toolRegistrySnapshot: registry.snapshot("en") };
  const qz = createQzSdk((name, args) => runtime.execute(name, args, undefined, context));
  for (const invoke of [
    () => qz.tab("page").find({ roel: "link" }),
    () => qz.call("find_elements", { tabRef: "page", roles: ["link"], roel: "button" }),
  ]) await assert.rejects(invoke, error => {
    assert.equal(error.code, "INVALID_ARGUMENTS");
    assert.deepEqual(error.details.invalidFields, ["roel"]);
    assert.ok(error.details.allowedFields.includes("roles"));
    assert.match(error.message, /Unknown fields.*roel.*Supported fields:.*roles/);
    assert.doesNotMatch(error.message, /expected an object/);
    return true;
  });
  assert.equal(accesses.length, 0);
  assert.equal(calls.length, 0, "unknown fields cannot silently broaden the search");
  for (const [single, plural, value] of [["role", "roles", "link"], ["tag", "tags", "input"], ["type", "types", "search"]]) {
    await assert.rejects(qz.tab("page").find({ [single]: value, [plural]: [value] }), error => {
      assert.equal(error.code, "INVALID_ARGUMENTS");
      assert.equal(error.message, `Use ${single} for one value or ${plural} for multiple values; pass only one of these fields.`);
      assert.deepEqual(error.details.invalidFields, [single, plural]);
      return true;
    });
    await assert.rejects(qz.tab("page").find({ [single]: value, locator: { role: "button" } }), error => {
      assert.equal(error.code, "INVALID_ARGUMENTS");
      assert.match(error.message, /Pass locator or discovery filters, not both/);
      return true;
    });
  }
  assert.equal(accesses.length, 0, "conflicting filters are rejected before page access");
  await qz.tab("page").find({ role: "searchbox", tag: "input", type: "search", target: "css:main" });
  const singles = calls.pop();
  assert.equal(singles.role, "searchbox"); assert.equal(singles.tag, "input"); assert.equal(singles.type, "search");
  await qz.tab("page").find({ roles: ["link"], target: "css:main" });
  await qz.call("find_elements", { tabRef: "page", roles: ["link"], selector: "css:main" });
  await runtime.execute("find_elements", { tabId: 7, roles: ["link"], selector: "css:main" }, undefined, context);
  for (const call of calls) {
    assert.deepEqual(call.roles, ["link"]);
    assert.equal(call.target, "css:main");
    assert.equal(call.tabId, 7);
    assert.equal(Object.hasOwn(call, "selector"), false);
  }
  assert.equal(calls.length, 3);
  await qz.tab("page").locator({ role: "link" }).count();
  assert.deepEqual(calls.at(-1).locator, { role: "link" });
  assert.equal(calls.at(-1).countOnly, true);
});

test("find shares locator query fields, keeps pattern as the exclusive regex form, and rejects validation before starting", async () => {
  globalThis.chrome = {
    runtime: { getURL: path => `chrome-extension://test/${path}` },
    storage: { local: { async get() { return {}; } } },
    tabs: {
      async get(id) { return { id, url: "https://example.test/", title: "Fixture", status: "complete" }; },
      async sendMessage() { return { ok: true, contentType: "text/html", elementRefs: 1 }; },
    },
  };
  const { createToolRuntime, resolveToolDefinition } = await import("../../src/background/tools/runtime.js");
  const registry = createToolRegistry(), calls = [], accesses = [];
  registry.forCapability("query-fields-test")({ ...resolveToolDefinition("find_elements"), execute: args => { calls.push(args); return { results: [] }; } });
  const runtime = createToolRuntime({ sessions: {
    isRunCurrent: () => true, getTabAliases: () => ({ page: 7 }),
    async resolveTargetTab(input) { accesses.push(input); return { ok: true, tabId: input.tabId }; },
  } });
  const context = { sessionId: "session", runId: "run", language: "en", toolRegistrySnapshot: registry.snapshot("en") };
  const qz = createQzSdk((name, args) => runtime.execute(name, args, undefined, context));
  const page = qz.tab("page");
  const notStarted = { tool: "find_elements", status: "not_started", executed: false, mayHaveTakenEffect: false, automaticReplay: false };

  await page.find({ text: "Tomorrow", exact: false, limit: 8, scope: "css:main" });
  await page.find({ role: "link", name: "Download" });
  await page.find({ role: "link", pattern: /download/i });
  assert.deepEqual(calls.map(({ text, name, exact, pattern, flags, target, role }) => ({ text, name, exact, pattern, flags, target, role })), [
    { text: "Tomorrow", name: undefined, exact: false, pattern: undefined, flags: undefined, target: "css:main", role: undefined },
    { text: undefined, name: "Download", exact: undefined, pattern: undefined, flags: undefined, target: undefined, role: "link" },
    { text: undefined, name: undefined, exact: undefined, pattern: "download", flags: "i", target: undefined, role: "link" },
  ]);
  assert.equal(Object.hasOwn(calls[0], "scope"), false, "scope is the locator name for find's search root");

  const accessed = accesses.length;
  const conflict = "Use name/text/exact for literal matching or pattern/flags for a regular expression; pass only one kind.";
  for (const [query, fields, message] of [
    [{ text: "Tomorrow", pattern: "Tomorrow" }, ["text", "pattern"], conflict],
    [{ name: "Download", exact: false, pattern: "Down", flags: "i" }, ["name", "exact", "pattern", "flags"], conflict],
    [{ text: "Tomorrow", pattern: /Tomorrow/ }, ["text", "pattern", "flags"], conflict],
    [{ text: "  " }, ["text"], "text must be a non-empty string."],
  ]) await assert.rejects(page.find(query), error => {
    assert.equal(error.code, "INVALID_ARGUMENTS");
    assert.equal(error.message, message);
    assert.deepEqual(error.details, { invalidFields: fields, ...notStarted });
    return true;
  });
  assert.equal(calls.length, 3);
  assert.equal(accesses.length, accessed, "invalid queries are rejected before page access");

  const outer = createToolOperation();
  outer.prepare({ tool: "run_script" });
  outer.dispatch();
  const bridge = createRunScriptBridge({
    supervisor: { isRunCurrent: () => true, hasAgent: () => true, getAbortSignal: () => undefined },
    getRuntime: () => ({ status: "running" }),
    canManageSessions: async () => false,
    buildRunProfile: async () => ({}),
    getRunToolContext: async () => ({ toolRegistrySnapshot: context.toolRegistrySnapshot, language: "en" }),
    toolRuntime: { resolveDefinition: resolveToolDefinition, getTabAliases: () => ({ page: 7 }), execute: (...args) => runtime.execute(...args) },
    collectArtifacts: () => [],
  });
  const viaBridge = query => withToolCallLifecycle({ sessionId: "session", runId: "run", operation: outer },
    parent => createQzSdk((name, args) => bridge.invokeTool(parent, name, args)).tab("page").find(query));
  for (const invoke of [
    () => runtime.execute("find_elements", { tabRef: "page", text: "Tomorrow", exat: false, limit: 8 }, undefined, context),
    () => page.find({ text: "Tomorrow", exat: false, limit: 8 }),
    () => viaBridge({ text: "Tomorrow", exat: false, limit: 8 }),
  ]) {
    const error = await invoke().then(() => assert.fail("unknown fields must be rejected"), received => received);
    const failure = withToolOperationFailure(error, outer);
    for (const language of ["en", "zh-CN"]) {
      const shown = withLanguage(language, () => localizeToolFailurePayload(failure, { isError: true }));
      assert.equal(shown.code, "INVALID_ARGUMENTS");
      assert.match(shown.message || shown.error, /exat/);
      assert.doesNotMatch(shown.message || shown.error, /timed out|操作超时/);
    }
    assert.match(error.message || error.error, /Unknown fields.*exat.*Supported fields:.*exact/);
    const { invalidFields, allowedFields, ...facts } = failure.details;
    assert.deepEqual(invalidFields, ["exat"]);
    assert.ok(allowedFields.includes("text"));
    assert.deepEqual(facts, { name: "find_elements", path: "$", ...notStarted });
  }
  assert.equal(calls.length, 3);
});

test("host timeout rejects unfinished snapshots and match waits", async () => {
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
  await assert.rejects(runtime.execute("find_elements", { tabRef: 7 }, undefined, context), { code: "TOOL_TIMEOUT" });
  await assert.rejects(runtime.execute("find_elements", { tabRef: 7, waitFor: "match" }, undefined, context), { code: "TOOL_TIMEOUT" });
  const outer = createToolOperation();
  outer.prepare({ tool: "run_script" });
  for (const [language, expected] of [["en", /timed out/i], ["zh-CN", /超时/]]) {
    const timedOut = await runtime.execute("find_elements", { tabRef: 7, text: "Tomorrow", exact: false }, undefined, { ...context, language, toolRegistrySnapshot: registry.snapshot(language), operation: outer })
      .then(() => assert.fail("the scan never finishes"), error => error);
    assert.equal(timedOut.code, "TOOL_TIMEOUT");
    const shown = withLanguage(language, () => localizeToolFailurePayload(withToolOperationFailure(timedOut, outer), { isError: true }));
    assert.equal(shown.code, "TOOL_TIMEOUT");
    assert.match(shown.message || shown.error, expected, "a real timeout still reports a timeout");
  }
});
