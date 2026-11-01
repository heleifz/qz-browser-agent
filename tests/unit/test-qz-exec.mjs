import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { main } from "../../services/mcp-bridge/src/cli.mjs";
import { EXEC_JSON_MESSAGE } from "../../services/mcp-bridge/src/commands.mjs";

const running = {
  endpoint: "http://127.0.0.1:23456",
  health: { features: { browserPairing: 1 }, status: { connected: true, clients: [{ clientId: "fixture" }] } },
};

function stream(isTTY = false) {
  return { isTTY, columns: 80, text: "", write(value) { this.text += value; } };
}

function setup(extra = {}) {
  const stdout = stream(true);
  const stderr = stream(true);
  return { stdout, stderr, env: {}, findDaemon: async () => running, ...extra };
}

test("qz exec help prints the JSON sentence", async () => {
  const deps = setup();
  assert.equal(await main(["exec", "--help"], deps), 0);
  assert.match(deps.stdout.text, /Pass one JSON object with name and args, or with calls/);
  assert.match(deps.stdout.text, /qz exec <<'JSON'/);
});

test("qz exec reads one JSON object and prints JSON", async () => {
  const calls = [];
  const deps = setup({
    readStdin: async () => "{\"name\":\"list_tabs\",\"args\":{}}\n",
    callTool: async (_endpoint, name, args) => {
      calls.push({ name, args });
      return { toolName: "list_tabs", sessionId: "s", runId: null, result: { tabs: [] } };
    },
  });
  assert.equal(await main(["exec"], deps), 0);
  assert.equal(calls[0].name, "qingzhou_execute_tool");
  assert.equal(calls[0].args.name, "list_tabs");
  assert.equal(calls[0].args.sessionId, undefined);
  assert.equal(calls[0].args.clientId, "fixture");
  const body = JSON.parse(deps.stdout.text);
  assert.equal(body.result.sessionId, "s");
  assert.equal(body.ok, true);
  assert.equal(body.result.result.tabs.length, 0);
  assert.equal(deps.stderr.text, "");
});

test("invalid exec JSON exits 2 before connecting", async () => {
  const deps = setup({ findDaemon: async () => { throw new Error("connected too early"); } });
  assert.equal(await main(["exec", "{"], deps), 2);
  const body = JSON.parse(deps.stdout.text);
  assert.equal(body.error.code, "invalid_arguments");
  assert.equal(body.error.message, EXEC_JSON_MESSAGE);
});

test("a TTY with no JSON does not read stdin", async () => {
  const deps = setup({
    stdin: { isTTY: true },
    readStdin: async () => { throw new Error("read stdin"); },
    findDaemon: async () => { throw new Error("connected too early"); },
  });
  assert.equal(await main(["exec"], deps), 2);
  assert.equal(JSON.parse(deps.stdout.text).error.message, EXEC_JSON_MESSAGE);
});

test("tool failure exits 1 and screenshot bytes become file paths", async () => {
  const failed = setup({ callTool: async () => { throw Object.assign(new Error("Page failed"), { code: "tool_error" }); } });
  assert.equal(await main(["exec", "{\"name\":\"open_tab\",\"args\":{\"url\":\"https://example.com\"}}"], failed), 1);
  assert.equal(JSON.parse(failed.stdout.text).error.message, "Page failed");

  const png = Buffer.from("hi").toString("base64");
  const deps = setup({
    callTool: async () => ({
      toolName: "screenshot",
      sessionId: "s",
      runId: null,
      result: { id: 3 },
      images: [{ mimeType: "image/png", data: png }],
    }),
  });
  assert.equal(await main(["exec", "{\"name\":\"screenshot\",\"args\":{\"tabId\":3}}"], deps), 0);
  const body = JSON.parse(deps.stdout.text);
  assert.equal(body.ok, true);
  assert.equal(deps.stdout.text.includes(png), false);
  assert.equal(existsSync(body.result.images[0]), true);
  assert.equal(readFileSync(body.result.images[0]).toString(), "hi");

  const batch = setup({
    callTool: async () => ({ sessionId: "s", runId: null, results: [{ id: "a", name: "open_tab", isError: true, result: { error: "no" } }] }),
  });
  assert.equal(await main(["exec", "{\"calls\":[{\"id\":\"a\",\"name\":\"open_tab\",\"args\":{}}]}"], batch), 1);
});

test("exec resolves payload clientId and does not fall back", async () => {
  const health = {
    features: { browserPairing: 1 },
    status: {
      connected: true,
      clients: [
        { clientId: "11111111-1111-1111-1111-111111111111", name: "Alpha" },
        { clientId: "22222222-2222-2222-2222-222222222222", name: "Beta" },
      ],
      browsers: [
        { clientId: "11111111-1111-1111-1111-111111111111", name: "Alpha" },
        { clientId: "22222222-2222-2222-2222-222222222222", name: "Beta" },
        { clientId: "33333333-3333-3333-3333-333333333333", name: "Gamma" },
      ],
    },
  };
  const calls = [];
  const same = setup({
    findDaemon: async () => ({ endpoint: running.endpoint, health }),
    callTool: async (_endpoint, name, args) => {
      calls.push({ name, args });
      return { toolName: "list_tabs", result: { tabs: [] } };
    },
  });
  assert.equal(await main(["exec", "--client", "Alpha", JSON.stringify({
    name: "list_tabs", args: {}, clientId: "11111111-1111-1111-1111-111111111111",
  })], same), 0);
  assert.equal(calls[0].args.clientId, "11111111-1111-1111-1111-111111111111");

  const conflict = setup({
    findDaemon: async () => ({ endpoint: running.endpoint, health }),
    callTool: async () => { throw new Error("called"); },
  });
  assert.equal(await main(["exec", "--client", "Alpha", JSON.stringify({
    name: "list_tabs", args: {}, clientId: "Beta",
  })], conflict), 1);
  assert.match(conflict.stdout.text, /The --client option and clientId select different browsers/);
  assert.equal(conflict.stdout.text.includes("called"), false);

  const offline = setup({
    findDaemon: async () => ({ endpoint: running.endpoint, health }),
    callTool: async () => { throw new Error("called"); },
  });
  assert.equal(await main(["exec", JSON.stringify({ name: "list_tabs", args: {}, clientId: "Gamma" })], offline), 1);
  assert.match(offline.stdout.text, /offline/);
  assert.equal(offline.stdout.text.includes("called"), false);
});

test("exec writes per-call images to files", async () => {
  const png = Buffer.from("shot").toString("base64");
  const deps = setup({
    callTool: async () => ({
      sessionId: "s",
      runId: "drive-1",
      results: [
        { id: "a", name: "open_tab", result: { id: 1 }, isError: false },
        { id: "b", name: "screenshot", result: { id: 1 }, isError: false, images: [{ mimeType: "image/png", data: png }] },
      ],
    }),
  });
  assert.equal(await main(["exec", JSON.stringify({
    calls: [
      { id: "a", name: "open_tab", args: { url: "https://example.com" } },
      { id: "b", name: "screenshot", args: {} },
    ],
  })], deps), 0);
  const body = JSON.parse(deps.stdout.text);
  assert.equal(deps.stdout.text.includes(png), false);
  assert.equal(existsSync(body.result.results[1].images[0]), true);
  assert.equal(readFileSync(body.result.results[1].images[0]).toString(), "shot");
});
