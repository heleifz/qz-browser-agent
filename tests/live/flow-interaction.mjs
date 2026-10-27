// Explicit E reproduction: scripted provider, real Agent/flow/tool runtime and public demo site.
// No real-provider request/key. Browser results are not mocked. This is not a UX benchmark.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { localFetch, resultValue } from '../../services/mcp-bridge/src/client.mjs';
import { launchIsolatedExtensionMcp, saveExtensionLlmConfig } from '../support/isolated-extension-mcp.mjs';

const { values } = parseArgs({ options: {
  label: { type: 'string', default: 'interaction' }, output: { type: 'string', default: 'tests/results/flow-interaction' },
  cycles: { type: 'string', default: '1' }, recover: { type: 'boolean', default: false }, 'logout-href': { type: 'boolean', default: false },
  warmup: { type: 'string', default: 'none' }, 'native-viewport': { type: 'boolean', default: false },
} });
const cycles = Number(values.cycles);
if (!Number.isInteger(cycles) || cycles < 1 || cycles > 3) throw new Error('--cycles must be 1–3');
if (!['none', 'screenshot', 'hover'].includes(values.warmup)) throw new Error('Unknown warmup');
const directory = resolve(values.output);
await mkdir(directory, { recursive: true });
const code = `async () => {
  const steps=[], recovery=[];
  const call=async(name,args)=>{const start=Date.now();const value=await tools.$settle(name,args);steps.push({name,args,ms:Date.now()-start,value});return value.ok?value.result:value;};
  const tab=await tools.open_tab({url:'https://the-internet.herokuapp.com/login'});const tabId=tab.id;
  const state=async()=>{const read=await call('run_script',{tabId,timeout:10,code:'() => ({url:location.href,heading:document.querySelector("h2")?.textContent.trim(),flash:document.querySelector("#flash")?.textContent.trim(),username:document.querySelector("#username")?.value,visible:document.visibilityState,focused:document.hasFocus(),outer:[outerWidth,outerHeight],inner:[innerWidth,innerHeight],events:window.__flowEvents||[]})'});return read.result;};
  const warm=async()=>{
    ${values.warmup !== 'none' ? 'await tools.screenshot({tabId,actionable:true});' : ''}
    ${values.warmup === 'hover' ? "await tools.act_on_screen({tabId,action:'hover',x:20,y:20,returnScreenshot:false});" : ''}
  };
  const click=async(target,text)=>{
    await warm();
    const nav=await tools.$watch('wait_for_navigation',{tabId,next:true,timeout:10});
    try {
      const result=await call('act_on_element',{tabId,target,action:'click'});
      if(result.ok===false)return result;
      await nav.wait();
      await tools.wait_for_element({tabId,selector:'#flash',text,timeout:10});
      return result;
    } finally {await nav.cancel().catch(()=>{});}
  };
  for(let cycle=0;cycle<${cycles};cycle++) {
    if(cycle)await tools.navigate({tabId,url:'https://the-internet.herokuapp.com/login'});
    await tools.wait_for_element({tabId,selector:'#username',timeout:10});
    const loginTree=await tools.get_ax_tree({tabId,scope:'viewport',limit:40});
    const loginTarget=loginTree.snapshot.split('\\n').find(line=>line.includes('button')&&line.includes('Login'))?.match(/target=(uid:\\S+)/)?.[1];
    if(!loginTarget)return {passed:false,stage:'login-target',steps};
    await call('act_on_element',{tabId,target:'css:#username',action:'fill',value:'tomsmith'});
    await call('act_on_element',{tabId,target:'css:#password',action:'fill',value:'SuperSecretPassword!'});
    const login=await click(loginTarget,'You logged into a secure area!');
    if(login.code==='INPUT_NOT_DELIVERED'&&${values.recover}) {
      // Diagnostic grace period distinguishes a delayed receipt from a persistent miss.
      await new Promise(resolve=>setTimeout(resolve,500));
      const before=await state();
      if(before.url.endsWith('/secure'))recovery.push('login-late-delivery');
      else if(before.url.endsWith('/login')) {
        // Explicit recovery: focus/fill and keyboard submit, not a repeated mouse click.
        recovery.push('login-keyboard-submit');
        await tools.act_on_element({tabId,target:'css:#password',action:'fill',value:'SuperSecretPassword!',submit:true});
      } else return {passed:false,stage:'unexpected-login-state',steps};
      await tools.wait_for_element({tabId,selector:'#flash',text:'You logged into a secure area!',timeout:10});
    }
    const loggedIn=await state();
    if(!loggedIn?.url.endsWith('/secure'))return {passed:false,stage:'login',steps,recovery};
    await tools.run_script({tabId,timeout:10,mutatesPage:true,code:'() => { window.__flowEvents=[];for(const type of ["pointermove","pointerdown","mousedown","mouseup","click"]) window.addEventListener(type,e=>window.__flowEvents.push({type:e.type,trusted:e.isTrusted}),true);return true; }'});
    const tree=await tools.get_ax_tree({tabId,scope:'viewport',limit:40});
    const logoutLine=tree.snapshot.split('\\n').find(line=>line.includes('link "Logout"'));
    const target=logoutLine?.match(/alias=(@\\S+)/)?.[1];
    const href=logoutLine?.match(/url="([^"]+)"/)?.[1];
    if(!target)return {passed:false,stage:'logout-alias',steps};
    let clicked;
    if(${values['logout-href']}) {
      if(href!=='https://the-internet.herokuapp.com/logout')return {passed:false,stage:'unexpected-logout-href',steps};
      recovery.push('logout-href-explicit');
      clicked=await call('navigate',{tabId,url:href});
      await tools.wait_for_element({tabId,selector:'#flash',text:'You logged out of the secure area!',timeout:10});
    } else clicked=await click(target,'You logged out of the secure area!');
    if(clicked.code==='INPUT_NOT_DELIVERED'&&${values.recover}) {
      await new Promise(resolve=>setTimeout(resolve,500));
      const before=await state();
      if(before.url.endsWith('/login')&&before.flash?.includes('You logged out'))recovery.push('logout-late-delivery');
      else if(before.url.endsWith('/secure')&&href==='https://the-internet.herokuapp.com/logout') {
        // This demo Logout is a plain GET link. navigate preserves URL/ownership/permission guards.
        // Not a substitute for arbitrary click handlers, downloads or state-changing buttons.
        recovery.push('logout-href-navigation');
        await tools.navigate({tabId,url:href});
      } else return {passed:false,stage:'unexpected-logout-state',steps};
      await tools.wait_for_element({tabId,selector:'#flash',text:'You logged out of the secure area!',timeout:10});
    }
    const after=await state();
    if(!after?.url.endsWith('/login')||!after.flash?.includes('You logged out of the secure area!')||after.username!=='')return {passed:false,stage:'logout',clicked,after,steps,recovery};
  }
  return {passed:true,steps,recovery};
}`;
const report = { label: values.label, startedAt: new Date().toISOString(), cycles, recover: values.recover,
  warmup: values.warmup, nativeViewport: values['native-viewport'], logoutHref: values['logout-href'], provider: 'scripted fixture (no inference)', code };
let environment, client, transport;
try {
  environment = await launchIsolatedExtensionMcp({ profilePrefix: 'qz-flow-interaction-', requestTimeoutSeconds: 60,
    ...(values['native-viewport'] ? { viewport: null } : {}) });
  report.browser = environment.context.browser()?.version();
  let requests = 0;
  await environment.context.route('https://api.deepseek.com/**', async route => {
    const message = requests++ === 0
      ? { role: 'assistant', tool_calls: [{ index: 0, id: 'interaction-probe', type: 'function', function: { name: 'run_flow', arguments: JSON.stringify({ timeout: 90, code }) } }] }
      : { role: 'assistant', content: 'Probe finished.' };
    const chunk = { id: 'probe', object: 'chat.completion.chunk', created: 0, model: 'deepseek-flash', choices: [{ index: 0, delta: message, finish_reason: null }] };
    const end = { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] };
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(end)}\n\ndata: [DONE]\n\n` });
  });
  await saveExtensionLlmConfig(environment.page, { provider: 'deepseek', apiKey: 'fixture-not-a-secret', model: 'deepseek-flash', contextWindow: 1000000, vision: true });
  const clientId = environment.bridgeStatus.clients[0].clientId;
  client = new Client({ name: 'flow-interaction-probe', version: '1' });
  transport = new StreamableHTTPClientTransport(new URL(environment.bridge.mcpUrl), { fetch: localFetch });
  await client.connect(transport);
  const mcp = async (name, args) => {
    const response = await client.callTool({ name, arguments: { clientId, ...args } }, undefined, { timeout: 70000 });
    const value = resultValue(response); if (response.isError) throw new Error(JSON.stringify(value)); return value;
  };
  const created = await mcp('qingzhou_create_session', { title: 'Tool-only E interaction probe', firstMessage: 'Execute the supplied E regression probe.' });
  report.sessionId = created.session?.id || created.sessionId;
  const deadline = Date.now() + 120000;
  let snapshot;
  do {
    await delay(250);
    snapshot = await mcp('qingzhou_get_session_snapshot', { sessionId: report.sessionId, compact: false, tail: false });
  } while (!['completed', 'failed', 'error', 'aborted', 'waiting_user'].includes(snapshot.status) && Date.now() < deadline);
  await writeFile(`${directory}/${values.label}-snapshot.json`, JSON.stringify(snapshot, null, 2));
  report.flow = snapshot.transcript?.find(entry => entry.type === 'tool' && entry.name === 'run_flow')?.result;
  const final = report.flow?.finalObservation;
  report.passed = report.flow?.ok === true && report.flow.result?.passed === true
    && final?.purpose === 'next_turn_start' && final.snapshot?.scope === 'viewport'
    && final.snapshot?.url === 'https://the-internet.herokuapp.com/login'
    && final.snapshot?.snapshot?.includes('Login Page');
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  report.error = String(error.stack || error); report.passed = false; process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString(); report.diagnostics = environment?.diagnostics || [];
  await transport?.terminateSession().catch(() => {}); await client?.close().catch(() => {}); await environment?.close();
  await writeFile(`${directory}/${values.label}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ label: report.label, passed: report.passed, error: report.error,
    stage: report.flow?.result?.stage, recovery: report.flow?.result?.recovery, file: `${directory}/${values.label}.json` }));
}
