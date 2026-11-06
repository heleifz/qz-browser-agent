#!/usr/bin/env node
import { mkdir, appendFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const name = process.argv[i];
  if (!['--cdp', '--extension-id', '--origin', '--out', '--duration'].includes(name) || !process.argv[i + 1]) {
    throw new Error('Usage: node capture-popup.mjs --cdp http://127.0.0.1:9229 --extension-id ID --origin http://127.0.0.1:8870 --out PATH --duration 180');
  }
  options[name.slice(2)] = process.argv[i + 1];
}
const endpoint = new URL(options.cdp || 'http://127.0.0.1:9229');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) throw new Error('CDP endpoint must use loopback.');
const extensionId = options['extension-id'] || 'ghbaodmonhcgkfeejcpffknlggbjhjgj';
if (!/^[a-p]{32}$/.test(extensionId)) throw new Error('Invalid extension ID.');
const origin = new URL(options.origin || 'http://127.0.0.1:8870').origin;
const seconds = Number(options.duration || 180);
if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 3600) throw new Error('Duration must be 1–3600 seconds.');
const out = resolve(options.out || `qz-popup-capture-${Date.now()}`);
await mkdir(out, { recursive: true });
const eventsFile = resolve(out, 'events.jsonl');
await writeFile(eventsFile, '');
const hookKey = '__qzPopupCapture_' + randomUUID().replaceAll('-', '');
const bindingName = hookKey + '_event';
const extensionPrefix = `chrome-extension://${extensionId}/`;
let writes = Promise.resolve(), cdp, workerId, workerSession, deadline, hooksInstalled = false;
let stopRequested = false, cleaningUp = false, finish;
const done = new Promise(resolve => { finish = resolve; });
const summary = { startedAt: new Date().toISOString(), endpoint: endpoint.origin, extensionId, origin, durationSeconds: seconds,
  policy: 'Attach only the specified extension service worker. Never auto-attach/resume product pages, drive tasks, reload, or close tabs.',
  command: ['node', 'capture-popup.mjs', '--cdp', endpoint.origin, '--extension-id', extensionId, '--origin', origin, '--out', out, '--duration', String(seconds)],
  status: 'starting', hooksRestored: false, eventCount: 0 };
function record(type, data = {}) {
  summary.eventCount++;
  writes = writes.then(() => appendFile(eventsFile, JSON.stringify({ at: Date.now(), type, data }) + '\n'));
}
function stop(reason) { if (stopRequested) return; stopRequested = true; summary.stopReason = reason; finish(); }
const interrupted = () => stop('SIGINT');
const terminated = () => stop('SIGTERM');
process.once('SIGINT', interrupted); process.once('SIGTERM', terminated);

class CDP {
  constructor(url) {
    this.socket = new WebSocket(url); this.next = 0; this.pending = new Map(); this.targets = new Set();
    this.ready = new Promise((resolve, reject) => { this.socket.addEventListener('open', resolve, { once: true }); this.socket.addEventListener('error', reject, { once: true }); });
    this.socket.addEventListener('close', () => { if (!cleaningUp) { record('cdp.closed'); stop('CDP disconnected'); } for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('CDP disconnected')); } this.pending.clear(); });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id); if (!pending) return;
        clearTimeout(pending.timer); this.pending.delete(message.id);
        message.error ? pending.reject(new Error(JSON.stringify(message.error))) : pending.resolve(message.result);
        return;
      }
      const { method, params = {}, sessionId } = message;
      if (method === 'Runtime.bindingCalled' && sessionId === workerSession && params.name === bindingName) {
        try { const event = JSON.parse(params.payload); record(event.type, event.data); } catch { record('hook.invalidPayload'); }
      }
      const target = params.targetInfo;
      if (target && (target.url.startsWith(extensionPrefix) || target.url.startsWith(origin + '/') || this.targets.has(target.openerId))) this.targets.add(target.targetId);
      if (method.startsWith('Target.') && (this.targets.has(target?.targetId || params.targetId) || params.sessionId === workerSession)) {
        const safe = target?.url && !target.url.startsWith(extensionPrefix) && !target.url.startsWith(origin + '/')
          ? { ...params, targetInfo: { ...target, url: '[outside origin]', title: '[outside origin]' } } : params;
        record('cdp.' + method, safe);
      }
      if (!cleaningUp && (workerId && method === 'Target.targetDestroyed' && params.targetId === workerId ||
          workerSession && method === 'Target.detachedFromTarget' && params.sessionId === workerSession)) {
        record('worker.lost', { workerId, workerSession, method }); stop('Extension worker disappeared or detached; capture stopped without reattaching');
      }
      if (!cleaningUp && workerId && target?.type === 'service_worker' && target.url.startsWith(extensionPrefix) && target.targetId !== workerId) {
        record('worker.replacement', target); stop('Extension worker restarted; capture stopped without reattaching');
      }
    });
  }
  async send(method, params = {}, sessionId) {
    await this.ready;
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error('CDP disconnected');
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, workerSession);
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  }
}

// Runs only in the specified extension's existing worker; no page execution or navigation.
async function installHooks(key, binding, wantedOrigin) {
  const emit = (type, data) => { try { globalThis[binding](JSON.stringify({ type, data })); } catch {} };
  const matches = url => { try { return new URL(url).origin === wantedOrigin; } catch { return false; } };
  const tracked = new Set();
  const safeTab = (tab, page = tab) => {
    const safe = { ...tab };
    for (const key of ['url', 'pendingUrl']) if (safe[key] && safe[key] !== 'about:blank' && !matches(safe[key])) safe[key] = '[outside origin]';
    if (Object.hasOwn(tab, 'title') && (page.url || page.pendingUrl) && (page.url || page.pendingUrl) !== 'about:blank' && !matches(page.url || page.pendingUrl)) safe.title = '[outside origin]';
    return safe;
  };
  const listeners = [];
  const listen = (event, fn) => { event.addListener(fn); listeners.push([event, fn]); };
  const originalGet = chrome.tabs.get, originalRemove = chrome.tabs.remove;
  function get(...args) {
    const failed = error => { emit('tabs.get.rejected', { tabId: args[0], related: tracked.has(args[0]), message: String(error?.message || error), stack: error?.stack }); throw error; };
    try { const result = originalGet.apply(chrome.tabs, args); return result?.catch ? result.catch(failed) : result; }
    catch (error) { return failed(error); }
  }
  function remove(...args) { emit('tabs.remove.request', { tabIds: args[0], stack: new Error().stack }); return originalRemove.apply(chrome.tabs, args); }
  globalThis[key] = { dispose() {
    for (const [event, fn] of listeners) event.removeListener(fn);
    const restored = { get: chrome.tabs.get === get, remove: chrome.tabs.remove === remove };
    if (restored.get) chrome.tabs.get = originalGet;
    if (restored.remove) chrome.tabs.remove = originalRemove;
    delete globalThis[key]; delete globalThis[binding];
    return restored;
  } };
  try {
    chrome.tabs.get = get; chrome.tabs.remove = remove;
    listen(chrome.tabs.onCreated, tab => { if (matches(tab.url || tab.pendingUrl) || tracked.has(tab.openerTabId)) { tracked.add(tab.id); emit('tabs.created', safeTab(tab)); } });
    listen(chrome.tabs.onUpdated, (tabId, change, tab) => { if (tracked.has(tabId) || matches(tab.url || tab.pendingUrl)) { tracked.add(tabId); emit('tabs.updated', { tabId, change: safeTab(change, tab), tab: safeTab(tab) }); } });
    listen(chrome.tabs.onRemoved, (tabId, info) => { if (tracked.has(tabId)) emit('tabs.removed', { tabId, info }); tracked.delete(tabId); });
    listen(chrome.tabs.onReplaced, (addedTabId, removedTabId) => { if (tracked.has(removedTabId)) { tracked.delete(removedTabId); tracked.add(addedTabId); emit('tabs.replaced', { addedTabId, removedTabId }); } });
    for (const name of ['onBeforeNavigate', 'onCommitted', 'onDOMContentLoaded', 'onCompleted', 'onErrorOccurred', 'onCreatedNavigationTarget']) {
      listen(chrome.webNavigation[name], details => {
        if (!tracked.has(details.tabId) && !tracked.has(details.sourceTabId) && !matches(details.url)) return;
        tracked.add(details.tabId); emit('navigation.' + name, details.url && !matches(details.url) && details.url !== 'about:blank' ? { ...details, url: '[outside origin]' } : details);
      });
    }
    listen(chrome.debugger.onDetach, (source, reason) => emit('debugger.detached', { source, reason }));
    listen(chrome.debugger.onEvent, (source, method, params) => {
      if (!tracked.has(source.tabId) || !/^(Target\.|Inspector\.|Page\.frame(?:Detached|Navigated|StartedLoading|StoppedLoading)|Network\.loadingFailed)/.test(method)) return;
      const safe = { ...params };
      for (const key of ['targetInfo', 'frame']) if (safe[key]?.url && !matches(safe[key].url)) safe[key] = { ...safe[key], url: '[outside origin]', title: '[outside origin]', name: undefined };
      emit('debugger.event', { source, method, params: safe });
    });
    const initial = (await chrome.tabs.query({})).filter(tab => matches(tab.url || tab.pendingUrl));
    for (const tab of initial) tracked.add(tab.id);
    emit('tabs.initial', initial.map(safeTab));
    return { initialTabs: initial.length };
  } catch (error) { globalThis[key].dispose(); throw error; }
}
function redactCommandLine(args) {
  const allowed = new Set(['--headless', '--disable-popup-blocking', '--disable-features', '--enable-features', '--proxy-server', '--proxy-bypass-list']);
  return args.filter(arg => allowed.has(arg.split('=')[0])).map(arg => {
    if (!arg.startsWith('--proxy-')) return arg;
    // Discard everything before the last credential separator, including unusual passwords.
    const at = arg.lastIndexOf('@');
    return at < 0 ? arg : arg.slice(0, arg.indexOf('=') + 1) + '[credentials redacted]@' + arg.slice(at + 1);
  });
}
try {
  const version = await fetch(new URL('/json/version', endpoint), { signal: AbortSignal.timeout(10000) }).then(r => r.json());
  cdp = new CDP(version.webSocketDebuggerUrl); await cdp.ready;
  summary.browser = await cdp.send('Browser.getVersion');
  try { summary.commandLine = redactCommandLine((await cdp.send('Browser.getBrowserCommandLine')).arguments); }
  catch (error) { summary.commandLineUnavailable = error.message; }
  await cdp.send('Target.setDiscoverTargets', { discover: true });
  const { targetInfos } = await cdp.send('Target.getTargets');
  const worker = targetInfos.find(target => target.type === 'service_worker' && target.url.startsWith(extensionPrefix));
  if (!worker) throw new Error('The specified extension worker is not running. Open the qz side panel, then start capture again.');
  workerId = worker.targetId;
  workerSession = (await cdp.send('Target.attachToTarget', { targetId: workerId, flatten: true })).sessionId;
  await cdp.send('Runtime.enable', {}, workerSession);
  await cdp.send('Runtime.addBinding', { name: bindingName }, workerSession);
  const installed = await cdp.evaluate(`(${installHooks})(${JSON.stringify(hookKey)},${JSON.stringify(bindingName)},${JSON.stringify(origin)})`);
  hooksInstalled = true; summary.status = 'capturing'; record('capture.ready', installed);
  await writeFile(resolve(out, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`Capture ready. Run the existing qz task normally; output: ${out}`);
  deadline = setTimeout(() => stop('Duration elapsed'), seconds * 1000);
  await done;
} catch (error) { summary.error = error.message; record('capture.error', { message: error.message }); process.exitCode = 1; }
finally {
  cleaningUp = true; clearTimeout(deadline);
  if (hooksInstalled) {
    try { summary.restoration = await cdp.evaluate(`globalThis[${JSON.stringify(hookKey)}]?.dispose()`); summary.hooksRestored = !!summary.restoration?.get && !!summary.restoration?.remove; }
    catch (error) { summary.restorationError = error.message; }
    record('capture.restored', { restored: summary.hooksRestored, detail: summary.restoration, error: summary.restorationError });
  }
  if (workerSession) {
    await cdp.evaluate(`delete globalThis[${JSON.stringify(bindingName)}]`).catch(() => {});
    await cdp.send('Runtime.removeBinding', { name: bindingName }, workerSession).catch(() => {});
    await cdp.send('Target.detachFromTarget', { sessionId: workerSession }).catch(() => {});
  }
  cdp?.socket.close();
  process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', terminated);
  summary.status = summary.error ? 'failed' : 'stopped'; summary.endedAt = new Date().toISOString();
  await writes; await writeFile(resolve(out, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`Capture ended: ${summary.stopReason || summary.error}. Hooks restored: ${summary.hooksRestored}.`);
}
