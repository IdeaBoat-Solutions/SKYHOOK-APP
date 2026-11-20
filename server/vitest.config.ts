import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // buildApp() registers all 15 modules; on cold start this can exceed 5s.
    testTimeout: 15000,
  },
});
