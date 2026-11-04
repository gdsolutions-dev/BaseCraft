// D1 (R3): prepares build/python/ — Pyodide's core files from node_modules, the wheels of numpy + pandas (and their closure)
// downloaded once into a cache and checked against pyodide-lock.json, a trimmed lock, and sizes.json. Run by the main build.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const PYODIDE_VERSION = '314.0.7';
export const ROOT_PACKAGES = ['numpy', 'pandas'];
export const PYTHON_LICENSES = {
  numpy: 'BSD-3-Clause',
  pandas: 'BSD-3-Clause',
  'python-dateutil': 'Apache-2.0 OR BSD-3-Clause',
  six: 'MIT',
  pytz: 'MIT',
};
const CORE = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip'];
const CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

export function closure(lock, roots) {
  const seen = new Set();
  const add = (n) => {
    if (seen.has(n)) return;
    if (!lock.packages[n]) throw new Error(`${n} is not in pyodide-lock.json`);
    seen.add(n);
    lock.packages[n].depends.forEach(add);
  };
  roots.forEach(add);
  return [...seen];
}

export function trimLock(lock, names) {
  return { ...lock, packages: Object.fromEntries(names.map((n) => [n, lock.packages[n]])) };
}

const sha256 = (b) => createHash('sha256').update(b).digest('hex');

export async function preparePythonAssets({ out, cache, lock, fetchImpl = fetch }) {
  const pyodideDir = join(process.cwd(), 'node_modules/pyodide');
  lock ??= JSON.parse(readFileSync(join(pyodideDir, 'pyodide-lock.json'), 'utf8'));
  const names = [...new Set(closure(lock, ROOT_PACKAGES))];
  for (const n of names) if (!PYTHON_LICENSES[n]) throw new Error(`no licence for ${n}`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  mkdirSync(cache, { recursive: true });
  const sizes = { core: 0, packages: {}, total: 0 };
  for (const f of CORE) { copyFileSync(join(pyodideDir, f), join(out, f)); sizes.core += statSync(join(out, f)).size; }
  for (const n of names) {
    const { file_name: file, sha256: want } = lock.packages[n];
    const cached = join(cache, file);
    let data = existsSync(cached) ? readFileSync(cached) : null;
    if (!data || sha256(data) !== want) {
      const res = await fetchImpl(CDN + file);
      if (!res.ok) throw new Error(`download of ${file} failed: HTTP ${res.status}`);
      data = Buffer.from(await res.arrayBuffer());
      if (sha256(data) !== want) throw new Error(`sha256 mismatch for ${file}`);
      writeFileSync(cached, data);
    }
    writeFileSync(join(out, file), data);
    sizes.packages[n] = data.length;
  }
  writeFileSync(join(out, 'pyodide-lock.json'), JSON.stringify(trimLock(lock, names)));
  sizes.total = sizes.core + Object.values(sizes.packages).reduce((a, b) => a + b, 0);
  writeFileSync(join(out, 'sizes.json'), JSON.stringify(sizes, null, 1));
  return { files: CORE.length + names.length + 2, bytes: sizes.total };
}
