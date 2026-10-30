import { skinError } from './validation.js';

export interface SkinViewState {
  position: [number, number, number];
  elapsed: number;
  quality: number;
}
export interface SkinPreview { image: string; width: number; height: number; view?: SkinViewState }

export function readSkinView(value: unknown): SkinViewState | undefined {
  if (!value || typeof value !== 'object') return;
  const view = value as SkinViewState;
  if (!Array.isArray(view.position) || view.position.length !== 3 || view.position.some(n => !Number.isFinite(n))
    || Math.hypot(...view.position) < 1 || Math.hypot(...view.position) > 1000
    || !Number.isFinite(view.elapsed) || view.elapsed < 0 || !Number.isFinite(view.quality) || view.quality < .1 || view.quality > 1) return;
  return { position: [...view.position], elapsed: view.elapsed, quality: view.quality };
}

/** Sandbox images are untrusted messages, never arbitrary image URLs or executable data. */
export function readSkinPreview(value: unknown): SkinPreview {
  const preview = value as SkinPreview | undefined;
  if (!preview || typeof preview.image !== 'string' || preview.image.length > 6 * 1024 * 1024
    || !/^data:image\/(?:png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(preview.image)
    || !Number.isInteger(preview.width) || !Number.isInteger(preview.height)
    || preview.width < 1 || preview.height < 1 || preview.width > 1024 || preview.height > 1024) throw skinError('SKIN_PREVIEW_UNAVAILABLE');
  const view = readSkinView(preview.view);
  return { image: preview.image, width: preview.width, height: preview.height, ...(view ? { view } : {}) };
}
