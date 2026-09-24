import { isBusy, type ChatFields } from '../../shared/chat'
import { runsIn } from '../../shared/housekeeping'

export type Confirm = (message: string, detail: string, action?: string) => Promise<boolean>

export interface FinishSteps {
  refuse?: string
  stop?: boolean
  keep?: string
  remove?: boolean
}

export const keepQuestion = (name: string, blocked: string) =>
  /uncommitted/.test(blocked) ? `Uncommitted changes in ${name}: archive only and keep the worktree?` : `Can’t remove ${name} (${blocked}): archive only and keep the worktree?`

export function finishSteps(chat: Pick<ChatFields, 'visitor' | 'state'>, tree?: { name: string; blocked?: string }): FinishSteps {
  if (isBusy(chat.state) && chat.visitor) return { refuse: `It’s ${chat.state === 'needs-you' ? 'waiting for you' : 'working'} in ${runsIn(chat)}. Finish it there first.` }
  return {
    ...(isBusy(chat.state) ? { stop: true } : {}),
    ...(tree?.blocked ? { keep: keepQuestion(tree.name, tree.blocked) } : tree ? { remove: true } : {}),
  }
}
