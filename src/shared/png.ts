// PNG headers, read without decoding: the size a file claims, and whether it is a PNG at all. Shared by the renderer (which
// decodes) and the main process (which only ever accepts a small PNG and checks its header first).

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR = 0x49484452;

/** The size a PNG claims in its IHDR chunk (always the first), read without decoding. null: not a PNG (or cut short). */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || !PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return v.getUint32(12) === IHDR ? { width: v.getUint32(16), height: v.getUint32(20) } : null;
}
