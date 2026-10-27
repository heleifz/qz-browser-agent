import assert from 'node:assert/strict';
import test from 'node:test';
import { viewportTree } from '../../src/capabilities/accessibility/viewport.js';

const quad = (x,y,w,h) => [x,y,x+w,y,x+w,y+h,x,y+h];
function fixture(boxes, signal) {
  const calls=[];
  const send=async (method,args={})=>{
    calls.push({method,args});
    if(method==='Page.getLayoutMetrics') return {cssVisualViewport:{clientWidth:100,clientHeight:100}};
    if(method==='Page.getFrameTree') return {frameTree:{frame:{id:'main'},childFrames:[{frame:{id:'child',loaderId:'loader'}}]}};
    if(method==='DOM.getFrameOwner') return {backendNodeId:99};
    if(method==='DOM.getBoxModel') {
      signal?.abort();
      if(args.backendNodeId===1) throw new Error('Could not compute box model');
      return {model:{content:boxes[args.backendNodeId]}};
    }
    throw new Error(`unsupported ${method}`);
  };
  return {send,calls};
}
const nodes=[{nodeId:'root',backendDOMNodeId:1,childIds:['visible','offscreen','child']},
  {nodeId:'visible',parentId:'root',backendDOMNodeId:2,childIds:['inline']},
  {nodeId:'inline',parentId:'visible'},
  {nodeId:'offscreen',parentId:'root',backendDOMNodeId:3},
  {nodeId:'child',parentId:'root',backendDOMNodeId:4,documentFrameId:'child',documentLoaderId:'loader'}];

test('viewport geometry filters offscreen descendants, preserves text/ancestors, clips child frames and reports missing geometry',async()=>{
  const {send}=fixture({2:quad(0,0,20,20),3:quad(0,200,20,20),4:quad(0,150,20,20),99:quad(0,70,100,30)});
  const result=await viewportTree(send,nodes,[]);
  assert.deepEqual(result.nodes.map(n=>n.nodeId),['root','visible','inline']);
  assert.equal(result.truncated,false);
  assert.equal(result.inViewport(nodes[3]),false);
  const failed=async(method,args)=>{if(method==='DOM.getBoxModel')throw new Error('SESSION_TAB_FOREIGN');return send(method,args);};
  await assert.rejects(viewportTree(failed,nodes,[]),/SESSION_TAB_FOREIGN/);
  await assert.rejects(viewportTree(async()=>({}),nodes,[]),/Viewport geometry unavailable/);
});

test('viewport scan respects cancellation and a bounded geometry budget',async()=>{
  const abort=new AbortController(), {send}=fixture({2:quad(0,0,20,20)},abort);
  await assert.rejects(viewportTree(send,nodes.slice(0,2),[],abort.signal),{name:'AbortError'});
  const large=Array.from({length:2100},(_,i)=>({nodeId:String(i),backendDOMNodeId:i+2}));
  const measured=fixture({});const result=await viewportTree(measured.send,large,[]);
  assert.equal(result.truncated,true);
  assert.equal(measured.calls.filter(c=>c.method==='DOM.getBoxModel').length,2000);
});
