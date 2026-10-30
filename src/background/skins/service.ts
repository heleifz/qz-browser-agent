import { createSkinRepository } from './repository.js';
import type { SkinCommand } from '../../shared/skins/model.js';
import { skinError } from '../../shared/skins/model.js';
import type { ToolContext } from '../../sdk/background.js';
import { SKIN_EDITOR_PATH, selectSkinEditor } from './editor-tabs.js';
import type { SkinPreview } from '../../shared/skins/preview.js';
export { SKIN_EDITOR_PATH, selectSkinEditor } from './editor-tabs.js';
export function assertSkinSender(sender: chrome.runtime.MessageSender, extensionId: string) {
  const url = new URL(sender.url || 'https://invalid.local');
  if (sender.id !== extensionId || url.protocol !== 'chrome-extension:' || url.host !== extensionId
    || !['/sidepanel/sidepanel.html', `/${SKIN_EDITOR_PATH}`].includes(url.pathname)) throw skinError('SKIN_FORBIDDEN');
}
export function createSkinService(options: {
  storage: Parameters<typeof createSkinRepository>[0];
  onStorageChange?(invalidate: () => void): void;
  getEditorTabs?(): Promise<chrome.tabs.Tab[]>;
  extensionId?: string;
  getCurrentWindowId?(): Promise<number | undefined>;
  emit(event: Record<string, unknown>): void;
  isRunCurrent(sessionId: string, runId: string): boolean;
  openEditor(id: string, sessionId: string, windowId?: number, assertCurrent?: () => void): Promise<unknown>;
  captureEditor?(tabId: number, id: string, revision: number, sessionId: string, signal?: AbortSignal): Promise<SkinPreview>;
}) {
  const repository = createSkinRepository(options.storage, () => options.emit({ type: 'skins_changed' }), undefined, !!options.onStorageChange);
  options.onStorageChange?.(() => repository.invalidate());
  async function execute(input: SkinCommand, context?: ToolContext, signal?: AbortSignal): Promise<object> {
    const assertCurrent = () => {
      signal?.throwIfAborted();
      if (context && (!context.sessionId || !context.runId || !options.isRunCurrent(context.sessionId, context.runId))) throw skinError('SKIN_RUN_EXPIRED');
    };
    assertCurrent();
    if (input.action === 'welcome') return repository.welcome(input.id, input.revision);
    if (input.action === 'list') {
      const snapshot = await repository.snapshot();
      return input.summaryOnly ? { activeId: snapshot.activeId, skins: snapshot.skins } : snapshot;
    }
    if (input.action === 'get' || input.action === 'open' || input.action === 'screenshot') {
      const sessionId = context?.sessionId || input.sessionId || '';
      const windowId = context?.sourceWindowId ?? await options.getCurrentWindowId?.();
      const editor = !input.id ? selectSkinEditor(await options.getEditorTabs?.() || [], options.extensionId || '', sessionId, windowId) : null;
      const skin = await repository.get(input.id || editor?.skinId || '', input.action === 'get' && input.saved === true);
      assertCurrent();
      if (input.action === 'get') {
        if (context) await options.openEditor(skin.id, sessionId, windowId, assertCurrent);
        return { skin };
      }
      const tab = await options.openEditor(skin.id, sessionId, windowId, assertCurrent);
      if (input.action === 'screenshot') {
        assertCurrent();
        if (input.revision !== undefined && input.revision !== skin.revision) throw skinError('SKIN_CONFLICT');
        const tabId = (tab as { id?: number } | undefined)?.id;
        if (!options.captureEditor || tabId === undefined) throw skinError('SKIN_PREVIEW_UNAVAILABLE');
        const preview = await options.captureEditor(tabId, skin.id, skin.revision, sessionId, signal);
        assertCurrent();
        if ((await repository.get(skin.id)).revision !== skin.revision) throw skinError('SKIN_CONFLICT');
        assertCurrent();
        return { id: skin.id, revision: skin.revision, _image: preview.image, width: preview.width, height: preview.height,
          method: 'skin_renderer', scope: 'skin-preview', actionable: false };
      }
      return { id: skin.id, revision: skin.revision, tab };
    }
    const result = await repository.mutate(input, assertCurrent);
    return input.summaryOnly ? { ...result, snapshot: { activeId: result.snapshot.activeId, skins: result.snapshot.skins } } : result;
  }
  return { execute, async getEditorContext(sessionId: string) {
    return selectSkinEditor(await options.getEditorTabs?.() || [], options.extensionId || '', sessionId);
  }, async fromPage(input: SkinCommand, sender: chrome.runtime.MessageSender) {
    assertSkinSender(sender, chrome.runtime.id);
    return execute(input);
  } };
}
