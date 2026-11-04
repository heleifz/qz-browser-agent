import assert from "node:assert/strict";
import test from "node:test";
import { createRunScriptBridge } from "../../src/background/tools/run-script-bridge.js";
import { markToolValue, isToolValue } from "../../src/shared/contracts/tool-error.js";
import { bindCreatedTabResult } from "../../src/shared/contracts/page-observation.js";
import { runDriveCalls } from "../../src/background/mcp/external-drive.js";

for (const stage of ["context", "execute", "apply"]) {
  for (const stop of ["revoke", "abort"]) {
    test(`nested script ${stop} during ${stage} rejects late artifacts and observations; the next run recovers`, async () => {
      let reachBoundary, releaseBoundary;
      const reached = new Promise(resolve => { reachBoundary = resolve; });
      const blocked = new Promise(resolve => { releaseBoundary = resolve; });
      const runId = "current";
      let activeRun = runId;
      let controller = new AbortController();
      let shouldPause = true;
      const pause = async boundary => {
        if (boundary !== stage || !shouldPause) return;
        reachBoundary();
        await blocked;
      };
      let executions = 0, applies = 0, appends = 0, refreshes = 0;
      const bridge = createRunScriptBridge({
        supervisor: { isRunCurrent: (_id, run) => activeRun === run, hasAgent: () => true, getAbortSignal: () => controller.signal },
        getRuntime: () => ({ status: "running" }),
        canManageSessions: async () => true,
        buildRunProfile: async () => ({}),
        getRunToolContext: async () => { await pause("context"); return {}; },
        applyNestedToolResult: async () => { applies++; await pause("apply"); },
        toolRuntime: {
          getSchemas: () => [],
          resolveDefinition: () => ({ behavior: { nestedObservation: true } }),
          async execute() { executions++; await pause("execute"); return { _image: "data:image/png;base64,aW1hZ2U=" }; },
        },
        collectArtifacts: () => [{ type: "file", filename: "output.txt" }],
        appendArtifacts: async () => { appends++; },
        scheduleArtifactRefresh: () => { refreshes++; },
      });
      const pending = bridge.handleToolCall({ sessionId: "s1", runId, toolName: "custom_observation" });
      await reached;
      if (stop === "abort") controller.abort();
      else activeRun = "next";
      releaseBoundary();
      const stopped = await pending;
      assert.equal(stopped.code, "RUN_STOPPED");
      assert.equal(stopped.observation, undefined);
      assert.equal(appends, 0);
      assert.equal(refreshes, 0);
      assert.equal(executions, stage === "context" ? 0 : 1);
      assert.equal(applies, stage === "apply" ? 1 : 0, "revoked tool results must not reach the Agent");

      shouldPause = false;
      activeRun = "next";
      controller = new AbortController();
      const recovered = await bridge.handleToolCall({ sessionId: "s1", runId: "next", toolName: "custom_observation" });
      assert.equal(recovered.ok, true);
      assert.ok(recovered.observation?._image);
      assert.equal(appends, 1);
      assert.equal(refreshes, 1);
    });
  }
}

const tick = () => new Promise(resolve => setImmediate(resolve));
globalThis.chrome = {
  runtime: { getURL: path => path },
  storage: { local: { async get() { return {}; } } },
  tabs: { async get(id) { return { id, status: 'complete', url: `https://example.test/${id}`, title: `Page ${id}` }; } },
};
const tools = await import('../../src/background/tools/runtime.js');
const probes = new Map();
let nextFixture = 0;
tools.defineTool({ name: '__nested_lane_probe', description: 'Controlled page operation.',
  page: 'owned', behavior: { parallelTab: true },
  parameters: { type: 'object', properties: { tabRef: { type: ['integer', 'string'] }, fixture: { type: 'string' }, label: { type: 'string' } }, required: ['tabRef', 'fixture', 'label'] },
  execute: async ({ tabId, fixture, label }, signal) => {
    const state = probes.get(fixture);
    state.started.push(label);
    state.peak = Math.max(state.peak, ++state.active);
    try {
      if (state.hold) await new Promise(resolve => {
        state.release.set(label, resolve);
        signal.addEventListener('abort', resolve, { once: true });
      });
      return { label, page: tabId };
    } finally { state.active--; }
  },
});
tools.defineTool({ name: '__nested_container', description: 'Await a descendant on the same page.',
  page: 'owned', behavior: { parallelTab: true },
  parameters: { type: 'object', properties: { tabRef: { type: ['integer', 'string'] }, fixture: { type: 'string' } }, required: ['tabRef', 'fixture'] },
  execute: async ({ fixture }, _signal, context) => context.invokeTool('__nested_lane_probe', { tabRef: 'page', fixture, label: 'child' }),
});
tools.defineTool({ name: '__nested_barrier', description: 'Outer orchestration can await page work.',
  behavior: { barrier: true },
  parameters: { type: 'object', properties: { fixture: { type: 'string' } }, required: ['fixture'] },
  execute: async ({ fixture }, _signal, context) => context.invokeTool('__nested_lane_probe', { tabRef: 'page', fixture, label: 'barrier-child' }),
});
tools.defineTool({ name: '__nested_fanout', description: 'Await parallel descendants on explicit pages.',
  page: 'owned', behavior: { parallelTab: true },
  parameters: { type: 'object', properties: { tabRef: { type: ['integer', 'string'] }, fixture: { type: 'string' } }, required: ['tabRef', 'fixture'] },
  execute: ({ fixture }, _signal, context) => Promise.all(Array.from({ length: 12 }, (_, index) =>
    context.invokeTool('__nested_lane_probe', { tabRef: index + 20, fixture, label: `child-${index}` }))),
});
tools.defineTool({ name: '__nested_business_value', description: 'Return caller-authored data.',
  model: { preserveResult: true }, parameters: { type: 'object', properties: {} },
  execute: () => markToolValue({ code: 'BUSINESS_CODE', message: 'Business text', ok: false, error: 'A data field',
    _plugin: { tabId: 'business' }, result: '{"type":"string"}' }),
});
tools.defineTool({ name: '__nested_popup_creator', description: 'A page action produces another tab.',
  page: 'owned', tabLifecycle: 'created', behavior: { parallelTab: true },
  parameters: { type: 'object', properties: { tabRef: { type: ['integer', 'string'] }, tabAlias: { type: 'string' }, fixture: { type: 'string' } }, required: ['tabRef', 'fixture'] },
  execute: async ({ fixture, tabAlias }, _signal, context) => {
    await context.invokeTool('__nested_lane_probe', { tabRef: 'page', fixture, label: 'opener-action' });
    return bindCreatedTabResult({ tabRef: tabAlias || 12, url: 'https://example.test/12', title: 'Popup', active: false }, 12);
  },
});
tools.defineTool({ name: '__nested_observer', description: 'Passive event observation.',
  page: 'owned', behavior: { passiveWait: true, parallelTab: true },
  parameters: { type: 'object', properties: { tabRef: { type: ['integer', 'string'] }, fixture: { type: 'string' } }, required: ['tabRef', 'fixture'] },
  execute: async ({ fixture }) => {
    const state = probes.get(fixture);
    state.started.push('observer');
    await new Promise(resolve => { state.event = resolve; });
    return { observed: true };
  },
});
tools.defineTool({ name: '__nested_signal_event', description: 'Trigger the controlled event.',
  page: 'owned', behavior: { parallelTab: true },
  parameters: { type: 'object', properties: { tabRef: { type: ['integer', 'string'] }, fixture: { type: 'string' } }, required: ['tabRef', 'fixture'] },
  execute: ({ fixture }) => { const state = probes.get(fixture); state.ready = true; state.event?.(); return { signalled: true }; },
});

function fixture(hold = true, budget = 10, externalDrive = true) {
  const id = String(++nextFixture), controller = new AbortController();
  const state = { hold, started: [], release: new Map(), cards: [], events: [], applied: [], active: 0, peak: 0 };
  probes.set(id, state);
  const aliases = { page: 7 };
  let bridge;
  const runtime = tools.createToolRuntime({
    invokeNestedTool: (parent, name, args, signal) => bridge.invokeTool(parent, name, args, signal),
    sessions: {
      getTabAliases: () => aliases, isRunCurrent: () => !controller.signal.aborted,
      reserveTabAlias: async ({ alias }) => ({ alias }),
      commitTabAlias: ({ reservation, tabId }) => { aliases[reservation.alias] = tabId; },
      discardTabAlias: () => undefined,
      resolveTargetTab: async ({ tabId }) => ({ ok: true, tabId, ownedByCurrentTask: true }),
      updateWorkingTab: async () => undefined,
    },
  });
  bridge = createRunScriptBridge({
    supervisor: { isRunCurrent: () => !controller.signal.aborted, hasAgent: () => false, getAbortSignal: () => controller.signal },
    getRuntime: () => ({ status: controller.signal.aborted ? 'aborted' : 'running' }),
    getRunToolContext: async () => ({ externalDrive }),
    canManageSessions: async () => false, buildRunProfile: async () => ({}),
    toolRuntime: { ...runtime, maxInFlight: budget,
      execute: (name, args, signal, context) => name === 'evaluate' && state.evaluate
        ? state.evaluate(args, signal, context) : runtime.execute(name, args, signal, context),
    },
    recordNestedTool: async event => { state.events.push(event); if (event.phase === 'end') state.cards.push(event); },
    applyNestedToolResult: async event => { state.applied.push(event); },
    collectArtifacts: () => [],
  });
  return { id, state, controller, runtime, bridge,
    call: (name, args) => bridge.handleToolCall({ sessionId: id, runId: `run-${id}`, toolName: name, args: { fixture: id, ...args } }),
  };
}

test('actual nested runtime overlaps page lanes, serializes conflicts and commits cards in sibling order', async () => {
  const f = fixture();
  const a = f.call('__nested_lane_probe', { tabRef: 1, label: 'a' });
  const b = f.call('__nested_lane_probe', { tabRef: 2, label: 'b' });
  const c = f.call('__nested_lane_probe', { tabRef: 1, label: 'c' });
  await tick();
  assert.deepEqual(f.state.started, ['a', 'b']);
  f.state.release.get('b')(); await tick();
  assert.deepEqual(f.state.cards, [], 'completion cannot publish ahead of an earlier sibling');
  f.state.release.get('a')(); await tick();
  assert.deepEqual(f.state.started, ['a', 'b', 'c']);
  f.state.release.get('c')();
  assert.ok((await Promise.all([a, b, c])).every(result => result.ok));
  assert.deepEqual(f.state.cards.map(card => card.result.label), ['a', 'b', 'c']);
  assert.deepEqual(f.state.applied.map(event => event.result.label), ['a', 'b', 'c']);
});

test('nested runtime keeps the shared ten-leaf budget and refills before ordered commit', async () => {
  const f = fixture();
  const calls = Array.from({ length: 12 }, (_, index) => f.call('__nested_lane_probe', { tabRef: index + 1, label: String(index) }));
  await tick(); assert.equal(f.state.started.length, 10);
  f.state.release.get('9')(); await tick();
  assert.equal(f.state.started.length, 11);
  assert.equal(f.state.cards.length, 0);
  for (let index = 0; index < 11; index++) f.state.release.get(String(index))();
  await tick(); f.state.release.get('11')();
  assert.ok((await Promise.all(calls)).every(result => result.ok));
  assert.equal(f.state.cards.length, 12);
});

test('a live parent reenters its page lane while later conflicting siblings stay queued', async () => {
  const f = fixture(false, 1);
  const parent = f.call('__nested_container', { tabRef: 'page' });
  const later = f.call('__nested_lane_probe', { tabRef: 'page', label: 'later' });
  const result = await parent;
  assert.equal(result.ok, true);
  assert.deepEqual(result.result, { label: 'child', page: 7 });
  assert.equal((await later).ok, true);
  assert.deepEqual(f.state.started, ['child', 'later']);
  assert.deepEqual(f.state.cards.map(card => card.name), ['__nested_lane_probe', '__nested_container', '__nested_lane_probe']);
  assert.equal(f.state.cards.length, 3, 'each actual child or parent invocation has exactly one card');
});

test('a nested orchestration barrier can await its own child at budget one', async () => {
  const f = fixture(false, 1);
  const parent = f.call('__nested_barrier', {});
  const later = f.call('__nested_lane_probe', { tabRef: 9, label: 'after-barrier' });
  assert.equal((await parent).ok, true);
  assert.equal((await later).ok, true);
  assert.deepEqual(f.state.started, ['barrier-child', 'after-barrier']);
});

test('a popup creator retains the opener lane and publishes its new alias before a concurrent reader', async () => {
  const f = fixture(false, 1);
  assert.deepEqual(f.runtime.getBatchTabPolicy('wait_for_popup', { tabRef: 'page' }),
    { kind: 'create', parallel: true, targeted: true, passive: true });
  assert.deepEqual(f.runtime.getBatchTabPolicy('wait_for_popup', { tabRef: 'page', trigger: { name: '__nested_lane_probe', args: {} } }),
    { kind: 'create', parallel: true, targeted: true });
  const created = f.call('__nested_popup_creator', { tabRef: 'page', tabAlias: 'popup' });
  const reader = f.call('__nested_lane_probe', { tabRef: 'popup', label: 'popup-reader' });
  assert.equal((await created).result.tabRef, 'popup');
  assert.deepEqual((await reader).result, { label: 'popup-reader', page: 12 });
  assert.deepEqual(f.state.started, ['opener-action', 'popup-reader']);
});

test('the registered catalog shares policy and preserves raw successful business values through the bridge', async () => {
  const f = fixture(false);
  const listed = await f.call('list_tools', {});
  assert.equal(listed.ok, true);
  assert.ok(listed.result.tools.some(tool => tool.name === 'evaluate' && typeof tool.signature === 'string'));
  assert.ok(!listed.result.tools.some(tool => tool.name === 'ask_llm'));
  const full = await f.call('list_tools', { names: ['evaluate', 'read_dom'] });
  assert.equal(full.ok, true);
  assert.deepEqual(full.result.tools.map(tool => tool.name), ['evaluate', 'read_dom']);
  assert.deepEqual(full.result.tools[0].parameters.required, ['tabRef', 'code']);
  assert.ok(full.result.tools[1].parameters.properties.tabRef);
  assert.equal((await f.call('list_tools', { names: ['ask_llm'] })).code, 'UNKNOWN_TOOL');
  const native = await f.runtime.execute('list_tools', { names: ['evaluate', 'read_dom'] }, undefined,
    { sessionId: f.id, runId: `run-${f.id}`, externalDrive: false });
  assert.deepEqual(native.tools, full.result.tools, 'native and drive use the same tool declarations');
  const result = await f.call('__nested_business_value', {});
  assert.equal(result.ok, true);
  assert.equal(result.isError, false);
  assert.equal(isToolValue(result.result), true);
  assert.deepEqual(result.result, { code: 'BUSINESS_CODE', message: 'Business text', ok: false, error: 'A data field',
    _plugin: { tabId: 'business' }, result: '{"type":"string"}' });
  assert.equal(f.state.cards.at(-1).isError, false);
  assert.equal(f.state.cards.length, 4, 'catalog successes, a catalog failure and business return each record once');
});

test('drive discovery omits local storage tools from default and named queries while native discovery retains them', async () => {
  const f = fixture(false);
  const names = ['collect_images', 'read_image_asset', 'data_store'];
  const listed = await f.call('list_tools', {});
  assert.equal(listed.ok, true);
  for (const name of names) {
    assert.ok(!listed.result.tools.some(tool => tool.name === name));
    assert.equal((await f.call('list_tools', { names: [name] })).code, 'UNKNOWN_TOOL');
  }
  const native = await f.runtime.execute('list_tools', { names }, undefined,
    { sessionId: f.id, runId: `run-${f.id}`, externalDrive: false });
  assert.deepEqual(native.tools.map(tool => tool.name), names);
  assert.ok(native.tools.every(tool => tool.parameters.type === 'object'));
});

test('passive event observations permit a same-page action and cancellation never starts queued work', async () => {
  const f = fixture(false);
  const observer = f.call('__nested_observer', { tabRef: 'page' });
  await tick();
  const action = f.call('__nested_signal_event', { tabRef: 'page' });
  assert.ok((await Promise.all([observer, action])).every(result => result.ok));
  const stopped = fixture();
  const a = stopped.call('__nested_lane_probe', { tabRef: 'page', label: 'a' });
  const b = stopped.call('__nested_lane_probe', { tabRef: 'page', label: 'b' });
  await tick(); stopped.controller.abort();
  assert.ok((await Promise.all([a, b])).every(result => result.code === 'RUN_STOPPED'));
  assert.deepEqual(stopped.state.started, ['a']);
  assert.deepEqual(stopped.state.applied, []);
  assert.deepEqual(stopped.state.cards, []);
});

test('native batches and nested wait predicates share page conflict lanes', async () => {
  for (const actionTab of [7, 9]) {
    const f = fixture();
    f.state.evaluate = async () => {
      f.state.started.push('predicate');
      await new Promise(resolve => { f.state.release.set('predicate', resolve); });
      return true;
    };
    const pending = runDriveCalls([
      { id: 'wait', name: 'wait_for_function', args: { tabRef: 'page', code: '() => true', timeout: 5 } },
      { id: 'action', name: '__nested_lane_probe', args: { tabRef: actionTab, fixture: f.id, label: 'action' } },
    ], { signal: f.controller.signal, aliases: { page: 7 },
      context: { sessionId: f.id, runId: `run-${f.id}`, externalDrive: true },
      getBatchTabPolicy: f.runtime.getBatchTabPolicy,
      execute: f.runtime.execute, commitToolResult: f.runtime.commitToolResult, discardToolResult: f.runtime.discardToolResult,
    });
    await tick();
    if (actionTab === 7) {
      assert.deepEqual(f.state.started, ['action'], 'a nested predicate cannot overlap a top-level action on its page');
      f.state.release.get('action')(); await tick();
      assert.deepEqual(f.state.started, ['action', 'predicate']);
    } else {
      assert.deepEqual(new Set(f.state.started), new Set(['action', 'predicate']), 'different explicit pages retain concurrency');
      f.state.release.get('action')();
    }
    f.state.release.get('predicate')();
    assert.ok((await pending).results.every(result => !result.isError));
  }
});

test('one physical budget covers top-level actions and a concurrent descendant fanout', async () => {
  const f = fixture();
  const pending = runDriveCalls([
    { id: 'parent', name: '__nested_fanout', args: { tabRef: 'page', fixture: f.id } },
    ...Array.from({ length: 9 }, (_, index) => ({ id: `action-${index}`, name: '__nested_lane_probe',
      args: { tabRef: index + 40, fixture: f.id, label: `action-${index}` } })),
  ], { signal: f.controller.signal, aliases: { page: 7 },
    context: { sessionId: f.id, runId: `run-${f.id}`, externalDrive: true },
    getBatchTabPolicy: f.runtime.getBatchTabPolicy,
    execute: f.runtime.execute, commitToolResult: f.runtime.commitToolResult, discardToolResult: f.runtime.discardToolResult,
  });
  await tick();
  assert.equal(f.state.active, 10);
  assert.equal(f.state.started.length, 10);
  for (let round = 0; round < 3; round++) {
    for (const release of f.state.release.values()) release();
    await tick();
  }
  const result = await pending;
  assert.ok(result.results.every(result => !result.isError));
  assert.equal(f.state.started.length, 21);
  assert.equal(f.state.peak, 10);
});

test('an armed state wait permits an awaited read before the action that satisfies it', async () => {
  const f = fixture(false);
  f.state.evaluate = async () => Boolean(f.state.ready);
  const waiting = f.call('wait_for_function', { tabRef: 'page', code: '() => true', timeout: 2 });
  await tick();
  const read = await f.call('__nested_lane_probe', { tabRef: 'page', label: 'intermediate-read' });
  assert.equal(read.ok, true);
  const action = await f.call('__nested_signal_event', { tabRef: 'page' });
  assert.equal(action.ok, true);
  assert.equal((await waiting).ok, true);
  assert.ok(f.state.cards.every(card => !card.isError));
  assert.equal(f.state.cards.filter(card => card.name === 'wait_for_function').length, 1);
});

test('native and direct descendants record one paired call identity and their trusted parent', async () => {
  for (const mode of [false, true]) {
    const f = fixture(false, 10, mode);
    const result = await f.call('__nested_container', { tabRef: 'page' });
    assert.equal(result.ok, true);
    assert.deepEqual(result.result, { label: 'child', page: 7 });
    assert.deepEqual(f.state.events.map(event => [event.name, event.phase]), [
      ['__nested_container', 'start'], ['__nested_lane_probe', 'start'],
      ['__nested_lane_probe', 'end'], ['__nested_container', 'end'],
    ]);
    const [parent, child, childEnd, parentEnd] = f.state.events;
    assert.notEqual(parent.toolCallId, child.toolCallId);
    assert.equal(parentEnd.toolCallId, parent.toolCallId);
    assert.equal(childEnd.toolCallId, child.toolCallId);
    assert.equal(child.parentCallId, parent.toolCallId);
    assert.equal(child.parentSpanId, `tool:${parent.toolCallId}`);
    assert.equal(childEnd.parentCallId, parent.toolCallId);
    assert.ok(f.state.events.every(event => event.externalDrive === mode));
    assert.equal(f.state.applied.length, 2, 'recording never applies effects a second time');
  }
});
