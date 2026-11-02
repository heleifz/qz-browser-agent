import assert from "node:assert/strict";
import test from "node:test";
import { createMcpRuntime } from "../../src/background/mcp/mcp-runtime.js";
import {
  createExternalDriveCoordinator,
  DRIVE_RESULT_CHAR_LIMIT,
  driveGroupTitle,
  isDriveToolDefault,
  parseDriveRequest,
  prepareDriveToolCall,
  projectDriveResult,
  projectNamedDriveResult,
  runDriveCalls,
} from "../../src/background/mcp/external-drive.js";
import { t } from "../../src/shared/i18n/backend.js";
import { withLanguage } from "../../src/shared/i18n/index.js";
import { createSessionSupervisor } from "../../src/background/session/supervisor.js";
import { createSessionRepository } from "../../src/background/session/repository.js";
import { createMemoryStorage } from "../support/memory-storage.mjs";

globalThis.chrome = { i18n: { getUILanguage: () => "zh-CN" } };

test("drive titles and request sentences stay on the existing tool", () => {
  assert.equal(driveGroupTitle("qz-cli"), "轻舟 · CLI");
  assert.equal(driveGroupTitle("Claude Code"), "轻舟 · Claude Code");
  assert.equal(driveGroupTitle("  pi\nnext  "), "轻舟 · pi next");
  assert.equal(driveGroupTitle(""), "轻舟 · MCP");
  assert.equal(driveGroupTitle("x".repeat(80)).length, "轻舟 · ".length + 40);

  withLanguage("zh-CN", () => {
    const both = parseDriveRequest({ name: "open_tab", calls: [{ id: "a", name: "open_tab", args: {} }] });
    assert.equal(both.ok, false);
    assert.equal(both.error.message, "请只传 name 或 calls 中的一个。");

    const shape = parseDriveRequest({ calls: [{ name: "open_tab" }] });
    assert.equal(shape.ok, false);
    assert.equal(shape.error.message, "calls 的每一项都要包含 id 和 name。请补全后再试。");

    const tooMany = parseDriveRequest({ calls: Array.from({ length: 11 }, (_, index) => ({ id: String(index), name: "list_tabs", args: {} })) });
    assert.equal(tooMany.ok, false);
    assert.equal(tooMany.error.message, "一批最多 10 个调用。请减少 calls 后再试。");

    const forbidden = parseDriveRequest({ name: "ask_llm", args: {} });
    assert.equal(forbidden.ok, false);
    assert.equal(forbidden.error.code, "DRIVE_TOOL_FORBIDDEN");
    assert.equal(forbidden.error.message, "不能通过直驱调用 ask_llm。");
    for (const name of [
      "delete_skill", "manage_bookmarks", "manage_skill_settings", "import_page_zip",
      "manage_goal", "example_echo", "plugin__manage_goal", "plugin__example_echo",
      "qingzhou_skill_author__create_skill", "qingzhou_skill_author__delete_skill", "mcp_browser", "qingzhou_x__mcp_remote",
    ]) {
      const blocked = parseDriveRequest({ name, args: {} });
      assert.equal(blocked.ok, false, name);
      assert.equal(blocked.error.code, "DRIVE_TOOL_FORBIDDEN", name);
    }

    assert.equal(parseDriveRequest({ name: "run_script", args: { target: "page", tabRef: "page", timeout: 1, code: "async () => 1" } }).mode, "single");
    assert.equal(parseDriveRequest({ name: "open_tab", args: { url: "https://example.com" } }).mode, "single");
    assert.equal(parseDriveRequest({ name: "document_fetch", args: {} }).mode, "single");
    assert.equal(parseDriveRequest({ name: "qingzhou_documents__document_fetch", args: {} }).mode, "single");
    assert.equal(parseDriveRequest({ name: "read_dom", args: {} }).mode, "single");
    assert.equal(parseDriveRequest({ name: "browse_history", args: {} }).mode, "single");
    assert.equal(parseDriveRequest({ name: "list_skills", args: {} }).mode, "single");
    const readBatch = parseDriveRequest({ calls: [{ id: "a", name: "read_dom", args: {} }] });
    assert.equal(readBatch.ok, true);
    assert.equal(readBatch.mode, "batch");
    assert.equal(t("drive.sessionOccupied"), "这个会话已有任务在用，不能直接操作。请换一个新的 sessionId。");
    assert.equal(t("drive.toolForbidden", { name: "ask_llm" }), "不能通过直驱调用 ask_llm。");
    assert.equal(t("drive.sendMessageRejected"), "这个会话由外部客户端直接操作，这里只能查看。");
  });
  withLanguage("en", () => {
    assert.equal(t("drive.sessionOccupied"), "This session already has a task, so it cannot be driven directly. Use a new sessionId.");
    assert.equal(t("drive.toolForbidden", { name: "ask_llm" }), "Direct drive cannot call ask_llm.");
    assert.equal(t("drive.sendMessageRejected"), "An external client is driving this session. This view is read-only.");
  });
});

test("direct-drive run_script stays on the page and script errors keep the engine text", () => {
  assert.equal(isDriveToolDefault("open_tab"), true);
  assert.equal(isDriveToolDefault("list_skills"), true);
  assert.equal(isDriveToolDefault("read_dom"), false);
  assert.equal(isDriveToolDefault("browse_history"), false);
  assert.equal(isDriveToolDefault("manage_goal"), false);
  assert.equal(isDriveToolDefault("run_script"), true);
  const page = prepareDriveToolCall("run_script", { tabRef: " page ", timeout: 5, code: "async () => 1" });
  assert.equal(page.ok, true);
  assert.equal(page.args.target, "page");
  assert.equal(page.args.tabRef, "page");
  const inner = prepareDriveToolCall("run_script", { target: "inner", tabRef: "page", timeout: 1, code: "async () => 1" });
  assert.equal(inner.ok, false);
  assert.equal(inner.error.code, "DRIVE_RUN_SCRIPT_TARGET");
  const missing = prepareDriveToolCall("run_script", { target: "page", timeout: 1, code: "async () => 1" });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "DRIVE_TAB_REF_REQUIRED");
  const other = prepareDriveToolCall("open_tab", { url: "https://example.com" });
  assert.equal(other.ok, true);
  const syntax = projectNamedDriveResult("run_script", { target: "page", tabRef: "page" }, {
    ok: false,
    code: "SCRIPT_SYNTAX_ERROR",
    error: "脚本语法错误，请检查引号、换行、括号或 return/await 的位置。",
    details: {
      originalError: "SyntaxError: Unexpected token",
      lineNumber: 2,
      columnNumber: 4,
      stack: "SyntaxError: Unexpected token\n    at page.js:2:4\n    at run",
    },
    __runScriptEnvelope: true,
  });
  assert.match(syntax.value.error, /SyntaxError: Unexpected token/);
  assert.match(syntax.value.error, /\(2:4\)/);
  assert.match(syntax.value.error, /page\.js:2:4/);
  assert.equal(syntax.value.line, 2);
  assert.equal(syntax.value.column, 4);
  assert.doesNotMatch(syntax.value.error, /^脚本执行失败/);
});

test("a calls batch rejects inner run_script before that call runs", async () => {
  const seen = [];
  const batch = await runDriveCalls([
    { id: "open", name: "open_tab", args: { url: "https://example.com" } },
    { id: "script", name: "run_script", args: { target: "inner", timeout: 1, code: "async () => 1" } },
  ], {
    signal: new AbortController().signal,
    execute: async (name) => {
      seen.push(name);
      return { id: 3 };
    },
  });
  assert.deepEqual(seen, ["open_tab"]);
  assert.equal(batch.results[0].result.tabRef, 3);
  assert.equal(batch.results[1].isError, true);
  assert.equal(batch.results[1].result.code, "DRIVE_RUN_SCRIPT_TARGET");
});

test("projection drops nodes and screenshot bytes", () => {
  const projected = projectDriveResult({
    snapshot: "tree",
    nodes: [{ id: 1 }],
    _display: { big: true },
    _image: "data:image/png;base64,aGk=",
  }, { projectResult: (result) => result });
  assert.equal(projected.value.snapshot, "tree");
  assert.equal(Object.hasOwn(projected.value, "nodes"), false);
  assert.equal(Object.hasOwn(projected.value, "_image"), false);
  assert.equal(Object.hasOwn(projected.value, "_display"), false);
  assert.deepEqual(projected.images, [{ mimeType: "image/png", data: "aGk=" }]);
});

test("named drive projection compacts scripts and this session's tabs, then caps the body", () => {
  const success = projectNamedDriveResult("run_script", { target: "inner" }, {
    ok: true,
    result: { title: "Ada" },
    trace: [{ name: "open_tab" }, { name: "fill" }],
    __runScriptEnvelope: true,
  });
  assert.deepEqual(success.value, { ok: true, result: { title: "Ada" } });
  assert.deepEqual(success.images, []);

  const traces = Array.from({ length: 7 }, (_, index) => ({ step: index }));
  const failure = projectNamedDriveResult("run_script", {}, {
    ok: false,
    code: "DRIVE_TOOL_FORBIDDEN",
    error: "blocked",
    diagnostic: "ask_llm",
    trace: traces,
    __runScriptEnvelope: true,
  });
  assert.equal(failure.value.ok, false);
  assert.equal(failure.value.code, "DRIVE_TOOL_FORBIDDEN");
  assert.equal(failure.value.diagnostic, "ask_llm");
  assert.deepEqual(failure.value.trace, traces.slice(-5));

  const tabs = projectNamedDriveResult("list_tabs", {}, [
    { id: 1, title: "owned", url: "https://a.example", ownedByCurrentTask: true, usable: true, rect: { x: 1 } },
    { id: 2, title: "other", url: "https://b.example", ownedByCurrentTask: false, usable: false },
  ], null, { aliases: { form: 1 } });
  assert.deepEqual(tabs.value, {
    tabs: [{ tabRef: 1, alias: "form", title: "owned", url: "https://a.example" }],
    count: 1,
    foreign: 1,
  });
  const escaped = projectNamedDriveResult("list_tabs", { scope: "all" }, [
    { id: 2, title: "other", url: "https://b.example", ownedByCurrentTask: false },
  ]);
  assert.ok(Array.isArray(escaped.value));
  assert.equal(escaped.value.length, 1);
  const unmarked = projectNamedDriveResult("list_tabs", {}, { ok: true, nodes: [1] });
  assert.deepEqual(unmarked.value, { ok: true, nodes: [1] });

  const huge = projectNamedDriveResult("read_dom", {}, { text: "x".repeat(DRIVE_RESULT_CHAR_LIMIT) });
  assert.equal(huge.value.truncated, true);
  assert.equal(huge.value.limitChars, DRIVE_RESULT_CHAR_LIMIT);
  assert.equal(huge.value.totalChars > DRIVE_RESULT_CHAR_LIMIT, true);
  assert.equal(huge.value.preview.length, DRIVE_RESULT_CHAR_LIMIT);
  assert.equal(String(huge.value.preview).startsWith('{"ok":true,"result":'), false);

  const hugeScript = projectNamedDriveResult("run_script", { target: "inner" }, {
    ok: true,
    result: { text: "y".repeat(DRIVE_RESULT_CHAR_LIMIT) },
    __runScriptEnvelope: true,
  });
  assert.equal(hugeScript.value.truncated, true);
  assert.equal(hugeScript.value.totalChars > DRIVE_RESULT_CHAR_LIMIT, true);
  assert.equal(String(hugeScript.value.preview).startsWith('{"ok":true,"result":'), false);
  assert.equal(String(hugeScript.value.preview).startsWith('{"text":'), true);

  const timedOut = projectNamedDriveResult("run_script", {}, {
    code: "TOOL_TIMEOUT",
    error: "run_script 执行超时。",
    status: "unconfirmed",
    trace: traces,
  });
  assert.equal(timedOut.value.ok, false);
  assert.equal(timedOut.value.code, "TOOL_TIMEOUT");
  assert.deepEqual(timedOut.value.trace, traces.slice(-5));
});

test("one calls batch reuses tab aliases and the existing scheduler", async () => {
  const seen = [];
  const commits = [];
  const settled = [];
  const batch = await runDriveCalls([
    { id: "open", name: "open_tab", args: { url: "https://example.com", tabAlias: "page" } },
    { id: "read", name: "get_ax_tree", args: { tabRef: "page" } },
  ], {
    signal: new AbortController().signal,
    execute: async (name, args) => {
      seen.push({ name, args });
      if (name === "open_tab") return { id: 11 };
      return { snapshot: "ok", nodes: [1], _image: "data:image/png;base64,YQ==" };
    },
    getBatchTabPolicy: (name) => name === "open_tab"
      ? { kind: "create", parallel: true }
      : { kind: "target", implicit: false, observation: true },
    commitToolResult: async (result) => { commits.push(result); },
    discardToolResult: async () => {},
    onSettled: call => settled.push({ id: call.id, name: call.name, images: call.images.length }),
  });
  assert.equal(seen[0].name, "open_tab");
  assert.equal(seen[1].args.tabId, 11);
  assert.equal(Object.hasOwn(seen[1].args, "tabRef"), false);
  assert.equal(batch.results[0].result.tabRef, 11);
  assert.equal(batch.results[1].result.snapshot, "ok");
  assert.equal(Object.hasOwn(batch.results[1].result, "nodes"), false);
  assert.equal(Object.hasOwn(batch, "images"), false);
  assert.deepEqual(batch.results[1].images, [{ mimeType: "image/png", data: "YQ==" }]);
  assert.equal(commits.length, 2);
  assert.deepEqual(settled, [
    { id: "open", name: "open_tab", images: 0 },
    { id: "read", name: "get_ax_tree", images: 1 },
  ]);
});

test("a batch refreshes the working tab before the next call and keeps the drive run", async () => {
  let workingTabId = 1;
  const seen = [];
  await runDriveCalls([
    { id: "open", name: "open_tab", args: { url: "https://example.com", tabAlias: "page" } },
    { id: "read", name: "get_ax_tree", args: { tabRef: "page" } },
  ], {
    signal: new AbortController().signal,
    context: { sessionId: "drive-1", runId: "drive-fixed", workingTabId: 1 },
    refreshContext: (context) => ({ ...context, workingTabId, runId: context.runId }),
    execute: async (name, _args, _signal, context) => {
      seen.push({ name, workingTabId: context.workingTabId, runId: context.runId });
      if (name === "open_tab") {
        workingTabId = 9;
        return { id: 9 };
      }
      return { snapshot: "tree" };
    },
    getBatchTabPolicy: (name) => name === "open_tab"
      ? { kind: "create", parallel: true }
      : { kind: "target", implicit: false, observation: true },
    commitToolResult: async () => {},
    discardToolResult: async () => {},
  });
  assert.deepEqual(seen.map(item => item.runId), ["drive-fixed", "drive-fixed"]);
  assert.deepEqual(seen.map(item => item.workingTabId), [1, 9]);
});

test("a second batch on the same session is rejected before another session is", () => {
  const drive = createExternalDriveCoordinator();
  withLanguage("zh-CN", () => {
    const lease = drive.begin("s");
    assert.throws(() => drive.begin("s"), (error) => error.code === "DRIVE_SESSION_BUSY"
      && error.message === "这个会话正在跑上一批。等它结束，或先停止该会话。");
    assert.doesNotThrow(() => drive.begin("other").release());
    lease.release();
    assert.doesNotThrow(() => drive.begin("s").release());
  });
});

test("an old drive release cannot clear a newer lease", () => {
  const drive = createExternalDriveCoordinator();
  const first = drive.begin("s");
  drive.noteStopped("s", { source: "user" });
  const second = drive.begin("s");
  first.release();
  assert.equal(drive.isBusy("s"), true);
  drive.noteStopped("s", { source: "drive_idle" });
  assert.equal(drive.isBusy("s"), true);
  second.release();
  assert.equal(drive.isBusy("s"), false);
});

test("a drive run id is current only until stop clears it", () => {
  const supervisor = createSessionSupervisor({
    createAgent: () => { throw new Error("no agent"); },
    logger: { warn() {}, error() {} },
  });
  const first = supervisor.mintDriveRunId("drive-session");
  assert.match(first, /^drive-/);
  assert.equal(supervisor.isRunCurrent("drive-session", first), true);
  assert.equal(supervisor.isRunCurrent("drive-session", ""), false);
  assert.equal(supervisor.isRunCurrent("drive-session", "run-permanent"), false);
  const taken = supervisor.takeDriveRunForRelease("drive-session");
  assert.equal(taken, first);
  assert.equal(supervisor.isRunCurrent("drive-session", first), true);
  const second = supervisor.mintDriveRunId("drive-session");
  assert.match(second, /^drive-/);
  assert.notEqual(second, first);
  assert.equal(supervisor.isRunCurrent("drive-session", second), true);
  supervisor.finishDriveRunRelease("drive-session", first);
  assert.equal(supervisor.isRunCurrent("drive-session", first), false);
  assert.equal(supervisor.isRunCurrent("drive-session", second), true);
  supervisor.clearDriveRunId("drive-session");
  assert.equal(supervisor.isRunCurrent("drive-session", second), false);
});

test("one external session is created only when metadata is missing", async () => {
  const metadata = { s1: { id: "s1", title: "Session" } };
  const stored = {};
  const executed = [];
  const created = [];
  let releaseOpen;
  const openGate = new Promise((resolve) => { releaseOpen = resolve; });
  let opened = 0;
  const driveRuns = new Map();
  const stops = [];
  stored.s1 = { runId: "agent-run", status: "running" };
  const sessions = {
    normalizeId: (value) => String(value || "").trim(),
    requireId(value, operation) {
      const id = String(value || "").trim();
      if (!id) throw new Error(`${operation} requires sessionId`);
      return id;
    },
    supervisor: {
      isRunCurrent: (sessionId, runId) => Boolean(runId) && driveRuns.get(sessionId) === runId,
      mintDriveRunId(sessionId) {
        if (!driveRuns.get(sessionId)) driveRuns.set(sessionId, `drive-${crypto.randomUUID()}`);
        return driveRuns.get(sessionId);
      },
      clearDriveRunId(sessionId) { driveRuns.set(sessionId, ""); },
      takeDriveRunForRelease(sessionId) {
        const current = driveRuns.get(sessionId) || "";
        driveRuns.set(sessionId, "");
        return current;
      },
      getUserWait: () => null,
      resolveUserWait: () => false,
      rejectUserWait: () => false,
    },
    submitMessage: async () => ({ promise: Promise.resolve(), disposition: "started" }),
    waitForRunObserved: async () => true,
    getRuntimeOutput: async (_id, project = (value) => value) => project({ status: "idle" }),
    getLiveAgentEntry: async () => null,
    setRuntime(id, patch) { stored[id] = { ...(stored[id] || {}), ...patch }; },
    getStoredRuntime: (id) => stored[id] || null,
    getLastMessages: async () => ({ messages: [] }),
    getAgent: async () => null,
    getTranscript: async () => [],
    listMetadata: async () => ({ ...metadata }),
    createMetadata: async (input) => {
      created.push(input);
      metadata[input.id] = { ...input };
      return metadata[input.id];
    },
    stop: async (id, meta) => { stops.push({ id, meta }); return { stopped: true }; },
    getConversation: async () => [],
    compactTranscriptEvent: (event) => event,
    getRuntime: () => ({ status: "idle", workingTabId: null }),
  };
  const runtime = createMcpRuntime({
    sessions,
    userInputPermissions: { hasBrowserPermission: async () => false, locationConsent: { isAccepted: async () => false, acceptExternal: async () => { throw new Error("not configured"); } } },
    tools: {
      ready: async () => {},
      canManageSessions: async () => true,
      buildRunProfile: async ({ sessionId }) => ({ sessionId }),
      loadedSkillNames: () => [],
      recordLoadedSkillNames: () => {},
      runtime: {
        getSchemas: () => [],
        async execute(name, args, _signal, context) {
          executed.push({ name, args, runId: context?.runId || "" });
          if (name === "open_tab") {
            opened += 1;
            await openGate;
            return { id: 4, url: args.url, snapshot: "page", nodes: [9], _display: { raw: true }, _image: "data:image/png;base64,YQ==" };
          }
          return { ok: true, nodes: [1] };
        },
        getModelPolicy: () => null,
        getBatchTabPolicy: () => null,
        getTabAliases: () => ({}),
      },
    },
    skills: { list: async () => [], load: async () => null, getDisplayName: (skill) => skill?.name || "", normalizeResourcePath: (value) => String(value || "") },
    artifacts: { empty: () => ({ total: 0, items: [] }), collect: async () => ({ total: 0, items: [] }) },
    trace: { get: async () => [] },
    async dispatchSidepanel() {},
  });

  const before = executed.length;
  await assert.rejects(
    runtime.executeTool({ sessionId: "s1", name: "open_tab", args: { url: "https://example.com" }, clientName: "pi" }),
    (error) => error.code === "DRIVE_SESSION_OCCUPIED"
      && error.message === "这个会话已有任务在用，不能直接操作。请换一个新的 sessionId。",
  );
  assert.equal(executed.length, before);
  await assert.rejects(
    runtime.executeTool({ sessionId: "s1", name: "read_dom", args: { selector: "main" } }),
    (error) => error.code === "DRIVE_SESSION_OCCUPIED" && executed.length === before,
  );
  await assert.rejects(
    runtime.executeTool({ sessionId: "s1", calls: [{ id: "dom", name: "read_dom", args: {} }] }),
    (error) => error.code === "DRIVE_SESSION_OCCUPIED" && executed.length === before,
  );
  assert.deepEqual(stored.s1, { runId: "agent-run", status: "running" });
  assert.equal(metadata.s1.title, "Session");
  assert.equal(metadata.s1.source, undefined);
  assert.equal(stops.length, 0);
  assert.equal(created.length, 0);

  const legacy = await runtime.executeTool({ name: "read_dom", args: { selector: "main" } });
  assert.equal(legacy.toolName, "read_dom");
  assert.deepEqual(legacy.result.nodes, [1]);
  assert.equal(created.length, 0);

  const first = runtime.executeTool({ sessionId: "drive-1", name: "open_tab", args: { url: "https://example.com" }, clientName: "pi" });
  await new Promise((resolve) => {
    const check = () => (opened ? resolve() : setTimeout(check, 0));
    check();
  });
  await assert.rejects(runtime.executeTool({ sessionId: "drive-1", name: "list_tabs", args: {} }), (error) => error.code === "DRIVE_SESSION_BUSY");
  await assert.rejects(runtime.executeTool({ sessionId: "drive-1", name: "read_dom", args: {} }), (error) => error.code === "DRIVE_SESSION_BUSY");
  const other = await runtime.executeTool({ sessionId: "drive-2", name: "list_tabs", args: {}, clientName: "Claude Code" });
  assert.equal(other.toolName, "list_tabs");
  releaseOpen();
  const openedResult = await first;
  assert.equal(openedResult.result.tabRef, 4);
  assert.equal(Object.hasOwn(openedResult.result, "nodes"), false);
  assert.equal(Object.hasOwn(openedResult.result, "_display"), false);
  assert.deepEqual(openedResult.images, [{ mimeType: "image/png", data: "YQ==" }]);
  assert.equal(metadata["drive-1"].source, "external-drive");
  assert.equal(metadata["drive-1"].title, "轻舟 · pi");
  assert.equal(metadata["drive-1"].driveGroupTitle, "轻舟 · pi");
  assert.equal(metadata["drive-2"].title, "轻舟 · Claude Code");
  assert.match(openedResult.runId, /^drive-/);
  assert.equal(created.length, 2);

  const readBack = await runtime.executeTool({ sessionId: "drive-1", name: "read_dom", args: {} });
  assert.deepEqual(readBack.result.nodes, [1]);
  assert.match(readBack.runId, /^drive-/);

  const fetched = await runtime.executeTool({ sessionId: "drive-docs", name: "document_fetch", args: { url: "https://example.com/a.pdf" } });
  assert.equal(metadata["drive-docs"].source, "external-drive");
  assert.match(fetched.runId, /^drive-/);
  assert.equal(executed.at(-1).name, "document_fetch");

  await assert.rejects(
    runtime.executeTool({ sessionId: "s1", calls: [{ id: "a", name: "document_fetch", args: {} }] }),
    (error) => error.code === "DRIVE_SESSION_OCCUPIED",
  );
  assert.equal(metadata.s1.source, undefined);
  assert.deepEqual(stored.s1, { runId: "agent-run", status: "running" });
  assert.equal(stops.length, 0);

  const sent = await runtime.sendMessage({ sessionId: "s1", text: "hello" });
  assert.equal(sent.accepted, true);

  runtime.drive.markHandoff("drive-1", 4);
  runtime.drive.markHandoff("drive-1", 8);
  assert.deepEqual(stored["drive-1"].driveHandoffTabIds, [4, 8]);
});

test("idle stop reaches an external drive session and leaves an occupied session alone", async () => {
  const metadata = { s1: { id: "s1", title: "Session", source: "" } };
  const stops = [];
  const driveRuns = new Map();
  const runtime = createMcpRuntime({
    driveIdleMs: 25,
    sessions: {
      normalizeId: (value) => String(value || "").trim(),
      requireId: (value) => String(value || "").trim(),
      supervisor: {
        isRunCurrent: (sessionId, runId) => Boolean(runId) && driveRuns.get(sessionId) === runId,
        mintDriveRunId(sessionId) {
          if (!driveRuns.get(sessionId)) driveRuns.set(sessionId, `drive-${crypto.randomUUID()}`);
          return driveRuns.get(sessionId);
        },
        clearDriveRunId(sessionId) { driveRuns.set(sessionId, ""); },
        takeDriveRunForRelease(sessionId) {
          const current = driveRuns.get(sessionId) || "";
          driveRuns.set(sessionId, "");
          return current;
        },
        getUserWait: () => null,
        resolveUserWait: () => false,
        rejectUserWait: () => false,
      },
      submitMessage: async () => ({ promise: Promise.resolve(), disposition: "started" }),
      waitForRunObserved: async () => true,
      getRuntimeOutput: async (_id, project = (value) => value) => project({ status: "idle" }),
      getLiveAgentEntry: async () => null,
      setRuntime() {},
      getStoredRuntime: () => null,
      getLastMessages: async () => ({ messages: [] }),
      getAgent: async () => null,
      getTranscript: async () => [],
      listMetadata: async () => ({ ...metadata }),
      createMetadata: async (input) => { metadata[input.id] = { ...input }; return metadata[input.id]; },
      stop: async (id, meta) => { stops.push({ id, meta }); return { stopped: true }; },
      getConversation: async () => [],
      compactTranscriptEvent: (event) => event,
      getRuntime: () => ({ status: "idle" }),
    },
    userInputPermissions: { hasBrowserPermission: async () => false, locationConsent: { isAccepted: async () => false, acceptExternal: async () => { throw new Error("not configured"); } } },
    tools: {
      ready: async () => {},
      canManageSessions: async () => true,
      buildRunProfile: async () => ({}),
      loadedSkillNames: () => [],
      recordLoadedSkillNames: () => {},
      runtime: {
        getSchemas: () => [],
        execute: async () => ({ ok: true }),
        getModelPolicy: () => null,
        getBatchTabPolicy: () => null,
        getTabAliases: () => ({}),
      },
    },
    skills: { list: async () => [], load: async () => null, getDisplayName: () => "", normalizeResourcePath: (value) => String(value || "") },
    artifacts: { empty: () => ({ total: 0, items: [] }), collect: async () => ({ total: 0, items: [] }) },
    trace: { get: async () => [] },
    async dispatchSidepanel() {},
  });
  await assert.rejects(runtime.executeTool({ sessionId: "s1", name: "list_tabs", args: {} }), (error) => error.code === "DRIVE_SESSION_OCCUPIED");
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(stops.length, 0);
  assert.equal(metadata.s1.source, "");
  await runtime.executeTool({ sessionId: "drive-idle", name: "list_tabs", args: {} });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(stops.length, 1);
  assert.equal(stops[0].id, "drive-idle");
  assert.equal(stops[0].meta.source, "drive_idle");
  assert.equal(stops[0].meta.keepTabs, false);
  assert.equal(metadata["drive-idle"].source, "external-drive");
  assert.equal(stops[0].meta.driveRunCaptured, true);
});

test("drive refresh keeps an empty runtime tab instead of the previous one", async () => {
  const stored = {
    "drive-clear": {
      workingTabId: 4,
      workingUrl: "https://old.example",
      workingTab: { id: 4, url: "https://old.example" },
      visitedTaskSites: [{ url: "https://old.example" }],
    },
  };
  const seen = [];
  const metadata = {};
  const driveRuns = new Map();
  const runtime = createMcpRuntime({
    sessions: {
      normalizeId: (value) => String(value || "").trim(),
      requireId: (value) => String(value || "").trim(),
      supervisor: {
        isRunCurrent: (sessionId, runId) => Boolean(runId) && driveRuns.get(sessionId) === runId,
        mintDriveRunId(sessionId) {
          if (!driveRuns.get(sessionId)) driveRuns.set(sessionId, `drive-${crypto.randomUUID()}`);
          return driveRuns.get(sessionId);
        },
        clearDriveRunId(sessionId) { driveRuns.set(sessionId, ""); },
        takeDriveRunForRelease(sessionId) {
          const current = driveRuns.get(sessionId) || "";
          driveRuns.set(sessionId, "");
          return current;
        },
        getUserWait: () => null,
        resolveUserWait: () => false,
        rejectUserWait: () => false,
      },
      submitMessage: async () => ({ promise: Promise.resolve(), disposition: "started" }),
      waitForRunObserved: async () => true,
      getRuntimeOutput: async (_id, project = (value) => value) => project({}),
      getLiveAgentEntry: async () => null,
      setRuntime() {},
      getStoredRuntime: (id) => stored[id] || null,
      getLastMessages: async () => ({ messages: [] }),
      getAgent: async () => null,
      getTranscript: async () => [],
      listMetadata: async () => ({ ...metadata }),
      createMetadata: async (input) => { metadata[input.id] = { ...input }; return metadata[input.id]; },
      stop: async () => ({ stopped: true }),
      getConversation: async () => [],
      compactTranscriptEvent: (event) => event,
      getRuntime: () => stored["drive-clear"],
    },
    userInputPermissions: { hasBrowserPermission: async () => false, locationConsent: { isAccepted: async () => false, acceptExternal: async () => { throw new Error("not configured"); } } },
    tools: {
      ready: async () => {},
      canManageSessions: async () => true,
      buildRunProfile: async ({ externalDrive }) => ({ externalDrive }),
      loadedSkillNames: () => [],
      recordLoadedSkillNames: () => {},
      runtime: {
        getSchemas: () => [],
        async execute(name, _args, _signal, context) {
          seen.push({
            name,
            workingTabId: context.workingTabId,
            pageUrl: context.dynamicContext.pageUrl,
            externalDrive: context.runProfile.externalDrive,
          });
          if (name === "open_tab") {
            stored["drive-clear"] = { workingTabId: null, workingUrl: "", workingTab: null, visitedTaskSites: [] };
            return { id: 9 };
          }
          return { ok: true };
        },
        getModelPolicy: () => null,
        getBatchTabPolicy: (name) => name === "open_tab"
          ? { kind: "create", parallel: true }
          : { kind: "target", implicit: false, observation: true },
        getTabAliases: () => ({}),
        async commitToolResult() {},
        async discardToolResult() {},
      },
    },
    skills: { list: async () => [], load: async () => null, getDisplayName: () => "", normalizeResourcePath: (value) => String(value || "") },
    artifacts: { empty: () => ({ total: 0, items: [] }), collect: async () => ({ total: 0, items: [] }) },
    trace: { get: async () => [] },
    async dispatchSidepanel() {},
  });
  const batch = await runtime.executeTool({
    sessionId: "drive-clear",
    calls: [
      { id: "open", name: "open_tab", args: { url: "https://example.com", tabAlias: "page" } },
      { id: "read", name: "list_tabs", args: { tabRef: "page" } },
    ],
  });
  assert.equal(batch.results[1].isError, false);
  assert.equal(seen[0].workingTabId, 4);
  assert.equal(seen[0].externalDrive, true);
  assert.equal(seen[1].workingTabId, null);
  assert.equal(seen[1].pageUrl, "");
});

test("a drive create does not take over an existing task", async () => {
  const repository = createSessionRepository({ storage: createMemoryStorage() });
  await repository.createMetadata({ id: "busy", title: "Busy" });
  await assert.rejects(
    repository.createMetadata({ id: "busy", title: "轻舟 · CLI", source: "external-drive", driveGroupTitle: "轻舟 · CLI" }),
    (error) => error.code === "DRIVE_SESSION_OCCUPIED"
      && error.message === "这个会话已有任务在用，不能直接操作。请换一个新的 sessionId。",
  );
  const stored = await repository.getMetadata("busy");
  assert.equal(stored.title, "Busy");
  assert.equal(stored.source, undefined);
  const created = await repository.createMetadata({
    id: "fresh", title: "轻舟 · CLI", source: "external-drive", driveGroupTitle: "轻舟 · CLI", titleSource: "fixed",
  });
  assert.equal(created.source, "external-drive");
  const again = await repository.createMetadata({ id: "fresh", title: "other", source: "external-drive" });
  assert.equal(again.title, "轻舟 · CLI");
  assert.equal(again.source, "external-drive");
});
