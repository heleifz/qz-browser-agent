import type { SkinCommand } from '../../shared/skins/model.js';
import { requestRuntimeMessage } from '../../shared/transport/runtime-request.js';
export async function skinRequest<T>(command: SkinCommand, signal?: AbortSignal): Promise<T> {
  // The studio displays the selected draft; it never needs another copy of the active model.
  const response = await requestRuntimeMessage({ type: 'skin_command', command: { ...command, summaryOnly: true } }, { signal, timeoutMs: 15000 });
  if (!response.ok) throw Object.assign(new Error(String(response.error || response.code || 'SKIN_INVALID')), { code: response.code || 'SKIN_INVALID' });
  return response.result as T;
}
