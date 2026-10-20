import http from "node:http";
import { chromium } from "playwright";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./fixtures.mjs";
import { ensureTestExtension } from "../support/extension-build.mjs";

const PORT = 8133;

function pageHtml() {
  return `<!doctype html><title>snapshot fixtures</title>
    <button id="decoy" onclick="window.__clicks.push('decoy')">Decoy</button>
    <open-host></open-host>
    <closed-host></closed-host>
    <iframe id="same" src="http://localhost:${PORT}/same.html" width="420" height="70"></iframe>
    <iframe id="cross" src="http://127.0.0.1:${PORT}/cross.html" width="420" height="70"></iframe>
    <div style="height:2200px"></div>
    <button id="below" onclick="window.__clicks.push('below')">Below fold</button>
    <script>
      window.__clicks = [];
      customElements.define("open-host", class extends HTMLElement { connectedCallback() {
        const root = this.attachShadow({ mode: "open" });
        root.innerHTML = '<input aria-label="Shadow field"><button>Open shadow action</button>';
        root.querySelector("button").onclick = () => window.__clicks.push("open");
      } });
      customElements.define("closed-host", class extends HTMLElement { connectedCallback() {
        const root = this.attachShadow({ mode: "closed" });
        root.innerHTML = '<button>Closed shadow action</button>';
        root.querySelector("button").onclick = () => window.__clicks.push("closed");
      } });
    </script>`;
}

function frameHtml(label, field) {
  return `<!doctype html><button onclick="window.__clicked='${label}'">${label}</button><input id="field" aria-label="${field}">`;
}

test("viewport snapshots recover offscreen content and act inside shadow and frames", async () => {
  test.setTimeout(120_000);
  const pages = {
    "/": pageHtml(),
    "/same.html": frameHtml("Same frame action", "Same frame field"),
    "/cross.html": frameHtml("Cross frame action", "Cross frame field"),
    "/moved.html": frameHtml("Moved frame action", "Moved frame field"),
    "/returned.html": frameHtml("Returned frame action", "Returned frame field"),
  };
  const server = http.createServer((request, response) => {
    const body = pages[new URL(request.url, "http://localhost").pathname];
    response.writeHead(body ? 200 : 404, { "content-type": "text/html" });
    response.end(body || "");
  });
  await new Promise(resolve => server.listen(PORT, resolve));
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

    const ax = await call("get_ax_tree", { tabId });
    expect(ax.error, JSON.stringify(ax)).toBeUndefined();
    expect(ax.snapshot, JSON.stringify(ax)).toContain("Shadow field");
    expect(ax.snapshot).toContain("Open shadow action");
    expect(ax.snapshot).toContain("Closed shadow action");
    expect(ax.snapshot).toContain("Same frame action");
    expect(ax.snapshot).toContain("Cross frame action");
    expect(ax.snapshot).not.toContain("Below fold");
    expect(ax.offscreenBelow).toBeGreaterThan(0);
    expect(ax.frames.length).toBeGreaterThan(0);
    expect(ax.frames.some(frame => frame.oopif === true)).toBe(true);

    const full = await call("get_ax_tree", { tabId, scope: "page", limit: 300 });
    expect(full.snapshot).toContain("Below fold");
    expect(full.snapshot).toContain("Cross frame action");
    expect(full.frames.some(frame => frame.oopif === true)).toBe(true);

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
    expect(await page.evaluate(() => window.__clicks)).toEqual(["closed", "open"]);
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
  }
});
