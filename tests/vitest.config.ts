import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/transport/**/*.ts', 'src/proxy/**/*.ts'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/types.ts',
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },

    // Test environment
    environment: 'node',

    // Global test setup
    globals: true,

    // Test timeout
    testTimeout: 30000,
    hookTimeout: 30000,

    // Concurrency
    pool: 'threads', // `threads: true` was removed in vitest 1
    maxConcurrency: 10,

    // Reporter
    reporters: ['verbose', 'json', 'html'],

    // Test file patterns
    include: [
      'tests/**/*.test.ts',
      'tests/**/*.spec.ts',
    ],

    // Setup files
    setupFiles: ['./tests/setup.ts'],
  },

  resolve: {
    alias: {
      '@': '/workspaces/agentic-flow/src',
      '@tests': '/workspaces/agentic-flow/tests',
    },
  },
});
