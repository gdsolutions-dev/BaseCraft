import { configDefaults, defineConfig } from 'vitest/config';

// Worktrees and agent folders hold other branches' copies of the tests: never scanned.
const exclude = [...configDefaults.exclude, '.worktrees/**', '.claude/**'];

export default defineConfig({
  test: {
    environment: 'node', include: ['src/**/*.test.ts', 'tests/bench/**/*.test.ts'], exclude, globals: true,
    // Many tests open real base files (lock, journal, synchronous=FULL; src/main, src/shared/expr/sql): under a full parallel run,
    // disk contention (and the Windows scan of new temp files), not a race, can push one past vitest's 5 s default.
    testTimeout: 15_000, hookTimeout: 15_000,
    benchmark: { include: ['tests/bench/**/*.bench.ts'], exclude },
  },
});
