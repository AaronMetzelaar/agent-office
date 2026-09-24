import { Worker } from 'node:worker_threads'
import type { SearchHit } from '../../shared/history'
import type { Hub } from '../ipc'
import type { Visitors } from '../outside/visitors'
import type { ChatStore } from '../store/chats'
import type { IndexHit } from './indexer'

export type Search = ReturnType<typeof createSearch>

export function createSearch(file: string, projectsDir: string, workerFile: string, log = (message: string) => console.warn(`[search] ${message}`)) {
  const waiting = new Map<number, (hits: IndexHit[]) => void>()
  let next = 0
  let worker: Worker | undefined

  const start = () => {
    const started = new Worker(workerFile, { workerData: { file, projectsDir } })
    started.on('message', ({ id, hits }: { id: number; hits: IndexHit[] }) => {
      waiting.get(id)?.(hits)
      waiting.delete(id)
    })
    started.on('error', (error) => log(`the indexer stopped: ${error.message}`))
    started.on('exit', () => {
      if (worker === started) worker = undefined
      for (const done of waiting.values()) done([])
      waiting.clear()
    })
    return started
  }
  worker = start()

  return {
    search(query: string): Promise<IndexHit[]> {
      const id = ++next
      const promise = new Promise<IndexHit[]>((resolve) => waiting.set(id, resolve))
      ;(worker ??= start()).postMessage({ id, query })
      return promise
    },
    stop: () => worker?.terminate(),
  }
}

export function wireHistory(hub: Hub, search: Pick<Search, 'search'>, { store, visitors }: { store: Pick<ChatStore, 'views'>; visitors: Pick<Visitors, 'view'> }): void {
  hub.handle('searchChats', async (query) => {
    if (typeof query !== 'string' || !query.trim()) return []
    const hits = await search.search(query.slice(0, 200))
    const office = new Map(store.views().flatMap((view) => (view.sessionId && !view.forkPending ? [[view.sessionId, view] as const] : [])))
    return hits.map((hit): SearchHit => {
      const chat = office.get(hit.sessionId) ?? visitors.view(hit.sessionId)
      return chat ? { ...hit, chatId: chat.id, title: chat.title } : hit
    })
  })
}
