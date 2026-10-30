import { expect, test } from './fixtures.mjs';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { installBenchmarkChromeStub } from './benchmark-chrome-stub.mjs';
import { vrmFixture } from '../fixtures/skins/vrm-fixture.mjs';

// Software WebGL and full-page screenshots need headroom on shared CI workers.
test.setTimeout(60000);
test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader'] } });

async function skinHarness(context, page) {
  const pages = new Set();
  const background = await context.newPage();
  await background.route('**/skin-background-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
  await background.goto('/skin-background-fixture');
  await background.exposeFunction('__broadcastSkin', () => {
    for (const target of pages) void target.evaluate(() => window.__skinChanged?.()).catch(() => {});
  });
  await background.evaluate(async () => {
    const { createSkinRepository } = await import('/extension/background/skins/repository.js');
    const { createMemoryStorage } = await import('/tests/support/memory-storage.mjs');
    window.skinRepository = createSkinRepository(createMemoryStorage(), () => window.__broadcastSkin());
  });
  const repository = Object.fromEntries(['get', 'snapshot', 'welcome', 'mutate'].map(method => [method,
    (...args) => background.evaluate(async ({method, args}) => {
      try { return {ok:true, result: await window.skinRepository[method](...args)}; }
      catch (error) { return {ok:false, code:error.code, error:error.message}; }
    }, {method, args}).then(response => {
      if (!response.ok) throw Object.assign(new Error(response.error), {code:response.code});
      return response.result;
    }),
  ]));
  async function attach(page) {
    pages.add(page);
    await page.exposeFunction('__skinCommand', async command => {
      try {
        const result = command.action === 'list' ? await repository.snapshot()
          : command.action === 'welcome' ? await repository.welcome(command.id, command.revision)
          : command.action === 'get' ? { skin: await repository.get(command.id || '', command.saved === true) }
          : command.action === 'open' ? { id: command.id }
          : await repository.mutate(command);
        return { ok: true, result };
      } catch (error) { return { ok: false, code: error.code, error: error.message }; }
    });
    await page.addInitScript(() => {
      if (window.top !== window) return;
      const listeners = new Set();
      window.__skinChanged = () => { for (const listener of listeners) listener({ qingzhou_skins_v1: {} }, 'local'); window.__skinUiRefresh?.(); };
      window.chrome = { runtime: { getURL: path => `${location.origin}/extension/${path.replace(/^\//, '')}` },
        i18n: { getUILanguage: () => 'zh-CN', getMessage: () => '' },
        storage: { local: { get: async () => ({ qingzhou_language: 'zh-CN' }) },
          onChanged: { addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener) } },
      };
      window.__skinMessages = [];
      window.addEventListener('message', event => { if (event.data?.channel === 'qz-skin') window.__skinMessages.push(event.data); });
    });
    await page.route('**/dom/skins/client.js', route => route.fulfill({ contentType: 'text/javascript', body: `
      export async function skinRequest(command) {
        const response = await window.__skinCommand(command);
        if (!response.ok) throw Object.assign(new Error(response.error), {code:response.code});
        return response.result;
      }` }));
  }
  await attach(page);
  return { repository, attach, pages };
}

async function openAdjustments(page) {
  if (await page.locator('#skin-inspector').isHidden()) await page.locator('#skin-toggle-inspector').click();
}

for (const version of ['0', '1']) test(`character studio VRM ${version} frames, previews expressions without reload, photographs and groups looks`, async ({ page, context }, testInfo) => {
  const { repository } = await skinHarness(context, page);
  await context.addInitScript(() => {
    if (window === window.top) return;
    const add = window.addEventListener.bind(window);
    window.addEventListener = (type, listener, options) => add(type, type === 'message' && typeof listener === 'function'
      ? event => { if (event.data?.type === 'capture' && event.data.options?.camera) setTimeout(() => listener(event), 500); else listener(event); }
      : listener, options);
  });
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const source = `window.studioProbe={vrm,model};model.traverse(node=>{if(node.isMesh)node.onBeforeRender=(renderer,scene,camera)=>{
    if(!renderer.getRenderTarget())window.studioProbe.camera=camera;};});vrm.expressionManager.setValue('happy',.25);return {root:model};`;
  const { skin } = await repository.mutate({ action: 'create', skin: { name: 'Whale', quotes: [], assets: {},
    visual: { type: 'model3d', src: 'data:model/gltf-binary;base64,' + vrmFixture(version).toString('base64'), source } } });
  await page.goto('/extension/dom/skins/editor.html?skin=' + skin.id);
  await expect(page.locator('#skin-apply')).toBeEnabled({ timeout: 15000 });
  const frame = page.frames().find(frame => frame.url().endsWith('/sandbox.html'));
  await expect(page.locator('#skin-expression-list img')).toHaveCount(3);
  const thumbnails = await page.locator('#skin-expression-list img').evaluateAll(images => images.map(image => image.src));
  expect(thumbnails[1]).not.toBe(thumbnails[2]);
  expect(await frame.evaluate(() => window.studioProbe.vrm.expressionManager.getValue('happy'))).toBe(.25);
  const camera = () => frame.evaluate(() => window.studioProbe.camera.position.toArray());
  const full = await camera();
  await page.locator('[data-camera="bust"]').click();
  await expect.poll(async () => (await camera())[2]).toBeLessThan(full[2]);
  const bust = await camera(); await page.locator('[data-camera="close"]').click();
  await expect.poll(async () => (await camera())[1]).toBeGreaterThan(bust[1]);
  expect((await camera())[2]).toBeLessThanOrEqual(bust[2]);
  await frame.evaluate(() => window.originalModel = window.studioProbe.model);
  await page.locator('[data-expression="happy"]').click();
  await expect(page.locator('[data-expression="happy"]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => frame.evaluate(() => window.studioProbe.vrm.expressionManager.getValue('happy'))).toBe(1);
  expect(await frame.evaluate(() => window.originalModel === window.studioProbe.model)).toBe(true);
  expect((await repository.get(skin.id)).visual.expressions).toEqual({ happy: 1 });
  expect((await repository.get(skin.id, true)).visual.expressions).toBeUndefined();
  await page.locator('#skin-compare').click();
  await expect(page.locator('#skin-comparison-images')).toBeVisible({ timeout: 15000 });
  const comparison = await page.locator('#skin-comparison-images img').evaluateAll(images => images.map(image => image.src));
  expect(comparison[0]).not.toBe(comparison[1]);
  await expect(page.locator('.skin-comparison-render')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('compare.png') });
  await page.keyboard.press('Escape'); await expect(page.locator('#skin-comparison')).not.toBeVisible();
  const downloading = page.waitForEvent('download'); await page.locator('#skin-portrait').click();
  const download = await downloading, bytes = await readFile(await download.path());
  expect(download.suggestedFilename()).toBe('Whale-portrait.png');
  const photo = await page.evaluate(async data => {
    const image = await createImageBitmap(await (await fetch(data)).blob());
    const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    return { width: image.width, height: image.height, transparent: pixels.filter((v, i) => i % 4 === 3 && v === 0).length,
      opaque: pixels.filter((v, i) => i % 4 === 3 && v === 255).length };
  }, 'data:image/png;base64,' + bytes.toString('base64'));
  expect(photo.width).toBe(1024); expect(photo.height).toBe(1024); expect(photo.transparent).toBeGreaterThan(1000); expect(photo.opaque).toBeGreaterThan(1000);
  await page.locator('#skin-duplicate').click();
  await expect(page.locator('#skin-preview-name')).toHaveText('造型 2');
  const lookId = new URL(page.url()).searchParams.get('skin');
  expect((await repository.get(lookId)).character).toEqual({ id: skin.id, name: 'Whale' });
  await expect(page.locator('.skin-library-group[aria-label="Whale"] [data-skin-id]')).toHaveCount(2);
  await expect(page.locator('#skin-apply')).toBeEnabled({ timeout: 15000 });
  await page.locator('#skin-apply').click(); await expect.poll(async () => (await repository.snapshot()).activeId).toBe(lookId);
  await page.reload(); await expect(page.locator('[data-expression="happy"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#skin-apply')).toBeEnabled();
  await page.locator('[data-expression=""]').click();
  await expect(page.locator('[data-expression=""]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#skin-expression-list img')).toHaveCount(3);
  await page.locator('[data-expression="happy"]').click();
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme }); await expect(page.locator('#skin-expression-list img')).toHaveCount(3);
    await page.screenshot({ path: testInfo.outputPath(`studio-${colorScheme}.png`) });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('#skin-open-chat')).toBeVisible();
  await page.frames().find(frame => frame.url().endsWith('/sandbox.html'))
    .evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const painted = await page.locator('#skin-viewer').screenshot();
  const bluePixels = await page.evaluate(async data => {
    const image = await createImageBitmap(await (await fetch(data)).blob()), canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    let count = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 2] > pixels[i] + 30) count++;
    return count;
  }, 'data:image/png;base64,' + painted.toString('base64'));
  expect(bluePixels).toBeGreaterThan(1000);
  await page.screenshot({ path: testInfo.outputPath('studio-narrow.png'), fullPage: true });
});

test('comparison dismissal releases resources and a concurrent edit cannot present a stale comparison', async ({ page, context }) => {
  const { repository } = await skinHarness(context, page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/extension/dom/skins/editor.html?skin=dafeiyu');
  await expect(page.locator('#skin-apply')).toBeEnabled({ timeout: 15000 });
  await repository.mutate({ action: 'update', id: 'dafeiyu', revision: 1, patch: { name: 'Changed' } });
  await expect(page.locator('#skin-compare')).toBeEnabled();
  async function blockSavedRead() {
    await page.evaluate(() => {
      const request = window.__skinCommand;
      window.__skinCommand = async command => {
        if (command.action === 'get' && command.saved) {
          window.__skinCommand = request;
          const saved = await request(command);
          await new Promise(resolve => window.releaseComparison = resolve); return saved;
        }
        return request(command);
      };
    });
  }
  await blockSavedRead(); await page.locator('#skin-compare').click();
  await expect(page.locator('#skin-comparison-loading')).toBeVisible();
  await page.waitForFunction(() => typeof window.releaseComparison === 'function');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.releaseComparison(); delete window.releaseComparison; });
  await expect(page.locator('#skin-compare')).toBeEnabled();
  await expect(page.locator('.skin-comparison-render')).toHaveCount(0); await expect(page.locator('#skin-error')).toBeHidden();
  await blockSavedRead(); await page.locator('#skin-compare').click();
  await page.waitForFunction(() => typeof window.releaseComparison === 'function');
  const latest = await repository.get('dafeiyu');
  await repository.mutate({ action: 'update', id: latest.id, revision: latest.revision, patch: { name: 'Concurrent edit' } });
  await page.evaluate(() => window.releaseComparison());
  await expect(page.locator('#skin-comparison')).not.toBeVisible({ timeout: 15000 });
  await expect(page.locator('.skin-comparison-render')).toHaveCount(0);
  await expect(page.locator('#skin-preview-name')).toHaveText('Concurrent edit');
  await expect(page.locator('#skin-apply')).toBeEnabled();
});

test('studio previews 3D, rotates, applies, exports and reimports editable skins', async ({ page, context }, testInfo) => {
  const harness = await skinHarness(context, page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/extension/dom/skins/editor.html?skin=dafeiyu');
  await expect(page.locator('#skin-name')).toHaveValue(/蓝发角色/);
  await expect(page.locator('#skin-apply')).toBeEnabled({ timeout: 15000 });
  await expect(page.locator('#skin-error')).toBeHidden();
  await expect(page.locator('.skin-header-actions #skin-revert')).toHaveText('恢复上次保存');
  await expect(page.locator('#skin-revert')).toBeDisabled();
  const frame = page.frameLocator('#skin-viewer iframe');
  const canvas = frame.locator('canvas'); await expect(canvas).toBeVisible();
  const before = await canvas.screenshot();
  const bounds = await canvas.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * .4, bounds.y + bounds.height * .5);
  await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width * .8, bounds.y + bounds.height * .5, { steps: 10 }); await page.mouse.up();
  const after = await canvas.screenshot(); expect(before.equals(after)).toBe(false);
  await canvas.dblclick();
  // Compare camera motion only after the post-drag sharpness restoration has finished.
  await expect.poll(()=>canvas.evaluate(c=>c.width>=c.clientWidth*2)).toBe(true);
  const fixed = await canvas.screenshot();
  for (const button of ['right', 'middle']) {
    await page.mouse.move(bounds.x + bounds.width * .4, bounds.y + bounds.height * .5);
    await page.mouse.down({ button });
    await page.mouse.move(bounds.x + bounds.width * .7, bounds.y + bounds.height * .65, { steps: 5 });
    await page.mouse.up({ button });
    expect(fixed.equals(await canvas.screenshot()), `${button} drag must not pan or zoom`).toBe(true);
  }
  await page.keyboard.down('Shift');
  await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width * .3, bounds.y + bounds.height * .4, { steps: 5 }); await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.mouse.wheel(0, 240);
  expect(fixed.equals(await canvas.screenshot()), 'modified drag and wheel must not pan or zoom').toBe(true);
  await page.screenshot({ path: testInfo.outputPath('skin-studio-light.png'), fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: testInfo.outputPath('skin-studio-dark.png'), fullPage: true });
  await openAdjustments(page);
  await page.locator('#skin-quotes').fill('小鱼陪你启航。\n慢慢来。');
  await expect(page.locator('#skin-status')).toHaveText('草稿已保存在本地');
  await expect.poll(async () => (await harness.repository.get('dafeiyu')).quotes).toEqual(['小鱼陪你启航。', '慢慢来。']);
  await page.locator('#skin-apply').click();
  await expect.poll(async () => (await harness.repository.snapshot()).activeId).toBe('dafeiyu');
  await openAdjustments(page);
  const downloading = page.waitForEvent('download'); await page.locator('#skin-export').click();
  const download = await downloading; const path = await download.path();
  await page.locator('#skin-import-file').setInputFiles(path);
  await expect.poll(async () => (await harness.repository.snapshot()).skins.length).toBe(3);
  const selected = new URL(page.url()).searchParams.get('skin'); expect(selected).not.toBe('dafeiyu');
  const imported = await harness.repository.get(selected);
  expect(imported.visual.source).toContain('const palette'); expect(imported.quotes).toEqual(['小鱼陪你启航。', '慢慢来。']);
});

test('studio keeps the preview beside settings at medium widths and scrolls to all controls on small screens', async ({ page, context }) => {
  await skinHarness(context, page);
  await page.setViewportSize({ width: 960, height: 700 });
  await page.goto('/extension/dom/skins/editor.html?skin=dafeiyu');
  await expect(page.locator('#skin-apply')).toBeEnabled({ timeout: 15000 });
  await openAdjustments(page);
  const preview = await page.locator('.skin-preview-stage').boundingBox();
  const inspector = await page.locator('.skin-inspector').boundingBox();
  expect(preview.x + preview.width).toBeLessThanOrEqual(inspector.x);
  await expect(page.getByRole('button', { name: '导入 3D 模型', exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 700 });
  await expect.poll(() => page.locator('.skin-library-item[aria-pressed="true"]').evaluate(item => {
    const bounds = item.getBoundingClientRect(), list = item.parentElement.getBoundingClientRect();
    return bounds.left >= list.left && bounds.right <= list.right;
  })).toBe(true);
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Use a real wheel gesture: full-page screenshots and locator clicks can hide a locked root.
    await page.mouse.move(380, 600);
    await page.mouse.wheel(0, 2500);
    await expect(page.locator('#skin-source-details summary')).toBeInViewport();
  await openAdjustments(page);
    await page.locator('#skin-source-details summary').click();
    await expect(page.locator('#skin-source')).toBeVisible();
    await page.mouse.move(380, 600);
    await page.mouse.wheel(0, 2500);
    await expect(page.getByRole('button', { name: '导出皮肤', exact: true })).toBeInViewport();
    await expect(page.getByRole('button', { name: '创建副本', exact: true })).toBeInViewport();
  await openAdjustments(page);
    await page.locator('#skin-source-details summary').click();
  }
});

test('external chat edits refresh the preview and conflicts preserve unsaved source', async ({ page, context }) => {
  const { repository } = await skinHarness(context, page);
  await page.goto('/extension/dom/skins/editor.html?skin=dafeiyu');
  await expect(page.locator('#skin-apply')).toBeEnabled({ timeout: 15000 });
  await repository.mutate({ action: 'update', id: 'dafeiyu', revision: 1, patch: { name: '聊天改名', quotes: ['来自对话的修改'] } });
  await expect(page.locator('#skin-name')).toHaveValue('聊天改名');
  await expect(page.locator('#skin-preview-name')).toHaveText('聊天改名');
  await expect(page.locator('#skin-preview-state')).toHaveText('草稿');
  await expect(page.locator('#skin-preview-quote')).toHaveText('来自对话的修改');
  await expect(page.locator('#skin-revert')).toBeEnabled();
  await repository.mutate({ action: 'apply', id: 'dafeiyu', revision: 2 });
  await expect(page.locator('#skin-revert')).toBeDisabled();
  await expect(page.locator('#skin-preview-state')).toHaveText('使用中');
  await openAdjustments(page);
  await page.locator('#skin-source-details summary').click();
  await page.locator('#skin-source').fill('my unsaved source');
  await repository.mutate({ action: 'update', id: 'dafeiyu', revision: 2, patch: { name: '另一个窗口' } });
  await expect(page.locator('#skin-reload')).toBeVisible();
  await expect(page.locator('#skin-source')).toHaveValue('my unsaved source');
  await page.locator('#skin-reload').click();
  await expect(page.locator('#skin-name')).toHaveValue('另一个窗口');
  await expect(page.locator('#skin-source')).not.toHaveValue('my unsaved source');
});

test('preview shows loading before persistence, retains the picture and fades after the first frame', async ({page,context},testInfo) => {
  await skinHarness(context,page);
  await context.addInitScript(() => {
    if (!location.pathname.endsWith('/sandbox.html')) return;
    window.initialFades = 0;
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = callback => { window.initialFades++; return start(callback); };
  });
  await page.goto('/extension/dom/skins/editor.html?skin=dafeiyu');
  await expect(page.locator('#skin-apply')).toBeEnabled({timeout:15000});
  const frame=page.frames().find(f=>f.url().endsWith('/sandbox.html'));
  expect(await frame.evaluate(() => window.initialFades)).toBe(0);
  await frame.evaluate(()=>{
    window.originalCanvas=document.querySelector('canvas');window.fadeCount=0;
    const start=document.startViewTransition.bind(document);
    document.startViewTransition=callback=>{
      window.fadeCount++;const transition=start(callback);
      transition.ready.then(()=>window.fadeReady=true).catch(()=>{});return transition;
    };
  });
  await page.evaluate(()=>{
    const command=window.__skinCommand;
    window.__skinCommand=async input=>{
      if(input.action==='update')await new Promise(resolve=>window.releasePreviewSave=resolve);
      return command(input);
    };
  });
  await openAdjustments(page);
  await page.locator('#skin-source-details summary').click();
  const source=`const root=new THREE.Mesh(new THREE.SphereGeometry(),new THREE.MeshStandardMaterial({color:'#708ab5'}));
    window.renderedNewShape=false;root.onBeforeRender=()=>{window.renderedNewShape=true;};return {root};`;
  await page.locator('#skin-source').fill(source);await page.locator('#skin-update-source').click();
  await expect(page.locator('#skin-viewer')).toHaveAttribute('aria-busy','true');
  await expect(page.locator('.skin-viewer-loading')).toHaveText('正在更新形象…');
  await expect(frame.locator('canvas')).toBeVisible();
  expect(await frame.evaluate(()=>document.querySelector('canvas')===window.originalCanvas)).toBe(true);
  // Capture the real loading UI in both themes, before the held save can reach the renderer.
  for(const colorScheme of ['light','dark']) {
    await page.emulateMedia({colorScheme});
    await page.locator('.skin-preview-stage').screenshot({path:testInfo.outputPath(`preview-loading-${colorScheme}.png`)});
  }
  await page.evaluate(()=>window.releasePreviewSave());
  await expect(page.locator('#skin-apply')).toBeEnabled({timeout:15000});
  await expect(page.locator('.skin-viewer-loading')).toBeHidden();
  await expect(page.locator('#skin-viewer')).toHaveAttribute('aria-busy','false');
  expect(await frame.evaluate(()=>({canvas:document.querySelector('canvas')===window.originalCanvas,
    drawn:window.renderedNewShape,fade:window.fadeCount,ready:window.fadeReady}))).toEqual({canvas:true,drawn:true,fade:1,ready:true});
});

test('restore last save discards chat drafts and pending local edits together', async ({ page, context }) => {
  const { repository } = await skinHarness(context, page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/extension/dom/skins/editor.html?skin=dafeiyu');
  await expect(page.locator('#skin-apply')).toBeEnabled({ timeout: 15000 });
  await openAdjustments(page);
  await page.locator('#skin-name').fill('上次保存的形象');
  await openAdjustments(page);
  await page.locator('#skin-quotes').fill('上次保存的文案');
  await expect(page.locator('#skin-apply')).toBeEnabled();
  await page.locator('#skin-apply').click();
  await expect(page.locator('#skin-status')).toHaveText('已应用到新对话页');
  const saved = (await repository.snapshot()).active;
  const changed = await repository.mutate({ action: 'update', id: saved.id, revision: saved.revision, patch: {
    name: '聊天中的草稿', quotes: ['草稿文案'], assets: { accent: 'builtin:logo-night' },
    visual: { type: 'scene3d', source: 'return {root:new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial({color:0xe35b62}))};' },
  } });
  await expect(page.locator('#skin-name')).toHaveValue('聊天中的草稿');
  await expect(page.locator('#skin-apply')).toBeEnabled({ timeout: 15000 });
  expect((await repository.snapshot()).active).toEqual(saved);
  await openAdjustments(page);
  await page.locator('#skin-source-details summary').click();
  await page.locator('#skin-source').fill('unfinished local code');
  // Click before the debounced draft write; it must not return after restoration.
  await page.evaluate(() => {
    const input = document.querySelector('#skin-name');
    input.value = '还没有暂存的名字'; input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#skin-revert').click();
  });
  await expect(page.locator('#skin-status')).toHaveText('已恢复到上次保存的状态');
  await expect(page.locator('#skin-name')).toHaveValue(saved.name);
  await expect(page.locator('#skin-quotes')).toHaveValue(saved.quotes.join('\n'));
  await expect(page.locator('#skin-source')).toHaveValue(saved.visual.source);
  await expect(page.locator('#skin-preview-quote')).toHaveText(saved.quotes[0]);
  await expect(page.locator('#skin-apply')).toBeEnabled({ timeout: 15000 });
  await expect(page.locator('#skin-revert')).toBeDisabled();
  await page.waitForTimeout(800);
  const restored = await repository.get(saved.id);
  expect(restored).toEqual({ ...saved, revision: changed.skin.revision + 1 });
  expect((await repository.snapshot()).active).toEqual(restored);
  await page.reload();
  await expect(page.locator('#skin-name')).toHaveValue(saved.name);
  await expect(page.locator('#skin-source')).toHaveValue(saved.visual.source);
  await expect(page.locator('#skin-revert')).toBeDisabled();
});

test('broken scenes do not apply; restore, 2D upload and reload recover', async ({ page, context }) => {
  const { repository } = await skinHarness(context, page);
  await page.goto('/extension/dom/skins/editor.html?skin=dafeiyu');
  await expect(page.locator('#skin-apply')).toBeEnabled({ timeout: 15000 });
  await openAdjustments(page);
  await page.locator('#skin-source-details summary').click();
  await page.locator('#skin-source').fill('throw new Error("test invalid character");');
  await page.locator('#skin-update-source').click();
  await expect(page.locator('#skin-error')).toContainText('test invalid character');
  await expect(page.locator('#skin-apply')).toBeDisabled();
  await expect(page.locator('#skin-revert')).toBeEnabled();
  await page.locator('#skin-revert').click();
  await expect(page.locator('#skin-apply')).toBeEnabled({ timeout: 15000 });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5GkAAAAASUVORK5CYII=', 'base64');
  await page.locator('#skin-image-file').setInputFiles({ name: 'image.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('#skin-viewer img')).toBeVisible();
  await expect(page.locator('#skin-apply')).toBeEnabled(); await page.locator('#skin-apply').click();
  await expect.poll(async () => (await repository.snapshot()).active.visual.type).toBe('image2d');
  await page.reload(); await expect(page.locator('#skin-viewer img')).toBeVisible();
  await expect(page.locator('#skin-viewer iframe')).toHaveCount(0);
});

test('sandbox isolates extension APIs and parent DOM; reduced motion and hidden views stop rendering', async ({ page, context }) => {
  const { repository } = await skinHarness(context, page);
  const source = `
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.MeshStandardMaterial({color:0x5588ff})));
    window.probe={frames:0,chromeRuntime:!!globalThis.chrome?.runtime,parentBlocked:false};
    try{ void parent.document.body; }catch{window.probe.parentBlocked=true;}
    return {root,update(){window.probe.frames++}};
  `;
  await repository.mutate({ action: 'update', id: 'dafeiyu', revision: 1, patch: { visual: { type: 'scene3d', source } } });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/extension/dom/skins/editor.html?skin=dafeiyu');
  await expect(page.locator('#skin-apply')).toBeEnabled({ timeout: 15000 });
  let sandbox = page.frames().find(frame => frame.url().endsWith('/sandbox.html'));
  expect(await sandbox.evaluate(() => window.probe)).toEqual({ frames: 0, chromeRuntime: false, parentBlocked: true });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(() => sandbox.evaluate(() => window.probe.frames)).toBeGreaterThan(2);
  await page.locator('#skin-viewer').evaluate(element => { element.style.display = 'none'; });
  await expect.poll(async () => {
    const frames = await sandbox.evaluate(() => window.probe.frames);
    await page.waitForTimeout(120);
    return await sandbox.evaluate(() => window.probe.frames) === frames;
  }).toBe(true);
});

test('pointer frames bypass the idle animation cap and release restores sharp rendering', async ({page, context}) => {
  await skinHarness(context, page);
  await page.emulateMedia({reducedMotion:'reduce'});
  await context.addInitScript(() => {
    if (!location.pathname.endsWith('/sandbox.html')) return;
    let next = 0, paused = false; const frames = new Map(), nativeFrames = new Map();
    const nativeRequest=window.requestAnimationFrame.bind(window),nativeCancel=window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => {
      const id=++next;frames.set(id,callback);
      if(!paused)nativeFrames.set(id,nativeRequest(time=>{frames.delete(id);nativeFrames.delete(id);callback(time);}));
      return id;
    };
    window.cancelAnimationFrame = id => { frames.delete(id);nativeCancel(nativeFrames.get(id));nativeFrames.delete(id); };
    window.pauseSkinFrames=()=>{paused=true;for(const id of nativeFrames.values())nativeCancel(id);nativeFrames.clear();};
    window.stepSkinFrame = time => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(time)); };
    window.skinDraws = 0;
    window.addEventListener('message',({data})=>{
      if(data.type==='motion')window.skinMotion=data.reducedMotion;
      if(data.type==='visibility')window.skinVisible=data.visible;
    });
    window.addEventListener('pointerdown',event=>{window.skinPointerId=event.pointerId;},{capture:true});
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(...args) {
      const gl = getContext.apply(this, args);
      if (args[0] === 'webgl2' && gl && !gl.skinProbe) {
        gl.skinProbe = true; const clear = gl.clear.bind(gl);
        gl.clear = (...args) => { window.skinDraws++; return clear(...args); };
      }
      return gl;
    };
  });
  await page.goto('/extension/dom/skins/editor.html?skin=dafeiyu');
  await expect(page.locator('#skin-apply')).toBeEnabled({timeout:15000});
  const frame=page.frames().find(f=>f.url().endsWith('/sandbox.html'));
  await page.locator('#skin-viewer').screenshot(); // Finish the initial compositor layout before pausing the clock.
  const bounds=await page.locator('#skin-viewer iframe').boundingBox();
  const resolution=()=>frame.evaluate(()=>{const c=document.querySelector('canvas');return [c.width,c.height];});
  await frame.evaluate(()=>window.pauseSkinFrames());
  await page.emulateMedia({reducedMotion:'no-preference'});
  await expect.poll(()=>frame.evaluate(()=>window.skinMotion)).toBe(false);
  await frame.evaluate(()=>window.stepSkinFrame(100000));
  const sharp=await resolution();
  await page.mouse.move(bounds.x+bounds.width*.3,bounds.y+bounds.height*.5);await page.mouse.down();
  await expect.poll(async()=>(await resolution())[0]).toBeLessThan(sharp[0]);
  for(const [index,time] of [100016,100032].entries()) {
    const before=await frame.evaluate(()=>window.skinDraws);
    // Deliver movement directly while the clock is paused: native mouse moves can be coalesced
    // until Chromium's next native frame. Real mouse dragging is also covered by the studio test.
    await frame.evaluate(({index,time})=>{
      document.querySelector('canvas').dispatchEvent(new PointerEvent('pointermove',{bubbles:true,
        pointerId:window.skinPointerId,pointerType:'mouse',buttons:1,clientX:innerWidth*(.45+index*.15),clientY:innerHeight*.5}));
      window.stepSkinFrame(time);
    },{index,time});
    expect(await frame.evaluate(()=>window.skinDraws)).toBeGreaterThan(before);
  }
  await page.mouse.up();
  await expect.poll(resolution).toEqual(sharp);
  await frame.evaluate(()=>{for(let time=100100;time<=100580;time+=80)window.stepSkinFrame(time);});
  const lighter=await resolution();
  expect(lighter[0]).toBeLessThan(sharp[0]);
  expect(lighter[0]).toBeGreaterThanOrEqual(await frame.evaluate(()=>innerWidth));
  await frame.evaluate(()=>{for(let i=1;i<=95;i++)window.stepSkinFrame(100580+i*34);});
  expect((await resolution())[0]).toBeGreaterThan(lighter[0]);
  // Resizing a drawing buffer clears it. Even with the next RAF held, layout changes
  // must paint immediately instead of leaving a blank or incorrectly framed character.
  await page.setViewportSize({ width: 700, height: 800 });
  expect(await frame.evaluate(() => {
    const before = window.skinDraws;
    window.dispatchEvent(new Event('resize'));
    return window.skinDraws - before;
  })).toBeGreaterThan(0);
  await page.locator('#skin-viewer').evaluate(el=>{el.style.display='none';});
  await expect.poll(() => frame.evaluate(() => window.skinVisible)).toBe(false);
  const stopped=await frame.evaluate(()=>window.skinDraws);
  await frame.evaluate(()=>window.stepSkinFrame(105000));
  expect(await frame.evaluate(()=>window.skinDraws)).toBe(stopped);
});

test('imported GLB preserves textures, skeleton animation, local customization and portable export', async ({ page, context }, testInfo) => {
  const { repository } = await skinHarness(context, page);
  await page.goto('/extension/dom/skins/editor.html');
  await expect(page.locator('#skin-name')).toHaveValue(/Qingzhou/);
  await page.locator('#skin-model-file').setInputFiles(fileURLToPath(new URL('../fixtures/skins/Fox.glb', import.meta.url)));
  await expect(page.locator('#skin-name')).toHaveValue('Fox');
  await expect(page.locator('#skin-apply')).toBeEnabled({ timeout: 15000 });
  await expect(page.locator('#skin-error')).toBeHidden();
  await expect(page.locator('#skin-animation option')).toHaveText(['自动选择待机动画', '静止姿势', 'Survey', 'Walk', 'Run']);
  const id = new URL(page.url()).searchParams.get('skin');
  const source = (await repository.get(id)).visual.src;
  await openAdjustments(page);
  await page.locator('#skin-animation').selectOption('Walk');
  await expect.poll(async () => (await repository.get(id)).visual.animation).toBe('Walk');
  await expect(page.locator('#skin-apply')).toBeEnabled({ timeout: 15000 });
  await page.screenshot({ path: testInfo.outputPath('imported-glb-fox.png'), fullPage: true });
  await openAdjustments(page);
  await page.locator('#skin-source-details summary').click();
  await page.locator('#skin-source').fill('model.traverse(node => { if(node.isMesh) node.material.roughness = 0.9; }); return {root:model};');
  await page.locator('#skin-update-source').click();
  await expect(page.locator('#skin-apply')).toBeEnabled({ timeout: 15000 });
  expect((await repository.get(id)).visual.src).toBe(source);
  await page.locator('#skin-apply').click(); await expect.poll(async () => (await repository.snapshot()).activeId).toBe(id);
  await openAdjustments(page);
  const downloading = page.waitForEvent('download'); await page.locator('#skin-export').click(); const download = await downloading;
  await page.locator('#skin-import-file').setInputFiles(await download.path());
  await expect.poll(async () => (await repository.snapshot()).skins.length).toBe(4);
  await expect(page.locator('#skin-apply')).toBeEnabled({ timeout: 15000 });
  const newId = new URL(page.url()).searchParams.get('skin'); expect(newId).not.toBe(id);
  const imported = await repository.get(newId);
  expect(imported.visual.src).toBe(source); expect(imported.visual.animation).toBe('Walk'); expect(imported.visual.source).toContain('roughness');
});

test('VRM edits retain one renderer and the last valid scene across syntax and runtime errors', async ({page, context}) => {
  const {repository} = await skinHarness(context, page);
  await context.addInitScript(() => {
    if (!location.pathname.endsWith('/sandbox.html')) return;
    window.modelTransfers = [];
    window.addEventListener('message', ({data}) => {
      if (data.type === 'load') window.modelTransfers.push(Object.values(data.modelBuffers || {}).reduce((n,b) => n+b.byteLength,0));
    });
  });
  await page.emulateMedia({reducedMotion:'reduce'});
  const source = scale => `
    const head=vrm.humanoid.getRawBoneNode('head');head.scale.setScalar(${scale});
    window.preview={head, disposals:0, draws:0};
    const probe=window.preview; const geometries=new Set();
    model.traverse(node=>{if(node.isMesh){
      geometries.add(node.geometry);
      node.onBeforeRender=(renderer,scene,camera)=>{if(!renderer.getRenderTarget()){probe.renderer=renderer;probe.camera=camera;probe.draws++;}};
    }});
    for(const geometry of geometries) geometry.addEventListener('dispose',()=>probe.disposals++);
    return {root:model};`;
  const {skin} = await repository.mutate({action:'create',skin:{name:'Preview',visual:{type:'model3d',
    src:'data:model/gltf-binary;base64,'+vrmFixture().toString('base64'), source:source(1)},quotes:[],assets:{}}});
  await page.goto('/extension/dom/skins/editor.html?skin='+skin.id);
  await expect(page.locator('#skin-apply')).toBeEnabled({timeout:15000});
  const frame=page.frames().find(f=>f.url().endsWith('/sandbox.html'));
  await expect.poll(()=>frame.evaluate(()=>window.preview?.draws||0)).toBeGreaterThan(0);
  await frame.evaluate(()=>{window.initialPreview=window.preview;window.initialCanvas=document.querySelector('canvas');});
  await page.locator('#skin-viewer').focus(); await page.keyboard.press('ArrowRight');
  const camera=await frame.evaluate(()=>window.preview.camera.position.toArray());
  async function edit(source) {
    const current=await repository.get(skin.id);
    await repository.mutate({action:'update',id:skin.id,revision:current.revision,patch:{visual:{type:'model3d',source}}});
    await expect(page.locator('#skin-source')).toHaveValue(source);
  }
  for(const broken of ['const vrm = ;', 'vrm.humanoid.getRawBoneNode("head").scale.setScalar(9);throw new Error("bad draft");']) {
    await edit(broken);
    await expect(page.locator('#skin-error')).toContainText('已保留上一版画面');
    await expect(page.locator('#skin-apply')).toBeDisabled();
    expect(await frame.evaluate(()=>({same:document.querySelector('canvas')===window.initialCanvas,
      scale:window.initialPreview.head.scale.x,disposed:window.initialPreview.disposals}))).toEqual({same:true,scale:1,disposed:0});
    await expect(frame.locator('canvas')).toBeVisible();
  }
  for(const scale of [1.2,1.4,1.1]) {
    await edit(source(scale));
    await expect(page.locator('#skin-apply')).toBeEnabled({timeout:15000});
    await expect.poll(()=>frame.evaluate(()=>window.preview.head.scale.x)).toBe(scale);
    await expect.poll(()=>frame.evaluate(()=>window.preview.draws)).toBeGreaterThan(0);
    expect(await frame.evaluate(()=>window.preview.renderer===window.initialPreview.renderer)).toBe(true);
    expect(await frame.evaluate(()=>window.preview.camera.position.toArray())).toEqual(camera);
    expect(await frame.locator('canvas').count()).toBe(1);
    await expect(page.locator('#skin-error')).toBeHidden();
  }
  expect(await frame.evaluate(()=>window.initialPreview.disposals)).toBeGreaterThan(0);
  const transfers=await frame.evaluate(()=>window.modelTransfers);
  expect(transfers[0]).toBe(vrmFixture().length);expect(transfers.slice(1).every(n=>n===0)).toBe(true);
  // Switching motion preferences must not rebuild the renderer or reload the model.
  await page.emulateMedia({reducedMotion:'no-preference'});
  expect(await frame.evaluate(()=>window.modelTransfers.length)).toBe(transfers.length);
  await page.locator('#skin-revert').click();
  await expect(page.locator('#skin-apply')).toBeEnabled({timeout:15000});
  await expect.poll(()=>frame.evaluate(()=>window.preview.head.scale.x)).toBe(1);
  expect((await repository.get(skin.id)).visual.source).toBe(source(1));
  // A cancelled decoder can resolve after the newest scene. It must not replace or dispose it.
  await frame.evaluate(()=>{
    const decode=window.createImageBitmap;let first=true;
    window.createImageBitmap=async(...args)=>{
      if(first){first=false;await new Promise(resolve=>window.releaseOldDecode=resolve);}
      return decode(...args);
    };
  });
  await edit(source(1.5));
  await expect.poll(()=>frame.evaluate(()=>typeof window.releaseOldDecode)).toBe('function');
  await expect(page.locator('#skin-viewer')).toHaveAttribute('aria-busy','true');
  await expect(page.locator('.skin-viewer-loading')).toBeVisible();
  await edit(source(1.6));
  await expect(page.locator('#skin-apply')).toBeEnabled({timeout:15000});
  await expect.poll(()=>frame.evaluate(()=>window.preview.head.scale.x)).toBe(1.6);
  await frame.evaluate(()=>window.releaseOldDecode());
  await page.waitForTimeout(200);
  expect(await frame.evaluate(()=>window.preview.head.scale.x)).toBe(1.6);
  await expect(page.locator('#skin-error')).toBeHidden();
  await expect(page.locator('.skin-viewer-loading')).toBeHidden();
});

for (const version of ['0', '1']) test(`VRM ${version} imports with toon textures, editable bones, expressions and physics`, async ({ page, context }, testInfo) => {
  const { repository } = await skinHarness(context, page);
  await context.addInitScript(()=>{
    window.skinLifecycle=[];
    window.addEventListener('message',({data})=>{if(data.channel==='qz-skin')window.skinLifecycle.push({type:data.type,visible:data.visible,motion:data.reducedMotion,revision:data.revision,at:performance.now()});});
    window.skinRaf=[];window.skinPending=new Set();const request=window.requestAnimationFrame.bind(window),cancel=window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame=callback=>{const id=request(time=>{window.skinPending.delete(id);window.skinRaf.push({id,time,at:performance.now()});if(window.skinRaf.length>20)window.skinRaf.shift();callback(time);});window.skinPending.add(id);return id;};
    window.cancelAnimationFrame=id=>{window.skinPending.delete(id);cancel(id);};
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/extension/dom/skins/editor.html');
  await expect(page.locator('#skin-name')).toHaveValue(/Qingzhou/);
  await expect(page.locator('#skin-model-file')).toHaveAttribute('accept', /\.vrm/);
  await page.locator('#skin-model-file').setInputFiles({ name: 'Avatar.vrm', mimeType: 'application/octet-stream', buffer: vrmFixture(version) });
  await expect(page.locator('#skin-name')).toHaveValue('Avatar');
  await expect(page.locator('#skin-visual-label')).toHaveText('VRM');
  await expect(page.locator('#skin-apply')).toBeEnabled({ timeout: 15000 });
  await expect(page.locator('#skin-error')).toBeHidden();
  const id = new URL(page.url()).searchParams.get('skin'), initial = await repository.get(id);
  const source = `
    const head = vrm.humanoid.getRawBoneNode('head'); head.scale.setScalar(1.25);
    const materials = new Set(); model.traverse(node => {
      if (node.isMesh) for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
    });
    for (const material of materials) { material.color.set('#aa3355'); if (material.shadeColorFactor) material.shadeColorFactor.set('#662244'); }
    vrm.expressionManager.setValue('happy', .7);
    window.probe = { model, vrm, head, materials:[...materials], frames:0 };
    return {root:model, update(){window.probe.frames++}};
  `;
  await repository.mutate({ action: 'update', id, revision: initial.revision, patch: { visual: { type: 'model3d', source } } });
  await expect(page.locator('#skin-source')).toHaveValue(source);
  await expect(page.locator('#skin-apply')).toBeEnabled({ timeout: 15000 });
  const sandbox = () => page.frames().find(frame => frame.url().endsWith('/sandbox.html'));
  await expect.poll(() => sandbox().evaluate(() => window.probe?.head.scale.x)).toBe(1.25);
  const read = () => sandbox().evaluate(() => {
    const { head, vrm, model, materials, frames } = window.probe;
    const face = model.getObjectByName('Face');
    return { scale:head.scale.toArray(), expression:face.morphTargetInfluences[0],
      toon:materials.some(m => m.isMToonMaterial && m.map), color:materials[0].color.getHexString(),
      physics:vrm.springBoneManager.joints.size, rotation:model.rotation.y, frames };
  });
  const probe = await read();
  expect(probe.scale).toEqual([1.25, 1.25, 1.25]); expect(probe.expression).toBeCloseTo(.7);
  expect(probe.toon).toBe(true); expect(probe.color).toBe('aa3355'); expect(probe.physics).toBeGreaterThan(0);
  expect(probe.rotation).toBeCloseTo(version === '0' ? Math.PI : 0); expect(probe.frames).toBe(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(async () => (await read()).frames, {timeout:15000}).toBeGreaterThan(3).catch(async error=>{
    await testInfo.attach('skin-lifecycle.json',{body:JSON.stringify({frame:await sandbox().evaluate(()=>({events:window.skinLifecycle,hidden:document.hidden,frames:window.probe.frames,raf:window.skinRaf,pending:[...window.skinPending],now:performance.now()})),parent:await page.evaluate(()=>({events:window.skinLifecycle,hidden:document.hidden,bounds:document.querySelector('#skin-viewer').getBoundingClientRect().toJSON()}))}),contentType:'application/json'});throw error;
  });
  expect((await read()).scale).toEqual([1.25, 1.25, 1.25]);
  expect((await read()).expression).toBeCloseTo(.7);
  await page.locator('#skin-apply').click();
  await expect.poll(async () => (await repository.snapshot()).active.visual.source).toBe(source);
  await page.screenshot({ path:testInfo.outputPath(`vrm-${version}.png`) });
  await page.reload(); await expect(page.locator('#skin-apply')).toBeEnabled({ timeout:15000 });
  await expect.poll(async () => (await read()).scale[0]).toBe(1.25);
  await openAdjustments(page);
  const downloading = page.waitForEvent('download'); await page.locator('#skin-export').click();
  await page.locator('#skin-import-file').setInputFiles(await (await downloading).path());
  await expect.poll(async () => (await repository.snapshot()).skins.length).toBe(4);
  await expect(page.locator('#skin-apply')).toBeEnabled({ timeout:15000 });
  const importedId = new URL(page.url()).searchParams.get('skin');
  expect((await repository.get(importedId)).visual.src).toBe(initial.visual.src);
  await expect.poll(async () => (await read()).scale[0]).toBe(1.25);
  await repository.mutate({ action:'update', id:importedId, revision:1, patch:{ visual:{type:'model3d',source:'throw new Error("broken VRM draft");'} } });
  await expect(page.locator('#skin-error')).toContainText('broken VRM draft');
  await page.locator('#skin-revert').click();
  await expect(page.locator('#skin-apply')).toBeEnabled({ timeout:15000 });
  await expect.poll(async () => (await read()).scale[0]).toBe(1.25);
});

async function dropModels(page, files) {
  await page.evaluate(files => {
    const dataTransfer = new DataTransfer();
    for (const {name,base64} of files) dataTransfer.items.add(new File([Uint8Array.from(atob(base64), c=>c.charCodeAt(0))], name));
    document.dispatchEvent(new DragEvent('dragenter',{dataTransfer,bubbles:true,cancelable:true}));
    document.dispatchEvent(new DragEvent('drop',{dataTransfer,bubbles:true,cancelable:true}));
  }, files.map(({name,bytes})=>({name,base64:bytes.toString('base64')})));
}

test('drop multiple GLB/VRM characters, compose independent poses, export and restore together', async ({ page, context }, testInfo) => {
  const {repository}=await skinHarness(context,page);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/extension/dom/skins/editor.html');
  await expect(page.locator('#skin-apply')).toBeEnabled();
  const fox=await readFile(new URL('../fixtures/skins/Fox.glb',import.meta.url));
  await dropModels(page,[{name:'Companion.glb',bytes:fox},{name:'Whale.vrm',bytes:vrmFixture()}]);
  await expect(page.locator('#skin-character option')).toHaveText(['Companion','Whale']);
  await expect(page.locator('#skin-apply')).toBeEnabled({timeout:15000});
  await expect(page.locator('#skin-drop-target')).toBeHidden();
  const id=new URL(page.url()).searchParams.get('skin');
  const imported=await repository.get(id);
  expect(imported.visual.type).toBe('scene3d');
  await expect(page.locator('#skin-focus-character')).toHaveValue('character_2');
  await page.locator('#skin-focus-character').selectOption('character_1');
  await expect(page.locator('#skin-expressions')).toBeHidden();
  await page.locator('#skin-focus-character').selectOption('character_2');
  await expect(page.locator('#skin-expressions')).toBeVisible();
  await page.locator('[data-expression="happy"]').click();
  await expect.poll(async () => (await repository.get(id)).visual.models.character_2.expressions).toEqual({ happy: 1 });
  expect((await repository.get(id)).visual.models.character_1.expressions).toBeUndefined();
  expect(new URL(page.url()).searchParams.get('character')).toBe('character_2');
  await page.locator('[data-expression="@original"]').click();
  await openAdjustments(page);
  await page.locator('#skin-character-name').fill('鲸鱼娘');await page.locator('#skin-character-name').blur();
  await expect.poll(async()=>(await repository.get(id)).visual.models.character_2.name).toBe('鲸鱼娘');
  const source=`const fish=characters.character_2;const companion=characters.character_1;
    const vrm=fish.vrm;
    companion.root.position.set(0,.5,.7);companion.root.scale.setScalar(.6);
    fish.root.position.set(0,0,0);vrm.humanoid.getRawBoneNode('leftUpperArm').rotation.z=-.7;
    fish.vrm.humanoid.getRawBoneNode('rightUpperArm').rotation.z=.7;fish.vrm.expressionManager.setValue('happy',.6);
    window.cast=characters;return {root:model};`;
  const latest=await repository.get(id);
  await repository.mutate({action:'update',id,revision:latest.revision,patch:{visual:{type:'scene3d',source}}});
  await expect(page.locator('#skin-source')).toHaveValue(source);
  await expect(page.locator('#skin-apply')).toBeEnabled({timeout:15000});
  const probe=()=>page.frames().find(f=>f.url().endsWith('/sandbox.html')).evaluate(()=>{
    const a=window.cast.character_1,b=window.cast.character_2;
    return {count:Object.keys(window.cast).length,position:a.root.position.toArray(),scale:a.root.scale.x,
      left:b.vrm.humanoid.getRawBoneNode('leftUpperArm').rotation.z,right:b.vrm.humanoid.getRawBoneNode('rightUpperArm').rotation.z};
  });
  expect(await probe()).toEqual({count:2,position:[0,.5,.7],scale:.6,left:-.7,right:.7});
  await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForTimeout(250);
  expect((await probe()).left).toBe(-.7);
  await page.locator('#skin-apply').click();
  await expect.poll(async()=>(await repository.snapshot()).active.visual.source).toBe(source);
  await page.screenshot({path:testInfo.outputPath('two-characters-light.png'),fullPage:true});
  await page.emulateMedia({colorScheme:'dark'});await page.screenshot({path:testInfo.outputPath('two-characters-dark.png'),fullPage:true});
  const saved=await repository.get(id),revision=saved.revision;
  await dropModels(page,[{name:'Valid.vrm',bytes:vrmFixture()},{name:'Broken.glb',bytes:Buffer.from('invalid')}]);
  await expect(page.locator('#skin-error')).toBeVisible();
  expect((await repository.get(id)).revision).toBe(revision);
  await page.locator('#skin-remove-character').click();
  await expect(page.locator('#skin-character option')).toHaveCount(1);
  await page.locator('#skin-revert').click();
  await expect(page.locator('#skin-character option')).toHaveCount(2);
  await expect(page.locator('#skin-apply')).toBeEnabled({timeout:15000});
  const downloading=page.waitForEvent('download');await page.locator('#skin-export').click();
  await page.locator('#skin-import-file').setInputFiles(await(await downloading).path());
  await expect.poll(async()=>(await repository.snapshot()).skins.length).toBe(3);
  await expect(page.locator('#skin-apply')).toBeEnabled({timeout:15000});
  expect((await repository.get(new URL(page.url()).searchParams.get('skin'))).visual).toEqual(saved.visual);
});

test('adding a character preserves pending edits on the existing single model', async ({page,context})=>{
  const {repository}=await skinHarness(context,page);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/extension/dom/skins/editor.html');
  await page.locator('#skin-model-file').setInputFiles({name:'First.vrm',mimeType:'application/octet-stream',buffer:vrmFixture()});
  await expect(page.locator('#skin-name')).toHaveValue('First');
  await expect(page.locator('#skin-apply')).toBeEnabled({timeout:15000});
  await openAdjustments(page);
  await page.locator('#skin-source-details summary').click();
  const source='vrm.humanoid.getRawBoneNode("head").scale.setScalar(1.2);return {root:model};';
  await page.locator('#skin-source').fill(source);
  // A drag entering the sandbox asks the editor to put a drop surface over the iframe.
  const frame=page.frames().find(f=>f.url().endsWith('/sandbox.html'));
  await frame.evaluate(()=>{const dataTransfer=new DataTransfer();dataTransfer.items.add(new File(['x'],'Second.vrm'));window.dispatchEvent(new DragEvent('dragenter',{dataTransfer}));});
  await expect(page.locator('#skin-drop-target')).toBeVisible();
  await dropModels(page,[{name:'Second.vrm',bytes:vrmFixture()}]);
  await expect(page.locator('#skin-character option')).toHaveCount(2);
  await expect(page.locator('#skin-apply')).toBeEnabled({timeout:15000});
  const skin=await repository.get(new URL(page.url()).searchParams.get('skin'));
  expect(skin.visual.models.character_1.source).toBe(source);
  expect(skin.visual.models.character_2.source).toBe('return { root: model };');
});

test('new-chat welcome applies saved skins, resets phrases, recovers to 2D and disposes', async ({ page, context }, testInfo) => {
  const { repository } = await skinHarness(context, page);
  await page.route('**/skin-welcome-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
  await page.goto('/skin-welcome-fixture');
  await page.evaluate(async () => {
    document.head.innerHTML = '<link rel="stylesheet" href="/extension/sidepanel/sidepanel.css">';
    document.body.innerHTML = '<main id="messages" data-chat-state="landing" style="height:100vh;display:flex;align-items:center;justify-content:center"></main>';
    window.resetWelcome = () => {
      document.querySelector('#messages').innerHTML = '<div id="welcome" class="welcome"><div class="welcome-brand" style="display:flex;flex-direction:column;align-items:center"><div class="welcome-icon"></div><p class="welcome-subtitle" data-i18n="core.tagline">原始欢迎语</p></div></div>';
    };
    window.resetWelcome();
    const events = new Map(), disposers = [], lifetime = new AbortController();
    const [{createTranscriptRenderer},{createTranscriptProjection},{createSessionState}]=await Promise.all([
      import('/extension/sidepanel/features/chat/transcript/renderer.js'),
      import('/extension/sidepanel/features/chat/transcript/projection.js'),
      import('/extension/sidepanel/features/sessions/session-state.js'),
    ]);
    const messages=document.querySelector('#messages');
    const transcript=createTranscriptRenderer({messagesEl:messages,welcomeHTML:messages.innerHTML,
      sessionState:createSessionState(),projection:createTranscriptProjection(),composer:{},math:{},
      scroll:{cancelScheduledScroll(){},clearLatestIntent(){},setFollowing(){},syncScrollPosition(){}},
      showWelcome(){messages.dataset.chatState='landing';document.querySelector('#welcome').style.display='';},
    });
    window.newWelcomeChat=()=>{transcript.resetUi();events.get('ui_chat_reset')?.();};
    const { default: mount } = await import('/extension/capabilities/skins/ui.js');
    mount({ root: document, signal: lifetime.signal, chat: { messages: document.querySelector('#messages') },
      request: async (_type, { command }) => window.__skinCommand(command),
      getCurrentSessionId: () => 's', showToast() {}, on: (name, callback) => events.set(name, callback),
      onDispose: callback => disposers.push(callback),
    });
    window.__skinUiRefresh = () => events.get('skins_changed')?.();
    window.disposeWelcome = () => { lifetime.abort(); for (const dispose of disposers) dispose(); };
  });
  await expect(page.locator('.welcome-icon img')).toBeVisible();
  await expect(page.locator('[data-skin-customize]')).toHaveCount(0);
  await page.evaluate(()=>{document.querySelector('.welcome-subtitle').textContent='Updated localized tagline';window.newWelcomeChat();});
  await expect(page.locator('.welcome-subtitle')).toHaveText('Updated localized tagline');
  await page.evaluate(()=>{document.querySelector('.welcome-subtitle').textContent='原始欢迎语';window.newWelcomeChat();});
  await repository.mutate({ action: 'update', id: 'dafeiyu', revision: 1, patch: { quotes: ['第一句', '第二句'] } });
  await expect(page.locator('.welcome-subtitle')).toHaveText('原始欢迎语');
  await repository.mutate({ action: 'apply', id: 'dafeiyu', revision: 2 });
  await expect(page.locator('.welcome-icon')).toHaveClass(/skin-preview-ready/, { timeout: 15000 });
  await expect(page.locator('.welcome-subtitle')).toHaveText(/第一句|第二句/);
  const first = await page.locator('.welcome-subtitle').textContent();
  await page.screenshot({path:testInfo.outputPath('welcome-3d.png')});
  const frame=page.frames().find(f=>f.url().endsWith('/sandbox.html'));
  await frame.evaluate(()=>window.keepLoadedModel='retained');
  const loaded=await page.evaluate(()=>window.__skinMessages.filter(m=>m.type==='loaded').length);
  await page.evaluate(()=>{
    const old=document.createElement('div');old.className='old-conversation';old.textContent='Old chat';
    document.querySelector('#messages').append(old);window.newWelcomeChat();
  });
  await expect(page.locator('.old-conversation')).toHaveCount(0);
  await expect(page.locator('.welcome-subtitle')).not.toHaveText(first);
  expect(await frame.evaluate(()=>window.keepLoadedModel)).toBe('retained');
  expect(await page.evaluate(()=>window.__skinMessages.filter(m=>m.type==='loaded').length)).toBe(loaded);
  const nextQuote=await page.locator('.welcome-subtitle').textContent();
  await page.evaluate(() => window.resetWelcome());
  await expect(page.locator('.welcome-subtitle')).not.toHaveText(nextQuote);
  await expect(page.locator('[data-skin-customize]')).toHaveCount(0);
  await repository.mutate({ action: 'update', id: 'dafeiyu', revision: 2, patch: { visual: { type: 'scene3d', source: 'throw new Error("broken");' } } });
  await repository.mutate({ action: 'apply', id: 'dafeiyu', revision: 3 });
  await expect(page.locator('.welcome-icon')).toHaveClass(/skin-preview-failed/);
  const fallback = await page.locator('.welcome-icon').evaluate(element => getComputedStyle(element).backgroundImage);
  expect(fallback).toContain('/extension/icons/logo-day.png');
  const failedFrame=page.frames().find(f=>f.url().endsWith('/sandbox.html'));
  const failures=await page.evaluate(()=>window.__skinMessages.filter(m=>m.type==='error').length);
  await page.evaluate(()=>window.newWelcomeChat());
  await expect.poll(()=>page.evaluate(()=>window.__skinMessages.filter(m=>m.type==='error').length)).toBeGreaterThan(failures);
  expect(failedFrame.isDetached()).toBe(false);
  await expect(page.locator('.welcome-icon')).toHaveClass(/skin-preview-failed/);
  await repository.mutate({ action: 'apply', id: 'qingzhou', revision: 1 });
  await expect(page.locator('.welcome-icon img')).toBeVisible();
  await expect(page.locator('.welcome-subtitle')).toHaveText('原始欢迎语');
  await expect(page.locator('.welcome-icon iframe')).toHaveCount(0);
  await page.evaluate(() => window.disposeWelcome());
  await expect(page.locator('[data-skin-customize], .welcome-icon img, .welcome-icon iframe')).toHaveCount(0);
});

test('studio starts with a focused preview and chat, with adjustments available on demand', async ({page,context},testInfo)=>{
  await skinHarness(context,page);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.setViewportSize({width:1280,height:800});
  await page.goto('/extension/dom/skins/editor.html?skin=dafeiyu');
  await expect(page.locator('#skin-apply')).toBeEnabled({timeout:15000});
  await expect(page.locator('#skin-inspector')).toBeHidden();
  await expect(page.locator('#skin-copy-prompt')).toBeHidden();
  await expect(page.locator('.skin-preview-stage #skin-open-chat')).toBeInViewport();
  await expect(page.locator('.skin-library-item[aria-pressed="true"] .skin-library-symbol img')).toBeVisible();
  await page.reload();
  await expect(page.locator('.skin-library-item[aria-pressed="true"] .skin-library-symbol img')).toBeVisible();
  await expect(page.locator('#skin-apply')).toBeEnabled({timeout:15000});
  expect(await page.locator('#skin-viewer iframe').count()).toBe(1);
  for(const colorScheme of ['light','dark']) {
    await page.emulateMedia({colorScheme});
    await page.screenshot({path:testInfo.outputPath(`studio-focused-${colorScheme}.png`)});
  }
  const frame=page.frames().find(frame=>frame.url().includes('sandbox.html'));
  await frame.evaluate(()=>window.originalCanvas=document.querySelector('canvas'));
  await openAdjustments(page);
  await expect(page.locator('#skin-toggle-inspector')).toHaveAttribute('aria-expanded','true');
  await page.locator('#skin-name').focus(); await page.keyboard.press('Escape');
  await expect(page.locator('#skin-inspector')).toBeHidden();
  await expect(page.locator('#skin-toggle-inspector')).toBeFocused();
  expect(await frame.evaluate(()=>window.originalCanvas===document.querySelector('canvas'))).toBe(true);
  for(const width of [960,390,320]) {
    await page.setViewportSize({width,height:700});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect(page.locator('#skin-open-chat')).toBeVisible();
  }
});

test('toolbar opens the studio directly, retains chat drafts and recovers from an opening failure', async ({page},testInfo)=>{
  await page.addInitScript(installBenchmarkChromeStub,{benchmark:false,uiLanguage:'zh-CN'});
  await page.addInitScript(()=>{
    const connect=chrome.runtime.connect;
    chrome.runtime.connect=(...args)=>{
      const port=connect(...args),post=port.postMessage;
      port.postMessage=message=>{
        if(message.type!=='skin_command')return post(message);
        window.__qzPostedMessages.push(structuredClone(message));
        if(['list','welcome'].includes(message.command.action))return;
        window.replyStudio=failed=>window.__qzEmitPortMessage({type:'skin_command_result',requestId:message.requestId,
          ...(failed?{error:'SKIN_NOT_FOUND',code:'SKIN_NOT_FOUND'}:{result:{id:'qingzhou',tab:{id:1}}})});
      };return port;
    };
  });
  await page.goto('/extension/sidepanel/sidepanel.html');
  const entry=page.getByRole('button',{name:'皮肤工坊',exact:true});
  await expect(entry).toBeVisible();
  await page.locator('#input').fill('把头再放大一点');
  await entry.click(); await expect(entry).toBeDisabled();
  expect(await page.evaluate(()=>window.__qzPostedMessages.filter(m=>m.type==='skin_command'&&m.command.action==='open').length)).toBe(1);
  await page.evaluate(()=>window.replyStudio(true));await expect(entry).toBeEnabled();
  await expect(page.locator('#input')).toHaveValue('把头再放大一点');
  await entry.click();await page.evaluate(()=>window.replyStudio(false));await expect(entry).toBeEnabled();
  await expect(page.locator('#input')).toHaveValue('把头再放大一点');
  await expect(page.locator('[data-skin-customize]')).toHaveCount(0);
  for(const colorScheme of ['light','dark']) {
    await page.emulateMedia({colorScheme});await page.setViewportSize({width:320,height:700});
    await expect(entry).toBeInViewport();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:testInfo.outputPath(`studio-entry-${colorScheme}.png`)});
  }
});

test('closed welcome restores its transparent preview and camera while fresh 3D loads', async ({ page, context }) => {
  const { repository } = await skinHarness(context, page);
  const skin = await repository.get('dafeiyu');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/skin-reopen-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><link rel="stylesheet" href="/extension/sidepanel/sidepanel.css"><div class="welcome-icon qz-skin-viewer" data-skin-visual="scene3d" id="preview"></div>' }));
  async function mount() {
    await page.goto('/skin-reopen-fixture');
    await page.evaluate(async skin => {
      const { createSkinViewer } = await import('/extension/dom/skins/viewer.js');
      const { readWelcomePreview } = await import('/extension/dom/skins/welcome-preview.js');
      window.viewer = createSkinViewer(document.querySelector('#preview'), { welcomePreview: readWelcomePreview(), rememberView: true,
        onStatus(ready, message) { window.previewReady = ready; window.previewError = message; } });
      window.viewer.setSkin(skin);
    }, skin);
  }
  await mount(); await page.waitForFunction(() => window.previewReady);
  const canvas = page.frameLocator('iframe').locator('canvas');
  const bounds = await canvas.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * .4, bounds.y + bounds.height * .5);
  await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width * .7, bounds.y + bounds.height * .5, { steps: 5 }); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('qingzhou_welcome_preview_v1') || 'null')?.view?.position[0] || 0)).not.toBe(0);
  const previous = await page.evaluate(() => JSON.parse(localStorage.getItem('qingzhou_welcome_preview_v1')));
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  await page.route('**/dom/skins/sandbox.js', async route => { await hold; await route.continue(); });
  await mount();
  await expect(page.locator('.skin-viewer-poster')).toBeVisible();
  await expect(page.locator('.skin-viewer-poster')).toHaveAttribute('src', previous.image);
  await expect(page.locator('.skin-viewer-loading')).toBeHidden();
  expect(await page.evaluate(() => window.previewReady)).toBe(false);
  release(); await page.waitForFunction(() => window.previewReady);
  await expect(page.locator('.skin-viewer-poster')).toHaveCount(0);
  const captured = await page.evaluate(() => window.viewer.capture());
  expect(captured.view.position[0]).toBeCloseTo(previous.view.position[0], 3);
  expect(captured.image).toMatch(/^data:image\/png;base64,/);
  const alpha = await page.evaluate(async image => {
    const bitmap = await createImageBitmap(await (await fetch(image)).blob());
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close();
    const values = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let clear = 0, painted = 0; for (let i = 3; i < values.length; i += 4) { if (!values[i]) clear++; else painted++; }
    return { clear, painted };
  }, captured.image);
  expect(alpha.clear).toBeGreaterThan(0); expect(alpha.painted).toBeGreaterThan(100);
  await page.evaluate(skin => window.viewer.setSkin({ ...skin, revision: skin.revision + 1,
    visual: { type: 'scene3d', source: 'const broken = ;' } }), skin);
  await page.waitForFunction(() => window.previewError);
  expect(await page.evaluate(() => window.viewer.capture().then(() => false, error => error.code))).toBe('SKIN_PREVIEW_UNAVAILABLE');
  await page.evaluate(() => window.viewer.dispose());
});

test('cached welcome never covers another skin and 2D captures remain available', async ({ page, context }) => {
  const { repository } = await skinHarness(context, page);
  const skin = await repository.get('qingzhou');
  await page.route('**/skin-capture-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="preview" style="width:100px;height:100px"></div>' }));
  await page.goto('/skin-capture-fixture');
  await page.evaluate(async skin => {
    const { createSkinViewer } = await import('/extension/dom/skins/viewer.js');
    window.viewer = createSkinViewer(document.querySelector('#preview'), { rememberView: true,
      welcomePreview: { id: 'other', revision: 1, name: 'Other', type: 'scene3d', quote: '', image: 'data:image/png;base64,AAAA', width: 1, height: 1 },
      onStatus(ready) { window.previewReady = ready; } });
    window.viewer.setSkin(skin);
  }, skin);
  await page.waitForFunction(() => window.previewReady);
  await expect(page.locator('.skin-viewer-poster')).toHaveCount(0);
  const capture = await page.evaluate(() => window.viewer.capture());
  expect(capture.image).toMatch(/^data:image\/png;base64,/); expect(capture.width).toBeGreaterThan(1);
  expect(await page.evaluate(() => localStorage.getItem('qingzhou_welcome_preview_v1'))).toBeNull();
});

test('welcome validates cached versions and recovers a corrupt render cache from Background', async ({ page, context }) => {
  const { repository } = await skinHarness(context, page);
  await repository.mutate({ action: 'apply', id: 'dafeiyu', revision: 1 });
  const skin = await repository.get('dafeiyu');
  await page.route('**/skin-cache-recovery', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><link rel="stylesheet" href="/extension/sidepanel/sidepanel.css"><main id="messages" data-chat-state="landing"><div id="welcome"><div class="welcome-brand"><div class="welcome-icon"></div><p class="welcome-subtitle">Hello</p></div></div></main>' }));
  await page.goto('/skin-cache-recovery');
  await page.evaluate(async skin => {
    const { writeWelcomeVisual } = await import('/extension/dom/skins/welcome-preview.js');
    await writeWelcomeVisual({ ...skin, visual: { type: 'scene3d', source: 'const broken = ;' } });
    window.welcomeRequests = [];
    const { default: mount } = await import('/extension/capabilities/skins/ui.js');
    mount({ root: document, signal: new AbortController().signal, chat: { messages: document.querySelector('#messages') },
      request: async (_type, { command }) => { window.welcomeRequests.push(command); return window.__skinCommand(command); },
      getCurrentSessionId: () => '', showToast() {}, on() {}, onDispose() {},
    });
  }, skin);
  await expect(page.locator('.welcome-icon')).toHaveClass(/skin-preview-ready/, { timeout: 15000 });
  const requests = await page.evaluate(() => window.welcomeRequests);
  expect(requests[0]).toMatchObject({ action: 'welcome', id: skin.id, revision: skin.revision });
  expect(requests.some(command => command.action === 'welcome' && !command.id)).toBe(true);
  await expect.poll(() => page.evaluate(async () => (await (await import('/extension/dom/skins/welcome-preview.js')).readWelcomeVisual())?.visual.source)).toBe(skin.visual.source);
});
