import { setTimeout as delay } from "node:timers/promises";
import { PROTOCOL_VERSION, QzError, readHealth } from "./client.mjs";
import { ensureDaemon, findDaemon, restartDaemon } from "./daemon.mjs";
import { openConnectionBrowser } from "./open-browser.mjs";

const offlineCodes = new Set(["BRIDGE_NOT_CONNECTED", "BRIDGE_CLIENT_OFFLINE", "BRIDGE_CLIENT_DISCONNECTED", "BRIDGE_REQUEST_TIMEOUT", -32001]);

/** Upgrade a verified service at most once, before any browser operation is submitted. */
export async function prepareService({ options = {}, script = false } = {}, dependencies = {}) {
  const signal = dependencies.signal;
  signal?.throwIfAborted();
  const find = dependencies.findDaemon || findDaemon;
  const ensure = dependencies.ensureDaemon || ensureDaemon;
  let running = await find({ allowIncompatible: true });
  signal?.throwIfAborted();
  if (!running) {
    running = await ensure({ ...(options.port === undefined ? {} : { preferredPort: options.port }), signal });
    signal?.throwIfAborted();
  }
  const compatible = service => service.compatible !== false
    && (service.health.protocolVersion === undefined || service.health.protocolVersion === PROTOCOL_VERSION)
    && service.health.features?.browserPairing === 1 && (!script || service.health.features?.scriptApiVersion >= 1);
  if (!compatible(running)) {
    running = await (dependencies.restartDaemon || restartDaemon)({ expected: running, preferredPort: Number(new URL(running.endpoint).port), signal });
    signal?.throwIfAborted();
    if (!compatible(running)) throw new QzError("UPGRADE_REQUIRED", "The local qz service is incompatible. No browser operation was submitted.", {
      hint: "Update the installed CLI and browser extension, then retry the command.",
    });
  }
  return running;
}

export function connectionUri(running, options = {}) {
  const url = new URL("/qz-connect", running.endpoint);
  let name = options.name;
  if (options["client-id"]) {
    const entry = [...(running.health.status?.browsers || []), ...(running.health.status?.clients || [])]
      .find(client => client.clientId === options["client-id"] || client.name === options["client-id"]);
    if (!entry) throw new QzError("CLIENT_NOT_FOUND", "The selected browser is not registered. Run qz browsers to inspect names and UUIDs.");
    name = entry.name;
  }
  if (name) url.searchParams.set("name", name);
  return url.href;
}

/** Select one responding identity; every later call in the command keeps that UUID. */
export async function prepareConnection({ options = {}, timeoutSeconds = 30, sessionId = "", script = false } = {}, dependencies = {}) {
  const running = await prepareService({ options, script }, dependencies);
  const deadline = Date.now() + Math.min(timeoutSeconds, 30) * 1000;
  const signal = dependencies.signal;
  const selector = options["client-id"];
  const registered = selector ? [...(running.health.status?.browsers || []), ...(running.health.status?.clients || [])]
    .find(client => client.clientId === selector || client.name === selector) : undefined;
  if (selector && !registered) throw new QzError("CLIENT_NOT_FOUND", "The selected browser is not registered. Run qz browsers to inspect names and UUIDs.");
  const clientId = registered?.clientId;
  const uri = connectionUri(running, options);
  const call = async (name, args) => {
    signal?.throwIfAborted();
    const timeoutMs = Math.max(1, Math.min(2000, deadline - Date.now()));
    return dependencies.callTool(running.endpoint, name, { ...args, timeoutSeconds: timeoutMs / 1000 }, { timeoutMs, signal });
  };
  const locate = async health => {
    const clients = (health.status?.clients || []).filter(client => !clientId || client.clientId === clientId);
    const matches = [];
    for (const client of clients) {
      try { await call("qingzhou_call", { method: "ping", clientId: client.clientId }); }
      catch (error) {
        signal?.throwIfAborted();
        if (!offlineCodes.has(error.code)) throw error;
        if (sessionId && clients.length > 1) throw error;
        continue;
      }
      // A unique connection retains the tool producer's authoritative occupied/ended checks.
      if (!sessionId || selector || clients.length === 1) return client.clientId;
      try {
        await call("qingzhou_get_drive_session", { sessionId, clientId: client.clientId });
        matches.push(client.clientId);
      } catch (error) {
        if (error.code !== "DRIVE_SESSION_NOT_FOUND") throw error;
        const snapshot = await call("qingzhou_get_session_snapshot", { sessionId, clientId: client.clientId, compact: true, tail: true });
        if (snapshot?.session) matches.push(client.clientId);
      }
    }
    if (matches.length > 1) throw new QzError("SELECTION_REQUIRED", "This session exists in more than one browser. Select its browser with --client NAME|UUID.");
    if (matches.length === 1) return matches[0];
    if (sessionId && clients.length > 1) throw new QzError("DRIVE_SESSION_NOT_FOUND", "The session was not found in the connected browsers.", {
      hint: "Check the session ID and use --client NAME|UUID to select its browser.",
    });
    return "";
  };
  let selected = await locate(running.health);
  if (selected) return { running, clientId: selected };
  const attempted = [];
  let nextAttempt = 0, exhausted = Boolean(selector);
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    if (!exhausted && Date.now() >= nextAttempt) {
      try {
        const opened = await (dependencies.openConnectionBrowser || openConnectionBrowser)(uri, { signal, exclude: [...attempted] });
        attempted.push(opened.browser);
        nextAttempt = Date.now() + (deadline - Date.now()) / Math.max(1, 4 - attempted.length);
      } catch (error) {
        signal?.throwIfAborted();
        if (error.code !== "BROWSER_NOT_FOUND" || !attempted.length) throw error;
        exhausted = true;
      }
    }
    const health = await (dependencies.readHealth || readHealth)(running.endpoint);
    if (running.instanceId && health.instanceId !== running.instanceId) throw new QzError("CONNECTION_CHANGED", "The local service changed during connection. Retry the command.");
    selected = await locate(health);
    if (selected) return { running: { ...running, health }, clientId: selected };
    await delay(Math.max(1, Math.min(200, deadline - Date.now(), exhausted ? 200 : nextAttempt - Date.now())), undefined, { signal });
  }
  throw new QzError(selector ? "CLIENT_OFFLINE" : "CONNECTION_PENDING", selector ? "The selected browser is not responding." : "qz is waiting for its browser extension.", {
    url: uri, hint: "Open this URL in the intended browser profile with qz installed and complete its connection prompt, then retry.",
  });
}
