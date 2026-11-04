/** Run installed Skills through the real CLI, Worker, page runtime and sidebar transcript. */
export async function exerciseSkillScripts({ page, script, cli, sessionId, events, fixture, expect }) {
  const tools = [
    { name: 'read', runtime: 'script', script: 'read.js', parameters: { type: 'object', properties: {
      tabRef: { type: ['integer', 'string'] }, lane: { type: 'string' },
    }, required: ['tabRef'] }, renderer: { type: 'summary', titlePath: 'title', fields: [{ label: 'Route', path: 'path' }] } },
    { name: 'legacy', runtime: 'inner', script: 'legacy.js' },
    { name: 'bad_value', runtime: 'script', script: 'bad.js' },
    { name: 'table', runtime: 'script', script: 'table.js', renderer: { type: 'table', itemsPath: 'rows', columns: [{ label: 'Name', path: 'name' }] } },
    { name: 'scalar', runtime: 'script', script: 'scalar.js' },
  ];
  const skill = { format: 'qingzhou.skill', schemaVersion: 2, name: 'script-contract', scope: 'resident', content: 'Browser fixture', resources: [
    { path: 'plugin.json', type: 'json', content: JSON.stringify({ format: 'qingzhou.plugin', schemaVersion: 1, id: 'script-contract', tools }) },
    { path: 'read.js', type: 'script', content: `
      if(args.lane) await tools.evaluate({tabRef:args.tabRef, code:async lane=>{
        if(document.body.dataset.busy) throw new Error('same-page-overlap');
        document.body.dataset.busy='yes';
        await fetch('/hold?lane='+lane);
        delete document.body.dataset.busy;
      }, args:args.lane});
      const value=await tools.evaluate({tabRef:args.tabRef,code:()=>({title:document.title,path:location.pathname})});
      if(args.lane) await tools.evaluate({tabRef:args.tabRef,code:lane=>fetch('/done-'+lane).then(()=>true),args:args.lane});
      return value;
    ` },
    { path: 'legacy.js', type: 'script', content: 'return new Map([["legacy", true]]);' },
    { path: 'bad.js', type: 'script', content: 'return new Map();' },
    { path: 'table.js', type: 'script', content: `return {rows:[{name:'Business row'}],ok:false,error:'business field',result:'business result'};` },
    { path: 'scalar.js', type: 'script', content: 'trace("scalar trace"); return 42;' },
  ] };
  const installed = await page.evaluate(skill => new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: 'sidepanel' }), requestId = 'script-contract-install';
    const timer = setTimeout(() => { port.disconnect(); reject(new Error('Skill installation timed out')); }, 15_000);
    port.onMessage.addListener(message => {
      if (message.requestId !== requestId) return;
      clearTimeout(timer); port.disconnect(); resolve(message);
    });
    port.postMessage({ type: 'save_workspace_skill', requestId, name: skill.name, skill, expected: null });
  }), skill);
  expect(installed.registryReady, JSON.stringify(installed)).toBe(true);

  await script(`return await Promise.all(['slow','fast'].map(tabAlias=>tools.open_tab({url:args.origin+'/start',tabAlias})));`, { origin: fixture.origin });
  const values = await script(`return {
    inline:await tools.evaluate({tabRef:'fast',code:()=>({title:document.title,path:location.pathname})}),
    packaged:await tools.script_contract__read({tabRef:'fast'}),
    legacy:await tools.script_contract__legacy({timeout:5})
  };`);
  expect(values.packaged).toEqual(values.inline);
  expect(values.legacy.ok).toBe(true);
  expect(values.legacy.result.__qz_type).toBe('Map');
  expect(await script(`return await tools.script_contract__scalar({});`)).toBe(42);
  expect((await script(`return await tools.script_contract__table({});`)).rows).toEqual([{ name: 'Business row' }]);

  let completed = false;
  const branches = script(`return await Promise.all([
    tools.script_contract__read({tabRef:'slow',lane:'slow'}),
    tools.script_contract__read({tabRef:'fast',lane:'fast'}),
    tools.script_contract__read({tabRef:'slow',lane:'same'})
  ]);`).finally(() => { completed = true; });
  try {
    await expect.poll(() => [fixture.pending('slow'), fixture.pending('fast'), fixture.pending('same')]).toEqual([1, 1, 0]);
    fixture.release('fast');
    await expect.poll(() => fixture.requests.some(request => request.path === '/done-fast')).toBe(true);
    expect(completed).toBe(false);
    fixture.release('slow');
    await expect.poll(() => fixture.pending('same')).toBe(1);
    fixture.release('same');
    expect(await branches).toEqual([values.inline, values.inline, values.inline]);
  } finally {
    for (const lane of ['fast', 'slow', 'same']) fixture.release(lane);
    await branches.catch(() => {});
  }

  const failed = await cli(['script', '--session', sessionId, '--json', '-'], 'return await tools.script_contract__bad_value({});');
  expect(failed.exitCode).toBe(1);
  expect(failed.value.result.code).toBe('SCRIPT_VALUE_NOT_SERIALIZABLE');
  const rows = await events(), calls = rows.filter(row => row.toolName === 'script_contract__bad_value');
  expect(calls).toHaveLength(1);
  expect(failed.value.traces.some(line => line.includes(`call=${calls[0].toolCallId}`) && line.includes('failed'))).toBe(true);
  const pageCalls = rows.filter(row => row.toolName === 'evaluate');
  const packagedCalls = rows.filter(row => row.toolName === 'script_contract__read');
  expect(new Set(rows.map(row => row.toolCallId)).size).toBe(rows.length);
  for (const packaged of packagedCalls) expect(pageCalls.some(row => row.parentSpanId === `tool:${packaged.toolCallId}`)).toBe(true);

  // Render actual persisted event payloads, including custom DSL and generic fallbacks, in both UI paths.
  const cards = await page.evaluate(async rows => {
    const { renderToolEvent, disposeRendererTree } = await import('/sidepanel/tools/tool-renderer.js');
    return ['read', 'table', 'scalar', 'legacy', 'bad_value'].flatMap(name => {
      const event = rows.find(row => row.toolName === `script_contract__${name}`);
      return [false, true].map(staticOutput => {
        // Firefox's privileged test driver must pass data in the sidebar's own realm.
        const input = globalThis.JSON.parse(JSON.stringify({ ...event, name: event.toolName, hasResult: true, phase: 'done' }));
        const options = globalThis.JSON.parse(JSON.stringify({ expanded: true, lazyDetails: false, static: staticOutput }));
        const root = renderToolEvent(input, options);
        document.body.append(root);
        const value = { name, staticOutput, text: root.querySelector('.tool-details')?.textContent || '', html: root.outerHTML.slice(0,3000),
          metrics: [...root.querySelectorAll('.tool-stat-item b')].map(node => node.textContent),
          table: root.querySelector('table')?.textContent || '', state: root.querySelector('.tool-summary .dot')?.className };
        disposeRendererTree(root); root.remove(); return value;
      });
    });
  }, JSON.parse(JSON.stringify(rows)));
  for (const card of cards) {
    if (card.name === 'read') expect(card.metrics, JSON.stringify(card)).toContain('/start');
    if (card.name === 'table') { expect(card.table, JSON.stringify(card)).toContain('Business row'); expect(card.state).not.toContain('error'); }
    if (card.name === 'scalar') { expect(card.text, JSON.stringify(card)).toContain('42'); expect(card.text, JSON.stringify(card)).toContain('scalar trace'); expect(card.text).not.toContain('valueOnly'); }
    if (card.name === 'legacy') expect(card.text, JSON.stringify(card)).toContain('Map');
    if (card.name === 'bad_value') expect(card.state).toContain('error');
  }
}
