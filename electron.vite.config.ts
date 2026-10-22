import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {},
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
