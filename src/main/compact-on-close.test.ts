import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompactResult } from '../shared/api';
import { DEFAULT_STARTUP, type StartupOptions } from '../shared/startup';
import { compactOnClose, OPTIONS_READ_MS, whileCompacting } from './compact-on-close';

const ok = (repaired: string[] = []): CompactResult => ({ ok: true, backupPath: '/b/x.backup-1.basecraft', sizeBefore: 9, sizeAfter: 3, repaired });
const asked = (o: Partial<StartupOptions> = {}) => async () => ({ ...DEFAULT_STARTUP, compactOnClose: true, ...o });

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => { logged = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.useRealTimers(); logged.mockRestore(); });

describe('compactOnClose', () => {
  it('compacts and drops the backup when asked and writable', async () => {
    const compact = vi.fn(async () => ok());
    const unlink = vi.fn();
    expect(await compactOnClose({ startup: asked(), compact }, { readOnly: false }, unlink)).toBe('compacted');
    expect(compact).toHaveBeenCalledOnce();
    expect(unlink).toHaveBeenCalledExactlyOnceWith('/b/x.backup-1.basecraft');
  });

  it('keeps the backup when the compact repaired something', async () => {
    const unlink = vi.fn();
    expect(await compactOnClose({ startup: asked(), compact: async () => ok(['row 3 missing from index']) }, { readOnly: false }, unlink)).toBe('compacted');
    expect(unlink).not.toHaveBeenCalled();
  });

  it('does nothing read-only, to recover, or when not asked', async () => {
    const compact = vi.fn(async () => ok());
    const startup = vi.fn(asked());
    const unlink = vi.fn();
    expect(await compactOnClose({ startup, compact }, { readOnly: true }, unlink)).toBe('skipped');
    expect(await compactOnClose({ startup, compact }, { readOnly: false, needsRecovery: true }, unlink)).toBe('skipped');
    expect(startup).not.toHaveBeenCalled();   // a base this session cannot write is not even read
    expect(await compactOnClose({ startup: asked({ compactOnClose: false }), compact }, { readOnly: false }, unlink)).toBe('skipped');
    expect(compact).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
  });

  it('compact on close is skipped in shared mode, runs once exclusive', async () => { // C3 R4
    const compact = vi.fn(async () => ok());
    const unlink = vi.fn();
    expect(await compactOnClose({ startup: asked(), compact }, { readOnly: false, shared: true }, unlink)).toBe('skipped');
    expect(compact).not.toHaveBeenCalled();
    expect(await compactOnClose({ startup: asked(), compact }, { readOnly: false }, unlink)).toBe('compacted');
  });

  it('a failing compact or options read is logged, never thrown', async () => {
    const unlink = vi.fn();
    expect(await compactOnClose({ startup: asked(), compact: async () => { throw new Error('bc:copyFailed|ENOSPC|disk full'); } }, { readOnly: false }, unlink)).toBe('failed');
    expect(await compactOnClose({ startup: async () => { throw new Error('bc:cannotOpen'); }, compact: async () => ok() }, { readOnly: false }, unlink)).toBe('failed');
    expect(logged).toHaveBeenCalledTimes(2);
    expect(unlink).not.toHaveBeenCalled();   // a failed compact keeps its backup
  });

  it('a base busy with a call that never ends: the options read gives up, nothing is compacted, the close goes on', async () => {
    vi.useFakeTimers();
    const compact = vi.fn(async () => ok());
    const unlink = vi.fn();
    const done = compactOnClose({ startup: () => new Promise(() => {}), compact }, { readOnly: false }, unlink);   // behind a call in flight
    await vi.advanceTimersByTimeAsync(OPTIONS_READ_MS - 1);
    let settled = false;
    void done.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await done).toBe('skipped');
    expect(compact).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);   // nothing left running that would keep the quit waiting
  });

  it('an options read that answers in time (after a short call) still compacts', async () => {
    vi.useFakeTimers();
    const compact = vi.fn(async () => ok());
    const startup = () => new Promise<StartupOptions>((r) => setTimeout(() => r({ ...DEFAULT_STARTUP, compactOnClose: true }), OPTIONS_READ_MS - 500));
    const done = compactOnClose({ startup, compact }, { readOnly: false }, vi.fn());
    await vi.advanceTimersByTimeAsync(OPTIONS_READ_MS);
    expect(await done).toBe('compacted');
    expect(compact).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a base found corrupt (the copy failed too) is a failure that keeps its backup', async () => {
    const unlink = vi.fn();
    const corrupt: CompactResult = { ok: false, reason: 'corrupt', problems: ['page 4 is bad'], backupPath: '/b/x.backup-1.basecraft' };
    expect(await compactOnClose({ startup: asked(), compact: async () => corrupt }, { readOnly: false }, unlink)).toBe('failed');
    expect(unlink).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledOnce();
  });

  it('a backup that cannot be removed is logged; the base is compacted all the same', async () => {
    const unlink = vi.fn(() => { throw new Error('EPERM'); });
    expect(await compactOnClose({ startup: asked(), compact: async () => ok() }, { readOnly: false }, unlink)).toBe('compacted');
    expect(logged).toHaveBeenCalledOnce();
  });
});

describe('whileCompacting', () => {
  const hooks = () => { const stop = vi.fn(); return { beat: vi.fn(), notice: vi.fn(() => stop), stop, every: 10, after: 25 }; };
  /** A compact that ends when `end` is called. */
  const pending = () => { let end!: (v: string) => void, fail!: (e: Error) => void; const p = new Promise<string>((a, b) => { end = a; fail = b; }); return { p, end, fail }; };

  it('beats the lock while the compact runs (the main process no longer does), then stops', async () => {
    vi.useFakeTimers();
    const h = hooks(), c = pending();
    const done = whileCompacting(c.p, h);
    expect(h.beat).toHaveBeenCalledTimes(1);   // at once: the last beat of the main process may be 10 s old
    await vi.advanceTimersByTimeAsync(35);
    expect(h.beat).toHaveBeenCalledTimes(4);
    c.end('r');
    expect(await done).toBe('r');
    await vi.advanceTimersByTimeAsync(100);
    expect(h.beat).toHaveBeenCalledTimes(4);
  });

  it('tells the user once when it takes long, and ends the notice when the compact does (also on failure)', async () => {
    vi.useFakeTimers();
    const h = hooks(), c = pending();
    const done = whileCompacting(c.p, h);
    await vi.advanceTimersByTimeAsync(24);
    expect(h.notice).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10);
    expect(h.notice).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(100);
    expect(h.notice).toHaveBeenCalledOnce();
    expect(h.stop).not.toHaveBeenCalled();
    c.fail(new Error('bc:copyFailed'));
    await expect(done).rejects.toThrow('bc:copyFailed');   // compactOnClose logs it
    expect(h.stop).toHaveBeenCalledOnce();
  });

  it('says nothing when the compact is quick', async () => {
    vi.useFakeTimers();
    const h = hooks(), c = pending();
    const done = whileCompacting(c.p, h);
    await vi.advanceTimersByTimeAsync(5);
    c.end('r');
    await done;
    await vi.advanceTimersByTimeAsync(100);
    expect(h.notice).not.toHaveBeenCalled();
  });

  it('a heartbeat or a notice that throws is logged and does not touch the compact', async () => {
    vi.useFakeTimers();
    const h = hooks(), c = pending();
    h.beat.mockImplementation(() => { throw new Error('EBUSY'); });
    h.notice.mockImplementation(() => { throw new Error('no display'); });
    const done = whileCompacting(c.p, h);
    await vi.advanceTimersByTimeAsync(40);
    c.end('r');
    expect(await done).toBe('r');
    expect(logged).toHaveBeenCalled();
  });
});
