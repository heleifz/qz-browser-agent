import assert from 'node:assert/strict';
import test from 'node:test';
import { createElementObservation } from '../../src/shared/contracts/element-observation.js';
import { pageReferenceForResult } from '../../src/shared/tab-reference.js';
import { projectNamedDriveResult, isDriveToolDefault, isDriveToolForbidden, driveToolSignature } from '../../src/background/mcp/external-drive.js';
import { createMcpTransport } from '../../src/background/transports/mcp.js';
import { createRunScriptBridge } from '../../src/background/tools/run-script-bridge.js';
import { registerTabsNavigationTools } from '../../src/capabilities/tabs/tools.js';
import { ToolExecutionError } from '../../src/background/tools/arguments.js';
import { createMemoryStorage } from '../support/memory-storage.mjs';

const privateKey = /^(?:uid|selector|sourceSelector|_elementRef|backendNodeId|backendDOMNodeId|documentId|frameId|loaderId|snapshotId|tabId)$/;
function assertPublic(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) { assert.ok(!privateKey.test(key), key); assertPublic(item); }
}

test('construct element observations from business fields and the registry handle, not by cleaning responses', () => {
  const candidate = { uid: 'private', selector: '#image', _elementRef: 'token', backendNodeId: 42, text: 'Image', rect: {x:1,y:2,w:30,h:40} };
  const observation = createElementObservation(candidate, 'uid:t5.000001.1');
  assert.deepEqual(observation, {target:'uid:t5.000001.1',text:'Image',rect:{x:1,y:2,width:30,height:40}});
  assertPublic(observation);
  assert.equal(candidate.selector, '#image');
  const authored = { attrs: { selector: 'attribute', uid: 'attribute' }, value: { source: 'selector', mode: 'selector' }, text: 'selector tabId inner' };
  const data = createElementObservation(authored, 'css:img');
  assert.deepEqual(data.attrs, authored.attrs); assert.deepEqual(data.value, authored.value);
  assert.equal(pageReferenceForResult('page', 5), 'page');
  assert.equal(pageReferenceForResult('005', 5), '005');
  assert.equal(pageReferenceForResult(5, 7), 5);
  assert.equal(pageReferenceForResult(undefined, 5), 5);
});

test('list_tabs constructs public discovery rows and preserves active independently of the native task default', async () => {
  globalThis.chrome = {storage:{local:{async get(){return {};}}},tabs:{async query(){return [{id:5,title:'Page',url:'https://example.test',active:true,windowId:9}];}}};
  const definitions = new Map();
  registerTabsNavigationTools({registerTool: d=>definitions.set(d.name,d),ToolExecutionError,
    getToolRuntimeDependencies:()=>({sessions:{resolveTargetTab:async()=>({ok:true,ownedByCurrentTask:true}),getTabAliases:()=>({page:5})}}),
    assertTabAllowed:async()=>{},assertUrlAllowed:()=>{},assertPageUrlAccessible:async()=>{},enablePreNavigationNetworkWatch:async()=>{},
    withDebugger:async()=>{},getDebuggerConnectionId:()=>null,setDebuggerRetention(){},releaseDebugger:async()=>{}});
  const context={sessionId:'surface',runId:'drive-test',workingTabId:5};
  const rows=await definitions.get('list_tabs').execute({},undefined,context);
  assertPublic(rows); assert.deepEqual(rows, {tabs:[{tabRef:'page',title:'Page',url:'https://example.test',active:true}],count:1,foreign:0});
  assert.equal(Object.hasOwn(rows.tabs[0],'isWorkingTab'),false);assert.equal(Object.hasOwn(rows.tabs[0],'windowId'),false);
  for(const args of [{},{scope:'all'},{verbose:true}]) {
    const {value}=projectNamedDriveResult('list_tabs',args,rows);
    assert.doesNotMatch(JSON.stringify(value),/workingTab|isWorkingTab|tabId|windowId/);
    assert.equal((Array.isArray(value)?value:value.tabs)[0].active,true);
  }
  const native=await definitions.get('list_tabs').execute({},undefined,{...context,runId:'agent'});
  assert.equal(native[0].isWorkingTab,true,'the native Agent keeps its default-page behavior');
  for(const name of ['use_tab','get_working_tab','run_skill_script']) {
    assert.equal(isDriveToolDefault(name),false);assert.equal(isDriveToolForbidden(name),true);
    assert.throws(()=>driveToolSignature({name}),{code:'DRIVE_TOOL_FORBIDDEN'});
  }
});

test('MCP transport forwards the producer control receipt unchanged', async () => {
  const receipt={sessionId:'owned-test',stopped:true,status:'aborted'};
  const api={system:{ready:async()=>{}},sessions:{stop:async()=>receipt}};
  const result=await createMcpTransport(api).dispatch({method:'stop_session',params:{sessionId:'owned-test'}});
  assert.equal(result,receipt);assertPublic(result);
});

test('nested tools return their source DTO without a recursive field filter or a model size cap', async () => {
  const result={results:[createElementObservation({text:'Image'},'uid:t5.000001.1')],text:'x'.repeat(50000)};
  const bridge=createRunScriptBridge({supervisor:{isRunCurrent:()=>true,hasAgent:()=>true,getAbortSignal:()=>new AbortController().signal},
    getRuntime:()=>({status:'running'}),isTerminalRuntimeForRun:()=>false,canManageSessions:async()=>true,buildRunProfile:async()=>({}),
    toolRuntime:{resolveDefinition:()=>({behavior:{}}),getSchemas:()=>[],execute:async()=>result},collectArtifacts:()=>[]});
  const response=await bridge.handleToolCall({toolName:'find_elements',args:{tabRef:5},sessionId:'surface',runId:'drive-test'});
  assert.equal(response.ok,true);assertPublic(response.result);assert.equal(response.result.text.length,50000);
  const opaque=projectNamedDriveResult('run_script',{}, {ok:true,result:{selector:'data',tabId:'data',mode:'selector'}});
  assert.deepEqual(opaque.value.result,{selector:'data',tabId:'data',mode:'selector'});
});

test('real allowed tool declarations publish references and public terms without catalog repair', async () => {
  globalThis.chrome = { runtime: { getURL: path => path }, storage: { local: { async get() { return {}; } } } };
  const { getToolSchemas, resolveToolDefinition } = await import('../../src/background/tools/runtime.js');
  const forbidden = /\b(?:tabId|workingTab|workingTabId|isWorkingTab|use_tab|get_working_tab|inner|selector)\b/i;
  for (const language of ['zh-CN', 'en']) {
    const allowed = getToolSchemas({ language }).map(schema => schema.function).filter(tool => !isDriveToolForbidden(tool.name));
    assert.ok(allowed.length > 30);
    for (const tool of allowed) {
      assert.doesNotMatch(JSON.stringify(tool), forbidden, `${language}: ${tool.name}`);
      const declaration = resolveToolDefinition(tool.name, { language });
      assert.equal(declaration.parameters.properties.tabId, undefined, `${tool.name}: source schema`);
      assert.equal(declaration.parameters.properties.selector, undefined, `${tool.name}: source schema`);
      assert.doesNotMatch(JSON.stringify(driveToolSignature(tool)), forbidden, `${language}: ${tool.name}`);
      if (tool.name === 'run_script') {
        assert.equal(tool.parameters.properties.target, undefined);
        assert.equal(tool.parameters.properties.scope, undefined);
      }
    }
  }
});

test('real runtime and batch admission failures share ToolError and retain public recovery context', async () => {
  const { createToolRuntime } = await import('../../src/background/tools/runtime.js');
  const { runDriveCalls } = await import('../../src/background/mcp/external-drive.js');
  const runtime = createToolRuntime({ sessions: {
    isRunCurrent: () => true, getTabAliases: () => ({ page: 5 }),
    resolveTargetTab: async ({ tabId }) => ({ ok: true, tabId, ownedByCurrentTask: true }),
  } });
  const context = { sessionId: 'surface', runId: 'drive-surface' };
  const calls = [
    { id: 'missing-page', name: 'read_dom', args: {} },
    { id: 'missing-alias', name: 'read_dom', args: { tabRef: 'missing' } },
    { id: 'stale-element', name: 'inspect_element', args: { tabRef: 'page', target: 'uid:t5.000000.999' } },
  ];
  const batch = await runDriveCalls(calls, {
    aliases: { page: 5 }, context, signal: new AbortController().signal,
    getBatchTabPolicy: (name, args) => runtime.getBatchTabPolicy(name, args, context),
    execute: (name, args, signal, current) => runtime.execute(name, args, signal, current),
  });
  assert.deepEqual(batch.results.map(row => row.result.code), ['DRIVE_TAB_REF_REQUIRED', 'BATCH_TAB_REFERENCE_ERROR', 'STALE_ELEMENT_UID']);
  for (const row of batch.results) {
    assert.equal(row.isError, true);
    assert.ok(Object.keys(row.result).every(key => ['code', 'message', 'hint', 'details'].includes(key)), JSON.stringify(row.result));
    assert.match(row.result.code, /^[A-Z][A-Z0-9_]+$/);
    assert.equal(typeof row.result.message, 'string');
    assertPublic(row.result);
  }
  assert.equal(batch.results[1].result.details.tabRef, 'missing');
  assert.equal(batch.results[2].result.details.target, 'uid:t5.000000.999');
});

test('large ToolErrors retain their native contract instead of becoming truncation results', async () => {
  const { toolError } = await import('../../src/shared/contracts/tool-error.js');
  const failure = toolError('SCRIPT_EVALUATION_FAILED', 'Failure', {
    hint: 'Fix the script and retry.', details: { line: 2, trace: [{ message: 'x'.repeat(50000) }] },
  });
  assert.deepEqual(projectNamedDriveResult('run_script', {}, failure).value, failure);
});


test('real Skill discovery failures and URL image failures produce the same ToolError contract', async () => {
  globalThis.chrome = { runtime: { getURL: path => path }, storage: { local: createMemoryStorage() } };
  const { createToolRuntime } = await import('../../src/background/tools/runtime.js');
  const { runDriveCalls } = await import('../../src/background/mcp/external-drive.js');
  const runtime = createToolRuntime({ sessions: { isRunCurrent: () => true } });
  const context = { sessionId: 'skill-surface', runId: 'drive-skill-surface' };
  const cases = [
    ['load_skill', { name: 'missing-contract-skill' }, 'SKILL_NOT_FOUND'],
    ['load_skill_resource', { name: 'missing-contract-skill', path: 'missing.md' }, 'SKILL_NOT_FOUND'],
    ['load_skill_resource', { name: 'qingzhou-documents', path: 'missing-contract-resource.md' }, 'SKILL_RESOURCE_NOT_FOUND'],
  ];
  const assertFailure = failure => {
    assert.ok(Object.keys(failure).every(key => ['code', 'message', 'hint', 'details'].includes(key)), JSON.stringify(failure));
    assert.match(failure.code, /^[A-Z][A-Z0-9_]+$/);
    assert.equal(typeof failure.message, 'string');
    assertPublic(failure);
  };
  for (const [name, args, code] of cases) {
    const failure = await runtime.execute(name, args, undefined, context);
    assertFailure(failure);
    assert.equal(failure.code, code);
    assert.match(failure.hint, code === 'SKILL_NOT_FOUND' ? /list_skills/ : /load_skill.*includeResources/);
    assert.equal(failure.details.name, args.name);
  }
  const calls = [
    { id: 'invalid-url', name: 'read_image', args: { url: 'not a URL' } },
    { id: 'unsupported-url', name: 'read_image', args: { url: 'ftp://example.org/image.png' } },
  ];
  const batch = await runDriveCalls(calls, {
    context, signal: new AbortController().signal,
    getBatchTabPolicy: (name, args) => runtime.getBatchTabPolicy(name, args, context),
    execute: (name, args, signal, current) => runtime.execute(name, args, signal, current),
  });
  assert.deepEqual(batch.results.map(row => row.result.code), ['INVALID_IMAGE_URL', 'UNSUPPORTED_IMAGE_URL_SCHEME']);
  for (const row of batch.results) { assert.equal(row.isError, true); assertFailure(row.result); }
});
