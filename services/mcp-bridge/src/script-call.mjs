/** Script timeout stays at 120 unless --timeout is set. The request waits 60 seconds longer. */
export function scriptTimeouts({ timeoutOption, timeoutSeconds = 180 } = {}) {
  const scriptSeconds = timeoutOption === undefined ? 120 : Number(timeoutSeconds);
  return { scriptSeconds, requestSeconds: scriptSeconds + 60 };
}

/** Build an outer script request; each page tool supplies its own tabRef. */
export function buildScriptRequest({ code = "", timeoutSeconds = 120, sessionId = "", args = {} } = {}) {
  const id = String(sessionId || "").trim();
  if (!id) throw new Error("qz script requires --session <id>. Pass the sessionId from qz session create.");
  return { name: "run_script", sessionId: id, scriptApiVersion: 1, args: { timeout: timeoutSeconds, code: String(code), args } };
}

/** Only the transport's traces and error flag control CLI presentation. */
export function presentScriptResult(payload) {
  if (!payload || typeof payload.isError !== "boolean") {
    return { text: JSON.stringify({ traces: [], result: { code: "UPGRADE_REQUIRED", message: "The connected extension uses an incompatible script API.",
      hint: "The script may have run. Inspect the browser before retrying, then update the CLI and extension together and reconnect." } }) + "\n", exitCode: 1 };
  }
  const traces = Array.isArray(payload.traces) ? payload.traces.filter(row => typeof row === "string")
    : payload.isError && Array.isArray(payload.result?.details?.trace)
      ? payload.result.details.trace.flatMap(row => typeof row === "string" ? [row] : typeof row?.message === "string" ? [row.message] : []) : [];
  if (!payload.isError) {
    return { text: JSON.stringify({ traces, result: payload.result === undefined ? null : payload.result }) + "\n", exitCode: 0 };
  }
  const error = payload.result || {};
  const { trace: _hostTrace, ...details } = error.details || {};
  const failure = {
    code: String(error.code || "TOOL_EXECUTION_FAILED").toUpperCase(),
    message: typeof error.message === "string" ? error.message : "Script failed.",
    ...(error.hint ? { hint: error.hint } : {}), ...(Object.keys(details).length ? { details } : {}),
  };
  return { text: JSON.stringify({ traces, result: failure }) + "\n", exitCode: 1 };
}
