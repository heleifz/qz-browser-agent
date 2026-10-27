import assert from 'node:assert/strict';
import test from 'node:test';
import { Agent } from '../../src/background/agent/agent.js';
import { createTestAgentOptions } from '../support/agent-services.mjs';
globalThis.chrome = {};
const { getParallelReadTab, getBatchTabPolicy, createToolRuntime } = await import('../../src/background/tools/runtime.js');
const call = (id, name, args) => ({ id, function: { name, arguments: JSON.stringify(args) } });
const open = (id, tabAlias) => call(id, 'open_tab', { url: `https://${id}.test/`, ...(tabAlias == null ? {} : { tabAlias }) });
const read = (id, tabRef, extra = {}) => call(id, 'read_article', { limit: 3000, ...(tabRef == null ? {} : { tabRef }), ...extra });
function fixture(execute = null) {
  const calls = [], events = [];
  let nextTab = 100;
  const agent = new Agent('batch', createTestAgentOptions({ tools: {
    getIdentity: () => ({}), getSchemas: () => [], getParallelReadTab, getBatchTabPolicy,
    async execute(name, args, signal, context) {
      calls.push({ name, args, signal, context });
      if (execute) return execute(name, args, signal, context);
      return name === 'open_tab' ? { id: ++nextTab } : { tabId: args.tabId, text: `page ${args.tabId}` };
    },
  } }));
  agent._emit = event => events.push(event);
  return { agent, calls, events, run: (items, signal = new AbortController().signal) => agent._executeToolCalls(items, signal),
    ends: () => events.filter(event => event.type === 'tool_execution_end') };
}

test('direct runtime calls reject unresolved references and publish paired schema documentation', async () => {
  const runtime = createToolRuntime();
  await assert.rejects(runtime.execute('read_article', { tabRef: 'a', limit: 3000 }), { code: 'BATCH_TAB_REFERENCE_ERROR' });
  for (const language of ['en', 'zh-CN']) {
    const schemas = runtime.getSchemas({ language });
    const open = schemas.find(schema => schema.function.name === 'open_tab').function;
    const read = schemas.find(schema => schema.function.name === 'read_article').function;
    assert.equal(open.parameters.properties.tabAlias.type, 'string');
    assert.equal(read.parameters.properties.tabRef.type, 'string');
    assert.match(open.description, /tabAlias/); assert.match(open.description, /tabRef/);
    assert.match(read.parameters.properties.tabRef.description, /tool_calls/);
    const close = schemas.find(schema => schema.function.name === 'close_tab').function;
    assert.equal(close.parameters.required.includes('tabId'), false, 'the model can choose tabRef for a required target');
    assert.equal(runtime.resolveDefinition('close_tab').parameters.required.includes('tabId'), true, 'runtime still requires a resolved numeric target');
  }
  assert.equal(getBatchTabPolicy('plugin_open', { tabAlias: 'a' }), null);
});

test('new-tab observations preload their producers and retain original ledger order', async () => {
  const f = fixture();
  const input = [read('ra', 'a'), open('oa', 'a'), read('rb', 'b'), open('ob', 'b')];
  const messages = await f.run(input);
  assert.deepEqual(f.calls.map(c => c.context.toolCallId), ['oa', 'ob', 'ra', 'rb']);
  assert.deepEqual(f.calls.slice(2).map(c => c.args.tabId), [101, 102]);
  assert.ok(f.calls.slice(2).every(c => c.context.preserveWorkingTab && !('tabRef' in c.args)));
  assert.deepEqual(f.ends().map(e => e.toolCallId), ['ra', 'oa', 'rb', 'ob']);
  assert.deepEqual(messages.map(m => m.tool_call_id), ['ra', 'oa', 'rb', 'ob']);
  assert.deepEqual(f.events.filter(e => e.type === 'tool_execution_start' && e.toolName === 'read_article').map(e => e.args.tabId), [101, 102]);
});

test('multiple new pages require an explicit target instead of silently using the last working tab', async () => {
  const f = fixture();
  await f.run([open('oa'), open('ob'), read('ra'), read('rb')]);
  assert.deepEqual(f.calls.map(c => c.name), ['open_tab', 'open_tab']);
  assert.ok(f.ends().slice(2).every(e => e.isError && e.result.code === 'BATCH_TAB_REFERENCE_ERROR' && e.result.details.reason === 'ambiguous_target'));
});

for (const [name, input, reason] of [
  ['duplicate aliases', [open('oa', 'same'), open('ob', 'same'), read('r', 'same')], 'duplicate_alias'],
  ['unknown reference', [read('r', 'missing')], 'unknown_reference'],
  ['conflicting tabId', [open('o', 'a'), read('r', 'a', { tabId: 99 })], 'invalid_reference'],
  ['conflicting UID', [open('o', 'a'), read('r', 'a', { selector: 'uid:t99.abcdef.1' })], 'invalid_reference'],
  ['invalid alias', [open('o', 'has spaces')], 'invalid_alias'],
  ['untrusted creator', [call('o', 'plugin_open', { tabAlias: 'a' })], 'invalid_alias'],
]) test(`${name} becomes a per-call error`, async () => {
  const f = fixture(); await f.run(input);
  assert.equal(f.ends().at(-1).isError, true);
  assert.equal(f.ends().at(-1).result.details.reason, reason);
  assert.equal(f.calls.filter(c => c.name === 'read_article').length, 0);
});

for (const outcome of ['failed', 'incomplete', 'effects']) test(`a ${outcome} producer skips its dependent while independent pages proceed`, async () => {
  const f = fixture(async (name, args) => {
    if (name !== 'open_tab') return { tabId: args.tabId };
    if (args.tabAlias === 'good') return { id: 2 };
    if (outcome === 'failed') throw Object.assign(new Error('Navigation failed'), { code: 'NAVIGATION_FAILED' });
    return { id: 1, ...(outcome === 'incomplete' ? { incomplete: { reason: 'timeout' } } : {}) };
  });
  if (outcome === 'effects') f.agent._applyToolResultEffects = async (_name, result) => { if (result.id === 1) throw new Error('effects failed'); return []; };
  await f.run([open('bad', 'bad'), open('good', 'good'), read('rb', 'bad'), read('rg', 'good')]);
  assert.deepEqual(f.calls.filter(c => c.name === 'read_article').map(c => c.args.tabId), [2]);
  assert.equal(f.ends().find(e => e.toolCallId === 'rb').result.code, 'BATCH_TAB_DEPENDENCY_FAILED');
  assert.equal(f.ends().find(e => e.toolCallId === 'rg').isError, false);
});

test('bindings expire at the response boundary', async () => {
  const f = fixture(); await f.run([open('o', 'a')]); await f.run([read('r', 'a')]);
  assert.equal(f.ends().at(-1).result.details.reason, 'unknown_reference');
  assert.equal(f.calls.length, 1);
});

test('forward references do not move creation across a mutation barrier', async () => {
  const f = fixture();
  await f.run([read('r', 'a'), call('n', 'navigate', { tabId: 99, url: 'https://next.test/' }), open('o', 'a')]);
  assert.deepEqual(f.calls.map(c => c.context.toolCallId), ['n', 'o']);
  assert.equal(f.ends()[0].result.details.reason, 'forward_reference_across_barrier');
});

test('a known dependency can target a later ordered page action', async () => {
  const f = fixture(); await f.run([open('o', 'a'), call('n', 'navigate', { tabRef: 'a', url: 'https://next.test/' }), read('r', 'a')]);
  assert.deepEqual(f.calls.map(c => c.context.toolCallId), ['o', 'n', 'r']);
  assert.deepEqual(f.calls.slice(1).map(c => c.args.tabId), [101, 101]);
});

test('a required numeric target is supplied before invoking a page action', async () => {
  const f = fixture(); await f.run([open('o', 'a'), call('c', 'close_tab', { tabRef: 'a' })]);
  assert.deepEqual(f.calls.map(c => c.context.toolCallId), ['o', 'c']);
  assert.equal(f.calls[1].args.tabId, 101);
});

test('same-tab dependent reads remain serial', async () => {
  const f = fixture(); await f.run([open('o', 'a'), read('r1', 'a'), read('r2', 'a')]);
  assert.ok(f.calls.every(c => c.context.preserveWorkingTab === false));
});

test('stop during a reordered producer retains its cancelled result without starting a reader', async () => {
  const controller = new AbortController();
  let started;
  const entering = new Promise(resolve => { started = resolve; });
  const f = fixture(async (_name, _args, signal) => {
    started(); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    throw Object.assign(new Error('stopped'), { code: 'OPERATION_ABORTED' });
  });
  const run = f.run([read('r', 'a'), open('o', 'a'), open('next', 'b')], controller.signal);
  await entering; controller.abort();
  const messages = await run;
  assert.deepEqual(f.calls.map(c => c.context.toolCallId), ['o']);
  assert.deepEqual(messages.map(m => m.tool_call_id), ['o']);
  assert.equal(f.ends()[0].result.code, 'OPERATION_ABORTED');
});
