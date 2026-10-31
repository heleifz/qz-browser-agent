import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { chromium } from 'playwright';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildExtension } from '../../scripts/build-extension.mjs';
import { auditReviewableCode } from '../../scripts/check-reviewable-code.mjs';

let browser, directory, firefoxPageCommand, outputDir;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'qz-firefox-input-'));
  ({ outputDir } = await buildExtension({ browser: 'firefox', mode: 'production', outputDir: join(directory, 'extension') }));
  ({ firefoxPageCommand } = await import(pathToFileURL(join(outputDir, 'background/firefox/page-command.js'))));
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
