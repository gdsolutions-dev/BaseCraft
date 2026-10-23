import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // db-host: the data process (utilityProcess.fork of out/main/db-host.js), the only one that opens SQLite
  // exceljs is bundled (the packaged app has no node_modules)
  main: { build: { externalizeDeps: { exclude: ['exceljs'] }, rollupOptions: { input: { index: 'src/main/index.ts', 'db-host': 'src/main/db-host/host.ts' } } } },
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
    ] },
});
