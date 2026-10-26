import { describe, expect, it, vi } from 'vitest';
import { base64ToBytes, bytesToBase64, iconPng, pngSize, storedIconPng } from './app-icon';

const PNG_1PX = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
/** The same PNG with another size in its IHDR chunk (the checksum is not redone: only the header is read). */
function withIhdr(png: Uint8Array, width: number, height: number): Uint8Array {
  const out = png.slice();
  const v = new DataView(out.buffer);
  v.setUint32(16, width); v.setUint32(20, height);
  return out;
}

describe('application icon, pure parts', () => {
  it('reads a PNG size from its header without decoding', () => {
    expect(pngSize(PNG_1PX)).toEqual({ width: 1, height: 1 });
    expect(pngSize(withIhdr(PNG_1PX, 30_000, 30_000))).toEqual({ width: 30_000, height: 30_000 }); // refused before decoding (iconPng)
    expect(pngSize(new TextEncoder().encode('GIF89a'))).toBeNull();
    expect(pngSize(PNG_1PX.slice(0, 20))).toBeNull(); // cut inside the header
    expect(pngSize(new Uint8Array(8).fill(0))).toBeNull();
    const noIhdr = PNG_1PX.slice(); noIhdr[12] = 0x58; // the signature, then a chunk that is no IHDR
    expect(pngSize(noIhdr)).toBeNull();
  });
  it('base64 round trip', () => {
    expect(base64ToBytes(bytesToBase64(PNG_1PX))).toEqual(PNG_1PX);
    const big = Uint8Array.from({ length: 300_000 }, (_, i) => i % 251); // past any argument-count limit of a spread
    expect(base64ToBytes(bytesToBase64(big))).toEqual(big);
  });
  it('a stored icon with no readable IHDR size is refused before any decoding (R9); a pick in another format still reaches the decoder', async () => {
    const decode = vi.fn().mockRejectedValue(new Error('not a picture'));
    vi.stubGlobal('createImageBitmap', decode);
    try {
      const noIhdr = PNG_1PX.slice(); noIhdr[12] = 0x58;
      for (const bad of [noIhdr, PNG_1PX.slice(0, 20), new TextEncoder().encode('GIF89a'), withIhdr(PNG_1PX, 30_000, 30_000)]) {
        await expect(storedIconPng(bad)).rejects.toThrow('bc:badIcon');
      }
      expect(decode).not.toHaveBeenCalled();
      await expect(iconPng(noIhdr)).rejects.toThrow('bc:badIcon');   // iconPng stays permissive (JPEG, ICO, GIF, BMP picks)...
      expect(decode).toHaveBeenCalledTimes(1);                        // ...and hands them to the decoder
      await expect(storedIconPng(PNG_1PX)).rejects.toThrow('bc:badIcon');   // a sound PNG does reach it (the stub refuses)
      expect(decode).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
