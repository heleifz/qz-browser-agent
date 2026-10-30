import { withDeadline } from '../internal/abortable.js';
import { skinError } from '../../shared/skins/model.js';
import { readSkinPreview } from '../../shared/skins/preview.js';
import { skinEditorTab } from './editor-tabs.js';

export async function captureSkinEditor(tabId: number, id: string, revision: number, sessionId: string, signal?: AbortSignal) {
  return withDeadline(async lifetime => {
    const requestId = crypto.randomUUID();
    while (!lifetime.aborted) {
      const tab = skinEditorTab(await chrome.tabs.get(tabId), chrome.runtime.id);
      if (!tab || tab.skinId !== id || tab.sessionId !== sessionId) throw skinError('SKIN_PREVIEW_UNAVAILABLE');
      const response = await chrome.runtime.sendMessage({ type: 'skin_preview_capture', tabId, id, revision, sessionId, requestId }).catch(() => undefined);
      lifetime.throwIfAborted();
      if (response?.requestId === requestId) {
        if (!response.ok || response.id !== id || response.revision !== revision) throw skinError('SKIN_PREVIEW_UNAVAILABLE');
        const current = skinEditorTab(await chrome.tabs.get(tabId), chrome.runtime.id);
        if (!current || current.skinId !== id || current.sessionId !== sessionId) throw skinError('SKIN_PREVIEW_UNAVAILABLE');
        return readSkinPreview(response.preview);
      }
      // A newly opened studio may still be loading its packaged entry and registering its listener.
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    throw skinError('SKIN_PREVIEW_UNAVAILABLE');
  }, { signal, timeoutMs: 25000 });
}
