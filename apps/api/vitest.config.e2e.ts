import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    // First import of Nest is slow on cold CI runners and Windows disks;
    // a sleeping Neon database also takes a few seconds to wake.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    include: ['test/**/*.e2e-spec.ts'],
    globalSetup: ['./test/global-db-setup.ts'],
    // Database tests share one schema, so run files one at a time.
    fileParallelism: false,
  },
});
