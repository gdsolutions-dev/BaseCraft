import { describe, expect, test, vi } from 'vitest';

describe('assertUnder', () => {
  test('FACTOR 2 : 90 ms sous une limite de 50 ms passe, 110 ms échoue', async () => {
    vi.stubEnv('BASECRAFT_BENCH_STRICT', '1');
    vi.stubEnv('BASECRAFT_BENCH_FACTOR', '2');
    vi.resetModules();
    const { assertUnder, FACTOR } = await import('./thresholds');
    expect(FACTOR).toBe(2);
    expect(() => assertUnder('page', 90, 50)).not.toThrow();
    expect(() => assertUnder('page', 110, 50)).toThrow('page: 110 ms > 100 ms');
    vi.unstubAllEnvs();
  });
  test('hors mode strict, ne lève jamais', async () => {
    vi.stubEnv('BASECRAFT_BENCH_STRICT', '0');
    vi.resetModules();
    const { assertUnder } = await import('./thresholds');
    expect(() => assertUnder('page', 9999, 50)).not.toThrow();
    vi.unstubAllEnvs();
  });
});
