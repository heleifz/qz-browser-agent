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
  const updated = event(), removed = event(), before = event(), committed = event(), history = event(), fragment = event(), failed = event();
  const tab = { id: 5, status: 'complete', url: 'https://example.test/start', title: 'Page' };
  const frame = { documentId: 'document', errorOccurred: false };
  globalThis.chrome = { tabs: { get: async () => ({ ...tab }), onUpdated: updated, onRemoved: removed },
    webNavigation: { onBeforeNavigate: before, onCommitted: committed, onHistoryStateUpdated: history,
      onReferenceFragmentUpdated: fragment, onErrorOccurred: failed, getFrame: async () => ({ url: tab.url, ...frame }) } };
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
      resolveLocatorTarget: async () => attached ? { tabId: 5, selector: '#node' } : null,
      callElement: (_id, _binding, action, args, context) => presence(_id, action, args, context),
      addElementTargetsToFindResult: async value => ({ ...value, target: 'uid:t5.000001.1' }),
      elementTargetForSelector: value => `css:${value}` },
  });
  const context = { sessionId: 'task', runId: 'run', requestedTabRef: 'page' };
  return { tab, frame, updated, removed, before, committed, history, fragment, failed, definitions, calls, context,
    get observationSignal() { return observationSignal; },
    state(a, v) { attached = a; visible = v; }, setPopup(value) { popup = value; },
    run: (name, args = {}, extra = {}, signal) => definitions.get(name).execute({ tabId: 5, timeout: 0.2, ...args }, signal, { ...context, ...extra }) };
}

test('load and URL waits inspect current state; a completed page never satisfies a future navigation wait', async () => {
  const f = fixture();
  assert.deepEqual(await f.run('wait_for_load'), { status: 'complete', url: f.tab.url, title: 'Page' });
  assert.deepEqual(await f.run('wait_for_url', { urlPattern: '/start$', flags: 'g' }), { url: f.tab.url, title: 'Page' });
  await assert.rejects(f.run('wait_for_navigation', { timeout: 0.01 }), error => error.code === 'TOOL_TIMEOUT' && error.details.tabRef === 'page');
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

test('an error document is navigation failure even after its tab reports complete', async () => {
  const f = fixture(); let clicks = 0;
  await assert.rejects(f.run('wait_for_navigation', { trigger: { name: 'click' } }, { async invokeTool() {
    clicks++;
    f.tab.url = 'https://example.test/failed';
    f.frame.documentId = 'error-document'; f.frame.errorOccurred = true;
    f.before.emit({ tabId: 5, frameId: 0, url: f.tab.url, timeStamp: 10 });
    f.failed.emit({ tabId: 5, frameId: 0, url: f.tab.url, timeStamp: 20, documentId: 'error-document', error: 'net::ERR_EMPTY_RESPONSE' });
    f.updated.emit(5, { status: 'complete' }, f.tab);
    return {};
  } }), error => error.code === 'NAVIGATION_FAILED' && error.details.url === f.tab.url);
  assert.equal(clicks, 1);
  for (const event of [f.updated, f.removed, f.before, f.committed, f.history, f.fragment, f.failed]) assert.equal(event.size, 0);
});

test('a cancelled request without a new document cannot satisfy a navigation wait', async () => {
  const f = fixture();
  await assert.rejects(f.run('wait_for_navigation', { timeout: 0.02, trigger: { name: 'click' } }, { async invokeTool() {
    f.before.emit({ tabId: 5, frameId: 0, url: 'https://example.test/download' });
    f.failed.emit({ tabId: 5, frameId: 0, url: 'https://example.test/download', error: 'net::ERR_ABORTED' });
    f.updated.emit(5, { status: 'loading' }, { ...f.tab, status: 'loading' });
    f.updated.emit(5, { status: 'complete' }, f.tab);
    return {};
  } }), { code: 'TOOL_TIMEOUT' });
});

test('a replacement navigation invalidates an error snapshot and late old failure events', async () => {
  const f = fixture(); let frameReads = 0;
  const readFrame = chrome.webNavigation.getFrame;
  const result = await f.run('wait_for_navigation', { timeout: 0.5, trigger: { name: 'click' } }, { async invokeTool() {
    f.frame.errorOccurred = true; f.frame.documentId = 'failed-document';
    f.before.emit({ tabId: 5, frameId: 0, url: f.tab.url, timeStamp: 10 });
    f.failed.emit({ tabId: 5, frameId: 0, url: f.tab.url, timeStamp: 20, documentId: 'failed-document', error: 'net::ERR_EMPTY_RESPONSE' });
    chrome.webNavigation.getFrame = async () => {
      const snapshot = await readFrame();
      if (++frameReads === 1) {
        f.before.emit({ tabId: 5, frameId: 0, url: f.tab.url, timeStamp: 30 });
        f.frame.errorOccurred = false; f.frame.documentId = 'replacement';
        f.committed.emit({ tabId: 5, frameId: 0, url: f.tab.url, timeStamp: 40, documentId: 'replacement' });
        f.failed.emit({ tabId: 5, frameId: 0, url: f.tab.url, timeStamp: 20, documentId: 'failed-document', error: 'late old failure' });
      }
      return snapshot;
    };
    return {};
  } });
  assert.equal(result.status, 'navigated');
  assert.ok(frameReads >= 2);
  assert.equal(f.failed.size, 0);
});

test('trigger failures win over observed success or failure, and all listeners are removed', async () => {
  for (const observedFailure of [false, true]) for (const code of ['ACTION_FAILED', 'TOOL_TIMEOUT']) {
    const f = fixture(), failure = { code, message: 'Click failed', hint: 'Inspect first', details: { executed: false, pending: 'element readiness' } };
    await assert.rejects(f.run('wait_for_navigation', { trigger: { name: 'click' } }, { async invokeTool() {
      if (observedFailure) f.removed.emit(5); else f.history.emit({ tabId: 5, frameId: 0 });
      await Promise.resolve(); throw failure;
    } }), error => error === failure);
    assert.equal(f.updated.size, 0); assert.equal(f.removed.size, 0);
  }
});

test('a navigation deadline preserves the completed trigger and its public identity without replay', async () => {
  const f = fixture(), locator = { role: 'button', name: 'Save' }; let invoked = 0;
  await assert.rejects(f.run('wait_for_navigation', { timeout: 0.01, trigger: {
    name: 'act_on_element', args: { tabRef: 'page', locator, action: 'click', value: 'private input', tabId: 5 },
  } }, { async invokeTool() { invoked++; return {}; } }), error => {
    assert.equal(error.code, 'TOOL_TIMEOUT');
    assert.deepEqual(error.details, { tabRef: 'page', timeout: 0.01, locator, action: 'click',
      tool: 'act_on_element', pending: 'wait_for_navigation', executed: true, mayHaveTakenEffect: true, automaticReplay: false });
    assert.doesNotMatch(JSON.stringify(error), /private input|tabId/);
    return true;
  });
  assert.equal(invoked, 1); assert.equal(f.updated.size, 0); assert.equal(f.removed.size, 0);
});

test('trigger timeout identity uses its explicit page rather than the observed page', async () => {
  const locator = { role: 'button', name: 'Save' };
  for (const tabRef of ['action-page', 7, undefined]) {
    let invoked = 0, disposed = 0;
    const waiting = runWaitWithTrigger({ tool: 'wait_for_navigation', timeoutMs: 10,
      context: { requestedTabRef: 'observed-page', invokeTool: async () => { invoked++; return {}; } },
      details: { tabRef: 'observed-page', url: 'https://example.test/observed' },
      trigger: { name: 'act_on_element', args: { tabRef, tabId: 987, locator, action: 'click' } },
    }, () => ({ result: new Promise(() => {}), dispose() { disposed++; } }));
    await assert.rejects(waiting, error => {
      assert.deepEqual(error.details, { ...(tabRef === undefined ? {} : { tabRef }),
        url: 'https://example.test/observed', timeout: 0.01, locator, action: 'click',
        tool: 'act_on_element', pending: 'wait_for_navigation', executed: true, mayHaveTakenEffect: true, automaticReplay: false });
      assert.doesNotMatch(JSON.stringify(error), /observed-page|tabId|987/);
      return true;
    });
    assert.equal(invoked, 1); assert.equal(disposed, 1);
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

test('element readiness deadlines identify the unresolved locator', async () => {
  const f = fixture(), locator = { role: 'button', name: 'Save' }; f.state(false, false);
  await assert.rejects(f.run('wait_for_element', { locator, timeout: 0.01 }), error => {
    assert.equal(error.code, 'TOOL_TIMEOUT');
    assert.deepEqual(error.details, { tabRef: 'page', locator, timeout: 0.01 });
    return true;
  });
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
    await assert.rejects(waiting, error => {
      assert.equal(error.code, cancel ? 'OPERATION_ABORTED' : 'TOOL_TIMEOUT');
      if (!cancel) {
        assert.equal(error.details.executed, undefined, 'an unresolved action cannot claim confirmed execution');
        assert.equal(error.details.mayHaveTakenEffect, true);
        assert.equal(error.details.automaticReplay, false);
        assert.equal(error.details.pending, 'probe');
      }
      return true;
    });
    assert.equal(disposed, 1);
  }
});

test('an observer that finishes arming after timeout is disposed without invoking its action', async () => {
  let ready, disposed = 0, invoked = 0;
  const waiting = runWaitWithTrigger({ tool: 'late-arm', timeoutMs: 10, trigger: { name: 'click' },
    context: { invokeTool: async () => { invoked++; } },
  }, () => new Promise(resolve => { ready = resolve; }));
  await assert.rejects(waiting, error => {
    assert.equal(error.code, 'TOOL_TIMEOUT');
    assert.equal(error.details.executed, false);
    assert.equal(error.details.mayHaveTakenEffect, false);
    assert.equal(error.details.automaticReplay, false);
    return true;
  });
  let rejectLate;
  ready({ result: new Promise((_, reject) => { rejectLate = reject; }), dispose() { disposed++; rejectLate(new Error('late observer cancelled')); } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(disposed, 1); assert.equal(invoked, 0);
});
