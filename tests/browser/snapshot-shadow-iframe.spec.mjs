import http from "node:http";
import { chromium } from "playwright";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./fixtures.mjs";
import { ensureTestExtension } from "../support/extension-build.mjs";

const PORT = 8133;
const SIBLING_PORT = 8134;
const NESTED_PORT = 8135;

/** Serves `pages` on every port and drives the real tool runtime from the extension worker. */
async function launchFixture(ports, pages, url) {
  const handler = (request, response) => {
    const body = pages[new URL(request.url, "http://localhost").pathname];
    response.writeHead(body ? 200 : 404, { "content-type": "text/html" });
    response.end(body || "");
  };
  const servers = ports.map(() => http.createServer(handler));
  await Promise.all(servers.map((server, index) => new Promise(resolve => server.listen(ports[index], resolve))));
  const directory = await mkdtemp(join(tmpdir(), "qz-snapshot-fixtures-"));
  let browser;
  const close = async () => {
    await browser?.close();
    await rm(directory, { recursive: true, force: true });
    for (const server of servers) server.close();
  };
  try {
    const extension = join(directory, "extension");
    await cp(await ensureTestExtension(), extension, { recursive: true });
    const manifestPath = join(extension, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    await writeFile(join(extension, "snapshot-fixture-worker.js"), `import "./${manifest.background.service_worker}";
      import { createToolRuntime, releaseRunCdp } from "./background/tools/runtime.js";
      import { createSessionTabs } from "./background/session/tabs.js";
      globalThis.snapshotFixtures = { createToolRuntime, createSessionTabs, releaseRunCdp };`);
    manifest.background.service_worker = "snapshot-fixture-worker.js";
    await writeFile(manifestPath, JSON.stringify(manifest));
    browser = await chromium.launchPersistentContext(join(directory, "profile"), {
      headless: true,
      executablePath: chromium.executablePath(),
      ignoreDefaultArgs: ["--disable-extensions"],
      viewport: { width: 1000, height: 700 },
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
        "--no-proxy-server",
        "--site-per-process",
      ],
    });
    const worker = browser.serviceWorkers()[0] || await browser.waitForEvent("serviceworker");
    await worker.evaluate(() => {
      const runtimes = new Map([["fixture", { sessionId: "fixture", ownedTabIds: [] }]]);
      const supervisor = {
        getRuntime: id => runtimes.get(id) || null,
        setRuntime: (id, value) => { runtimes.set(id, value); return value; },
        runtimeEntries: () => [...runtimes],
        isRunCurrent: () => true,
      };
      const sessions = snapshotFixtures.createSessionTabs({
        supervisor, tabsApi: chrome.tabs, storage: chrome.storage.local,
        getSessions: async () => ({ fixture: { id: "fixture", parentSessionId: "0" } }),
        isAutomationSessionFamily: () => false,
        setRuntime: (id, patch) => supervisor.setRuntime(id, { ...supervisor.getRuntime(id), ...patch }),
        persistRuntime: async () => {},
        ensureTabGroupForWindow: async () => null,
      });
      const runtime = snapshotFixtures.createToolRuntime({
        sessions: { ...sessions, isRunCurrent: supervisor.isRunCurrent },
        windowTarget: { resolveForNewTab: async () => (await chrome.windows.getAll())[0].id },
      });
      globalThis.fixtureCall = async (name, args, runId = "fixture-run") => {
        try {
          return await runtime.execute(name, args, new AbortController().signal, {
            ...supervisor.getRuntime("fixture"), sessionId: "fixture", runId, language: "en",
          });
        } catch (error) {
          return { code: error.code, error: error.message, details: error.details };
        }
      };
    });
    const call = (name, args, runId) => worker.evaluate(({ name, args, runId }) => fixtureCall(name, args, runId), { name, args, runId });
    const opened = await call("open_tab", { url });
    expect(opened.error, JSON.stringify(opened)).toBeUndefined();
    const tabId = opened.id;
    await worker.evaluate(async (id) => { await chrome.tabs.update(id, { active: true }); }, tabId);
    const page = browser.pages().find(item => item.url().startsWith(url)) || await browser.waitForEvent("page");
    return { browser, worker, call, page, tabId, close };
  } catch (error) {
    await close();
    throw error;
  }
}

const uidFor = (snapshot, label) => snapshot.split("\n").find(line => line.includes(`"${label}"`))?.match(/target=(uid:\S+)/)?.[1];

function pageHtml() {
  return `<!doctype html><title>snapshot fixtures</title>
    <button id="decoy" onclick="window.__clicks.push('decoy')">Decoy</button>
    <input id="shared-field" aria-label="Shared field one" onclick="window.__dupClicks=(window.__dupClicks||0)+1">
    <input id="shared-field" aria-label="Shared field two" onclick="window.__dupClicks=(window.__dupClicks||0)+1">
    <select id="shared-select" aria-label="Shared choice one"><option value="one">One</option><option value="two">Two</option></select>
    <select id="shared-select" aria-label="Shared choice two"><option value="one">One</option><option value="two">Two</option></select>
    <open-host></open-host>
    <closed-host></closed-host>
    <div style="position:relative;width:200px"><covered-host></covered-host>
      <div id="overlay" onclick="window.__clicks.push('overlay')" style="position:absolute;inset:0;background:#fff8"></div></div>
    <iframe id="same" src="http://localhost:${PORT}/same.html" width="420" height="70"></iframe>
    <iframe id="cross" src="http://127.0.0.1:${PORT}/cross.html" width="420" height="70"></iframe>
    <iframe id="sibling" src="http://localhost:${SIBLING_PORT}/sibling.html" width="420" height="70"></iframe>
    <div style="height:2200px"></div>
    <button id="below" onclick="window.__clicks.push('below')">Below fold</button>
    <script>
      window.__clicks = [];
      customElements.define("open-host", class extends HTMLElement { connectedCallback() {
        const root = this.attachShadow({ mode: "open" });
        root.innerHTML = '<input aria-label="Shadow field"><button>Open shadow action</button>';
        root.querySelector("button").onclick = () => window.__clicks.push("open");
      } });
      customElements.define("covered-host", class extends HTMLElement { connectedCallback() {
        const root = this.attachShadow({ mode: "open" });
        root.innerHTML = '<button>Covered shadow action</button>';
        root.querySelector("button").onclick = () => window.__clicks.push("covered");
      } });
      customElements.define("closed-host", class extends HTMLElement { connectedCallback() {
        const root = this.attachShadow({ mode: "closed" });
        root.innerHTML = '<button>Closed shadow action</button><select aria-label="Closed choice"><option value="alpha">Alpha</option><option value="beta">Beta</option></select><input type="checkbox" aria-label="Closed agree">';
        root.querySelector("button").onclick = () => window.__clicks.push("closed");
        root.querySelector("select").onchange = () => { window.__closedChoice = root.querySelector("select").value; };
        root.querySelector("input").onchange = () => { window.__closedChecked = root.querySelector("input").checked; };
      } });
    </script>`;
}

function frameHtml(label, field) {
  return `<!doctype html><form onsubmit="event.preventDefault(); window.__submitted=document.querySelector('#field').value">
    <button type="button" onclick="window.__clicked='${label}'; window.__clickCount=(window.__clickCount||0)+1">${label}</button>
    <input id="field" aria-label="${field}">
  </form>`;
}

test("snapshots include shadow and frame content and act on the named target", async () => {
  test.setTimeout(120_000);
  const pages = {
    "/": pageHtml(),
    "/same.html": frameHtml("Same frame action", "Same frame field"),
    "/cross.html": frameHtml("Cross frame action", "Cross frame field"),
    "/moved.html": frameHtml("Moved frame action", "Moved frame field"),
    "/returned.html": frameHtml("Returned frame action", "Returned frame field"),
    "/leave.html": `<!doctype html><form action="/landed.html"><input aria-label="Leave field" name="q"></form>`,
    "/landed.html": `<!doctype html><title>landed</title><p>Left the frame</p>`,
    "/sibling.html": frameHtml("Sibling origin action", "Sibling origin field"),
  };
  // Another port is a cross-origin frame that still shares the page's site and process.
  const fixture = await launchFixture([PORT, SIBLING_PORT], pages, `http://localhost:${PORT}/`);
  try {
    const { call, page, tabId } = fixture;
    await page.waitForSelector("#decoy");
    await page.frameLocator("#cross").locator("button").waitFor();
    await page.frameLocator("#sibling").locator("button").waitFor();

    const ax = await call("get_ax_tree", { tabId });
    expect(ax.error, JSON.stringify(ax)).toBeUndefined();
    expect(ax.snapshot, JSON.stringify(ax)).toContain("Shadow field");
    expect(ax.snapshot).toContain("Open shadow action");
    expect(ax.snapshot).toContain("Closed shadow action");
    expect(ax.snapshot).toContain("Closed choice");
    expect(ax.snapshot).toContain("Closed agree");
    expect(ax.snapshot).toContain("Shared field two");
    expect(ax.snapshot).toContain("Shared choice two");
    expect(ax.snapshot).toContain("Same frame action");
    expect(ax.snapshot).toContain("Cross frame action");
    expect(ax.snapshot).toContain("Sibling origin action");
    expect(ax.snapshot).toContain("Below fold");
    expect(ax.frames.length).toBeGreaterThan(0);
    expect(ax.frames.some(frame => frame.oopif === true)).toBe(true);
    expect(ax.offscreenBelow).toBeUndefined();

    const uid = (snapshot, label) => snapshot.split("\n").find(line => line.includes(`"${label}"`))?.match(/target=(uid:\S+)/)?.[1];
    const click = async (label) => call("act_on_element", { tabId, target: uid(ax.snapshot, label), action: "click" });
    const closed = await click("Closed shadow action");
    expect(closed.error, JSON.stringify(closed)).toBeUndefined();
    expect(closed.method).toBe("backend-node");
    const open = await click("Open shadow action");
    expect(open.error, JSON.stringify(open)).toBeUndefined();
    const same = await click("Same frame action");
    expect(same.error, JSON.stringify(same)).toBeUndefined();
    expect(same.frameId).toBeTruthy();
    const cross = await click("Cross frame action");
    expect(cross.error, JSON.stringify(cross)).toBeUndefined();
    expect(cross.frameId).toBeTruthy();
    const covered = await click("Covered shadow action");
    expect(covered.code, JSON.stringify(covered)).toBe("ELEMENT_OBSCURED");
    const sibling = await click("Sibling origin action");
    expect(sibling.error, JSON.stringify(sibling)).toBeUndefined();
    expect(await page.evaluate(() => window.__clicks)).toEqual(["closed", "open"]);
    expect(await page.frameLocator("#sibling").locator("button").evaluate(button => button.ownerDocument.defaultView.__clicked)).toBe("Sibling origin action");
    expect(await page.frameLocator("#same").locator("button").evaluate(button => button.ownerDocument.defaultView.__clicked)).toBe("Same frame action");
    expect(await page.frameLocator("#cross").locator("button").evaluate(button => button.ownerDocument.defaultView.__clicked)).toBe("Cross frame action");

    const shadowFill = await call("act_on_element", { tabId, target: uid(ax.snapshot, "Shadow field"), action: "fill", value: "shadow value" });
    expect(shadowFill.error, JSON.stringify(shadowFill)).toBeUndefined();
    expect(shadowFill.value).toBe("shadow value");
    const sameFill = await call("act_on_element", { tabId, target: uid(ax.snapshot, "Same frame field"), action: "fill", value: "same value" });
    expect(sameFill.error, JSON.stringify(sameFill)).toBeUndefined();
    const crossFill = await call("act_on_element", { tabId, target: uid(ax.snapshot, "Cross frame field"), action: "fill", value: "cross value" });
    expect(crossFill.error, JSON.stringify(crossFill)).toBeUndefined();
    expect(await page.locator("open-host").evaluate(host => host.shadowRoot.querySelector("input").value)).toBe("shadow value");
    expect(await page.frameLocator("#same").locator("#field").inputValue()).toBe("same value");
    expect(await page.frameLocator("#cross").locator("#field").inputValue()).toBe("cross value");
    const siblingFill = await call("act_on_element", { tabId, target: uid(ax.snapshot, "Sibling origin field"), action: "fill", value: "sibling value" });
    expect(siblingFill.error, JSON.stringify(siblingFill)).toBeUndefined();
    expect(await page.frameLocator("#sibling").locator("#field").inputValue()).toBe("sibling value");

    const closedChoice = await call("act_on_element", { tabId, target: uid(ax.snapshot, "Closed choice"), action: "select", value: "beta" });
    expect(closedChoice.error, JSON.stringify(closedChoice)).toBeUndefined();
    expect(closedChoice.method).toBe("backend-node");
    expect(closedChoice.selected).toBe("beta");
    expect(await page.evaluate(() => window.__closedChoice)).toBe("beta");
    const closedAgree = await call("act_on_element", { tabId, target: uid(ax.snapshot, "Closed agree"), action: "check" });
    expect(closedAgree.error, JSON.stringify(closedAgree)).toBeUndefined();
    expect(closedAgree.checked).toBe(true);
    expect(await page.evaluate(() => window.__closedChecked)).toBe(true);

    const clicksBeforePress = await page.frameLocator("#cross").locator("button").evaluate(button => button.ownerDocument.defaultView.__clickCount || 0);
    const submitted = await call("act_on_element", { tabId, target: uid(ax.snapshot, "Cross frame field"), action: "press", key: "Enter" });
    expect(submitted.error, JSON.stringify(submitted)).toBeUndefined();
    expect(submitted.method).toBe("backend-node");
    expect(submitted.clickDispatched).toBe(false);
    expect(await page.frameLocator("#cross").locator("button").evaluate(button => button.ownerDocument.defaultView.__submitted)).toBe("cross value");
    expect(await page.frameLocator("#cross").locator("button").evaluate(button => button.ownerDocument.defaultView.__clickCount || 0)).toBe(clicksBeforePress);
    const frameScroll = await call("act_on_element", { tabId, target: uid(ax.snapshot, "Cross frame field"), action: "scroll" });
    expect(frameScroll.code, JSON.stringify(frameScroll)).toBe("IFRAME_SCROLL_UNAVAILABLE");
    expect(frameScroll.scrolledTo).toBeUndefined();
    const badKey = await call("act_on_element", { tabId, target: uid(ax.snapshot, "Cross frame field"), action: "press", key: "Foo+A" });
    expect(badKey.code, JSON.stringify(badKey)).toBe("INVALID_ARGUMENTS");

    await page.locator("#cross").evaluate((frame, src) => { frame.src = src; }, `http://127.0.0.1:${PORT}/leave.html`);
    await page.frameLocator("#cross").locator("input").waitFor();
    const leaving = await call("get_ax_tree", { tabId });
    const left = await call("act_on_element", { tabId, target: uid(leaving.snapshot, "Leave field"), action: "press", key: "Enter" });
    expect(left.error, JSON.stringify(left)).toBeUndefined();
    expect(left.pressed).toBe(true);
    expect(left.code).toBeUndefined();
    await expect.poll(() => page.frames().some(frame => frame.url().includes("/landed.html"))).toBe(true);

    const sharedPress = await call("act_on_element", { tabId, target: uid(ax.snapshot, "Shared field two"), action: "press", key: "q" });
    expect(sharedPress.error, JSON.stringify(sharedPress)).toBeUndefined();
    expect(sharedPress.method).toBe("backend-node");
    expect(sharedPress.clickDispatched).toBe(false);
    expect(await page.evaluate(() => window.__dupClicks || 0)).toBe(0);
    expect(await page.evaluate(() => [...document.querySelectorAll("#shared-field")].map(field => field.value))).toEqual(["", "q"]);
    const sharedSelect = await call("act_on_element", { tabId, target: uid(ax.snapshot, "Shared choice two"), action: "select", value: "two" });
    expect(sharedSelect.error, JSON.stringify(sharedSelect)).toBeUndefined();
    expect(sharedSelect.method).toBe("backend-node");
    expect(sharedSelect.selected).toBe("two");
    expect(await page.evaluate(() => [...document.querySelectorAll("#shared-select")].map(field => field.value))).toEqual(["one", "two"]);

    const decoyPress = await call("act_on_element", { tabId, target: uid(ax.snapshot, "Decoy"), action: "press", key: "Enter" });
    expect(decoyPress.method, JSON.stringify(decoyPress)).toBe("cdp");
    expect(await page.evaluate(() => window.__clicks.at(-1))).toBe("decoy");

    const navigateCross = async (url, label) => {
      await page.locator("#cross").evaluate((frame, src) => { frame.src = src; }, url);
      await page.frameLocator("#cross").getByRole("button", { name: label }).waitFor();
      return call("get_ax_tree", { tabId });
    };
    const inProcess = await navigateCross(`http://localhost:${PORT}/moved.html`, "Moved frame action");
    expect(inProcess.snapshot).toContain("Moved frame action");
    const outOfProcess = await navigateCross(`http://127.0.0.1:${PORT}/returned.html`, "Returned frame action");
    expect(outOfProcess.snapshot).toContain("Returned frame action");
    expect(outOfProcess.frames.some(frame => frame.oopif === true)).toBe(true);
    const returned = await call("act_on_element", { tabId, target: uid(outOfProcess.snapshot, "Returned frame action"), action: "click" });
    expect(returned.error, JSON.stringify(returned)).toBeUndefined();
    expect(await page.frameLocator("#cross").locator("button").evaluate(button => button.ownerDocument.defaultView.__clicked)).toBe("Returned frame action");
  } finally {
    await fixture.close();
  }
});

// Three sites on one port: localhost is the page, 127.0.0.1 and 127.0.0.2 are separate processes.
const L = `http://localhost:${NESTED_PORT}`;
const A = `http://127.0.0.1:${NESTED_PORT}`;
const B = `http://127.0.0.2:${NESTED_PORT}`;
const LOG = "(window.__log = window.__log || [])";

function nestedFramePage(prefix, extra = "") {
  return `<!doctype html><body style="margin:8px">
    <button onclick="${LOG}.push('${prefix} send')">${prefix} send</button>
    <input aria-label="${prefix} message">${extra}</body>`;
}

function nestedPages() {
  const deepAgree = `<label style="display:block;margin-top:8px"><input type="checkbox" aria-label="Deep agree"
      onchange="${LOG}.push('deep agree ' + this.checked)" style="position:absolute;opacity:0;width:1px;height:1px;margin:0">
    <span>I accept the <a href="#terms" onclick="${LOG}.push('deep terms')">terms</a> here</span></label>`;
  return {
    "/": `<!doctype html><title>nested frames</title><body style="margin:8px">
      <button onclick="__log.push('top send')">Send</button>
      <input aria-label="Message">
      <qz-controls></qz-controls>
      <div><iframe id="outer" title="Outer frame" src="${A}/outer.html" width="520" height="260"></iframe></div>
      <div><iframe id="same-outer" title="Same outer frame" src="${L}/same-outer.html" width="460" height="150"></iframe></div>
      <div style="position:relative;width:420px;height:80px"><iframe id="covered" src="${B}/covered.html" width="420" height="80"></iframe>
        <div id="shield" onclick="__log.push('shield')" style="position:absolute;inset:0"></div></div>
      <div style="height:1500px"></div>
      <button id="bottom" onclick="__log.push('bottom')">Bottom action</button>
      <qz-bottom></qz-bottom>
      <script>
        window.__log = [];
        customElements.define("qz-bottom", class extends HTMLElement { connectedCallback() {
          const root = this.attachShadow({ mode: "open" });
          root.innerHTML = '<button>Bottom shadow action</button>';
          root.querySelector("button").onclick = () => __log.push("bottom shadow");
        } });
        customElements.define("qz-controls", class extends HTMLElement { connectedCallback() {
          const root = this.attachShadow({ mode: "closed" });
          window.__qz = root;
          root.innerHTML = \`
            <input aria-label="Guarded field"><input aria-label="Thief field">
            <input aria-label="Readonly field" readonly value="keep">
            <input aria-label="Disabled field" disabled value="keep">
            <fieldset disabled><input aria-label="Fieldset field" value="keep"></fieldset>
            <label><input type="checkbox" aria-label="Vetoed agree"> Vetoed</label>
            <input type="checkbox" aria-label="Trusted agree">
            <label id="styled"><input type="checkbox" aria-label="Styled agree" style="position:absolute;opacity:0;width:1px;height:1px;margin:0">
              <span>I accept the <a href="#terms">terms</a> today</span></label>
            <div id="wrap" style="width:200px;font:16px/20px monospace">xxxxxxxxxxxxxx <a id="wrapped" href="${L}/landed.html">go here</a> yyyyyyyyyyyyy</div>
            <a id="blocked" href="http://blocked.test/page">Blocked link</a>\`;
          const field = label => root.querySelector(\`[aria-label="\${label}"]\`);
          field("Guarded field").addEventListener("focus", () => field("Thief field").focus());
          field("Vetoed agree").addEventListener("click", event => event.preventDefault());
          field("Trusted agree").addEventListener("click", event => __log.push("trusted " + event.isTrusted));
          root.querySelector("#styled a").addEventListener("click", () => __log.push("terms"));
          root.querySelector("#wrapped").addEventListener("click", () => __log.push("wrapped"));
          root.querySelector("#blocked").addEventListener("click", () => __log.push("blocked"));
        } });
      </script></body>`,
    "/outer.html": nestedFramePage("Outer", `
      <div><iframe id="inner" title="Inner frame" src="${A}/inner.html" width="320" height="70"></iframe></div>
      <div style="height:420px"></div>
      <div><iframe id="deep" title="Deep frame" src="${B}/deep.html" width="340" height="120"></iframe></div>`)
      .replace(">Outer send<", ">Send<").replace('aria-label="Outer message"', 'aria-label="Message"'),
    "/inner.html": nestedFramePage("Inner"),
    "/inner2.html": nestedFramePage("Inner"),
    "/deep.html": nestedFramePage("Deep", deepAgree),
    "/deep2.html": nestedFramePage("Deep", deepAgree),
    "/same-outer.html": nestedFramePage("Same outer", `<div><iframe id="same-leaf" src="${L}/same-leaf.html" width="400" height="70"></iframe></div>`),
    "/same-leaf.html": nestedFramePage("Same leaf"),
    "/covered.html": nestedFramePage("Covered"),
    "/landed.html": `<!doctype html><title>landed</title><p>Landed</p>`,
  };
}

test("nested frames keep their own targets, document identity, and native action semantics", async () => {
  test.setTimeout(180_000);
  const fixture = await launchFixture([NESTED_PORT], nestedPages(), `${L}/`);
  try {
    const { call, page, tabId, worker } = fixture;
    const frame = path => page.frames().find(item => item.url().endsWith(path));
    const frameLog = path => frame(path).evaluate(() => window.__log || []);
    const fieldValue = (path, label) => frame(path).locator(`[aria-label="${label}"]`).inputValue();
    const shadowValue = label => page.evaluate(name => window.__qz.querySelector(`[aria-label="${name}"]`).value, label);
    await expect.poll(() => ["/deep.html", "/inner.html", "/same-leaf.html", "/covered.html"].every(path => frame(path))).toBe(true);
    for (const path of ["/deep.html", "/inner.html", "/same-leaf.html", "/covered.html"]) await frame(path).locator("button").waitFor();

    const ax = await call("get_ax_tree", { tabId, limit: 300 });
    expect(ax.error, JSON.stringify(ax)).toBeUndefined();
    for (const label of ["Deep send", "Deep message", "Inner send", "Same leaf send", "Covered send", "Deep agree"]) {
      expect(ax.snapshot, label).toContain(`"${label}"`);
    }
    const outerFrame = ax.frames.find(item => item.url?.endsWith("/outer.html"));
    const deepFrame = ax.frames.find(item => item.url?.endsWith("/deep.html"));
    const innerFrame = ax.frames.find(item => item.url?.endsWith("/inner.html"));
    expect(deepFrame?.parentFrameId, JSON.stringify(ax.frames)).toBe(outerFrame?.frameId);
    expect(innerFrame?.parentFrameId).toBe(outerFrame?.frameId);
    expect(deepFrame.oopif && innerFrame.oopif).toBe(true);
    const act = (snapshot, label, action, extra = {}, runId) => call("act_on_element", { tabId, target: uidFor(snapshot, label), action, ...extra }, runId);
    const ok = result => expect(result.error, JSON.stringify(result)).toBeUndefined();

    // Consecutive fills and clicks through a cross-process frame inside a cross-process frame, a same-process
    // child of a cross-process frame, and same-origin frames nested in the page process.
    ok(await act(ax.snapshot, "Deep message", "fill", { value: "deep 1" }));
    ok(await act(ax.snapshot, "Deep send", "click"));
    ok(await act(ax.snapshot, "Inner message", "fill", { value: "inner 1" }));
    ok(await act(ax.snapshot, "Inner send", "click"));
    ok(await act(ax.snapshot, "Same leaf message", "fill", { value: "leaf 1" }));
    ok(await act(ax.snapshot, "Same leaf send", "click"));
    ok(await call("act_on_element", { tabId, target: "css:#bottom", action: "click" }));
    // Hit testing below the fold must account for the scrolled document.
    ok(await act(ax.snapshot, "Bottom shadow action", "click"));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    ok(await act(ax.snapshot, "Deep message", "fill", { value: "deep 2" }));
    ok(await act(ax.snapshot, "Deep send", "click"));
    expect(await fieldValue("/deep.html", "Deep message")).toBe("deep 2");
    expect(await fieldValue("/inner.html", "Inner message")).toBe("inner 1");
    expect(await fieldValue("/same-leaf.html", "Same leaf message")).toBe("leaf 1");
    expect(await frameLog("/deep.html")).toEqual(["Deep send", "Deep send"]);
    expect(await frameLog("/inner.html")).toEqual(["Inner send"]);
    expect(await frameLog("/same-leaf.html")).toEqual(["Same leaf send"]);

    // A frame subtree lists only its own controls, and its same-named button stays the frame's button.
    const outer = await call("get_ax_tree", { tabId, root: uidFor(ax.snapshot, "Outer frame"), limit: 300 });
    expect(outer.error, JSON.stringify(outer)).toBeUndefined();
    expect(outer.actions).toEqual([]);
    expect(outer.headings).toEqual([]);
    expect(outer.snapshot).toContain('"Deep send"');
    expect(outer.snapshot).not.toContain("Bottom action");
    expect(outer.snapshot).not.toContain("Guarded field");
    ok(await act(outer.snapshot, "Send", "click"));
    ok(await act(outer.snapshot, "Message", "fill", { value: "outer value" }));
    expect(await frameLog("/outer.html")).toEqual(["Outer send"]);
    expect(await fieldValue("/outer.html", "Message")).toBe("outer value");
    expect(await page.evaluate(() => window.__log)).toEqual(["bottom", "bottom shadow"]);
    expect(await page.locator('input[aria-label="Message"]').inputValue()).toBe("");

    const covered = await act(ax.snapshot, "Covered send", "click");
    expect(covered.code, JSON.stringify(covered)).toBe("ELEMENT_OBSCURED");
    expect(await frameLog("/covered.html")).toEqual([]);
    expect(await page.evaluate(() => window.__log)).toEqual(["bottom", "bottom shadow"]);

    const inspectedFrame = await call("inspect_element", { tabId, target: uidFor(ax.snapshot, "Deep message") });
    expect(inspectedFrame.error, JSON.stringify(inspectedFrame)).toBeUndefined();
    expect(inspectedFrame).toMatchObject({ tag: "input", value: "deep 2", name: "Deep message", frameId: deepFrame.frameId, oopif: true, method: "backend-node" });
    expect(inspectedFrame.clickablePoint).toBeTruthy();
    const inspectedShadow = await call("inspect_element", { tabId, target: uidFor(ax.snapshot, "Readonly field") });
    expect(inspectedShadow.error, JSON.stringify(inspectedShadow)).toBeUndefined();
    expect(inspectedShadow).toMatchObject({ tag: "input", readonly: true, value: "keep", inShadowRoot: true, shadowMode: "closed" });

    // Fill types only into a verified target.
    const stolen = await act(ax.snapshot, "Guarded field", "fill", { value: "secret" });
    expect(stolen.code, JSON.stringify(stolen)).toBe("ELEMENT_FOCUS_FAILED");
    expect([await shadowValue("Guarded field"), await shadowValue("Thief field")]).toEqual(["", ""]);
    for (const [label, code] of [["Readonly field", "ELEMENT_READONLY"], ["Disabled field", "ELEMENT_DISABLED"], ["Fieldset field", "ELEMENT_DISABLED"]]) {
      const refused = await act(ax.snapshot, label, "fill", { value: "changed" });
      expect(refused.code, `${label}: ${JSON.stringify(refused)}`).toBe(code);
      expect(await shadowValue(label)).toBe("keep");
    }

    // Check uses a trusted click, honors preventDefault(), and reaches a hidden input through its label.
    const vetoed = await act(ax.snapshot, "Vetoed agree", "check");
    expect(vetoed.code, JSON.stringify(vetoed)).toBe("ELEMENT_CHECK_STATE_MISMATCH");
    expect(await page.evaluate(() => window.__qz.querySelector('[aria-label="Vetoed agree"]').checked)).toBe(false);
    const trusted = await act(ax.snapshot, "Trusted agree", "check");
    ok(trusted);
    expect(trusted.checked).toBe(true);
    const styled = await act(ax.snapshot, "Styled agree", "check");
    ok(styled);
    expect(styled.clickedLabel).toBe(true);
    expect(await page.evaluate(() => window.__qz.querySelector('[aria-label="Styled agree"]').checked)).toBe(true);
    const deepAgree = await act(ax.snapshot, "Deep agree", "check");
    ok(deepAgree);
    expect(deepAgree.clickedLabel).toBe(true);
    expect(await frameLog("/deep.html")).toEqual(["Deep send", "Deep send", "deep agree true"]);
    expect(await page.evaluate(() => window.__log)).toEqual(["bottom", "bottom shadow", "trusted true"]);

    // A later run reattaches the debugger and rebuilds frame sessions for a still-valid uid.
    await worker.evaluate(() => snapshotFixtures.releaseRunCdp("fixture", "fixture-run"));
    ok(await act(ax.snapshot, "Deep message", "fill", { value: "after release" }, "fixture-run-2"));
    ok(await act(ax.snapshot, "Inner send", "click", {}, "fixture-run-2"));
    expect(await fieldValue("/deep.html", "Deep message")).toBe("after release");
    expect(await frameLog("/inner.html")).toEqual(["Inner send", "Inner send"]);

    // A navigated frame invalidates its old uids instead of acting on the new document.
    await frame("/outer.html").locator("#deep").evaluate((element, src) => { element.src = src; }, `${B}/deep2.html`);
    await frame("/outer.html").locator("#inner").evaluate((element, src) => { element.src = src; }, `${A}/inner2.html`);
    await expect.poll(() => !!frame("/deep2.html") && !!frame("/inner2.html")).toBe(true);
    await frame("/deep2.html").locator("button").waitFor();
    await frame("/inner2.html").locator("button").waitFor();
    for (const [label, action] of [["Deep message", "fill"], ["Deep send", "click"], ["Inner message", "fill"], ["Deep agree", "check"]]) {
      const stale = await act(ax.snapshot, label, action, { value: "stale" }, "fixture-run-2");
      expect(stale.code, `${label}: ${JSON.stringify(stale)}`).toMatch(/^STALE_ELEMENT_UID/);
    }
    expect(await fieldValue("/deep2.html", "Deep message")).toBe("");
    expect(await fieldValue("/inner2.html", "Inner message")).toBe("");
    expect(await frameLog("/deep2.html")).toEqual([]);
    const fresh = await call("get_ax_tree", { tabId, limit: 300 }, "fixture-run-2");
    ok(await act(fresh.snapshot, "Deep message", "fill", { value: "fresh" }, "fixture-run-2"));
    expect(await fieldValue("/deep2.html", "Deep message")).toBe("fresh");

    // Remote clicks keep link policy: blocked links are refused before input, allowed links report navigation.
    await worker.evaluate(() => chrome.storage.local.set({ securityGuardrails: { blockedDomains: ["blocked.test"] } }));
    const blocked = await act(fresh.snapshot, "Blocked link", "click", {}, "fixture-run-2");
    expect(blocked.code, JSON.stringify(blocked)).toBe("SECURITY_GUARDRAIL_BLOCKED");
    await worker.evaluate(() => chrome.storage.local.set({ securityGuardrails: {} }));
    expect(await page.evaluate(() => window.__log.includes("blocked"))).toBe(false);
    // The wrapped link's bounding-box center sits on surrounding text; its first line box does not.
    const centerHit = await page.evaluate(() => {
      const link = window.__qz.querySelector("#wrapped");
      const rects = link.getClientRects();
      const box = link.getBoundingClientRect();
      link.scrollIntoView({ block: "center" });
      const moved = link.getBoundingClientRect();
      const hit = window.__qz.elementFromPoint(moved.left + moved.width / 2, moved.top + moved.height / 2);
      return { lines: rects.length, boxWidth: box.width, centerOnLink: hit === link || link.contains(hit) };
    });
    expect(centerHit.lines).toBe(2);
    expect(centerHit.centerOnLink).toBe(false);
    const wrapped = await act(fresh.snapshot, "go here", "click", {}, "fixture-run-2");
    expect(wrapped.error, JSON.stringify(wrapped)).toBeUndefined();
    expect(wrapped.href).toBe(`${L}/landed.html`);
    expect(wrapped.navigated).toBe(true);
    await expect.poll(() => page.url()).toBe(`${L}/landed.html`);
  } finally {
    await fixture.close();
  }
});
