import assert from 'node:assert/strict';
import test from 'node:test';
import { registerWaitTools } from '../../src/capabilities/wait/tools.js';
import { runWaitWithTrigger } from '../../src/background/tools/wait-observation.js';
import { bindCreatedTabResult, createdTabResultId } from '../../src/shared/contracts/page-observation.js';

function event() {
  const listeners = new Set();
  return { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn),
    emit: (...args) => { for (const fn of listeners) fn(...args); }, get size() { return listeners.size; } };
}
function fixture() {
  const updated = event(), removed = event(), committed = event(), history = event(), fragment = event();
  const tab = { id: 5, status: 'complete', url: 'https://example.test/start', title: 'Page' };
  globalThis.chrome = { tabs: { get: async () => ({ ...tab }), onUpdated: updated, onRemoved: removed },
    webNavigation: { onCommitted: committed, onHistoryStateUpdated: history, onReferenceFragmentUpdated: fragment } };
  const definitions = new Map(), calls = [];
  let attached = true, visible = true, popup, observationSignal;
  const presence = (_id, _action, args, context) => {
    observationSignal = context?.signal;
    calls.push(args); const found = attached && (!args.visibleOnly || visible);
    return { found, element: found ? { text: 'Node' } : null };
  };
  registerWaitTools({ registerTool: value => definitions.set(value.name, value),
    getToolRuntimeDependencies: () => ({ sessions: { observePopup: async input => popup(input) } }),
    captureTabScreenshot: async () => ({ dataUrl: 'image' }), sendToContent: presence,
    element: { resolveSelectorTarget: async (_id, target) => ({ tabId: 5, selector: '#node', target,
      ...(target.startsWith('uid:') ? { uid: 'node', ref: { backendNodeId: 1 } } : {}) }),
      callElement: (_id, _binding, action, args, context) => presence(_id, action, args, context),
      addElementTargetsToFindResult: async value => ({ ...value, target: 'uid:t5.000001.1' }),
      elementTargetForSelector: value => `css:${value}` },
  });
  const context = { sessionId: 'task', runId: 'run', requestedTabRef: 'page' };
  return { tab, updated, removed, committed, history, fragment, definitions, calls, context,
    get observationSignal() { return observationSignal; },
    state(a, v) { attached = a; visible = v; }, setPopup(value) { popup = value; },
    run: (name, args = {}, extra = {}, signal) => definitions.get(name).execute({ tabId: 5, timeout: 0.2, ...args }, signal, { ...context, ...extra }) };
}

test('load and URL waits inspect current state; a completed page never satisfies a future navigation wait', async () => {
  const f = fixture();
  assert.deepEqual(await f.run('wait_for_load'), { status: 'complete', url: f.tab.url, title: 'Page' });
  assert.deepEqual(await f.run('wait_for_url', { urlPattern: '/start$', flags: 'g' }), { url: f.tab.url, title: 'Page' });
  await assert.rejects(f.run('wait_for_navigation', { timeout: 0.01 }), error => error.code === 'TOOL_TIMEOUT' && error.hint && error.details.tabRef === 'page');
  assert.equal(f.updated.size, 0); assert.equal(f.history.size, 0);
});

test('navigation is armed before its action and observes same-URL reloads and same-document navigation', async () => {
  for (const kind of ['reload', 'history', 'fragment']) {
    const f = fixture();
    const result = await f.run('wait_for_navigation', { trigger: { name: 'act_on_element', args: { tabRef: 'page' } } }, {
      async invokeTool(name, args, { signal }) {
        assert.equal(name, 'act_on_element'); assert.equal(args.tabRef, 'page'); assert.equal(signal.aborted, false);
        assert.equal(f.updated.size, 1);
        if (kind === 'reload') {
          f.updated.emit(5, { status: 'loading' }, { ...f.tab, status: 'loading' });
          f.committed.emit({ tabId: 5, frameId: 0, url: f.tab.url });
          f.updated.emit(5, { status: 'complete' }, f.tab);
        } else f[kind].emit({ tabId: 5, frameId: 0, url: f.tab.url });
        return { inputDelivered: true };
      },
    });
    assert.equal(result.status, 'navigated'); assert.equal(result.url, f.tab.url);
    assert.equal(f.updated.size, 0); assert.equal(f.history.size, 0);
  }
});

test('trigger failures win over observed success or failure, and all listeners are removed', async () => {
  for (const observedFailure of [false, true]) {
    const f = fixture(), failure = { code: 'ACTION_FAILED', message: 'Click failed', hint: 'Inspect first' };
    await assert.rejects(f.run('wait_for_navigation', { trigger: { name: 'click' } }, { async invokeTool() {
      if (observedFailure) f.removed.emit(5); else f.history.emit({ tabId: 5, frameId: 0 });
      await Promise.resolve(); throw failure;
    } }), error => error === failure);
    assert.equal(f.updated.size, 0); assert.equal(f.removed.size, 0);
  }
});

test('popup waits arm the host before triggering and retain creation authority when publishing an alias', async () => {
  const f = fixture(); let accept, disposed = 0;
  f.setPopup(input => {
    assert.equal(input.openerTabId, 5); assert.equal(input.tabAlias, undefined);
    return { result: new Promise(resolve => { accept = resolve; }), dispose: () => disposed++ };
  });
  const result = await f.run('wait_for_popup', { tabAlias: 'new-page', trigger: { name: 'click' } }, { async invokeTool() {
    assert.ok(accept); accept(bindCreatedTabResult({ tabRef: 6, url: 'about:blank', title: '', active: false }, 6));
    return { inputDelivered: true };
  } });
  assert.equal(result.tabRef, 'new-page'); assert.equal(createdTabResultId(result), 6); assert.equal(disposed, 1);
});

test('element states distinguish hidden from detached for CSS and original UID nodes', async () => {
  for (const target of ['css:#node', 'uid:t5.000001.1']) {
    const f = fixture();
    f.state(true, false);
    assert.equal((await f.run('wait_for_element', { target, state: 'attached' })).found, true);
    assert.equal(f.calls.at(-1).visibleOnly, false);
    assert.equal((await f.run('wait_for_element', { target, state: 'hidden' })).found, false);
    assert.equal(f.calls.at(-1).visibleOnly, true);
    await assert.rejects(f.run('wait_for_element', { target, state: 'detached', timeout: 0.01 }), { code: 'TOOL_TIMEOUT' });
    f.state(false, false);
    assert.equal((await f.run('wait_for_element', { target, state: 'detached' })).found, false);
    f.state(true, true);
    assert.equal((await f.run('wait_for_element', { target })).found, true);
    assert.equal(f.definitions.get('wait_for_element').parameters.properties.absent, undefined);
  }
});

test('element wait cancels its Content work when its own deadline expires', async () => {
  const f = fixture(); f.state(false, false);
  await assert.rejects(f.run('wait_for_element', { target: 'css:#node', timeout: 0.01 }), { code: 'TOOL_TIMEOUT' });
  assert.equal(f.observationSignal.aborted, true);
});

test('page predicates receive JSON arguments and the caller alias, and return the truthy value', async () => {
  const f = fixture(), received = []; let count = 0;
  const result = await f.run('wait_for_function', { code: 'value => value', args: [1, 2] }, { async invokeTool(name, args, { signal }) {
    received.push({ name, args }); assert.equal(signal.aborted, false);
    return ++count === 1 ? false : { ready: true };
  } });
  assert.deepEqual(result, { ready: true }); assert.equal(received.length, 2);
  assert.deepEqual(received[0], { name: 'evaluate', args: { tabRef: 'page', code: 'value => value', waitUntil: 'commit', args: [1, 2] } });
});

test('one deadline covers observation and action, while cancellation disposes an armed observer', async () => {
  for (const cancel of [false, true]) {
    const controller = new AbortController(); let disposed = 0;
    const waiting = runWaitWithTrigger({ tool: 'probe', timeoutMs: cancel ? 1000 : 10, signal: controller.signal,
      trigger: { name: 'pending' }, context: { invokeTool: (_name, _args, { signal }) => new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }) } }, () => ({ result: Promise.resolve('event already seen'), dispose: () => disposed++ }));
    if (cancel) controller.abort();
    await assert.rejects(waiting, { code: cancel ? 'OPERATION_ABORTED' : 'TOOL_TIMEOUT' });
    assert.equal(disposed, 1);
  }
});

test('an observer that finishes arming after timeout is disposed without invoking its action', async () => {
  let ready, disposed = 0, invoked = 0;
  const waiting = runWaitWithTrigger({ tool: 'late-arm', timeoutMs: 10, trigger: { name: 'click' },
    context: { invokeTool: async () => { invoked++; } },
  }, () => new Promise(resolve => { ready = resolve; }));
  await assert.rejects(waiting, { code: 'TOOL_TIMEOUT' });
  let rejectLate;
  ready({ result: new Promise((_, reject) => { rejectLate = reject; }), dispose() { disposed++; rejectLate(new Error('late observer cancelled')); } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(disposed, 1); assert.equal(invoked, 0);
});
