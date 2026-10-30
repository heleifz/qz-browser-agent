import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test, expect } from './fixtures.mjs';
import { ensureTestExtension } from '../support/extension-build.mjs';
import { acceptDataDisclosure } from '../support/data-consent.mjs';
import { saveExtensionLlmConfig } from '../support/isolated-extension-mcp.mjs';

test('text-only chat draws and imports local 2D skins from direct URLs and collected assets', async ({}, testInfo) => {
  test.setTimeout(120_000);
  const extension = await ensureTestExtension();
  const profile = await mkdtemp(join(tmpdir(), 'qz-skin-images-'));
  const sourceImage = await readFile(new URL('../../src/icons/logo-day.png', import.meta.url));
  const errors = [], toolResults = [];
  let browser, turn = 0, offline = false;
  const script = `
    const canvas = new OffscreenCanvas(128, 128), c = canvas.getContext('2d');
    c.fillStyle = '#85bee6'; c.beginPath(); c.ellipse(64,70,48,36,0,0,Math.PI*2); c.fill();
    c.fillStyle = '#253c55'; for(const x of [48,80]) { c.beginPath(); c.arc(x,64,4,0,Math.PI*2); c.fill(); }
    const bytes = new Uint8Array(await (await canvas.convertToBlob({type:'image/png'})).arrayBuffer());
    let binary=''; for(const byte of bytes) binary+=String.fromCharCode(byte);
    const make = (name,src,darkSrc) => tools.manage_skin({action:'create',skin:JSON.stringify({name,
      visual:{type:'image2d',src,...(darkSrc ? {darkSrc} : {})},quotes:['Hello'],assets:{}})});
    const drawn = await make('Drawn', 'data:image/png;base64,'+btoa(binary));
    const direct = await make('Direct URL', input.origin+'/avatar.png', input.origin+'/avatar.png');
    const tab = await tools.open_tab({url:input.origin+'/source'});
    const images = await tools.list_images({tabRef:tab.id});
    const collection = await tools.collect_images({table:'Skin image fixture',targets:[images.images[0].target],format:'png'});
    const assetId = collection.assetIds[0];
    const collected = await make('Collected', assetId);
    let invalidCode='';
    try { await tools.manage_skin({action:'update',id:collected.id,revision:collected.revision,
      patch:JSON.stringify({visual:{type:'image2d',src:input.origin+'/not-an-image'}})}); }
    catch(error) { invalidCode=error.code; }
    if(invalidCode!=='SKIN_IMAGE_INVALID') throw new Error('Expected invalid image rejection: '+invalidCode);
    return {drawn,direct,collected,assetId,invalidCode};`;
  const server = createServer(async (req, res) => {
    if (req.url === '/source') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><title>Image source</title><img src="/avatar.png" alt="Avatar" width="256" height="256">'); return;
    }
    if (req.url === '/avatar.png') {
      res.writeHead(offline ? 404 : 200, { 'content-type': 'application/octet-stream' });
      res.end(offline ? 'Removed' : sourceImage); return;
    }
    if (req.url === '/not-an-image') {
      res.writeHead(200, { 'content-type': 'image/png' }); res.end('<html>Login required</html>'); return;
    }
    let raw = ''; for await (const part of req) raw += part;
    const body = JSON.parse(raw || '{}');
    if (!body.stream) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '2D fixture' }, finish_reason: 'stop' }] })); return;
    }
    toolResults.push(...(body.messages || []).filter(message => message.role === 'tool'));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'skin-images', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    if (turn++ === 0) {
      send({ role: 'assistant', tool_calls: [{ index: 0, id: 'create-images', type: 'function', function: {
        name: 'run_script', arguments: JSON.stringify({ target: 'inner', timeout: 60, args: { origin }, code: script }),
      } }] }); send({}, 'tool_calls');
    } else { send({ role: 'assistant', content: 'SKIN_IMAGES_READY' }); send({}, 'stop'); }
    res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    browser = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium',
      viewport: { width: 1280, height: 800 }, ignoreDefaultArgs: ['--disable-extensions'],
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
        ...(process.env.QZ_TEST_NO_SANDBOX === '1' ? ['--no-sandbox'] : [])],
    });
    browser.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
    const base = `chrome-extension://${new URL(worker.url()).host}`;
    const panel = await browser.newPage();
    await panel.goto(base + '/sidepanel/sidepanel.html'); await acceptDataDisclosure(panel);
    await saveExtensionLlmConfig(panel, { provider: 'custom', customProtocol: 'openai',
      customEndpoint: origin + '/v1/chat/completions', apiKey: 'isolated-test-key',
      model: 'text-only-tool-fixture', contextWindow: 128000, vision: false,
    });
    await panel.locator('#input').fill('Create a 2D drawing and import the fixture images for preview.');
    await panel.locator('#btn-send').click();
    await panel.locator('#messages').getByText('SKIN_IMAGES_READY', { exact: true }).waitFor({ timeout: 80_000 });
    await testInfo.attach('tool-results.json', { body: JSON.stringify(toolResults), contentType: 'application/json' });
    const library = await worker.evaluate(async () => (await chrome.storage.local.get('qingzhou_skins_v1')).qingzhou_skins_v1);
    const get = name => library.entries.find(entry => entry.draft.name === name)?.draft;
    expect(get('Drawn'), 'Canvas skin is missing; see tool-results.json').toBeTruthy();
    expect(get('Direct URL'), 'URL skin is missing; see tool-results.json').toBeTruthy();
    expect(get('Collected'), 'Collected skin is missing; see tool-results.json').toBeTruthy();
    expect(library.activeId).toBe('qingzhou');
    expect(get('Collected').revision).toBe(1);
    expect(Buffer.from(get('Direct URL').visual.src.split(',')[1], 'base64')).toEqual(sourceImage);
    expect(get('Direct URL').visual.darkSrc === get('Direct URL').visual.src).toBe(true);
    expect(get('Collected').visual.src.startsWith('data:image/png;base64,')).toBe(true);
    const alpha = await panel.evaluate(async src => {
      const bitmap = await createImageBitmap(await (await fetch(src)).blob());
      const c = new OffscreenCanvas(128, 128).getContext('2d'); c.drawImage(bitmap, 0, 0); bitmap.close();
      return { corner: c.getImageData(0, 0, 1, 1).data[3], center: c.getImageData(64, 70, 1, 1).data[3] };
    }, get('Drawn').visual.src);
    expect(alpha).toEqual({ corner: 0, center: 255 });
    // Removing both sources cannot affect the local skin or its portable export.
    offline = true;
    const matchesCollectedAsset = await worker.evaluate(async src => {
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open('qz-browser-agent-assets'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const records = await new Promise((resolve, reject) => { const request = db.transaction('image_assets').objectStore('image_assets').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      // Page collection may rasterize the original. Import must preserve the collected asset's bytes.
      const bytes = new Uint8Array(await records[0].blob.arrayBuffer());
      let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
      const matches = src === 'data:image/png;base64,' + btoa(binary);
      await new Promise((resolve, reject) => { const tx = db.transaction('image_assets', 'readwrite'); tx.objectStore('image_assets').clear(); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); db.close();
      return matches;
    }, get('Collected').visual.src);
    expect(matchesCollectedAsset).toBe(true);
    const studio = browser.pages().find(page => page.url().includes('/dom/skins/editor.html') && page.url().includes(get('Collected').id));
    expect(studio).toBeTruthy();
    await studio.reload();
    await expect(studio.locator('#skin-apply')).toBeEnabled();
    await expect.poll(() => studio.evaluate(() => {
      const img = document.querySelector('#skin-viewer img');
      return img?.currentSrc.startsWith('data:image/png;') && img.complete && img.naturalWidth > 0;
    })).toBe(true);
    await studio.screenshot({ path: testInfo.outputPath('collected-image-studio.png') });
    if (await studio.locator('#skin-inspector').isHidden()) await studio.locator('#skin-toggle-inspector').click();
    const downloadReady = studio.waitForEvent('download'); await studio.locator('#skin-export').click();
    const downloaded = JSON.parse(await readFile(await (await downloadReady).path(), 'utf8'));
    expect(downloaded.skin.visual).toEqual(get('Collected').visual);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close(); await rm(profile, { recursive: true, force: true });
    await new Promise(resolve => server.close(resolve));
  }
});
