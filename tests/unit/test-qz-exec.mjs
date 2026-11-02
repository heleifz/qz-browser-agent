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
  assert.match(deps.stdout.text, /qz exec --session ID <<'JSON'/);
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
  assert.equal(await main(["exec", "--session", "s"], deps), 0);
  assert.equal(calls[0].name, "qingzhou_execute_tool");
  assert.equal(calls[0].args.name, "list_tabs");
  assert.equal(calls[0].args.sessionId, "s");
  assert.equal(calls[0].args.clientId, "fixture");
  const body = JSON.parse(deps.stdout.text);
  assert.equal(body.result.sessionId, "s");
  assert.equal(body.ok, true);
  assert.equal(body.result.result.tabs.length, 0);
  assert.equal(deps.stderr.text, "");
});

test("invalid exec JSON exits 2 before connecting", async () => {
  const deps = setup({ findDaemon: async () => { throw new Error("connected too early"); } });
  assert.equal(await main(["exec", "--session", "s", "{"], deps), 2);
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
  assert.equal(await main(["exec", "--session", "s"], deps), 2);
  assert.equal(JSON.parse(deps.stdout.text).error.message, EXEC_JSON_MESSAGE);
});

test("tool failure exits 1 and screenshot bytes become file paths", async () => {
  const failed = setup({ callTool: async () => { throw Object.assign(new Error("Page failed"), { code: "tool_error" }); } });
  assert.equal(await main(["exec", "--session", "s", "{\"name\":\"open_tab\",\"args\":{\"url\":\"https://example.com\"}}"], failed), 1);
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
  assert.equal(await main(["exec", "--session", "s", "{\"name\":\"screenshot\",\"args\":{\"tabId\":3}}"], deps), 0);
  const body = JSON.parse(deps.stdout.text);
  assert.equal(body.ok, true);
  assert.equal(deps.stdout.text.includes(png), false);
  assert.equal(existsSync(body.result.images[0]), true);
  assert.equal(readFileSync(body.result.images[0]).toString(), "hi");

  const batch = setup({
    callTool: async () => ({ sessionId: "s", runId: null, results: [{ id: "a", name: "open_tab", isError: true, result: { error: "no" } }] }),
  });
  assert.equal(await main(["exec", "--session", "s", "{\"calls\":[{\"id\":\"a\",\"name\":\"open_tab\",\"args\":{}}]}"], batch), 1);
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
  assert.equal(await main(["exec", "--session", "s", "--client", "Alpha", JSON.stringify({
    name: "list_tabs", args: {}, clientId: "11111111-1111-1111-1111-111111111111",
  })], same), 0);
  assert.equal(calls[0].args.clientId, "11111111-1111-1111-1111-111111111111");

  const conflict = setup({
    findDaemon: async () => ({ endpoint: running.endpoint, health }),
    callTool: async () => { throw new Error("called"); },
  });
  assert.equal(await main(["exec", "--session", "s", "--client", "Alpha", JSON.stringify({
    name: "list_tabs", args: {}, clientId: "Beta",
  })], conflict), 1);
  assert.match(conflict.stdout.text, /The --client option and clientId select different browsers/);
  assert.equal(conflict.stdout.text.includes("called"), false);

  const offline = setup({
    findDaemon: async () => ({ endpoint: running.endpoint, health }),
    callTool: async () => { throw new Error("called"); },
  });
  assert.equal(await main(["exec", "--session", "s", JSON.stringify({ name: "list_tabs", args: {}, clientId: "Gamma" })], offline), 1);
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
  assert.equal(await main(["exec", "--session", "s", JSON.stringify({
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

test("qz exec list_tools get_tool and capabilities use the catalog calls", async () => {
  const calls = [];
  const deps = setup({
    callTool: async (_endpoint, name, args) => {
      calls.push({ name, args });
      if (name === "qingzhou_list_tools") return { tools: [{ name: "open_tab", signature: "open_tab({url})" }] };
      if (name === "qingzhou_get_tool") return { name: args.name, signature: "open_tab({url})" };
      return { capabilities: ["tabs"] };
    },
  });
  assert.equal(await main(["exec", "--session", "s", JSON.stringify({ name: "list_tools" })], deps), 0);
  assert.equal(calls[0].name, "qingzhou_list_tools");
  assert.equal(calls[0].args.name, undefined);
  assert.equal(calls[0].args.sessionId, "s");
  assert.equal(calls[0].args.clientId, "fixture");
  assert.equal(JSON.parse(deps.stdout.text).result.tools[0].signature, "open_tab({url})");
  assert.equal(await main(["exec", "--session", "s", JSON.stringify({ name: "get_tool", args: { name: "open_tab" } })], deps), 0);
  assert.equal(calls[1].name, "qingzhou_get_tool");
  assert.equal(calls[1].args.name, "open_tab");
  assert.equal(calls[1].args.sessionId, "s");
  assert.equal(await main(["exec", "--session", "s", JSON.stringify({ name: "capabilities" })], deps), 0);
  assert.equal(calls[2].name, "qingzhou_list_capabilities");
  assert.equal(calls[2].args.sessionId, undefined);
  const batch = setup({
    callTool: async (_endpoint, name) => {
      calls.push({ name });
      return { results: [] };
    },
  });
  assert.equal(await main(["exec", "--session", "s", JSON.stringify({ calls: [{ id: "a", name: "list_tools", args: {} }] })], batch), 0);
  assert.equal(calls[3].name, "qingzhou_execute_tool");
});

test("qz script request timeout outlasts the script timeout", async () => {
  const calls = [];
  const timed = setup({
    readStdin: async () => "async () => 1\n",
    callTool: async (_endpoint, name, args, options) => {
      calls.push({ name, args, timeoutMs: options.timeoutMs });
      return { sessionId: "s", result: { ok: true, result: 1 } };
    },
  });
  assert.equal(await main(["script", "--session", "s", "--tab", "page", "--timeout", "5"], timed), 0);
  assert.equal(calls[0].name, "qingzhou_execute_tool");
  assert.equal(calls[0].args.sessionId, "s");
  assert.equal(calls[0].args.args.target, "page");
  assert.equal(calls[0].args.args.tabRef, "page");
  assert.equal(calls[0].args.args.timeout, 5);
  assert.equal(calls[0].args.timeoutSeconds, 65);
  assert.equal(calls[0].timeoutMs, 65000);
  const defaults = setup({
    readStdin: async () => "async () => 1\n",
    callTool: async (_endpoint, _name, args, options) => {
      calls.push({ args, timeoutMs: options.timeoutMs });
      return { result: { ok: true, result: 1 } };
    },
  });
  assert.equal(await main(["script", "--session", "s", "--tab", "page"], defaults), 0);
  assert.equal(calls[1].args.sessionId, "s");
  assert.equal(calls[1].args.args.target, "page");
  assert.equal(calls[1].args.args.tabRef, "page");
  assert.equal(calls[1].args.args.timeout, 120);
  assert.equal(calls[1].args.timeoutSeconds, 180);
  assert.equal(calls[1].timeoutMs, 180000);
});

test("exec uses the same extended script wait as the bridge without changing execution budgets", async () => {
  for (const [payload, option, expected] of [
    [{ name: "run_script", args: { tabRef: "page", timeout: 300 } }, [], 360],
    [{ name: "run_script", args: { tabRef: "page", timeout: 300 } }, ["--timeout", "900"], 900],
    [{ calls: [{ id: "read", name: "run_script", args: { tabRef: "page", timeout: 300 } }], limits: { timeoutSeconds: 15 } }, [], 360],
    [{ name: "run_script", args: { tabRef: "page", timeout: 0 } }, [], 86400],
    [{ name: "list_tabs", args: {} }, [], 180],
  ]) {
    let seen;
    const deps = setup({ callTool: async (_endpoint, _name, args, options) => {
      seen = { args, options };
      return { result: { ok: true, result: 7 } };
    } });
    assert.equal(await main(["exec", "--session", "created", ...option, JSON.stringify(payload)], deps), 0);
    assert.equal(seen.options.timeoutMs, expected * 1000);
    assert.deepEqual(seen.args.args, payload.args);
    assert.deepEqual(seen.args.calls, payload.calls);
    assert.deepEqual(seen.args.limits, payload.limits);
  }
});

test("CLI presents unknown sessions and script failure envelopes without implicit creation", async () => {
  for (const argv of [
    ["exec", "--session", "missing", '{"name":"list_tabs","args":{}}'],
    ["tools", "--session", "missing", "--json"],
    ["script", "--session", "missing", "--tab", "page", "--json"],
  ]) {
    const calls = [];
    const deps = setup({ readStdin: async () => "async () => 7", callTool: async (_endpoint, name) => {
      calls.push(name);
      throw Object.assign(new Error("Session not found. Use qz session create (MCP: qingzhou_create_drive_session)."), { code: "DRIVE_SESSION_NOT_FOUND" });
    } });
    assert.equal(await main(argv, deps), 1);
    const output = JSON.parse(deps.stdout.text);
    assert.equal(output.error.code, "DRIVE_SESSION_NOT_FOUND");
    assert.match(output.error.message, /qz session create/);
    assert.equal(calls.length, 1);
    assert.ok(!calls.includes("qingzhou_create_drive_session"));
  }
  const failure = { ok: false, code: "SCRIPT_SYNTAX_ERROR", error: "SyntaxError: Unexpected token (2:4)" };
  for (const command of ["script", "exec"]) {
    const deps = setup({ readStdin: async () => "async () => 7", callTool: async () => ({
      toolName: "run_script", sessionId: "created", result: failure,
    }) });
    const argv = command === "script" ? ["script", "--session", "created", "--tab", "page", "--json"]
      : ["exec", "--session", "created", '{"name":"run_script","args":{"tabRef":"page","timeout":30,"code":"async () => 7"}}'];
    assert.equal(await main(argv, deps), 1);
    const output = JSON.parse(deps.stdout.text);
    if (command === "script") assert.deepEqual(output, { code: failure.code, error: failure.error });
    else { assert.equal(output.ok, true); assert.deepEqual(output.result.result, failure); }
  }
});

test("drive commands require --session and session create prints the id", async () => {
  const early = setup({ findDaemon: async () => { throw new Error("connected too early"); } });
  assert.equal(await main(["script", "--tab", "page"], early), 2);
  assert.match(early.stderr.text, /qz script requires --session/);
  assert.match(early.stderr.text, /qz session create/);
  assert.equal(await main(["exec", "{\"name\":\"list_tabs\",\"args\":{}}"], early), 2);
  assert.match(early.stderr.text, /qz exec requires --session/);
  assert.equal(await main(["tools"], early), 2);
  assert.match(early.stderr.text, /qz tools requires --session/);
  const mismatch = setup({ callTool: async () => { throw new Error("called"); } });
  assert.equal(await main(["exec", "--session", "one", JSON.stringify({ name: "list_tabs", args: {}, sessionId: "two" })], mismatch), 2);
  assert.match(mismatch.stdout.text, /different sessions/);
  assert.equal(mismatch.stdout.text.includes("called"), false);
  const created = setup({
    callTool: async (_endpoint, name) => {
      assert.equal(name, "qingzhou_create_drive_session");
      return { sessionId: "drive-1" };
    },
  });
  assert.equal(await main(["session", "create"], created), 0);
  assert.equal(created.stdout.text, "sessionId drive-1\n");
  const json = setup({
    callTool: async () => ({ sessionId: "drive-2" }),
  });
  assert.equal(await main(["session", "create", "--json"], json), 0);
  assert.equal(JSON.parse(json.stdout.text).result.sessionId, "drive-2");
});
