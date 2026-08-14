/**
 * Vitest config for dsh-token-cost. The tested modules (pricing, parser,
 * time filters) are pure and import no @deepseek-ai runtime packages, so a
 * minimal node environment suffices.
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
