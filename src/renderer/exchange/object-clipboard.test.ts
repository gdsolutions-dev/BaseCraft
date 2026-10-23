import { afterEach, describe, expect, it, vi } from 'vitest';
import { getClip, onClip, setClip } from './object-clipboard';

afterEach(() => setClip(null));

describe('object clipboard', () => {
  it('keeps the last clip and tells its listeners, until they unsubscribe', () => {
    const cb = vi.fn();
    const off = onClip(cb);
    setClip({ kind: 'table', name: 'Clients', cut: false });
    expect(getClip()).toEqual({ kind: 'table', name: 'Clients', cut: false });
    setClip(null);
    expect(getClip()).toBeNull();
    expect(cb).toHaveBeenCalledTimes(2);
    off();
    setClip({ kind: 'form', name: 'F', cut: true });
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
