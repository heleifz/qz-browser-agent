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

/** Success stdout is only the returned value. Failure stdout is the code and the last five traces. */
export function presentScriptResult(payload) {
  const sessionId = payload && typeof payload === "object" ? String(payload.sessionId || "").trim() : "";
  const stderr = sessionId ? `sessionId ${sessionId}\n` : "";
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
