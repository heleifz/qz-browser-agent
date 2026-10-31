import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { chromium } from 'playwright';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildExtension } from '../../scripts/build-extension.mjs';
import { auditReviewableCode } from '../../scripts/check-reviewable-code.mjs';

let browser, directory, firefoxPageCommand, installFirefoxDebugger, outputDir;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'qz-firefox-input-'));
  ({ outputDir } = await buildExtension({ browser: 'firefox', mode: 'production', outputDir: join(directory, 'extension') }));
  ({ firefoxPageCommand } = await import(pathToFileURL(join(outputDir, 'background/firefox/page-command.js'))));
  ({ installFirefoxDebugger } = await import(pathToFileURL(join(outputDir, 'background/firefox/debugger-host.js'))));
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await rm(directory, { recursive: true, force: true }); });

test('Firefox production package retains implicit submission and only reviewed execution sinks', async () => {
  const source = await readFile(join(outputDir, 'background/firefox/page-command.js'), 'utf8');
  assert.match(source, /implicitSubmit/);
  const findings = (await auditReviewableCode(outputDir)).flatMap(item => item.findings);
  assert.deepEqual(findings.filter(item => !item.reviewed), []);
  assert.equal(findings.filter(item => item.rule === 'dynamic-code' && item.file === 'background/firefox/page-command.js').length, 1);
});

for (const crossOrigin of [false, true]) test(`Firefox frame sessions bind and click child nodes (crossOrigin=${crossOrigin})`, async t => {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.setContent('<button id=outer>Outer</button><iframe style="display:block;margin:20px;border:3px solid" srcdoc="<button id=inner>Inner</button>"></iframe>');
  const child = page.frames().find(frame => frame !== page.mainFrame());
  await child.waitForSelector('#inner');
  const frames = new Map([[0, page.mainFrame()], [7, child]]);
  for (const frame of frames.values()) await frame.evaluate(() => {
    globalThis.chrome = { runtime: { id: 'frame-test' } };
    globalThis.__qzInvoke = (node, payload) => {
      if (!node?.isConnected || node.ownerDocument !== document) return { code: 'STALE_ELEMENT_UID' };
      return { id: node.id, action: payload.action };
    };
    window.clicks = [];
    document.addEventListener('click', event => clicks.push(event.target.id));
  });
  const events = [], injections = [];
  let committed;
  const api = {
    runtime: { id: 'frame-test', onMessage: { addListener() {} } },
    tabs: { async get() { return { url: 'http://127.0.0.1/outer' }; } },
    webNavigation: {
      onCommitted: { addListener(listener) { committed = listener; } },
      async getAllFrames() { return [
        { frameId: 0, parentFrameId: -1, url: 'http://127.0.0.1/outer' },
        { frameId: 7, parentFrameId: 0, url: crossOrigin ? 'http://localhost/inner' : 'http://127.0.0.1/inner' },
      ]; },
    },
    scripting: { async executeScript({ target, func, args }) {
      if (func.name !== 'firefoxPageCommand') return [{ result: undefined }];
      injections.push({ frameId: target.frameIds[0], op: args[0].op });
      const result = await frames.get(target.frameIds[0]).evaluate(async ({ source, args }) => {
        const command = (0, eval)(`(${source})`);
        return command(...args);
      }, { source: func.toString(), args });
      return [{ result }];
    } },
  };
  installFirefoxDebugger(api);
  const send = (method, params = {}, sessionId) => api.debugger.sendCommand({ tabId: 5, ...(sessionId ? { sessionId } : {}) }, method, params);
  api.debugger.onEvent.addListener((source, method, params) => events.push({ source, method, params }));
  await api.debugger.attach({ tabId: 5 });
  await send('Target.setAutoAttach', { autoAttach: true });
  await send('Runtime.enable');
  const session = events.find(event => event.method === 'Target.attachedToTarget').params.sessionId;
  assert.equal(session, 'ff-5-7');
  const context = events.find(event => event.method === 'Runtime.executionContextCreated'
    && event.source.sessionId === session && event.params.context.auxData.type === 'isolated').params.context;
  assert.equal(context.auxData.frameId, '7');
  assert.deepEqual((await send('Page.getFrameTree')).frameTree.childFrames, []);
  assert.equal((await send('Page.getFrameTree', {}, session)).frameTree.frame.id, '7');
  const outer = await send('Accessibility.getFullAXTree');
  assert.equal(outer.nodes.some(node => node.name?.value === 'Inner'), false);
  const tree = await send('Accessibility.getFullAXTree', {}, session);
  const button = tree.nodes.find(node => node.name?.value === 'Inner');
  assert.ok(button.backendDOMNodeId);
  const { object } = await send('DOM.resolveNode', { backendNodeId: button.backendDOMNodeId, executionContextId: context.id, objectGroup: 'test' }, session);
  const { ISOLATED_CONTENT_INVOKE } = await import('../../src/background/tools/isolated-page-calls.js');
  const result = await send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: ISOLATED_CONTENT_INVOKE,
    arguments: [{ value: { action: 'inspectElement' } }], returnByValue: true }, session);
  assert.deepEqual(result.result.value, { id: 'inner', action: 'inspectElement' });
  // Page tools dispatch in root coordinates even when the bound node is in a frame.
  const point = await page.evaluate(() => {
    const frame = document.querySelector('iframe'), outer = frame.getBoundingClientRect();
    const inner = frame.contentDocument.querySelector('button').getBoundingClientRect();
    return { x: outer.x + frame.clientLeft + inner.x + inner.width / 2, y: outer.y + frame.clientTop + inner.y + inner.height / 2 };
  });
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
  assert.deepEqual(await child.evaluate(() => clicks), ['inner']);
  assert.deepEqual(await page.evaluate(() => clicks), []);
  assert.ok(injections.some(entry => entry.frameId === 7 && entry.op === 'input'));
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left' });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: -1, y: -1, button: 'left' });
  assert.equal(await child.evaluate(() => __qzFirefoxPage.mouseTarget), null);
  assert.deepEqual(await child.evaluate(() => clicks), ['inner'], 'cleanup releases the child without clicking again');
  const before = (await send('Page.getFrameTree', {}, session)).frameTree.frame.loaderId;
  committed({ tabId: 5, frameId: 7, url: 'http://127.0.0.1/replaced' });
  assert.notEqual((await send('Page.getFrameTree', {}, session)).frameTree.frame.loaderId, before);
  assert.ok(events.some(event => event.method === 'Runtime.executionContextDestroyed' && event.source.sessionId === session));
  await send('Runtime.releaseObjectGroup', { objectGroup: 'test' }, session);
  await api.debugger.detach({ tabId: 5 });
});

const cases = [
  { name: 'default button', html: '<form><input id=q><button id=send>Go</button></form>', submit: 'send' },
  { name: 'external first default', html: '<button form=f id=first>Go</button><form id=f><input id=q><button id=second>Later</button></form>', submit: 'first' },
  { name: 'input submit', html: '<form><input id=q><input id=send type=submit></form>', submit: 'send' },
  { name: 'input image', html: '<form><input id=q><input id=send type=image></form>', submit: 'send' },
  { name: 'single field no button', html: '<form><input id=q></form>', submit: '' },
  { name: 'two fields no button', html: '<form><input id=q><input type=number></form>', submit: null },
  { name: 'external blocking field', html: '<input form=f type=date><form id=f><input id=q></form>', submit: null },
  { name: 'disabled default before enabled button', html: '<form><input id=q><button disabled>Stop</button><button>Go</button></form>', submit: null },
  { name: 'fieldset disabled default', html: '<form><input id=q><fieldset disabled><button>Stop</button></fieldset><button>Go</button></form>', submit: null },
  { name: 'keydown cancelled', html: '<form><input id=q><button>Go</button></form>', prevent: 'keydown', submit: null },
  { name: 'keypress cancelled', html: '<form><input id=q><button>Go</button></form>', prevent: 'keypress', submit: null },
  { name: 'default click cancelled', html: '<form><input id=q><button>Go</button></form>', prevent: 'click', submit: null },
  { name: 'validation retained', html: '<form><input id=q required><button>Go</button></form>', submit: null },
  { name: 'textarea newline', html: '<form><textarea id=q></textarea><button>Go</button></form>', submit: null, newline: true },
  { name: 'contenteditable newline', html: '<form><div id=q contenteditable></div><button>Go</button></form>', submit: null, newline: true },
  { name: 'no form JS key listener', html: '<input id=q>', submit: null },
  { name: 'checkbox does not submit', html: '<form><input id=q type=checkbox><button>Go</button></form>', submit: null },
  { name: 'select does not submit', html: '<form><select id=q><option>One</option></select><button>Go</button></form>', submit: null },
  ...[1, 2, 4, 8].map(modifiers => ({ name: `modified Enter ${modifiers}`, modifiers,
    html: '<form><input id=q><button>Go</button></form>', submit: null })),
];
for (const scenario of cases) test(`Firefox implicit submission: ${scenario.name}`, async t => {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.setContent(scenario.html);
  await page.evaluate(scenario => {
    window.events = [];
    for (const type of ['keydown', 'keypress', 'keyup', 'click', 'submit']) document.addEventListener(type, event => {
      events.push({ type, id: event.target.id, submitter: event.submitter?.id || '', trusted: event.isTrusted });
      if (type === 'submit' || type === scenario.prevent) event.preventDefault();
    }, true);
    document.querySelector('#q').focus();
  }, scenario);
  for (const type of ['keyDown', 'keyUp']) await page.evaluate(firefoxPageCommand, {
    op: 'input', input: { kind: 'key', type, key: 'Enter', code: 'Enter', text: type === 'keyDown' ? '\r' : '', modifiers: scenario.modifiers || 0 },
  });
  const state = await page.evaluate(() => ({ events, text: q.value ?? q.innerText }));
  const submits = state.events.filter(event => event.type === 'submit');
  assert.deepEqual(submits.map(event => event.submitter), scenario.submit === null ? [] : [scenario.submit]);
  assert.equal(state.events.filter(event => event.type === 'keydown').length, 1);
  assert.equal(state.events.filter(event => event.type === 'keyup').length, 1);
  assert.equal(state.events.filter(event => event.type === 'keypress').length, scenario.prevent === 'keydown' || scenario.modifiers ? 0 : 1);
  if (scenario.newline) assert.ok(state.text.includes('\n'), JSON.stringify(state));
  if (scenario.submit) assert.deepEqual(state.events.filter(event => event.type === 'click').map(event => event.id), [scenario.submit]);
});
