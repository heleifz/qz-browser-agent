import { createServer } from "node:http";
import { textPdf } from "../support/text-pdf.mjs";
import { readSessionSnapshot } from "../../src/shared/session/session-recovery.ts";
import { expect, test } from "./fixtures.mjs";
import { main } from "../../services/mcp-bridge/src/cli.mjs";
import { callTool, readHealth } from "../../services/mcp-bridge/src/client.mjs";

test("external drive runs page tools, keeps claimed tabs, and refuses occupied sessions", async () => {
  test.setTimeout(360_000);
  const { launchIsolatedExtensionMcp } = await import("../support/isolated-extension-mcp.mjs");
  const fixture = await startPage();
  const environment = await launchIsolatedExtensionMcp({ profilePrefix: "qz-external-drive-", requestTimeoutSeconds: 90 });
  const stdout = { isTTY: true, text: "", write(value) { this.text += value; } };
  const stderr = { isTTY: true, text: "", write(value) { this.text += value; } };
  const dependencies = {
    stdout,
    stderr,
    findDaemon: async () => ({
      endpoint: environment.bridge.endpoint,
      health: await readHealth(environment.bridge.endpoint),
    }),
  };
  const openedTabs = [];
  const createdIds = new Set();
  const createDrive = async () => {
    stdout.text = "";
    stderr.text = "";
    expect(await main(["session", "create", "--json"], dependencies), stderr.text).toBe(0);
    const id = JSON.parse(stdout.text).result.sessionId;
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(createdIds.has(id)).toBe(false);
    createdIds.add(id);
    return id;
  };
  try {
    const created = await callTool(environment.bridge.endpoint, "qingzhou_create_session", {
      title: "Built-in task", firstMessage: "", timeoutSeconds: 20,
    }, { timeoutMs: 25_000 });
    const builtinId = created.session?.id || created.sessionId;
    expect(builtinId).toBeTruthy();
    const before = await callTool(environment.bridge.endpoint, "qingzhou_get_session_state", {
      sessionId: builtinId, timeoutSeconds: 20,
    }, { timeoutMs: 25_000 });
    const occupied = await exec(dependencies, stdout, stderr, {
      sessionId: builtinId,
      name: "open_tab",
      args: { url: `${fixture}/occupied` },
    });
    expect(occupied.code, occupied.text || stderr.text).toBe(1);
    expect(occupied.text).toMatch(/这个会话已有任务在用|already has a task/);
    const after = await callTool(environment.bridge.endpoint, "qingzhou_get_session_state", {
      sessionId: builtinId, timeoutSeconds: 20,
    }, { timeoutMs: 25_000 });
    expect(after.runId ?? null).toBe(before.runId ?? null);
    expect(after.status ?? "").toBe(before.status ?? "");
    const source = await environment.page.evaluate(async (id) => {
      const stored = await chrome.storage.local.get("_sessions");
      return stored._sessions?.[id]?.source || "";
    }, builtinId);
    expect(source).not.toBe("external-drive");

    const baseCatalog = await callTool(environment.bridge.endpoint, "qingzhou_list_tools", {});
    expect(baseCatalog.tools.map(tool => tool.name)).toContain("list_skills");
    const sessionId = await createDrive();
    const opened = await exec(dependencies, stdout, stderr, {
      sessionId,
      name: "open_tab",
      args: { url: `${fixture}/drive`, tabAlias: "page" },
    }, "90");
    expect(opened.code, opened.text || stderr.text).toBe(0);
    expect(opened.body.result.toolName).toBe("open_tab");
    expect(opened.body.result.runId).toMatch(/^drive-/);
    const tabId = opened.body.result.result.tabRef;
    expect(typeof tabId).toBe("number");
    openedTabs.push(tabId);
    const firstRunId = opened.body.result.runId;
    expect(await environment.page.evaluate(async (id) => (await chrome.tabs.get(id)).active, tabId)).toBe(false);
    await expect.poll(async () => environment.page.evaluate(async () => (await chrome.tabGroups.query({})).map((group) => group.title)), {
      timeout: 15_000,
    }).toContain("轻舟 · CLI");

    const ax = await exec(dependencies, stdout, stderr, {
      sessionId,
      name: "get_ax_tree",
      args: { tabRef: tabId },
    }, "90");
    expect(ax.code, ax.text || stderr.text).toBe(0);
    expect(ax.text).not.toMatch(/CDP_RUN_CONTEXT_REQUIRED/);
    expect(String(ax.body.result.result?.snapshot || "")).not.toBe("");

    const act = await exec(dependencies, stdout, stderr, {
      sessionId,
      name: "act_on_element",
      args: { tabRef: tabId, target: "css:#go", action: "click" },
    }, "90");
    expect(act.code, act.text || stderr.text).toBe(0);
    expect(act.text).not.toMatch(/CDP_RUN_CONTEXT_REQUIRED/);
    await expect.poll(async () => environment.page.evaluate(async (id) => {
      const [injected] = await chrome.scripting.executeScript({ target: { tabId: id }, func: () => document.title });
      return injected.result;
    }, tabId), { timeout: 15_000 }).toBe("clicked");

    const polish = await exec(dependencies, stdout, stderr, { sessionId, calls: [
      { id: "wait", name: "wait", args: { tabRef: "page", seconds: 0 } },
      { id: "list", name: "list_tabs", args: { tabRef: "page" } },
      { id: "skills", name: "list_skills", args: { tabRef: "page" } },
      { id: "press", name: "act_on_screen", args: { tabRef: "page", action: "press", key: "Escape", returnScreenshot: false } },
    ] });
    expect(polish.code, polish.text).toBe(0);
    expect(polish.body.result.results.every(item => !item.isError)).toBe(true);
    const screenshot = await exec(dependencies, stdout, stderr, { sessionId, name: "screenshot", args: { tabRef: "page", target: "viewport" } });
    expect(screenshot.code).toBe(1);
    expect(screenshot.text || stderr.text).toContain("SCREENSHOT_TARGET_INVALID");

    await expect(callTool(environment.bridge.endpoint, "qingzhou_send_message", {
      sessionId, text: "hello", timeoutSeconds: 15,
    }, { timeoutMs: 20_000 })).rejects.toThrow(/只能查看|read-only/);

    const batchSession = await createDrive();
    const batch = await exec(dependencies, stdout, stderr, {
      sessionId: batchSession,
      calls: [
        { id: "open", name: "open_tab", args: { url: `${fixture}/batch`, tabAlias: "page" } },
        { id: "read", name: "get_ax_tree", args: { tabRef: "page" } },
        { id: "click", name: "act_on_element", args: { tabRef: "page", target: "css:#go", action: "click" } },
      ],
    }, "120");
    expect(batch.code, batch.text || stderr.text).toBe(0);
    expect(batch.body.result.results).toHaveLength(3);
    expect(batch.body.result.results.every((item) => item.isError !== true)).toBe(true);
    expect(batch.body.result.runId).toMatch(/^drive-/);
    const savedTools = await environment.page.evaluate(async (id) => {
      const key = `_session_${id}`;
      const stored = await chrome.storage.local.get(key);
      const record = stored[key] || {};
      const transcript = [...(record.transcript || []), ...(record.currentTranscript || [])];
      return transcript.filter((entry) => entry && entry.type === "tool").map((entry) => entry.name);
    }, batchSession);
    expect(savedTools).toEqual(["open_tab", "get_ax_tree", "act_on_element"]);

    const smokeId = await createDrive();
    const smoke = await exec(dependencies, stdout, stderr, {
      sessionId: smokeId,
      calls: [
        { id: "open", name: "open_tab", args: { url: `${fixture}/smoke`, tabAlias: "page" } },
        { id: "read", name: "get_ax_tree", args: { tabRef: "page" } },
      ],
    }, "120");
    expect(smoke.code, smoke.text || stderr.text).toBe(0);
    expect(smoke.body.result.results).toHaveLength(2);
    expect(smoke.body.result.sessionId).toBe(smokeId);
    expect(smoke.body.result.results.every((item) => item.isError !== true)).toBe(true);
    openedTabs.push(smoke.body.result.results[0].result.tabRef);
    await callTool(environment.bridge.endpoint, "qingzhou_stop_session", {
      sessionId: smoke.body.result.sessionId, timeoutSeconds: 20,
    }, { timeoutMs: 25_000 });
    const batchTab = batch.body.result.results[0].result.tabRef;
    openedTabs.push(batchTab);
    expect(String(batch.body.result.results[1].result?.snapshot || "")).not.toBe("");
    expect(batch.text).not.toMatch(/CDP_RUN_CONTEXT_REQUIRED/);
    await expect.poll(async () => environment.page.evaluate(async (id) => {
      const [injected] = await chrome.scripting.executeScript({ target: { tabId: id }, func: () => document.title });
      return injected.result;
    }, batchTab), { timeout: 15_000 }).toBe("clicked");

    const keptId = await createDrive();
    const kept = await exec(dependencies, stdout, stderr, {
      sessionId: keptId,
      name: "open_tab",
      args: { url: `${fixture}/keep` },
    }, "90");
    expect(kept.code, kept.text || stderr.text).toBe(0);
    const keptTab = kept.body.result.result.tabRef;
    const keptRunId = kept.body.result.runId;
    expect(keptRunId).toMatch(/^drive-/);
    openedTabs.push(keptTab);
    await callTool(environment.bridge.endpoint, "qingzhou_stop_session", {
      sessionId: keptId, keepTabs: true, timeoutSeconds: 20,
    }, { timeoutMs: 25_000 });
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(await tabExists(environment.page, keptTab)).toBe(true);
    const keptMeta = await environment.page.evaluate(async (id) => {
      const stored = await chrome.storage.local.get("_sessions");
      return stored._sessions?.[id] || null;
    }, keptId);
    expect(keptMeta?.source).toBe("external-drive");
    expect(keptMeta?.keepDriveTabs).toBeUndefined();
    const again = await exec(dependencies, stdout, stderr, {
      sessionId: keptId,
      name: "list_tabs",
      args: {},
    });
    expect(again.code, again.text || stderr.text).toBe(1);
    expect(again.text || stderr.text).toContain("DRIVE_SESSION_ENDED");
    await callTool(environment.bridge.endpoint, "qingzhou_stop_session", {
      sessionId: keptId, timeoutSeconds: 20,
    }, { timeoutMs: 25_000 });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await tabExists(environment.page, keptTab)).toBe(true);

    const userTab = await environment.page.evaluate(async (url) => {
      const tab = await chrome.tabs.create({ url, active: false });
      return tab.id;
    }, `${fixture}/user`);
    openedTabs.push(userTab);
    const claimId = await createDrive();
    const claimed = await exec(dependencies, stdout, stderr, {
      sessionId: claimId,
      name: "use_tab",
      args: { tabRef: userTab },
    }, "60");
    expect(claimed.code, claimed.text || stderr.text).toBe(0);
    await callTool(environment.bridge.endpoint, "qingzhou_stop_session", {
      sessionId: claimId, timeoutSeconds: 20,
    }, { timeoutMs: 25_000 });
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(await tabExists(environment.page, userTab)).toBe(true);

    await callTool(environment.bridge.endpoint, "qingzhou_stop_session", {
      sessionId, timeoutSeconds: 20,
    }, { timeoutMs: 25_000 });
    await callTool(environment.bridge.endpoint, "qingzhou_stop_session", {
      sessionId: batchSession, timeoutSeconds: 20,
    }, { timeoutMs: 25_000 });
    await expect.poll(() => tabExists(environment.page, tabId), { timeout: 15_000 }).toBe(false);
    expect(firstRunId).toMatch(/^drive-/);
    const afterCancel = await exec(dependencies, stdout, stderr, { sessionId, name: "close_tab", args: { tabRef: "page" } });
    expect(afterCancel.code).toBe(1);
    expect(afterCancel.text || stderr.text).toContain("DRIVE_SESSION_ENDED");

    const pdfSession = await createDrive();
    const pdf = await exec(dependencies, stdout, stderr, { sessionId: pdfSession, name: "open_tab",
      args: { url: `${fixture}/document`, tabAlias: "pdf" } }, "90");
    expect(pdf.code, pdf.text || stderr.text).toBe(0);
    openedTabs.push(pdf.body.result.result.tabRef);
    const pdfRead = await exec(dependencies, stdout, stderr, { sessionId: pdfSession, name: "read_article",
      args: { tabRef: "pdf", limit: 1200 } });
    expect(pdfRead.code, pdfRead.text || stderr.text).toBe(1);
    expect(pdfRead.text || stderr.text).toContain("PDF_PAGE_UNSUPPORTED");
    expect(pdfRead.text || stderr.text).toContain("qingzhou-documents");
    expect(pdfRead.text || stderr.text).not.toMatch(/tabId|\binner\b/);
    const pdfPress = await exec(dependencies, stdout, stderr, { sessionId: pdfSession, name: "act_on_screen",
      args: { tabRef: "pdf", action: "press", key: "Escape", returnScreenshot: false } });
    expect(pdfPress.code, pdfPress.text || stderr.text).toBe(1);
    expect(pdfPress.text || stderr.text).toContain("PDF_PAGE_UNSUPPORTED");
    expect(pdfPress.text || stderr.text).not.toContain("BATCH_TAB_REFERENCE_ERROR");
    await callTool(environment.bridge.endpoint, "qingzhou_stop_session", { sessionId: pdfSession });
  } finally {
    await environment.page.evaluate(async (ids) => {
      const open = [];
      for (const id of ids) {
        try { await chrome.tabs.get(id); open.push(id); } catch { /* already closed */ }
      }
      if (open.length) await chrome.tabs.remove(open);
    }, openedTabs).catch(() => {});
    await environment.close();
    await fixture.close();
  }
});

test("drive timeline retains repeated batch IDs and nested script calls as separate cards", async () => {
  test.setTimeout(180_000);
  const { launchIsolatedExtensionMcp } = await import("../support/isolated-extension-mcp.mjs");
  const fixture = await startPage();
  const environment = await launchIsolatedExtensionMcp({ profilePrefix: "qz-drive-transcript-" });
  const { page, bridge } = environment;
  const stdout = { text: "", write(value) { this.text += value; } };
  const stderr = { text: "", write(value) { this.text += value; } };
  const dependencies = { stdout, stderr, findDaemon: async () => ({ endpoint: bridge.endpoint, health: await readHealth(bridge.endpoint) }) };
  try {
    const { sessionId } = await callTool(bridge.endpoint, "qingzhou_create_drive_session", {});
    const cards = page.locator("#messages .msg-tool");
    for (const [index, alias] of ["first", "second", "third"].entries()) {
      const result = await exec(dependencies, stdout, stderr, { sessionId, calls: [
        { id: "open", name: "open_tab", args: { url: `${fixture}/${alias}`, tabAlias: alias } },
        { id: "read", name: "read_article", args: { tabRef: alias, limit: 6000 } },
      ] });
      expect(result.code, result.text || stderr.text).toBe(0);
      expect(result.body.result.results.map(row => row.id)).toEqual(["open", "read"]);
      if (index === 0) {
        await page.locator('[data-tab="sessions"]').click();
        await page.locator('[data-sessions-mode="external-drive"]').click();
        await page.locator(`.session-card[data-id="${sessionId}"]`).click();
        await expect(page.locator("#app")).toHaveAttribute("data-external-drive", "true");
      }
      await expect(cards).toHaveCount((index + 1) * 2);
    }
    stdout.text = stderr.text = "";
    const scriptCode = `async () => {
      await tools.read_article({tabRef:"first",limit:100});
      await tools.wait({seconds:0});
      await tools.read_article({tabRef:"second",limit:100});
      return {title:"returned value is not the page title"};
    }`;
    expect(await main(["script", "--session", sessionId, "--tab", "first", "--json", "-"], {
      ...dependencies, readStdin: async () => scriptCode,
    }), stdout.text || stderr.text).toBe(0);
    await expect(cards).toHaveCount(10);
    await expect(cards.last().locator(".tool-args-preview")).toHaveText("(First page)");
    await expect(cards.last()).not.toContainText("当前页面");
    const result = await callTool(bridge.endpoint, "qingzhou_execute_tool", { sessionId, calls: [
      { id: "read", name: "read_article", args: { tabRef: "third", limit: 100 } },
      { id: "read", name: "read_article", args: { tabRef: "first", limit: 100 } },
    ] });
    expect(result.results.every(row => !row.isError)).toBe(true);
    await expect(cards).toHaveCount(12);
    const stored = await page.evaluate(async id => {
      const recordKey = `_session_${id}`, checkpointKey = `_session_transcript_checkpoint_${id}`;
      const values = await chrome.storage.local.get([recordKey, checkpointKey]);
      return { record: values[recordKey], checkpoint: values[checkpointKey] };
    }, sessionId);
    const saved = readSessionSnapshot(stored.record, null, stored.checkpoint).transcript.filter(entry => entry.type === "tool");
    expect(saved).toHaveLength(12);
    expect(new Set(saved.map(row => row.toolCallId)).size).toBe(12);
    expect(saved.filter(row => row.name === "open_tab")).toHaveLength(3);
    expect(saved.find(row => row.name === "run_script").result._pageTitle).toBe("First page");
    expect(saved.filter(row => row.name === "read_article" && row.args.tabRef === "second")
      .every(row => row.result._pageTitle === "Second page")).toBe(true);
    await page.reload();
    await expect(page.locator("#app")).toHaveAttribute("data-external-drive", "true");
    await expect(cards).toHaveCount(12);
    expect(await cards.evaluateAll(nodes => new Set(nodes.map(node => node.id)).size)).toBe(12);
    await callTool(bridge.endpoint, "qingzhou_stop_session", { sessionId });
  } finally { await environment.close(); await fixture.close(); }
});

async function exec(dependencies, stdout, stderr, payload, timeout = "60") {
  stdout.text = "";
  stderr.text = "";
  const session = payload?.sessionId ? ["--session", String(payload.sessionId)] : [];
  const code = await main(["exec", ...session, "--timeout", timeout, JSON.stringify(payload)], dependencies);
  let body = null;
  try { body = JSON.parse(stdout.text); } catch { body = null; }
  return { code, text: stdout.text, body };
}

function tabExists(page, tabId) {
  return page.evaluate(async (id) => {
    try { await chrome.tabs.get(id); return true; } catch { return false; }
  }, tabId);
}

function startPage() {
  const page = `<!doctype html><title>drive</title><p id="status">drive-ok</p><button id="go" type="button">Go</button>
<script>document.getElementById("go").addEventListener("click", () => { document.title = "clicked"; document.getElementById("status").textContent = "clicked"; });</script>`;
  const server = createServer((request, response) => {
    if (request.url === "/document") {
      response.writeHead(200, { "content-type": "application/pdf" });
      response.end(textPdf(["Drive PDF fixture"]));
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    const title = { "/first": "First page", "/second": "Second page", "/third": "Third page" }[request.url] || "drive";
    response.end(page.replace("<title>drive</title>", `<title>${title}</title>`));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        toString() { return `http://127.0.0.1:${address.port}`; },
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}
