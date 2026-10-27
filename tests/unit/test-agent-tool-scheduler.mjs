import assert from 'node:assert/strict';
import test from 'node:test';
import { Agent } from '../../src/background/agent/agent.js';
globalThis.chrome = {};
const { getParallelReadTab } = await import('../../src/background/tools/runtime.js');
import { createTestAgentOptions } from '../support/agent-services.mjs';

const call = (id, name, tabId) => ({ id, function: { name, arguments: JSON.stringify({ tabId, limit: 10 }) } });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('trusted registrations select only explicit cross-tab observations', () => {
  for (const name of ['read_article', 'find_elements', 'get_ax_tree', 'screenshot']) {
    assert.equal(getParallelReadTab(name, { tabId: 12 }), 12);
    assert.equal(getParallelReadTab(name, {}), null);
    assert.equal(getParallelReadTab(name, { tabId: 12, selector: 'uid:t12.abcdef.1' }), null);
  }
  assert.equal(getParallelReadTab('screenshot', { tabId: 12, actionable: true }), null);
  assert.equal(getParallelReadTab('screenshot', { tabId: 12, destination: 'saved-images' }), null);
  assert.equal(getParallelReadTab('spoofed', { tabId: 12 }, { toolRegistrySnapshot: {
    get: () => ({ source: 'core', behavior: { parallelRead: true } }),
  } }), null, 'a runtime object cannot impersonate a trusted build-time snapshot');
  assert.equal(getParallelReadTab('run_script', { tabId: 12, parallelRead: true }), null);
  assert.equal(getParallelReadTab('unknown', { tabId: 12, parallelRead: true }), null);
});

test('Agent batches three reads, commits in call order, and treats same-tab and mutations as barriers', async () => {
  const started = [], finished = [], committed = [], signals = [], releases = new Map();
  const agent = new Agent('scheduler', createTestAgentOptions({ tools: {
    getIdentity: () => ({}), getSchemas: () => [], getParallelReadTab,
    async execute(name, args, signal, context) {
      started.push(context.toolCallId); signals.push(signal);
      assert.equal(context.preserveWorkingTab, ['1', '2', '3', '7', '8'].includes(context.toolCallId));
      await new Promise(resolve => releases.set(context.toolCallId, resolve));
      finished.push(context.toolCallId);
      if (context.toolCallId === '2') throw new Error('one failed read');
      return { value: context.toolCallId };
    },
  } }));
  agent._applyToolResultEffects = async (_name, result) => { committed.push(result.value || 'error'); return []; };
  const run = agent._executeToolCalls([
    call('1', 'read_article', 1), call('2', 'read_article', 2), call('3', 'read_article', 3),
    call('4', 'read_article', 4), call('5', 'read_article', 4), call('6', 'navigate', 5),
    call('7', 'read_article', 6), call('8', 'read_article', 7),
  ], new AbortController().signal);
  await tick(); assert.deepEqual(started, ['1', '2', '3']);
  releases.get('3')(); releases.get('2')(); await tick(); assert.deepEqual(committed, []);
  releases.get('1')(); await tick(); assert.deepEqual(committed, ['1', 'error', '3']);
  for (const id of ['4', '5', '6']) {
    assert.equal(started.at(-1), id); releases.get(id)(); await tick();
  }
  assert.deepEqual(started.slice(-2), ['7', '8']);
  releases.get('8')(); releases.get('7')();
  const messages = await run;
  assert.deepEqual(messages.filter(m => m.role === 'tool').map(m => m.tool_call_id), ['1','2','3','4','5','6','7','8']);
  assert.deepEqual(finished.slice(0, 3), ['3', '2', '1']);
  assert.equal(new Set(signals).size, 8);
});

test('an effect failure preserves sibling results and later barriers', async () => {
  const agent = new Agent('scheduler', createTestAgentOptions({ tools: {
    getIdentity: () => ({}), getSchemas: () => [], getParallelReadTab,
    async execute(_name, _args, _signal, context) { return { value: context.toolCallId }; },
  } }));
  agent._applyToolResultEffects = async (_name, result) => {
    if (result.value === '2') throw new Error('effect failed');
    return [];
  };
  const result = await agent._executeToolCalls([call('1','read_article',1),call('2','read_article',2),call('3','navigate',3)], new AbortController().signal);
  assert.deepEqual(result.map(message => message.tool_call_id), ['1','2','3']);
  assert.match(JSON.stringify(result[1]), /effect failed/);
  assert.match(JSON.stringify(result[2]), /value/);
});

test('stop cancels each running call and revokes pending effects and later barriers', async () => {
  const controller = new AbortController(), signals = [];
  let commits = 0;
  const agent = new Agent('scheduler', createTestAgentOptions({ tools: {
    getIdentity: () => ({}), getSchemas: () => [], getParallelReadTab,
    async execute(_name, _args, signal) {
      signals.push(signal);
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      return { late: true };
    },
  } }));
  agent._applyToolResultEffects = async () => { commits++; return []; };
  const run = agent._executeToolCalls([call('1','read_article',1),call('2','read_article',2),call('3','navigate',3)], controller.signal);
  await tick(); controller.abort(); await run;
  assert.equal(signals.length, 2); assert.ok(signals.every(signal => signal.aborted)); assert.equal(commits, 0);
});
