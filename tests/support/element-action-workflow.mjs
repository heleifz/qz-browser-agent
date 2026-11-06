import { createServer } from 'node:http';

export async function startElementActionWorkflow() {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (request.url === '/popup') { response.end('<!doctype html><title>Action popup</title><p>Popup result</p>'); return; }
    if (request.url === '/frame') {
      response.end(`<!doctype html><title>Action frame</title><button id="frame-hover" style="width:160px;height:44px"
        onmousemove="this.dataset.hovered='yes'"><span aria-label="Frame hover">Frame icon</span></button>`);
      return;
    }
    response.end(`<!doctype html><meta charset="utf-8"><title>Element action workflow</title>
      <style>
        body{margin:20px;font:16px sans-serif}button{width:145px;height:44px;margin:6px}
        #covered{position:relative;display:inline-block}#overlay{position:absolute;inset:0;background:#888}
        .hover-cover{position:relative;display:inline-block}.hover-cover>span{position:absolute;inset:0;background:#888}
        .move-cover{position:relative;display:inline-block;width:330px;height:56px;vertical-align:top}
        .move-cover>button{position:absolute;left:0;top:0}#moving{z-index:1}
        #drag-row{display:flex;gap:100px;margin:20px 0}#drag-row button{touch-action:none;user-select:none}
        iframe{display:block;width:500px;height:110px}
      </style>
      <button id="delayed" disabled>Delayed button</button>
      <span id="covered"><button id="uncovered">Covered button</button><span id="overlay"></span></span>
      <button id="never" disabled>Never ready</button>
      <button id="hover">Hover target<span aria-hidden="true">Decoration</span></button><button id="double">Double target</button>
      <button id="popup" onclick="window.open('/popup','_blank')">Open popup</button>
      <input id="readonly" readonly value="Initial value" aria-label="Initially readonly">
      <label><span aria-label="Track">Route</span> <select id="track"><option value="">-- choose --</option>
        <option value="web">Web automation</option><option value="data">Data extraction</option></select></label>
      <div><span class="hover-cover"><button id="hover-ready">Hover then ready</button></span>
        <span class="hover-cover"><button id="hover-never">Hover then blocked</button></span>
        <span class="move-cover"><button id="old-point">Old point trap</button><button id="moving">Moves on hover</button></span></div>
      <div id="drag-row"><button id="source">Drag source</button><button id="destination">Drag destination</button></div>
      <iframe src="/frame" title="Action frame"></iframe>
      <script>
        for(const id of ['delayed','uncovered','never','double','hover-ready','hover-never','moving']) document.getElementById(id).addEventListener('click',event=>{
          event.currentTarget.dataset.clicks=String(Number(event.currentTarget.dataset.clicks||0)+1);
        });
        for(const id of ['hover-ready','hover-never']) {
          const button=document.getElementById(id),container=button.parentElement;
          container.addEventListener('mousedown',event=>{
            const key=event.target===button?'downs':'overlayDowns';container.dataset[key]=String(Number(container.dataset[key]||0)+1);
          });
          button.addEventListener('mousemove',()=>{
            if(button.dataset.armed!=='yes')return;delete button.dataset.armed;
            const overlay=document.createElement('span');container.append(overlay);button.dataset.hovered='yes';
            if(id==='hover-ready')setTimeout(()=>overlay.remove(),600);
          });
        }
        for(const id of ['moving','old-point'])document.getElementById(id).addEventListener('mousedown',event=>{
          event.currentTarget.dataset.downs=String(Number(event.currentTarget.dataset.downs||0)+1);
        });
        document.getElementById('moving').addEventListener('mousemove',event=>{
          const button=event.currentTarget;if(button.dataset.armed!=='yes')return;delete button.dataset.armed;
          button.style.left='170px';button.dataset.hovered='yes';
        });
        document.getElementById('hover').addEventListener('mousemove',event=>event.currentTarget.dataset.hovered='yes');
        document.getElementById('double').addEventListener('dblclick',event=>{
          event.currentTarget.dataset.doubles=String(Number(event.currentTarget.dataset.doubles||0)+1);
        });
        document.getElementById('readonly').addEventListener('input',event=>{
          if(event.currentTarget.value==='Filled once') event.currentTarget.dataset.fills=String(Number(event.currentTarget.dataset.fills||0)+1);
        });
        document.getElementById('track').addEventListener('change',event=>{
          event.currentTarget.dataset.changes=String(Number(event.currentTarget.dataset.changes||0)+1);
        });
        let dragging=false;
        document.getElementById('source').addEventListener('pointerdown',()=>{dragging=true});
        document.addEventListener('pointermove',()=>{if(dragging)document.getElementById('source').dataset.moved='yes'});
        document.addEventListener('pointerup',event=>{
          if(dragging&&document.elementFromPoint(event.clientX,event.clientY)?.id==='destination'){
            const target=document.getElementById('destination');target.dataset.drops=String(Number(target.dataset.drops||0)+1);
          }dragging=false;
        });
      </script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  } };
}

/** Exercise observed DOM effects through each browser's real tool execution path. */
export async function exerciseElementActionWorkflow({ page, call, expect }) {
  const catalog = await call('list_tools');
  const names = catalog.tools.map(tool => tool.name);
  for (const name of ['act_on_screen', 'download_url', 'read_dom']) expect(names).toContain(name);
  for (const name of ['run_script', 'collect_images', 'read_image_asset', 'data_store']) expect(names).not.toContain(name);
  const schema = await call('list_tools', { names: ['act_on_element'] });
  expect(schema.tools[0].parameters.properties.action.enum).toEqual(expect.arrayContaining(['hover', 'double_click', 'drag']));
  await exerciseElementMatchWait({ page, call, expect });

  expect(await call('act_on_element', { locator: { role: 'combobox', name: 'Track' }, action: 'select', value: 'data', timeout: 5 })).toEqual({});
  await expect(page.getByRole('combobox', { name: 'Track', exact: true })).toHaveValue('data');
  await expect(page.locator('#track')).toHaveAttribute('data-changes', '1');

  await page.evaluate(() => { setTimeout(() => { document.getElementById('delayed').disabled = false; }, 1200); });
  expect(await call('act_on_element', { target: 'css:#delayed', action: 'click', timeout: 5 })).toEqual({});
  await expect(page.locator('#delayed')).toHaveAttribute('data-clicks', '1');
  await page.evaluate(() => { setTimeout(() => document.getElementById('overlay').remove(), 1200); });
  expect(await call('act_on_element', { target: 'css:#uncovered', action: 'click', timeout: 5 })).toEqual({});
  await expect(page.locator('#uncovered')).toHaveAttribute('data-clicks', '1');
  await page.evaluate(() => { setTimeout(() => { document.getElementById('readonly').readOnly = false; }, 1200); });
  expect(await call('act_on_element', { target: 'css:#readonly', action: 'fill', value: 'Filled once', timeout: 5 })).toEqual({});
  await expect(page.locator('#readonly')).toHaveValue('Filled once');
  await expect(page.locator('#readonly')).toHaveAttribute('data-fills', '1');
  for (const id of ['hover-ready', 'hover-never']) {
    await page.locator(`#${id}`).evaluate(element => { element.dataset.armed = 'yes'; });
    const result = await call('act_on_element', { target: `css:#${id}`, action: 'click', timeout: id === 'hover-ready' ? 5 : 1 });
    if (id === 'hover-ready') expect(result).toEqual({});
    else expect(result.code, JSON.stringify(result)).toMatch(/^(ELEMENT_NOT_READY|TOOL_TIMEOUT)$/);
    await expect(page.locator(`#${id}`)).toHaveAttribute('data-hovered', 'yes');
    expect(await page.locator(`#${id}`).getAttribute('data-clicks')).toBe(id === 'hover-ready' ? '1' : null);
    const container = page.locator(`#${id}`).locator('..');
    expect(await container.getAttribute('data-downs')).toBe(id === 'hover-ready' ? '1' : null);
    expect(await container.getAttribute('data-overlay-downs')).toBeNull();
  }
  expect(await call('inspect_element', { target: 'css:#hover-ready' })).toMatchObject({
    target: expect.stringMatching(/^uid:/), attrs: { id: 'hover-ready' }, nearbyText: expect.any(String),
    parent: { target: expect.stringMatching(/^uid:/) }, line: expect.any(Number), lineRange: expect.any(Array),
  });
  await page.locator('#hover-never').evaluate(element => element.parentElement.querySelector('span').remove());

  const failed = await call('act_on_element', { target: 'css:#never', action: 'click', timeout: 0.3 });
  expect(failed.code, JSON.stringify(failed)).toMatch(/^(ELEMENT_NOT_READY|TOOL_TIMEOUT)$/);
  expect(await page.locator('#never').getAttribute('data-clicks')).toBeNull();
  await page.evaluate(() => { document.getElementById('never').disabled = false; });

  const found = await call('find_elements', { roles: ['button'], limit: 20 });
  expect(found.results.some(item => item.name === 'Hover target' && item.text.includes('Decoration'))).toBe(true);
  const targetFor = label => {
    const target = found.results.find(item => item.name === label || item.text === label)?.target;
    expect(target, JSON.stringify(found)).toMatch(/^uid:/);
    return target;
  };
  await page.locator('#moving').evaluate(element => { element.dataset.armed = 'yes'; });
  expect(await call('act_on_element', { target: targetFor('Moves on hover'), action: 'click' })).toEqual({});
  await expect(page.locator('#moving')).toHaveAttribute('data-hovered', 'yes');
  await expect(page.locator('#moving')).toHaveAttribute('data-clicks', '1');
  await expect(page.locator('#moving')).toHaveAttribute('data-downs', '1');
  expect(await page.locator('#old-point').getAttribute('data-downs')).toBeNull();
  expect(await call('act_on_element', { target: targetFor('Hover target'), action: 'hover' })).toEqual({});
  await expect(page.locator('#hover')).toHaveAttribute('data-hovered', 'yes');
  expect(await call('act_on_element', { target: targetFor('Double target'), action: 'double_click' })).toEqual({});
  await expect(page.locator('#double')).toHaveAttribute('data-doubles', '1');
  await expect(page.locator('#double')).toHaveAttribute('data-clicks', '2');
  expect(await call('act_on_element', { target: targetFor('Drag source'), action: 'drag',
    destination: { target: targetFor('Drag destination') } })).toEqual({});
  await expect(page.locator('#source')).toHaveAttribute('data-moved', 'yes');
  await expect(page.locator('#destination')).toHaveAttribute('data-drops', '1');

  const tree = await call('get_ax_tree', { scope: 'full', depth: 12, limit: 80 });
  const frameTarget = tree.snapshot?.split('\n').find(line => line.includes('"Frame hover"'))?.match(/target=(uid:\S+)/)?.[1];
  expect(frameTarget, JSON.stringify(tree)).toMatch(/^uid:/);
  expect(await call('inspect_element', { target: frameTarget })).toMatchObject({ name: 'Frame hover' });
  expect(await call('act_on_element', { target: frameTarget, action: 'hover' })).toEqual({});
  await expect(page.frameLocator('iframe').locator('#frame-hover')).toHaveAttribute('data-hovered', 'yes');
  expect(await page.locator('#never').getAttribute('data-clicks'), 'timed-out preparation must not click after becoming ready').toBeNull();
  expect(await page.locator('#hover-never').locator('..').getAttribute('data-downs'), 'timed-out hover must not press after its overlay disappears').toBeNull();
}

async function exerciseElementMatchWait({ page, call, expect }) {
  await page.evaluate(() => {
    const other = document.createElement('p');
    other.textContent = 'Async match'; document.body.append(other);
    const button = document.createElement('button');
    button.id = 'async-match'; button.textContent = 'Async match'; button.hidden = true;
    button.onclick = () => { button.dataset.clicked = 'yes'; };
    document.body.append(button);
  });
  const query = { roles: ['button'], pattern: '^Async match$' };
  expect(await call('find_elements', query)).toMatchObject({ matches: 0, results: [] });
  let settled = false;
  const pending = call('find_elements', { ...query, waitFor: 'match', timeout: 5 })
    .then(result => { settled = true; return result; });
  await page.waitForTimeout(150);
  expect(settled, 'a matching role/name must be visible before the wait resolves').toBe(false);
  await page.locator('#async-match').evaluate(button => { button.hidden = false; });
  const found = await pending;
  expect(found, JSON.stringify(found)).toMatchObject({ matches: 1, results: [
    { target: expect.stringMatching(/^uid:t\d+\.[0-9a-z]{6}\.\d+$/), role: 'button', text: 'Async match' },
  ] });
  expect(found).not.toHaveProperty('tabRef');
  expect(await call('act_on_element', { target: found.results[0].target, action: 'click' })).toEqual({});
  await expect(page.locator('#async-match')).toHaveAttribute('data-clicked', 'yes');

  const timeout = await call('find_elements', { target: 'css:#missing-match', waitFor: 'match', timeout: 0.3 });
  expect(timeout, JSON.stringify(timeout)).toMatchObject({ code: 'TOOL_TIMEOUT' });
  expect(timeout).not.toHaveProperty('incomplete');

  const tree = await call('get_ax_tree', { scope: 'full', depth: 12, limit: 80 });
  const roots = tree.snapshot?.split('\n').filter(line => line.includes(' RootWebArea'));
  expect(roots, JSON.stringify(tree)).toHaveLength(2);
  const frame = roots[1].match(/target=(uid:\S+)/)?.[1];
  expect(frame || '', JSON.stringify(tree)).toMatch(/^uid:/);
  const framed = call('find_elements', { target: frame, roles: ['button'], pattern: '^Async frame match$', waitFor: 'match', timeout: 5 });
  await page.waitForTimeout(150);
  await page.frameLocator('iframe').locator('body').evaluate(body => {
    const button = document.createElement('button');
    button.textContent = 'Async frame match'; button.id = 'async-frame-match';
    button.onclick = () => { button.dataset.clicked = 'yes'; };
    body.append(button);
  });
  const frameFound = await framed;
  expect(frameFound, JSON.stringify(frameFound)).toMatchObject({ matches: 1, results: [{ target: expect.stringMatching(/^uid:/) }] });
  expect(await call('act_on_element', { target: frameFound.results[0].target, action: 'click' })).toEqual({});
  await expect(page.frameLocator('iframe').locator('#async-frame-match')).toHaveAttribute('data-clicked', 'yes');
}
