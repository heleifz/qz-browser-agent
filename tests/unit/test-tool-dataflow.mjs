import assert from 'node:assert/strict';
import test from 'node:test';
import { Agent } from '../../src/background/agent/agent.js';
import { createSessionTabs } from '../../src/background/session/tabs.js';
import { createTestAgentOptions } from '../support/agent-services.mjs';
globalThis.chrome = { runtime: { getURL: path => `chrome-extension://test/${path}` }, storage: { local: {
  async get() { return {}; }, async set() {}, async remove() {},
} } };
const { createToolRuntime, defineTool, getToolRuntimeDependencies } = await import('../../src/background/tools/runtime.js');
const call = (id, name, args) => ({ id, function: { name, arguments: JSON.stringify(args) } });
const open = key => call(`open-${key}`, '__flow_open', { tabAlias: key });
const read = key => call(`read-${key}`, '__flow_read', { tabRef: key });
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) { for (let i = 0; !predicate() && i < 300; i++) await tick(); assert.ok(predicate(), 'fixture reached expected state'); }
let fixture;
defineTool({ name: '__flow_open', description: 'Synthetic provisional creator', workingTab: 'created',
  behavior: { parallelOpen: true }, parameters: { type: 'object', properties: { tabAlias: { type: 'string' } } },
  async execute(args, signal, context) {
    const id = args.tabAlias.charCodeAt(0);
    const tab = { id, title: args.tabAlias, url: `https://example.test/${args.tabAlias}`, windowId: 7, body: args.tabAlias };
    fixture.tabs.set(id, tab);
    await context.prepareCreatedTab(tab);
    fixture.started.push(`open-${args.tabAlias}`);
    await fixture.wait(`open-${args.tabAlias}`, signal);
    if (fixture.fail === args.tabAlias) throw Object.assign(new Error('navigation failed'), { code: 'NAVIGATION_FAILED' });
    return { id };
  },
});
for (const action of [false, true]) defineTool({ name: action ? '__flow_action' : '__flow_read', description: 'Synthetic tab-local work', page: 'tab',
  behavior: action ? { parallelTab: true } : { parallelRead: true },
  parameters: { type: 'object', properties: { tabId: { type: 'number' } }, required: ['tabId'] },
  async execute(args, signal, context) {
    const tab = fixture.tabs.get(args.tabId), key = `${action ? 'action' : 'read'}-${tab.title}`;
    const permitted = await getToolRuntimeDependencies(context).sessions.resolveTargetTab({ sessionId: 'flow', runId: 'run', signal,
      tabId: tab.id, tabOnly: true });
    assert.equal(permitted.ok, true, 'unpublished tab is accessible only through the private permit');
    fixture.started.push(key);
    context.onToolUpdate?.({ type: 'tool_execution_update', toolCallId: context.toolCallId, phase: 'fixture' });
    await fixture.wait(key, signal);
    if (action) tab.body += '!';
    return { tabId: tab.id, text: tab.body };
  },
});
function setup({ serial = false, hold = [], fail, failCommit, stopAt, stopEffects = false } = {}) {
  const state = { sessionId: 'flow', ownedTabIds: [], workingTabId: null };
  const tabs = new Map(), events = [], writes = [], started = [], gates = new Map(), removed = [];
  const controller = new AbortController();
  let sessions;
  const tabsApi = {
    async get(id) { if (!tabs.has(id)) throw new Error('missing tab'); return { ...tabs.get(id) }; },
    async remove(id) { tabs.delete(id); removed.push(id); await sessions.handleTabRemoved(id); },
    async query() { return [...tabs.values()]; },
  };
  chrome.tabs = tabsApi;
  sessions = createSessionTabs({ supervisor: {
    getRuntime: id => id === 'flow' ? state : null, runtimeEntries: () => [['flow', state]], isRunCurrent: () => !controller.signal.aborted,
    setRuntime: (_id, next) => { Object.assign(state, next); return state; },
  }, tabsApi, storage: chrome.storage.local, ready: async () => {}, normalizeSessionId: String,
  setRuntime(_id, patch) { Object.assign(state, patch); writes.push({ owned: [...state.ownedTabIds], working: state.workingTabId }); return state; },
  persistRuntime: async () => {}, broadcast() {}, now: () => 'fixed', logger: { warn() {} },
  loadSecurityGuardrails: async () => ({}),
  });
  const runtime = createToolRuntime({ sessions: { ...sessions, isRunCurrent: () => !controller.signal.aborted,
    async commitCreatedTab(input) {
      const pendingTab = [...tabs.values()].find(tab => tab.title === failCommit);
      if (pendingTab && !state.ownedTabIds.includes(pendingTab.id) && state.ownedTabIds.length === 1)
        return { ok: false, code: 'SESSION_TAB_UNAVAILABLE' };
      return sessions.commitCreatedTab(input);
    },
  } });
  const agent = new Agent('flow', createTestAgentOptions({ tools: { ...runtime, maxInFlight: serial ? 1 : 10 } }));
  agent._currentRunId = 'run';
  const effects = [], apply = agent._applyToolResultEffects.bind(agent);
  agent._applyToolResultEffects = async (name, result, isError) => {
    effects.push({ name, result, isError, working: state.workingTabId, owned: [...state.ownedTabIds] });
    if (stopEffects && result.id === 97) controller.abort();
    return apply(name, result, isError);
  };
  agent._emit = event => { events.push(event); if (event.type === 'tool_execution_end' && event.toolCallId === stopAt) controller.abort(); };
  const f = fixture = { state, sessions, runtime, tabs, events, writes, started, gates, removed, controller, fail,
    async wait(key, signal) {
      if (!hold.includes(key)) return;
      await new Promise(resolve => { gates.set(key, resolve); signal.addEventListener('abort', resolve, { once: true }); });
      if (signal.aborted) throw Object.assign(new Error('stopped'), { code: 'OPERATION_ABORTED' });
    },
    run: inputs => agent._executeToolCalls(inputs, controller.signal),
    snapshot(messages) {
      return { state: structuredClone(state), owned: state.ownedTabIds, working: state.workingTabId, writes, effects,
        // Event timestamps and Chrome identities are fixed by this fixture; compare every observable payload.
        events, messages, live: [...tabs.keys()].sort() };
    },
  };
  return f;
}

test('read a and an unpublished read c execute before open b completes; all publication remains ordered', async () => {
  const f = setup({ hold: ['open-b'] });
  const input = [open('a'), open('b'), open('c'), read('a'), read('b'), read('c')];
  const run = f.run(input);
  await until(() => f.started.includes('read-c') && f.started.includes('read-a'));
  assert.equal(f.started.includes('read-b'), false);
  assert.deepEqual(f.state.ownedTabIds, [97]); assert.equal(f.state.workingTabId, 97);
  assert.deepEqual(f.events.filter(e => e.type === 'tool_execution_end').map(e => e.toolCallId), ['open-a']);
  assert.equal((await f.sessions.resolveTargetTab({ sessionId: 'flow', runId: 'run', tabId: 99, readOnly: true })).ok, false);
  assert.equal((await f.sessions.resolveTargetTab({ sessionId: 'other', runId: 'run', tabId: 99, readOnly: true })).ok, false);
  assert.equal((await f.sessions.resolveTargetTab({ sessionId: 'flow', runId: 'run', tabId: 99, createdTabReservation: {} })).ok, false);
  f.gates.get('open-b')(); const messages = await run;
  assert.deepEqual(f.state.ownedTabIds, [97, 98, 99]); assert.equal(f.state.workingTabId, 99);
  const parallel = f.snapshot(messages);
  const serial = setup({ serial: true });
  assert.deepEqual(parallel, serial.snapshot(await serial.run(input)));
});

for (const scenario of [{}, { fail: 'b' }, { failCommit: 'b' }]) test(`serial/parallel state, aliases, effects and messages agree: ${JSON.stringify(scenario)}`, async () => {
  const input = [open('a'), open('b'), open('c'), read('a'), read('b'), read('c'),
    call('action-a', '__flow_action', { tabRef: 'a' }), call('read-again', '__flow_read', { tabRef: 'a' })];
  const parallel = setup(scenario), first = parallel.snapshot(await parallel.run(input));
  const serial = setup({ ...scenario, serial: true }), second = serial.snapshot(await serial.run(input));
  assert.deepEqual(first, second);
  if (scenario.fail || scenario.failCommit) {
    assert.equal(first.events.find(e => e.type === 'tool_execution_end' && e.toolCallId === 'read-b').result.code, 'BATCH_TAB_DEPENDENCY_FAILED');
    assert.equal(first.live.includes(98), false, 'failed uncommitted creation is closed');
  }
});

test('same-tab action/read execution stays ordered while another tab advances', async () => {
  const f = setup({ hold: ['action-a'] });
  const run = f.run([open('a'), open('b'), call('action-a', '__flow_action', { tabRef: 'a' }), read('a'), read('b')]);
  await until(() => f.started.includes('read-b'));
  assert.equal(f.started.includes('read-a'), false);
  f.gates.get('action-a')(); await run;
  assert.ok(f.started.indexOf('read-a') > f.started.indexOf('action-a'));
  assert.equal(f.events.find(e => e.type === 'tool_execution_end' && e.toolCallId === 'read-a').result.text, 'a!');
});

test('stop closes all uncommitted creations and prevents later state/alias/effects publication', async () => {
  const f = setup({ hold: ['open-a'] });
  const run = f.run([open('a'), open('b'), open('c'), read('a'), read('b'), read('c')]);
  await until(() => f.started.includes('read-c'));
  f.controller.abort(); await run;
  assert.deepEqual(f.state.ownedTabIds, []); assert.equal(f.state.workingTabId, null);
  assert.deepEqual([...f.tabs.keys()], []); assert.deepEqual(f.writes, []);
  assert.ok(f.events.filter(e => e.type === 'tool_execution_end').every(e => e.result.code === 'OPERATION_ABORTED'));
});

test('serial and parallel stop at the same committed prefix retain identical state', async () => {
  const input = [open('a'), open('b'), open('c'), read('a'), read('b'), read('c')];
  const snapshots = [];
  for (const serial of [false, true]) {
    const f = setup({ serial, stopAt: 'open-a' });
    snapshots.push(f.snapshot(await f.run(input)));
  }
  assert.deepEqual(snapshots[0], snapshots[1]); assert.deepEqual(snapshots[0].owned, [97]);
});

test('stop during effects retains published ownership but publishes no late success or alias', async () => {
  const input = [open('a'), open('b'), read('a'), read('b')], snapshots = [];
  for (const serial of [false, true]) {
    const f = setup({ serial, stopEffects: true }); snapshots.push(f.snapshot(await f.run(input)));
  }
  assert.deepEqual(snapshots[0], snapshots[1]);
  assert.deepEqual(snapshots[0].owned, [97]); assert.deepEqual(snapshots[0].live, [97]);
  assert.ok(snapshots[0].events.filter(e => e.type === 'tool_execution_end').every(e => e.result.code === 'OPERATION_ABORTED'));
});

test('copied results and foreign runs cannot use or settle a private creation permit', async () => {
  const f = setup(), identity = { sessionId: 'flow', runId: 'run' };
  const result = await f.runtime.execute('__flow_open', { tabAlias: 'a' }, f.controller.signal,
    { ...identity, deferToolCommit: true, deferCreatedTabSelection: true });
  const copy = structuredClone(result);
  await f.runtime.commitToolResult(copy, f.controller.signal, identity);
  await f.runtime.discardToolResult(result, { ...identity, runId: 'obsolete' });
  assert.deepEqual(f.state.ownedTabIds, []); assert.equal(f.tabs.size, 1);
  await assert.rejects(f.runtime.execute('__flow_read', { tabId: 97 }, f.controller.signal,
    { ...identity, createdTabResult: copy, deferToolCommit: true }), { code: 'SESSION_TAB_UNAVAILABLE' });
  await f.runtime.commitToolResult(result, f.controller.signal, identity);
  await f.runtime.discardToolResult(result, identity);
  assert.deepEqual(f.state.ownedTabIds, [97]); assert.equal(f.tabs.size, 1);
});

test('a stop during commit lookup revokes publication and closes the uncommitted tab', async () => {
  const f = setup(), identity = { sessionId: 'flow', runId: 'run' };
  const result = await f.runtime.execute('__flow_open', { tabAlias: 'a' }, f.controller.signal,
    { ...identity, deferToolCommit: true, deferCreatedTabSelection: true });
  const get = chrome.tabs.get;
  let release, lookups = 0;
  chrome.tabs.get = async id => { if (++lookups === 2) await new Promise(resolve => { release = resolve; }); return get(id); };
  const commit = f.runtime.commitToolResult(result, f.controller.signal, identity);
  await until(() => release); f.controller.abort(); release();
  await assert.rejects(commit, { code: 'OPERATION_ABORTED' });
  assert.deepEqual(f.state.ownedTabIds, []); assert.equal(f.tabs.size, 0); assert.deepEqual(f.writes, []);
});

test('cleanup retries transient tab removal without publishing ownership', async () => {
  const f = setup(), identity = { sessionId: 'flow', runId: 'run' };
  const result = await f.runtime.execute('__flow_open', { tabAlias: 'a' }, f.controller.signal,
    { ...identity, deferToolCommit: true, deferCreatedTabSelection: true });
  const remove = chrome.tabs.remove; let attempts = 0;
  chrome.tabs.remove = async id => { if (++attempts === 1) throw new Error('transient remove failure'); return remove(id); };
  await f.runtime.discardToolResult(result, identity);
  assert.equal(attempts, 2); assert.equal(f.tabs.size, 0); assert.deepEqual(f.writes, []);
});

test('read-only context collection does not overwrite committed working-tab state', async () => {
  const f = setup(); await f.run([open('a')]);
  const before = structuredClone(f.state), writes = f.writes.length;
  f.tabs.get(97).title = 'New title';
  assert.equal((await f.sessions.getWorkingTabContext('flow', { readOnly: true })).title, 'New title');
  assert.deepEqual(f.state, before); assert.equal(f.writes.length, writes);
});

test('duplicate aliases have identical errors in serial/parallel execution and create no tabs', async () => {
  const input = [open('a'), { ...open('a'), id: 'duplicate' }, read('a')];
  const p = setup(), first = p.snapshot(await p.run(input));
  const s = setup({ serial: true }); assert.deepEqual(first, s.snapshot(await s.run(input)));
  assert.deepEqual(first.owned, []); assert.deepEqual(first.live, []);
});
