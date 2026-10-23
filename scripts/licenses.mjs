// Licence inventory of the production dependencies: fails on anything outside the allow-list, writes out/licenses.json.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ALLOWED = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'MPL-2.0', 'CC0-1.0', 'BlueOak-1.0.0', 'Unlicense', 'Python-2.0']);
const root = process.cwd();
// Reviewed one by one (a package outside the allow-list is a decision, never a default); keyed by name@version.
const EXCEPTIONS = {
  '@fontsource-variable/inter@5.3.0': 'SIL OFL-1.1 font, shipped with its licence in src/renderer/public/fonts/LICENSES',
  'caniuse-lite@1.0.30001818': 'CC-BY-4.0 data used by browserslist at build time only (via Babel/Linaria), never bundled or shipped',
  'pako@1.0.11': '(MIT AND Zlib): both permissive',
};

const tree = JSON.parse(execSync('npm ls --omit=dev --all --json', { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }));
const found = new Map(); // "name@version" → path
// Node resolution: a dependency lives in the closest node_modules up from its parent (hoisting).
const locate = (name, from) => {
  for (let dir = from; ; dir = dirname(dir)) {
    const p = join(dir, 'node_modules', name);
    if (existsSync(join(p, 'package.json'))) return p;
    if (dir === dirname(dir)) return join(root, 'node_modules', name);
  }
};
(function walk(deps, from) {
  for (const [name, d] of Object.entries(deps ?? {})) {
    const dir = locate(name, from);
    if (d.version) found.set(`${name}@${d.version}`, dir);
    walk(d.dependencies, dir);
  }
})(tree.dependencies, root);

const spdx = (v) => String(v).replace(/[()]/g, ' ').split(/\s+(?:OR|or)\s+/).map((x) => x.trim()).some((x) => ALLOWED.has(x));
const licenceOf = (pkg) => {
  const l = pkg.license ?? (Array.isArray(pkg.licenses) ? pkg.licenses.map((x) => x.type ?? x).join(' OR ') : pkg.licenses?.type);
  return typeof l === 'object' && l ? l.type : l;
};

const list = [], bad = [], notes = [], pending = [];
for (const [id, dir] of [...found].sort(([a], [b]) => a.localeCompare(b))) {
  const at = id.lastIndexOf('@');
  const name = id.slice(0, at), version = id.slice(at + 1);
  let license;
  try { license = licenceOf(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))); } catch { /* unreadable: reported below */ }
  list.push({ name, version, license: license ?? 'UNKNOWN' });
  const ex = EXCEPTIONS[id];
  if (ex?.pending) { pending.push(`${id}: ${ex.reason}`); license = 'PENDING owner decision (no licence declared)'; list[list.length - 1].license = license; }
  else if (ex) notes.push(`${id}: ${license ?? 'none'} (${ex})`);
  else if (!license || !spdx(license)) bad.push(`${id}: ${license ?? 'missing licence'}`);
}

// Not npm packages: the fonts shipped with the app and Electron itself (Chromium components, some LGPL as dynamic libraries: allowed by spec 6).
const fontDir = join(root, 'src/renderer/public/fonts/LICENSES');
const fonts = existsSync(fontDir) ? readdirSync(fontDir).map((f) => ({ name: `font ${f.replace(/\.txt$/, '')}`, version: '', license: readFileSync(join(fontDir, f), 'utf8').split(/\r?\n/).find((l) => l.trim())?.trim() ?? f })) : [];
const electron = { name: 'electron', version: JSON.parse(readFileSync(join(root, 'node_modules/electron/package.json'), 'utf8')).version, license: 'MIT (bundles Chromium and other components under their own licences, see LICENSES.chromium.html)' };

if (bad.length) { console.error(`Licences not allowed:\n  ${bad.join('\n  ')}`); process.exit(1); }
mkdirSync(join(root, 'out'), { recursive: true });
writeFileSync(join(root, 'out/licenses.json'), JSON.stringify([...list, ...fonts, electron], null, 1));
if (notes.length) console.log(['Reviewed exceptions:', ...notes].join('\n  '));
const allowPending = process.argv.includes('--allow-pending');
if (pending.length) console[allowPending ? 'warn' : 'error']([`${allowPending ? 'WARNING, pending licence decisions (allowed by --allow-pending)' : 'Pending licence decisions block the release'}:`, ...pending].join('\n  '));
console.log(`${list.length} production packages, all licences allowed; out/licenses.json written`);
if (pending.length && !allowPending) process.exit(1);
