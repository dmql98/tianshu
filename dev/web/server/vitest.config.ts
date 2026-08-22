import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // src/**/*.test.ts are standalone `npx tsx` scripts; only run the
    // vitest suites under test/.
    include: ['test/**/*.test.ts'],
    // Guarantee a data dir before any test module loads (providerStore/schema
    // call getDataDir() at import time; CI has no web/server/config.json).
    setupFiles: ['test/setup-data-dir.ts'],
    // ipc-contract.test.ts forks a real server child process that cold-starts
    // in 3-4s (tsx transform + DB init + builtin materialization); the vitest
    // default of 5000ms is too tight under parallel load and flakes the
    // release pipeline. 30s matches desktop/vitest.config.ts.
    testTimeout: 30000,
  },
})
