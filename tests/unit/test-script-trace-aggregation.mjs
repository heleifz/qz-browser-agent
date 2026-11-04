import assert from 'node:assert/strict';
import test from 'node:test';
import { beginScriptTrace, acceptScriptTrace, inheritScriptTrace, collectScriptResultTrace } from '../../src/background/tools/script-trace.js';
import { withToolCallLifecycle } from '../../src/background/tools/call-lifecycle.js';
import { createRunScriptBridge } from '../../src/background/tools/run-script-bridge.js';
import { getToolResultTraces } from '../../src/shared/contracts/tool-result-presentation.js';

const row = (message, traceIndex = 1, extra = {}) => ({ level: 'trace', message, traceIndex, ...extra });

test('concurrent nested scripts contribute diagnostics even when the parent returns only business data', async () => {
  const root = { sessionId: 's', runId: 'r', toolCallId: 'root', resultPresentation: {} };
  const controller = new AbortController(), records = [];
  let bridge;
  bridge = createRunScriptBridge({
    supervisor: { isRunCurrent: () => true, hasAgent: () => true, getAbortSignal: () => controller.signal },
    getRuntime: () => ({ status: 'running' }), canManageSessions: async () => false,
    buildRunProfile: async () => ({}), collectArtifacts: () => [],
    recordNestedTool: async event => { records.push(event); },
    toolRuntime: {
      getSchemas: () => [], resolveDefinition: () => ({}),
      getBatchTabPolicy: () => ({ kind: 'script' }),
      async execute(name, args, signal, context) {
        return withToolCallLifecycle({ ...context, signal }, async scoped => {
          if (name === 'evaluate') {
            scoped.resultPresentation._display = { script: { trace: [row(`page:${args.tabRef}`)] } };
            return args.tabRef;
          }
          const requestId = scoped.toolExecutionId, trace = beginScriptTrace(scoped, requestId);
          try {
            acceptScriptTrace(requestId, row(`skill:${args.tabRef}`, 1, { toolCallId: 'forged', parentCallId: 'forged' }));
            const result = await bridge.invokeTool(scoped, 'evaluate', { tabRef: args.tabRef });
            trace.finish([row(`skill:${args.tabRef}`, 1)]);
            return { ok: true, result }; // Parent deliberately discards this receipt.
          } finally { trace.close(); }
        });
      },
    },
  });
  await withToolCallLifecycle({ ...root, signal: controller.signal }, async context => {
    const trace = beginScriptTrace(context, 'root-request');
    try {
      acceptScriptTrace('root-request', row('before'));
      const values = await Promise.all(['one', 'two'].map(tabRef => bridge.invokeTool(context, 'skill', { tabRef })));
      acceptScriptTrace('root-request', row('after', 2));
      assert.deepEqual(values.map(value => value.result), ['one', 'two']);
      trace.finish([row('before'), row('after', 2)]);
    } finally { trace.close(); }
  });
  const rows = root.resultPresentation._display.script.trace;
  assert.deepEqual(rows.filter(item => item.level === 'trace').map(item => item.message).sort(),
    ['after', 'before', 'page:one', 'page:two', 'skill:one', 'skill:two']);
  assert.equal(rows.filter(item => item.level === 'tool.start').length, 4);
  assert.equal(rows.filter(item => item.level === 'tool.end').length, 4);
  assert.deepEqual(rows.filter(item => item.level === 'tool.start' && item.parentCallId === 'root').map(item => item.sequence), [1, 2]);
  for (const start of records.filter(event => event.phase === 'start')) {
    for (const level of ['tool.start', 'tool.end']) {
      const matches = rows.filter(item => item.level === level && item.toolCallId === start.toolCallId);
      assert.equal(matches.length, 1);
      assert.equal(matches[0].parentCallId, start.parentCallId);
      assert.equal(matches[0].tabRef, start.args.tabRef);
      assert.equal(matches[0].sequence, rows.find(item => item.level === 'tool.start' && item.toolCallId === start.toolCallId).sequence);
    }
  }
  for (const nested of rows.filter(item => item.message.startsWith('skill:'))) {
    assert.notEqual(nested.toolCallId, 'forged');
    assert.equal(nested.parentCallId, 'root');
  }
  assert.ok(getToolResultTraces(null, root.resultPresentation).some(value => /evaluate completed.*parent=/.test(value)));
});

test('recorded nested progress survives cancellation and late emissions cannot mutate a finished receipt', () => {
  const root = { toolCallId: 'root', resultPresentation: {} }, child = { toolCallId: 'child', resultPresentation: {} };
  const rootTrace = beginScriptTrace(root, 'cancel-root');
  inheritScriptTrace(root, child);
  const childTrace = beginScriptTrace(child, 'cancel-child');
  acceptScriptTrace('cancel-child', row('saved first page'));
  acceptScriptTrace('cancel-root', row('cancelled', 1, { level: 'error' }));
  rootTrace.close();
  acceptScriptTrace('cancel-child', row('late update', 2));
  acceptScriptTrace('cancel-root', row('late update', 2));
  childTrace.close();
  assert.deepEqual(getToolResultTraces(null, root.resultPresentation), ['saved first page', 'cancelled']);
});

test('trace limits retain the latest progress and explicitly account for omitted rows', () => {
  const context = { resultPresentation: {} }, trace = beginScriptTrace(context, 'bounded');
  try {
    for (let index = 1; index <= 100; index++) acceptScriptTrace('bounded', row(`step-${index} ${'x'.repeat(1500)}`, index));
    const rows = trace.finish([]);
    assert.ok(rows.length <= 80);
    assert.ok(rows.reduce((sum, item) => sum + item.message.length, 0) <= 12000);
    assert.match(rows[0].message, /^\[trace truncated: \d+ earlier entries omitted\]$/);
    assert.match(rows.at(-1).message, /^step-100 /);
    assert.match(rows.at(-1).message, /\[truncated\]$/);
  } finally { trace.close(); }
});

test('Worker lifecycle rows and unknown executions cannot forge host tool identity', () => {
  const context = { toolCallId: 'root', resultPresentation: {} }, trace = beginScriptTrace(context, 'trusted');
  try {
    acceptScriptTrace('unknown', row('injected'));
    acceptScriptTrace('trusted', row('fake tool', 1, { level: 'tool.end', toolCallId: 'forged' }));
    acceptScriptTrace('trusted', row('normal diagnostic', 2, { toolCallId: 'forged', parentCallId: 'forged', tabRef: 'forged' }));
    const rows = trace.finish([]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].toolCallId, 'root');
    assert.equal(rows[0].parentCallId, undefined);
    assert.equal(rows[0].tabRef, undefined);
  } finally { trace.close(); }
});

test('nested script trace is not collected twice from its completed presentation', () => {
  const root = { resultPresentation: {} }, child = { resultPresentation: {} };
  const rootTrace = beginScriptTrace(root, 'dedup-root');
  inheritScriptTrace(root, child);
  const childTrace = beginScriptTrace(child, 'dedup-child');
  try {
    acceptScriptTrace('dedup-child', row('once'));
    childTrace.finish([row('once')]);
    collectScriptResultTrace(root, child);
    assert.deepEqual(getToolResultTraces(null, root.resultPresentation), ['once']);
  } finally { childTrace.close(); rootTrace.close(); }
});
