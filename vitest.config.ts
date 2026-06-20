import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // The top-level api/ backend's tests are written for bun:test and run via
    // `bun test` (#110) — exclude that dir specifically. NB: root-anchored `api/**`,
    // not `**/api/**`, so it doesn't also swallow src/app/api/**/__tests__ (the
    // Next route tests, which vitest DOES run).
    exclude: ['**/node_modules/**', '**/.claude/worktrees/**', '**/e2e/**', 'api/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
