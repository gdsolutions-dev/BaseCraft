import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { isSlow, subscribeSlow, track } from './running';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it('a tracked call becomes slow after a second, and stops being slow when it settles (even rejected)', async () => {
  let notified = 0;
  const off = subscribeSlow(() => { notified++; });
  let end!: () => void;
  let fail!: (e: Error) => void;
  const a = track(new Promise<void>((r) => { end = r; }));
  const b = track(new Promise<void>((_, r) => { fail = r; }));
  vi.advanceTimersByTime(999);
  expect(isSlow()).toBe(false);
  vi.advanceTimersByTime(1);
  expect(isSlow()).toBe(true);
  end();
  await a;
  expect(isSlow()).toBe(true); // b still runs
  fail(new Error('bc:cancelled'));
  await expect(b).rejects.toThrow('bc:cancelled');
  expect(isSlow()).toBe(false);
  expect(notified).toBeGreaterThan(0);
  off();
});

it('a quick call never shows', async () => {
  await track(Promise.resolve(1));
  vi.advanceTimersByTime(2000);
  expect(isSlow()).toBe(false);
});
