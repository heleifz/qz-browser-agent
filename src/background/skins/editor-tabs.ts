import { skinError } from '../../shared/skins/model.js';
export const SKIN_EDITOR_PATH = 'dom/skins/editor.html';
type EditorTab = Pick<chrome.tabs.Tab, 'id' | 'url' | 'pendingUrl' | 'active' | 'windowId'>;

export function skinEditorTab(tab: EditorTab, extensionId: string) {
  try {
    const url = new URL(tab.pendingUrl || tab.url || '');
    const skinId = url.searchParams.get('skin');
    if (url.protocol !== 'chrome-extension:' || url.host !== extensionId || url.pathname !== `/${SKIN_EDITOR_PATH}`
      || !skinId || !/^[a-zA-Z0-9_-]{1,100}$/.test(skinId)) return null;
    const character = url.searchParams.get('character');
    return { ...tab, skinId, ...(character && /^[a-zA-Z0-9_-]{1,80}$/.test(character) ? { characterId: character } : {}), sessionId: url.searchParams.get('session') || '' };
  } catch { return null; }
}

/** Prefer this chat's studio. An active, unbound studio can be adopted in the caller's window. */
export function selectSkinEditor(tabs: readonly EditorTab[], extensionId: string, sessionId: string, windowId?: number) {
  const editors = tabs.flatMap(tab => {
    const editor = skinEditorTab(tab, extensionId);
    return editor && (windowId === undefined || editor.windowId === windowId) ? [editor] : [];
  });
  const bound = sessionId ? editors.filter(tab => tab.sessionId === sessionId) : [];
  const active = bound.filter(tab => tab.active);
  const candidates = active.length ? active : bound;
  const selection = (editor: NonNullable<ReturnType<typeof skinEditorTab>>) => ({ skinId: editor.skinId,
    ...(editor.characterId ? { characterId: editor.characterId } : {}) });
  if (candidates.length === 1) return selection(candidates[0]!);
  if (candidates.length || windowId === undefined) return null;
  const unbound = editors.filter(tab => tab.active && !tab.sessionId);
  return unbound.length === 1 ? selection(unbound[0]!) : null;
}

export function createSkinEditorTabs(tabs: Pick<typeof chrome.tabs, 'query' | 'update' | 'create'>, extensionId: string) {
  let pending: Promise<unknown> = Promise.resolve();
  return { open(id: string, sessionId: string, windowId?: number, assertCurrent: () => void = () => {}) {
    const operation = pending.then(async () => {
      const all = await tabs.query(windowId === undefined ? { currentWindow: true } : { windowId });
      assertCurrent();
      const editors = all.flatMap(tab => {
        const editor = skinEditorTab(tab, extensionId);
        return editor && editor.skinId === id ? [editor] : [];
      });
      const same = editors.filter(tab => tab.sessionId === sessionId);
      const existing = same.find(tab => tab.active) || same[0]
        || editors.find(tab => tab.active && !tab.sessionId);
      const url = new URL(`chrome-extension://${extensionId}/${SKIN_EDITOR_PATH}`);
      url.searchParams.set('skin', id);
      if (existing?.characterId) url.searchParams.set('character', existing.characterId);
      if (sessionId) url.searchParams.set('session', sessionId);
      const tab = existing?.id === undefined
        ? await tabs.create({ url: url.href, ...(windowId === undefined ? {} : { windowId }) })
        : await tabs.update(existing.id, { active: true, ...(existing.sessionId === sessionId ? {} : { url: url.href }) });
      if (!tab) throw skinError('SKIN_NOT_FOUND');
      return { id: tab.id, url: url.href };
    });
    pending = operation.catch(() => {});
    return operation;
  } };
}
