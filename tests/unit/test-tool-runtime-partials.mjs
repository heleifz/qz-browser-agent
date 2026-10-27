import assert from 'node:assert/strict';
import test from 'node:test';
import { runToolWithTimeout } from '../../src/background/tools/tool-timeout.js';

const never = () => new Promise(() => {});
const context = { sessionId: 'partials', runId: 'run', workingTabId: 1 };
const partialResult = async partial => ({ ...partial.result, incomplete: { reason: 'timeout', pending: partial.pending } });

test('deadline retains an immutable per-call partial and rejects late updates', async () => {
  let report, signal;
  const value = { rows: [1] };
  const result = await runToolWithTimeout('read', async (s, publish) => {
    signal = s; report = publish; publish(value, 'remaining rows'); value.rows.push(2); return never();
  }, undefined, 15, partialResult, context);
  assert.deepEqual(result, { rows: [1], incomplete: { reason: 'timeout', pending: 'remaining rows' } });
  assert.equal(signal.aborted, true); assert.equal(signal.reason.code, 'TOOL_TIMEOUT');
  report({ rows: [3] }, 'late'); assert.deepEqual(result.rows, [1]);
  await assert.rejects(runToolWithTimeout('other', never, undefined, 15, partialResult, context), { code: 'TOOL_TIMEOUT' });
});

test('cancellation and security failures retain their original errors despite a partial', async () => {
  for (const timeout of [0, 100]) {
    const controller = new AbortController();
    const run = runToolWithTimeout('read', async (_signal, publish) => {
      publish({ text: 'partial' }, 'rest'); controller.abort(); return never();
    }, controller.signal, timeout, partialResult, context);
    await assert.rejects(run, { code: 'OPERATION_ABORTED' });
  }
  await assert.rejects(runToolWithTimeout('read', async (_signal, publish) => {
    publish({ text: 'partial' }, 'rest'); throw Object.assign(new Error('blocked'), { code: 'SECURITY_GUARDRAIL_BLOCKED' });
  }, undefined, 100, partialResult, context), { code: 'SECURITY_GUARDRAIL_BLOCKED' });
});

let tabs = new Map(), created = 1, removed = [], updates = [], contentCalls = 0, redirectBlocked = false, probeBusy = false;
const listeners = new Set();
function reset() {
  tabs = new Map([[1, { id: 1, windowId: 2, url: 'https://example.test/old', title: 'Article', status: 'loading' }]]);
  removed = []; updates = []; contentCalls = 0; redirectBlocked = false; probeBusy = false;
}
reset();
globalThis.chrome = {
  runtime: { getURL: path => `chrome-extension://test/${path}` },
  storage: { local: { async get() { return { securityGuardrails: { blockedDomains: ['blocked.test'] } }; } } },
  tabs: {
    async get(id) { if (!tabs.has(id)) throw new Error('No tab'); return { ...tabs.get(id) }; },
    async create(options) { const tab = { id: ++created, windowId: 2, status: 'loading', title: '', ...options }; tabs.set(tab.id, tab); return tab; },
    async remove(id) { removed.push(id); tabs.delete(id); },
    async update(id, update) {
      const tab = tabs.get(id); if (!tab) throw new Error('No tab');
      if (update.url) { tab.pendingUrl = redirectBlocked ? 'https://blocked.test/' : update.url; tab.status = 'loading'; }
      return { ...tab };
    },
    onUpdated: { addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener) },
    async sendMessage(_id, message) {
      if (message.action === 'ping') return { ok: true };
      contentCalls++; return never();
    },
  },
  scripting: { async executeScript(options) {
    if (probeBusy) return never();
    const tab = tabs.get(options.target.tabId);
    return [{ documentId: 'doc', result: { readyState: 'interactive', title: tab.title, url: tab.url, observedAt: 1 } }];
  } },
};
const { createToolRuntime, defineTool } = await import('../../src/background/tools/runtime.js');
const runtime = createToolRuntime({
  windowTarget: { resolveForNewTab: async () => 2 },
  sessions: {
    isRunCurrent: () => true,
    async resolveTargetTab({ tabId }) { return tabs.has(tabId) ? { ok: true, tabId, ownedByCurrentTask: true } : { ok: false, code: 'SESSION_TAB_UNAVAILABLE' }; },
    async updateWorkingTab(value) { updates.push(value); return { ok: true }; },
    listOwnedTabIds: () => [...tabs.keys()],
  },
});

test('read_article and find_elements retain actual page state when synchronous extraction stalls', async () => {
  for (const name of ['read_article', 'find_elements']) {
    reset();
    const result = await runtime.execute(name, { tabId: 1, limit: 100, timeout: 0.01 }, undefined, { ...context, preserveWorkingTab: true });
    assert.equal(result.incomplete.reason, 'timeout');
    assert.equal(result.pageState.readyState, 'interactive');
    assert.equal(result.pageState.url, 'https://example.test/old');
    assert.equal(result.pageState.title, 'Article');
    assert.equal(result.text, undefined); assert.equal(contentCalls, 1); assert.equal(updates.length, 0);
  }
});

test('open_tab and navigate retain a loading tab and its current URL on the existing timeout', async () => {
  for (const name of ['open_tab', 'navigate']) {
    reset();
    const result = await runtime.execute(name, { url: 'https://example.test/new', ...(name === 'navigate' ? { tabId: 1 } : {}), timeout: 0.01 }, undefined, context);
    assert.equal(result.incomplete.reason, 'timeout'); assert.equal(result.loading, true);
    assert.equal(result.url, name === 'open_tab' ? 'about:blank' : 'https://example.test/old');
    assert.equal(result.pageState.pendingUrl, 'https://example.test/new');
    assert.ok(tabs.has(result.tabId)); assert.deepEqual(removed, []); assert.equal(listeners.size, 0);
  }
});

test('open_tab cancellation and blocked timeout redirects still remove the created tab', async () => {
  reset();
  const controller = new AbortController();
  const run = runtime.execute('open_tab', { url: 'https://example.test/new' }, controller.signal, context);
  while (tabs.size < 2 || !tabs.get(created)?.pendingUrl) await new Promise(resolve => setTimeout(resolve, 2));
  controller.abort(); await assert.rejects(run, { code: 'OPERATION_ABORTED' });
  assert.ok(removed.includes(created));
  reset(); redirectBlocked = true;
  await assert.rejects(runtime.execute('open_tab', { url: 'https://example.test/new', timeout: 0.01 }, undefined, context), { code: 'SECURITY_GUARDRAIL_BLOCKED' });
  assert.ok(removed.includes(created));
});

test('side-effect timeout reports an unconfirmed attempt without replay', async () => {
  reset();
  const result = await runtime.execute('act_on_element', { tabId: 1, target: 'css:button', action: 'click', timeout: 0.01 }, undefined, context);
  assert.equal(result.incomplete.reason, 'timeout'); assert.equal(result.status, 'unconfirmed');
  assert.equal(result.mayHaveTakenEffect, true); assert.equal(result.automaticReplay, false);
  assert.equal(contentCalls, 1);
});

defineTool({ name: '__partial_read', description: 'Synthetic staged read', parameters: { type: 'object', properties: {} },
  timeout: 20, behavior: { timeoutResult: { kind: 'read', pending: 'read' } },
  execute: async (_args, _signal, ctx) => {
    ctx.reportPartial({ tabId: 1, text: 'old content', pageState: { documentId: 'old', url: 'https://example.test/old' } }, 'child frames');
    return never();
  },
});
test('timeout rejects closed tabs and drops content from an obsolete document', async () => {
  reset();
  const result = await runtime.execute('__partial_read', {}, undefined, context);
  assert.equal(result.text, undefined); assert.equal(result.incomplete.pending, 'current document content');
  const run = runtime.execute('__partial_read', {}, undefined, context);
  await new Promise(resolve => setTimeout(resolve, 5)); tabs.delete(1);
  await assert.rejects(run, { code: 'SESSION_TAB_UNAVAILABLE' });
});
