import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Live tests self-gate on an environment flag; nothing here reaches the
    // network unless that flag is set.
    testTimeout: 120_000,
  },
});
