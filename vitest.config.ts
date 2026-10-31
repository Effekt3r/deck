import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// The git tests build throwaway repos with dozens of git calls, and starting a
// process costs ~100–250 ms on GitHub's Windows runners: some sat right at the
// 5 s default there and failed at random.
const slowSpawn = process.platform === 'win32'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true,
    testTimeout: slowSpawn ? 30_000 : 5_000,
    hookTimeout: slowSpawn ? 60_000 : 10_000,
  },
})
