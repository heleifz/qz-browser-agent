import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from './fixtures.mjs';
import { flowFixture } from '../fixtures/flow-display.mjs';

async function setup(page, entry = flowFixture(), language = 'zh-CN', expanded = true) {
  await page.goto('/tests/tool-timeline/visual-test.html', { waitUntil: 'networkidle' });
  await page.evaluate(async ({ entry, language, expanded }) => {
    const { renderToolEvent, patchToolEvent } = await import('/extension/sidepanel/tools/tool-renderer.js');
    const { withLanguage } = await import('/extension/shared/i18n/index.js');
    document.querySelector('#visual-device').style.setProperty('--visual-width', '360px');
    window.flowEntry = entry;
    window.flowPatch = value => withLanguage(language, () => patchToolEvent(document.querySelector('#messages > .msg-tool'), value, { presentationState: { userToggled: true, expanded: true } }));
    withLanguage(language, () => document.querySelector('#messages').replaceChildren(renderToolEvent(entry, { expanded })));
  }, { entry, language, expanded });
}

for (const colorScheme of ['light', 'dark']) for (const state of ['running', 'completed', 'error']) {
  test(`flow control · ${colorScheme} · ${state}`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await setup(page, flowFixture(state));
    const card = page.locator('.qz-flow');
    await expect(card).toHaveAttribute('data-state', state);
    await expect(card.locator('.qz-flow-step')).toHaveCount(4);
    await expect(card.locator('.qz-flow-step-outcome').nth(1)).toContainText('页面地址已改变');
    await expect(card.locator('.qz-flow-step-outcome').nth(2)).toContainText('等待条件已命中');
    await expect(card.locator('[data-flow-detail="source"]')).not.toHaveAttribute('open', '');
    const layout = await card.evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth, body: getComputedStyle(node).backgroundColor }));
    expect(layout.scroll).toBeLessThanOrEqual(layout.width + 1);
    expect(layout.body).not.toBe('rgba(0, 0, 0, 0)');
    if (state === 'error') await expect(card.locator('[data-state="error"]')).toContainText('STALE_ELEMENT_UID');
    const directory = process.env.QZ_FLOW_UI_SHOTS;
    if (directory) await mkdir(directory, { recursive: true });
    await page.locator('#messages > .msg-tool').screenshot({ path: directory ? join(directory, `${colorScheme}-${state}.png`) : info.outputPath(`${colorScheme}-${state}.png`) });
  });
}

test('disclosures, keyboard focus and row identity survive updates, Stop and legacy routing', async ({ page }) => {
  const running = flowFixture('running'); running.profileFamily = 'script'; delete running.rendererId;
  await setup(page, running, 'en');
  await expect(page.locator('.qz-flow-status')).toHaveText('Running');
  const summary = page.locator('[data-flow-detail="source"] > summary');
  await summary.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('[data-flow-detail="source"]')).toHaveAttribute('open', '');
  await page.evaluate(() => { window.firstFlowRow = document.querySelector('[data-flow-step="1"]'); });
  const stopped = flowFixture('aborted'); stopped.profileFamily = 'script'; delete stopped.rendererId;
  await page.evaluate(entry => window.flowPatch(entry), stopped);
  await expect(summary).toBeFocused();
  await expect(page.locator('[data-flow-detail="source"]')).toHaveAttribute('open', '');
  await expect(page.locator('.qz-flow-status')).toHaveText('Stopped');
  await expect(page.locator('[data-flow-step="4"] .qz-flow-step-state')).toHaveText('Stopped');
  expect(await page.evaluate(() => window.firstFlowRow === document.querySelector('[data-flow-step="1"]'))).toBe(true);
});

test('default compact summary, narrow RTL, long content and hostile values stay bounded', async ({ page }) => {
  const entry = flowFixture();
  entry.args.code = '// <img src=x onerror="window.flowInjected=true">\n' + 'const longName = "very-long-value";\n'.repeat(3000);
  entry.result.finalObservation.snapshot.snapshot = '<script>window.flowInjected=true</script>\n' + 'AX node '.repeat(8000);
  entry.result._display.flow.steps = Array.from({ length: 128 }, (_, i) => ({ id: i + 1, tool: 'read_article', target: 'long-target'.repeat(80), state: 'completed', elapsedMs: 1 }));
  entry.result._display.flow.total = 140; entry.result._display.flow.omitted = 12;
  await setup(page, entry, 'en', false);
  await expect(page.locator('.qz-flow')).toHaveCount(0);
  await page.locator('.tool-summary').click();
  await expect(page.locator('.qz-flow')).toBeVisible();
  await page.evaluate(() => { document.documentElement.dir = 'rtl'; document.querySelector('#visual-device').style.setProperty('--visual-width', '320px'); });
  await page.locator('[data-flow-detail="source"] > summary').click();
  await page.locator('[data-flow-detail="observation"] > summary').click();
  expect(await page.evaluate(() => window.flowInjected)).toBeUndefined();
  expect(await page.locator('.qz-flow').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  expect(await page.locator('.qz-flow-steps').evaluate(node => node.clientHeight <= 360)).toBe(true);
  expect(await page.locator('[data-flow-detail="source"] pre').evaluate(node => node.clientHeight <= 260)).toBe(true);
  await expect(page.locator('.qz-flow-note').first()).toContainText('12');
  await page.locator('.qz-flow-steps').evaluate(node => { node.scrollTop = 0; });
  entry.result._display.flow.steps.at(-1).elapsedMs = 42;
  await page.evaluate(entry => window.flowPatch(entry), entry);
  expect(await page.locator('.qz-flow-steps').evaluate(node => node.scrollTop)).toBe(0);
  await expect(page.locator('[data-flow-detail="source"]')).toHaveAttribute('open', '');
});
