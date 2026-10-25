import { bytesToBase64 } from "./pdf-raster.js";

export interface ImageClip { x: number; y: number; width: number; height: number; scale: number }

/** Crop a captured viewport image. Coordinates are CSS pixels in that viewport. */
export async function cropDataUrl(dataUrl: string, clip: ImageClip, cssWidth: number, cssHeight: number, format: string): Promise<string> {
  const bytes = decodeDataUrl(dataUrl);
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") return stripDataUrl(dataUrl);
  const source = await createImageBitmap(bytesBlob(bytes));
  try {
    const scaleX = cssWidth > 0 ? source.width / cssWidth : 1;
    const scaleY = cssHeight > 0 ? source.height / cssHeight : 1;
    const sx = clamp(Math.round(clip.x * scaleX), 0, Math.max(0, source.width - 1));
    const sy = clamp(Math.round(clip.y * scaleY), 0, Math.max(0, source.height - 1));
    const sw = clamp(Math.round(clip.width * scaleX), 1, source.width - sx);
    const sh = clamp(Math.round(clip.height * scaleY), 1, source.height - sy);
    const ratio = clip.scale > 0 ? clip.scale : 1;
    const width = Math.max(1, Math.round(sw / scaleX * ratio));
    const height = Math.max(1, Math.round(sh / scaleY * ratio));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) return stripDataUrl(dataUrl);
    context.drawImage(source, sx, sy, sw, sh, 0, 0, width, height);
    return blobToBase64(await canvas.convertToBlob({ type: imageType(format), quality: 0.9 }));
  } finally {
    source.close();
  }
}

/** Place captured pieces in rows, then apply the screenshot scale. */
export async function stitchTiles(rows: readonly (readonly string[])[], scale: number, format: string): Promise<string> {
  const flat = rows.flatMap(row => row.filter(tile => tile));
  if (!flat.length) return "";
  if (rows.every(row => row.length <= 1)) return stackTiles(flat, scale, format);
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") return flat[0];

  const rowLayouts = [];
  for (const row of rows) {
    const tiles = row.filter(tile => tile);
    if (!tiles.length) continue;
    let rowWidth = 0;
    let rowHeight = 0;
    for (const tile of tiles) {
      const bitmap = await decodeTile(tile);
      rowWidth += bitmap.width;
      rowHeight = Math.max(rowHeight, bitmap.height);
      bitmap.close();
    }
    rowLayouts.push({ tiles, rowWidth, rowHeight });
  }
  if (!rowLayouts.length) return flat[0];

  const width = Math.max(1, ...rowLayouts.map(layout => layout.rowWidth));
  const height = rowLayouts.reduce((sum, layout) => sum + layout.rowHeight, 0) || 1;
  const ratio = scale > 0 ? scale : 1;
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio)));
  const context = canvas.getContext("2d");
  if (!context) return flat[0];

  let y = 0;
  for (const layout of rowLayouts) {
    let x = 0;
    for (const tile of layout.tiles) {
      const bitmap = await decodeTile(tile);
      try {
        context.drawImage(bitmap, x, y, bitmap.width * ratio, bitmap.height * ratio);
        x += bitmap.width * ratio;
      } finally {
        bitmap.close();
      }
    }
    y += layout.rowHeight * ratio;
  }
  return blobToBase64(await canvas.convertToBlob({ type: imageType(format), quality: 0.9 }));
}

/** Stack viewport tiles from top to bottom and apply the screenshot scale. */
export async function stackTiles(tiles: readonly string[], scale: number, format: string): Promise<string> {
  if (!tiles.length) return "";
  if (tiles.length === 1 && scale === 1) return tiles[0];
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") return tiles[0];

  let width = 1;
  let height = 0;
  for (const tile of tiles) {
    const bitmap = await decodeTile(tile);
    width = Math.max(width, bitmap.width);
    height += bitmap.height;
    bitmap.close();
  }
  if (!height) return tiles[0];

  const ratio = scale > 0 ? scale : 1;
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio)));
  const context = canvas.getContext("2d");
  if (!context) return tiles[0];

  let y = 0;
  for (const tile of tiles) {
    const bitmap = await decodeTile(tile);
    try {
      context.drawImage(bitmap, 0, y, bitmap.width * ratio, bitmap.height * ratio);
      y += bitmap.height * ratio;
    } finally {
      bitmap.close();
    }
  }
  return blobToBase64(await canvas.convertToBlob({ type: imageType(format), quality: 0.9 }));
}

export function decodeDataUrl(value: string): Uint8Array {
  return decodeBase64(stripDataUrl(value));
}

export function stripDataUrl(value: string): string {
  const comma = value.indexOf(",");
  return comma >= 0 && value.startsWith("data:") ? value.slice(comma + 1) : value;
}

async function decodeTile(tile: string) {
  return createImageBitmap(bytesBlob(decodeBase64(tile)));
}

function bytesBlob(bytes: Uint8Array): Blob {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy]);
}

function imageType(format: string): string {
  return format === "png" ? "image/png" : "image/jpeg";
}

async function blobToBase64(blob: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
