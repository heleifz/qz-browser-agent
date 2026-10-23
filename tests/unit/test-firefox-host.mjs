import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { installFirefoxDebugger } from "../../src/background/firefox/debugger-host.js";
import { installInitiatorRewrite } from "../../src/background/firefox/dnr-initiator.js";
import { installFirefoxHost } from "../../src/background/firefox/host.js";
import { installNotificationRenewal } from "../../src/background/firefox/notifications.js";
import { installOffscreenHost } from "../../src/background/firefox/offscreen-host.js";
import { jpegsToPdf, jpegSize } from "../../src/background/firefox/pdf-raster.js";
import { installWorkspacePanel } from "../../src/background/firefox/workspace-panel.js";
import { installSidepanelFirefoxHost } from "../../src/sidepanel/firefox/host.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

test("the firefox boot modules load the host before the shared entries", () => {
  const background = readFileSync(join(repoRoot, "src/background/firefox-boot.ts"), "utf8");
  const panel = readFileSync(join(repoRoot, "src/sidepanel/firefox-boot.ts"), "utf8");
  assert.match(background, /import "\.\/firefox\/host\.js";\s*import "\.\/service-worker\.js";/);
  assert.match(panel, /import "\.\/firefox\/host\.js";\s*import "\.\/sidepanel\.js";/);
});

test("sidebarAction.open runs inside the user-gesture turn", async () => {
  const calls = [];
  let updateCalled = false;
  const browser = {
    sidebarAction: {
      open(options) {
        calls.push(options || {});
        if (options?.windowId) return Promise.reject(new Error("windowId rejected"));
        return Promise.resolve();
      },
    },
    action: { onClicked: { addListener(listener) { browser.clicked = listener; } } },
    windows: { update() { updateCalled = true; return new Promise(() => {}); } },
  };
  installWorkspacePanel(browser);
  await browser.sidePanel.open({ windowId: 4, tabId: 9 });
  assert.deepEqual(calls, [{ windowId: 4 }, {}]);
  assert.equal(updateCalled, false);
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  browser.clicked();
  assert.equal(calls.at(-1).windowId, undefined);
});

test("initiatorDomains use the moz-extension host on Firefox and stay unchanged on Chrome", async () => {
  const seen = [];
  const firefox = rulesChrome("qz-browser-agent@heleifz.github.io", "moz-extension://uuid/", seen);
  installInitiatorRewrite(firefox);
  await firefox.declarativeNetRequest.updateSessionRules({ addRules: [{ id: 1, condition: { initiatorDomains: [firefox.runtime.id] } }] });
  assert.deepEqual(seen[0].addRules[0].condition.initiatorDomains, ["uuid"]);
  const chrome = rulesChrome("abcdefghijklmnopabcdefghijklmnop", "chrome-extension://abcdefghijklmnopabcdefghijklmnop/", seen);
  installInitiatorRewrite(chrome);
  await chrome.declarativeNetRequest.updateDynamicRules({ addRules: [{ id: 2, condition: { initiatorDomains: [chrome.runtime.id] } }] });
  assert.deepEqual(seen[1].addRules[0].condition.initiatorDomains, [chrome.runtime.id]);
});

test("requireInteraction renews a notification until the user closes it", async () => {
  let created = 0;
  const browser = {
    notifications: {
      async create(id) { created += 1; return id; },
      onClosed: { addListener(listener) { browser.closed = listener; } },
      onClicked: { addListener(listener) { browser.clicked = listener; } },
    },
  };
  installNotificationRenewal(browser);
  await browser.notifications.create("done", { requireInteraction: true, priority: 2 });
  browser.closed("done", false);
  await Promise.resolve();
  assert.equal(created, 2);
  browser.closed("done", true);
  await Promise.resolve();
  assert.equal(created, 2);
  browser.clicked("done");
  browser.closed("done", false);
  await Promise.resolve();
  assert.equal(created, 2);
});

test("the offscreen host loads the shared document in a hidden frame", async () => {
  let frame;
  const doc = {
    documentElement: { appendChild(node) { node.isConnected = true; node.listeners?.load?.(); } },
    createElement() {
      frame = { src: "", hidden: false, style: {}, isConnected: false, listeners: {}, addEventListener(type, listener) { this.listeners[type] = listener; } };
      return frame;
    },
  };
  const browser = { runtime: { getURL: path => `moz-extension://uuid/${path}` } };
  installOffscreenHost(browser, doc);
  await browser.offscreen.createDocument({ url: "offscreen.html" });
  assert.equal(frame.src, "moz-extension://uuid/offscreen.html");
  assert.equal(frame.hidden, true);
  assert.equal(await browser.offscreen.hasDocument(), true);
});

test("sidebar links and case recording use Firefox equivalents", async () => {
  let stopped = false;
  const stream = { getAudioTracks: () => [{ stop() { stopped = true; } }] };
  const media = {
    getDisplayMedia: async () => stream,
    async getUserMedia() { throw new Error("desktop constraints are not supported"); },
  };
  const browser = {
    tabs: { async create(properties) { return properties; } },
    permissions: { async request() { return false; } },
  };
  installSidepanelFirefoxHost(browser, media);
  assert.equal((await browser.tabs.create({ url: "chrome://extensions/shortcuts" })).url, "about:addons");
  assert.equal(await browser.permissions.request({ permissions: ["desktopCapture"] }), true);
  assert.equal(await browser.permissions.request({ permissions: ["history"] }), false);
  const chosen = await new Promise(resolve => browser.desktopCapture.chooseDesktopMedia(["screen", "audio"], resolve));
  assert.equal(chosen, "firefox-display");
  const recorded = await media.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: chosen } } });
  assert.equal(recorded, stream);
  assert.equal(stopped, true);
});

test("jpeg pages become a pdf", () => {
  const jpeg = new Uint8Array([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0xff, 0xd9,
  ]);
  assert.deepEqual(jpegSize(jpeg), { width: 3, height: 2 });
  const pdf = new TextDecoder().decode(jpegsToPdf([jpeg]));
  assert.match(pdf, /^%PDF-1\.4/);
  assert.match(pdf, /\/Width 3/);
  assert.match(pdf, /\/Height 2/);
  assert.match(pdf, /%%EOF/);
});

test("the debugger shim reports frames, isolated contexts, clicks, and network bodies", async () => {
  const events = [];
  const element = {
    nodeName: "BUTTON", nodeType: 1, textContent: "Go", childNodes: [{ nodeType: 3, nodeValue: "Go" }],
    attributes: {}, events: [],
    getAttribute(name) { return this.attributes[name] ?? null; },
    setAttribute(name, value) { this.attributes[name] = value; },
    hasAttribute() { return false; },
    getBoundingClientRect() { return { x: 4, y: 5, width: 6, height: 7, left: 4, top: 5, right: 10, bottom: 12 }; },
    dispatchEvent(event) { this.events.push(event.type); return true; },
  };
  const document = {
    nodeType: 9, nodeName: "#document", title: "Example", documentElement: element, body: element, activeElement: element,
    scrollingElement: { scrollLeft: 0, scrollTop: 0, scrollWidth: 100, scrollHeight: 100, clientWidth: 50, clientHeight: 40 },
    querySelectorAll: selector => selector === "button" ? [element] : [],
    elementFromPoint: () => element,
    execCommand() { return true; },
    defaultView: { scrollX: 0, scrollY: 0, innerWidth: 50, innerHeight: 40, getComputedStyle: () => ({ display: "block", visibility: "visible" }) },
  };
  const previous = globalThis.document;
  globalThis.document = document;
  const networkListeners = {};
  const browser = {
    runtime: { id: "qz-browser-agent@heleifz.github.io", onMessage: { addListener() {} } },
    tabs: { onRemoved: { addListener(listener) { browser.removed = listener; } }, async get() { return { windowId: 1, url: "https://example.test/" }; } },
    webNavigation: {
      async getAllFrames() { return [{ frameId: 0, parentFrameId: -1, url: "https://example.test/" }, { frameId: 7, parentFrameId: 0, url: "https://other.test/frame" }]; },
      onCommitted: { addListener() {} },
    },
    scripting: { async executeScript({ func, args }) {
      if (func.name !== "firefoxPageCommand") return [{ result: undefined }];
      return [{ result: await func(...(args || [])) }];
    } },
    webRequest: {
      onBeforeRequest: { addListener(listener) { networkListeners.before = listener; } },
      onBeforeSendHeaders: { addListener(listener) { networkListeners.headers = listener; } },
      onHeadersReceived: { addListener(listener) { networkListeners.response = listener; } },
      onCompleted: { addListener(listener) { networkListeners.completed = listener; } },
      onErrorOccurred: { addListener() {} },
      filterResponseData() { throw new Error("unavailable"); },
    },
  };
  try {
    installFirefoxDebugger(browser);
    browser.debugger.onEvent.addListener((source, method, params) => events.push({ source, method, params }));
    browser.debugger.onDetach.addListener((_source, reason) => events.push({ reason }));
    await browser.debugger.attach({ tabId: 3 }, "1.3");
    const tree = await browser.debugger.sendCommand({ tabId: 3 }, "Page.getFrameTree");
    assert.equal(tree.frameTree.frame.id, "0");
    assert.deepEqual(tree.frameTree.childFrames, []);
    await browser.debugger.sendCommand({ tabId: 3 }, "Target.setAutoAttach", { autoAttach: true, flatten: true });
    const attached = events.find(event => event.method === "Target.attachedToTarget");
    assert.equal(attached.params.sessionId, "ff-3-7");
    assert.equal(attached.params.targetInfo.parentFrameId, "0");
    assert.equal(attached.source.sessionId, undefined);
    await browser.debugger.sendCommand({ tabId: 3 }, "Runtime.enable");
    const isolated = events.find(event => event.method === "Runtime.executionContextCreated" && event.params.context.auxData.type === "isolated");
    assert.equal(isolated.params.context.origin, "chrome-extension://qz-browser-agent@heleifz.github.io");
    const agent = await browser.debugger.sendCommand({ tabId: 3 }, "Runtime.evaluate", { expression: "navigator.userAgent", returnByValue: true });
    assert.match(agent.result.value, /Chrome\/131\.0\.0\.0/);
    const root = await browser.debugger.sendCommand({ tabId: 3 }, "DOM.getDocument", { depth: 0 });
    const queried = await browser.debugger.sendCommand({ tabId: 3 }, "DOM.querySelectorAll", { nodeId: root.root.nodeId, selector: "button" });
    const described = await browser.debugger.sendCommand({ tabId: 3 }, "DOM.describeNode", { nodeId: queried.nodeIds[0] });
    assert.equal(described.node.nodeName, "BUTTON");
    await browser.debugger.sendCommand({ tabId: 3 }, "Input.dispatchMouseEvent", { type: "mousePressed", x: 4, y: 5, button: "left", clickCount: 1 });
    await browser.debugger.sendCommand({ tabId: 3 }, "Input.dispatchMouseEvent", { type: "mouseReleased", x: 4, y: 5, button: "left", clickCount: 1 });
    assert.ok(element.events.includes("click"));
    const ax = await browser.debugger.sendCommand({ tabId: 3 }, "Accessibility.getFullAXTree", {});
    assert.equal(ax.nodes[0].role.value, "RootWebArea");
    assert.ok(ax.nodes.some(node => node.role.value === "button" && node.backendDOMNodeId === described.node.backendNodeId));
    await browser.debugger.sendCommand({ tabId: 3 }, "Network.enable");
    networkListeners.headers({ requestId: "20", tabId: 3, url: "https://example.test/a", method: "GET", type: "xmlhttprequest", timeStamp: 1_700_000_000_000, requestHeaders: [{ name: "Accept", value: "application/json" }] });
    networkListeners.completed({ requestId: "20", tabId: 3, url: "https://example.test/a", type: "xmlhttprequest", timeStamp: 1_700_000_000_500, responseHeaders: [{ name: "content-length", value: "4" }] });
    const started = events.find(event => event.method === "Network.requestWillBeSent");
    assert.equal(started.params.request.url, "https://example.test/a");
    assert.equal(started.params.timestamp, 1_700_000_000);
    assert.equal(started.source.sessionId, undefined);
    await assert.rejects(() => browser.debugger.sendCommand({ tabId: 3 }, "Network.getResponseBody", { requestId: "20" }), /No data found/);
    await assert.rejects(() => browser.debugger.sendCommand({ tabId: 3 }, "Network.loadNetworkResource", {}), /not available in Firefox/);
    await browser.debugger.detach({ tabId: 3 });
    assert.equal(events.some(event => event.reason), false);
    browser.removed(3);
    assert.equal(events.some(event => event.reason === "target_closed"), false);
    await browser.debugger.attach({ tabId: 3 }, "1.3");
    browser.removed(3);
    assert.equal(events.some(event => event.reason === "target_closed"), true);
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
    delete globalThis.__qzFirefoxPage;
  }
});

test("installing the host is idempotent and leaves a real debugger in place", () => {
  const real = { async sendCommand() { return { real: true }; }, async attach() {}, async detach() {} };
  const browser = { debugger: real, sidebarAction: { open() { return Promise.resolve(); } } };
  installFirefoxHost(browser);
  installFirefoxHost(browser);
  assert.equal(browser.debugger, real);
});

function rulesChrome(id, url, seen) {
  return {
    runtime: { id, getURL: () => url },
    declarativeNetRequest: {
      updateSessionRules: async update => { seen.push(update); },
      updateDynamicRules: async update => { seen.push(update); },
    },
  };
}
