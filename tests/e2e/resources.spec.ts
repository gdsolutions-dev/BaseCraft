// F3 Task 2: the base's shared image gallery (bc_resources) through window.basecraft.
import { test, expect } from '@playwright/test';
import type { BasecraftApi } from '../../src/shared/api';
import { launchApp, seedBase } from './helpers';

const PNG = (extra: number) => `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, ...new Array(extra).fill(7)]).toString('base64')}`;
const SVG = 'data:image/svg+xml;base64,PHN2Zy8+';
type W = { basecraft: BasecraftApi };

test('add, list, get, replace, remove; an SVG is refused; the gallery persists after reopening', async () => {
  const p = seedBase('resources');
  const { app, page } = await launchApp({ args: [p] });
  try {
    const call = (m: 'list' | 'get' | 'add' | 'replace' | 'remove', ...args: unknown[]) =>
      page.evaluate(([method, a]) => ((window as unknown as W).basecraft.resources as unknown as Record<string, (...x: unknown[]) => Promise<unknown>>)[method as string](...(a as unknown[])), [m, args] as const);

    expect(await call('list')).toEqual([]);
    expect(await call('add', 'logo', PNG(0))).toBe('logo');
    expect(await call('add', 'logo', PNG(1))).toBe('logo (2)');
    expect(await call('list')).toEqual([{ name: 'logo', type: 'png', bytes: 7 }, { name: 'logo (2)', type: 'png', bytes: 8 }]);
    expect(await call('get', ['logo', 'nope'])).toEqual({ logo: PNG(0) });
    await call('replace', 'logo', PNG(4));
    expect(await call('get', ['logo'])).toEqual({ logo: PNG(4) });
    await expect(call('add', 'x', SVG)).rejects.toThrow(/bc:invalidPicture/);
    await expect(call('remove', 'nope')).rejects.toThrow(/bc:resourceNotFound/);
    await call('remove', 'logo (2)');

    await page.evaluate(async (path) => {
      const b = (window as unknown as W).basecraft.base;
      await b.close();
      await b.open(path);
    }, p);
    expect(await call('list')).toEqual([{ name: 'logo', type: 'png', bytes: 11 }]);
  } finally { await app.close(); }
});

test('read-only base: reads work, writes reject bc:readOnly', async () => {
  const p = seedBase('resources-ro');
  const a = await launchApp({ args: [p] });
  try {
    await a.page.evaluate((u) => (window as unknown as W).basecraft.resources.add('logo', u), PNG(0));
    const { app, page } = await launchApp({ args: [p] }); // the second window opens read-only
    try {
      const w = (fn: string) => page.evaluate(`(window.basecraft.resources.${fn})`);
      expect(await w('list()')).toEqual([{ name: 'logo', type: 'png', bytes: 7 }]);
      expect(await w(`get(['logo'])`)).toEqual({ logo: PNG(0) });
      await expect(w(`add('b', ${JSON.stringify(PNG(0))})`)).rejects.toThrow(/bc:readOnly/);
      await expect(w(`replace('logo', ${JSON.stringify(PNG(1))})`)).rejects.toThrow(/bc:readOnly/);
      await expect(w(`remove('logo')`)).rejects.toThrow(/bc:readOnly/);
    } finally { await app.close(); }
  } finally { await a.app.close(); }
});
