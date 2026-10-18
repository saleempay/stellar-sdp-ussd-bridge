import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // dist/ is rebuilt once before every run: the scripts the tests spawn
    // import it, and a stale or missing dist/ must never decide a result
    globalSetup: ['test/globalSetup.ts'],
    // Live tests self-gate on an environment flag; nothing here reaches the
    // network unless that flag is set.
    testTimeout: 120_000,
  },
});
