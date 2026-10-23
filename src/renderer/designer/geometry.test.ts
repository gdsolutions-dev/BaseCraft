import { describe, expect, it } from 'vitest';
import { intersects, resizeRect, type Rect } from './geometry';

const r: Rect = { left: 1000, top: 500, width: 2000, height: 400 };

describe('resizeRect', () => {
  it('moves the edges named by the handle', () => {
    expect(resizeRect(r, 'e', 100, 50, 57)).toEqual({ ...r, width: 2100 });
    expect(resizeRect(r, 's', 100, 50, 57)).toEqual({ ...r, height: 450 });
    expect(resizeRect(r, 'w', 100, 50, 57)).toEqual({ ...r, left: 1100, width: 1900 });
    expect(resizeRect(r, 'n', 100, 50, 57)).toEqual({ ...r, top: 550, height: 350 });
    expect(resizeRect(r, 'se', 100, 50, 57)).toEqual({ ...r, width: 2100, height: 450 });
    expect(resizeRect(r, 'nw', 100, 50, 57)).toEqual({ left: 1100, top: 550, width: 1900, height: 350 });
    expect(resizeRect(r, 'ne', 100, 50, 57)).toEqual({ left: 1000, top: 550, width: 2100, height: 350 });
    expect(resizeRect(r, 'sw', 100, 50, 57)).toEqual({ left: 1100, top: 500, width: 1900, height: 450 });
  });
  it('never goes below min', () => {
    expect(resizeRect(r, 'e', -5000, 0, 57).width).toBe(57);
    expect(resizeRect(r, 'w', 5000, 0, 57)).toMatchObject({ left: 2943, width: 57 }); // the right edge stays put
    expect(resizeRect(r, 'n', 0, 5000, 57)).toMatchObject({ top: 843, height: 57 });
    expect(resizeRect(r, 's', 0, -5000, 0).height).toBe(0);
  });
  it('never goes below 0, never past MAX_TWIPS', () => {
    expect(resizeRect(r, 'w', -5000, 0, 57)).toEqual({ ...r, left: 0, width: 3000 });
    expect(resizeRect(r, 'n', 0, -5000, 57)).toMatchObject({ top: 0, height: 900 });
    expect(resizeRect(r, 'e', 99999, 0, 57)).toMatchObject({ left: 1000, width: 30680 });
    expect(Object.is(resizeRect({ left: 0, top: 0, width: 100, height: 100 }, 'w', 0, 0, 0).left, 0)).toBe(true);
  });
});

describe('intersects', () => {
  it('overlap yes, touching edges and apart no, a line counts', () => {
    expect(intersects(r, { left: 2500, top: 600, width: 2000, height: 100 })).toBe(true);
    expect(intersects(r, { left: 3000, top: 500, width: 100, height: 400 })).toBe(false);
    expect(intersects(r, { left: 0, top: 0, width: 100, height: 100 })).toBe(false);
    expect(intersects(r, { left: 1500, top: 600, width: 500, height: 0 })).toBe(true);
  });
});
