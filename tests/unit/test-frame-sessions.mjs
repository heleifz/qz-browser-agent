import assert from "node:assert/strict";
import { discoverFrames, forgetTabFrames, sessionForFrame } from "../../src/background/tools/frame-sessions.ts";

const listeners = new Set();
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
const emit = (method, params) => { for (const listener of [...listeners]) listener(method, params); };
const live = new Map([["oopif-a", "session-a"]]);
let autoAttachCalls = 0;

async function send(method, _params = {}, sessionId) {
  if (method === "Target.setAutoAttach") {
    autoAttachCalls += 1;
    // Chrome reports existing targets once per debugger attachment.
    if (autoAttachCalls === 1) setTimeout(() => emit("Target.attachedToTarget", { sessionId: "session-a", targetInfo: { type: "iframe", targetId: "oopif-a" } }), 5);
    return {};
  }
  if (method === "Page.getFrameTree") {
    if (!sessionId) return { frameTree: { frame: { id: "main" }, childFrames: [] } };
    const frameId = [...live].find(([, current]) => current === sessionId)?.[0];
    if (!frameId) throw new Error("No session with given id");
    return { frameTree: { frame: { id: frameId, url: `https://${frameId}.test/` } } };
  }
  if (method === "DOM.getFrameOwner") return { backendNodeId: 40 };
  return {};
}

const first = await discoverFrames(7, send, subscribe);
assert.deepEqual(first.frames.map(frame => [frame.frameId, frame.oopif, frame.sessionId]), [["oopif-a", true, "session-a"]]);
const second = await discoverFrames(7, send, subscribe);
assert.deepEqual(second.frames.map(frame => frame.frameId), ["oopif-a"], "a repeated discovery keeps frames Chrome announced earlier");
assert.equal(autoAttachCalls, 1, "auto-attach is configured once per debugger attachment");

live.delete("oopif-a");
live.set("oopif-b", "session-b");
emit("Target.detachedFromTarget", { sessionId: "session-a" });
emit("Target.attachedToTarget", { sessionId: "session-b", targetInfo: { type: "iframe", targetId: "oopif-b" } });
const navigated = await discoverFrames(7, send, subscribe);
assert.deepEqual(navigated.frames.map(frame => frame.frameId), ["oopif-b"], "frames created after discovery are tracked");
assert.equal(await sessionForFrame(7, send, subscribe, "oopif-b"), "session-b");
assert.equal(await sessionForFrame(7, send, subscribe, "oopif-a"), undefined, "a detached frame no longer resolves to its old session");

forgetTabFrames(7);
assert.equal(listeners.size, 0, "forgetting a tab releases its debugger event listener");
console.log("frame session tracking passed");
