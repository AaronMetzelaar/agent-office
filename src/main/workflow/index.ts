import type { StartChatResult } from '../../shared/chat'
import { defaultAccount, isResearch, type DeptRule, type StartOptions } from '../../shared/departments'
import type { AccountView } from '../../shared/ipc'
import type { TicketLookup } from '../../shared/workflow'
import type { Jev } from '../departments/jev'
import type { Rooms } from '../departments/rooms'
import type { Hub } from '../ipc'
import { repoRoot } from '../permissions/repo-root'
import { gitStatus, toplevel, type Run } from '../review/git'
import type { ChatStore } from '../store/chats'
import { chatTicketId, ticketId, withTicket, type Linear } from './linear'
import { loadShipIt } from './next-step'
import { createReviewQueue, reviewStart } from './review-requests'

export interface WorkflowDeps {
  store: Pick<ChatStore, 'view' | 'views' | 'start' | 'setDepartment'>
  commandNames(chatId: string): string[]
  accounts: () => AccountView[]
  linear: Linear
  jev: Jev
  rooms: Pick<Rooms, 'make'>
  rules: readonly DeptRule[]
  gh: Run
  confirm(message: string, detail: string): Promise<boolean>
}

export function wireWorkflow(hub: Hub, { store, commandNames, accounts, linear, jev, rooms, rules, gh, confirm }: WorkflowDeps) {
  const cwdOf = (chatId: unknown) => {
    const cwd = typeof chatId === 'string' ? store.view(chatId)?.cwd : undefined
    if (!cwd) throw new Error('There’s no chat with that id')
    return cwd
  }
  const queue = createReviewQueue(gh, (view) => hub.send('reviewRequests', view))

  hub.handle('startChat', async (accountId, cwd, prompt, model, effort, options) => {
    const seeded = typeof prompt === 'string' ? await withTicket(linear, prompt, options) : { prompt, options }
    const wanted = (typeof seeded.options === 'object' && seeded.options ? seeded.options : {}) as StartOptions
    const research = accounts().some((account) => account.id === accountId && isResearch(account))
    const task = seeded.prompt
    const pick = wanted.review || research || typeof cwd !== 'string' || typeof task !== 'string' ? undefined : await jev(cwd, task)
    const dept = pick === 'new' ? undefined : pick
    const result = store.start(accountId, cwd, task, model, effort, dept ? { ...wanted, dept } : seeded.options)
    if (pick === 'new' && 'chatId' in result && typeof accountId === 'string') void moveToNewRoom(result.chatId, accountId, cwd as string, task as string)
    return result
  })

  async function moveToNewRoom(chatId: string, accountId: string, cwd: string, task: string) {
    try {
      const room = await rooms.make(accountId, (await toplevel(cwd)) ?? cwd, task, rules)
      if (room) store.setDepartment(chatId, room.id)
    } catch (error) {
      console.warn('[rooms] could not make a room', error)
    }
  }

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
    const { cwd, prompt, options } = await reviewStart(request, [...new Set(store.views().map((chat) => repoRoot(chat.cwd) ?? chat.cwd))])
    return store.start(accountId, cwd, prompt, undefined, undefined, options)
  })

  queue.start()
  return queue
}
