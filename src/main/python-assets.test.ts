// @ts-expect-error plain .mjs script, no types
import { closure, trimLock, preparePythonAssets, PYTHON_LICENSES } from '../../scripts/python-assets.mjs';
import { createHash } from 'node:crypto';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const bytes = (s: string) => new TextEncoder().encode(s);
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const pkg = (n: string, depends: string[] = [], body = n) => ({ name: n, version: '1', file_name: `${n}.whl`, sha256: sha(bytes(body)), depends });
const lockOf = (...ps: ReturnType<typeof pkg>[]) => ({ info: { python: '3.14.2' }, packages: Object.fromEntries(ps.map((p) => [p.name, p])) });
const real = () => lockOf(pkg('numpy'), pkg('pandas', ['numpy', 'python-dateutil', 'pytz']), pkg('python-dateutil', ['six']), pkg('six'), pkg('pytz'), pkg('scipy', ['numpy']));
const tmp = () => mkdtempSync(join(tmpdir(), 'bc-py-'));

describe('python assets', () => {
  it('closure of pandas', () => {
    expect(closure(real(), ['pandas']).sort()).toEqual(['numpy', 'pandas', 'python-dateutil', 'pytz', 'six']);
  });
  it('trimLock keeps info and the named packages', () => {
    const t = trimLock(real(), ['six', 'pytz']);
    expect(t.info).toEqual({ python: '3.14.2' });
    expect(Object.keys(t.packages).sort()).toEqual(['pytz', 'six']);
  });
  it('a package without licence throws', async () => {
    const lock = lockOf(pkg('numpy'), pkg('pandas', ['mystery']), pkg('mystery'));
    await expect(preparePythonAssets({ out: tmp(), cache: tmp(), lock, fetchImpl: async () => new Response(bytes('x')) })).rejects.toThrow('no licence for mystery');
    expect(PYTHON_LICENSES.numpy).toBe('BSD-3-Clause');
  });
  it('wrong bytes: sha256 mismatch', async () => {
    await expect(preparePythonAssets({ out: tmp(), cache: tmp(), lock: real(), fetchImpl: async () => new Response(bytes('bad')) })).rejects.toThrow('sha256 mismatch for numpy.whl');
  });
  it('second run uses the cache', async () => {
    const cache = tmp(), out = tmp();
    let calls = 0;
    const fetchImpl = async (u: string) => { calls++; return new Response(bytes(u.split('/').pop()!.replace('.whl', ''))); };
    const r = await preparePythonAssets({ out, cache, lock: real(), fetchImpl });
    expect(calls).toBe(5);
    await preparePythonAssets({ out, cache, lock: real(), fetchImpl });
    expect(calls).toBe(5);
    const sizes = JSON.parse(readFileSync(join(out, 'sizes.json'), 'utf8'));
    expect(Object.keys(sizes.packages).length).toBe(5);
    expect(existsSync(join(out, 'pyodide-lock.json'))).toBe(true);
    expect(r.files).toBeGreaterThan(5);
  });
});
