import assert from 'node:assert/strict';
import test from 'node:test';
import { createElementObservation } from '../../src/shared/contracts/element-observation.js';
import { pageReferenceForResult } from '../../src/shared/tab-reference.js';
import { projectNamedDriveResult, isDriveToolDefault, isDriveToolForbidden, driveToolSignature } from '../../src/background/mcp/external-drive.js';
import { createMcpTransport } from '../../src/background/transports/mcp.js';
import { createRunScriptBridge } from '../../src/background/tools/run-script-bridge.js';
import { registerTabsNavigationTools } from '../../src/capabilities/tabs/tools.js';
import { ToolExecutionError } from '../../src/background/tools/arguments.js';

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
    getToolRuntimeDependencies:()=>({sessions:{resolveTargetTab:async()=>({ok:true,ownedByCurrentTask:true})}}),
    assertTabAllowed:async()=>{},assertUrlAllowed:()=>{},assertPageUrlAccessible:async()=>{},enablePreNavigationNetworkWatch:async()=>{},
    withDebugger:async()=>{},getDebuggerConnectionId:()=>null,setDebuggerRetention(){},releaseDebugger:async()=>{}});
  const context={sessionId:'surface',runId:'drive-test',workingTabId:5};
  const rows=await definitions.get('list_tabs').execute({},undefined,context);
  assertPublic(rows); assert.equal(rows[0].active,true);assert.equal(rows[0].tabRef,5);
  assert.equal(Object.hasOwn(rows[0],'isWorkingTab'),false);assert.equal(Object.hasOwn(rows[0],'windowId'),false);
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
