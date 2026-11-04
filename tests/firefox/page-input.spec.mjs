import { createServer } from "node:http";
import { expect, test } from "./fixture.mjs";

const PAGE = `<!doctype html>
<meta charset="utf-8">
<title>Input fixture</title>
<button id="go" type="button" aria-label="Add">Add</button>
<input id="name" type="text" aria-label="Name">
<input id="box" type="checkbox" aria-label="Agree">
<div style="position:relative;width:180px;height:40px">
  <input id="overlay-check" type="checkbox" style="position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;z-index:2">
  <label id="overlay-label" for="overlay-check" style="position:absolute;inset:0;display:block;width:100%;height:100%">Transparent checkbox</label>
</div>
<input id="disabled-check" type="checkbox" disabled style="display:none"><label for="disabled-check">Disabled checkbox</label>
<input id="link-check" type="checkbox" style="display:none"><label for="link-check" style="display:block;width:180px;height:40px"><a id="label-link" href="#unexpected" style="display:block;width:100%;height:100%">Independent link</a></label>
<input id="button-check" type="checkbox" style="display:none"><label for="button-check" style="display:block;width:180px;height:40px"><button id="label-button" type="button" style="width:100%;height:100%">Independent button</button></label>
<input id="keys" type="text" aria-label="Keys">
<script>
  window.clicks = 0;
  window.checks = 0;
  window.keys = 0;
  window.overlayEvents = [];
  for (const type of ['click', 'input', 'change']) document.addEventListener(type, event => {
    overlayEvents.push({type, id:event.target.id, trusted:event.isTrusted});
  }, true);
  document.querySelector("#go").addEventListener("click", () => { window.clicks += 1; });
  document.querySelector("#box").addEventListener("click", () => { window.checks += 1; });
  document.querySelector("#keys").addEventListener("keydown", event => {
    if (event.key === "a") window.keys += 1;
  });
</script>`;

test("uid and css input succeed once on a page without a content CSP", async ({ firefoxSidebar }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(PAGE);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  const url = `http://127.0.0.1:${port}/input`;
  const page = firefoxSidebar.page;
  try {
    await page.goto(url, { waitUntil: "load" });
    await page.locator("#go").waitFor();
    const tabId = await firefoxSidebar.extension("background", `
      const tabs = await view.chrome.tabs.query({});
      const match = tabs.find(tab => String(tab.url || "").indexOf(${JSON.stringify(`127.0.0.1:${port}`)}) !== -1);
      return match ? match.id : 0;
    `);
    expect(tabId).toBeGreaterThan(0);

    const tree = await callTool(firefoxSidebar, "get_ax_tree", { tabRef: tabId });
    expect(tree.thrown, JSON.stringify(tree)).toBeUndefined();
    const button = targetFor(tree.snapshot, "Add");
    const field = targetFor(tree.snapshot, "Name");
    expect(button, tree.snapshot).toMatch(/^uid:/);
    expect(field, tree.snapshot).toMatch(/^uid:/);

    const clicked = await callTool(firefoxSidebar, "act_on_element", { tabRef: tabId, target: button, action: "click" });
    expect(clicked).toEqual({});
    expect(await page.evaluate(() => window.clicks)).toBe(1);
    const receipt = await firefoxSidebar.extension("background", `
      const [frame] = await view.chrome.scripting.executeScript({
        target: { tabId: ${Number(tabId)} },
        world: "ISOLATED",
        func: () => ({
          bound: document.__qzInputReceiptsV4Bound === true,
          marked: globalThis.__qzExtensionInputEvents instanceof WeakSet,
        }),
      });
      return frame && frame.result;
    `);
    expect(receipt).toEqual({ bound: true, marked: true });

    const filled = await callTool(firefoxSidebar, "act_on_element", { tabRef: tabId, target: field, action: "fill", value: "hello" });
    expect(filled).toEqual({});
    expect(await page.evaluate(() => document.querySelector("#name").value)).toBe("hello");

    const cssClick = await callTool(firefoxSidebar, "act_on_element", { tabRef: tabId, target: "css:#go", action: "click" });
    expect(cssClick).toEqual({});
    expect(await page.evaluate(() => window.clicks)).toBe(2);

    const pressed = await callTool(firefoxSidebar, "act_on_element", { tabRef: tabId, target: "css:#keys", action: "press", key: "a" });
    expect(pressed).toEqual({});
    expect(await page.evaluate(() => window.keys)).toBe(1);

    const checked = await callTool(firefoxSidebar, "act_on_element", { tabRef: tabId, target: "css:#box", action: "check" });
    expect(checked).toEqual({});
    expect(await page.evaluate(() => ({
      checks: window.checks,
      checked: document.querySelector("#box").checked,
    }))).toEqual({ checks: 1, checked: true });

    expect(await page.locator('#overlay-label').evaluate(label => {
      label.scrollIntoView({ block: 'center' });
      const rect = label.getBoundingClientRect(), box = label.control.getBoundingClientRect();
      return { hit: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.id,
        opacity: getComputedStyle(label.control).opacity,
        sameBox: rect.x === box.x && rect.y === box.y && rect.width === box.width && rect.height === box.height };
    })).toEqual({ hit: 'overlay-check', opacity: '0', sameBox: true });
    await firefoxSidebar.extension("background", `
      await view.chrome.scripting.executeScript({
        target: { tabId: ${Number(tabId)} }, world: "ISOLATED",
        func: () => {
          globalThis.overlayInputMarks = [];
          addEventListener("click", event => {
            if (event.target.id === "overlay-check") overlayInputMarks.push(
              globalThis.__qzExtensionInputEvents?.has(event) === true);
          }, true);
        },
      });
    `);
    for (const [action, checked, count] of [['check', true, 1], ['check', true, 1], ['uncheck', false, 2], ['uncheck', false, 2]]) {
      expect(await callTool(firefoxSidebar, 'act_on_element', { tabRef: tabId, target: 'css:#overlay-check', action })).toEqual({});
      expect(await page.locator('#overlay-check').isChecked()).toBe(checked);
      const events = await page.evaluate(() => overlayEvents.filter(event => event.id === 'overlay-check'));
      for (const type of ['click', 'input', 'change']) {
        expect(events.filter(event => event.type === type)).toHaveLength(count);
        // Firefox dispatches extension-marked clicks; native activation emits input/change.
        if (type !== 'click') expect(events.filter(event => event.type === type).every(event => event.trusted)).toBe(true);
      }
      const marks = await firefoxSidebar.extension("background", `
        const [frame] = await view.chrome.scripting.executeScript({
          target: { tabId: ${Number(tabId)} }, world: "ISOLATED", func: () => overlayInputMarks,
        });
        return frame.result;
      `);
      expect(marks).toEqual(Array(count).fill(true));
    }
    const safeUrl = page.url();
    for (const id of ['disabled-check', 'link-check', 'button-check']) {
      expect(await callTool(firefoxSidebar, 'act_on_element', { tabRef: tabId, target: `css:#${id}`, action: 'check' })).toHaveProperty('message');
      await expect(page.locator(`#${id}`)).not.toBeChecked();
      expect(page.url()).toBe(safeUrl);
    }
    expect(await page.evaluate(() => overlayEvents.filter(event => ['label-link', 'label-button'].includes(event.id) && event.type === 'click'))).toEqual([]);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

function targetFor(snapshot, label) {
  const line = String(snapshot || "").split("\n").find(item => item.includes(`"${label}"`) && item.includes("target=uid:"));
  const match = /target=(uid:\S+)/.exec(line || "");
  return match ? match[1] : "";
}

function callTool(session, name, args) {
  return session.extension("background", `
    const request = ${JSON.stringify({ name, args })};
    const tools = view.__qzFirefoxPageTools;
    if (!tools || typeof tools.execute !== "function") throw new Error("Firefox page tool harness is missing");
    const context = Cu.cloneInto({
      sessionId: "firefox-page-input",
      runId: "run",
      source: "agent",
    }, content);
    const toolArgs = Cu.cloneInto(request.args, content);
    try {
      const result = await tools.execute(request.name, toolArgs, undefined, context);
      return JSON.parse(JSON.stringify(result));
    } catch (error) {
      const code = error && error.code ? String(error.code) : "";
      const message = error && error.message ? String(error.message) : String(error);
      return { thrown: code ? code + ": " + message : message };
    }
  `);
}
