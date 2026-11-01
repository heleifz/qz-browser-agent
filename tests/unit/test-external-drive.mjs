import assert from "node:assert/strict";
import test from "node:test";
import { createMcpRuntime } from "../../src/background/mcp/mcp-runtime.js";
import {
  createExternalDriveCoordinator,
  driveGroupTitle,
  parseDriveRequest,
  projectDriveResult,
  runDriveCalls,
} from "../../src/background/mcp/external-drive.js";
import { t } from "../../src/shared/i18n/backend.js";
import { withLanguage } from "../../src/shared/i18n/index.js";
import { createSessionSupervisor } from "../../src/background/session/supervisor.js";

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
    assert.equal(forbidden.error.message, "不能通过直驱调用 ask_llm。请改用 open_tab、get_ax_tree 或 act_on_element。");

    assert.equal(parseDriveRequest({ name: "open_tab", args: { url: "https://example.com" } }).mode, "single");
    assert.equal(parseDriveRequest({ name: "document_fetch", args: {} }).mode, "single");
    assert.equal(parseDriveRequest({ name: "qingzhou_documents__document_fetch", args: {} }).mode, "single");
    assert.equal(parseDriveRequest({ name: "read_dom", args: {} }).mode, "legacy");
    assert.equal(parseDriveRequest({ name: "qingzhou_skill_author__create_skill", args: {} }).mode, "legacy");
    assert.equal(t("drive.sessionOccupied"), "这个会话已有任务在用，不能直接操作。请换一个新的 sessionId。");
  });
  withLanguage("en", () => {
    assert.equal(t("drive.sessionOccupied"), "This session already has a task, so it cannot be driven directly. Use a new sessionId.");
  });
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

test("one calls batch reuses tab aliases and the existing scheduler", async () => {
  const seen = [];
  const commits = [];
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
  });
  assert.equal(seen[0].name, "open_tab");
  assert.equal(seen[1].args.tabId, 11);
  assert.equal(Object.hasOwn(seen[1].args, "tabRef"), false);
  assert.equal(batch.results[0].result.id, 11);
  assert.equal(batch.results[1].result.snapshot, "ok");
  assert.equal(Object.hasOwn(batch.results[1].result, "nodes"), false);
  assert.equal(Object.hasOwn(batch, "images"), false);
  assert.deepEqual(batch.results[1].images, [{ mimeType: "image/png", data: "YQ==" }]);
  assert.equal(commits.length, 2);
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
  supervisor.clearDriveRunId("drive-session");
  assert.equal(supervisor.isRunCurrent("drive-session", first), false);
  const second = supervisor.mintDriveRunId("drive-session");
  assert.match(second, /^drive-/);
  assert.notEqual(second, first);
  assert.equal(supervisor.isRunCurrent("drive-session", second), true);
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
  assert.equal(openedResult.result.id, 4);
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

  await assert.rejects(runtime.sendMessage({ sessionId: "drive-1", text: "hello" }), (error) => error.code === "DRIVE_MODEL_DISABLED"
    && error.message === "这个会话由外部客户端直接操作。先停止该会话，再发送消息。");
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
});
