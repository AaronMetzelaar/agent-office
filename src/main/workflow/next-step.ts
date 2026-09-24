import { ciState, type PullRequest } from '../../shared/review'
import type { NextStep, ShipIt } from '../../shared/workflow'
import { gitStatus, run, toplevel, unpushedCommits, type Run } from '../review/git'
import { pullRequest, type GithubState } from '../review/github'
import { chatTicketId, type Linear } from './linear'

export interface WorkState {
  uncommitted: number
  unpushed: number
  pr?: PullRequest
}

const ship: NextStep[] = [
  { id: 'test-cases', label: 'Test cases', command: '/mws-test-cases' },
  { id: 'verify', label: 'Verify', command: '/mws-verify' },
  { id: 'review', label: 'Code review', command: '/mws-review' },
  { id: 'pr', label: 'Ship', command: '/mws-pr' },
]
const fixCi: NextStep = { id: 'fix-ci', label: 'Fix CI', command: '/gh-fix-ci' }
const comments: NextStep = { id: 'comments', label: 'Answer comments', command: '/pr-comment-rundown' }
const cleanup: NextStep = { id: 'cleanup', label: 'Clean up' }
const moveTicket: NextStep = { id: 'move-ticket', label: 'Move ticket' }

export function nextSteps(state: WorkState, commands: readonly string[], ticketKnown = false): Pick<ShipIt, 'steps' | 'waiting'> {
  const offered = (steps: NextStep[]) => steps.filter((step) => !step.command || commands.includes(step.command.slice(1)))
  const { pr } = state
  if (pr?.state === 'merged') return { steps: [cleanup, ...(ticketKnown ? [moveTicket] : [])] }
  if (pr?.state === 'open') {
    const ci = ciState(pr.checks)
    const steps = offered([...(ci === 'fail' ? [fixCi] : []), ...(pr.unresolved ? [comments] : [])])
    const waiting = ci === 'pending' ? 'Waiting on CI' : ci !== 'fail' && !pr.unresolved ? 'Waiting on review' : undefined
    return waiting ? { steps, waiting } : { steps }
  }
  return { steps: !pr && (state.uncommitted || state.unpushed) ? offered(ship) : [] }
}

export async function loadShipIt(cwd: string, commands: readonly string[], linear: Linear, gh: Run = run): Promise<ShipIt> {
  const root = await toplevel(cwd)
  if (!root) return { steps: [] }
  const status = await gitStatus(root)
  const id = chatTicketId(status.branch, cwd)
  const [github, unpushed, found] = await Promise.all([
    status.branch ? pullRequest(root, gh) : ({} as GithubState),
    status.upstream ? status.ahead : unpushedCommits(root).catch(() => 0),
    id ? linear.ticket(id) : undefined,
  ])
  const { description: _description, ...ticket } = found?.ticket ?? { id: '' }
  const notice = github.notice ?? found?.notice
  return {
    ...nextSteps({ uncommitted: status.uncommitted, unpushed, pr: github.pr }, commands, !!ticket.status),
    ...(found ? { ticket } : {}),
    ...(notice ? { notice } : {}),
  }
}
