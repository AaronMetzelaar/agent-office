import type { CheckState, CiCheck, CiLog, PullRequest, ReviewDecision } from '../../shared/review'
import { run, type Run } from './git'

export interface GithubState {
  pr?: PullRequest
  notice?: string
}

interface RawCheck {
  __typename?: string
  name?: string
  workflowName?: string
  status?: string
  conclusion?: string
  detailsUrl?: string
  context?: string
  state?: string
  targetUrl?: string
}

interface RawPr {
  number: number
  title: string
  url: string
  state: string
  isDraft?: boolean
  reviewDecision?: string
  statusCheckRollup?: RawCheck[]
}

const prFields = 'number,title,url,state,isDraft,reviewDecision,statusCheckRollup'
const threadsQuery = 'query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved}}}}}'
const maxLogLines = 3000
const decisions: Record<string, ReviewDecision> = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes-requested', REVIEW_REQUIRED: 'review-required' }
const failed = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'])

function checkState(done: boolean, outcome = ''): CheckState {
  if (!done || outcome === 'PENDING' || outcome === 'EXPECTED') return 'pending'
  if (outcome === 'SUCCESS') return 'pass'
  return failed.has(outcome) ? 'fail' : 'skipped'
}

function toCheck(raw: RawCheck): CiCheck {
  if (raw.__typename === 'StatusContext') return { name: raw.context ?? 'status', state: checkState(true, raw.state), url: raw.targetUrl || undefined }
  const job = /\/actions\/runs\/\d+\/job\/(\d+)/.exec(raw.detailsUrl ?? '')?.[1]
  const name = [raw.workflowName, raw.name].filter(Boolean).join(' / ') || 'check'
  return { name, state: checkState(raw.status === 'COMPLETED', raw.conclusion), url: raw.detailsUrl || undefined, ...(job ? { job } : {}) }
}

function toPr(raw: RawPr): PullRequest {
  const state = raw.state.toLowerCase()
  return {
    number: raw.number,
    title: raw.title,
    url: raw.url,
    state: state === 'merged' || state === 'closed' ? state : 'open',
    draft: raw.isDraft === true,
    review: decisions[raw.reviewDecision ?? ''],
    checks: (raw.statusCheckRollup ?? []).map(toCheck),
  }
}

async function unresolvedThreads(cwd: string, pr: PullRequest, gh: Run): Promise<number | undefined> {
  const [, host, owner, repo] = /^https:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/\d+/.exec(pr.url) ?? []
  if (!host || !owner || !repo) return undefined
  const out = await gh('gh', ['api', 'graphql', '--hostname', host, '-f', `query=${threadsQuery}`, '-f', `owner=${owner}`, '-f', `repo=${repo}`, '-F', `number=${pr.number}`], cwd)
  const nodes = (JSON.parse(out) as { data?: { repository?: { pullRequest?: { reviewThreads?: { nodes?: { isResolved: boolean }[] } } } } }).data?.repository?.pullRequest?.reviewThreads?.nodes
  return nodes?.filter((node) => !node.isResolved).length
}

function failure(error: unknown): GithubState {
  const { code, killed, stderr } = error as { code?: unknown; killed?: boolean; stderr?: unknown }
  const text = String(stderr || (error instanceof Error ? error.message : error))
  if (code === 'ENOENT') return { notice: 'The GitHub CLI (gh) isn’t installed, so PR and CI status are hidden.' }
  if (/no pull requests found/i.test(text)) return {}
  if (/no git remotes|known GitHub host/i.test(text)) return { notice: 'This repository has no GitHub remote, so there’s no PR or CI.' }
  if (/gh auth login|not logged in/i.test(text)) return { notice: 'gh isn’t logged in. Run gh auth login in a terminal to see PR and CI status.' }
  if (killed || /error connecting|could not resolve|dial tcp|timed? ?out|network|offline/i.test(text)) return { notice: 'Couldn’t reach GitHub, so PR and CI status may be out of date.' }
  return { notice: `gh failed: ${text.trim().split('\n')[0]}` }
}

export async function pullRequest(cwd: string, gh: Run = run): Promise<GithubState> {
  try {
    const pr = toPr(JSON.parse(await gh('gh', ['pr', 'view', '--json', prFields], cwd)) as RawPr)
    if (pr.state === 'open') {
      const unresolved = await unresolvedThreads(cwd, pr, gh).catch(() => undefined)
      if (unresolved !== undefined) pr.unresolved = unresolved
    }
    return { pr }
  } catch (error) {
    return failure(error)
  }
}

export async function ciLog(cwd: string, job: string, gh: Run = run): Promise<CiLog> {
  if (!/^\d{1,20}$/.test(job)) return { error: 'That check has no GitHub Actions log.' }
  try {
    const out = await gh('gh', ['run', 'view', '--job', job, '--log-failed'], cwd)
    const lines = out.replace(/^[^\t\n]*\t[^\t\n]*\t\S+Z ?/gm, '').trimEnd().split('\n')
    return { log: lines.slice(-maxLogLines).join('\n') || 'The log is empty.' }
  } catch (error) {
    return { error: failure(error).notice ?? 'No log for this check.' }
  }
}
