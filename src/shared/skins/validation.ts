export function skinError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}
export function skinObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw skinError('SKIN_INVALID');
  return value as Record<string, unknown>;
}
