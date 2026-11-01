import { createServer } from "node:http";
import { expect, test } from "./fixtures.mjs";
import { main } from "../../services/mcp-bridge/src/cli.mjs";
import { callTool, readHealth } from "../../services/mcp-bridge/src/client.mjs";

test("one external session opens, groups, and closes only its own tabs", async () => {
  test.setTimeout(240_000);
  const { launchIsolatedExtensionMcp } = await import("../support/isolated-extension-mcp.mjs");
  const fixture = await startPage();
  const environment = await launchIsolatedExtensionMcp({ profilePrefix: "qz-external-drive-", requestTimeoutSeconds: 60 });
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
  const sessionId = `drive-${Date.now().toString(36)}`;
  const keptId = `drive-keep-${Date.now().toString(36)}`;
  try {
    stdout.text = "";
    const remoteCode = await main(["exec", "--timeout", "30", JSON.stringify({
      sessionId: `drive-remote-${Date.now().toString(36)}`,
      nodeId: "remote",
      name: "open_tab",
      args: { url: `${fixture}/remote` },
    })], dependencies);
    expect(remoteCode).toBe(1);
    expect(stdout.text).toMatch(/现在只有本机|nodeId/);
    expect(await environment.page.evaluate(async () => (await chrome.tabs.query({ url: "http://127.0.0.1/*remote*" })).length)).toBe(0);

    stdout.text = "";
    const openedCode = await main(["exec", "--timeout", "60", JSON.stringify({
      sessionId,
      name: "open_tab",
      args: { url: `${fixture}/drive` },
    })], dependencies);
    expect(openedCode, stdout.text || stderr.text).toBe(0);
    const opened = JSON.parse(stdout.text).result;
    expect(opened.toolName).toBe("open_tab");
    expect(opened.sessionId).toBe(sessionId);
    const tabId = opened.result.id;
    expect(typeof tabId).toBe("number");
    await expect.poll(async () => environment.page.evaluate(async () => (await chrome.tabGroups.query({})).map((group) => group.title)), {
      timeout: 15_000,
    }).toContain("轻舟 · CLI");

    await expect(callTool(environment.bridge.endpoint, "qingzhou_send_message", {
      sessionId, text: "hello", timeoutSeconds: 15,
    }, { timeoutMs: 20_000 })).rejects.toThrow(/外部客户端|Stop the session/);

    await callTool(environment.bridge.endpoint, "qingzhou_stop_session", { sessionId, keepTabs: false, timeoutSeconds: 20 }, { timeoutMs: 25_000 });
    await expect.poll(async () => environment.page.evaluate(async (id) => {
      try { await chrome.tabs.get(id); return true; } catch { return false; }
    }, tabId), { timeout: 15_000 }).toBe(false);

    stdout.text = "";
    const batchCode = await main(["exec", "--timeout", "60", JSON.stringify({
      sessionId: keptId,
      calls: [
        { id: "a", name: "open_tab", args: { url: `${fixture}/a`, tabAlias: "a" } },
        { id: "b", name: "open_tab", args: { url: `${fixture}/b`, tabAlias: "b" } },
      ],
    })], dependencies);
    expect(batchCode, stdout.text || stderr.text).toBe(0);
    const batch = JSON.parse(stdout.text).result;
    expect(batch.results).toHaveLength(2);
    expect(batch.results.every((item) => item.isError !== true && typeof item.result?.id === "number")).toBe(true);
    const keptTabs = batch.results.map((item) => item.result.id);
    await callTool(environment.bridge.endpoint, "qingzhou_stop_session", { sessionId: keptId, keepTabs: true, timeoutSeconds: 20 }, { timeoutMs: 25_000 });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const stillOpen = await environment.page.evaluate(async (ids) => {
      const open = [];
      for (const id of ids) {
        try { await chrome.tabs.get(id); open.push(id); } catch { /* closed */ }
      }
      return open;
    }, keptTabs);
    expect(stillOpen).toEqual(keptTabs);
    await environment.page.evaluate(async (ids) => { await chrome.tabs.remove(ids); }, keptTabs);
  } finally {
    await environment.close();
    await fixture.close();
  }
});

function startPage() {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>drive</title><p>drive-ok</p>");
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
