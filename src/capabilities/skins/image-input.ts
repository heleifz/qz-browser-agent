import type { ToolExtensionAPI } from '#sdk/background';
import { getImageAsset } from '#sdk/shared/data';
import { normalizeImage, readImageInput, readImageResponse } from '#sdk/shared/images';
import { skinError, skinObject, validateSkinImage } from '#sdk/shared/skins';

type ImageHost = Pick<ToolExtensionAPI, 'assertUrlAllowed' | 'getSecurityGuardrails'>;
interface ImageDependencies {
  fetch: typeof fetch;
  getAsset: typeof getImageAsset;
  normalize: typeof normalizeImage;
}

/** Resolve tool inputs before committing; portable skins contain only local raster bytes. */
export async function resolveSkinImages(value: unknown, host: ImageHost, signal?: AbortSignal,
  dependencies: ImageDependencies = { fetch: (input, init) => fetch(input, init), getAsset: getImageAsset, normalize: normalizeImage }): Promise<unknown> {
  signal?.throwIfAborted();
  const data = skinObject(value);
  if (data.visual === undefined) return data;
  const visual = skinObject(data.visual);
  if (visual.type !== 'image2d') return data;
  const resolved = { ...visual };
  for (const field of ['src', 'darkSrc']) {
    if (visual[field] === undefined) continue;
    resolved[field] = await resolveImage(visual[field], host, signal, dependencies);
    signal?.throwIfAborted();
  }
  return { ...data, visual: resolved };
}

async function resolveImage(value: unknown, host: ImageHost, signal: AbortSignal | undefined, deps: ImageDependencies) {
  if (typeof value !== 'string') throw skinError('SKIN_IMAGE_INVALID');
  if (value.startsWith('builtin:')) return validateSkinImage(value);
  let blob: Blob;
  if (value.startsWith('asset:image:')) {
    if (value.length > 180) throw skinError('SKIN_IMAGE_INVALID');
    const asset = await deps.getAsset(value, { touch: false });
    signal?.throwIfAborted();
    if (!asset) throw skinError('SKIN_IMAGE_NOT_FOUND');
    blob = asset.blob;
  } else if (value.startsWith('data:')) {
    validateSkinImage(value);
    blob = (await readImageInput(value, signal)).blob;
  } else {
    let url: URL;
    try { url = new URL(value); } catch { throw skinError('SKIN_IMAGE_INVALID'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw skinError('SKIN_IMAGE_INVALID');
    const guardrails = await host.getSecurityGuardrails();
    signal?.throwIfAborted();
    host.assertUrlAllowed(url.href, guardrails, { tool: 'manage_skin', source: 'image' });
    let response: Response;
    try {
      // Use a direct image URL. Do not fetch an unchecked redirect destination or send site cookies.
      response = await deps.fetch(url.href, { signal, redirect: 'error', credentials: 'omit', cache: 'force-cache' });
    } catch {
      signal?.throwIfAborted();
      throw skinError('SKIN_IMAGE_FETCH_FAILED');
    }
    if (!response.ok) { await response.body?.cancel(); throw skinError('SKIN_IMAGE_FETCH_FAILED'); }
    blob = await readImageResponse(response, { signal });
  }
  signal?.throwIfAborted();
  // Sniff actual raster bytes: image hosts often send application/octet-stream, or HTML on failure.
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const magic = String.fromCharCode(...bytes);
  const mime = magic.startsWith('\x89PNG\r\n\x1a\n') ? 'image/png'
    : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'image/jpeg'
    : /^GIF8[79]a/.test(magic) ? 'image/gif'
    : magic.startsWith('RIFF') && magic.slice(8) === 'WEBP' ? 'image/webp' : '';
  if (!mime) throw skinError('SKIN_IMAGE_INVALID');
  // Shared decoding bounds memory and output (2048 px / 2 MiB), retaining alpha and fitting GIFs.
  const image = await deps.normalize(blob.slice(0, blob.size, mime), { signal });
  signal?.throwIfAborted();
  return validateSkinImage(image.dataUrl);
}
