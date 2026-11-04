import { configDefaults, defineConfig } from 'vitest/config';

// Worktrees and agent folders hold other branches' copies of the tests: never scanned.
const exclude = [...configDefaults.exclude, '.worktrees/**', '.claude/**'];

export default defineConfig({
  define: { __BC_RUNTIME__: 'false' }, // src/shared/product.ts: the tests run the full build's code; a Runtime branch takes `runtime` as a parameter
  test: {
    environment: 'node', include: ['src/**/*.test.ts', 'tests/bench/**/*.test.ts', 'tests/spike/**/*.test.ts'], exclude, globals: true,
    // Many tests open real base files (lock, journal, synchronous=FULL; src/main, src/shared/expr/sql): under a full parallel run,
    // disk contention (and the Windows scan of new temp files), not a race, can push one past vitest's 5 s default.
    // GitHub's Windows runner (Defender scanning each new temp file) runs some files 2–4× slower: CI gets more room.
    testTimeout: process.env.CI ? 60_000 : 15_000, hookTimeout: process.env.CI ? 60_000 : 15_000,
    benchmark: { include: ['tests/bench/**/*.bench.ts'], exclude },
  },
});
