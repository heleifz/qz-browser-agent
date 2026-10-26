import { createServer } from 'node:http';
import { test, expect } from './fixtures.mjs';
import { createAxViewportHarness } from '../support/ax-viewport-harness.mjs';
import { preparePublicTask, readPublicOracle } from '../live/ax-viewport-public-cases.mjs';

test('public AX measurement binds Content after a startup document replacement', async () => {
  const server = createServer((request, response) => response.writeHead(200, { 'content-type': 'text/html' }).end(
    request.url === '/ready'
      ? '<title>Ready document</title><body style="height:2000px"><h1>Ready document</h1><button>Ready action</button>'
      : '<title>Starting</title><script>setTimeout(() => location.replace("/ready"), 50)</script>',
  ));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let h;
  try {
    h = await createAxViewportHarness();
    const navigation = await h.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded', settleMs: 500 });
    expect(navigation.url).toMatch(/\/ready$/);
    const snapshot = await h.snapshot({});
    expect(snapshot.pageOverviewError).toBeUndefined();
    expect(snapshot.title).toBe('Ready document');
    expect(snapshot.snapshot).toContain('Ready action');
    const task = { group: 'in-view', probe: { css: 'h1' }, fromProbe: true };
    expect((await preparePublicTask(h.page, task)).expected).toEqual(['Ready document']);
    await expect(preparePublicTask(h.page, { ...task, group: 'off-screen' })).rejects.toThrow('not initially off-screen');
    await h.page.locator('h1').evaluate(el => { el.textContent = 'Updated headline'; });
    expect((await readPublicOracle(h.page, task)).expected).toEqual(['Updated headline']);
    const scrolled = await h.scroll({ direction: 'bottom' });
    expect(scrolled).not.toHaveProperty('error');
  } finally {
    await h?.close();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
});
