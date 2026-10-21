import http from "node:http";
import { chromium } from "playwright";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./fixtures.mjs";
import { ensureTestExtension } from "../support/extension-build.mjs";

const PORT = 8133;
const SIBLING_PORT = 8134;

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
  const server = http.createServer((request, response) => {
    const body = pages[new URL(request.url, "http://localhost").pathname];
    response.writeHead(body ? 200 : 404, { "content-type": "text/html" });
    response.end(body || "");
  });
  // Another port is a cross-origin frame that still shares the page's site and process.
  const siblingServer = http.createServer(server.listeners("request")[0]);
  await new Promise(resolve => server.listen(PORT, resolve));
  await new Promise(resolve => siblingServer.listen(SIBLING_PORT, resolve));
  const directory = await mkdtemp(join(tmpdir(), "qz-snapshot-fixtures-"));
  let browser;
  try {
    const extension = join(directory, "extension");
    await cp(await ensureTestExtension(), extension, { recursive: true });
    const manifestPath = join(extension, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    await writeFile(join(extension, "snapshot-fixture-worker.js"), `import "./${manifest.background.service_worker}";
      import { createToolRuntime } from "./background/tools/runtime.js";
      import { createSessionTabs } from "./background/session/tabs.js";
      globalThis.snapshotFixtures = { createToolRuntime, createSessionTabs };`);
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
      globalThis.fixtureCall = async (name, args) => {
        try {
          return await runtime.execute(name, args, new AbortController().signal, {
            ...supervisor.getRuntime("fixture"), sessionId: "fixture", runId: "fixture-run", language: "en",
          });
        } catch (error) {
          return { code: error.code, error: error.message, details: error.details };
        }
      };
    });
    const call = (name, args) => worker.evaluate(({ name, args }) => fixtureCall(name, args), { name, args });
    const opened = await call("open_tab", { url: `http://localhost:${PORT}/` });
    expect(opened.error, JSON.stringify(opened)).toBeUndefined();
    const tabId = opened.id;
    await worker.evaluate(async (id) => { await chrome.tabs.update(id, { active: true }); }, tabId);
    const page = browser.pages().find(item => item.url().startsWith(`http://localhost:${PORT}/`))
      || await browser.waitForEvent("page");
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
    await browser?.close();
    await rm(directory, { recursive: true, force: true });
    server.close();
    siblingServer.close();
  }
});
