import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { createJavaScriptDialogHandler } from "../../src/background/tools/javascript-dialog.js";
import { createSessionSupervisor } from "../../src/background/session/supervisor.js";
import { ToolExecutionError } from "../../src/background/tools/arguments.js";
import { readJavaScriptDialogForm } from "../../src/shared/javascript-dialog.js";
import { runToolWithTimeout } from "../../src/background/tools/tool-timeout.js";
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

function dispatchDebugger(tabId, method, params, sessionId) {
  for (const listener of listeners) listener({ tabId, ...(sessionId ? { sessionId } : {}) }, method, params);
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
    await bind(send);
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
    await bind(send);
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
    await bind(send);
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
    await bind(send);
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

test("Firefox guard never injects or replaces synchronous page dialog functions", async () => {
  const { handler } = runtimeFixture();
  const getURL = chrome.runtime.getURL, inject = chrome.scripting.executeScript;
  chrome.runtime.getURL = () => "moz-extension://test/";
  chrome.scripting.executeScript = async () => { assert.fail("must not inject a blocking dialog shim"); };
  try {
    const result = await handler.withDialogGuard(1, {}, async (send, bind) => {
      await bind(async () => ({}));
      assert.equal(listeners.size, 0);
      await send("Input.dispatchMouseEvent");
      return "native";
    });
    assert.deepEqual(result, { value: "native", dialogs: [] });
  } finally { chrome.runtime.getURL = getURL; chrome.scripting.executeScript = inject; }
});

test("binding awaits Page.enable and preserves child session routing and identity", async () => {
  const { handler, sessions, events, supervisor } = runtimeFixture();
  await activeSession(supervisor);
  const commands = [];
  let enabled = false;
  const root = async method => { commands.push(['root', method]); await delay(0); enabled = true; return {}; };
  root.tabId = 9; root.connectionId = 42;
  root.inSession = id => Object.assign(async (method, params) => {
    commands.push([id, method, params]);
    if (method === 'Input.dispatchMouseEvent') {
      dispatchDebugger(9, 'Page.javascriptDialogOpening', { type: 'confirm', message: '' }, id);
      setImmediate(() => sessions.resolveUserWait({ sessionId: 's1', waitId: events.at(-1).waitId, payload: { reason: 'cancelled' } }));
    }
    return {};
  }, { tabId: 9, connectionId: 42 });
  const result = await handler.withDialogGuard(9, { sessionId: 's1', runId: 'r1' }, async (send, bind) => {
    await bind(root);
    assert.equal(enabled, true);
    assert.equal(send.tabId, 9); assert.equal(send.connectionId, 42);
    await send.inSession('child').call(null, 'Input.dispatchMouseEvent', {});
  });
  assert.deepEqual(result.dialogs, [{ type: 'confirm', message: '', accepted: false }]);
  assert.ok(commands.some(([id, method, params]) => id === 'child' && method === 'Page.handleJavaScriptDialog' && params.accept === false));
  assert.equal(listeners.size, 0);
});

test("dialog failures settle blocked input and never fabricate a successful receipt", async () => {
  const { handler, sessions, events, supervisor } = runtimeFixture();
  await activeSession(supervisor);
  const run = handler.withDialogGuard(9, { sessionId: 's1', runId: 'r1' }, async (_send, bind) => {
    await bind(async method => {
      if (method === 'Page.handleJavaScriptDialog') throw new Error('browser refused answer');
      return {};
    });
    dispatchDebugger(9, 'Page.javascriptDialogOpening', { type: 'confirm', message: 'Continue?' });
    return new Promise(() => {});
  });
  const rejected = assert.rejects(run, /browser refused answer/);
  await new Promise(setImmediate);
  sessions.resolveUserWait({ sessionId: 's1', waitId: events.at(-1).waitId, payload: { continued: true } });
  await rejected;
  assert.equal(sessions.isWaitingForUser('s1'), false);
  assert.equal(listeners.size, 0);
});

test("an input failure or cancellation releases the outstanding user wait and listener", async () => {
  for (const cancel of [false, true]) {
    const { handler, sessions, events, supervisor } = runtimeFixture();
    await activeSession(supervisor);
    const controller = new AbortController();
    let release;
    const run = handler.withDialogGuard(9, { sessionId: 's1', runId: 'r1', signal: controller.signal }, async (_send, bind) => {
      await bind(async () => ({}));
      dispatchDebugger(9, 'Page.javascriptDialogOpening', { type: 'confirm', message: 'Continue?' });
      await new Promise(resolve => { release = resolve; });
      throw new Error('input failed');
    });
    const rejected = assert.rejects(run, cancel ? { code: 'OPERATION_ABORTED' } : /input failed/);
    await new Promise(setImmediate);
    assert.ok(events.some(event => event.type === 'waiting_for_user'));
    if (cancel) controller.abort(); else release();
    await rejected;
    assert.equal(sessions.isWaitingForUser('s1'), false);
    assert.equal(listeners.size, 0);
    release();
  }
});

test("dialog user time does not consume the tool deadline and Stop remains active", async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  for (const cancel of [false, true]) {
    const { handler, sessions, events, supervisor } = runtimeFixture();
    await activeSession(supervisor);
    const controller = new AbortController();
    let result;
    const pending = runToolWithTimeout('act_on_element', (signal, _partial, pauseDeadline) => handler.withDialogGuard(9,
      { sessionId: 's1', runId: 'r1', signal, pauseDeadline }, async (send, bind) => {
        await bind(async method => {
          if (method === 'Input.dispatchMouseEvent') dispatchDebugger(9, 'Page.javascriptDialogOpening', { type: 'alert', message: 'Wait' });
          return {};
        });
        await send('Input.dispatchMouseEvent');
        return 'done';
      }), controller.signal, 20, async () => assert.fail('no timeout fallback'), {});
    const settled = pending.then(value => { result = value; }, error => { result = error; });
    await new Promise(setImmediate);
    t.mock.timers.tick(24 * 60 * 60 * 1000);
    await new Promise(setImmediate);
    assert.equal(result, undefined);
    if (cancel) controller.abort();
    else sessions.resolveUserWait({ sessionId: 's1', waitId: events.at(-1).waitId, payload: { continued: true } });
    await settled;
    assert.equal(cancel ? result.code : result.value, cancel ? 'OPERATION_ABORTED' : 'done');
    assert.equal(listeners.size, 0);
  }
});

test("waiting card normalizes javascriptDialog form metadata", () => {
  const form = normalizeWaitingForm({
    title: "ignored",
    javascriptDialog: { type: "prompt", message: "Name?", defaultPrompt: "guest" },
    fields: [{ id: "promptText", type: "text", label: "Input", defaultValue: "guest" }],
  });
  assert.deepEqual(readJavaScriptDialogForm(form), { type: "prompt", message: "Name?", defaultPrompt: "guest" });
});
