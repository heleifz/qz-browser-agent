import { skinError, skinObject } from './validation.js';
export { skinError, skinObject } from './validation.js';
/** Portable, versioned welcome skins. Executable scene code is consumed only by the sandbox. */
export const SKIN_STORAGE_KEY = 'qingzhou_skins_v1';
export const SKIN_FORMAT = 'qingzhou-skin';
export const SKIN_VERSION = 1;
// Fits a 40 MiB GLB/VRM encoded as base64. Mutation replies may include both the
// edited skin and the active skin, so keep two skins below the 128 MiB wire limit.
export const MAX_SKIN_BYTES = 56 * 1024 * 1024;
export const MAX_SCENE_BYTES = 256 * 1024;
export const MAX_SCENE_MODELS = 4;
export interface SkinModel {
  src: string; source: string; animation: string; animationSpeed: number; rotationY: number;
  expressions?: Record<string, number>;
}
export interface SkinCharacter extends SkinModel {
  name: string; position: [number, number, number]; scale: number;
}
export type SkinVisual = { type: 'image2d'; src: string; darkSrc?: string }
  | { type: 'scene3d'; source: string; models?: Record<string, SkinCharacter> }
  | ({ type: 'model3d' } & SkinModel);
import { glbDataBytes, inspectGlb, MAX_GLB_BYTES } from './glb.js';
export interface WelcomeSkin {
  schemaVersion: 1;
  id: string;
  revision: number;
  name: string;
  character?: { id: string; name: string };
  visual: SkinVisual;
  quotes: string[];
  assets: Record<string, string>;
}
export interface SkinEntry { draft: WelcomeSkin; saved: WelcomeSkin }
export interface SkinLibrary { schemaVersion: 1; activeId: string; entries: SkinEntry[] }
export interface SkinSummary { id: string; name: string; character?: WelcomeSkin['character']; revision: number; type: SkinVisual['type']; modified: boolean }
export interface SkinLibrarySummary { activeId: string; skins: SkinSummary[] }
export interface SkinSnapshot extends SkinLibrarySummary { active: WelcomeSkin }
export interface SkinWelcome { activeId: string; revision: number; active?: WelcomeSkin }
export interface SkinCommand {
  action: string; id?: string; revision?: number; skin?: unknown; patch?: unknown; package?: unknown;
  sessionId?: string;
  summaryOnly?: boolean;
  saved?: boolean;
}
/** Compare portable data without allocating serialized copies of embedded model binaries. */
export function sameSkinData(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return Array.isArray(left) === Array.isArray(right) && keys.length === Object.keys(b).length
    && keys.every(key => Object.hasOwn(b, key) && sameSkinData(a[key], b[key]));
}
export function skinBytes(value: unknown): number {
  return new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).byteLength;
}
export function validateSkinImage(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:builtin:logo-(?:day|night)|data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2})$/.test(value)) {
    throw skinError('SKIN_IMAGE_INVALID');
  }
  return value;
}
function normalizeModel(value: Record<string, unknown>): SkinModel {
  if (typeof value.src !== 'string') throw skinError('SKIN_MODEL_INVALID');
  const info = inspectGlb(glbDataBytes(value.src));
  const expressions = value.expressions === undefined ? undefined : skinObject(value.expressions);
  if (expressions && Object.entries(expressions).some(([name, weight]) => !info.vrm?.expressions.includes(name)
    || typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > 1)) throw skinError('SKIN_INVALID');
  const source = value.source ?? 'return { root: model };';
  const animation = value.animation ?? 'auto', animationSpeed = value.animationSpeed ?? 1, rotationY = value.rotationY ?? 0;
  if (typeof source !== 'string' || skinBytes(source) > MAX_SCENE_BYTES || typeof animation !== 'string' || animation.length > 200
    || typeof animationSpeed !== 'number' || !Number.isFinite(animationSpeed) || animationSpeed < 0 || animationSpeed > 3
    || typeof rotationY !== 'number' || !Number.isFinite(rotationY) || Math.abs(rotationY) > 360) throw skinError('SKIN_INVALID');
  return { src: value.src, source, animation, animationSpeed, rotationY,
    ...(expressions ? { expressions: { ...expressions } as Record<string, number> } : {}) };
}
function normalizeCharacters(value: unknown): Record<string, SkinCharacter> {
  const entries = Object.entries(skinObject(value));
  if (!entries.length || entries.length > MAX_SCENE_MODELS) throw skinError('SKIN_CHARACTERS_LIMIT');
  let bytes = 0;
  const result = Object.fromEntries(entries.map(([id, raw]) => {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw skinError('SKIN_INVALID');
    const data = skinObject(raw), model = normalizeModel(data);
    bytes += glbDataBytes(model.src).byteLength;
    const position = data.position ?? [0, 0, 0], scale = data.scale ?? 1;
    if (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 100
      || !Array.isArray(position) || position.length !== 3 || position.some(n => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 100)
      || typeof scale !== 'number' || !Number.isFinite(scale) || scale < .01 || scale > 100) throw skinError('SKIN_INVALID');
    return [id, { ...model, name: data.name.trim(), position: [...position] as [number, number, number], scale }];
  }));
  // Preserve the existing skin, storage and transport budgets across all characters together.
  if (bytes > MAX_GLB_BYTES) throw skinError('SKIN_SCENE_TOO_LARGE');
  return result;
}
export function normalizeSkin(value: unknown): WelcomeSkin {
  const data = skinObject(value);
  if (data.schemaVersion !== 1) throw skinError('SKIN_VERSION_UNSUPPORTED');
  if (skinBytes(data) > MAX_SKIN_BYTES) throw skinError('SKIN_TOO_LARGE');
  if (typeof data.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(data.id)
    || !Number.isSafeInteger(data.revision) || Number(data.revision) < 1
    || typeof data.name !== 'string' || !data.name.trim() || data.name.length > 100) throw skinError('SKIN_INVALID');
  const visual = skinObject(data.visual);
  const character = data.character === undefined ? undefined : skinObject(data.character);
  if (character && (typeof character.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(character.id)
    || typeof character.name !== 'string' || !character.name.trim() || character.name.length > 100)) throw skinError('SKIN_INVALID');
  let normalizedVisual: SkinVisual;
  if (visual.type === 'image2d') {
    normalizedVisual = { type: 'image2d', src: validateSkinImage(visual.src),
      ...(visual.darkSrc === undefined ? {} : { darkSrc: validateSkinImage(visual.darkSrc) }) };
  } else if (visual.type === 'scene3d' && typeof visual.source === 'string' && visual.source.trim()) {
    if (skinBytes(visual.source) > MAX_SCENE_BYTES) throw skinError('SKIN_TOO_LARGE');
    normalizedVisual = { type: 'scene3d', source: visual.source,
      ...(visual.models === undefined ? {} : { models: normalizeCharacters(visual.models) }) };
  } else if (visual.type === 'model3d' && typeof visual.src === 'string') {
    normalizedVisual = { type: 'model3d', ...normalizeModel(visual) };
  } else throw skinError('SKIN_INVALID');
  if (!Array.isArray(data.quotes) || data.quotes.length > 100 || data.quotes.some(text => typeof text !== 'string' || text.length > 300)) throw skinError('SKIN_INVALID');
  const assets = skinObject(data.assets ?? {});
  if (Object.keys(assets).length > 30 || Object.keys(assets).some(key => !/^[a-zA-Z0-9_-]{1,80}$/.test(key))) throw skinError('SKIN_INVALID');
  return { schemaVersion: 1, id: data.id, revision: Number(data.revision), name: data.name.trim(), visual: normalizedVisual,
    ...(character ? { character: { id: String(character.id), name: String(character.name).trim() } } : {}),
    quotes: data.quotes.map(text => String(text)), assets: Object.fromEntries(Object.entries(assets).map(([key, value]) => [key, validateSkinImage(value)])) };
}
export function parseSkinPackage(value: unknown): WelcomeSkin {
  const data = skinObject(value);
  if (data.format !== SKIN_FORMAT || data.version !== SKIN_VERSION) throw skinError('SKIN_VERSION_UNSUPPORTED');
  return normalizeSkin(data.skin);
}
export function exportSkinPackage(skin: WelcomeSkin) {
  return { format: SKIN_FORMAT, version: SKIN_VERSION, skin: normalizeSkin(skin) };
}
export function chooseSkinQuote(quotes: readonly string[], previous = '', random = Math.random): string {
  const choices = quotes.filter(text => text.trim() && text !== previous);
  return choices.length ? choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))]! : quotes[0] || '';
}
