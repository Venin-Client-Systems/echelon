import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only include files that use Vitest syntax
    include: [
      'src/core/__tests__/action-parser*.test.ts',
      'src/core/__tests__/orchestrator.test.ts',
    ],
    // Exclude Node.js test runner files
    exclude: [
      'src/core/__tests__/error-boundaries.test.ts',
      'src/lib/__tests__/config.test.ts',
      'node_modules/**',
      'dist/**',
    ],
  },
});
