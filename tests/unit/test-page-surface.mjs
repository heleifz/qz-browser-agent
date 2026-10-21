import assert from "node:assert/strict";
import test from "node:test";

const sizes = [];
globalThis.chrome = {
  scripting: {
    async executeScript() {
      return [{ result: sizes.shift() }];
    },
  },
};

const { ensurePageSurface } = await import("../../src/background/tools/page-surface.ts");

test("a zero outer size gets one warmup capture and the tab stays in the background", async () => {
  sizes.push({ width: 1200, height: 800 });
  const ready = [];
  await ensurePageSurface(7, async (method) => { ready.push(method); });
  assert.deepEqual(ready, []);

  sizes.push({ width: 0, height: 0 });
  const warm = [];
  await ensurePageSurface(7, async (method) => { warm.push(method); return {}; });
  assert.deepEqual(warm, ["Page.captureScreenshot"]);
});
