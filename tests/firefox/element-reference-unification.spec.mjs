import { test, expect } from './fixture.mjs';
import { startElementReferencePage } from '../support/element-reference-page.mjs';

const uidPattern = /^uid:t\d+\.[0-9a-z]{6}\.\d+$/;
function targetFor(tree, label, role = '') {
  return tree.snapshot.split('\n').find(line => line.includes(`"${label}"`) && (!role || line.includes(` ${role} `)))?.match(/target=(uid:\S+)/)?.[1];
}

test('Firefox shares backend-node UIDs across readers, frames and UID absence waits', async ({ firefoxSidebar }) => {
  const fixture = await startElementReferencePage();
  const page = await firefoxSidebar.context.newPage();
  try {
    await page.goto(fixture.url);
    await page.frameLocator('#cross').locator('#frame-action').waitFor();
    const tabId = await firefoxSidebar.extension('background', `
      return (await view.chrome.tabs.query({})).find(tab => tab.url === ${JSON.stringify(fixture.url)}).id;
    `);
    const call = (name, args = {}) => firefoxSidebar.extension('background', `
      const request = ${JSON.stringify({ name, args: { tabId, ...args } })};
      const context = Cu.cloneInto({sessionId:'firefox-refs',runId:'drive-firefox-refs',workingTabId:${tabId},source:'agent'},content);
      try {
        const tools=view.__qzFirefoxPageTools;
        const result=await tools.execute(request.name,Cu.cloneInto(request.args,content),undefined,context);
        const project=tools.getModelPolicy(request.name)?.projectResult;
        return JSON.parse(JSON.stringify(project ? project(result) : result));
      }
      catch(error) { const failure=Cu.waiveXrays(error); return {message:String(failure.message),code:String(failure.code || '')}; }
    `);
    const found = await call('find_elements', { target: 'body', tags: ['button', 'img'], limit: 40 });
    expect(found.message, JSON.stringify(found)).toBeUndefined();
    expect(found.results.every(item => uidPattern.test(item.target) && !('selector' in item) && !('uid' in item))).toBe(true);
    const alpha = found.results.find(item => item.name === 'Alpha' || item.text === 'Alpha');
    expect((await call('act_on_element', { target: alpha.target, action: 'click' })).message).toBeUndefined();
    await expect(page.locator('#alpha')).toHaveAttribute('data-clicked', 'yes');
    const inspected = await call('inspect_element', { target: '#alpha' });
    expect(inspected.target).toMatch(uidPattern);
    expect(inspected.parent.target).toMatch(uidPattern);
    const listed = await call('list_images', { selector: '#photo' });
    expect(listed.images[0].target).toMatch(uidPattern);
    expect((await call('act_on_element', { target: listed.images[0].target, action: 'click' })).message).toBeUndefined();
    await expect(page.locator('body')).toHaveAttribute('data-image-clicked', 'yes');
    const shot = await call('screenshot', { target: listed.images[0].target });
    expect(shot.message, JSON.stringify(shot)).toBeUndefined();
    expect(shot._image).toMatch(/^data:image\//);
    const wait = await call('wait_for_element', { target: '#alpha', timeout: 1 });
    expect(wait.element.target).toMatch(uidPattern);
    await page.locator('#alpha').evaluate(element => { element.style.display = 'none'; });
    const hidden = await call('wait_for_element', { target: alpha.target, absent: true, timeout: 5 });
    expect(hidden, JSON.stringify(hidden)).toMatchObject({ found: false, element: null });
    expect(hidden.timedOut).toBeUndefined();
    await page.locator('#alpha').evaluate(element => { const next = element.cloneNode(true); next.style.display = ''; element.replaceWith(next); });
    const gone = await call('wait_for_element', { target: alpha.target, absent: true, timeout: 5 });
    expect(gone, JSON.stringify(gone)).toMatchObject({ found: false, element: null });
    const stale = await call('act_on_element', { target: alpha.target, action: 'click' });
    expect(stale.code, JSON.stringify(stale)).toMatch(/STALE_ELEMENT_UID/);
    const invalidTarget = await call('read_dom', { target: 'css:[' });
    expect(invalidTarget.code, JSON.stringify(invalidTarget)).toBe('INVALID_SELECTOR');
    expect(invalidTarget.message).toBeTruthy();
    expect(invalidTarget.hint).toBeTruthy();
    expect(invalidTarget.details.target).toBe('css:[');
    expect(Object.keys(invalidTarget).every(key => ['code', 'message', 'hint', 'details'].includes(key))).toBe(true);
    expect(JSON.stringify(invalidTarget)).not.toMatch(/"(?:selector|tabId)":/);

    const syntax = await call('run_script', { code: 'async () => { const value = ; }', timeout: 20 });
    expect(syntax.code, JSON.stringify(syntax)).toBe('SCRIPT_EVALUATION_FAILED');
    expect(syntax.message).toMatch(/SyntaxError/);
    expect(Object.keys(syntax).every(key => ['code', 'message', 'hint', 'details'].includes(key))).toBe(true);
    expect(syntax.hint).toBeTruthy();

    const tree = await call('get_ax_tree', { scope: 'full', depth: 12, limit: 100 });
    expect(tree.message, JSON.stringify(tree)).toBeUndefined();
    for (const kind of ['same', 'cross']) {
      const root = targetFor(tree, `Child document ${kind}`, 'RootWebArea');
      expect(root || '', tree.snapshot).toMatch(uidPattern);
      const candidates = await call('find_elements', { target: root, roles: ['button'], limit: 5 });
      expect(candidates.message, JSON.stringify(candidates)).toBeUndefined();
      const clicked = await call('act_on_element', { target: candidates.results[0].target, action: 'click' });
      expect(clicked.message, JSON.stringify(clicked)).toBeUndefined();
      await expect(page.frameLocator(`#${kind}`).locator('body')).toHaveAttribute('data-clicked', 'yes');
      const image = targetFor(tree, `Frame picture ${kind}`);
      const images = await call('list_images', { target: image });
      expect(images.message, JSON.stringify(images)).toBeUndefined();
      expect(images.images[0].target).toMatch(uidPattern);
      const frameShot = await call('screenshot', { target: images.images[0].target });
      expect(frameShot.message, JSON.stringify(frameShot)).toBeUndefined();
    }
  } finally { await page.close(); await fixture.close(); }
});
