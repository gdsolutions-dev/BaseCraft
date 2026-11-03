import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';
import { relative } from 'node:path';
import { DESIGNER_MODULES } from './src/shared/designer-modules';

/** A build-only patch of one Glide file (dist/esm/<file>): `patch` gives the new code, null when the code no longer has the
 *  expected shape. The build fails then, and also when the file never came through (moved or renamed by a Glide upgrade). */
function glidePatch(name: string, file: string, patch: (code: string) => string | null) {
  let applied = false;
  return {
    name,
    apply: 'build' as const,
    buildStart() { applied = false; },
    transform(this: { error(msg: string): never }, code: string, id: string) {
      if (!id.replace(/\\/g, '/').endsWith(`/glide-data-grid/dist/esm/${file}`)) return;
      const out = patch(code);
      if (out === null) this.error(`${name}: Glide's ${file} no longer has the expected code`);
      applied = true;
      return out;
    },
    buildEnd(this: { error(msg: string): never }, err?: Error) {
      if (!err && !applied) this.error(`${name}: Glide's ${file} was not in the build (moved or renamed)`);
    },
  };
}

/** B5: the renderer bundle checked both ways once written — the Runtime's holds no designer module, the full one holds them all
 *  (a renamed or moved designer must be renamed in DESIGNER_MODULES, or the Runtime check would pass on a stale name). */
function designerGuard(runtime: boolean) {
  return {
    name: 'designer-guard',
    apply: 'build' as const,
    generateBundle(this: { error(msg: string): never }, _: unknown, bundle: Record<string, { type: string; moduleIds?: string[] }>) {
      const ids = new Set(Object.values(bundle).flatMap((c) => (c.type === 'chunk' ? c.moduleIds ?? [] : []))
        .map((id) => relative(process.cwd(), id.split('?')[0]!).replace(/\\/g, '/')));
      const hits = DESIGNER_MODULES.filter((m) => ids.has(m));
      const missing = DESIGNER_MODULES.filter((m) => !ids.has(m));
      if (runtime && hits.length) this.error('Designer modules in the Runtime bundle: ' + hits.join(', '));
      if (!runtime && missing.length) this.error('DESIGNER_MODULES lists modules the full bundle lacks: ' + missing.join(', '));
    },
  };
}

/** C4 R1, C5 R1: each server driver (`pg`, `tedious`) sits in a chunk of its own, reached from the main bundle's entries (index,
 *  db-host) only through import(); the build fails if an entry loads one statically, or if no chunk holds it (externalized: the
 *  packaged app has no node_modules). Each is found by a module only it brings. */
const DRIVERS: [string, RegExp][] = [['pg', /[\\/]node_modules[\\/]pg-protocol[\\/]/], ['tedious', /[\\/]node_modules[\\/]tedious[\\/]lib[\\/]/]];
const lazyDriverGuard = {
  name: 'lazy-driver-guard',
  apply: 'build' as const,
  generateBundle(this: { error(msg: string): never }, _: unknown, bundle: Record<string, { type: string; isEntry?: boolean; imports?: string[]; moduleIds?: string[] }>) {
    const seen = new Set<string>();
    const walk = (file: string): void => { if (!seen.has(file)) { seen.add(file); bundle[file]?.imports?.forEach(walk); } };
    for (const [file, c] of Object.entries(bundle)) if (c.isEntry) walk(file);
    for (const [name, module] of DRIVERS) {
      const holds = (file: string) => (bundle[file]?.moduleIds ?? []).some((id) => module.test(id));
      if (!Object.keys(bundle).some(holds)) this.error(`lazy-driver-guard: no chunk holds ${name}`);
      const eager = [...seen].filter(holds);
      if (eager.length) this.error(`lazy-driver-guard: ${name} is loaded at start by ${eager.join(', ')}`);
    }
  },
};

// The Runtime build (--mode runtime, B5): the same sources with the designers removed, in out-runtime/ (out/ stays the full build's).
// Once main is built, the folder gets its package.json and icon (scripts/runtime-stage.mjs): `electron out-runtime` then runs as packaged.
const runtimeStage = {
  name: 'runtime-stage',
  apply: 'build' as const,
  closeBundle() { execFileSync(process.execPath, ['scripts/runtime-stage.mjs'], { stdio: 'inherit' }); },
};

export default defineConfig(({ mode }) => {
  const runtime = mode === 'runtime';
  const define = { __BC_RUNTIME__: JSON.stringify(runtime) }; // src/shared/product.ts
  const outDir = (part: string) => (runtime ? { outDir: `out-runtime/${part}` } : {});
  return {
    // db-host: the data process (utilityProcess.fork of out/main/db-host.js), the only one that opens SQLite
    // exceljs and mdb-reader (C2, Access files) are bundled (the packaged app has no node_modules)
    // pg (C4) and tedious (C5) are bundled too, each in its own chunk loaded on first use (lazyDriverGuard)
    main: { define, plugins: [lazyDriverGuard, ...(runtime ? [runtimeStage] : [])], build: { ...outDir('main'), externalizeDeps: { exclude: ['exceljs', 'mdb-reader', 'pg', 'tedious'] }, rollupOptions: {
      input: { index: 'src/main/index.ts', 'db-host': 'src/main/db-host/host.ts' },
      // unzipper (exceljs) requires it lazily, only for Open.s3_v3, which BaseCraft never calls
      // pg requires pg-native (native bindings) only through its `native` getter, which BaseCraft never reads
      external: ['@aws-sdk/client-s3', 'pg-native'],
    } } },
    // sandbox: true impose un preload empaqueté en CJS
    preload: { define, build: { ...outDir('preload'), rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].js' } } } },
    renderer: { root: 'src/renderer', define, build: outDir('renderer'),
      // the designers' single way in (src/renderer/design/entry.ts) is the Runtime's design-free one
      ...(runtime ? { resolve: { alias: [{ find: /^(.*)\/design\/entry$/, replacement: '$1/design/entry.runtime' }] } } : {}),
      plugins: [
        react(),
        designerGuard(runtime),
        {
          // dev seulement : le préambule React Refresh est inline et le HMR utilise un WebSocket
          name: 'dev-csp',
          apply: 'serve',
          transformIndexHtml: (html: string) =>
            html.replace("default-src 'self';", "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws:;"),
        },
        // Glide 6.0.3 charge son éditeur de cellule en React.lazy : la première ouverture de la session est différée, et les
        // touches tapées avant qu'il ait le focus vont à la grille, qui rouvre l'éditeur avec chacune (« Dupond » donnait
        // « ond » sur une machine lente). Importé d'emblée, il s'ouvre et prend le focus avant la touche suivante, comme ensuite.
        // ponytail: build seulement (le pré-bundle du mode dev garde le lazy) ; à retirer si Glide l'importe directement.
        glidePatch('glide-eager-overlay-editor', 'data-editor/data-editor.js', (code) => {
          const lazy = 'React.lazy(async () => await import("../internal/data-grid-overlay-editor/data-grid-overlay-editor.js"))';
          if (!code.includes(lazy)) return null;
          return `import EagerOverlayEditor from "../internal/data-grid-overlay-editor/data-grid-overlay-editor.js";\n${code.replace(lazy, 'EagerOverlayEditor')}`;
        }),
        // Glide 6.0.3 donne le focus à la grille à l'image suivante (requestAnimationFrame), et à la copie accessible de la cellule
        // sélectionnée quand elle est rendue (200 ms après le clic) s'il l'a déjà ; si l'image vient après (machine chargée,
        // fenêtre cachée), la cellule n'était pas retenue et le focus restait sur le canevas. Elle est retenue : il va à la cellule.
        // ponytail: build seulement, comme ci-dessus ; à retirer si Glide retient la cellule lui-même.
        glidePatch('glide-focus-selected-cell', 'internal/data-grid/data-grid.js', (code) => {
          const early = /(if \(ref\.current === null \|\| !ref\.current\.contains\(document\.activeElement\)\))\s*return;/;
          return early.test(code) ? code.replace(early, '$1 { focusRef.current = el; return; }') : null;
        }),
      ] },
  };
});
