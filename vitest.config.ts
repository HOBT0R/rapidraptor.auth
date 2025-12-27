import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Include all test files by default, but exclude integration tests from regular runs
    // Integration tests are run separately via test:integration script
    include: process.env.VITEST_INTEGRATION
      ? ['__tests__/**/*.test.ts']
      : ['packages/**/*.test.ts'],
    exclude: ['node_modules/**'],
    // Longer timeout for integration tests (they may need to wait for session expiration)
    testTimeout: 120000, // 2 minutes
    // Even longer timeout for hooks (setup/teardown)
    hookTimeout: 120000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        '**/*.test.ts',
        '**/dist/',
        '**/*.config.ts',
        '__tests__/**', // Exclude integration tests from coverage
      ],
    },
  },
});

