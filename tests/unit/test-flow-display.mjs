import assert from 'node:assert/strict';
import test from 'node:test';
import { FlowExecution } from '../../src/background/tools/flow-execution.js';
import { FLOW_DISPLAY_STEPS } from '../../src/shared/flow-script.js';
import { parseFlowDisplay, projectFlowResult, flowText } from '../../src/capabilities/script/flow-result.js';
import { updateTranscriptWithAgentEvent } from '../../src/shared/session/session-codec.js';
import { createSessionExchangePayload, normalizeSessionExchangePayload, settleImportedTranscript } from '../../src/shared/session/session-exchange.js';
import { flowFixture } from '../fixtures/flow-display.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('display records invocation order, concurrency, outcomes and failures without sensitive arguments', async () => {
  const updates = [], flow = new FlowExecution({}, undefined, value => updates.push(value));
  const gate = deferred();
  const first = flow.call('navigate', { tabId: 1, url: 'https://example.com' }, () => gate.promise);
  const second = flow.call('act_on_element', { tabId: 1, action: 'fill', target: 'css:input', value: 'private-input', code: 'private-code' }, async () => ({}));
  await flow.call('wait_for_element', { tabId: 2, selector: '#ready', text: 'Ready' }, async () => ({ found: true }), { page: 'owned', behavior: { flowWait: true } });
  assert.deepEqual(flow.display().steps.map(s => s.state), ['running', 'queued', 'completed']);
  gate.resolve({ urlChanged: true }); await first; await second;
  await assert.rejects(flow.call('read_dom', { tabId: 2 }, async () => ({ error: 'failed', code: 'BROKEN' })), { code: 'BROKEN' });
  const display = flow.display();
  assert.deepEqual(display.steps.map(s => s.id), [1, 2, 3, 4]);
  assert.equal(display.steps[0].outcome, 'navigated');
  assert.equal(display.steps[2].outcome, 'condition_met');
  assert.equal(display.steps[3].state, 'error');
  assert.ok(display.steps.every(s => s.elapsedMs >= 0));
  assert.doesNotMatch(JSON.stringify(display), /private-input|private-code/);
  assert.equal(updates.at(-1).flow.steps.at(-1).code, 'BROKEN');
  assert.equal(updates[0].flow.steps[0].state, 'queued', 'published records are immutable snapshots');
  flow.dispose();
});

test('display is bounded, excludes automatic snapshots and drops trailing publication after Stop', async () => {
  const updates = [], flow = new FlowExecution({}, undefined, value => updates.push(value));
  for (let i = 0; i < FLOW_DISPLAY_STEPS + 10; i++) await flow.call('data_store', { table: 'rows' }, async () => ({}), { page: false });
  flow.observe = async () => ({ snapshot: 'AX' });
  await flow.finish({ tabId: 2 });
  assert.equal(flow.display().total, FLOW_DISPLAY_STEPS + 10);
  assert.equal(flow.display().steps.length, FLOW_DISPLAY_STEPS);
  assert.equal(flow.display().omitted, 10);
  assert.ok(flow.display().steps.every(s => !s.tool.startsWith('__')));
  flow.dispose(); const count = updates.length;
  await new Promise(resolve => setTimeout(resolve, 230));
  assert.equal(updates.length, count);
  await assert.rejects(flow.call('data_store', {}, async () => ({})), { code: 'OPERATION_ABORTED' });
});

test('parser bounds untrusted/legacy data, preserves failures and marks truncated observations', () => {
  assert.equal(parseFlowDisplay(null), null);
  assert.equal(parseFlowDisplay({ _display: { flow: { version: 99, steps: [] } } }), null);
  const value = flowFixture().result;
  value._display.flow.steps.push({ id: 4, tool: '<script>', state: 'completed' }, { id: 5, tool: 'x', state: 'unknown' });
  assert.equal(parseFlowDisplay(value).steps.length, 4);
  assert.equal(projectFlowResult({ ok: true, result: { ok: false } }).result.ok, false);
  assert.equal(projectFlowResult({ finalObservation: { snapshot: { truncated: true, preview: 'AX preview' } } }).snapshotTruncated, true);
  assert.equal(flowText('x'.repeat(50000)).text.length, 16000);
  assert.equal(flowText('x'.repeat(50000)).truncated, true);
});

test('flow display stays out of model messages while final observation remains available', async () => {
  const { Agent } = await import('../../src/background/agent/agent.js');
  const result = flowFixture().result;
  for (const isError of [false, true]) {
    const messages = Agent.prototype._buildToolResultMessages.call({ _toolModelPolicy: () => ({}) }, 'flow', result, isError, 'run_flow');
    const value = JSON.parse(messages[0].content);
    assert.equal(value._display, undefined);
    assert.deepEqual(value.finalObservation, result.finalObservation);
    assert.deepEqual(value.result, result.result);
  }
});

test('Stop and portable session round trips retain display data; imported running records settle', async () => {
  const entry = flowFixture('running');
  const stopped = updateTranscriptWithAgentEvent([entry], { type: 'aborted', runId: entry.runId }).transcript;
  assert.equal(stopped[0].phase, 'aborted');
  assert.deepEqual(stopped[0].result._display, entry.result._display);
  const ended = updateTranscriptWithAgentEvent([entry], { type: 'tool_execution_end', toolCallId: entry.toolCallId, runId: entry.runId, toolName: 'run_flow', isError: true, result: { error: 'timeout', code: 'TOOL_TIMEOUT' } }).transcript;
  assert.deepEqual(ended[0].result._display, entry.result._display);
  assert.equal(ended[0].result.code, 'TOOL_TIMEOUT');
  assert.equal(ended[0].result.checkpoints, undefined);
  const success = updateTranscriptWithAgentEvent([entry], { type: 'tool_execution_end', toolCallId: entry.toolCallId, runId: entry.runId, result: { ok: true } }).transcript;
  assert.equal(success[0].result._display, undefined, 'successful terminal results replace progress');
  const payload = createSessionExchangePayload({ session: { id: 'display-test', title: 'Flow' }, transcript: [entry] });
  const imported = normalizeSessionExchangePayload(JSON.parse(JSON.stringify(payload)));
  assert.deepEqual(imported.session.transcript[0].result._display, entry.result._display);
  assert.equal(settleImportedTranscript(imported.session.transcript)[0].isRunning, false);
  await tick();
});
