import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ToolExecutionError } from "../../src/background/tools/arguments.js";
import { createCdpRuntime, isCdpFallbackForbiddenError } from "../../src/background/tools/cdp-runtime.js";
import { installFirefoxDebugger } from "../../src/background/firefox/debugger-host.js";
import { registerPageElementTools } from "../../src/capabilities/page/tools.js";

const context = { sessionId: "dialog-owner", runId: "dialog-run" };

describe("act_on_element JavaScript dialogs", { concurrency: false }, () => {
  test("click returns alert, confirm, prompt, and beforeunload instead of hanging", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const started = Date.now();
    const harness = createChromeHarness();
    const cases = [
      { type: "alert", message: "Heads up: code 4417", url: "http://localhost:8861/dynamic" },
      { type: "confirm", message: "Leave?" },
      { type: "prompt", message: "Code?", defaultPrompt: "4417" },
      { type: "beforeunload", message: "Changes you made may not be saved." },
    ];
    try {
      for (const dialog of cases) {
        harness.mode = "event";
        harness.dialog = dialog;
        harness.handled.length = 0;
        const result = await finish(harness.call(), t);
        assert.equal(result.action, "click");
        assert.equal(result.inputDelivered, true);
        assert.deepEqual(result.dialog, {
          type: dialog.type,
          message: dialog.message,
          accepted: true,
          ...(dialog.url ? { url: dialog.url } : {}),
          ...(dialog.defaultPrompt !== undefined ? { defaultPrompt: dialog.defaultPrompt } : {}),
        });
        assert.equal(result.dialogs, undefined);
        assert.deepEqual(harness.handled, [dialog.type === "prompt"
          ? { accept: true, promptText: dialog.defaultPrompt }
          : { accept: true }]);
        assert.equal(harness.actions.includes("actOnElement"), false);
      }
      assert.equal(harness.commands.filter(command => command.method === "Page.enable").length, 1);
      assert.ok(Date.now() - started < 1500, "dialog clicks waited for the stall timer");
    } finally { await harness.release(); }
  });

  test("a click that opens no dialog omits the dialog field", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const harness = createChromeHarness();
    try {
      harness.mode = "none";
      const result = await finish(harness.call(), t);
      assert.equal(result.action, "click");
      assert.equal("dialog" in result, false);
      assert.equal(harness.handled.length, 0);
    } finally { await harness.release(); }
  });

  test("a dialog event that never arrives is accepted and the click returns", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const harness = createChromeHarness();
    try {
      harness.mode = "stall";
      const result = await finish(harness.call(), t);
      assert.equal(result.action, "click");
      assert.equal("dialog" in result, false);
      assert.deepEqual(harness.handled, [{ accept: true, promptText: "" }]);
    } finally { await harness.release(); }
  });

  test("a dialog that stays open fails the click instead of hanging or replaying it", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const started = Date.now();
    const harness = createChromeHarness();
    try {
      harness.mode = "stuck";
      const error = await finish(harness.call(), t).then(() => { throw new Error("click resolved"); }, value => value);
      assert.equal(error.code, "JAVASCRIPT_DIALOG_TIMEOUT");
      assert.match(error.message, /JavaScript dialog/);
      assert.equal(error.details.method, "Input.dispatchMouseEvent");
      assert.equal(isCdpFallbackForbiddenError(error), true);
      assert.equal(harness.actions.includes("actOnElement"), false);
      assert.ok(Date.now() - started < 1500, "the dialog timeout waited on a real clock");
    } finally { await harness.release(); }
  });

  test("Firefox accepts alert, confirm, and prompt in the page and reports the same dialog", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const started = Date.now();
    const harness = createFirefoxHarness();
    const cases = [
      { kind: "alert", dialog: { type: "alert", message: "Heads up: code 4417", accepted: true }, continued: "alert" },
      { kind: "confirm", dialog: { type: "confirm", message: "Leave?", accepted: true }, continued: "confirm-yes" },
      { kind: "prompt", dialog: { type: "prompt", message: "Code?", defaultPrompt: "4417", accepted: true }, continued: "prompt:4417" },
    ];
    try {
      for (const item of cases) {
        harness.kind = item.kind;
        harness.continued = "";
        const result = await finish(harness.call(), t);
        assert.equal(harness.blocked, false, "the native dialog must not block the page");
        assert.equal(harness.continued, item.continued);
        assert.deepEqual(result.dialog, item.dialog);
      }
      assert.ok(harness.handled.some(params => params.promptText === "4417"));
      await harness.release();
      assert.equal(globalThis.__qzPageDialogGuard, undefined);
      assert.throws(() => globalThis.alert("still blocked"), /native alert blocked/);
      assert.ok(Date.now() - started < 1500, "Firefox dialog clicks waited for the stall timer");
    } finally { harness.restore(); }
  });
});

function finish(pending, t) {
  pending.catch(() => {});
  return (async () => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const winner = await Promise.race([
        pending.then(value => ({ done: true, value }), error => ({ done: true, error })),
        new Promise(resolve => { setImmediate(() => resolve({ done: false })); }),
      ]);
      if (winner.done) {
        if (winner.error) throw winner.error;
        return winner.value;
      }
      t.mock.timers.tick(250);
    }
    throw new Error("act_on_element did not finish");
  })();
}

function createChromeHarness() {
  const commands = [];
  const actions = [];
  const handled = [];
  const listeners = [];
  let blocked = null;
  const state = { mode: "event", dialog: null };
  const navigationListeners = new Set();
  globalThis.chrome = {
    storage: { local: { async get() { return {}; } } },
    tabs: {
      async get() { return { url: "https://example.test/", title: "Fixture", status: "complete" }; },
      onUpdated: {
        addListener(listener) { navigationListeners.add(listener); },
        removeListener(listener) { navigationListeners.delete(listener); },
      },
    },
    scripting: { async executeScript({ args }) {
      if (!args) return [{ frameId: 0, documentId: "fixture", result: { width: 800, height: 600 } }];
      return [{ frameId: 0, documentId: "fixture", result: args[1] ? 0 : 1 }];
    } },
  };
  const runtime = createCdpRuntime({
    ToolExecutionError,
    isRunCurrent: () => true,
    debuggerApi: {
      onEvent: { addListener(listener) { listeners.push(listener); } },
      onDetach: { addListener() {} },
      async attach() {},
      async detach() {},
      sendCommand(target, method, params) {
        commands.push({ method, params });
        if (method === "Page.handleJavaScriptDialog") {
          handled.push(params);
          if (state.mode !== "stuck") {
            const finishCommand = blocked;
            blocked = null;
            finishCommand?.();
          }
          return {};
        }
        if (method === "Input.dispatchMouseEvent" && params?.type === "mouseReleased" && state.mode !== "none") {
          return new Promise(resolve => {
            blocked = () => resolve({});
            if (state.mode === "event") queueMicrotask(() => {
              for (const listener of listeners) listener({ tabId: target.tabId }, "Page.javascriptDialogOpening", state.dialog);
            });
          });
        }
        return {};
      },
    },
  });
  let execute;
  registerPageElementTools({
    registerTool(definition) { if (definition.name === "act_on_element") execute = definition.execute; },
    ToolExecutionError,
    async resolveElementReference(tabId, { target, index }) { return { tabId, target, selector: "#target", index }; },
    elementTargetForSelector: selector => `css:${selector}`,
    getElementTargetDescription: () => "test target",
    async sendToContent(_tabId, action) {
      actions.push(action);
      return { tag: "button", disabled: false, clickablePoint: { x: 20, y: 20 } };
    },
    clickPointReady: inspected => Boolean(inspected.clickablePoint),
    clickNotReadyResult: () => ({ error: "No point", code: "CLICK_POINT_OUT_OF_VIEWPORT" }),
    getPageContext: () => ({ pageMode: "desktop" }),
    async getTabPageState() { return { url: "https://example.test/", title: "Fixture" }; },
    pageStateDelta: (before, after) => ({ pageBefore: before, pageAfter: after, urlChanged: false, titleChanged: false }),
    async prepareKnownPageNavigation() { return null; },
    commitObservedPageNavigation: () => null,
    sendCdp: (...args) => runtime.sendCdp(...args),
    withDebugger: (...args) => runtime.withDebugger(...args),
  });
  return {
    commands, actions, handled,
    get mode() { return state.mode; },
    set mode(value) { state.mode = value; },
    set dialog(value) { state.dialog = value; },
    call: () => execute({ tabId: 7, target: "css:#target", action: "click" }, undefined, context),
    release: () => runtime.releaseRun(context.sessionId, context.runId),
  };
}

function createFirefoxHarness() {
  const saved = {
    chrome: globalThis.chrome,
    document: globalThis.document,
    alert: globalThis.alert,
    confirm: globalThis.confirm,
    prompt: globalThis.prompt,
  };
  const handled = [];
  const state = { kind: "alert", continued: "", blocked: false };
  const button = {
    nodeName: "BUTTON",
    nodeType: 1,
    dispatchEvent(event) {
      if (event?.type !== "click") return true;
      if (state.kind === "alert") {
        globalThis.alert("Heads up: code 4417");
        state.continued = "alert";
      } else if (state.kind === "confirm") {
        state.continued = globalThis.confirm("Leave?") ? "confirm-yes" : "confirm-no";
      } else {
        state.continued = `prompt:${globalThis.prompt("Code?", "4417")}`;
      }
      return true;
    },
  };
  globalThis.document = { nodeType: 9, documentElement: button, body: button, elementFromPoint: () => button };
  const block = kind => () => {
    state.blocked = true;
    throw new Error(`native ${kind} blocked the tab`);
  };
  globalThis.alert = block("alert");
  globalThis.confirm = block("confirm");
  globalThis.prompt = block("prompt");
  const navigationListeners = new Set();
  globalThis.chrome = {
    storage: { local: { async get() { return {}; } } },
    tabs: {
      async get() { return { url: "https://example.test/", title: "Fixture", status: "complete" }; },
      onUpdated: {
        addListener(listener) { navigationListeners.add(listener); },
        removeListener(listener) { navigationListeners.delete(listener); },
      },
    },
    scripting: { async executeScript({ func, args }) {
      const name = func?.name || "";
      if (["firefoxPageCommand", "installPageDialogGuard", "readPageDialogGuard", "removePageDialogGuard"].includes(name)) {
        return [{ frameId: 0, documentId: "page", result: await func(...(args || [])) }];
      }
      if (!args) return [{ frameId: 0, documentId: "page", result: { width: 800, height: 600 } }];
      return [{ frameId: 0, documentId: "page", result: null }];
    } },
  };
  installFirefoxDebugger(globalThis.chrome);
  const sendCommand = globalThis.chrome.debugger.sendCommand.bind(globalThis.chrome.debugger);
  globalThis.chrome.debugger.sendCommand = async (target, method, params) => {
    if (method === "Page.handleJavaScriptDialog") handled.push(params);
    return sendCommand(target, method, params);
  };
  const runtime = createCdpRuntime({
    ToolExecutionError,
    isRunCurrent: () => true,
    debuggerApi: globalThis.chrome.debugger,
  });
  let execute;
  registerPageElementTools({
    registerTool(definition) { if (definition.name === "act_on_element") execute = definition.execute; },
    ToolExecutionError,
    async resolveElementReference(tabId, { target, index }) { return { tabId, target, selector: "#target", index }; },
    elementTargetForSelector: selector => `css:${selector}`,
    getElementTargetDescription: () => "test target",
    async sendToContent() { return { tag: "button", disabled: false, clickablePoint: { x: 20, y: 20 } }; },
    clickPointReady: inspected => Boolean(inspected.clickablePoint),
    clickNotReadyResult: () => ({ error: "No point", code: "CLICK_POINT_OUT_OF_VIEWPORT" }),
    getPageContext: () => ({ pageMode: "desktop" }),
    async getTabPageState() { return { url: "https://example.test/", title: "Fixture" }; },
    pageStateDelta: (before, after) => ({ pageBefore: before, pageAfter: after, urlChanged: false, titleChanged: false }),
    async prepareKnownPageNavigation() { return null; },
    commitObservedPageNavigation: () => null,
    sendCdp: (...args) => runtime.sendCdp(...args),
    withDebugger: (...args) => runtime.withDebugger(...args),
  });
  return {
    handled,
    get blocked() { return state.blocked; },
    get continued() { return state.continued; },
    set continued(value) { state.continued = value; },
    set kind(value) { state.kind = value; },
    call: () => execute({ tabId: 11, target: "css:#target", action: "click" }, undefined, context),
    release: () => runtime.releaseRun(context.sessionId, context.runId),
    restore() {
      globalThis.chrome = saved.chrome;
      globalThis.document = saved.document;
      globalThis.alert = saved.alert;
      globalThis.confirm = saved.confirm;
      globalThis.prompt = saved.prompt;
      delete globalThis.__qzPageDialogGuard;
      delete globalThis.__qzFirefoxPage;
      delete globalThis.__qzExtensionInputEvents;
    },
  };
}
