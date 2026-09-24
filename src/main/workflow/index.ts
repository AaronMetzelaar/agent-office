import type { StartChatResult } from '../../shared/chat'
import { defaultAccount } from '../../shared/departments'
import type { AccountView } from '../../shared/ipc'
import type { TicketLookup } from '../../shared/workflow'
import type { Hub } from '../ipc'
import { repoRoot } from '../permissions/repo-root'
import { gitStatus, toplevel, type Run } from '../review/git'
import type { ChatStore } from '../store/chats'
import { chatTicketId, ticketId, withTicket, type Linear } from './linear'
import { loadShipIt } from './next-step'
import { createReviewQueue, reviewStart } from './review-requests'

export interface WorkflowDeps {
  store: Pick<ChatStore, 'view' | 'views' | 'start'>
  commandNames(chatId: string): string[]
  accounts: () => AccountView[]
  linear: Linear
  gh: Run
  confirm(message: string, detail: string): Promise<boolean>
}

export function wireWorkflow(hub: Hub, { store, commandNames, accounts, linear, gh, confirm }: WorkflowDeps) {
  const cwdOf = (chatId: unknown) => {
    const cwd = typeof chatId === 'string' ? store.view(chatId)?.cwd : undefined
    if (!cwd) throw new Error('There’s no chat with that id')
    return cwd
  }
  const queue = createReviewQueue(gh, (view) => hub.send('reviewRequests', view))

  hub.handle('startChat', async (accountId, cwd, prompt, model, effort, options) => {
    const seeded = typeof prompt === 'string' ? await withTicket(linear, prompt, options) : { prompt, options }
    return store.start(accountId, cwd, seeded.prompt, model, effort, seeded.options)
  })

  hub.handle('getShipIt', (chatId) => loadShipIt(cwdOf(chatId), commandNames(String(chatId)), linear, gh))

  hub.handle('lookupTicket', async (text): Promise<TicketLookup> => {
    const id = typeof text === 'string' ? ticketId(text) : undefined
    return id ? linear.ticket(id) : { error: 'That isn’t a Linear ticket id, like AUC-1302.' }
  })

  hub.handle('moveTicket', async (chatId) => {
    const cwd = cwdOf(chatId)
    const root = await toplevel(cwd)
    const id = chatTicketId(root ? (await gitStatus(root)).branch : undefined, cwd)
    if (!id) return { error: 'This chat has no Linear ticket.' }
    return linear.moveToDone(id, (from, to) => confirm(`Move ${id} to ${to}?`, `It’s ${from} in Linear now.`))
  })

  hub.handle('getReviewRequests', queue.view)

  hub.handle('startReview', async (url): Promise<StartChatResult> => {
    const request = queue.find(url)
    if (!request) return { error: 'That review request isn’t in the list any more.' }
    const accountId = defaultAccount(accounts(), 'rev')
    if (!accountId) return { error: 'Log in to an account first.' }
    const { cwd, prompt, options } = await reviewStart(request, [...new Set(store.views().map((chat) => repoRoot(chat.cwd)))])
    return store.start(accountId, cwd, prompt, undefined, undefined, options)
  })

  queue.start()
  return queue
}
