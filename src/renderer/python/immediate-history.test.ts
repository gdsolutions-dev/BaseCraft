import { describe, expect, it } from 'vitest';
import { ImmediateHistory } from './immediate-history';

describe('ImmediateHistory', () => {
  it('browses back, stops at the oldest, skips consecutive duplicates', () => {
    const h = new ImmediateHistory();
    h.push('a'); h.push('b'); h.push('b');
    expect(h.prev('')).toBe('b');
    expect(h.prev('')).toBe('a');
    expect(h.prev('')).toBe('a');
    expect(h.next()).toBe('b');
  });
  it('gives the draft back past the newest', () => {
    const h = new ImmediateHistory();
    h.push('a');
    expect(h.prev('typed')).toBe('a');
    expect(h.next()).toBe('typed');
  });
  it('keeps 200 entries', () => {
    const h = new ImmediateHistory();
    for (let i = 0; i < 201; i++) h.push(`l${i}`);
    let n = 0, last = '';
    for (;;) { const v = h.prev(''); if (v === last) break; last = v; n++; }
    expect(n).toBe(200);
    expect(last).toBe('l1');
  });
});
