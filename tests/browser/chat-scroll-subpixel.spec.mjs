import { expect, test } from "./sidepanel-fixtures.mjs";
import { imageTranscript } from "../support/markdown-stream-fixture.mjs";

test.use({ viewport: { width: 430, height: 760 }, launchOptions: { args: ["--enable-smooth-scrolling"] } });

for (const colorScheme of ["light", "dark"]) test(`native wheel at the fractional tail preserves the visible timeline · ${colorScheme}`, async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme });
  await page.evaluate(async transcript => {
    await window.qingzhouConversationBenchmark.runLiveReplay({ sessionId: "fractional-tail", baseTranscript: transcript.slice(0, -1), events: [] }, { runId: transcript.at(-1).runId });
  }, imageTranscript());
  const card = page.locator(".msg-tool-timeline");
  await card.locator(":scope > .tool-summary").click();
  await card.locator('[data-tool-timeline-index="2"]').click();
  await expect(card.locator(".tool-image-grid-scroll")).toBeVisible();
  await card.locator(".tool-timeline-collapse-btn").hover();
  await page.evaluate(() => {
    window.__fractionalFrames = [];
    window.__fractionalSampling = true;
    const sample = () => {
      const m = document.querySelector("#messages");
      window.__fractionalFrames.push({ top: m.scrollTop, height: m.scrollHeight, client: m.clientHeight,
        viewport: m.getBoundingClientRect().toJSON(),
        card: m.querySelector(".msg-tool-timeline").getBoundingClientRect().toJSON() });
      if (window.__fractionalSampling) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  // Keep content fixed: no stream update can conceal the wheel's boundary clamp.
  await page.mouse.wheel(0, 1000);
  await page.waitForTimeout(400);
  await page.mouse.wheel(0, 1000);
  await page.waitForTimeout(200);
  const frames = await page.evaluate(() => { window.__fractionalSampling = false; return window.__fractionalFrames; });
  await testInfo.attach("subpixel-scroll.json", { body: Buffer.from(JSON.stringify(frames, null, 2)), contentType: "application/json" });
  expect(frames.length).toBeGreaterThan(5);
  expect(frames[0].height - frames[0].client - frames[0].top).toBe(0);
  expect(new Set(frames.map(f => f.top)).size, JSON.stringify(frames)).toBe(1);
  expect(new Set(frames.map(f => f.card.top - f.viewport.top)).size, JSON.stringify(frames)).toBe(1);
  // Upward history intent must still use native scrolling.
  await page.mouse.wheel(0, -60);
  await expect.poll(() => page.locator("#messages").evaluate(node => node.scrollTop)).toBeLessThan(frames[0].top - 20);
});
