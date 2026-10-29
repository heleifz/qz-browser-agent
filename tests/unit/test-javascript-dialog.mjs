import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { createJavaScriptDialogHandler } from "../../src/background/tools/javascript-dialog.js";
import { createSessionSupervisor } from "../../src/background/session/supervisor.js";
import { ToolExecutionError } from "../../src/background/tools/arguments.js";
import { readJavaScriptDialogForm } from "../../src/shared/javascript-dialog.js";
import { normalizeWaitingForm } from "../../src/sidepanel/features/chat/transcript/waiting-card.js";

const listeners = new Set();
globalThis.chrome = {
  debugger: {
    onEvent: {
      addListener(listener) { listeners.add(listener); },
      removeListener(listener) { listeners.delete(listener); },
    },
  },
  scripting: { executeScript: async () => [] },
  runtime: { getURL: () => "chrome-extension://test/" },
};

function dispatchDebugger(tabId, method, params) {
  for (const listener of listeners) listener({ tabId }, method, params);
}

function runtimeFixture() {
  const events = [];
  const supervisor = createSessionSupervisor({ createAgent: () => ({ subscribe(emit) { this.emit = emit; } }) });
  const sessions = {
    beginUserWait: supervisor.beginUserWait,
    resolveUserWait: supervisor.resolveUserWait,
    rejectUserWait: supervisor.rejectUserWait,
    isWaitingForUser: supervisor.isWaitingForUser,
    isRunCurrent: () => true,
    async getAgent(sessionId) { return supervisor.getAgent(sessionId); },
  };
  const emit = event => events.push(event);
  const handler = createJavaScriptDialogHandler({
    ToolExecutionError,
    getToolRuntimeDependencies: () => ({ sessions, emit }),
  });
  return { handler, sessions, events, supervisor };
}

async function activeSession(supervisor, sessionId = "s1", runId = "r1") {
  const agent = await supervisor.getAgent(sessionId);
  agent.emit({ type: "agent_start", runId });
  return { sessionId, runId };
}

test("attachDialogResults adds dialog and dialogs fields", () => {
  const { handler } = runtimeFixture();
  assert.deepEqual(handler.attachDialogResults({ ok: true }, []), { ok: true });
  assert.deepEqual(handler.attachDialogResults({ ok: true }, [{ type: "alert", message: "Hi", accepted: true }]), {
    ok: true,
    dialog: { type: "alert", message: "Hi", accepted: true },
  });
  assert.equal(handler.attachDialogResults({ ok: true }, [
    { type: "alert", message: "One", accepted: true },
    { type: "confirm", message: "Two", accepted: false },
  ]).dialogs.length, 2);
});

test("accept path handles dialog and returns dialog metadata", async () => {
  const { handler, sessions, events, supervisor } = runtimeFixture();
  await activeSession(supervisor);
  const handled = [];
  const send = async (method, params = {}) => {
    if (method === "Page.handleJavaScriptDialog") handled.push(params);
    return {};
  };
  const runPromise = handler.withDialogGuard(9, { sessionId: "s1", runId: "r1" }, async (bridgeSend, bind) => {
    bind(send);
    dispatchDebugger(9, "Page.javascriptDialogOpening", { type: "confirm", message: "Delete item?" });
    for (let attempt = 0; attempt < 100 && !events.some(event => event.type === "waiting_for_user"); attempt += 1) {
      await delay(1);
    }
    const wait = events.find(event => event.type === "waiting_for_user");
    assert.ok(wait?.form?.javascriptDialog);
    sessions.resolveUserWait({ sessionId: "s1", waitId: wait.waitId, payload: { continued: true, reason: "continued" } });
    await delay(5);
    return "done";
  });
  const result = await runPromise;
  assert.equal(result.value, "done");
  assert.deepEqual(result.dialogs, [{ type: "confirm", message: "Delete item?", accepted: true }]);
  assert.deepEqual(handled, [{ accept: true }]);
});

test("cancel dismisses the dialog without accepting", async () => {
  const { handler, sessions, events, supervisor } = runtimeFixture();
  await activeSession(supervisor);
  const handled = [];
  const send = async (method, params = {}) => {
    if (method === "Page.handleJavaScriptDialog") handled.push(params);
    return {};
  };
  let releaseRun;
  const runPromise = handler.withDialogGuard(3, { sessionId: "s1", runId: "r1" }, async (_bridgeSend, bind) => {
    bind(send);
    dispatchDebugger(3, "Page.javascriptDialogOpening", { type: "alert", message: "Heads up" });
    await new Promise(resolve => { releaseRun = resolve; });
  });
  const runRejected = assert.rejects(runPromise, error => error?.code === "USER_CANCELLED_WAIT");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const wait = events.find(event => event.type === "waiting_for_user");
    if (wait) {
      releaseRun?.();
      await delay(0);
      assert.equal(sessions.rejectUserWait({ sessionId: "s1", waitId: wait.waitId }), true);
      break;
    }
    await delay(1);
    if (attempt === 99) assert.fail("waiting card missing");
  }
  await runRejected;
  assert.deepEqual(handled, [{ accept: false }]);
});

test("abort dismisses the dialog with OPERATION_ABORTED", async () => {
  const { handler, events, supervisor } = runtimeFixture();
  await activeSession(supervisor);
  const handled = [];
  const send = async (method, params = {}) => {
    if (method === "Page.handleJavaScriptDialog") handled.push(params);
    return {};
  };
  const controller = new AbortController();
  let releaseRun;
  const runPromise = handler.withDialogGuard(5, { sessionId: "s1", runId: "r1", signal: controller.signal }, async (_bridgeSend, bind) => {
    bind(send);
    dispatchDebugger(5, "Page.javascriptDialogOpening", { type: "confirm", message: "Sure?" });
    await new Promise(resolve => { releaseRun = resolve; });
  });
  const runRejected = assert.rejects(runPromise, error => error?.code === "OPERATION_ABORTED");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (events.some(event => event.type === "waiting_for_user")) {
      releaseRun?.();
      await delay(0);
      controller.abort();
      break;
    }
    await delay(1);
    if (attempt === 99) assert.fail("waiting card missing");
  }
  await runRejected;
  assert.deepEqual(handled, [{ accept: false }]);
});

test("prompt continue forwards promptText to handleJavaScriptDialog", async () => {
  const { handler, sessions, events, supervisor } = runtimeFixture();
  await activeSession(supervisor);
  const handled = [];
  const send = async (method, params = {}) => {
    if (method === "Page.handleJavaScriptDialog") handled.push(params);
    return {};
  };
  await handler.withDialogGuard(4, { sessionId: "s1", runId: "r1" }, async (_bridgeSend, bind) => {
    bind(send);
    dispatchDebugger(4, "Page.javascriptDialogOpening", { type: "prompt", message: "Name?", defaultPrompt: "guest" });
    for (let attempt = 0; attempt < 100 && !events.some(event => event.type === "waiting_for_user"); attempt += 1) {
      await delay(1);
    }
    const wait = events.find(event => event.type === "waiting_for_user");
    sessions.resolveUserWait({
      sessionId: "s1",
      waitId: wait.waitId,
      payload: { submitted: true, reason: "submitted", answers: { promptText: "alice" } },
    });
    await delay(5);
  });
  assert.deepEqual(handled, [{ accept: true, promptText: "alice" }]);
});

test("waiting card normalizes javascriptDialog form metadata", () => {
  const form = normalizeWaitingForm({
    title: "ignored",
    javascriptDialog: { type: "prompt", message: "Name?", defaultPrompt: "guest" },
    fields: [{ id: "promptText", type: "text", label: "Input", defaultValue: "guest" }],
  });
  assert.deepEqual(readJavaScriptDialogForm(form), { type: "prompt", message: "Name?", defaultPrompt: "guest" });
});
