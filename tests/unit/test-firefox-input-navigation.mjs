import assert from 'node:assert/strict';
import test from 'node:test';
import { registerPageElementTools } from '../../src/capabilities/page/tools.js';
import { installFirefoxDebugger } from '../../src/background/firefox/debugger-host.js';
import { createCdpRuntime } from '../../src/background/tools/cdp-runtime.js';
import { ToolExecutionError } from '../../src/background/tools/arguments.js';
import { pageDialogStub } from '../support/page-dialog-stub.mjs';

const MISSING = 'Missing host permission for the tab';
const BEFORE = 'http://127.0.0.1/form.html';
const AFTER = 'http://127.0.0.1/fast.html';
function event() {
  const listeners = new Set();
  return { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn),
    emit: (...args) => { for (const fn of listeners) fn(...args); } };
}

// Real page action, keyboard, CDP lease and Firefox adapter. Only browser APIs and
// Content replies are simulated; no Firefox 151 behavior substitutes for 158.
function fixture(t, { fault = '', navigation = true, sameUrl = false, failCount = 1, interrupt = '',
  commitDelay = 0, message = MISSING } = {}) {
  const previous = globalThis.chrome;
  t.after(() => { globalThis.chrome = previous; });
  const controller = new AbortController();
  const trace = [], submissions = [], keys = [];
  let value = '', committed = false, removed = false, current = true, failures = 0, execute, method = '', finishProbe;
  const timers = new Set();
  const later = (fn, ms) => { const timer = setTimeout(fn, ms); timers.add(timer); };
  t.after(() => { for (const timer of timers) clearTimeout(timer); });
  const api = {
    runtime: { getURL: () => 'moz-extension://fixture/', onMessage: event() },
    storage: { local: { async get() { return {}; } } },
    tabs: { onUpdated: event(), onRemoved: event(), async get() {
      if (removed) throw new Error('No tab with id: 7');
      return { id: 7, url: committed && !sameUrl ? AFTER : BEFORE, title: committed ? 'After' : 'Before', status: 'complete' };
    } },
    webNavigation: { onCommitted: event(), async getAllFrames() {
      return [{ frameId: 0, parentFrameId: -1, url: (await api.tabs.get()).url }];
    } },
    scripting: { async executeScript({ args }) {
      const command = args?.[0], op = command?.op, input = command?.input;
      const stage = op === 'inputFrame' && method === 'Input.dispatchKeyEvent' ? (keys.length ? 'keyup-route' : 'prepare')
        : op === 'input' && input?.kind === 'key' ? (input.type === 'keyUp' ? 'keyup-input' : 'keydown-response')
          : typeof command === 'string' && args[1] === false ? 'receipt' : !args ? 'observation' : op || 'other';
      trace.push(stage);
      if (op === 'input' && input?.kind === 'text') value = input.text;
      if (op === 'input' && input?.kind === 'key') {
        keys.push(input.type);
        if (input.type !== 'keyUp') {
          submissions.push(value);
          if (!['keyup-route', 'keyup-input'].includes(fault)) commit();
        }
      }
      if (stage === fault && (stage !== 'observation' || keys.length) && failures++ < failCount) {
        if (interrupt === 'defer') return new Promise(resolve => { finishProbe = () => resolve([{ frameId: 0, result: {} }]); });
        if (keys.length) commit();
        const revoke = () => {
          if (interrupt.startsWith('abort')) controller.abort(new ToolExecutionError('OPERATION_ABORTED', 'cancelled'));
          if (interrupt.startsWith('close')) { removed = true; api.tabs.onRemoved.emit(7); }
          if (interrupt.startsWith('run')) current = false;
        };
        if (interrupt.endsWith('-later')) later(revoke, 10); else revoke();
        throw new Error(message);
      }
      if (stage === fault && interrupt === 'hang' && failures > 1) return new Promise(() => {});
      return [{ frameId: 0, documentId: committed ? 'after' : 'before', result: op ? {}
        : args ? (args[1] ? 0 : 1) : { width: 800, height: 600 } }];
    } },
  };
  function commit() {
    if (!navigation || committed) return;
    const publish = () => {
      committed = true;
      api.webNavigation.onCommitted.emit({ tabId: 7, frameId: 0, url: sameUrl ? BEFORE : AFTER });
      api.tabs.onUpdated.emit(7, { status: 'complete', url: sameUrl ? BEFORE : AFTER });
    };
    if (commitDelay) later(publish, commitDelay); else publish();
  }
  globalThis.chrome = api;
  installFirefoxDebugger(api);
  for (const name of ['sendCommand', 'sendCommandWithScope']) {
    const original = api.debugger[name]?.bind(api.debugger);
    if (original) api.debugger[name] = (target, command, ...args) => { method = command; return original(target, command, ...args); };
  }
  const cdp = createCdpRuntime({ ToolExecutionError, debuggerApi: api.debugger, isRunCurrent: () => current });
  const context = { sessionId: 'owner', runId: 'run', signal: controller.signal, runProfile: { platform: { os: 'mac' } } };
  const inspect = () => ({ tag: 'input', type: 'text', editable: true, focused: true, visible: true, value,
    clickablePoint: { x: 10, y: 10 }, inViewport: true });
  const content = async (_tabId, action) => {
    if (action === 'releaseElementFill' && fault === 'release') throw new Error(MISSING);
    if (action === 'refreshElementFill') return { element: inspect(), refill: false };
    return { ...inspect(), ...(action === 'prepareElementFill' ? { fillMode: 'text' } : {}) };
  };
  api.tabs.sendMessage = async () => ({});
  registerPageElementTools({
    ...pageDialogStub, ToolExecutionError,
    registerTool(definition) { if (definition.name === 'act_on_element') execute = definition.execute; },
    resolveElementReference: async (tabId, { target, index }) => ({ tabId, target, index, selector: '#q' }),
    elementTargetForSelector: selector => `css:${selector}`, getElementTargetDescription: () => 'fixture',
    sendToContent: content, getPageContext: () => ({ pageMode: 'desktop' }), clickPointReady: () => true,
    getTabPageState: async () => ({ url: BEFORE, title: 'Before' }),
    pageStateDelta: (before, after) => ({ pageBefore: before, pageAfter: after,
      urlChanged: before.url !== after.url, titleChanged: before.title !== after.title }),
    prepareKnownPageNavigation: async () => null, commitObservedPageNavigation: () => null,
    getDebuggerConnectionId: cdp.getDebuggerConnectionId, sendCdp: cdp.sendCdp, withDebugger: cdp.withDebugger,
  });
  t.after(() => cdp.releaseSession('owner'));
  return { trace, keys, submissions, get failures() { return failures; }, get finishProbe() { return finishProbe; },
    abort: () => controller.abort(new ToolExecutionError('OPERATION_ABORTED', 'cancelled')),
    call: action => execute({ tabId: 7, target: 'css:#q', action, value: 'one', submit: true, key: 'Enter' }, controller.signal, context) };
}

for (const action of ['fill', 'press']) {
  for (const fault of ['keyup-route', 'keyup-input', 'keydown-response']) {
    for (const sameUrl of [false, true]) test(`Firefox ${action}: ${fault} after ${sameUrl ? 'same-URL commit' : 'navigation'} preserves one submission`, async t => {
      const f = fixture(t, { fault, sameUrl });
      const result = await f.call(action);
      assert.equal(result.error, undefined);
      assert.equal(result.navigated, true);
      assert.equal(result.pageAfter.url, sameUrl ? BEFORE : AFTER);
      assert.equal(action === 'fill' ? result.submitDispatched : result.pressed, true);
      assert.equal(f.submissions.length, 1);
      assert.equal(f.keys.filter(type => type !== 'keyUp').length, 1, 'never replay Enter');
    });
  }
  test(`Firefox ${action}: transient read-only input-frame failures retry before dispatch`, async t => {
    const f = fixture(t, { fault: 'prepare', failCount: 2 });
    const result = await f.call(action);
    assert.equal(result.navigated, true);
    assert.ok(f.failures >= 2);
    assert.equal(f.submissions.length, 1);
  });
  test(`Firefox ${action}: delayed commit confirms a lost keyDown response without replay`, async t => {
    const f = fixture(t, { fault: 'keydown-response', commitDelay: 120 });
    const result = await f.call(action);
    assert.equal(result.navigated, true);
    assert.equal(f.submissions.length, 1);
  });
  test(`Firefox ${action}: unrelated input errors are not hidden by navigation`, async t => {
    const f = fixture(t, { fault: 'keydown-response', message: 'unrelated failure' });
    await assert.rejects(f.call(action), /unrelated failure/);
    assert.equal(f.submissions.length, 1);
  });
  for (const fault of ['receipt', 'observation', 'release']) test(`Firefox ${action}: ${fault} failure after input keeps navigation results`, async t => {
    const f = fixture(t, { fault });
    const result = await f.call(action);
    assert.equal(result.navigated, true);
    assert.equal(f.submissions.length, 1);
  });
  for (const fault of ['keyup-route', 'keyup-input', 'keydown-response']) test(`Firefox ${action}: ${fault} without navigation does not invent success or replay`, async t => {
    const f = fixture(t, { fault, navigation: false, failCount: Infinity });
    await assert.rejects(f.call(action), new RegExp(MISSING));
    assert.equal(f.submissions.length, 1);
  });
  for (const interrupt of ['abort', 'close', 'run', 'abort-later', 'close-later', 'run-later']) {
    for (const fault of ['prepare', 'keydown-response']) test(`Firefox ${action}: ${interrupt} during ${fault} revokes recovery`, async t => {
      const f = fixture(t, { fault, interrupt, failCount: Infinity, navigation: !interrupt.endsWith('-later') });
      await assert.rejects(f.call(action));
      const count = f.trace.length;
      await new Promise(resolve => setTimeout(resolve, 70));
      assert.equal(f.trace.length, count, 'no late probes or input after revocation');
      assert.equal(f.submissions.length, fault === 'prepare' ? 0 : 1);
    });
  }
  test(`Firefox ${action}: cancelling an in-flight frame probe prevents input after its late reply`, { timeout: 1500 }, async t => {
    const f = fixture(t, { fault: 'prepare', interrupt: 'defer' });
    const pending = f.call(action);
    const rejected = assert.rejects(pending);
    await new Promise(setImmediate);
    assert.equal(typeof f.finishProbe, 'function');
    f.abort();
    await rejected;
    const count = f.trace.length;
    f.finishProbe();
    await new Promise(setImmediate);
    assert.equal(f.trace.length, count);
    assert.equal(f.submissions.length, 0);
  });
  for (const interrupt of ['', 'hang']) test(`Firefox ${action}: ${interrupt ? 'stalled retry' : 'permanent permission denial'} is bounded before any input`, { timeout: 2500 }, async t => {
    const f = fixture(t, { fault: 'prepare', failCount: interrupt ? 1 : Infinity, interrupt });
    const started = Date.now();
    await assert.rejects(f.call(action), new RegExp(MISSING));
    assert.ok(Date.now() - started < 2000, 'retry budget is at most one second');
    assert.equal(f.submissions.length, 0);
    assert.ok(f.trace.filter(stage => stage === 'prepare').length <= 25, 'bounded probe count');
  });
}
