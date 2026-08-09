import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // src/**/*.test.ts are standalone `npx tsx` scripts; only run the
    // vitest suites under test/.
    include: ['test/**/*.test.ts'],
  },
})
