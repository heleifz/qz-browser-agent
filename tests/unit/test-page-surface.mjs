import assert from "node:assert/strict";
import test from "node:test";

const sizes = [];
let activated = 0;
globalThis.chrome = {
  scripting: {
    async executeScript() {
      return [{ result: sizes.shift() }];
    },
  },
  tabs: {
    async update() { activated += 1; },
  },
};

const { ensurePageSurface } = await import("../../src/background/tools/page-surface.ts");

test("a zero outer size gets one warmup capture, then the tab is brought forward", async () => {
  sizes.push({ width: 1200, height: 800 });
  const ready = [];
  await ensurePageSurface(7, async (method) => { ready.push(method); });
  assert.deepEqual(ready, []);

  sizes.push({ width: 0, height: 0 }, { width: 1100, height: 1049 });
  const warm = [];
  await ensurePageSurface(7, async (method) => { warm.push(method); return {}; });
  assert.deepEqual(warm, ["Page.captureScreenshot"]);
  assert.equal(activated, 0);

  sizes.push({ width: 0, height: 0 }, { width: 0, height: 0 });
  await ensurePageSurface(7, async () => ({}));
  assert.equal(activated, 1);
});
