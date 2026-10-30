import type { WelcomeSkin } from '../../shared/skins/model.js';
import { readSkinPreview, type SkinPreview } from '../../shared/skins/preview.js';

const KEY = 'qingzhou_welcome_preview_v1';
const DATABASE = 'qingzhou-skin-render-cache-v1';
async function cacheOperation<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('visual');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction('visual', mode), request = action(transaction.objectStore('visual'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
    });
  } finally { database.close(); }
}
export async function readWelcomeVisual(): Promise<WelcomeSkin | undefined> {
  try {
    const skin = await cacheOperation<WelcomeSkin | undefined>('readonly', store => store.get('active'));
    if (skin?.schemaVersion !== 1 || typeof skin.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(skin.id) || !Number.isSafeInteger(skin.revision) || skin.revision < 1
      || typeof skin.name !== 'string' || !Array.isArray(skin.quotes) || skin.quotes.some(quote => typeof quote !== 'string')
      || !skin.assets || !['model3d', 'scene3d'].includes(skin.visual?.type)) return;
    return skin;
  } catch { return; }
}
let writes: Promise<void> = Promise.resolve();
export function writeWelcomeVisual(skin?: WelcomeSkin): Promise<void> {
  const value = skin?.visual.type === 'image2d' ? undefined : skin;
  const operation = writes.then(async () => {
    if (value) await cacheOperation('readwrite', store => store.put(value, 'active'));
    else await cacheOperation('readwrite', store => store.delete('active'));
  });
  writes = operation.catch(() => {});
  return writes;
}
export interface WelcomePreview extends SkinPreview {
  id: string; revision: number; name: string; type: 'model3d' | 'scene3d'; quote: string;
}
/** A bounded presentation cache; the Background library remains authoritative. */
export function readWelcomePreview(): WelcomePreview | undefined {
  try {
    const text = localStorage.getItem(KEY);
    if (!text || text.length > 1024 * 1024) return;
    const value = JSON.parse(text) as WelcomePreview;
    if (typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.id) || !Number.isSafeInteger(value.revision) || value.revision < 1
      || typeof value.name !== 'string' || value.name.length > 100 || typeof value.quote !== 'string' || value.quote.length > 300
      || !['model3d', 'scene3d'].includes(value.type)) return;
    return { ...value, ...readSkinPreview(value) };
  } catch { return; }
}
export function writeWelcomePreview(skin: WelcomeSkin, preview: SkinPreview) {
  if (skin.visual.type === 'image2d') return;
  try {
    const text = JSON.stringify({ ...readSkinPreview(preview), id: skin.id, revision: skin.revision,
      name: skin.name, type: skin.visual.type, quote: skin.quotes[0] || '' });
    if (text.length <= 1024 * 1024) localStorage.setItem(KEY, text);
  } catch { /* Storage pressure must not interrupt the live character. */ }
}
export function clearWelcomePreview() { try { localStorage.removeItem(KEY); } catch { /* Optional cache. */ } }
