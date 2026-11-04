import { defineConfig } from 'vitest/config';

// Black-box tests against a running API (E2E_BASE_URL) and its database.
// Files run in sequence because they share one firm and one counter set.
export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.e2e-spec.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
