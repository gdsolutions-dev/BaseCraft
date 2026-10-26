// The application icon, in the sandboxed renderer: a picture (from the file the owner chose, or the one stored in the base,
// both untrusted) is decoded here and only here, then re-encoded to a small PNG. The main process never decodes anything else.

import { pngSize } from '../../shared/png';

export { pngSize };

/** A PNG wider or taller than this is never decoded (a small file may claim a picture of billions of pixels, R9). */
export const MAX_DECODE_PX = 1024;

export function base64ToBytes(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export function bytesToBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); // in pieces: a spread has an argument limit
  return btoa(s);
}

/** The icon stored in a base is untrusted: it must be a PNG whose IHDR (first chunk) says its size, so that R9's size check
 *  always runs before any decoding. Rejects bc:badIcon. (`iconPng` alone lets the owner's JPEG, ICO, GIF and BMP picks through.) */
export async function storedIconPng(bytes: Uint8Array): Promise<Uint8Array> {
  if (!pngSize(bytes)) throw new Error('bc:badIcon');
  return iconPng(bytes);
}

/** Decodes (createImageBitmap) and re-encodes to a PNG fitting `max` × `max`, ratio kept, never enlarged. A PNG larger than
 *  MAX_DECODE_PX either side is refused before decoding. Rejects bc:badIcon. */
export async function iconPng(bytes: Uint8Array, max = 256): Promise<Uint8Array> {
  const claimed = pngSize(bytes);
  if (claimed && (claimed.width === 0 || claimed.height === 0 || claimed.width > MAX_DECODE_PX || claimed.height > MAX_DECODE_PX)) throw new Error('bc:badIcon');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(new Blob([bytes as BlobPart])); } catch { throw new Error('bc:badIcon'); } // not a picture the browser reads
  try {
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
    return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  } catch { throw new Error('bc:badIcon'); } finally { bitmap.close(); }
}
