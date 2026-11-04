import assert from 'node:assert/strict';
import { main } from '../../services/mcp-bridge/src/cli.mjs';
import { readHealth } from '../../services/mcp-bridge/src/client.mjs';
import { startOuterScriptPage } from './outer-script-page.mjs';

/** The same public CLI acceptance runs against the loaded Chrome and Firefox packages. */
export async function exerciseOuterScripts({ endpoint, page, context, ui, observe, expect, step, testInfo }) {
  const fixture = await startOuterScriptPage(), transcript = [];
  let sessionId, stopped = false;
  const observeTools = observe || (() => page.evaluate(async () => {
    const { createPortTransport } = await import('/shared/transport/port-transport.js');
    const port = chrome.runtime.connect({ name: 'sidepanel' });
    globalThis.__qzOuterScriptEvents = [];
    globalThis.__qzOuterScriptTabs = [];
    chrome.tabs.onCreated.addListener(tab => globalThis.__qzOuterScriptTabs.push({ type: 'tab', id: tab.id, openerTabId: tab.openerTabId, url: tab.url, pendingUrl: tab.pendingUrl }));
    chrome.webNavigation.onCreatedNavigationTarget.addListener(target => globalThis.__qzOuterScriptTabs.push({ type: 'navigationTarget', ...target }));
    const transport = createPortTransport({ postMessage: message => port.postMessage(message),
      onMessage: event => { if (event.type === 'tool_execution_end') globalThis.__qzOuterScriptEvents.push(event); },
    });
    port.onMessage.addListener(message => transport.receive(message));
    globalThis.__qzOuterScriptObserver = { port, transport };
  }));
  const events = () => page.evaluate(id => globalThis.__qzOuterScriptEvents.filter(event => event.sessionId === id), sessionId);
  const cli = async (argv, stdin = '') => {
    const stdout = { isTTY: false, text: '', write(value) { this.text += value; } };
    const stderr = { isTTY: false, text: '', write(value) { this.text += value; } };
    const exitCode = await main(argv, { stdout, stderr, readStdin: async () => stdin,
      findDaemon: async () => ({ endpoint, health: await readHealth(endpoint) }),
    });
    let value; try { value = JSON.parse(stdout.text); } catch { /* Include the exact stdout in an assertion. */ }
    const entry = { argv, stdin, exitCode, stdout: stdout.text, stderr: stderr.text, value };
    transcript.push(entry);
    if (argv[0] === 'script') {
      expect(Object.keys(value || {}).sort(), JSON.stringify(entry)).toEqual(['result', 'traces']);
      expect(Array.isArray(value.traces), JSON.stringify(entry)).toBe(true);
      expect(value.traces.every(trace => typeof trace === 'string'), JSON.stringify(entry)).toBe(true);
    }
    return entry;
  };
  const script = async (code, args) => {
    const result = await cli(['script', '--session', sessionId, '--json', '--timeout', '60',
      ...(args === undefined ? [] : ['--args', JSON.stringify(args)]), '-'], code);
    expect(result.exitCode, JSON.stringify(result)).toBe(0); return result.value.result;
  };
  const taskTabs = () => page.evaluate(async origin => (await chrome.tabs.query({})).filter(tab =>
    (tab.url || '').startsWith(origin) || (tab.pendingUrl || '').startsWith(origin))
    .map(tab => ({ id: tab.id, url: tab.url, pendingUrl: tab.pendingUrl })), fixture.origin);
  try {
    await observeTools();
    const created = await cli(['session', 'create', '--title', 'Outer script browser acceptance', '--json']);
    expect(created.exitCode, JSON.stringify(created)).toBe(0);
    sessionId = created.value.result.sessionId;

    await step('outer script survives real document navigation and continues through evaluate', async () => {
      const result = await script(`async () => {
        trace('navigation.begin');
        const opened = await tools.open_tab({url:input.origin+'/start',tabAlias:'main'});
        await tools.wait_for_element({tabRef:'main',target:'css:body[data-document-token] #navigate',state:'visible',timeout:10});
        const before = await tools.evaluate({tabRef:'main',code:()=>({token:document.body.dataset.documentToken,dom:typeof document})});
        const navigation = await tools.wait_for_navigation({tabRef:'main',timeout:10,trigger:{name:'act_on_element',args:{tabRef:'main',target:'css:#navigate',action:'click'}}});
        await tools.wait_for_element({tabRef:'main',target:'css:body[data-document-token] #continue',state:'visible',timeout:10});
        const after = await tools.evaluate({tabRef:'main',code:()=>({token:document.body.dataset.documentToken,title:document.title,path:location.pathname})});
        trace('navigation.arrived');
        await tools.act_on_element({tabRef:'main',target:'css:#continue',action:'click'});
        const continued = await tools.evaluate({tabRef:'main',code:()=>document.body.dataset.continued});
        trace('navigation.continued');
        return {opened,before,after,continued,navigation,outerDom:typeof document};
      }`, { origin: fixture.origin });
      expect(Object.keys(result.opened).sort()).toEqual(['active', 'tabRef', 'title', 'url']);
      expect(result.opened.tabRef).toBe('main'); expect(result.opened.active).toBe(false);
      expect(result.before.dom).toBe('object'); expect(result.outerDom).toBe('undefined');
      expect(result.before.token).toEqual(expect.any(String)); expect(result.after.token).toEqual(expect.any(String));
      expect(result.after.token).not.toBe(result.before.token);
      expect(result.after.path).toBe('/next'); expect(result.after.title).toBe('Outer script /next');
      expect(result.continued).toBe('yes'); expect(result.navigation.status).toBe('navigated');
      expect(transcript.at(-1).value.traces.filter(value => ['navigation.begin', 'navigation.arrived', 'navigation.continued'].includes(value)))
        .toEqual(['navigation.begin', 'navigation.arrived', 'navigation.continued']);
      await expect.poll(async () => (await events()).filter(event => event.toolName === 'run_script').length).toBe(1);
      expect((await events()).map(event => event.toolName).sort()).toEqual([
        'open_tab', 'wait_for_element', 'evaluate', 'act_on_element', 'wait_for_navigation', 'wait_for_element', 'evaluate', 'act_on_element', 'evaluate', 'run_script',
      ].sort());
      const taskPage = context.pages().find(candidate => candidate.url() === `${fixture.origin}/next`);
      await expect(taskPage.locator('body')).toHaveAttribute('data-continued', 'yes');
    });

    await step('AJAX More clicks once without a self-unload block and state waits read current state', async () => {
      const result = await script(`async () => {
        const response = await tools.wait_for_response({tabRef:'main',urlPattern:'/api/more',timeout:10,trigger:{name:'act_on_element',args:{tabRef:'main',target:'css:#more',action:'click'}}});
        await tools.wait_for_function({tabRef:'main',code:()=>document.body.dataset.more==='loaded',timeout:5});
        await tools.wait_for_element({tabRef:'main',target:'css:#count',state:'visible',timeout:2});
        await tools.wait_for_url({tabRef:'main',urlPattern:'/next$',timeout:2});
        const load = await tools.wait_for_load({tabRef:'main',timeout:2});
        return {matched:response.matched,load:load.status,page:await tools.evaluate({tabRef:'main',code:()=>({path:location.pathname,count:document.querySelector('#count').textContent,clicks:document.querySelector('#more').dataset.clicks})})};
      }`);
      expect(result).toEqual({ matched: true, load: 'complete', page: { path: '/next', count: '2', clicks: '1' } });
      expect(fixture.requests.filter(request => request.path === '/api/more')).toHaveLength(1);
    });

    await step('function code and JSON arguments preserve business keys in raw results', async () => {
      const business = { ok: false, code: 'BUSINESS_STATUS', message: 'authored message', error: 'authored error',
        result: { tabId: 42, selector: 'inventory', nodes: [{ _plugin: { value: 1 } }] },
        snapshot: 'authored snapshot', _display: { title: 'authored display' }, _plugin: { name: 'authored plugin' } };
      const result = await script(`async () => {
        return tools.evaluate({tabRef:'main',code:value=>({payload:value[1],sum:value[0]+7,dom:typeof document}),args:input});
      }`, [5, business]);
      expect(result).toEqual({ payload: business, sum: 12, dom: 'object' });
      expect(await script(`async () => tools.evaluate({tabRef:'main',code:value=>value,args:input})`, business)).toEqual(business);
      const raw = await script('async () => input', business);
      expect(raw).toEqual(business);
    });

    await step('Promise.all overlaps across tabs and queues conflicting edits within one tab', async () => {
      await script(`async () => await tools.open_tab({url:input.url,tabAlias:'other'})`, { url: `${fixture.origin}/other` });
      const parallel = script(`async () => Promise.all(['main','other'].map(tabRef=>tools.evaluate({tabRef,code:async lane=>{
        await fetch('/hold?lane='+lane); return {lane,path:location.pathname};
      },args:tabRef})))`);
      void parallel.catch(() => {});
      try {
        await expect.poll(() => fixture.pending('main') + fixture.pending('other'), { timeout: 10_000 }).toBe(2);
      } finally { fixture.release('main'); fixture.release('other'); }
      expect(await parallel).toEqual([{ lane: 'main', path: '/next' }, { lane: 'other', path: '/other' }]);

      const serial = script(`async () => Promise.all([true,false].map(first=>tools.evaluate({tabRef:'main',code:async first=>{
        const field=document.querySelector('#edit'), before=Number(field.value);
        if(first) await fetch('/hold?lane=serial-first');
        field.value=String(before+1); return Number(field.value);
      },args:first})))`);
      void serial.catch(() => {});
      try { await expect.poll(() => fixture.pending('serial-first'), { timeout: 10_000 }).toBe(1); }
      finally { fixture.release('serial-first'); }
      expect(await serial).toEqual([1, 2]);
      expect(await script(`async () => tools.evaluate({tabRef:'main',code:()=>document.querySelector('#edit').value})`)).toBe('2');
    });

    await step('page errors stay canonical and future-event waits reject an already complete document', async () => {
      const failure = await cli(['script', '--session', sessionId, '--json', '--timeout', '10', '-'],
        `async () => { trace('failure.begin'); await tools.evaluate({tabRef:'main',code:()=>{
          document.body.dataset.partialRuns=String(Number(document.body.dataset.partialRuns||0)+1);
          throw new TypeError('outer-fixture-failure');
        }}); trace('failure.unreached'); }`);
      expect(failure.exitCode, JSON.stringify(failure)).toBe(1);
      expect(failure.value.result.code).toBeTruthy(); expect(failure.value.result.message).toContain('outer-fixture-failure');
      expect(failure.value.result.hint).toBeTruthy();
      expect(Object.keys(failure.value.result).every(key => ['code', 'message', 'hint', 'details'].includes(key))).toBe(true);
      expect(failure.value.traces.filter(value => value === 'failure.begin')).toHaveLength(1);
      expect(failure.value.traces).not.toContain('failure.unreached');
      const taskPage=context.pages().find(candidate=>candidate.url()===`${fixture.origin}/next`);
      await expect(taskPage.locator('body')).toHaveAttribute('data-partial-runs','1');
      const timeout = await cli(['script', '--session', sessionId, '--json', '--timeout', '10', '-'],
        `async () => await tools.wait_for_navigation({tabRef:'main',timeout:0.15})`);
      expect(timeout.exitCode, JSON.stringify(timeout)).toBe(1);
      expect(timeout.value.result.code).toBe('TOOL_TIMEOUT'); expect(timeout.value.result.hint).toBeTruthy();
    });

    await step('causal popup belongs to the session; cancellation rejects pending work and late completion', async () => {
      const popup = await script(`async () => {
        const child=await tools.wait_for_popup({tabRef:'main',tabAlias:'child',timeout:10,trigger:{name:'act_on_element',args:{tabRef:'main',target:'css:#popup',action:'click'}}});
        await tools.wait_for_url({tabRef:child.tabRef,urlPattern:'/popup$',timeout:10});
        await tools.wait_for_load({tabRef:child.tabRef,timeout:10});
        return {child,document:await tools.evaluate({tabRef:child.tabRef,code:()=>({path:location.pathname,title:document.title})}),owned:await tools.list_tabs({})};
      }`);
      expect(Object.keys(popup.child).sort()).toEqual(['active', 'tabRef', 'title', 'url']);
      expect(popup.child.tabRef).toBe('child'); expect(popup.document.path).toBe('/popup');
      expect(popup.owned.tabs.some(tab => tab.tabRef === 'child')).toBe(true);
      const evaluatedPopup = await script(`async () => {
        const child=await tools.wait_for_popup({tabRef:'main',tabAlias:'evaluated-child',timeout:10,trigger:{name:'evaluate',args:{tabRef:'main',code:"url=>{window.open(url,'_blank');return true;}",args:input.url}}});
        await tools.wait_for_url({tabRef:child.tabRef,urlPattern:'/popup-evaluate$',timeout:10});
        await tools.wait_for_load({tabRef:child.tabRef,timeout:10});
        return {child,path:await tools.evaluate({tabRef:child.tabRef,code:()=>location.pathname}),owned:await tools.list_tabs({})};
      }`, {url:`${fixture.origin}/popup-evaluate`});
      expect(evaluatedPopup.child.tabRef).toBe('evaluated-child');
      expect(evaluatedPopup.path).toBe('/popup-evaluate');
      expect(evaluatedPopup.owned.tabs.some(tab=>tab.tabRef==='evaluated-child')).toBe(true);
      await step('each actual tool invocation has one persisted card in the titled session', async () => {
        const completed = await events();
        expect(new Set(completed.map(event => event.toolCallId)).size).toBe(completed.length);
        const recorded = await page.evaluate(async id => {
          const { readSessionSnapshot } = await import('/shared/session/session-recovery.js');
          const key=`_session_${id}`, checkpoint=`_session_transcript_checkpoint_${id}`;
          const stored=await chrome.storage.local.get([key,checkpoint]);
          return readSessionSnapshot(stored[key],null,stored[checkpoint]).transcript.filter(row=>row.type==='tool');
        }, sessionId);
        expect(recorded.map(row => row.toolCallId).sort()).toEqual(completed.map(event => event.toolCallId).sort());
        if (ui) { await ui({ sessionId, title: 'Outer script browser acceptance', count: completed.length, expect }); return; }
        await page.locator('[data-tab="sessions"]').click();
        await page.locator('[data-sessions-mode="external-drive"]').click();
        const row=page.locator(`#sessions-list .session-card[data-id="${sessionId}"]:not(.is-removing)`);
        await expect(row.locator('.session-card-title')).toHaveText('Outer script browser acceptance');
        await row.click();
        const cards=page.locator('#messages .msg-tool');
        await expect(cards).toHaveCount(completed.length);
        const ids=await cards.evaluateAll(nodes=>nodes.map(node=>node.id));
        expect(new Set(ids).size).toBe(ids.length);
      });
      const pending = cli(['script', '--session', sessionId, '--json', '--timeout', '20', '-'], `async () => {
        const child=await tools.wait_for_popup({tabRef:'main',tabAlias:'late',timeout:15,trigger:{name:'act_on_element',args:{tabRef:'main',target:'css:#popup-late',action:'click'}}});
        await tools.wait_for_load({tabRef:child.tabRef,timeout:15});
        return {lateSuccess:true};
      }`);
      await expect.poll(() => fixture.pending('popup-late'), { timeout: 10_000 }).toBe(1);
      const cancel = await cli(['cancel', sessionId, '--json']);
      expect(cancel.exitCode, JSON.stringify(cancel)).toBe(0); stopped = true;
      expect(cancel.stdout).not.toMatch(/tabId|workingTab/);
      fixture.release('popup-late');
      const rejected = await pending;
      expect(rejected.exitCode, JSON.stringify(rejected)).toBe(1);
      expect(rejected.value.result.code).toMatch(/OPERATION_ABORTED|RUN_STOPPED|DRIVE_SESSION_ENDED/);
      expect(rejected.value.result).not.toHaveProperty('lateSuccess');
      await expect.poll(taskTabs, { timeout: 10_000 }).toEqual([]);
      assert.equal(transcript.filter(entry => entry.argv[0]==='script'&&entry.exitCode===0&&entry.value?.result?.lateSuccess).length,0);
    });
  } finally {
    const runtime = await page.evaluate(async id => ({
      events: globalThis.__qzOuterScriptEvents.filter(event => event.sessionId === id),
      created: globalThis.__qzOuterScriptTabs,
      tabs: (await chrome.tabs.query({})).map(tab => ({ id: tab.id, openerTabId: tab.openerTabId, url: tab.url, pendingUrl: tab.pendingUrl })),
    }), sessionId).catch(error => ({ error: error.message }));
    await testInfo.attach('outer-script-runtime-evidence.json', { body: Buffer.from(JSON.stringify({ ...runtime, requests: fixture.requests }, null, 2)), contentType: 'application/json' });
    if (sessionId && !stopped) await cli(['cancel', sessionId, '--json']).catch(() => {});
    await testInfo.attach('outer-script-cli-transcript.json', { body: Buffer.from(JSON.stringify(transcript, null, 2)), contentType: 'application/json' });
    await fixture.close();
  }
}
