import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    exclude: ['**/node_modules/**', '**/dist/**', '**/test/contracts/**'],
    hookTimeout: 60000,
    testTimeout: 60000,
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    sequence: {
      concurrent: false,
    },
  },
});
