import assert from 'node:assert/strict';
import test from 'node:test';
import { updateTranscriptWithAgentEvent } from '../../src/shared/session/session-codec.js';
import { FlowExecution, registerFlowExecution } from '../../src/background/tools/flow-execution.js';
import { createRunScriptBridge } from '../../src/background/tools/run-script-bridge.js';
import { waitForNavigation } from '../../src/capabilities/wait/navigation-wait.js';
import { compactFlowValue } from '../../src/shared/flow-script.js';
import { setInputFiles } from '../../src/content/file-input.js';
import { compileInnerWorker } from '../../scripts/build-extension.mjs';
import { runInnerWorker } from '../support/inner-runner-fixture.mjs';

const context = { sessionId: 'flow', runId: 'run', toolCallId: 'call' };
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('core tool policy covers page actions and non-page storage while rejecting recursive/hidden/Skill dispatch', async () => {
  const flow = new FlowExecution(context);
  for (const name of ['act_on_screen', 'upload_files', 'read_dom', 'list_images', 'run_script']) {
    assert.equal(await flow.call(name, { tabId: 101, mutatesPage: true }, async () => 'ok', { page: 'owned' }), 'ok');
    await assert.rejects(flow.call(name, {}, async () => 'wrong', { page: 'owned' }), { code: 'FLOW_TAB_REQUIRED' });
  }
  await flow.call('save_file', {}, async () => ({ id: 'file' }), { page: false });
  for (const policy of [{ hidden: true }, { source: 'plugin' }]) await assert.rejects(flow.call('arbitrary', {}, async () => {}, policy), { code: 'FLOW_TOOL_UNSUPPORTED' });
  flow.dispose();
});

test('passive waits do not block same-tab actions; failures observe under the action lock and recover', async () => {
  const flow = new FlowExecution(context), ready = deferred(), snapshot = deferred(), order = [];
  const wait = flow.call('wait_for_element', { tabId: 102 }, () => ready.promise, { page: 'owned', behavior: { flowWait: true } });
  await flow.call('act_on_element', { tabId: 102 }, async () => { ready.resolve({ ok: true }); return {}; });
  await wait;
  flow.observe = async () => { order.push('observe'); await snapshot.promise; return { text: 'error state' }; };
  const failed = flow.call('act_on_element', { tabId: 102 }, async () => ({ ok: false, code: 'STALE_ELEMENT_UID', error: 'Expired full UID' }));
  const checked = assert.rejects(failed, error => error.code === 'STALE_ELEMENT_UID' && error.details.observation.snapshot.text === 'error state');
  await tick();
  const recovered = flow.call('find_elements', { tabId: 102 }, async () => { order.push('recover'); return {}; });
  await tick(); assert.deepEqual(order, ['observe']);
  snapshot.resolve(); await checked; await recovered;
  assert.deepEqual(order, ['observe', 'recover']); flow.dispose();
});

test('watch handshake, cancellation and finished scope use the ordinary bridge and run signal', async () => {
  const scope = registerFlowExecution('watch-request', context), listeners = new Set();
  const bridge = createRunScriptBridge({
    supervisor: { isRunCurrent: () => true, hasAgent: () => true, getAbortSignal: () => undefined }, getRuntime: () => ({}),
    canManageSessions: async () => false, buildRunProfile: async () => ({}), collectArtifacts: () => [],
    toolRuntime: {
      resolveDefinition: name => ({ page: 'owned', behavior: { flowWait: name === 'wait_for_navigation' } }), getSchemas: () => [],
      async execute(name, args, signal, ctx) {
        if (name === 'wait_for_navigation') return new Promise((resolve, reject) => {
          const done = () => { listeners.delete(done); resolve({ status: 'complete' }); };
          signal.addEventListener('abort', () => { listeners.delete(done); reject(new Error('aborted')); }, { once: true });
          listeners.add(done); ctx.flowWaitReady();
        });
        if (name === 'navigate') for (const listener of listeners) listener();
        return { tabId: args.tabId };
      },
    },
  });
  const call = (toolName, args) => bridge.handleToolCall({ ...context, flowRequestId: 'watch-request', toolName, args, depth: 1 });
  const armed = await call('__flow_watch__', { name: 'wait_for_navigation', args: { tabId: 103, next: true } });
  assert.equal(listeners.size, 1);
  await call('navigate', { tabId: 103 });
  assert.equal((await call('__flow_watch_result__', armed.result)).result.status, 'complete');
  assert.equal((await call('__flow_watch_result__', armed.result)).code, 'FLOW_WATCH_EXPIRED');
  const abandoned = await call('__flow_watch__', { name: 'wait_for_navigation', args: { tabId: 103 } });
  assert.equal((await call('__flow_watch_cancel__', abandoned.result)).result.cancelled, true);
  await tick(); assert.equal(listeners.size, 0);
  await call('__flow_watch__', { name: 'wait_for_navigation', args: { tabId: 103 } });
  await scope.execution.finish(); assert.equal(listeners.size, 0);
  scope.dispose();
  assert.equal((await call('__flow_emit__', { value: 'late' })).code, 'FLOW_EXECUTION_EXPIRED');
});

test('final observation has a deadline even while queued behind another operation', async () => {
  const flow = new FlowExecution(context), other = new FlowExecution(context), gate = deferred();
  await flow.call('wait_for_element', {tabId:106}, async () => ({}), {page:'owned', behavior:{flowWait:true}});
  const blocked = other.call('navigate', {tabId:106}, () => gate.promise);
  const keepAlive = setTimeout(() => {}, 7000);
  try {
    const result = await flow.finish();
    assert.equal(result.code, 'FLOW_OBSERVATION_FAILED');
    assert.equal(flow.signal.aborted, false);
  } finally { clearTimeout(keepAlive); gate.resolve({}); await blocked; flow.dispose(); other.dispose(); }
});

test('flow results and checkpoints have explicit bounds; ordinary normalized images are separate', async () => {
  const flow = new FlowExecution(context), big = 'x'.repeat(300_000);
  assert.equal(compactFlowValue(big).truncated, true);
  for (const value of ['\\\\'.repeat(100000), '"'.repeat(100000), '\u0000'.repeat(100000)]) {
    assert.ok(JSON.stringify(compactFlowValue(value, 2048)).length <= 2048);
  }
  for (let i = 0; i < 20; i++) flow.emit({ i, big });
  assert.equal(flow.checkpoints.length, 16);
  assert.ok(JSON.stringify(flow.checkpoints).length < 35_000);
  await assert.rejects(flow.call('read_dom', { tabId: 104 }, async () => ({ text: big })), { code: 'FLOW_RESULT_TOO_LARGE' });
  await flow.call('screenshot', { tabId: 104 }, async () => ({ _image: big, ok: true }));
  flow.dispose(); assert.throws(() => flow.emit('late'), { code: 'OPERATION_ABORTED' });
});

test('compiled flow Worker exposes recoverable errors, emitted checkpoints, watch handles and bounded results', async () => {
  const source = await compileInnerWorker({ mode: 'production' });
  const { result, events } = await runInnerWorker(source, `
    const failed = await tools.$settle('act_on_element', {tabId: 1});
    const watch = await tools.$watch('wait_for_navigation', {tabId: 1, next:true});
    await tools.$emit({failed, navigation:await watch.wait()});
    return 'x'.repeat(100000);
  `, { flow: true, onMessage(message, respond) {
    let response = { ok: true, result: { id: 'watch' } };
    if (message.toolName === 'act_on_element') response = { ok: false, code: 'STALE_ELEMENT_UID', error: 'Refresh the snapshot', details: { observation: { tabId: 1, snapshot: 'fresh' } } };
    if (message.toolName === '__flow_emit__') response.artifacts = Array.from({length:70}, (_,i) => ({id:String(i)}));
    respond({ type: 'tool_response', callId: message.callId, response });
  } });
  assert.equal(result.ok, true); assert.equal(result.result.truncated, true);
  assert.equal(result.artifacts.length, 64); assert.equal(result.artifactsTruncated, true);
  const checkpoint = events.find(event => event.toolName === '__flow_emit__').args.value;
  assert.equal(checkpoint.failed.code, 'STALE_ELEMENT_UID');
  assert.equal(checkpoint.failed.observation.snapshot, 'fresh');
  assert.ok(JSON.stringify(result.result).length <= 65536);
});

test('intermediate results project into the same running tool and are replaced on completion', () => {
  let transcript = updateTranscriptWithAgentEvent([], { type: 'tool_execution_start', toolCallId: 'flow-call', toolName: 'run_flow', runId: 'r' }).transcript;
  transcript = updateTranscriptWithAgentEvent(transcript, { type: 'tool_execution_update', toolCallId: 'flow-call', runId: 'r', partialResult: { checkpoints: [{ value: { count: 10, table: 'rows' } }] }, statusText: '10 rows saved' }).transcript;
  assert.equal(transcript.length, 1); assert.equal(transcript[0].isRunning, true);
  assert.equal(transcript[0].result.checkpoints[0].value.table, 'rows');
  transcript = updateTranscriptWithAgentEvent(transcript, { type: 'tool_execution_end', toolCallId: 'flow-call', runId: 'r', result: { done: true } }).transcript;
  assert.deepEqual(transcript[0].result, { done: true }); assert.equal(transcript[0].isRunning, false);
});

function event() { const listeners = new Set(); return { addListener: f => listeners.add(f), removeListener: f => listeners.delete(f), emit: (...args) => [...listeners].forEach(f => f(...args)), get size() { return listeners.size; } }; }
test('navigation watch is armed before action, handles same-URL reload, timeout, close and Stop with no leaked listeners', async () => {
  const updated = event(), removed = event(), original = globalThis.chrome;
  globalThis.chrome = { tabs: { onUpdated: updated, onRemoved: removed, get: async () => ({ status: 'complete', url: 'https://test/' }) } };
  try {
    let armed = false;
    const result = waitForNavigation(105, 1000, true, undefined, () => { armed = true; });
    await tick(); assert.equal(armed, true); assert.equal(updated.size, 1);
    updated.emit(105, { status: 'loading' }, {});
    updated.emit(105, { status: 'complete' }, { url: 'https://test/' });
    assert.equal((await result).status, 'complete'); assert.equal(updated.size, 0);
    assert.equal((await waitForNavigation(105, 1, true)).status, 'timeout');
    const closed = waitForNavigation(105, 1000, true); const checkClosed = assert.rejects(closed, { code: 'SESSION_TAB_TARGET_DENIED' }); removed.emit(105); await checkClosed;
    const controller = new AbortController(); const stopped = waitForNavigation(105, 1000, true, controller.signal);
    const checkStopped = assert.rejects(stopped, { code: 'OPERATION_ABORTED' }); controller.abort(); await checkStopped;
    assert.equal(updated.size, 0); assert.equal(removed.size, 0);
  } finally { globalThis.chrome = original; }
});

test('file input uses explicit bytes, validates before mutation, supports clear and never reads a path', () => {
  const oldInput = globalThis.HTMLInputElement, oldTransfer = globalThis.DataTransfer;
  globalThis.HTMLInputElement = class { type = 'file'; multiple = true; disabled = false; events = []; dispatchEvent(event) { this.events.push(event.type); } };
  globalThis.DataTransfer = class { files = []; items = { add: file => this.files.push(file) }; };
  try {
    const input = new HTMLInputElement();
    const result = setInputFiles(input, [{ name: 'hello.txt', content: 'hello', mimeType: 'text/plain' }, { name: 'binary.bin', content: 'AAEC', encoding: 'base64' }]);
    assert.equal(result.bytes, 8); assert.deepEqual(input.events, ['input', 'change']);
    const before = input.files;
    assert.throws(() => setInputFiles(input, [{ name: '../secret', content: '' }]), /not a local path/);
    assert.throws(() => setInputFiles(input, [{ name: 'large', content: 'x'.repeat(600000) }]), /512 KiB/);
    assert.equal(input.files, before);
    setInputFiles(input, []); assert.equal(input.files.length, 0);
  } finally { globalThis.HTMLInputElement = oldInput; globalThis.DataTransfer = oldTransfer; }
});
