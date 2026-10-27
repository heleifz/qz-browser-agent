/** Flow transport budgets are separate from durable Data/file stores and normalized images. */
export const FLOW_RESULT_CHARS = 64 * 1024;
export const FLOW_STEP_CHARS = 256 * 1024;
export const FLOW_PROGRESS_CHARS = 2048;
export const FLOW_MAX_PENDING = 64;

export function flowValueSize(value: unknown): number {
  return JSON.stringify(value)?.length || 0;
}

/** Never silently present an incomplete value as complete structured data. */
export function compactFlowValue(value: unknown, limit = FLOW_RESULT_CHARS): unknown {
  const text = JSON.stringify(value) || "null";
  if (text.length <= limit) return value;
  const summary = { truncated: true, code: "FLOW_RESULT_TOO_LARGE", characters: text.length,
    preview: text.slice(0, Math.max(0, limit - 256)),
    recovery: "Store complete data in data_store or a file inside the flow; return its identifier and a small summary." };
  // The preview is itself JSON text; quotes/backslashes need escaping again on the wire.
  const overflow = JSON.stringify(summary).length - limit;
  if (overflow > 0) summary.preview = summary.preview.slice(0, Math.max(0, summary.preview.length - overflow));
  return summary;
}
