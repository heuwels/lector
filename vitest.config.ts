import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // api/ tests are written for bun:test and run via `bun test` (#110)
    exclude: ['**/node_modules/**', '**/.claude/worktrees/**', '**/e2e/**', '**/api/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
