import assert from "node:assert/strict";
import test from "node:test";
import { createToolRegistry } from "../../src/background/tools/registry.js";
import { planTabBatch } from "../../src/background/tools/tab-batch.js";
import { scheduleToolCalls } from "../../src/background/tools/tool-scheduler.js";
import { findBuiltinSkill } from "../../src/shared/skills/builtin-skills.js";
import { parseSkillManifest, findSkillManifestResource } from "../../src/shared/skills/skill-manifest.js";
import { createRunScriptBridge } from "../../src/background/tools/run-script-bridge.js";
import { clearTraceLog, getTraceLog } from "../../src/background/trace.js";

globalThis.chrome = {
  runtime: { getURL: path => path },
  storage: { local: { async get() { return {}; } } },
  tabs: { async get(id) { return { id, url: "https://example.test/", title: "Page" }; } },
};
const tools = await import("../../src/background/tools/runtime.js");
const context = { sessionId: "session", runId: "run", workingTabId: 31 };
const scriptContext = { ...context, source: "run_script", senderTabId: 31, runScriptToolDepth: 0 };
const controller = new AbortController();
let currentRun = true;
const targets = [];
const runtime = tools.createToolRuntime({ sessions: {
  async resolveTargetTab(input) {
    targets.push(input);
    return input.tabId === 99 ? { ok: false, code: "SESSION_TAB_FOREIGN" } : { ok: true, tabId: input.tabId };
  },
} });
const bridge = createRunScriptBridge({
  supervisor: { isRunCurrent: () => currentRun, hasAgent: () => true, getAbortSignal: () => controller.signal },
  getRuntime: () => ({ status: "running", workingTabId: 31 }),
  canManageSessions: async () => true,
  buildRunProfile: async () => ({}),
  toolRuntime: runtime,
  collectArtifacts: () => [],
});
const nested = (toolName, args = {}, tabId = 31) => bridge.handleToolCall({ ...context, toolName, args }, { tab: { id: tabId } });

test("a newly named tool declares unload behavior once for direct script and forwarded host execution", async () => {
  let calls = 0;
  const behavior = { mayUnloadPage: args => args.action === "leave" };
  tools.defineTool({ name: "__custom_page_action", description: "Test", behavior, page: "owned", parameters: {
    type: "object", properties: { action: { type: "string", enum: ["stay", "leave"] }, tabId: { type: "number" } }, required: ["action"],
  }, execute: () => { calls++; return { value: calls }; } });
  behavior.mayUnloadPage = false;
  assert.ok(Object.isFrozen(runtime.resolveDefinition("__custom_page_action").behavior));
  const before = targets.length;
  assert.equal((await nested("__custom_page_action", { action: "invalid" })).code, "INVALID_ARGUMENTS");
  assert.equal(targets.length, before, "invalid arguments must fail before target ownership work");
  const denied = await nested("__custom_page_action", { action: "leave" });
  assert.equal(denied.code, "RUN_SCRIPT_SELF_UNLOADING_TOOL_BLOCKED");
  assert.equal(denied.details.targetTabId, 31);
  assert.equal(calls, 0);
  await assert.rejects(runtime.execute("__custom_page_action", { action: "leave" }, undefined,
    { ...scriptContext, source: "plugin_host" }), { code: "RUN_SCRIPT_SELF_UNLOADING_TOOL_BLOCKED" });
  assert.equal((await nested("__custom_page_action", { action: "leave", tabId: 99 })).code, "SESSION_TAB_FOREIGN");
  assert.equal(calls, 0, "lifecycle policy cannot grant ownership");
  assert.equal((await nested("__custom_page_action", { action: "stay" })).ok, true);
  assert.equal((await nested("__custom_page_action", { action: "leave", tabId: 32 })).ok, true);
  await runtime.execute("__custom_page_action", { action: "leave" }, undefined, { ...context, senderTabId: 31 });
  assert.equal(calls, 3, "ordinary calls and other owned tabs retain their established behavior");
});

test("built-in unload declarations retain navigation, closing, click, submit and key protection", async () => {
  for (const [name, args] of [
    ["navigate", { url: "https://example.test/next" }],
    ["close_tab", { tabId: 31 }],
    ["act_on_element", { target: "css:button", action: "click" }],
    ["act_on_element", { target: "uid:unknown", action: "click" }],
    ["act_on_element", { target: "css:input", action: "fill", value: "search", submit: true }],
    ...["Enter", "Return", "Space"].map(key => ["act_on_element", { target: "css:input", action: "press", key }]),
  ]) {
    const result = await nested(name, args);
    assert.equal(result.code, "RUN_SCRIPT_SELF_UNLOADING_TOOL_BLOCKED", `${name} ${JSON.stringify(args)}`);
    assert.equal(result.details.sourceTabId, 31);
  }
  const policy = runtime.resolveDefinition("act_on_element").behavior.mayUnloadPage;
  assert.equal(policy({ action: "press", value: "Enter" }), true);
  for (const args of [{ action: "fill", submit: false }, { action: "press", key: "Tab" }, { action: "check" }, { action: "scroll" }]) {
    assert.equal(policy(args), false);
  }
});

test("new observation tools promote images only through trusted definitions and preserve cancellation", async () => {
  let calls = 0;
  const image = "data:image/png;base64,b2JzZXJ2YXRpb24=";
  const parameters = { type: "object", properties: { observe: { type: "boolean" } } };
  const execute = () => { calls++; return { _image: image, _imageDetail: "high", _display: { image }, behavior: { nestedObservation: true } }; };
  tools.defineTool({ name: "__custom_observe", description: "Test", parameters,
    behavior: { nestedObservation: args => args.observe === true }, execute });
  tools.defineTool({ name: "__ordinary_image", description: "Test", parameters, execute });
  const promoted = await nested("__custom_observe", { observe: true });
  assert.deepEqual(promoted.observation, { _image: image, _imageDetail: "high" });
  assert.equal(promoted.result._image, undefined);
  assert.equal(promoted.result._display, undefined);
  for (const [name, args] of [["__custom_observe", { observe: false }], ["__ordinary_image", { observe: true }]]) {
    const result = await nested(name, args);
    assert.equal(result.observation, undefined, "an ordinary result cannot declare its own observation role");
    assert.equal(result.result._image, image);
  }
  currentRun = false;
  assert.equal((await nested("__custom_observe", { observe: true })).code, "RUN_STOPPED");
  currentRun = true;
  controller.abort();
  assert.equal((await nested("__custom_observe", { observe: true })).code, "RUN_STOPPED");
  assert.equal(calls, 3, "stale and cancelled runs never invoke the tool");
});

test("external plugins cannot declare behavior, while trusted host aliases inherit their core target", () => {
  const registry = createToolRegistry();
  registry.defineTool({ ...tools.resolveToolDefinition("manage_settings"), workingTab: 'created',
    behavior: { nestedObservation: true, mayUnloadPage: true, parallelRead: true },
  });
  const toolRegistrySnapshot = registry.snapshot();
  const core = toolRegistrySnapshot.get("manage_settings");
  assert.throws(() => { core.behavior = {}; }, TypeError, "registered behavior remains immutable");
  const skill = findBuiltinSkill("qingzhou-management");
  const plugin = parseSkillManifest(findSkillManifestResource(skill.resources).content, skill).plugin;
  const tool = plugin.tools.find(item => item.localName === "manage_settings");
  const resolve = plugin => runtime.resolveDefinition(tool.name, { toolRegistrySnapshot, skillToolRegistrySnapshot: {
    plugins: [plugin], toolIndex: new Map([[tool.name, { plugin, tool }]]),
  } });
  assert.deepEqual(resolve(plugin).behavior, { ...core.behavior, barrier: true });
  assert.equal(runtime.getParallelReadTab('manage_settings', { tabId: 12 }, { toolRegistrySnapshot }), 12);
  assert.deepEqual(runtime.getBatchTabPolicy('manage_settings', { tabAlias: 'a' }, { toolRegistrySnapshot }), { kind: 'create' });
  for (const candidate of [plugin, structuredClone(plugin)]) {
    const claimedTool = { ...tool, source: 'core', behavior: { barrier: false, parallelRead: true, parallelOpen: true, parallelTab: true } };
    const options = { toolRegistrySnapshot, skillToolRegistrySnapshot: {
      plugins: [candidate], toolIndex: new Map([[tool.name, { plugin: candidate, tool: claimedTool }]]),
    } };
    assert.equal(runtime.resolveDefinition(tool.name, options).source, 'plugin');
    assert.equal(runtime.getParallelReadTab(tool.name, { tabId: 12, parallelRead: true }, options), null,
      'even a trusted host alias or a forged plugin source stays outside core scheduling authority');
    assert.deepEqual(runtime.getBatchTabPolicy(tool.name, { tabAlias: 'a', tabRef: 'b' }, options), { kind: 'barrier' },
      'plugin aliases also cannot create or resolve batch tab bindings');
  }
  for (const untrusted of [structuredClone(plugin), { ...plugin, skillBuiltin: false }, { ...plugin, skillSource: "local" }, { ...plugin, id: "external-plugin" }]) {
    assert.deepEqual(resolve(untrusted).behavior, { barrier: true }, "plugin declarations must not cross the trusted behavior boundary");
  }
});

test('capability declarations alone place new tool names into the same graph, with barrier precedence', async () => {
  const registry = createToolRegistry(), qz = { registerTool: registry.forCapability('sample-capability') };
  const base = { description: 'Fixture', page: 'tab', parameters: { type: 'object', properties: { tabId: { type: 'number' } } }, execute: () => ({}) };
  qz.registerTool({ ...base, name: 'sample_local', behavior: { parallelTab: true } });
  qz.registerTool({ ...base, name: 'sample_read', behavior: { parallelRead: true } });
  qz.registerTool({ ...base, name: 'sample_barrier', behavior: { parallelTab: true, parallelRead: true, barrier: true } });
  qz.registerTool({ ...base, name: 'sample_creator', workingTab: 'created', behavior: { parallelOpen: true, barrier: true } });
  qz.registerTool({ name: 'sample_global', description: 'Global', behavior: { barrier: true },
    parameters: { type: 'object', properties: {} }, execute: () => ({}) });
  const lookup = { toolRegistrySnapshot: registry.snapshot() };
  assert.equal(tools.getParallelReadTab('sample_read', { tabId: 4 }, lookup), 4);
  assert.equal(tools.getParallelReadTab('sample_barrier', { tabId: 3, barrier: false }, lookup), null);
  assert.deepEqual(tools.getBatchTabPolicy('sample_creator', {}, lookup), { kind: 'create', parallel: false });
  assert.deepEqual(tools.getBatchTabPolicy('sample_global', {}, lookup), { kind: 'barrier' });
  const input = [
    { name: 'sample_local', tabId: 1 }, { name: 'sample_local', tabId: 2 },
    { name: 'sample_barrier', tabId: 3 }, { name: 'sample_read', tabId: 4 },
  ];
  const plan = planTabBatch(input, item => ({ args: { tabId: item.tabId }, policy: tools.getBatchTabPolicy(item.name, item, lookup) }));
  const started = [], committed = [], releases = new Map(), tick = () => new Promise(resolve => setImmediate(resolve));
  const run = scheduleToolCalls(input, { signal: new AbortController().signal, tab: item => item.tabId,
    dependencies: plan.dependencies, independent: plan.independent,
    execute: async item => { started.push(item.tabId); await new Promise(resolve => releases.set(item.tabId, resolve)); return item; },
    commit: async item => { committed.push(item.tabId); },
  });
  await tick(); assert.deepEqual(started, [1, 2]);
  releases.get(2)(); await tick(); assert.deepEqual(committed, []); assert.deepEqual(started, [1, 2]);
  releases.get(1)(); await tick(); assert.deepEqual(committed, [1, 2]); assert.deepEqual(started, [1, 2, 3]);
  releases.get(3)(); await tick(); assert.deepEqual(committed, [1, 2, 3]); assert.deepEqual(started, [1, 2, 3, 4]);
  releases.get(4)(); await run; assert.deepEqual(committed, [1, 2, 3, 4]);
});

test('all script targets declare barriers while page targets retain tabRef resolution', () => {
  for (const name of ['run_script', 'run_skill_script']) {
    assert.equal(runtime.resolveDefinition(name).behavior.barrier, true);
    for (const target of [undefined, 'page', 'inner']) for (const mutatesPage of [false, true]) {
      const args = { target, mutatesPage, tabRef: 'a' };
      const policy = runtime.getBatchTabPolicy(name, args);
      assert.deepEqual(policy, target === 'inner' ? { kind: 'barrier' } : { kind: 'target', implicit: true, observation: false });
      assert.equal(runtime.getParallelReadTab(name, { ...args, tabId: 1 }), null);
    }
  }
});

test("custom timeout diagnostic declarations retain the runtime's abort signal and trace fields", async () => {
  let signal;
  await clearTraceLog();
  tools.defineTool({ name: "__custom_timeout", description: "Test", parameters: { type: "object", properties: {} }, timeout: 5,
    behavior: { timeoutTrace: "custom_action_trace" },
    execute: (_args, value) => { signal = value; return new Promise(() => {}); },
  });
  await assert.rejects(runtime.execute("__custom_timeout", {}, undefined, context), { code: "TOOL_TIMEOUT" });
  assert.equal(signal.aborted, true);
  assert.ok((await getTraceLog()).some(line => line.includes("custom_action_trace") && line.includes("phase=tool.timeout")
    && line.includes("session=session") && line.includes("run=run")));
});
