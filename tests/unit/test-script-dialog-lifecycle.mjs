import assert from 'node:assert/strict';
import test from 'node:test';
import { createRunScriptBridge } from '../../src/background/tools/run-script-bridge.js';
import { createJavaScriptDialogHandler } from '../../src/background/tools/javascript-dialog.js';
import { createSessionSupervisor } from '../../src/background/session/supervisor.js';
import { ToolExecutionError } from '../../src/background/tools/arguments.js';

const listeners = new Set();
globalThis.chrome = {
  runtime: { getURL: path => `chrome-extension://test/${path}` },
  storage: { local: { async get() { return {}; } } },
  debugger: { onEvent: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) } },
};
const { createToolRuntime, defineTool } = await import('../../src/background/tools/runtime.js');
const flush = () => new Promise(setImmediate);
defineTool({ name: 'test_nested_independent', parameters: { type: 'object', properties: {} },
  timeout: 100, execute: () => new Promise(() => {}) });
let executeScript, executeDialog;
defineTool({ name: 'test_nested_script', parameters: { type: 'object', properties: { level: { type: 'number' } } },
  timeout: 100, execute: (args, signal, context) => executeScript(args, signal, context) });
defineTool({ name: 'test_nested_dialog', parameters: { type: 'object', properties: {} },
  timeout: 200, execute: (args, signal, context) => executeDialog(args, signal, context) });

for (const outcome of ['answer', 'answer then stall', 'stop', 'parent returns', 'parent timeout']) test(`script bridge scopes ancestor deadlines and child authority: ${outcome}`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const supervisor = createSessionSupervisor({ createAgent: () => ({ subscribe(emit) { this.emit = emit; } }) });
  (await supervisor.getAgent('s')).emit({ type: 'agent_start', runId: 'r' });
  const events = [], controller = new AbortController();
  const sessions = { beginUserWait: supervisor.beginUserWait, resolveUserWait: supervisor.resolveUserWait,
    isWaitingForUser: supervisor.isWaitingForUser, isRunCurrent: () => true };
  const emit = event => events.push(event);
  const runtime = createToolRuntime({ sessions, emit });
  const listenerCount = listeners.size;
  const bridge = createRunScriptBridge({
    supervisor: { isRunCurrent: () => true, hasAgent: () => true, getAbortSignal: () => controller.signal },
    getRuntime: () => ({ status: 'running' }), canManageSessions: async () => false,
    buildRunProfile: async () => ({}), toolRuntime: runtime, collectArtifacts: () => [],
  });
  const handler = createJavaScriptDialogHandler({ ToolExecutionError, getToolRuntimeDependencies: () => ({ sessions, emit }) });
  let parentContext, childSignal, childResult, returnParent;
  const heldParent = new Promise(resolve => { returnParent = resolve; });
  executeScript = async ({ level = 0 }, signal, context) => {
    if (!level) parentContext = context;
    const pending = bridge.handleToolCall({ sessionId: 's', runId: 'r', parentCallId: context.toolExecutionId,
      toolName: level ? 'test_nested_dialog' : 'test_nested_script', args: level ? {} : { level: 1 } });
    if (level) childResult = pending;
    if (!level && outcome === 'answer then stall') { await pending; return new Promise(() => {}); }
    return outcome === 'parent returns' && !level ? heldParent : pending;
  };
  executeDialog = async (_args, signal, context) => {
    childSignal = signal;
    if (outcome === 'parent timeout') return new Promise(() => {});
    return handler.withDialogGuard(9, context, async (_send, bind) => {
      await bind(async () => ({}));
      for (const listener of listeners) listener({ tabId: 9 }, 'Page.javascriptDialogOpening', { type: 'confirm', message: 'Proceed?' });
      return {};
    });
  };
  let settled;
  const parent = runtime.execute('test_nested_script', { level: 0 }, controller.signal, { sessionId: 's', runId: 'r' })
    .then(result => { settled = result; }, error => { settled = error; });
  await flush();
  assert.ok(childSignal);
  assert.ok(parentContext.toolExecutionId);
  if (outcome !== 'parent timeout') {
    assert.equal(sessions.isWaitingForUser('s'), true);
    // An independent tool in the same Session retains its own budget.
    const independent = runtime.execute('test_nested_independent', {}, controller.signal, { sessionId: 's', runId: 'r' });
    const independentError = assert.rejects(independent, { code: 'TOOL_TIMEOUT' });
    await flush();
    t.mock.timers.tick(201);
    await independentError;
    t.mock.timers.tick(86400000);
    await flush();
    assert.equal(settled, undefined);
    assert.equal(childSignal.aborted, false);
  }
  if (outcome.startsWith('answer')) sessions.resolveUserWait({ sessionId: 's', waitId: events.find(event => event.type === 'waiting_for_user').waitId, payload: { continued: true } });
  else if (outcome === 'stop') controller.abort();
  else if (outcome === 'parent returns') returnParent({ completed: true });
  else t.mock.timers.tick(100);
  if (outcome === 'answer then stall') {
    await flush();
    t.mock.timers.tick(99);
    await flush();
    assert.equal(settled, undefined, 'ancestor keeps its remaining execution budget');
    t.mock.timers.tick(1);
  }
  await parent;
  await flush();
  assert.equal(childSignal.aborted, !outcome.startsWith('answer'),
    'settled parent revokes pending descendants, not successfully completed tools');
  if (outcome === 'answer' || outcome === 'parent returns') {
    assert.equal(parentContext.signal.aborted, false, 'successful parent retains its own execution signal');
  }
  assert.equal(sessions.isWaitingForUser('s'), false);
  assert.equal(listeners.size, listenerCount);
  if (outcome === 'answer') assert.equal(settled.ok, true);
  if (outcome === 'stop') assert.equal(settled.code, 'OPERATION_ABORTED');
  if (outcome === 'parent timeout' || outcome === 'answer then stall') assert.equal(settled.code, 'TOOL_TIMEOUT');
  if (!outcome.startsWith('answer')) assert.ok(['RUN_STOPPED', 'OPERATION_ABORTED'].includes((await childResult).code));
  const late = await bridge.handleToolCall({ sessionId: 's', runId: 'r', parentCallId: parentContext.toolExecutionId, toolName: 'test_nested_dialog' });
  assert.equal(late.code, 'RUN_STOPPED');
});
