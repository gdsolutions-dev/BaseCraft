import { describe, expect, it } from 'vitest';
import { nextTrail, type Trail } from './focus-trail';

describe('nextTrail', () => {
  it('A, nowhere, B: A is the previous control of B; nothing before A: null', () => {
    let t: Trail = { now: null, prev: null };
    t = nextTrail(t, 'A');
    expect(t.prev).toBeNull();
    t = nextTrail(t, null);
    expect(t).toEqual({ now: 'A', prev: null });
    t = nextTrail(t, 'B');
    expect(t).toEqual({ now: 'B', prev: 'A' });
    expect(nextTrail(t, 'B')).toBe(t);
  });
});
