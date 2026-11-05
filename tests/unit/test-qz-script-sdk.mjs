import assert from 'node:assert/strict';
import test from 'node:test';
import { createQzSdk } from '../../src/shared/qz-script-sdk.js';
import { compileInnerWorker } from '../../scripts/build-extension.mjs';
import { runInnerWorker } from '../support/inner-runner-fixture.mjs';

const fixture = (execute = async () => ({})) => {
  const calls = [];
  return { calls, qz: createQzSdk((name, args) => {
    calls.push({ name, args });
    return execute(name, args);
  }) };
};

test('locators are lazy immutable queries and dispatch a single strict action', async () => {
  const { qz, calls } = fixture();
  const query = { role: 'option', name: '杭州大厦' };
  const page = qz.tab('map');
  const options = page.locator(query);
  const second = options.nth(1);
  query.name = 'changed';
  assert.equal(calls.length, 0);
  await options.click();
  await second.click();
  await page.locator('css:input').fill('杭州大厦');
  assert.deepEqual(calls, [
    { name: 'act_on_element', args: { tabRef: 'map', locator: { role: 'option', name: '杭州大厦' }, action: 'click' } },
    { name: 'act_on_element', args: { tabRef: 'map', locator: { role: 'option', name: '杭州大厦', nth: 1 }, action: 'click' } },
    { name: 'act_on_element', args: { tabRef: 'map', locator: { target: 'css:input' }, action: 'fill', value: '杭州大厦' } },
  ]);
});

test('bound calls reject changes to page, query and positional arguments before dispatch', () => {
  const { qz, calls } = fixture();
  const page = qz.tab('map'), input = page.locator('css:input');
  for (const invoke of [
    () => page.goto('/next', { tabRef: 'other' }),
    () => page.goto('/next', { url: '/override' }),
    () => page.read({ tabId: 8 }),
    () => page.evaluate('() => 1', null, { code: '() => 2' }),
    () => input.click({ target: 'css:button' }),
    () => input.click({ locator: { role: 'button' } }),
    () => input.click({ action: 'fill' }),
    () => input.fill('safe', { value: 'other' }),
    () => input.wait({ index: 3 }),
    () => input.read({ source: 'body' }),
    () => input.click({ waitFor: 'stable' }),
    () => input.click({ waitOptions: { timeout: 3 } }),
    () => input.click({ waitFor: 'navigation', waitOptions: { trigger: {} } }),
    () => input.click({ waitFor: 'popup', waitOptions: { tabRef: 'other' } }),
    () => qz.tab(undefined),
    () => page.locator({}),
    () => input.nth(-1),
  ]) assert.throws(invoke, { code: 'INVALID_ARGUMENTS' });
  assert.equal(calls.length, 0);
});

test('drag binds both ends on the same explicit page', async () => {
  const { qz, calls } = fixture();
  const source = qz.tab('board').locator({ role: 'listitem', name: 'Task' });
  const destination = qz.tab('board').locator('css:#done');
  await source.dragTo(destination);
  assert.deepEqual(calls[0].args.destination, { locator: { target: 'css:#done' } });
  assert.throws(() => source.dragTo(qz.tab('other').locator('css:#done')), { code: 'INVALID_ARGUMENTS' });
  assert.throws(() => source.dragTo({}), { code: 'INVALID_ARGUMENTS' });
  assert.equal(calls.length, 1);
});

test('event actions compile one armed trigger and preserve the waited business value', async () => {
  const popup = { tabRef: 'receipt', url: 'https://fixture.test/receipt', title: 'Receipt', active: false };
  const { qz, calls } = fixture(async () => popup);
  const value = await qz.tab('checkout').locator('uid:t1.snap.1').click({
    timeout: 7, waitFor: 'popup', waitOptions: { tabAlias: 'receipt' },
  });
  assert.equal(value, popup);
  assert.deepEqual(calls, [{ name: 'wait_for_popup', args: {
    tabRef: 'checkout', timeout: 7, tabAlias: 'receipt', trigger: {
      name: 'act_on_element', args: { tabRef: 'checkout', locator: { target: 'uid:t1.snap.1' }, action: 'click', timeout: 7 },
    },
  } }]);
});

test('counts, zero-count waits and reads retain their distinct backend semantics', async () => {
  const { qz, calls } = fixture(async name => name === 'find_elements' ? { count: 3 } : { state: 'ready' });
  const rows = qz.tab('orders').locator({ role: 'row', scope: 'css:#orders' });
  assert.equal(await rows.count(), 3);
  await rows.wait({ count: 0, timeout: 2 });
  await rows.nth(0).read({ limit: 1500 });
  assert.equal(calls[0].args.countOnly, true);
  assert.equal(calls[1].args.count, 0);
  assert.equal(calls[1].args.state, undefined);
  assert.equal(calls[2].args.source, 'target');
  assert.equal(calls[2].args.locator.nth, 0);
  assert.equal(calls[2].args.limit, 1500);
});

test('SDK calls retain native concurrency and propagate errors without retries', async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const failure = Object.assign(new Error('Not unique'), { code: 'ELEMENT_AMBIGUOUS', hint: 'Narrow the locator.' });
  const { qz, calls } = fixture((name, args) => args.tabRef === 'slow' ? held : Promise.reject(failure));
  const slow = qz.tab('slow').read();
  const fast = qz.tab('fast').locator('css:button').click();
  assert.equal(slow instanceof Promise, true);
  assert.equal(calls.length, 2);
  await assert.rejects(Promise.all([slow, fast]), error => error === failure);
  release({ text: 'finished' });
  assert.deepEqual(await slow, { text: 'finished' });
  assert.equal(calls.length, 2);
});

for (const mode of ['development', 'production']) {
  test(`${mode}: actual Worker exposes qz and retains legacy tools and function serialization`, async () => {
    const compiled = await compileInnerWorker({ mode });
    const calls = [];
    const { result } = await runInnerWorker(compiled, `
      const page = qz.tab("map");
      await page.locator({role:"option",name:"杭州大厦"}).click();
      const title = await page.evaluate(() => document.title);
      await tools.legacy({value:1});
      trace("selected");
      return {title, count: await page.locator({role:"option"}).count()};
    `, { strictResult: true, onMessage(message, reply) {
      if (message.type !== 'tool_call') return;
      calls.push(message);
      reply({ type: 'tool_response', callId: message.callId, response: { ok: true, result:
        message.toolName === 'evaluate' ? 'Map' : message.toolName === 'find_elements' ? { count: 4 } : {} } });
    } });
    assert.equal(result.ok, true);
    assert.deepEqual(result.result, { title: 'Map', count: 4 });
    assert.deepEqual(result.trace.map(row => row.message), ['selected']);
    assert.deepEqual(calls.map(call => call.toolName), ['act_on_element', 'evaluate', 'legacy', 'find_elements']);
    assert.equal(typeof calls[1].args.code, 'string');
    assert.match(calls[1].args.code, /document.title/);
  });
}
