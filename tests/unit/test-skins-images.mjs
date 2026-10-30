import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSkinImages } from '../../src/capabilities/skins/image-input.js';
import register from '../../src/capabilities/skins/tools.js';
import { createSkinService } from '../../src/background/skins/service.js';
import { createMemoryStorage } from '../support/memory-storage.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
class ToolError extends Error { constructor(code, message, details) { super(message); this.code = code; this.details = details; } }
const host = { getSecurityGuardrails: async () => ({}), assertUrlAllowed() {} };
const skin = src => ({ name: '2D', visual: { type: 'image2d', src }, quotes: ['Hello'], assets: {} });
const dependencies = (overrides = {}) => ({
  fetch: async () => new Response(png),
  getAsset: async () => ({ blob: new Blob([png]) }),
  normalize: async blob => {
    assert.equal(blob.type, 'image/png');
    return { dataUrl: `data:image/png;base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}` };
  }, ...overrides,
});

test('skin image inputs embed URL and collected bytes, including dark images, without mutating input', async () => {
  const urls = [], input = { ...skin('https://images.test/avatar'), visual: {
    type: 'image2d', src: 'https://images.test/avatar', darkSrc: 'asset:image:avatar',
  } };
  const output = await resolveSkinImages(input, {
    ...host, assertUrlAllowed: url => urls.push(url),
  }, undefined, dependencies({
    fetch: async (url, options) => {
      assert.deepEqual(urls, [url], 'check URL before fetching');
      assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
      return new Response(png, { headers: { 'content-type': 'application/octet-stream' } });
    },
    getAsset: async (id, options) => {
      assert.equal(id, 'asset:image:avatar'); assert.equal(options.touch, false);
      return { blob: new Blob([png]) };
    },
  }));
  assert.deepEqual(output.visual, { type: 'image2d', src: dataUrl, darkSrc: dataUrl });
  assert.equal(input.visual.src, 'https://images.test/avatar');
  assert.deepEqual(output.quotes, ['Hello']);
  assert.equal((await resolveSkinImages(skin(dataUrl), host, undefined, dependencies())).visual.src, dataUrl);
  assert.equal((await resolveSkinImages(skin('builtin:logo-day'), host)).visual.src, 'builtin:logo-day');
});

test('invalid, missing, blocked and oversized image sources fail before changing a skin', async () => {
  for (const src of ['file:///tmp/a.png', 'chrome-extension://x/a.png', 'blob:https://example.com/a',
    'https://user:password@images.test/a', 'not a url', 'data:image/svg+xml;base64,PHN2Zz4=']) {
    await assert.rejects(resolveSkinImages(skin(src), host, undefined, dependencies({
      fetch: () => assert.fail('invalid source must not be fetched'),
    })), { code: 'SKIN_IMAGE_INVALID' });
  }
  await assert.rejects(resolveSkinImages(skin('asset:image:missing'), host, undefined,
    dependencies({ getAsset: async () => null })), { code: 'SKIN_IMAGE_NOT_FOUND' });
  await assert.rejects(resolveSkinImages(skin('https://blocked.test/a'), {
    ...host, assertUrlAllowed() { throw new ToolError('URL_BLOCKED', 'blocked'); },
  }, undefined, dependencies({ fetch: () => assert.fail('blocked URL was fetched') })), { code: 'URL_BLOCKED' });
  for (const fetch of [async () => new Response('not found', { status: 404 }), async () => { throw new TypeError('redirect'); }]) {
    await assert.rejects(resolveSkinImages(skin('https://images.test/a'), host, undefined, dependencies({ fetch })),
      { code: 'SKIN_IMAGE_FETCH_FAILED' });
  }
  await assert.rejects(resolveSkinImages(skin('https://images.test/a'), host, undefined, dependencies({
    fetch: async () => new Response('<html>login required</html>', { headers: { 'content-type': 'image/png' } }),
  })), { code: 'SKIN_IMAGE_INVALID' });
  await assert.rejects(resolveSkinImages(skin('https://images.test/a'), host, undefined, dependencies({
    fetch: async () => new Response(png, { headers: { 'content-length': String(33 * 1024 * 1024) } }),
  })), { code: 'IMAGE_INPUT_TOO_LARGE' });
});

test('cancellation during asset resolution or decoding discards the prepared image', async () => {
  for (const phase of ['getAsset', 'normalize']) {
    const abort = new AbortController();
    const deps = dependencies();
    const original = deps[phase];
    deps[phase] = async (...args) => { const result = await original(...args); abort.abort(); return result; };
    await assert.rejects(resolveSkinImages(skin('asset:image:avatar'), host, abort.signal, deps), { name: 'AbortError' });
  }
});

test('chat image writes remain drafts and reject stopped runs or revisions changed during download', async t => {
  // Native decode/alpha are covered in Chrome. Keep this test focused on write authority after I/O.
  t.mock.method(globalThis, 'fetch', async () => new Response(png));
  const previousDecoder = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
  t.after(() => { if (previousDecoder) globalThis.createImageBitmap = previousDecoder; else delete globalThis.createImageBitmap; });
  let live = true, duringFetch = async () => {};
  const storage = createMemoryStorage(), opened = [];
  const service = createSkinService({ storage, emit() {}, isRunCurrent: () => live,
    openEditor: async id => { opened.push(id); return {}; } });
  let tool;
  register({ ...host, registerTool: definition => { tool = definition; },
    getToolRuntimeDependencies: () => ({ skins: service }), ToolExecutionError: ToolError });
  const call = (args, signal = new AbortController().signal) => tool.execute(args, signal, { sessionId: 's', runId: 'r' });
  globalThis.fetch = async () => { await duringFetch(); return new Response(png); };
  const created = await call({ action: 'create', skin: JSON.stringify(skin('https://images.test/a')) });
  assert.equal(created.applied, false); assert.ok(opened.includes(created.id));
  assert.equal((await service.execute({ action: 'get', id: created.id })).skin.visual.src, dataUrl);
  assert.equal((await service.execute({ action: 'list' })).activeId, 'qingzhou');
  const update = { action: 'update', id: created.id, revision: 1,
    patch: JSON.stringify({ name: 'Edited', visual: { type: 'image2d', src: 'https://images.test/new' } }) };
  duringFetch = async () => { live = false; };
  await assert.rejects(call(update), { code: 'SKIN_RUN_EXPIRED' });
  assert.equal((await service.execute({ action: 'get', id: created.id })).skin.revision, 1);
  live = true;
  duringFetch = async () => {
    await service.execute({ action: 'update', id: created.id, revision: 1, patch: { name: 'Other editor' } });
  };
  await assert.rejects(call(update), { code: 'SKIN_CONFLICT' });
  assert.equal((await service.execute({ action: 'get', id: created.id })).skin.name, 'Other editor');
  const abort = new AbortController();
  duringFetch = async () => { abort.abort(); };
  const writes = storage.writes.length;
  await assert.rejects(call({ ...update, revision: 2 }, abort.signal), { name: 'AbortError' });
  assert.equal(storage.writes.length, writes);
  duringFetch = async () => {};
  await call({ ...update, revision: 2 });
  assert.equal((await service.execute({ action: 'list' })).activeId, 'qingzhou');
  await call({ action: 'revert', id: created.id, revision: 3 });
  assert.equal((await service.execute({ action: 'get', id: created.id })).skin.name, '2D');
});
