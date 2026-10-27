import { FLOW_DISPLAY_STEPS, type FlowDisplay, type FlowStepDisplay } from "#sdk/shared/browser";

const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, limit: number) => typeof value === "string" ? value.slice(0, limit) : "";
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const states = new Set(["queued", "running", "completed", "error", "aborted"]);
const outcomes = new Set(["navigated", "loaded", "already_complete", "condition_met"]);

/** Unknown/historical versions keep their original payload available in the result disclosure. */
export function parseFlowDisplay(value: unknown): FlowDisplay | null {
  const flow = record(record(record(value)._display).flow);
  if (flow.version !== 1 || !Array.isArray(flow.steps) || !finite(flow.total) || !finite(flow.omitted)) return null;
  const ids = new Set<number>();
  const steps: FlowStepDisplay[] = [];
  for (const input of flow.steps.slice(-FLOW_DISPLAY_STEPS)) {
    const step = record(input);
    if (!finite(step.id) || !Number.isInteger(step.id) || ids.has(step.id) || typeof step.tool !== "string" || !states.has(String(step.state))) continue;
    ids.add(step.id);
    steps.push({ id: step.id, tool: text(step.tool, 100), target: text(step.target, 320), state: step.state as FlowStepDisplay["state"],
      ...(finite(step.tabId) ? { tabId: step.tabId } : {}),
      ...(finite(step.elapsedMs) ? { elapsedMs: step.elapsedMs } : {}),
      ...(typeof step.code === "string" ? { code: text(step.code, 100) } : {}),
      ...(outcomes.has(String(step.outcome)) ? { outcome: step.outcome as FlowStepDisplay["outcome"] } : {}),
    });
  }
  steps.sort((a, b) => a.id - b.id);
  return { version: 1, total: Math.max(flow.total, steps.length), omitted: Math.max(flow.omitted, flow.total - steps.length), steps };
}

export function projectFlowResult(value: unknown) {
  const envelope = record(value);
  const observation = record(envelope.finalObservation);
  const snapshot = record(observation.snapshot);
  const display = parseFlowDisplay(value);
  return {
    display,
    observation: envelope.finalObservation,
    snapshot: typeof snapshot.snapshot === "string" ? snapshot.snapshot : observation.snapshot ?? envelope.finalObservation,
    snapshotTruncated: snapshot.truncated === true,
    observationUnavailable: observation.available === false,
    error: text(envelope.error, 2000),
    // Legacy envelopes, unrecognized versions and returned script values stay readable.
    result: Object.hasOwn(envelope, "result") ? envelope.result : display
      ? (Array.isArray(envelope.checkpoints) && envelope.checkpoints.length ? { checkpoints: envelope.checkpoints } : undefined) : value,
  };
}

export function flowText(value: unknown, limit = 16000): { text: string; truncated: boolean } {
  let raw: string;
  try { raw = typeof value === "string" ? value : JSON.stringify(value, null, 2) || ""; }
  catch { raw = String(value); }
  return { text: raw.slice(0, limit), truncated: raw.length > limit };
}
