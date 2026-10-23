import { afterEach, describe, expect, it, vi } from 'vitest';
import { SPLIT_DEFAULT, clamp, loadRatio, parseRatio, pxToRatio, ratioToPx, saveRatio } from './splitter-model';

describe('splitter model', () => {
  it('clamps to the limits, the lower one winning when they cross', () => {
    expect(clamp(5, 10, 100)).toBe(10);
    expect(clamp(500, 10, 100)).toBe(100);
    expect(clamp(50, 10, 100)).toBe(50);
    expect(clamp(50, 10, 4)).toBe(10);
  });

  it('turns a ratio into a clamped size, so the limits hold when the window shrinks', () => {
    expect(ratioToPx(0.6, 1000, 124, 128)).toBe(600);
    expect(ratioToPx(0.05, 1000, 124, 128)).toBe(124);
    expect(ratioToPx(0.99, 1000, 124, 128)).toBe(872);
    expect(ratioToPx(0.6, 200, 124, 128)).toBe(124); // too small for both: the first minimum is kept
  });

  it('turns a size back into a ratio', () => {
    expect(pxToRatio(250, 1000)).toBe(0.25);
    expect(pxToRatio(250, 0)).toBe(SPLIT_DEFAULT);
  });

  it('accepts only a ratio strictly between 0 and 1', () => {
    expect(parseRatio('0.35')).toBe(0.35);
    for (const bad of [null, undefined, '', ' ', 'abc', '0', '1', '-0.2', '1.5', 'NaN', 'Infinity']) expect(parseRatio(bad)).toBe(SPLIT_DEFAULT);
  });

  describe('storage', () => {
    afterEach(() => vi.unstubAllGlobals());
    it('round-trips a ratio', () => {
      const mem = new Map<string, string>();
      vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) });
      expect(loadRatio('k')).toBe(SPLIT_DEFAULT);
      saveRatio('k', 0.4);
      expect(loadRatio('k')).toBe(0.4);
    });
    it('never throws when storage is unavailable', () => {
      const boom = () => { throw new Error('blocked'); };
      vi.stubGlobal('localStorage', { getItem: boom, setItem: boom });
      expect(loadRatio('k')).toBe(SPLIT_DEFAULT);
      expect(() => saveRatio('k', 0.4)).not.toThrow();
    });
  });
});
