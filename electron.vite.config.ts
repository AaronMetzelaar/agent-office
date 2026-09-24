import { templateCompilerOptions } from '@tresjs/core'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: { rollupOptions: { input: { index: 'src/main/index.ts', host: 'src/main/host/index.ts' } } },
  },
  preload: {},
  renderer: {
    plugins: [vue(templateCompilerOptions)],
  },
})
