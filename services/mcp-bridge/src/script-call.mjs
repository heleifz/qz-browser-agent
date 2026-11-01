/** Script timeout stays at 120 unless --timeout is set. The request waits 60 seconds longer. */
export function scriptTimeouts({ timeoutOption, timeoutSeconds = 180 } = {}) {
  const scriptSeconds = timeoutOption === undefined ? 120 : Number(timeoutSeconds);
  return { scriptSeconds, requestSeconds: scriptSeconds + 60 };
}

const CATALOG_EXEC = {
  list_tools: "qingzhou_list_tools",
  capabilities: "qingzhou_list_capabilities",
  get_tool: "qingzhou_get_tool",
};

/** Bridge catalog methods are not browser tools. Route them before execute_tool. */
export function catalogExecRoute(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || Array.isArray(payload.calls)) return null;
  const tool = CATALOG_EXEC[String(payload.name || "").trim()];
  if (!tool) return null;
  const args = payload.args && typeof payload.args === "object" && !Array.isArray(payload.args) ? { ...payload.args } : {};
  const sessionId = String(args.sessionId || payload.sessionId || "").trim();
  if (sessionId) args.sessionId = sessionId;
  return { tool, args };
}

/** Build the same run_script call qingzhou_execute_tool accepts. */
export function buildScriptRequest({ code = "", timeoutSeconds = 120, sessionId = "" } = {}) {
  const request = {
    name: "run_script",
    args: {
      target: "inner",
      timeout: timeoutSeconds,
      code: String(code),
    },
  };
  const id = String(sessionId || "").trim();
  if (id) request.sessionId = id;
  return request;
}

function scriptBody(payload) {
  if (!payload || typeof payload !== "object") return null;
  const inner = payload.result;
  if (inner && typeof inner === "object" && (Object.hasOwn(inner, "ok") || Object.hasOwn(inner, "code"))) return inner;
  if (Object.hasOwn(payload, "ok") || Object.hasOwn(payload, "code")) return payload;
  return null;
}

function truncatedValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) && value.truncated === true ? value : null;
}

/** Success stdout is only the returned value. Failure stdout is the code and the last five traces. */
export function presentScriptResult(payload) {
  const sessionId = payload && typeof payload === "object" ? String(payload.sessionId || "").trim() : "";
  const stderr = sessionId ? `sessionId ${sessionId}\n` : "";
  const truncated = truncatedValue(payload?.result) || truncatedValue(payload);
  if (truncated) return { text: `${JSON.stringify(truncated)}\n`, stderr, exitCode: 0 };
  const body = scriptBody(payload);
  if (body?.ok === true && Object.hasOwn(body, "result")) {
    return { text: `${JSON.stringify(body.result)}\n`, stderr, exitCode: 0 };
  }
  const trace = Array.isArray(body?.trace) ? body.trace.slice(-5) : [];
  const failure = {
    code: String(body?.code || "TOOL_EXECUTION_FAILED"),
    error: typeof body?.error === "string" ? body.error : "script failed",
    ...(trace.length ? { trace } : {}),
  };
  return { text: `${JSON.stringify(failure)}\n`, stderr, exitCode: 1 };
}
