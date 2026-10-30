import { readSkinPreview, type SkinPreview } from '../../shared/skins/preview.js';

const KEY = 'qingzhou_studio_thumbnails_v1';
const LIMIT = 768 * 1024;
interface Thumbnail { id: string; revision: number; preview: SkinPreview }

/** Small derived images; never load an extra model or write to the skin library. */
export function createLibraryPreviews() {
  const entries = new Map<string, Thumbnail>();
  try {
    const text = localStorage.getItem(KEY);
    const saved: unknown = text && text.length <= LIMIT ? JSON.parse(text) : [];
    if (Array.isArray(saved)) for (const entry of saved.slice(-24)) {
      if (!entry || typeof entry.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(entry.id)
        || !Number.isSafeInteger(entry.revision) || entry.revision < 1) continue;
      try {
        const preview = readSkinPreview(entry.preview);
        if (preview.width <= 160 && preview.height <= 160 && preview.image.length <= 64 * 1024) {
          entries.set(entry.id, { id: entry.id, revision: entry.revision, preview });
        }
      } catch { /* A damaged thumbnail does not affect the others. */ }
    }
  } catch { /* The library works without optional local presentation storage. */ }
  return {
    get(id: string) { return entries.get(id); },
    set(id: string, revision: number, preview: SkinPreview) {
      if (preview.image.length > 64 * 1024 || preview.width > 160 || preview.height > 160) return;
      entries.delete(id); entries.set(id, { id, revision, preview });
      let text = JSON.stringify([...entries.values()]);
      while (entries.size > 24 || text.length > LIMIT) {
        entries.delete(entries.keys().next().value!);
        text = JSON.stringify([...entries.values()]);
      }
      try { localStorage.setItem(KEY, text); } catch { /* Storage pressure must not interrupt editing. */ }
    },
  };
}
