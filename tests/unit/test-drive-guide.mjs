import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { driveGuide, resetDriveGuideCache } from "../../services/mcp-bridge/src/drive-guide.mjs";
import { BridgeError } from "../../services/mcp-bridge/src/state.mjs";
import { driveExtensionTimeoutSeconds, executeMcpTool } from "../../services/mcp-bridge/src/tools.mjs";
import { buildScriptRequest, catalogExecRoute, presentScriptResult, scriptTimeouts } from "../../services/mcp-bridge/src/script-call.mjs";

const CHARS_PER_TOKEN = 23156 / 5700;

test("the packed drive guide is the only discoverable skill, English-only and bounded", () => {
  const source = readFileSync(new URL("../../skills/qz-browser-agent/SKILL.md", import.meta.url), "utf8");
  const mirror = readFileSync(new URL("../../services/mcp-bridge/src/qz-drive-SKILL.md", import.meta.url), "utf8");
  assert.equal(mirror, source);
  const skillDirs = readdirSync(new URL("../../skills", import.meta.url), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== "node_modules")
    .map(entry => entry.name);
  assert.deepEqual(skillDirs, ["qz-browser-agent"]);
  resetDriveGuideCache();
  const guide = driveGuide();
  for (const options of [
    { explicit: "en", env: {} }, { explicit: "zh-CN", env: {} },
    { env: { QZ_GUIDE_LANG: "zh-CN", LANG: "zh_CN.UTF-8" } },
  ]) assert.equal(driveGuide(options), guide, "the CLI guide is the same English reference for every locale");
  assert.doesNotMatch(source, /[\u3400-\u9fff]|qz-drive-guide:zh-CN/);
  assert.match(guide, /Do not (?:configure|start) a qz model/i);
  assert.match(guide, /https:\/\/example\.com/);
  assert.match(guide, /get_ax_tree/);
  assert.match(guide, /references\/create-task\.md/);
  assert.match(guide, /npx skills add alibaba\/qz-browser-agent -g/);
  assert.match(guide, /The side panel for a drive session is view-only\. Use browser tools for page content; use the shell for local files\./);
  assert.doesNotMatch(guide, /page\.click|selectOption|npx skills add[^\n]*qz-drive/);
  assert.doesNotMatch(source, /^name: qz-drive$/m);
  assert.doesNotMatch(guide, /omit tabRef|a returned id|\b(?:inner|tabId|workingTab|isWorkingTab|use_tab|get_working_tab|selector)\b/i);
  assert.match(guide, /Direct-drive results name the page with tabRef/);
  assert.match(guide, /Direct-drive run_script passes tabRef and runs in that tab/);
  assert.match(guide, /The script runs in the tab named by tabRef/);
  assert.doesNotMatch(guide, /target:"page"|target page|The first call creates a session/);
  assert.match(guide, /qz session create --title/);
  assert.match(guide, /scope is only viewport or full/);
  assert.match(guide, /Missing `--session` exits 2 and does not create or reuse a session/);
  assert.match(guide, /stdout prints `sessionId <id>`/);
  assert.match(guide, /A missing tabRef is DRIVE_TAB_REF_REQUIRED/);
  assert.match(guide, /only when an alias was passed/);
  assert.match(guide, /One task uses one session/);
  assert.match(guide, /tabAlias` is recommended for readability and is not required/);
  assert.match(guide, /Page tools always pass `tabRef`/);
  assert.match(guide, /The CLI does not resume the previous session/);
  const tokens = guide.length / CHARS_PER_TOKEN;
  assert.ok(guide.length > 1000 && tokens <= 5000, `${guide.length} chars is ${tokens} estimated tokens`);
});

test("the English CLI guide documents sessions, recovery, dependent PDF calls and result layers", () => {
  const guide = driveGuide();
  assert.doesNotMatch(guide, /qz (?:script|exec|tools)(?! --session)/);
  for (const value of ["npx --yes qz-browser-agent@latest", "CREATED=$(qz session create --title \"Inspect example page\" --json)",
    "DRIVE_SESSION_NOT_FOUND", "already_complete", "timedOut", "mutatesPage:true",
    "result.result.result", "qz cancel", "limits.timeoutSeconds",
    "qingzhou_documents__document_fetch", "qingzhou_documents__document_parse", "qingzhou_documents__document_read_chunk"]) {
    assert.ok(guide.includes(value), value);
  }
  assert.doesNotMatch(guide, /\bMCP\b|\bqz mcp\b|\bqingzhou_(?:guide|create_drive_session|execute_tool|list_tools|get_tool|bridge_status|stop_session)\b|keepTabs:true/i,
    "the direct-drive Skill teaches the CLI interface");
  assert.match(guide, /load_skill.*qingzhou-documents/);
  assert.match(guide, /regex/);
  assert.match(guide, /not a transaction/);
  assert.doesNotMatch(guide, /waits for the URL to change|When the client disconnects/);
});

test("MCP server instructions retain their explicit session and page-reference contract", () => {
  const bridgeTools = readFileSync(new URL("../../services/mcp-bridge/src/tools.mjs", import.meta.url), "utf8");
  const instructions = bridgeTools.slice(bridgeTools.indexOf("const DRIVE_INSTRUCTIONS"), bridgeTools.indexOf("export function mcpCatalogProfile"));
  assert.doesNotMatch(instructions, /不传 sessionId 时，这条 MCP 连接共用一个新 id|Without sessionId, this MCP connection keeps one new id/);
  assert.doesNotMatch(instructions, /返回的 id|a returned id/i);
  assert.doesNotMatch(instructions, /\binner\b/i);
  assert.doesNotMatch(instructions, /target page|第一次调用创建会话|The first call creates a session/);
  assert.match(instructions, /qz session create/);
  assert.match(instructions, /qingzhou_create_drive_session/);
  assert.match(instructions, /不会自动建会话/);
  assert.match(instructions, /does not create a session/);
  assert.match(instructions, /open_tab \/ list_tabs 返回的 tabRef/);
  assert.match(instructions, /the tabRef returned by open_tab or list_tabs/);
});

test("qz script runs on the page for one tabRef and prints only the returned value", () => {
  assert.throws(() => buildScriptRequest({ code: "return 1" }), /requires --tab/);
  assert.throws(() => buildScriptRequest({ code: "return 1", tabRef: "page" }), /requires --session/);
  assert.deepEqual(buildScriptRequest({ code: "return 1", sessionId: " s ", tabRef: " page " }), {
    name: "run_script",
    args: { target: "page", tabRef: "page", timeout: 120, code: "return 1" },
    sessionId: "s",
  });
  const ok = presentScriptResult({
    sessionId: "s",
    result: { ok: true, result: { title: "Ada" }, trace: [{ name: "open" }] },
  });
  assert.equal(ok.exitCode, 0);
  assert.equal(ok.text, "{\"title\":\"Ada\"}\n");
  assert.equal(ok.stderr, "sessionId s\n");
  const traces = [1, 2, 3, 4, 5, 6].map(step => ({ step }));
  const bad = presentScriptResult({
    result: { ok: false, code: "DRIVE_TOOL_FORBIDDEN", error: "blocked", trace: traces },
  });
  assert.equal(bad.exitCode, 1);
  assert.deepEqual(JSON.parse(bad.text), {
    code: "DRIVE_TOOL_FORBIDDEN",
    message: "blocked",
    details: { trace: traces.slice(-5) },
  });
  const truncated = { truncated: true, totalChars: 100000, limitChars: 48000, preview: "x".repeat(32) };
  const capped = presentScriptResult({ sessionId: "s", result: truncated });
  assert.equal(capped.exitCode, 0);
  assert.equal(capped.stderr, "sessionId s\n");
  assert.deepEqual(JSON.parse(capped.text), truncated);
  assert.deepEqual(scriptTimeouts({}), { scriptSeconds: 120, requestSeconds: 180 });
  assert.deepEqual(scriptTimeouts({ timeoutOption: "5", timeoutSeconds: 5 }), { scriptSeconds: 5, requestSeconds: 65 });
  assert.deepEqual(catalogExecRoute({ name: "list_tools" }), { tool: "qingzhou_list_tools", args: {} });
  assert.deepEqual(catalogExecRoute({ name: "get_tool", args: { name: "open_tab" }, sessionId: "s" }), {
    tool: "qingzhou_get_tool",
    args: { name: "open_tab", sessionId: "s" },
  });
  assert.equal(catalogExecRoute({ name: "capabilities" }).tool, "qingzhou_list_capabilities");
  assert.equal(catalogExecRoute({ calls: [{ id: "a", name: "list_tools" }] }), null);
  assert.equal(catalogExecRoute({ name: "open_tab" }), null);
});

function driveState(callExtension) {
  return {
    requestTimeoutSeconds: 180,
    signal: signal => signal || new AbortController().signal,
    resolveClient: async id => ({ id: id || "browser", controller: new AbortController() }),
    callExtension,
  };
}

test("a run_script request waits for the script plus 60 seconds and retries one busy session", async () => {
  assert.equal(driveExtensionTimeoutSeconds({
    name: "run_script",
    timeoutSeconds: 30,
    args: { timeout: 200 },
  }, 180), 260);
  assert.equal(driveExtensionTimeoutSeconds({
    calls: [{ name: "run_script", args: { timeout: 0 } }],
    timeoutSeconds: 30,
  }, 180), 86400);
  const seen = [];
  let attempts = 0;
  const busy = driveState(async (_method, params, options) => {
    attempts += 1;
    seen.push({ payloadTimeout: params.timeoutSeconds, wait: options.timeoutSeconds });
    if (attempts === 1) throw new BridgeError("DRIVE_SESSION_BUSY", "busy");
    return { ok: true };
  });
  await executeMcpTool(busy, "qingzhou_execute_tool", {
    name: "run_script",
    sessionId: "created",
    timeoutSeconds: 30,
    args: { tabRef: "page", timeout: 200, code: "async () => 1" },
  });
  assert.equal(attempts, 2);
  assert.equal(seen[0].payloadTimeout, 30);
  assert.equal(seen[0].wait, 260);
  assert.equal(seen[1].wait, 260);
  let occupied = 0;
  await assert.rejects(executeMcpTool(driveState(async () => {
    occupied += 1;
    throw new BridgeError("DRIVE_SESSION_OCCUPIED", "occupied");
  }), "qingzhou_execute_tool", { sessionId: "created", name: "list_tabs", args: {} }), error => error.code === "DRIVE_SESSION_OCCUPIED");
  assert.equal(occupied, 1);
});
