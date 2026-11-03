#!/usr/bin/env node
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { GUIDE_URL, INSTALL_URL, QzError, withToolClient, readHealth } from "./client.mjs";
import { ensureDaemon, findDaemon, stopDaemon } from "./daemon.mjs";
import { openBrowser } from "./open-browser.mjs";
import { parseCommand } from "./args.mjs";
import { EXEC_JSON_MESSAGE } from "./commands.mjs";
import { renderError, renderHelp, renderResult, renderInputNotice, sanitizeTerminalText } from "./terminal.mjs";
import { TASK_NOT_FOUND_MESSAGE, waitForTask } from "./task-stream.mjs";
import { createLiveOutput, outputMode } from "./output.mjs";
import { resourceRequest, settingsPatch } from "./cli-resources.mjs";
import { PACKAGE_NAME, PACKAGE_VERSION } from "./package-info.mjs";
import { optionTerminator, shellArgument } from "./shell.mjs";
import { driveGuide } from "./drive-guide.mjs";
import { buildScriptRequest, catalogExecRoute, presentScriptResult, scriptTimeouts } from "./script-call.mjs";
import { driveExtensionTimeoutSeconds } from "./drive-timeout.mjs";

export const HELP = renderHelp();

async function stdinText({ signal } = {}) {
  signal?.throwIfAborted();
  const input = process.stdin;
  if (input.readableEnded) return "";
  return new Promise((resolve, reject) => {
    const chunks = [];
    const cleanup = () => {
      input.removeListener("data", data);
      input.removeListener("end", end);
      input.removeListener("error", fail);
      signal?.removeEventListener("abort", abort);
      input.pause();
    };
    const data = chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const end = () => { cleanup(); resolve(Buffer.concat(chunks).toString("utf8")); };
    const fail = error => { cleanup(); reject(error); };
    const abort = () => fail(signal.reason);
    input.on("data", data);
    input.once("end", end);
    input.once("error", fail);
    signal?.addEventListener("abort", abort, { once: true });
    input.resume();
  });
}

const UPGRADE_HINT = "Use the latest CLI. After current tasks finish, run npx --yes qz-browser-agent@latest stop (disconnects all browsers), update and reload the qz extension, then run npx --yes qz-browser-agent@latest connect.";

function requirePairingSupport(health) {
  if (health?.features?.browserPairing !== 1) throw new QzError("UPGRADE_REQUIRED",
    "This qz service is unsupported. Upgrade the CLI and extension, then run qz stop and qz connect.",
    { hint: UPGRADE_HINT });
}

function selectClient(health, selector = "", { allowEmpty = false } = {}) {
  const clients = health.status?.clients || [];
  if (selector) {
    const entry = (health.status?.browsers || []).find(client => client.clientId === selector || client.name === selector);
    const selected = clients.find(client => client.clientId === (entry?.clientId || selector));
    if (selected) return selected.clientId;
    throw new QzError(entry ? "CLIENT_OFFLINE" : "CLIENT_NOT_FOUND", `Browser ${selector} is ${entry ? "offline" : "not registered"}.`,
      { hint: "Run qz browsers to inspect names and UUIDs. Reconnect that profile from its extension settings." });
  }
  if (clients.length > 1) throw new QzError("SELECTION_REQUIRED", "Multiple browsers are connected. Select one with --client NAME|UUID.",
    { clients: clients.map(({ clientId, name }) => ({ clientId, name })), hint: clients.map(client => `${client.name || client.clientId}: ${client.clientId}`).join("\n") });
  if (clients.length === 1) return clients[0].clientId;
  if (allowEmpty) return "";
  throw connectionRequired();
}

function connectionRequired() {
  return new QzError("NOT_CONNECTED", "Run qz connect to start the local service and connect Chrome. If qz is not installed, run qz install.");
}

function resolveExecClient(health, optionSelector = "", payload = null) {
  const payloadSelector = String(payload && typeof payload === "object" && !Array.isArray(payload) ? payload.clientId || "" : "").trim();
  const optionId = optionSelector ? selectClient(health, optionSelector) : "";
  const payloadId = payloadSelector ? selectClient(health, payloadSelector) : "";
  if (optionId && payloadId && optionId !== payloadId) {
    throw new QzError("CLIENT_CONFLICT", "The --client option and clientId select different browsers.");
  }
  return optionId || payloadId || selectClient(health, "");
}

function parseExecPayload(source) {
  let value;
  try { value = JSON.parse(source); }
  catch { throw new QzError("INVALID_ARGUMENTS", EXEC_JSON_MESSAGE); }
  if (!value || Array.isArray(value) || typeof value !== "object") throw new QzError("INVALID_ARGUMENTS", EXEC_JSON_MESSAGE);
  return value;
}

async function readExecStdin(dependencies) {
  const stdin = dependencies.stdin || process.stdin;
  if (stdin.isTTY) throw new QzError("INVALID_ARGUMENTS", EXEC_JSON_MESSAGE);
  return (dependencies.readStdin || stdinText)({ signal: dependencies.signal });
}

function imageFilePaths(images, directory, prefix) {
  const files = (Array.isArray(images) ? images : []).filter(image => image && typeof image.data === "string");
  if (!files.length) return null;
  return files.map((image, index) => {
    const extension = image.mimeType === "image/jpeg" ? "jpg" : image.mimeType === "image/webp" ? "webp" : "png";
    const path = join(directory, `${prefix}${index}.${extension}`);
    writeFileSync(path, Buffer.from(image.data, "base64"));
    return path;
  });
}

export function materializeExecImages(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const nested = Array.isArray(result.results) && result.results.some(item => Array.isArray(item?.images) && item.images.some(image => typeof image?.data === "string"));
  const topLevel = Array.isArray(result.images) && result.images.some(image => typeof image?.data === "string");
  if (!nested && !topLevel) return result;
  const directory = mkdtempSync(join(tmpdir(), "qz-exec-"));
  const images = imageFilePaths(result.images, directory, "");
  const results = Array.isArray(result.results)
    ? result.results.map((item, index) => {
      if (!item || typeof item !== "object" || !Array.isArray(item.images)) return item;
      const paths = imageFilePaths(item.images, directory, `${index}-`);
      return paths ? { ...item, images: paths } : item;
    })
    : result.results;
  return {
    ...result,
    ...(images ? { images } : {}),
    ...(Array.isArray(result.results) ? { results } : {}),
  };
}

function execFailed(result) {
  if (!result || typeof result !== "object") return false;
  if (result.isError === true || result.ok === false || (typeof result.code === "string" && typeof result.message === "string")) return true;
  if (Array.isArray(result.results) && result.results.some(item => item?.isError === true || item?.ok === false)) return true;
  const inner = result.result;
  if (inner && typeof inner === "object") {
    if (typeof inner.code === "string" && typeof inner.message === "string") return true;
    if (inner.isError === true || inner.ok === false) return true;
  }
  return false;
}

function recoveryCommand(command, sessionId, clientId, stream = false) {
  if (sanitizeTerminalText(sessionId) !== String(sessionId)) sessionId = "TASK_ID";
  if (clientId && sanitizeTerminalText(clientId) !== String(clientId)) clientId = "CLIENT_ID";
  const client = clientId ? ` --client${String(clientId).startsWith("-") ? "=" : " "}${shellArgument(clientId)}` : "";
  const options = `${client}${stream ? " --stream" : ""}`;
  if (!sessionId) return `qz ${command}${options}`;
  return String(sessionId).startsWith("-")
    ? `qz ${command}${options} ${optionTerminator()} ${shellArgument(sessionId)}`
    : `qz ${command} ${shellArgument(sessionId)}${options}`;
}

function missingTaskDetails(sessionId, clientId) {
  return { sessionId, ...(clientId ? { clientId } : {}),
    hint: "Check the task ID and selected browser. Run qz browsers to inspect browser names and UUIDs. List tasks in the selected browser:",
    command: recoveryCommand("tasks", "", clientId) };
}

export async function runCli(argv, dependencies = {}) {
  return executeCommand(parseCommand(argv), dependencies);
}

async function executeCommand(parsed, dependencies) {
  if (parsed.command === "version") return parsed.options.json
    ? { result: { name: PACKAGE_NAME, version: PACKAGE_VERSION } }
    : { text: `qz ${PACKAGE_VERSION}\n` };
  return withToolClient(async callTool => {
    const returned = await dispatchCommand(parsed, { ...dependencies, callTool: dependencies.callTool || callTool });
    const clientId = parsed.presentation?.clientId;
    return clientId && returned.result && typeof returned.result === "object" && !Array.isArray(returned.result)
      ? { ...returned, result: { ...returned.result, clientId } } : returned;
  });
}

async function dispatchCommand(parsed, dependencies) {
  const { command, action, id, options = {}, timeoutSeconds, waitTimeoutSeconds } = parsed;
  if (command === "help") return { text: renderHelp(parsed.helpTopic) };
  dependencies.signal?.throwIfAborted();
  const open = dependencies.openBrowser || openBrowser;
  const find = dependencies.findDaemon || findDaemon;
  const healthReader = dependencies.readHealth || readHealth;
  if (command === "install") return { result: await open(INSTALL_URL) };
  if (command === "stop") return { result: await (dependencies.stopDaemon || stopDaemon)() };
  if (command === "connect") {
    const running = await (dependencies.ensureDaemon || ensureDaemon)(options.port === undefined ? {} : { preferredPort: options.port });
    requirePairingSupport(running.health);
    if (options.port !== undefined && Number(new URL(running.endpoint).port) !== options.port) throw new QzError("PORT_MISMATCH",
      `The local service is already running at ${running.endpoint}.`, { endpoint: running.endpoint,
        hint: "Use its current address, or run qz stop before connecting on a different port." });
    const bindingUrl = new URL("/qz-connect", running.endpoint);
    if (options.name !== undefined) bindingUrl.searchParams.set("name", options.name);
    const connectUrl = bindingUrl.href;
    if (options["no-open"] || options.name !== undefined) {
      dependencies.signal?.throwIfAborted();
      const opened = options["no-open"] ? false : Boolean((await open(connectUrl))?.opened);
      return { result: { endpoint: running.endpoint, url: connectUrl, mcpUrl: `${running.endpoint}/mcp`, opened } };
    }
    const deadline = Date.now() + timeoutSeconds * 1000;
    let selected = selectClient(running.health, options["client-id"], { allowEmpty: true });
    const probe = async health => {
      const chosen = selected || selectClient(health, "", { allowEmpty: true });
      const clients = (health?.status?.clients || []).filter(client => client.clientId === chosen);
      for (const client of clients) {
        dependencies.signal?.throwIfAborted();
        const timeoutMs = Math.min(2000, deadline - Date.now());
        if (timeoutMs <= 0) return false;
        const timeout = AbortSignal.timeout(timeoutMs);
        try {
          // A lease can outlive a stopped poller. Confirm a real extension round trip.
          await dependencies.callTool(running.endpoint, "qingzhou_call", {
            method: "ping", clientId: client.clientId, timeoutSeconds: timeoutMs / 1000,
          }, { timeoutMs, signal: dependencies.signal ? AbortSignal.any([dependencies.signal, timeout]) : timeout });
          selected = client.clientId;
          return true;
        } catch (error) {
          dependencies.signal?.throwIfAborted();
          if (error.code === "CONNECTION_ERROR" || (!timeout.aborted
            && !["BRIDGE_NOT_CONNECTED", "BRIDGE_CLIENT_OFFLINE", "BRIDGE_CLIENT_DISCONNECTED", "BRIDGE_REQUEST_TIMEOUT", -32001].includes(error.code))) throw error;
        }
      }
      return false;
    };
    const result = health => ({ result: { connected: true, mcpUrl: `${running.endpoint}/mcp`, clients: health.status.clients, clientId: selected } });
    if (await probe(running.health)) return result(running.health);
    if (options["client-id"]) throw new QzError("CLIENT_OFFLINE", "The selected browser is not responding. Reconnect it from its extension settings.");
    dependencies.signal?.throwIfAborted();
    await open(connectUrl);
    while (Date.now() < deadline) {
      dependencies.signal?.throwIfAborted();
      const health = await healthReader(running.endpoint).catch(() => null);
      if (health && health.instanceId !== running.instanceId) throw new QzError("CONNECTION_CHANGED", "The local service changed. Run qz connect again.", { url: connectUrl });
      if (health && await probe(health)) return result(health);
      await delay(200, undefined, { signal: dependencies.signal });
    }
    throw new QzError("CONNECTION_PENDING", "qz is waiting for Chrome. Open the connection URL in the Chrome profile with qz installed and confirm the connection in qz. Then run qz connect again.", { url: connectUrl });
  }
  // Validate JSON before connecting; malformed arguments cannot cause browser actions.
  let scriptCode = "";
  if (command === "script") {
    if (options.file && options.file !== "-") {
      try { scriptCode = readFileSync(options.file, "utf8"); }
      catch { throw new QzError("INVALID_ARGUMENTS", `Could not read ${options.file}. Use qz script --session ID --tab TABREF [FILE|-].`); }
    } else {
      scriptCode = await (dependencies.readStdin || stdinText)({ signal: dependencies.signal });
    }
    if (!String(scriptCode).trim()) throw new QzError("INVALID_ARGUMENTS", "The script is empty. Use qz script --session ID --tab TABREF [FILE|-].");
  }
  let execPayload = null;
  if (command === "exec") {
    if (options.payloadError) throw new QzError("INVALID_ARGUMENTS", options.payloadError);
    const source = options.payload === "-" || options.payload == null
      ? await readExecStdin(dependencies)
      : options.payload;
    execPayload = parseExecPayload(source);
  }
  let args = {};
  if (command === "submit" || (command === "settings" && action === "set" && id === undefined)) {
    const source = options.args === "-" ? await (dependencies.readStdin || stdinText)({ signal: dependencies.signal }) : options.args ?? "{}";
    try { args = JSON.parse(source); }
    catch { throw new QzError("INVALID_ARGUMENTS", "Pass a JSON object, or - to read one from stdin."); }
    if (!args || Array.isArray(args) || typeof args !== "object") throw new QzError("INVALID_ARGUMENTS", `${command === "submit" ? "Answers" : "Settings"} must be a JSON object.`);
  }
  let config;
  if (command === "settings" && action === "set") config = settingsPatch(id, options.value, args);
  let prompt = options.prompt || "";
  if (((command === "tasks" && action === "create") || command === "send") && prompt === "-") {
    prompt = await (dependencies.readStdin || stdinText)({ signal: dependencies.signal });
    if (!prompt.trim()) throw new QzError("INVALID_ARGUMENTS", "The prompt read from stdin is empty.");
  }
  dependencies.signal?.throwIfAborted();
  const resource = resourceRequest(parsed, config);
  const running = await find();
  if (command === "status") return { result: running ? { running: true, endpoint: running.endpoint, updateAvailable: running.updateAvailable === true, ...(running.health.features?.browserPairing === 1 ? {} : { updateRequired: true, hint: UPGRADE_HINT }), ...running.health.status } : { running: false, connected: false } };
  if (!running) throw connectionRequired();
  if (command === "mcp") {
    const url = new URL("/mcp", running.endpoint);
    if (options.profile) url.searchParams.set("profile", options.profile);
    return options.json ? { result: { url: url.href } } : { text: `${url.href}\n` };
  }
  const call = dependencies.callTool;
  requirePairingSupport(running.health);
  if (command === "browsers") {
    if (action === "list") return { result: running.health.status };
    const browser = running.health.status?.browsers?.find(browser => browser.clientId === id || browser.name === id);
    if (!browser) throw new QzError("CLIENT_NOT_FOUND", `No registered browser named ${id}. Run qz browsers to inspect names and UUIDs.`);
    return { result: await call(running.endpoint, "qingzhou_forget_browser", { clientId: browser.clientId }, { timeoutMs: timeoutSeconds * 1000, signal: dependencies.signal }) };
  }
  // Resolve names once. Every subsequent operation carries this profile UUID.
  const clientId = command === "exec"
    ? resolveExecClient(running.health, options["client-id"], execPayload)
    : selectClient(running.health, options["client-id"]);
  parsed.presentation = { ...parsed.presentation, clientId };
  options["client-id"] = clientId;
  const common = { timeoutSeconds, ...(clientId ? { clientId } : {}) };
  const requestOptions = { timeoutMs: timeoutSeconds * 1000, signal: dependencies.signal };
  if (command === "exec") {
    const flaggedSession = String(options.session || "").trim();
    const payloadSession = String(execPayload.sessionId || "").trim();
    if (payloadSession && flaggedSession && payloadSession !== flaggedSession) {
      throw new QzError("INVALID_ARGUMENTS", "The --session option and sessionId select different sessions. Pass one id from qz session create.");
    }
    const route = catalogExecRoute(execPayload);
    if (route) {
      const sessionId = String(route.args.sessionId || flaggedSession).trim();
      if (sessionId !== flaggedSession) {
        throw new QzError("INVALID_ARGUMENTS", "The --session option and args.sessionId select different sessions. Pass one id from qz session create.");
      }
      const bindsSession = route.tool === "qingzhou_list_tools" || route.tool === "qingzhou_get_tool";
      const result = await call(running.endpoint, route.tool, {
        ...route.args,
        ...(bindsSession && sessionId ? { sessionId } : {}),
        ...common,
      }, requestOptions);
      return { result, exitCode: 0 };
    }
    const session = flaggedSession && !execPayload.sessionId ? { sessionId: flaggedSession } : {};
    const params = { ...execPayload, ...session, ...common };
    const requestSeconds = driveExtensionTimeoutSeconds(params, timeoutSeconds);
    const result = await call(running.endpoint, "qingzhou_execute_tool", params, {
      ...requestOptions, timeoutMs: requestSeconds * 1000,
    });
    const failed = execFailed(result);
    return { result: materializeExecImages(result), exitCode: failed ? 1 : 0 };
  }
  if (command === "script") {
    const budgets = scriptTimeouts({ timeoutOption: options.timeout, timeoutSeconds });
    const request = buildScriptRequest({ code: scriptCode, timeoutSeconds: budgets.scriptSeconds, sessionId: options.session, tabRef: options.tab });
    const result = await call(running.endpoint, "qingzhou_execute_tool", { ...request, ...common, timeoutSeconds: budgets.requestSeconds }, {
      ...requestOptions,
      timeoutMs: budgets.requestSeconds * 1000,
    });
    return presentScriptResult(result);
  }
  if (command === "tools") {
    const session = options.session ? { sessionId: options.session } : {};
    if (id) {
      const tool = await call(running.endpoint, "qingzhou_get_tool", { ...common, ...session, name: id }, requestOptions);
      if (options.json) return { result: tool };
      const signature = tool?.signature || tool?.name || id;
      return { text: tool?.description ? `${signature}\n${tool.description}\n` : `${signature}\n` };
    }
    const listed = await call(running.endpoint, "qingzhou_list_tools", { ...common, ...session }, requestOptions);
    if (options.json) return { result: listed };
    const lines = (Array.isArray(listed?.tools) ? listed.tools : []).map(tool => tool.signature || tool.name);
    return { text: `${lines.join("\n")}\n` };
  }
  const startedAt = Date.now();
  const readSnapshot = async (sessionId, seconds, signal) => {
    try {
      return await call(running.endpoint, "qingzhou_get_session_snapshot", {
        ...common, sessionId, timeoutSeconds: seconds, compact: false, tail: false, includeArtifacts: false,
      }, { timeoutMs: seconds * 1000, signal });
    } catch (error) {
      signal?.throwIfAborted();
      if (error.name === "TimeoutError" || error.code === -32001 || error.code === "TIMEOUT" || error.code === "BRIDGE_REQUEST_TIMEOUT"
        || (error.code === "TOOL_ERROR" && /BRIDGE_REQUEST_TIMEOUT/.test(error.message))) {
        throw new QzError("REQUEST_TIMEOUT", "Reading the task status timed out. The browser task may still be running.");
      }
      throw error;
    }
  };
  const observe = async (sessionId, { runId = "", expectedMessageId = "", messageWasQueued = false, ignoreWaitId = "", allowIdle = false } = {}) => {
    try {
      const remaining = waitTimeoutSeconds == null ? null : waitTimeoutSeconds - (Date.now() - startedAt) / 1000;
      if (remaining !== null && remaining <= 0) throw new DOMException("Stopped watching after the configured --timeout. The browser task may still be running.", "TimeoutError");
      return await waitForTask({
        sessionId, clientId: common.clientId, timeoutSeconds: remaining, signal: dependencies.signal,
        requestTimeoutSeconds: timeoutSeconds,
        expectedRunId: runId, expectedMessageId, messageWasQueued, ignoreWaitId, allowIdle,
        onUpdate: dependencies.onTaskUpdate,
        getSnapshot: ({ timeoutSeconds: seconds, signal }) => readSnapshot(sessionId, seconds, signal),
      });
    } catch (error) {
      const code = error.name === "TimeoutError" ? "TIMEOUT" : error.name === "AbortError" ? "INTERRUPTED" : error.code || "TASK_WAIT_FAILED";
      if (code === "TASK_DELETED") throw new QzError(code, error.message, { ...error.details, ...missingTaskDetails(sessionId, clientId) });
      const changed = code === "TASK_CHANGED";
      throw new QzError(code, code === "TIMEOUT"
        ? "Stopped watching after the configured --timeout. The browser task may still be running." : error.message,
      { ...error.details, sessionId, ...(clientId ? { clientId } : {}), hint: changed ? "Inspect the task conversation before sending another message:" : "Continue watching the same task:",
        command: recoveryCommand(changed ? "show" : "watch", sessionId, clientId, !changed) });
    }
  };
  if (command === "watch") return { result: { sessionId: id, snapshot: await observe(id, { allowIdle: true }) } };
  if (command === "send") {
    let result = await call(running.endpoint, "qingzhou_send_message", {
      ...common, sessionId: id, text: prompt, steer: Boolean(options.steer), wait: false, waitForStart: true,
    }, requestOptions);
    if (options.wait && result?.accepted === true) {
      if (typeof result.clientMessageId !== "string" || !result.clientMessageId.trim()) {
        throw new QzError("INVALID_RESPONSE", "The message was accepted without a tracking ID. Inspect the task before sending it again.", {
          sessionId: id, hint: "Continue watching the same task:", command: recoveryCommand("watch", id, clientId, true),
        });
      }
      result = { ...result, snapshot: await observe(id, {
        expectedMessageId: result.clientMessageId, messageWasQueued: result.disposition === "queued",
      }) };
    }
    return { result };
  }
  if (["submit", "approve", "reject"].includes(command)) {
    let waitId = options["wait-id"];
    let input, consentVersion;
    if (!waitId || command === "approve") {
      input = await call(running.endpoint, "qingzhou_get_user_input", { ...common, sessionId: id }, requestOptions);
      if (!waitId) {
        if (!input?.waiting || !input?.waitId) throw new QzError("NOT_WAITING", "This task has no pending input.", { sessionId: id });
        waitId = input.waitId;
      }
    }
    if (command === "approve" && input?.waiting && input.waitId === waitId && input.kind === "location_consent") {
      if (!Number.isInteger(input.consentVersion) || input.consentVersion < 1) {
        throw new QzError("INVALID_RESPONSE", "The location notice has no valid consent version. Run qz show to review the current request.", { sessionId: id });
      }
      consentVersion = input.consentVersion;
      await dependencies.onUserInput?.(input);
    }
    dependencies.signal?.throwIfAborted();
    let result = await call(running.endpoint, "qingzhou_respond_to_user_input", {
      ...common, sessionId: id, waitId, action: command, ...(command === "submit" ? { answers: args } : {}),
      ...(consentVersion === undefined ? {} : { consentVersion }),
    }, requestOptions);
    if (options.wait && (result?.accepted === true || result?.requiresUserAction)) {
      const snapshot = await observe(id, {
        runId: result.runId || "", ignoreWaitId: result.requiresUserAction ? "" : waitId,
      });
      result = result.requiresUserAction
        ? { sessionId: id, waitId, snapshot }
        : { ...result, snapshot };
    }
    return { result };
  }
  if (command === "session" && action === "create") {
    const created = await call(running.endpoint, "qingzhou_create_drive_session", { ...common, ...resource.args }, requestOptions);
    const sessionId = String(created?.sessionId || "").trim();
    if (!sessionId) throw new QzError("INVALID_RESPONSE", "The drive session was created without an ID. Run qz session create again.");
    if (options.json) return { result: created };
    return { text: `sessionId ${sessionId}\n` };
  }
  let name, parameters;
  if (resource) {
    name = resource.name; parameters = { ...common, ...resource.args };
  } else {
    name = { list: "qingzhou_list_sessions", create: "qingzhou_create_session", get: "qingzhou_get_session_snapshot", stop: "qingzhou_stop_session" }[action];
    parameters = { ...common, ...(id ? { sessionId: id } : {}),
      ...(action === "create" ? { title: options.title || "", firstMessage: prompt, ...(options.parent ? { parentSessionId: options.parent } : {}) } : {}),
      ...(action === "list" && options.limit !== undefined ? { limit: Number(options.limit) } : {}) };
  }
  let result = await call(running.endpoint, name, parameters, requestOptions);
  if (command === "tasks" && action === "get" && result?.session === null) {
    throw new QzError("TASK_NOT_FOUND", TASK_NOT_FOUND_MESSAGE, missingTaskDetails(id, clientId));
  }
  if (command === "tasks" && action === "create" && options.wait) {
    const sessionId = result?.session?.id || result?.sessionId;
    if (!sessionId) throw new QzError("INVALID_RESPONSE", "The task was created without an ID. Run qz tasks to find it before retrying.");
    await dependencies.onTaskCreated?.(result);
    result = { ...result, snapshot: await observe(sessionId) };
  }
  return { result };
}

export function errorPayload(error) {
  const interrupted = error.name === "AbortError" || error.code === "INTERRUPTED";
  const timeout = error.name === "TimeoutError" || error.code === -32001 || error.code === "TIMEOUT";
  const code = String(interrupted ? "INTERRUPTED" : timeout ? "TIMEOUT" : error.code || "CONNECTION_ERROR").toUpperCase();
  const { hint: detailHint, ...details } = error.details || {};
  const payload = { code, message: interrupted ? "Stopped waiting. A started browser task may still be running."
    : timeout && error.code !== "TIMEOUT" ? "The request timed out. A started browser task may still be running." : error.message,
    ...(error.hint || detailHint ? { hint: error.hint || detailHint } : {}) };
  if (code === "INVALID_ARGUMENTS") payload.hint ||= "With npm, use npm run qz -- <command> [options]. Run qz --help for usage.";
  if (!payload.hint && (timeout || interrupted)) payload.hint = "Run qz tasks to inspect the task before repeating the command.";
  if (!payload.hint && code === "BRIDGE_REQUEST_TIMEOUT") payload.hint = "The browser operation may still be running. Check the task before repeating the command.";
  if (!payload.hint && code === "BRIDGE_CLIENT_REQUIRED") payload.hint = "Run qz status to list browser IDs, then repeat with --client ID.";
  if (["NOT_CONNECTED", "CONNECTION_ERROR", "CONNECTION_UNAVAILABLE", "CONNECTION_PENDING", "CONNECTION_CHANGED", "BROWSER_OPEN_FAILED", "BRIDGE_NOT_CONNECTED", "BRIDGE_CLOSED"].includes(code)) {
    Object.assign(details, { guide: GUIDE_URL, install: INSTALL_URL });
    payload.hint ||= "Run qz install if the extension is missing, then qz connect. See the GitHub guide for setup.";
  }
  if (Object.keys(details).length) payload.details = details;
  return payload;
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const stdout = dependencies.stdout || process.stdout;
  const stderr = dependencies.stderr || process.stderr;
  const env = dependencies.env || process.env;
  // Preserve explicit machine output even when argument validation itself fails.
  let mode = outputMode({ json: argv.includes("--json"), plain: argv.includes("--plain"), "no-color": argv.includes("--no-color") }, stdout, env);
  let live;
  try {
    const parsed = parseCommand(argv);
    mode = outputMode(parsed.options, stdout, env);
    if (parsed.command === "help") {
      const help = renderHelp(parsed.helpTopic, { ...mode, lang: parsed.options.lang, env });
      stdout.write(parsed.options.json ? `${JSON.stringify({ ok: true, result: { help } })}\n` : help);
      return 0;
    }
    if (parsed.command === "skill") {
      const guide = driveGuide({ explicit: parsed.options.lang, env });
      stdout.write(parsed.options.json ? `${JSON.stringify({ ok: true, result: { guide } })}\n` : guide);
      return 0;
    }
    if (parsed.command === "exec") mode = { ...mode, json: true };
    if (parsed.options.wait) live = createLiveOutput(parsed, { stdout, stderr, ...mode });
    const result = await executeCommand(parsed, { ...dependencies,
      onTaskCreated: async task => { live?.created(task); await dependencies.onTaskCreated?.(task); },
      onTaskUpdate: async event => { live?.update(event); await dependencies.onTaskUpdate?.(event); },
      onUserInput: async input => {
        if (!mode.json) stdout.write(`${renderInputNotice({ ...input, clientId: input.clientId || parsed.options?.["client-id"] }, mode)}\n`);
        await dependencies.onUserInput?.(input);
      },
    });
    live?.finish();
    if (result.stderr) stderr.write(result.stderr);
    stdout.write(result.text ?? (mode.json ? `${JSON.stringify({ ok: true, result: result.result })}\n`
      : renderResult({ ...parsed, presentation: { ...parsed.presentation, streamed: live?.streamed } }, result.result, mode)));
    const status = result.result?.snapshot?.status || result.result?.snapshot?.runtime?.status;
    if (Number.isInteger(result.exitCode) && result.exitCode > 0) return result.exitCode;
    if (result.result?.accepted === false && !result.result?.requiresUserAction) return 1;
    return ["error", "failed", "aborted", "cancelled", "canceled", "interrupted"].includes(status) ? 1 : 0;
  } catch (error) {
    live?.finish();
    const payload = errorPayload(error);
    if (mode.json) stdout.write(`${JSON.stringify(payload)}\n`);
    else stderr.write(renderError(payload, { ...mode, color: mode.color && Boolean(stderr.isTTY) }));
    return payload.code === "INVALID_ARGUMENTS" ? 2 : payload.code === "INTERRUPTED" ? 130 : 1;
  }
}

/** Keep handlers installed while npm forwards duplicate signals and MCP closes. */
export async function runMain(argv = process.argv.slice(2), dependencies = {}) {
  const controller = new AbortController();
  let interruptedExitCode;
  const interrupt = code => {
    if (controller.signal.aborted) return;
    interruptedExitCode = code;
    controller.abort();
  };
  const onSigint = () => interrupt(130);
  const onSigterm = () => interrupt(143);
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  try {
    const code = await main(argv, { ...dependencies, signal: controller.signal });
    return interruptedExitCode ?? code;
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
}

let isEntry = false;
try { isEntry = realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch {}
if (isEntry) {
  process.exitCode = await runMain();
}
