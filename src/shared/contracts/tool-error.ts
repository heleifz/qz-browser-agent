/** Public failure shared by tools, drive Sessions, and script execution. */
export interface ToolError {
  code: string;
  message: string;
  hint?: string;
  details?: Record<string, unknown>;
}

export function toolError(code: string, message: string, { hint, details }: Pick<ToolError, 'hint' | 'details'> = {}): ToolError {
  return {
    code: code.toUpperCase(), message,
    ...(hint ? { hint } : {}),
    ...(details && Object.keys(details).length ? { details } : {}),
  };
}

/** Native failures plus the input-only legacy failure envelopes. */
export function isToolFailure(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return result.ok === false || result.isError === true || Boolean(result.error)
    || (result.ok !== true && typeof result.code === 'string' && typeof result.message === 'string'
      && !['', 'OK', 'SUCCESS', 'DONE'].includes(result.code.trim().toUpperCase()));
}
