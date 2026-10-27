import assert from 'node:assert/strict';
import test from 'node:test';
import { FlowExecution, registerFlowExecution, resolveFlowExecution } from '../../src/background/tools/flow-execution.js';
import { createRunScriptBridge } from '../../src/background/tools/run-script-bridge.js';
import { assertScriptPageLifecycle } from '../../src/background/tools/behavior.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const context = { sessionId: 'flow-task', runId: 'flow-run', toolCallId: 'outer-call', spanId: 'outer-span' };

test('flow serializes one tab across invocations, permits parallel tabs, and observes after unawaited work', async () => {
  const flow = new FlowExecution(context), other = new FlowExecution(context);
  const gate = deferred(), order = [];
  const a = flow.call('navigate', { tabId: 21 }, async () => { order.push('a'); await gate.promise; return {}; });
  const b = flow.call('run_script', { tabId: 21 }, async () => { order.push('b'); return {}; });
  const c = other.call('act_on_element', { tabId: 21 }, async () => { order.push('c'); return {}; });
  await flow.call('navigate', { tabId: 22 }, async () => { order.push('independent'); return {}; });
  assert.deepEqual(order, ['a', 'independent']);
  flow.observe = async tabId => { order.push('snapshot'); return { tabId, text: 'fresh' }; };
  const finished = flow.finish(); await tick(); assert.equal(order.includes('snapshot'), false);
  gate.resolve(); await Promise.all([a, b, c]);
  assert.deepEqual(await finished, { purpose: 'next_turn_start', tabId: 21, snapshot: { tabId: 21, text: 'fresh' } });
  assert.deepEqual(order, ['a', 'independent', 'b', 'c', 'snapshot']);
  flow.dispose(); other.dispose();
});

test('Stop rejects in-flight and queued work promptly without releasing a running predecessor', async () => {
  const gate = deferred(), parent = new AbortController();
  const flow = new FlowExecution(context, parent.signal), later = new FlowExecution(context);
  let dispatched = 0;
  const a = flow.call('navigate', { tabId: 31 }, async () => { dispatched++; await gate.promise; return {}; });
  const b = flow.call('act_on_element', { tabId: 31 }, async () => { dispatched++; });
  const rejectedA = assert.rejects(a, { code: 'OPERATION_ABORTED' });
  const rejectedB = assert.rejects(b, { code: 'OPERATION_ABORTED' });
  parent.abort(); await Promise.all([rejectedA, rejectedB]);
  const c = later.call('navigate', { tabId: 31 }, async () => { dispatched++; return {}; });
  await tick(); assert.equal(dispatched, 1);
  gate.resolve(); await c; assert.equal(dispatched, 2);
  await assert.rejects(flow.finish(), { code: 'OPERATION_ABORTED' }); later.dispose();
});

test('flow scopes reject stale identities, unsupported nesting and missing explicit UID tab targets', async () => {
  const scope = registerFlowExecution('request', context);
  assert.equal(resolveFlowExecution('request', context.sessionId, context.runId), scope.execution);
  assert.throws(() => resolveFlowExecution('request', 'foreign', context.runId), { code: 'FLOW_EXECUTION_EXPIRED' });
  for (const name of ['navigate', 'act_on_element', 'get_ax_tree', 'wait_for_element', 'wait_for_network_idle']) {
    await assert.rejects(scope.execution.call(name, { target: 'uid:t1.1' }, async () => {}), { code: 'FLOW_TAB_REQUIRED' });
  }
  for (const [name, args] of [['run_flow', {}], ['run_script', { tabId: 1, target: ' INNER ' }], ['run_skill_script', { tabId: 1 }]]) {
    await assert.rejects(scope.execution.call(name, args, async () => {}), { code: 'FLOW_TOOL_UNSUPPORTED' });
  }
  scope.dispose(); assert.throws(() => resolveFlowExecution('request', context.sessionId, context.runId), { code: 'FLOW_EXECUTION_EXPIRED' });
});

test('final observation covers failed actions, excludes closed tabs, and reports unavailable snapshots', async () => {
  const flow = new FlowExecution(context);
  await flow.call('open_tab', {}, async () => ({ id: 41 }));
  await flow.call('open_tab', {}, async () => ({ id: 42 }));
  await flow.call('close_tab', { tabId: 42 }, async () => ({ ok: true }));
  flow.observe = async tabId => ({ text: `tab ${tabId}` });
  assert.equal((await flow.finish()).tabId, 41);
  await assert.rejects(flow.call('navigate', { tabId: 43 }, async () => { throw new Error('failed after action'); }));
  assert.equal((await flow.finish()).tabId, 43);
  flow.observe = async () => { throw new Error('tab closed externally' + 'x'.repeat(20000)); };
  const unavailable = await flow.finish();
  assert.equal(unavailable.code, 'FLOW_OBSERVATION_FAILED');
  assert.ok(unavailable.message.length <= 2048);
  await flow.call('close_tab', { tabId: 43 }, async () => ({ ok: true }));
  await flow.call('close_tab', { tabId: 41 }, async () => ({ ok: true }));
  assert.equal((await flow.finish()).code, 'FLOW_NO_OPEN_TAB'); flow.dispose();
});

test('flow bridge uses the normal runtime, captured call identity, deadline signal and fresh observation', async () => {
  const parent = new AbortController(), run = new AbortController(), calls = [];
  const scope = registerFlowExecution('bridge-flow', context, parent.signal);
  const bridge = createRunScriptBridge({
    supervisor: { isRunCurrent: () => true, hasAgent: () => true, getAbortSignal: () => run.signal },
    getRuntime: () => ({ workingTabId: 51, visitedTaskSites: [{ id: 51 }] }),
    canManageSessions: async () => false, buildRunProfile: async () => ({}), collectArtifacts: () => [],
    getRunToolContext: async () => ({ language: 'en', toolRegistrySnapshot: 'frozen' }),
    toolRuntime: {
      resolveDefinition: () => ({ page: 'owned', behavior: { mayUnloadPage: true } }), getSchemas: () => [],
      async execute(name, args, signal, ctx) {
        calls.push({ name, args, signal, ctx });
        assertScriptPageLifecycle({ name, behavior: { mayUnloadPage: true } }, args, ctx);
        if (args.tabId === 999) throw Object.assign(new Error('foreign tab'), { code: 'SESSION_TAB_FOREIGN' });
        return { ok: true, tabId: args.tabId, text: name === 'get_ax_tree' ? 'end state' : 'navigated' };
      },
    },
  });
  const call = (args, extra = {}) => bridge.handleToolCall({ ...context, flowRequestId: 'bridge-flow', toolName: 'navigate', depth: 1, args, ...extra });
  assert.equal((await call({ tabId: 51, url: 'https://example.test/' })).ok, true);
  assert.equal(calls[0].ctx.flowPageLeaf, true); assert.equal(calls[0].ctx.toolCallId, context.toolCallId);
  assert.equal(calls[0].ctx.toolRegistrySnapshot, 'frozen');
  assert.equal((await call({ tabId: 999 })).code, 'SESSION_TAB_FOREIGN');
  await call({ tabId: 51 });
  scope.execution.observe = async (tabId, signal, options) => {
    assert.equal(options.scope, 'viewport'); assert.equal(signal.aborted, false);
    return { tabId, text: 'end state' };
  };
  assert.equal((await scope.execution.finish()).snapshot.text, 'end state');
  assert.equal((await call({ tabId: 51 }, { depth: 4 })).code, 'RUN_SCRIPT_TOOL_DEPTH_EXCEEDED');
  parent.abort(); assert.equal(calls[0].signal.aborted, true);
  assert.equal((await call({ tabId: 51 })).code, 'FLOW_EXECUTION_EXPIRED');
  scope.dispose();
});
