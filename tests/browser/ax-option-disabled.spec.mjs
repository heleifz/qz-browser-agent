import { chromium } from "playwright";
import { createServer } from "node:http";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures.mjs";
import { ensureTestExtension } from "../support/extension-build.mjs";

const html = await readFile(fileURLToPath(new URL("../fixtures/ax-option-disabled.html", import.meta.url)), "utf8");

async function createHarness() {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const directory = await mkdtemp(join(tmpdir(), "qingzhou-ax-disabled-"));
  let browser;
  const close = async () => {
    await browser?.close();
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  };
  try {
    const extension = join(directory, "extension");
    await cp(await ensureTestExtension(), extension, { recursive: true });
    const manifestPath = join(extension, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    await writeFile(join(extension, "element-test-worker.js"), `import "./${manifest.background.service_worker}";
      import * as tools from "./background/tools/runtime.js"; globalThis.elementTestTools = tools;`);
    manifest.background.service_worker = "element-test-worker.js";
    await writeFile(manifestPath, JSON.stringify(manifest));
    browser = await chromium.launchPersistentContext(join(directory, "profile"), {
      headless: true, executablePath: chromium.executablePath(), ignoreDefaultArgs: ["--disable-extensions", "--hide-scrollbars"],
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--no-proxy-server",
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"],
    });
    const worker = browser.serviceWorkers()[0] || await browser.waitForEvent("serviceworker");
    await worker.evaluate(() => {
      let tabId;
      const context = { sessionId: "ax-disabled", runId: "run", runProfile: { platform: { os: "linux" } } };
      const runtime = elementTestTools.createToolRuntime({
        windowTarget: { resolveForNewTab: async () => (await chrome.windows.getAll())[0].id },
        sessions: {
          isRunCurrent: () => true,
          resolveTargetTab: async input => input.tabId === tabId
            ? { ok: true, tabId, tab: await chrome.tabs.get(tabId), ownedByCurrentTask: true }
            : { ok: false, code: "SESSION_TAB_FOREIGN" },
          updateWorkingTab: async ({ tab }) => { tabId = tab.id; },
          listOwnedTabIds: () => tabId ? [tabId] : [],
        },
      });
      globalThis.elementHarness = {
        async call(name, args) {
          try { return await runtime.execute(name, { tabId, ...args }, undefined, { ...context, workingTabId: tabId, source: "run_script" }); }
          catch (error) { return { error: error.message, code: error.code, details: error.details }; }
        },
        async pageState() {
          return (await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: () => {
            const options = selector => [...document.querySelectorAll(selector)].map(option => ({
              text: option.text,
              disabled: !!option.disabled,
              matches: option.matches(":disabled"),
            }));
            const control = selector => {
              const element = document.querySelector(selector);
              return element ? { disabled: "disabled" in element ? !!element.disabled : null, matches: element.matches(":disabled") } : null;
            };
            return {
              ready: document.readyState,
              city: control("#city"),
              province: control("#province"),
              route: control("#route"),
              cityOptions: options("#city option"),
              provinceOptions: options("#province option"),
              routeOptions: options("#route option"),
              lockedOptions: options("#locked option"),
              groupedOptions: options("#grouped option"),
              mixedOptions: options("#mixed option"),
              legend: control("#legend"),
              submit: control("#submit"),
              extra: control("#extra"),
              note: control("#note"),
            };
          } }))[0].result;
        },
      };
    });
    const call = (name, args) => worker.evaluate(({ name, args }) => elementHarness.call(name, args), { name, args });
    const state = () => worker.evaluate(() => elementHarness.pageState());
    const opened = await call("open_tab", { url: `http://127.0.0.1:${server.address().port}/` });
    expect(opened, JSON.stringify(opened)).not.toHaveProperty("error");
    await expect.poll(async () => { try { return (await state()).ready; } catch { return "loading"; } }).toBe("complete");
    return { call, state, close };
  } catch (error) {
    await close();
    throw error;
  }
}

function roleLine(snapshot, role, name) {
  return String(snapshot || "").split("\n").find(line => new RegExp(`\\b${role}\\b`).test(line) && line.includes(`"${name}"`)) || "";
}

function expectDisabled(snapshot, role, name, disabled) {
  const line = roleLine(snapshot, role, name);
  expect(line, snapshot).not.toBe("");
  if (disabled) expect(line, snapshot).toMatch(/\bdisabled\b/);
  else expect(line, snapshot).not.toMatch(/\bdisabled\b/);
}

test.describe("accessibility option disabled state", () => {
  test.describe.configure({ mode: "serial", timeout: 180000 });
  let h;
  test.beforeAll(async () => { h = await createHarness(); });
  test.afterAll(async () => { await h?.close(); });

  test("drops stale disabled after options are replaced and the select is enabled", async () => {
    const before = await h.call("get_ax_tree", { limit: 300 });
    expect(before.code, before.snapshot || JSON.stringify(before)).toBeUndefined();
    const dom = await h.state();
    expect(dom.city.matches).toBe(true);
    expect(dom.cityOptions.map(option => option.text)).toEqual(["请选择"]);
    expect(dom.groupedOptions.find(option => option.text === "甲").matches).toBe(true);
    expect(dom.groupedOptions.find(option => option.text === "甲").disabled).toBe(false);
    expect(dom.submit.disabled).toBe(false);
    expect(dom.submit.matches).toBe(true);
    expect(dom.legend.matches).toBe(false);
    expect(dom.extra.matches).toBe(true);
    expect(dom.note.matches).toBe(true);

    expectDisabled(before.snapshot, "option", "请选择", true);
    expectDisabled(before.snapshot, "option", "浙江", true);
    expectDisabled(before.snapshot, "option", "江苏", true);
    expectDisabled(before.snapshot, "option", "庚", false);
    expectDisabled(before.snapshot, "option", "辛", false);
    expectDisabled(before.snapshot, "option", "丙", true);
    expectDisabled(before.snapshot, "option", "丁", true);
    expectDisabled(before.snapshot, "option", "甲", true);
    expectDisabled(before.snapshot, "option", "乙", false);
    expectDisabled(before.snapshot, "option", "戊", false);
    expectDisabled(before.snapshot, "option", "己", true);
    expectDisabled(before.snapshot, "combobox", "锁定", true);
    expectDisabled(before.snapshot, "combobox", "分组", false);
    expectDisabled(before.snapshot, "button", "说明", false);
    expectDisabled(before.snapshot, "button", "提交", true);
    expectDisabled(before.snapshot, "button", "补充", true);
    expectDisabled(before.snapshot, "textbox", "备注", true);

    const load = roleLine(before.snapshot, "button", "加载城市").match(/target=(uid:\S+)/)?.[1] || "";
    expect(load, before.snapshot).toMatch(/^uid:/);
    const clicked = await h.call("act_on_element", { target: load, action: "click" });
    expect(clicked, JSON.stringify(clicked)).not.toHaveProperty("code");
    await expect.poll(async () => {
      const current = await h.state();
      return [
        current.city.matches,
        current.cityOptions.map(option => option.text).join(","),
        current.province.matches,
        current.route.matches,
        current.routeOptions.every(option => option.matches),
      ].join("|");
    }).toBe("false|杭州,宁波,温州|false|true|true");
    await new Promise(resolve => setTimeout(resolve, 2000));

    const after = await h.call("get_ax_tree", { limit: 300 });
    expect(after.code, after.snapshot || JSON.stringify(after)).toBeUndefined();
    expect(after.snapshot, after.snapshot).not.toContain("请选择");
    // Replaced options are new elements. The province options are the same
    // elements Chrome's AX cache leaves disabled, and the route options are the
    // ones it leaves enabled after the select becomes disabled.
    expectDisabled(after.snapshot, "option", "杭州", false);
    expectDisabled(after.snapshot, "option", "宁波", false);
    expectDisabled(after.snapshot, "option", "温州", false);
    expectDisabled(after.snapshot, "option", "浙江", false);
    expectDisabled(after.snapshot, "option", "江苏", false);
    expectDisabled(after.snapshot, "option", "庚", true);
    expectDisabled(after.snapshot, "option", "辛", true);
    expectDisabled(after.snapshot, "combobox", "城市", false);
    expectDisabled(after.snapshot, "combobox", "省份", false);
    expectDisabled(after.snapshot, "combobox", "航线", true);
    expectDisabled(after.snapshot, "option", "丙", true);
    expectDisabled(after.snapshot, "option", "丁", true);
    expectDisabled(after.snapshot, "option", "甲", true);
    expectDisabled(after.snapshot, "option", "乙", false);
    expectDisabled(after.snapshot, "option", "戊", false);
    expectDisabled(after.snapshot, "option", "己", true);
    expectDisabled(after.snapshot, "combobox", "锁定", true);
    expectDisabled(after.snapshot, "button", "说明", false);
    expectDisabled(after.snapshot, "button", "提交", true);
    expectDisabled(after.snapshot, "button", "补充", true);
    expectDisabled(after.snapshot, "textbox", "备注", true);
  });
});
