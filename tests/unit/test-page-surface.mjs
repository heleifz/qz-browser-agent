import assert from "node:assert/strict";
import test from "node:test";

const surfaces = [];
let activated = 0;
globalThis.chrome = {
  scripting: {
    async executeScript() {
      return [{ result: surfaces.shift() }];
    },
  },
  tabs: {
    async update() { activated += 1; },
  },
};

const { ensurePageSurface, pageSurfaceReady } = await import("../../src/background/tools/page-surface.ts");

function surface(outerWidth, outerHeight = outerWidth) {
  return {
    outerWidth,
    outerHeight,
    innerWidth: outerWidth,
    innerHeight: outerHeight,
    visibilityState: outerWidth ? "visible" : "hidden",
  };
}

test("background tabs are laid out before mouse input or a screenshot", async () => {
  surfaces.push(surface(1200, 800));
  const readyCalls = [];
  const ready = await ensurePageSurface(7, async (method) => {
    readyCalls.push(method);
    return {};
  });
  assert.equal(pageSurfaceReady(ready), true);
  assert.deepEqual(readyCalls, []);

  surfaces.push(surface(0, 0), surface(1100, 1049));
  const heights = [1105, 1049, 1049];
  const warmCalls = [];
  const warmed = await ensurePageSurface(7, async (method) => {
    warmCalls.push(method);
    if (method === "Page.captureScreenshot") return { data: "discarded" };
    return { cssVisualViewport: { clientWidth: 1100, clientHeight: heights.shift() ?? 1049 } };
  });
  assert.equal(warmed.outerWidth, 1100);
  assert.equal(warmed.outerHeight, 1049);
  assert.equal(warmCalls.filter(method => method === "Page.captureScreenshot").length, 1);
  assert.equal(activated, 0);

  const before = activated;
  surfaces.push(surface(0, 0), surface(0, 0), surface(800, 600));
  const focused = await ensurePageSurface(7, async (method) => (
    method === "Page.getLayoutMetrics" ? { cssVisualViewport: { clientWidth: 800, clientHeight: 600 } } : {}
  ));
  assert.equal(pageSurfaceReady(focused), true);
  assert.equal(activated, before + 1);
});
