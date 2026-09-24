import { execFileSync } from 'node:child_process'
import { dirname } from 'node:path'
import { templateCompilerOptions } from '@tresjs/core'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'electron-vite'

const git = (...args: string[]) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

const commit = process.env.AGENT_OFFICE_COMMIT ?? git('rev-parse', 'HEAD')
const commonDir = git('rev-parse', '--path-format=absolute', '--git-common-dir')
const repo = process.env.AGENT_OFFICE_REPO ?? (commonDir ? dirname(commonDir) : '')

export default defineConfig({
  main: {
    build: { rollupOptions: { input: { index: 'src/main/index.ts', host: 'src/main/host/index.ts', indexer: 'src/main/history/worker.ts' } } },
    define: { __BUILD_COMMIT__: JSON.stringify(commit), __SOURCE_REPO__: JSON.stringify(repo) },
  },
  preload: {},
  renderer: {
    plugins: [vue(templateCompilerOptions)],
  },
})
