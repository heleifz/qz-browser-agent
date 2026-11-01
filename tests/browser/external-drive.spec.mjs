import { createServer } from "node:http";
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

    const sessionId = `drive-${Date.now().toString(36)}`;
    const opened = await exec(dependencies, stdout, stderr, {
      sessionId,
      name: "open_tab",
      args: { url: `${fixture}/drive` },
    }, "90");
    expect(opened.code, opened.text || stderr.text).toBe(0);
    expect(opened.body.result.toolName).toBe("open_tab");
    expect(opened.body.result.runId).toMatch(/^drive-/);
    const tabId = opened.body.result.result.id;
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
      args: { tabId },
    }, "90");
    expect(ax.code, ax.text || stderr.text).toBe(0);
    expect(ax.text).not.toMatch(/CDP_RUN_CONTEXT_REQUIRED/);
    expect(String(ax.body.result.result?.snapshot || "")).not.toBe("");

    const act = await exec(dependencies, stdout, stderr, {
      sessionId,
      name: "act_on_element",
      args: { tabId, target: "css:#go", action: "click" },
    }, "90");
    expect(act.code, act.text || stderr.text).toBe(0);
    expect(act.text).not.toMatch(/CDP_RUN_CONTEXT_REQUIRED/);
    await expect.poll(async () => environment.page.evaluate(async (id) => {
      const [injected] = await chrome.scripting.executeScript({ target: { tabId: id }, func: () => document.title });
      return injected.result;
    }, tabId), { timeout: 15_000 }).toBe("clicked");

    await expect(callTool(environment.bridge.endpoint, "qingzhou_send_message", {
      sessionId, text: "hello", timeoutSeconds: 15,
    }, { timeoutMs: 20_000 })).rejects.toThrow(/外部客户端|Stop the session/);

    const batchSession = `drive-batch-${Date.now().toString(36)}`;
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
    const batchTab = batch.body.result.results[0].result.id;
    openedTabs.push(batchTab);
    expect(String(batch.body.result.results[1].result?.snapshot || "")).not.toBe("");
    expect(batch.text).not.toMatch(/CDP_RUN_CONTEXT_REQUIRED/);
    await expect.poll(async () => environment.page.evaluate(async (id) => {
      const [injected] = await chrome.scripting.executeScript({ target: { tabId: id }, func: () => document.title });
      return injected.result;
    }, batchTab), { timeout: 15_000 }).toBe("clicked");

    const keptId = `drive-keep-${Date.now().toString(36)}`;
    const kept = await exec(dependencies, stdout, stderr, {
      sessionId: keptId,
      name: "open_tab",
      args: { url: `${fixture}/keep` },
    }, "90");
    expect(kept.code, kept.text || stderr.text).toBe(0);
    const keptTab = kept.body.result.result.id;
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
    expect(again.code, again.text || stderr.text).toBe(0);
    expect(again.body.result.runId).toMatch(/^drive-/);
    expect(again.body.result.runId).not.toBe(keptRunId);
    await callTool(environment.bridge.endpoint, "qingzhou_stop_session", {
      sessionId: keptId, timeoutSeconds: 20,
    }, { timeoutMs: 25_000 });
    await expect.poll(() => tabExists(environment.page, keptTab), { timeout: 15_000 }).toBe(false);

    const userTab = await environment.page.evaluate(async (url) => {
      const tab = await chrome.tabs.create({ url, active: false });
      return tab.id;
    }, `${fixture}/user`);
    openedTabs.push(userTab);
    const claimId = `drive-claim-${Date.now().toString(36)}`;
    const claimed = await exec(dependencies, stdout, stderr, {
      sessionId: claimId,
      name: "use_tab",
      args: { tabId: userTab },
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

async function exec(dependencies, stdout, stderr, payload, timeout = "60") {
  stdout.text = "";
  stderr.text = "";
  const code = await main(["exec", "--timeout", timeout, JSON.stringify(payload)], dependencies);
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
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(page);
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
