import assert from "node:assert/strict";
import { discoverFrames, forgetTabFrames } from "../../src/background/tools/frame-sessions.ts";

const listeners = new Set();
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
const emit = (method, params) => { for (const listener of [...listeners]) listener(method, params); };
// Page "main" > cross-process "oopif-a" > same-process "inner-a" and cross-process "oopif-c".
const live = new Map([["oopif-a", "session-a"]]);
const parents = { "oopif-a": "main", "oopif-b": "main", "oopif-c": "oopif-a" };
const owners = new Map([
  [":oopif-a", 40], [":oopif-b", 41], ["session-a:inner-a", 50], ["session-a:oopif-c", 51],
]);
const autoAttached = [];

async function send(method, params = {}, sessionId) {
  if (method === "Target.setAutoAttach") {
    autoAttached.push(sessionId || "page");
    // Chrome reports existing targets once per auto-attaching session.
    if (!sessionId && autoAttached.filter(item => item === "page").length === 1) {
      setTimeout(() => emit("Target.attachedToTarget", { sessionId: "session-a", targetInfo: { type: "iframe", targetId: "oopif-a" } }), 5);
    }
    if (sessionId === "session-a") {
      live.set("oopif-c", "session-c");
      setTimeout(() => emit("Target.attachedToTarget", { sessionId: "session-c", targetInfo: { type: "iframe", targetId: "oopif-c" } }), 5);
    }
    return {};
  }
  if (method === "Page.getFrameTree") {
    if (!sessionId) return { frameTree: { frame: { id: "main", loaderId: "main-doc" }, childFrames: [] } };
    const frameId = [...live].find(([, current]) => current === sessionId)?.[0];
    if (!frameId) throw new Error("No session with given id");
    const childFrames = frameId === "oopif-a" ? [{ frame: { id: "inner-a", parentId: "oopif-a", loaderId: "inner-doc" } }] : [];
    return { frameTree: { frame: { id: frameId, parentId: parents[frameId], loaderId: `${frameId}-doc`, url: `https://${frameId}.test/` }, childFrames } };
  }
  if (method === "DOM.getFrameOwner") {
    const backendNodeId = owners.get(`${sessionId || ""}:${params.frameId}`);
    if (!backendNodeId) throw new Error("Frame with the given id does not belong to the target.");
    return { backendNodeId };
  }
  return {};
}

const first = await discoverFrames(7, send, subscribe);
assert.deepEqual(
  first.frames.map(frame => [frame.frameId, frame.oopif, frame.sessionId, frame.parentFrameId, frame.iframeBackendNodeId]).sort(),
  [
    ["inner-a", false, "session-a", "oopif-a", 50],
    ["oopif-a", true, "session-a", "main", 40],
    ["oopif-c", true, "session-c", "oopif-a", 51],
  ],
  "nested frames keep their owning session, parent frame, and owner in the parent's document",
);
assert.equal(first.mainLoaderId, "main-doc");
assert.deepEqual(autoAttached, ["page", "session-a", "session-c"], "each child target auto-attaches its own cross-process children");

const second = await discoverFrames(7, send, subscribe);
assert.equal(second.frames.length, 3, "a repeated discovery keeps frames Chrome announced earlier");
assert.equal(autoAttached.length, 3, "auto-attach is configured once per session and debugger attachment");

live.delete("oopif-a");
live.delete("oopif-c");
live.set("oopif-b", "session-b");
emit("Target.detachedFromTarget", { sessionId: "session-a" });
emit("Target.detachedFromTarget", { sessionId: "session-c" });
emit("Target.attachedToTarget", { sessionId: "session-b", targetInfo: { type: "iframe", targetId: "oopif-b" } });
const navigated = await discoverFrames(7, send, subscribe);
assert.deepEqual(navigated.frames.map(frame => [frame.frameId, frame.sessionId]), [["oopif-b", "session-b"]], "frames created after discovery are tracked");
assert.equal(navigated.frames.some(frame => frame.frameId === "oopif-a" || frame.frameId === "oopif-c"), false, "a detached frame and its children leave the tree");

forgetTabFrames(7);
assert.equal(listeners.size, 0, "forgetting a tab releases its debugger event listener");
console.log("frame session tracking passed");
