import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    // First import of Nest is slow on cold CI runners and Windows disks.
    testTimeout: 15_000,
    include: ['src/**/*.spec.ts'],
  },
});
