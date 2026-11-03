import assert from 'node:assert/strict';
import test from 'node:test';
import { createToolRegistry } from '../../src/background/tools/registry.js';
import { registerWaitTools } from '../../src/capabilities/wait/tools.js';
import { ToolExecutionError } from '../../src/background/tools/arguments.js';

globalThis.chrome = { runtime: { getURL: path => `chrome-extension://fixture/${path}` },
  storage: { local: { async get() { return {}; } } }, tabs: { async get(id) { return { id, url: 'https://example.test/' }; } } };
const { createToolRuntime, resolveToolDefinition, getToolSchemas } = await import('../../src/background/tools/runtime.js');

function runtimeFixture() {
  const targets = [];
  const runtime = createToolRuntime({ sessions: {
    isRunCurrent: () => true, listOwnedTabIds: () => [5, 6],
    resolveTargetTab: async input => { targets.push(input); return { ok: true, tabId: input.tabId }; },
  } });
  return { runtime, targets, context: { sessionId: 's', runId: 'run', workingTabId: 5 } };
}

test('five public schemas expose target only, while legacy selector is canonicalized before scheduling and validation', async () => {
  const f = runtimeFixture(), registry = createToolRegistry(), seen = [];
  const names = ['read_article', 'read_dom', 'find_elements', 'list_images', 'wait_for_element'];
  const schemas = getToolSchemas();
  for (const name of names) {
    const definition = resolveToolDefinition(name);
    const schema = schemas.find(item => item.function.name === name).function.parameters;
    assert.equal(schema.properties.selector, undefined, name);
    assert.equal(schema.properties.target.type, 'string', name);
    if (name === 'wait_for_element') assert.ok(schema.required.includes('target'));
    registry.forCapability('reference-test')({ ...definition, execute: args => { seen.push(args); return { ok: true }; } });
  }
  const ref = f.runtime.element.registerElementBinding({ tabId: 5, sessionId: 's', backendNodeId: 42, loaderId: 'doc', snapshotId: 't5.000001' });
  const context = { ...f.context, toolRegistrySnapshot: registry.snapshot() };
  const sources = schemas.find(item => item.function.name === 'read_article').function.parameters.properties.source.enum;
  assert.ok(sources.includes('target')); assert.ok(!sources.includes('selector'));
  await f.runtime.execute('read_article', { source: 'selector', selector: ref.target, limit: 100 }, undefined, context);
  assert.equal(seen.at(-1).source, 'target');
  assert.equal(seen.at(-1).target, ref.target);
  for (const name of names) {
    await f.runtime.execute(name, { selector: ref.target, limit: 100 }, undefined, context);
    assert.equal(seen.at(-1).target, ref.target);
    assert.equal(Object.hasOwn(seen.at(-1), 'selector'), false);
    await f.runtime.execute(name, { target: '#chosen', selector: 'uid:unknown', limit: 100 }, undefined, context);
    assert.equal(seen.at(-1).target, '#chosen', 'canonical target wins over a legacy alias');
    assert.equal(f.runtime.getBatchTabPolicy(name, { selector: ref.target }, context).tabId, 5);
    await assert.rejects(f.runtime.execute(name, { tabRef: 5, target: 'uid:unknown', limit: 100 }, undefined, context), { code: 'STALE_ELEMENT_UID' });
  }
});

test('one registry format separates frames/documents and preserves older image observations', async () => {
  const f = runtimeFixture(), register = f.runtime.element.registerElementBinding;
  const base = { sessionId: 's', tabId: 5, loaderId: 'doc-a', backendNodeId: 42, snapshotId: 't5.000001', selector: '#image', imageSrc: 'https://example.test/old.png' };
  const first = register(base);
  assert.match(first.target, /^uid:t5\.[0-9a-z]{6}\.\d+$/);
  assert.equal(register(base).uid, first.uid, 'partial snapshots keep the same node identity');
  const child = register({ ...base, frameId: 'child' });
  const replaced = register({ ...base, loaderId: 'doc-b' });
  const later = register({ ...base, snapshotId: 't5.000002', imageSrc: 'https://example.test/new.png' });
  assert.equal(new Set([first.uid, child.uid, replaced.uid, later.uid]).size, 4);
  const old = await f.runtime.element.resolveElementReference(5, { target: first.target }, f.context);
  assert.equal(old.ref.imageSrc, base.imageSrc, 'another reader must not overwrite a list_images source constraint');
  const fallback = register({ ...base, backendNodeId: 0 });
  assert.equal(fallback.uid, undefined);
  assert.equal(fallback.target, 'css:#image');
  for (const target of ['#image', 'css:#image']) assert.equal((await f.runtime.element.resolveElementReference(5, { target }, f.context)).selector, '#image');
});

test('UID waits retain opaque host authority, distinguish removal from unknown references, and cancel polling', async () => {
  const definitions = new Map(), controller = new AbortController();
  const context = Object.defineProperty({ signal: controller.signal }, Symbol('authority'), { value: 7 });
  let unavailable = false, calls = 0;
  registerWaitTools({ registerTool: definition => definitions.set(definition.name, definition),
    getToolRuntimeDependencies: () => ({}), captureTabScreenshot: async () => ({}), sendToContent: async () => ({}),
    element: {
      resolveSelectorTarget: async (_tabId, target, _index, received) => {
        assert.equal(received, context);
        if (target === 'uid:unknown') throw new ToolExecutionError('STALE_ELEMENT_UID', 'unknown');
        return { tabId: 5, uid: 'node', target, selector: '', ref: { backendNodeId: 42 } };
      },
      callElement: async (_tabId, _binding, action, args, received) => {
        assert.equal(received, context); assert.equal(action, 'elementPresence'); assert.equal(args.visibleOnly, true); calls++;
        if (unavailable) throw new ToolExecutionError('STALE_ELEMENT_UID', 'gone', { reason: 'node_unavailable' });
        return { found: true, element: { selector: '#node' } };
      },
      addElementTargetsToFindResult: async item => ({ ...item, uid: 'fresh', target: 'uid:fresh' }),
      elementTargetForSelector: selector => `css:${selector}`,
    },
  });
  const wait = definitions.get('wait_for_element');
  const found = await wait.execute({ target: 'uid:node', timeout: 1 }, controller.signal, context);
  assert.equal(found.element.target, 'uid:fresh');
  unavailable = true;
  assert.equal((await wait.execute({ target: 'uid:node', absent: true, timeout: 1 }, controller.signal, context)).timedOut, undefined);
  await assert.rejects(wait.execute({ target: 'uid:unknown', absent: true, timeout: 1 }, controller.signal, context), { code: 'STALE_ELEMENT_UID' });
  unavailable = false;
  const polling = wait.execute({ target: 'uid:node', absent: true, timeout: 10, intervalSeconds: 1 }, controller.signal, context);
  await new Promise(resolve => setImmediate(resolve)); controller.abort();
  await assert.rejects(polling, error => error.code === 'OPERATION_ABORTED' || error.name === 'AbortError');
  const settledCalls = calls; await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(calls, settledCalls);
});
