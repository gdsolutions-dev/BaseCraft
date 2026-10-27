import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

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

export default defineConfig({
  // db-host: the data process (utilityProcess.fork of out/main/db-host.js), the only one that opens SQLite
  // exceljs is bundled (the packaged app has no node_modules)
  main: { build: { externalizeDeps: { exclude: ['exceljs'] }, rollupOptions: {
    input: { index: 'src/main/index.ts', 'db-host': 'src/main/db-host/host.ts' },
    // unzipper (exceljs) requires it lazily, only for Open.s3_v3, which BaseCraft never calls
    external: ['@aws-sdk/client-s3'],
  } } },
  // sandbox: true impose un preload empaqueté en CJS
  preload: { build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].js' } } } },
  renderer: { root: 'src/renderer', plugins: [
      react(),
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
});
