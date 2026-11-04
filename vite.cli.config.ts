import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

// The CLI: a plain Node bundle of src/cli (no Electron), reusing src/main/db and src/shared.
export default defineConfig({
  define: { __BC_RUNTIME__: 'false' }, // src/shared/product.ts
  build: {
    ssr: 'src/cli/main.ts',
    outDir: 'out/cli',
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: {
      external: [/^node:/, ...builtinModules],
      output: { entryFileNames: 'basecraft-cli.mjs', format: 'es', banner: '#!/usr/bin/env node' },
    },
  },
});
