import { MAX_SKIN_BYTES, SKIN_STORAGE_KEY, normalizeSkin, parseSkinPackage, skinBytes, skinError, skinObject, sameSkinData } from '../../shared/skins/model.js';
import type { SkinCommand, SkinLibrary, SkinSnapshot, WelcomeSkin } from '../../shared/skins/model.js';
import { createDefaultSkinLibrary } from '../../shared/skins/defaults.js';

interface Storage { get(key: string): Promise<Record<string, unknown>>; set(values: Record<string, unknown>): Promise<void> }
/** One Background owner serializes the library, including edits from different Sessions and tabs. */
export function createSkinRepository(storage: Storage, changed: () => void = () => {}, newId = () => crypto.randomUUID(), cacheReads = false) {
  let queue: Promise<unknown> = Promise.resolve();
  let cached: SkinLibrary | undefined, cacheEpoch = 0;
  const serial = <T>(action: () => Promise<T>): Promise<T> => {
    const operation = queue.then(action);
    queue = operation.catch(() => {});
    return operation;
  };
  async function read(): Promise<SkinLibrary> {
    if (cached) return cached;
    const epoch = cacheEpoch;
    const value = (await storage.get(SKIN_STORAGE_KEY))[SKIN_STORAGE_KEY];
    if (value === undefined) {
      const library = createDefaultSkinLibrary();
      if (cacheReads && epoch === cacheEpoch) cached = library;
      return library;
    }
    const data = skinObject(value);
    if (data.schemaVersion !== 1) throw skinError('SKIN_VERSION_UNSUPPORTED');
    if (!Array.isArray(data.entries) || !data.entries.length || data.entries.length > 30) throw skinError('SKIN_INVALID');
    const entries = data.entries.map(value => {
      const item = skinObject(value);
      const draft = normalizeSkin(item.draft), saved = normalizeSkin(item.saved);
      if (draft.id !== saved.id) throw skinError('SKIN_INVALID');
      return { draft, saved };
    });
    if (new Set(entries.map(entry => entry.draft.id)).size !== entries.length
      || !entries.some(entry => entry.saved.id === data.activeId)) throw skinError('SKIN_INVALID');
    const library: SkinLibrary = { schemaVersion: 1, activeId: String(data.activeId), entries };
    if (cacheReads && epoch === cacheEpoch) cached = library;
    return library;
  }
  function snapshot(library: SkinLibrary): SkinSnapshot {
    return { activeId: library.activeId, active: structuredClone(library.entries.find(entry => entry.saved.id === library.activeId)!.saved),
      skins: library.entries.map(({ draft, saved }) => ({ id: draft.id, name: draft.name, revision: draft.revision,
        type: draft.visual.type, modified: !sameSkinData(draft, saved) })) };
  }
  return {
    invalidate() { cacheEpoch++; cached = undefined; },
    welcome: (id?: string, revision?: number) => serial(async () => {
      const library = await read(), saved = library.entries.find(entry => entry.saved.id === library.activeId)!.saved;
      return { activeId: saved.id, revision: saved.revision,
        ...(id === saved.id && revision === saved.revision ? {} : { active: structuredClone(saved) }) };
    }),
    snapshot: () => serial(async () => snapshot(await read())),
    get: (id: string) => serial(async () => {
      const library = await read();
      const entry = library.entries.find(entry => entry.draft.id === (id || library.activeId));
      if (!entry) throw skinError('SKIN_NOT_FOUND');
      return structuredClone(entry.draft);
    }),
    mutate(command: SkinCommand, assertCurrent: () => void = () => {}): Promise<{ skin?: WelcomeSkin; snapshot: SkinSnapshot }> {
      // Capture data at admission, before any queued operation can mutate caller-owned objects.
      const input = structuredClone(command);
      return serial(async () => {
        assertCurrent();
        // Never let a failed write or a caller mutate the validated read cache.
        const library = structuredClone(await read());
        assertCurrent();
        let result: WelcomeSkin | undefined;
        if (input.action === 'import' || input.action === 'create') {
          if (library.entries.length >= 30) throw skinError('SKIN_LIBRARY_FULL');
          const id = newId();
          const skin = input.action === 'import' ? parseSkinPackage(input.package)
            : normalizeSkin({ ...skinObject(input.skin), schemaVersion: 1, id, revision: 1 });
          result = { ...skin, id, revision: 1 };
          library.entries.push({ draft: result, saved: structuredClone(result) });
        } else {
          const entry = library.entries.find(entry => entry.draft.id === input.id);
          if (!entry) throw skinError('SKIN_NOT_FOUND');
          if (input.revision !== entry.draft.revision) throw skinError('SKIN_CONFLICT');
          if (input.action === 'update') {
            const patch = skinObject(input.patch);
            if (Object.keys(patch).some(key => !['name', 'visual', 'quotes', 'assets'].includes(key))) throw skinError('SKIN_INVALID');
            let visual = patch.visual === undefined ? entry.draft.visual : skinObject(patch.visual);
            // Scene model patches merge by stable character id. null explicitly removes a character.
            // Missing src/source fields retain the original binary and its per-character customization.
            if (visual.type === 'scene3d' && visual.models !== undefined && entry.draft.visual.type === 'scene3d') {
              const models: Record<string, unknown> = Object.assign(Object.create(null), entry.draft.visual.models);
              for (const [id, value] of Object.entries(skinObject(visual.models))) {
                if (value === null) delete models[id];
                else models[id] = { ...(models[id] === undefined ? {} : skinObject(models[id])), ...skinObject(value) };
              }
              visual = { ...visual, models };
            }
            entry.draft = normalizeSkin({ ...entry.draft, ...patch,
              visual: visual.type === entry.draft.visual.type ? { ...entry.draft.visual, ...visual } : visual,
              revision: entry.draft.revision + 1 });
            result = entry.draft;
          } else if (input.action === 'apply') {
            entry.saved = structuredClone(entry.draft);
            library.activeId = entry.draft.id;
            result = entry.draft;
          } else if (input.action === 'revert') {
            entry.draft = { ...structuredClone(entry.saved), revision: entry.draft.revision + 1 };
            entry.saved = structuredClone(entry.draft);
            result = entry.draft;
          } else if (input.action === 'delete') {
            if (library.entries.length === 1) throw skinError('SKIN_LAST_ENTRY');
            library.entries = library.entries.filter(item => item !== entry);
            if (library.activeId === entry.draft.id) library.activeId = library.entries[0]!.saved.id;
          } else throw skinError('SKIN_INVALID');
        }
        if (skinBytes(library) > MAX_SKIN_BYTES * 5) throw skinError('SKIN_LIBRARY_FULL');
        assertCurrent();
        const epoch = cacheEpoch;
        await storage.set({ [SKIN_STORAGE_KEY]: library });
        if (cacheReads && epoch === cacheEpoch) cached = library;
        // A committed browser write is authoritative even when a request is cancelled immediately after it.
        changed();
        return { ...(result ? { skin: structuredClone(result) } : {}), snapshot: snapshot(library) };
      });
    },
  };
}
