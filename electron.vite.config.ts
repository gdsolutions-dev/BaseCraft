import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

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
      {
        // Glide 6.0.3 charge son éditeur de cellule en React.lazy : la première ouverture de la session est différée, et les
        // touches tapées avant qu'il ait le focus vont à la grille, qui rouvre l'éditeur avec chacune (« Dupond » donnait
        // « ond » sur une machine lente). Importé d'emblée, il s'ouvre et prend le focus avant la touche suivante, comme ensuite.
        // ponytail: build seulement (le pré-bundle du mode dev garde le lazy) ; à retirer si Glide l'importe directement.
        name: 'glide-eager-overlay-editor',
        apply: 'build',
        transform(code: string, id: string) {
          if (!id.replace(/\\/g, '/').endsWith('/glide-data-grid/dist/esm/data-editor/data-editor.js')) return;
          const lazy = 'React.lazy(async () => await import("../internal/data-grid-overlay-editor/data-grid-overlay-editor.js"))';
          if (!code.includes(lazy)) this.error('glide-eager-overlay-editor: Glide no longer loads its overlay editor this way');
          return `import EagerOverlayEditor from "../internal/data-grid-overlay-editor/data-grid-overlay-editor.js";\n${code.replace(lazy, 'EagerOverlayEditor')}`;
        },
      },
    ] },
});
