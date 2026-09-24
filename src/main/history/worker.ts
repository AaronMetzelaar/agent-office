import { watch } from 'node:fs'
import { parentPort, workerData } from 'node:worker_threads'
import { openIndex } from './indexer'

const { file, projectsDir } = workerData as { file: string; projectsDir: string }
const index = openIndex(file, projectsDir)
const quietMs = 5000
let running = false
let again = false
let timer: ReturnType<typeof setTimeout> | undefined

async function update() {
  if (running) return void (again = true)
  running = true
  try {
    do {
      again = false
      await index.update()
    } while (again)
  } finally {
    running = false
  }
}

const soon = () => {
  timer ??= setTimeout(() => {
    timer = undefined
    void update()
  }, quietMs)
}

try {
  watch(projectsDir, { recursive: true }, (_event, name) => name?.endsWith('.jsonl') && !name.includes('subagents') && soon())
} catch {
  setInterval(soon, 60_000)
}
void update()
parentPort?.on('message', ({ id, query }: { id: number; query: string }) => parentPort?.postMessage({ id, hits: index.search(query) }))
