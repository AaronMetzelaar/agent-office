import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  test: {
    testTimeout: 20_000,
    projects: [
      { extends: true, test: { name: 'node', include: ['tests/**/*.test.ts'], exclude: ['tests/**/*.client.test.ts'] } },
      { extends: true, test: { name: 'client', include: ['tests/**/*.client.test.ts'], environment: './tests/renderer/client-env.ts' } },
    ],
  },
})
