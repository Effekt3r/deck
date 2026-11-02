import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// The git tests build throwaway repos with dozens of git calls, and starting a
// process costs ~100–250 ms on GitHub's Windows runners: some sat right at the
// 5 s default there and failed at random. GitHub's macOS runners hit it too:
// the merge-target tests, and the zsh hook test whose cd runs git (5 s on CI
// against 87 ms locally, 2026-11-02), so every CI run gets the longer limits.
const slowSpawn = process.platform === 'win32' || Boolean(process.env.CI)

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
