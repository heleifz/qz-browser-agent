import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { driveGuide, resetDriveGuideCache } from "../../services/mcp-bridge/src/drive-guide.mjs";
import { BridgeError } from "../../services/mcp-bridge/src/state.mjs";
import { driveExtensionTimeoutSeconds, executeMcpTool } from "../../services/mcp-bridge/src/tools.mjs";
import { buildScriptRequest, catalogExecRoute, presentScriptResult, scriptTimeouts } from "../../services/mcp-bridge/src/script-call.mjs";

const CHARS_PER_TOKEN = 23156 / 5700;

test("the packed drive guide is the qz-browser-agent skill, in one language, inside 3k–5k tokens", () => {
  const source = readFileSync(new URL("../../skills/qz-browser-agent/SKILL.md", import.meta.url), "utf8");
  const mirror = readFileSync(new URL("../../services/mcp-bridge/src/qz-drive-SKILL.md", import.meta.url), "utf8");
  assert.equal(mirror, source);
  const skillDirs = readdirSync(new URL("../../skills", import.meta.url), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== "node_modules")
    .map(entry => entry.name);
  assert.deepEqual(skillDirs, ["qz-browser-agent"]);
  resetDriveGuideCache();
  const zh = driveGuide({ explicit: "zh-CN", env: {} });
  const en = driveGuide({ explicit: "en", env: {} });
  assert.match(zh, /不要配置轻舟模型/);
  assert.match(en, /不要配置轻舟模型/);
  assert.match(zh, /https:\/\/example\.com/);
  assert.match(en, /https:\/\/example\.com/);
  assert.match(zh, /get_ax_tree/);
  assert.match(zh, /references\/create-task\.md/);
  assert.match(en, /references\/create-task\.md/);
  assert.match(zh, /npx skills add alibaba\/qz-browser-agent -g/);
  assert.match(en, /npx skills add alibaba\/qz-browser-agent -g/);
  assert.match(zh, /侧栏对直驱会话只查看。不要通过脚本绕过黑名单。/);
  assert.match(en, /The side panel for a drive session is view-only\. Do not route around the blacklist from a script\./);
  assert.doesNotMatch(zh, /page\.click|selectOption/);
  assert.doesNotMatch(en, /page\.click|selectOption/);
  assert.doesNotMatch(zh, /npx skills add[^\n]*qz-drive/);
  assert.doesNotMatch(en, /npx skills add[^\n]*qz-drive/);
  assert.doesNotMatch(source, /^name: qz-drive$/m);
  assert.doesNotMatch(source, /省略 tabRef|omit tabRef/i);
  assert.doesNotMatch(source, /不传 sessionId 时，这条 MCP 连接共用一个新 id|Without sessionId, this MCP connection keeps one new id/);
  assert.doesNotMatch(source, /返回的 id|a returned id/i);
  assert.doesNotMatch(source, /\binner\b/i);
  assert.doesNotMatch(source, /tabId/);
  assert.match(zh, /直驱结果用 tabRef 标识页面/);
  assert.match(en, /Direct-drive results name the page with tabRef/);
  assert.match(zh, /直驱的 run_script 在该页执行，并带 tabRef/);
  assert.match(zh, /直驱脚本只在 tabRef 所指的标签页里运行/);
  assert.match(en, /Direct-drive run_script passes tabRef and runs in that tab/);
  assert.match(en, /The script runs in the tab named by tabRef/);
  assert.doesNotMatch(source, /target:"page"|target page|第一次调用创建会话|The first call creates a session/);
  assert.match(zh, /qz session create/);
  assert.match(en, /qz session create/);
  assert.match(zh, /scope 只能是 viewport 或 full/);
  assert.match(en, /scope is only viewport or full/);
  assert.match(zh, /漏掉 `--session` 退出码 2/);
  assert.match(en, /Missing `--session` exits 2 and does not create or reuse a session/);
  const bridgeTools = readFileSync(new URL("../../services/mcp-bridge/src/tools.mjs", import.meta.url), "utf8");
  const instructions = bridgeTools.slice(bridgeTools.indexOf("const DRIVE_INSTRUCTIONS"), bridgeTools.indexOf("export function driveExtensionTimeoutSeconds"));
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
  assert.match(zh, /一个任务一个会话/);
  assert.match(zh, /先 `qz session create`，stdout 打出 `sessionId <id>`/);
  assert.doesNotMatch(zh, /第一次调用创建会话/);
  assert.match(zh, /没传 tabRef 时，错误码只是 DRIVE_TAB_REF_REQUIRED/);
  assert.match(zh, /no_alias 只在已经传入别名/);
  assert.match(en, /stdout prints `sessionId <id>`/);
  assert.doesNotMatch(en, /The first call creates a session/);
  assert.match(en, /A missing tabRef is only DRIVE_TAB_REF_REQUIRED/);
  assert.match(en, /only when an alias was passed/);
  assert.match(zh, /tabAlias 建议写上，便于阅读，但不是必填/);
  assert.match(zh, /页面工具始终传 `tabRef`/);
  assert.match(en, /One task uses one session/);
  assert.match(en, /tabAlias` is recommended for readability and is not required/);
  assert.match(en, /Page tools always pass `tabRef`/);
  assert.match(en, /The CLI does not resume the previous session/);
  for (const text of [zh, en]) {
    const tokens = text.length / CHARS_PER_TOKEN;
    assert.ok(tokens >= 3000 && tokens <= 5000, `${text.length} chars is ${tokens} tokens`);
  }
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
    error: "blocked",
    trace: traces.slice(-5),
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
    timeoutSeconds: 30,
    args: { target: "page", tabRef: "page", timeout: 200, code: "async () => 1" },
  });
  assert.equal(attempts, 2);
  assert.equal(seen[0].payloadTimeout, 30);
  assert.equal(seen[0].wait, 260);
  assert.equal(seen[1].wait, 260);
  let occupied = 0;
  await assert.rejects(executeMcpTool(driveState(async () => {
    occupied += 1;
    throw new BridgeError("DRIVE_SESSION_OCCUPIED", "occupied");
  }), "qingzhou_execute_tool", { name: "list_tabs", args: {} }), error => error.code === "DRIVE_SESSION_OCCUPIED");
  assert.equal(occupied, 1);
});
