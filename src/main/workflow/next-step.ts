import type { ConfigCommands } from '../../shared/departments'
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
  { id: 'test-cases', label: 'Test cases' },
  { id: 'verify', label: 'Verify' },
  { id: 'review', label: 'Code review' },
  { id: 'pr', label: 'Ship' },
]
const cleanup: NextStep = { id: 'cleanup', label: 'Clean up' }
const moveTicket: NextStep = { id: 'move-ticket', label: 'Move ticket' }

export const noShipCommands = 'Add your ship commands to departments.json to get buttons here.'
export const shipNotInstalled = 'None of the configured ship commands are installed.'

export const slashed = (command: string) => (command.startsWith('/') ? command : `/${command}`)

export function nextSteps(state: WorkState, installed: readonly string[], ticketKnown = false, configured: ConfigCommands = {}): Pick<ShipIt, 'steps' | 'waiting' | 'hint'> {
  const offered = (steps: NextStep[]) => steps.filter((step) => !step.command || installed.includes(step.command.slice(1)))
  const step = (base: NextStep, command?: string): NextStep[] => (command ? [{ ...base, command: slashed(command) }] : [])
  const { pr } = state
  if (pr?.state === 'merged') return { steps: [cleanup, ...(ticketKnown ? [moveTicket] : [])] }
  if (pr?.state === 'open') {
    const ci = ciState(pr.checks)
    const steps = offered([
      ...(ci === 'fail' ? step({ id: 'fix-ci', label: 'Fix CI' }, configured.fixCi) : []),
      ...(pr.unresolved ? step({ id: 'comments', label: 'Answer comments' }, configured.answerComments) : []),
    ])
    const waiting = ci === 'pending' ? 'Waiting on CI' : ci !== 'fail' && !pr.unresolved ? 'Waiting on review' : undefined
    return waiting ? { steps, waiting } : { steps }
  }
  if (pr || !(state.uncommitted || state.unpushed)) return { steps: [] }
  const wanted = ship.flatMap((base, i) => step(base, configured.ship?.[i]))
  const steps = offered(wanted)
  return !wanted.length ? { steps, hint: noShipCommands } : !steps.length ? { steps, hint: shipNotInstalled } : { steps }
}

export async function loadShipIt(cwd: string, commands: readonly string[], linear: Linear, gh: Run = run, configured: ConfigCommands = {}): Promise<ShipIt> {
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
    ...nextSteps({ uncommitted: status.uncommitted, unpushed, pr: github.pr }, commands, !!ticket.status, configured),
    ...(found ? { ticket } : {}),
    ...(notice ? { notice } : {}),
  }
}
