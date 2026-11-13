import { createServer } from 'node:http';
import { test, expect } from './fixtures.mjs';
import { callTool } from '../../services/mcp-bridge/src/client.mjs';
import { buildScriptRequest } from '../../services/mcp-bridge/src/script-call.mjs';

// Three visible report links precede the items; 5000 visible links fill the 5000-entry element registries exactly.
const LINKS = 5000;
const ITEMS = LINKS - 3;

test('page.find returns every match as an Array in nth order while find_elements keeps its limit', async () => {
  test.setTimeout(180_000);
  const { launchIsolatedExtensionMcp } = await import('../support/isolated-extension-mcp.mjs');
  const items = Array.from({ length: ITEMS }, (_, index) => `<li><a href="/item/${index}">Item ${index}</a></li>`).join('');
  const server = createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><title>Links</title><nav><a href="/monthly">Monthly Report</a><a href="/report">Report</a>
      <a href="/archive">Report archive</a><a href="/hidden" hidden>Hidden Report</a><a href="/none" style="display:none">None</a></nav>
      <ul>${items}</ul>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  let environment, sessionId;
  try {
    environment = await launchIsolatedExtensionMcp({ profilePrefix: 'qz-find-array-' });
    ({ sessionId } = await callTool(environment.bridge.endpoint, 'qingzhou_create_drive_session', { title: 'Find array' }));
    await callTool(environment.bridge.endpoint, 'qingzhou_execute_tool', { sessionId, name: 'open_tab', args: { url, tabAlias: 'page' } });
    const run = async code => (await callTool(environment.bridge.endpoint, 'qingzhou_execute_tool', buildScriptRequest({ sessionId, code, timeout: 120 }))).result;

    const large = await run(`
      const page = qz.tab('page');
      const started = Date.now();
      const links = await page.find({role:'link'});
      const ms = Date.now() - started;
      const sampled = [0, 3, 2500, links.length - 1];
      const nth = [];
      for (const index of sampled) nth.push((await page.locator({role:'link', nth:index}).inspect()).name);
      const names = [];
      for (const link of links) names.push(link.name);
      return {
        ms, isArray: Array.isArray(links), length: links.length, count: await page.locator({role:'link'}).count(),
        hiddenLength: (await page.find({role:'link', includeHidden:true})).length,
        hiddenCount: await page.locator({role:'link', includeHidden:true}).count(),
        sliced: links.slice(0, 5).map(link => link.name), mapped: links.map(link => link.target).filter(Boolean).length,
        distinct: new Set(links.map(link => link.target)).size, sampled: sampled.map(index => links[index].name), nth, names: names.length,
        shape: Object.keys(links[0]).filter(key => ['target', 'role', 'name', 'text', 'rect'].includes(key)).sort(),
        rect: Object.keys(links[0].rect).sort(), capped: (await page.find({role:'link', limit:3})).map(link => link.name),
      };
    `);
    expect(large.ok, JSON.stringify(large)).toBe(true);
    const found = large.result;
    expect(found.isArray).toBe(true);
    expect(found.length).toBe(LINKS);
    expect(found.count).toBe(found.length);
    expect(found.names).toBe(found.length);
    expect(found.hiddenCount).toBe(LINKS + 2);
    expect(found.hiddenLength).toBe(found.hiddenCount);
    expect(found.sliced).toEqual(['Monthly Report', 'Report', 'Report archive', 'Item 0', 'Item 1']);
    expect(found.mapped).toBe(found.length);
    expect(found.distinct).toBe(found.length);
    expect(found.nth).toEqual(found.sampled);
    expect(found.shape).toEqual(['name', 'rect', 'role', 'target', 'text']);
    expect(found.rect).toEqual(['height', 'width', 'x', 'y']);
    expect(found.capped).toEqual(['Monthly Report', 'Report', 'Report archive']);
    expect(found.ms, `page.find of ${found.length} links took ${found.ms} ms`).toBeLessThan(5_000);

    const ordered = await run(`
      const page = qz.tab('page');
      const query = {role:'link', text:'Report', exact:false};
      const found = await page.find(query);
      const nth = [];
      for (let index = 0; index < found.length; index++) nth.push((await page.locator({...query, nth:index}).inspect()).name);
      const pattern = await page.find({role:'link', pattern:/report/i, includeHidden:true});
      return { found: found.map(link => link.name), nth, pattern: pattern.map(link => new URL(link.href).pathname),
        none: await page.find({role:'link', name:'Missing'}) };
    `);
    expect(ordered).toMatchObject({ ok: true, result: {
      found: ['Report', 'Report archive', 'Monthly Report'],
      nth: ['Report', 'Report archive', 'Monthly Report'],
      pattern: ['/report', '/archive', '/monthly', '/hidden'],
      none: [],
    } });

    const raw = (await callTool(environment.bridge.endpoint, 'qingzhou_execute_tool', {
      sessionId, name: 'find_elements', args: { tabRef: 'page', role: 'link' },
    })).result;
    expect(raw.results).toHaveLength(20);
    expect(raw.total).toBe(LINKS);
    expect(raw.truncated).toBe(true);
    expect(raw.results[0]).toMatchObject({ name: 'Monthly Report', target: expect.stringMatching(/^uid:/), lineRange: expect.any(Array) });
    expect(raw.results[0]).toHaveProperty('obscuredAtCenter');
    const capped = (await callTool(environment.bridge.endpoint, 'qingzhou_execute_tool', {
      sessionId, name: 'find_elements', args: { tabRef: 'page', role: 'link', limit: 500 },
    })).result;
    expect(capped.results).toHaveLength(100);
    const tools = (await callTool(environment.bridge.endpoint, 'qingzhou_execute_tool', { sessionId, name: 'list_tools', args: {} })).result;
    expect(JSON.stringify(tools)).not.toContain('find_all_elements');
  } finally {
    if (sessionId) await callTool(environment.bridge.endpoint, 'qingzhou_stop_session', { sessionId }).catch(() => {});
    await environment?.close();
    server.close();
  }
});
