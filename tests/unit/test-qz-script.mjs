import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { main } from "../../services/mcp-bridge/src/cli.mjs";
import { resultToContent, executeMcpTool } from "../../services/mcp-bridge/src/tools.mjs";
import { QzError, readHealth, resultValue } from "../../services/mcp-bridge/src/client.mjs";
import { startBridge } from "../../services/mcp-bridge/src/server.mjs";
import { pairBrowser, completeBrowser } from "../support/paired-bridge.mjs";

const running = { endpoint: "http://127.0.0.1:23456", health: {
  features: { browserPairing: 1, scriptApiVersion: 1 }, status: { connected: true, clients: [{ clientId: "fixture" }] },
} };
function stream(isTTY = false) { return { isTTY, columns: 100, text: "", write(value) { this.text += value; } }; }
function setup(extra = {}) {
  return { stdout: stream(), stderr: stream(), env: {}, findDaemon: async () => running,
    ensureDaemon: () => assert.fail("the fixture service is already running"),
    readStdin: async () => "async () => 7", ...extra,
    ...(extra.callTool ? { callTool: async (...call) => call[1] === "qingzhou_call" && call[2].method === "ping"
      ? { pong: true } : extra.callTool(...call) } : {}),
  };
}
const success = result => ({ sessionId: "s", toolName: "run_script", isError: false, result });

test("script help describes one outer runtime and schema discovery", async () => {
  const deps = setup();
  assert.equal(await main(["script", "--help"], deps), 0);
  assert.match(deps.stdout.text, /qz script --session ID \[FILE\|-\]/);
  assert.match(deps.stdout.text, /tools\.list_tools/);
  assert.doesNotMatch(deps.stdout.text, /--tab|qz exec|qz tools/);
});

test("scripts carry explicit session and JSON args without a page or implicit creation", async () => {
  const calls = [];
  const args = { query: "Hangzhou", business: { tabId: "page-owned", selector: "business-field", inner: { nodes: [1, 2] } } };
  const deps = setup({ callTool: async (_endpoint, name, payload) => { calls.push({ name, payload }); return success(args); } });
  assert.equal(await main(["script", "--session", "s", "--args", JSON.stringify(args)], deps), 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "qingzhou_execute_tool");
  assert.equal(calls[0].payload.name, "run_script");
  assert.equal(calls[0].payload.scriptApiVersion, 1);
  assert.equal(calls[0].payload.sessionId, "s");
  assert.equal(calls[0].payload.clientId, "fixture");
  assert.deepEqual(calls[0].payload.args.args, args);
  for (const key of ["tabRef", "target", "scope"]) assert.equal(Object.hasOwn(calls[0].payload.args, key), false);
  assert.deepEqual(JSON.parse(deps.stdout.text), { traces: [], result: args });
  assert.equal(deps.stderr.text, "");
});

test("--args preserves every JSON value shape", async () => {
  for (const value of [null, false, 0, "text", [1, 2], { query: "page" }]) {
    const deps = setup({ callTool: async (_endpoint, _name, payload) => {
      assert.deepEqual(payload.args.args, value); return success(value);
    } });
    assert.equal(await main(["script", "--session", "s", "--args", JSON.stringify(value)], deps), 0);
    assert.deepEqual(JSON.parse(deps.stdout.text), { traces: [], result: value });
  }
});

test("local files and stdin share the script request path", async t => {
  const directory = mkdtempSync(join(tmpdir(), "qz-script-fixture-"));
  t.after(async () => { const { rm } = await import("node:fs/promises"); await rm(directory, { recursive: true, force: true }); });
  const file = join(directory, "task.js"), code = "async () => input.query\n";
  writeFileSync(file, code);
  const deps = setup({ readStdin: () => assert.fail("a file script does not read stdin"),
    callTool: async (_endpoint, _name, payload) => { assert.equal(payload.args.code, code); return success("file"); } });
  assert.equal(await main(["script", "--session", "s", file], deps), 0);
  assert.deepEqual(JSON.parse(deps.stdout.text), { traces: [], result: "file" });
});

test("invalid arguments and removed routes fail before discovery or stdin", async () => {
  for (const argv of [["script"], ["script", "--session", "s", "--tab", "page"],
    ["script", "--session", "s", "--target", "page"], ["script", "--session", "s", "--scope", "page"],
    ["exec", "--session", "s", "{}"], ["tools", "--session", "s"],
    ...["{", "secret-fixture"].map(value => ["script", "--session", "s", "--args", value])]) {
    const deps = setup({ findDaemon: () => assert.fail("syntax is checked first"), readStdin: () => assert.fail("invalid syntax cannot consume stdin") });
    assert.equal(await main(argv, deps), 2, argv.join(" "));
    const output = JSON.parse(deps.stdout.text);
    if (argv[0] === "script") {
      assert.deepEqual(Object.keys(output).sort(), ["result", "traces"]);
      assert.deepEqual(output.traces, []);
      assert.equal(output.result.code, "INVALID_ARGUMENTS");
    } else assert.equal(output.code, "INVALID_ARGUMENTS");
    assert.doesNotMatch(deps.stdout.text, /secret-fixture/);
  }
  for (const readStdin of [async () => " \n", async () => { throw new Error("stdin failed"); }]) {
    const deps = setup({ readStdin, findDaemon: () => assert.fail("validate source first") });
    assert.notEqual(await main(["script", "--session", "s"], deps), 0);
  }
});

test("script request waiting exceeds its execution budget by sixty seconds", async () => {
  for (const [options, scriptSeconds] of [[[], 120], [["--timeout", "5"], 5], [["--timeout", "900"], 900]]) {
    const deps = setup({ callTool: async (_endpoint, name, payload, request) => {
      assert.equal(name, "qingzhou_execute_tool");
      assert.equal(payload.args.timeout, scriptSeconds);
      assert.equal(payload.timeoutSeconds, scriptSeconds + 60);
      assert.equal(request.timeoutMs, (scriptSeconds + 60) * 1000);
      return success(7);
    } });
    assert.equal(await main(["script", "--session", "s", ...options], deps), 0);
    assert.deepEqual(JSON.parse(deps.stdout.text), { traces: [], result: 7 });
  }
});

test("business error-like keys and all JSON value shapes remain successful", async () => {
  for (const value of [false, 0, "text", null, [1, 2],
    { ok: false, error: "business", code: "APP_CODE", message: "user text", trace: [1], traces: ["business trace"], result: 42 },
    { truncated: true, preview: "business", images: [{ mimeType: "image/png", data: "YQ==" }], results: [{ id: "r", images: [1] }] }]) {
    const deps = setup({ callTool: async () => success(value) });
    assert.equal(await main(["script", "--session", "s"], deps), 0);
    assert.deepEqual(JSON.parse(deps.stdout.text), { traces: [], result: value });
  }
  const missing = setup({ callTool: async () => success(undefined) });
  assert.equal(await main(["script", "--session", "s"], missing), 0);
  assert.deepEqual(JSON.parse(missing.stdout.text), { traces: [], result: null });
});

test("tool errors retain public recovery fields and uncertain mutations never replay", async () => {
  const failure = { code: "ELEMENT_NOT_FOUND", message: "Target is absent", hint: "Refresh the element observation.", details: { target: "css:#missing" } };
  let count = 0;
  const deps = setup({ callTool: async () => { count++; return { isError: true, result: failure }; } });
  assert.equal(await main(["script", "--session", "s"], deps), 1);
  assert.deepEqual(JSON.parse(deps.stdout.text), { traces: [], result: failure });
  assert.equal(count, 1);
  const unknown = setup({ callTool: async (_endpoint, name) => {
    assert.equal(name, "qingzhou_execute_tool");
    throw Object.assign(new Error("Session not found."), { code: "DRIVE_SESSION_NOT_FOUND" });
  } });
  assert.equal(await main(["script", "--session", "missing", "--json"], unknown), 1);
  assert.deepEqual(Object.keys(JSON.parse(unknown.stdout.text)).sort(), ["result", "traces"]);
  assert.deepEqual(JSON.parse(unknown.stdout.text).traces, []);
  assert.equal(JSON.parse(unknown.stdout.text).result.code, "DRIVE_SESSION_NOT_FOUND");
});

test("script output keeps ordered wire traces separate from business trace fields in every output mode", async () => {
  const business = { ok: false, error: "business", trace: [{ message: "private data" }], traces: ["authored result"] };
  const traces = ["Script started.", "Opened the page.", "Read the title."];
  for (const tty of [false, true]) for (const flags of [[], ["--json"], ["--plain"]]) {
    const deps = setup({ stdout: stream(tty), stderr: stream(tty), callTool: async () => ({ ...success(business), traces }) });
    assert.equal(await main(["script", "--session", "s", ...flags], deps), 0);
    assert.deepEqual(JSON.parse(deps.stdout.text), { traces, result: business });
    assert.equal(deps.stderr.text, "");
  }
});

test("failed scripts prefer wire traces and fall back only to public error trace rows", async () => {
  const legacyTrace = [{ time: "12:00:00", level: "log", message: "Legacy progress." }, "Legacy final step."];
  const recovery = { line: 7, value: { trace: [{ level: "business", message: "Authored recovery data." }], traces: ["authored"] } };
  const failure = { code: "SCRIPT_EVALUATION_FAILED", message: "Page failed", details: { trace: legacyTrace, ...recovery } };
  for (const wire of [undefined, [], ["Script started.", "Page failed."]]) {
    const deps = setup({ callTool: async () => ({ isError: true, result: failure, ...(wire === undefined ? {} : { traces: wire }) }) });
    assert.equal(await main(["script", "--session", "s"], deps), 1);
    assert.deepEqual(JSON.parse(deps.stdout.text), { traces: wire ?? ["Legacy progress.", "Legacy final step."], result: { ...failure, details: recovery } });
    assert.deepEqual(failure.details.trace, legacyTrace, "presentation does not mutate the received ToolError");
    assert.equal(deps.stderr.text, "");
  }
  const business = { details: { trace: legacyTrace }, traces: ["business only"] };
  const deps = setup({ callTool: async () => success(business) });
  assert.equal(await main(["script", "--session", "s"], deps), 0);
  assert.deepEqual(JSON.parse(deps.stdout.text), { traces: [], result: business });
});

test("script usage, preflight and connection failures keep the two-key stdout shape", async () => {
  for (const [argv, extra, code, exitCode] of [
    [["script"], {}, "INVALID_ARGUMENTS", 2],
    [["script", "--session", "s"], { readStdin: async () => "" }, "INVALID_ARGUMENTS", 2],
    [["script", "--session", "s"], { findDaemon: async () => null, ensureDaemon: async () => { throw new QzError("CONNECTION_ERROR", "Service startup failed."); } }, "CONNECTION_ERROR", 1],
    [["script", "--session", "s"], { callTool: async () => { throw Object.assign(new Error("Upgrade first"), { code: "UPGRADE_REQUIRED" }); } }, "UPGRADE_REQUIRED", 1],
    [["script", "--session", "s"], { callTool: async () => { throw Object.assign(new Error("Cancelled"), { name: "AbortError" }); } }, "INTERRUPTED", 1],
  ]) {
    const deps = setup({ stdout: stream(true), stderr: stream(true), ...extra });
    assert.equal(await main(argv, deps), exitCode);
    const output = JSON.parse(deps.stdout.text);
    assert.deepEqual(Object.keys(output).sort(), ["result", "traces"]);
    assert.deepEqual(output.traces, []);
    assert.equal(output.result.code, code);
    assert.equal(deps.stderr.text, "");
  }
});

test("host errors retain their full trace through CLI error serialization", async () => {
  const messages = Array.from({ length: 7 }, (_, index) => `Completed step ${index + 1}.`);
  for (const trace of [messages, messages.map(message => ({ time: "12:00:00", level: "trace", message }))]) {
    let calls = 0;
    const deps = setup({ callTool: async () => {
      calls++;
      throw new QzError("TOOL_EXECUTION_FAILED", "Host execution failed.", { trace, hint: "Inspect the page before retrying." });
    } });
    assert.equal(await main(["script", "--session", "s"], deps), 1);
    assert.deepEqual(JSON.parse(deps.stdout.text), { traces: messages, result: {
      code: "TOOL_EXECUTION_FAILED", message: "Host execution failed.", hint: "Inspect the page before retrying.",
    } });
    assert.equal(deps.stderr.text, "");
    assert.equal(calls, 1);
  }
});

test("real MCP errors present diagnostic messages once while successful business trace fields remain intact", async t => {
  const bridge = await startBridge({ port: 0, connectWaitMs: 10 });
  t.after(() => bridge.close());
  const browser = await pairBrowser(bridge.state, { id: "script-trace-output" });
  const service = { endpoint: bridge.endpoint, instanceId: bridge.instanceId, health: await readHealth(bridge.endpoint) };
  const rows = Array.from({ length: 8 }, (_, index) => ({ time: "12:00:00", level: index % 2 ? "warn" : "trace", message: `Step ${index + 1}.` }));
  const messages = rows.map(row => row.message);
  const recovery = { line: 4, column: 2, value: { details: { trace: rows }, traces: ["authored data"] } };
  const error = { code: "SCRIPT_EVALUATION_FAILED", message: "Failed after progress.", hint: "Inspect the page before retrying.",
    details: { ...recovery, trace: rows.slice(-5) } };
  for (const mode of ["returned-error", "thrown-error", "authored-success"]) {
    const deps = setup({ findDaemon: async () => service });
    const pending = main(["script", "--session", "s", "--client", browser.id], deps);
    for (const method of ["ping", "capabilities", "execute_tool"]) {
      const [request] = await bridge.state.poll(browser, { timeoutMs: 2000 });
      assert.equal(request?.method, method);
      const payload = method === "ping" ? { ok: true, result: { pong: true } }
        : method === "capabilities" ? { ok: true, result: { scriptApiVersion: 1 } }
          : mode === "thrown-error" ? { ok: false, error: { ...error, details: { ...recovery, trace: rows } } }
            : { ok: true, result: { isError: mode === "returned-error", result: error,
              ...(mode === "returned-error" ? { traces: messages } : {}) } };
      assert.equal(completeBrowser(bridge.state, request.id, { clientId: browser.id, ...payload }), true);
    }
    assert.equal(await pending, mode === "authored-success" ? 0 : 1);
    const output = JSON.parse(deps.stdout.text);
    assert.deepEqual(output, mode === "authored-success"
      ? { traces: [], result: error }
      : { traces: messages, result: { ...error, details: mode === "thrown-error" ? { line: 4, column: 2 } : recovery } });
    assert.equal(deps.stderr.text, "");
    assert.deepEqual(error.details.trace, rows.slice(-5), "the error transport and its authored recovery data stay unchanged");
    assert.deepEqual(await bridge.state.poll(browser, { timeoutMs: 10 }), [], "failure presentation cannot replay the script");
  }
});

test("leading output and browser flags preserve the script failure envelope", async () => {
  for (const prefix of [["--json"], ["--plain"], ["--no-color"], ["--json", "--client", "fixture"]]) {
    for (const [words, extra, expected, exitCode] of [
      [["script"], {}, "INVALID_ARGUMENTS", 2],
      [["script", "--session"], {}, "INVALID_ARGUMENTS", 2],
      [["script", "--session", "s", "--unknown"], {}, "INVALID_ARGUMENTS", 2],
      [["script", "--session", "s"], { findDaemon: async () => null, ensureDaemon: async () => { throw new QzError("CONNECTION_ERROR", "Service startup failed."); } }, "CONNECTION_ERROR", 1],
      [["script", "--session", "s"], { callTool: async () => { throw Object.assign(new Error("Cancelled"), { name: "AbortError" }); } }, "INTERRUPTED", 1],
    ]) {
      const deps = setup({ stdout: stream(true), stderr: stream(true), ...extra });
      assert.equal(await main([...prefix, ...words], deps), exitCode);
      const output = JSON.parse(deps.stdout.text);
      assert.deepEqual(Object.keys(output).sort(), ["result", "traces"]);
      assert.deepEqual(output.traces, []);
      assert.equal(output.result.code, expected);
      assert.equal(deps.stderr.text, "");
    }
  }
});

test("script appearing as an option value or another command's argument keeps that command's output", async () => {
  for (const argv of [["--json", "--client", "script", "session", "show"],
    ["--json", "--args", "script", "status"], ["--json", "create", "script", "--timeout", "0"]]) {
    const deps = setup();
    assert.equal(await main(argv, deps), 2);
    assert.equal(JSON.parse(deps.stdout.text).code, "INVALID_ARGUMENTS");
    assert.equal(Object.hasOwn(JSON.parse(deps.stdout.text), "traces"), false);
  }
  const deps = setup({ callTool: async () => { throw Object.assign(new Error("Cancelled"), { name: "AbortError" }); } });
  assert.equal(await main(["--json", "session", "cancel", "script"], deps), 130);
  assert.equal(JSON.parse(deps.stdout.text).code, "INTERRUPTED");
  assert.equal(Object.hasOwn(JSON.parse(deps.stdout.text), "traces"), false);
});

test("browser selection is explicit and offline selections never fall back", async () => {
  const health = { features: { browserPairing: 1, scriptApiVersion: 1 }, status: {
    clients: [{ clientId: "alpha", name: "Alpha" }, { clientId: "beta", name: "Beta" }],
    browsers: [{ clientId: "alpha", name: "Alpha" }, { clientId: "beta", name: "Beta" }, { clientId: "offline", name: "Offline" }],
  } };
  for (const [selector, expected] of [[["--client", "Offline"], "CLIENT_OFFLINE"], [["--client", "missing"], "CLIENT_NOT_FOUND"]]) {
    const deps = setup({ findDaemon: async () => ({ ...running, health }), readHealth: async () => health,
      openConnectionBrowser: () => assert.fail("an explicit offline profile cannot launch another browser"),
      callTool: () => assert.fail("wrong browser is never called") });
    assert.equal(await main(["script", "--session", "s", ...selector, "--timeout", "0.03"], deps), 1);
    assert.deepEqual(Object.keys(JSON.parse(deps.stdout.text)).sort(), ["result", "traces"]);
    assert.deepEqual(JSON.parse(deps.stdout.text).traces, []);
    assert.equal(JSON.parse(deps.stdout.text).result.code, expected);
  }
  let executed = 0;
  const automatic = setup({ findDaemon: async () => ({ ...running, health }), callTool: async (_endpoint, name, args) => {
    if (name === "qingzhou_get_drive_session") {
      if (args.clientId === "alpha") return { sessionId: "s", title: "Task", status: "idle" };
      throw new QzError("DRIVE_SESSION_NOT_FOUND", "Not here.");
    }
    if (name === "qingzhou_get_session_snapshot") return { session: null };
    executed++; assert.equal(args.clientId, "alpha"); return success(7);
  } });
  assert.equal(await main(["script", "--session", "s"], automatic), 0);
  assert.equal(executed, 1);
  assert.deepEqual(JSON.parse(automatic.stdout.text), { traces: [], result: 7 });
  const deps = setup({ findDaemon: async () => ({ ...running, health }), callTool: async (_endpoint, _name, args) => {
    assert.equal(args.clientId, "alpha"); return success(7);
  } });
  assert.equal(await main(["script", "--session", "s", "--client", "Alpha"], deps), 0);
});

test("session lifecycle uses dedicated read routes and authoritative cancellation", async () => {
  for (const [argv, method, result] of [
    [["create", "--title", "Inspect page"], "qingzhou_create_drive_session", { sessionId: "s", title: "Inspect page", status: "idle" }],
    [["list"], "qingzhou_list_drive_sessions", { sessions: [] }],
    [["show", "s"], "qingzhou_get_drive_session", { sessionId: "s", title: "Inspect page", status: "idle" }],
    [["cancel", "s"], "qingzhou_stop_session", { sessionId: "s", status: "ended" }],
  ]) {
    let count = 0;
    const deps = setup({ callTool: async (_endpoint, name, args) => {
      count++; assert.equal(name, method);
      if (argv[0] === "show" || argv[0] === "cancel") assert.equal(args.sessionId, "s");
      return result;
    } });
    assert.equal(await main(["session", ...argv, "--json"], deps), 0);
    assert.equal(count, 1);
    assert.deepEqual(JSON.parse(deps.stdout.text).result, result);
  }
  const deps = setup({ callTool: async () => ({ sessionId: "s" }) });
  assert.equal(await main(["session", "create", "--title", "Inspect page"], deps), 0);
  assert.equal(deps.stdout.text, "sessionId s\n");
});

test("MCP image transport leaves business images and results intact", () => {
  const business = { images: [{ mimeType: "image/png", data: "YnVzaW5lc3M=" }],
    results: [{ id: "user", result: { images: [{ mimeType: "image/png", data: "dXNlcg==" }] } }] };
  const payload = { ...success(business), images: [{ mimeType: "image/png", data: "c2hvdA==" }] };
  const content = resultToContent(payload, { toolResult: true });
  assert.deepEqual(JSON.parse(content[0].text).result, business);
  assert.deepEqual(resultValue({ content }).result, business);
  const batch = { sessionId: "s", results: [{ id: "call", name: "run_script", isError: false, result: business,
    images: [{ mimeType: "image/png", data: "c2hvdA==" }] }] };
  const decoded = resultValue({ content: resultToContent(batch, { toolResult: true }) });
  assert.deepEqual(decoded.results[0].result, business);
  assert.equal(decoded.results[0].images[0].data, "c2hvdA==");
  assert.deepEqual(JSON.parse(resultToContent(business)[0].text), business);
});

test("explicit returned image sidechannels become paths without changing stdout", async t => {
  const deps = setup({ callTool: async () => ({ ...success({ imageId: "shot" }), traces: ["Screenshot saved."], images: [{ mimeType: "image/png", data: "c2hvdA==" }] }) });
  assert.equal(await main(["script", "--session", "s"], deps), 0);
  assert.deepEqual(JSON.parse(deps.stdout.text), { traces: ["Screenshot saved."], result: { imageId: "shot" } });
  const path = deps.stderr.text.trim().replace(/^Image: /, "");
  assert.equal(readFileSync(path, "utf8"), "shot");
  t.after(async () => { const { rm } = await import("node:fs/promises"); await rm(dirname(path), { recursive: true, force: true }); });
});

test("new session service routes preserve the producer response", async () => {
  for (const [name, method, args, result] of [
    ["qingzhou_list_drive_sessions", "list_drive_sessions", {}, { sessions: [{ sessionId: "s", title: "Task", status: "idle" }] }],
    ["qingzhou_get_drive_session", "get_drive_session", { sessionId: "s" }, { sessionId: "s", title: "Task", status: "idle" }],
  ]) {
    const state = { signal: signal => signal || new AbortController().signal,
      resolveClient: async () => ({ id: "browser", controller: new AbortController() }),
      callExtension: async (actual, params) => { assert.equal(actual, method); if (args.sessionId) assert.equal(params.sessionId, args.sessionId); return result; } };
    assert.deepEqual(await executeMcpTool(state, name, args), result);
  }
});


test("CLI script API preflight rejects old extensions before any execution", async () => {
  for (const version of [undefined, 0, 1, 2]) {
    const seen = [];
    const state = { signal: signal => signal || new AbortController().signal,
      resolveClient: async () => ({ id: "browser", controller: new AbortController() }),
      callExtension: async (method, params) => {
        seen.push(method);
        if (method === "capabilities") return version == null ? { protocolVersion: 1 } : { scriptApiVersion: version };
        assert.equal(Object.hasOwn(params, "scriptApiVersion"), false);
        return success(7);
      } };
    const request = executeMcpTool(state, "qingzhou_execute_tool", {
      sessionId: "s", name: "run_script", scriptApiVersion: 1, args: { code: "async () => 7" },
    });
    if (version == null || version < 1) {
      await assert.rejects(request, error => error.code === "UPGRADE_REQUIRED" && /No script was executed/.test(error.message));
      assert.deepEqual(seen, ["capabilities"]);
    } else {
      assert.deepEqual(await request, success(7));
      assert.deepEqual(seen, ["capabilities", "execute_tool"]);
    }
  }
});
