import type { BrowserWindow } from 'electron'
import type { StartChatResult } from '../../shared/chat'
import { defaultAccount, type DeptRule } from '../../shared/departments'
import type { AccountView } from '../../shared/ipc'
import type { TicketLookup } from '../../shared/workflow'
import { handle, send } from '../ipc'
import { repoRoot } from '../permissions/repo-root'
import { gitStatus, toplevel, type Run } from '../review/git'
import type { Engine } from '../sessions/manager'
import type { ChatStore } from '../store/chats'
import { chatTicketId, ticketId, type Linear } from './linear'
import { loadShipIt } from './next-step'
import { createReviewQueue, localClone, reviewDept } from './review-requests'

export interface WorkflowDeps {
  store: Pick<ChatStore, 'view' | 'views' | 'start'>
  engine: Pick<Engine, 'commands'>
  accounts: () => AccountView[]
  linear: Linear
  rules: readonly DeptRule[]
  gh: Run
  confirm(message: string, detail: string): Promise<boolean>
}

export function wireWorkflow(win: BrowserWindow, appUrl: string, { store, engine, accounts, linear, rules, gh, confirm }: WorkflowDeps) {
  const cwdOf = (chatId: unknown) => {
    const cwd = typeof chatId === 'string' ? store.view(chatId)?.cwd : undefined
    if (!cwd) throw new Error('There’s no chat with that id')
    return cwd
  }
  const queue = createReviewQueue(gh, (view) => send(win, 'reviewRequests', view))

  handle('getShipIt', win, appUrl, (chatId) => loadShipIt(cwdOf(chatId), engine.commands(chatId) ?? [], linear, gh))

  handle('lookupTicket', win, appUrl, async (text): Promise<TicketLookup> => {
    const id = typeof text === 'string' ? ticketId(text) : undefined
    return id ? linear.ticket(id) : { error: 'That isn’t a Linear ticket id, like AUC-1302.' }
  })

  handle('moveTicket', win, appUrl, async (chatId) => {
    const cwd = cwdOf(chatId)
    const root = await toplevel(cwd)
    const id = chatTicketId(root ? (await gitStatus(root)).branch : undefined, cwd)
    if (!id) return { error: 'This chat has no Linear ticket.' }
    return linear.moveToDone(id, (from, to) => confirm(`Move ${id} to ${to}?`, `It’s ${from} in Linear now.`))
  })

  handle('getReviewRequests', win, appUrl, queue.view)

  handle('startReview', win, appUrl, async (url): Promise<StartChatResult> => {
    const request = queue.find(url)
    if (!request) return { error: 'That review request isn’t in the list any more.' }
    const repo = await localClone(request.repo, [...new Set(store.views().map((chat) => repoRoot(chat.cwd)))])
    if (!repo) return { error: `There’s no local clone of ${request.repo} yet. Start an agent in it once, then try again.` }
    const dept = reviewDept(repo, request.files, rules)
    const accountId = defaultAccount(accounts(), dept)
    if (!accountId) return { error: 'Log in to an account first.' }
    return store.start(accountId, repo, `/pr-review-rundown ${request.url}`, undefined, undefined, { dept, worktree: true, title: `Review #${request.number} ${request.title}` })
  })

  win.on('focus', queue.focus)
  queue.start()
  return queue
}
