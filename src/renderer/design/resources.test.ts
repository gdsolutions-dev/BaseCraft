import { beforeEach, expect, it, vi } from 'vitest';

const get = vi.fn();
beforeEach(() => {
  get.mockReset();
  vi.resetModules();
  vi.stubGlobal('window', { basecraft: { resources: { get, onChange: () => () => undefined } } });
});

it('one get per name; invalidate refetches', async () => {
  get.mockImplementation(async (names: string[]) => Object.fromEntries(names.map((n) => [n, `data:${n}`])));
  const { loadResources, invalidateResources } = await import('./resources');
  expect(await loadResources(['a', 'b'])).toEqual({ a: 'data:a', b: 'data:b' });
  expect(await loadResources(['a'])).toEqual({ a: 'data:a' });
  expect(get).toHaveBeenCalledTimes(1);
  invalidateResources();
  await loadResources(['a']);
  expect(get).toHaveBeenCalledTimes(2);
});

it('a failed fetch resolves to nothing, never throws', async () => {
  get.mockRejectedValue(new Error('boom'));
  const { loadResources } = await import('./resources');
  expect(await loadResources(['a'])).toEqual({});
});

it('missing names are omitted', async () => {
  get.mockResolvedValue({});
  const { loadResources } = await import('./resources');
  expect(await loadResources(['nope'])).toEqual({});
});
