import { homedir } from 'node:os'
import { join } from 'node:path'
import { homeDept, ruleFor, type DeptId, type DeptRule } from '../../shared/departments'
import type { CiSummary, ReviewQueue, ReviewRequest } from '../../shared/workflow'
import { run, type Run } from '../review/git'

interface RawSearch {
  id: string
  number: number
  title: string
  url: string
  isDraft?: boolean
  createdAt: string
  repository: { nameWithOwner: string }
  author?: { login?: string }
}

interface RawNode {
  id: string
  additions?: number
  deletions?: number
  files?: { nodes?: { path: string }[] }
  commits?: { nodes?: { commit?: { statusCheckRollup?: { state?: string } | null } }[] }
  timelineItems?: { nodes?: { createdAt?: string; requestedReviewer?: { login?: string } | null }[] }
}

interface RawDetails {
  viewer?: { login?: string }
  nodes?: (RawNode | null)[]
}

export interface Listed extends ReviewRequest {
  files: string[]
}

export const searchArgs = ['search', 'prs', '--review-requested=@me', '--state=open', '--json', 'id,number,title,url,repository,author,createdAt,isDraft', '--limit', '100']
const detailsQuery =
  'query($ids:[ID!]!){viewer{login} nodes(ids:$ids){... on PullRequest{id additions deletions files(first:100){nodes{path}} commits(last:1){nodes{commit{statusCheckRollup{state}}}} timelineItems(itemTypes:[REVIEW_REQUESTED_EVENT],last:20){nodes{... on ReviewRequestedEvent{createdAt requestedReviewer{... on User{login}}}}}}}}'
const ciStates: Record<string, CiSummary> = { SUCCESS: 'pass', FAILURE: 'fail', ERROR: 'fail', PENDING: 'pending', EXPECTED: 'pending' }
const pollMs = 5 * 60_000
const focusGapMs = 60_000

export function toRequests(search: RawSearch[], details: RawDetails | undefined): Listed[] {
  const nodes = new Map((details?.nodes ?? []).flatMap((node) => (node ? [[node.id, node] as const] : [])))
  const me = details?.viewer?.login
  return search.map((pr) => {
    const node = nodes.get(pr.id)
    const events = node?.timelineItems?.nodes ?? []
    const asked = events.findLast((event) => !!me && event.requestedReviewer?.login === me) ?? events.at(-1)
    return {
      url: pr.url,
      repo: pr.repository.nameWithOwner,
      number: pr.number,
      title: pr.title,
      author: pr.author?.login ?? 'unknown',
      requestedAt: Date.parse(asked?.createdAt ?? pr.createdAt),
      draft: pr.isDraft === true,
      ...(typeof node?.additions === 'number' ? { additions: node.additions, deletions: node.deletions ?? 0 } : {}),
      ...(node?.commits ? { ci: ciStates[node.commits.nodes?.[0]?.commit?.statusCheckRollup?.state ?? ''] ?? 'none' } : {}),
      files: node?.files?.nodes?.map((file) => file.path) ?? [],
    }
  })
}

function unavailable(error: unknown): string {
  const { code, stderr } = error as { code?: unknown; stderr?: unknown }
  const text = String(stderr || (error instanceof Error ? error.message : error))
  if (code === 'ENOENT') return 'The GitHub CLI (gh) isn’t installed, so review requests are hidden.'
  if (/gh auth login|not logged in/i.test(text)) return 'gh isn’t logged in, so review requests are hidden. Run gh auth login in a terminal.'
  return 'Couldn’t reach GitHub, so review requests may be out of date.'
}

export function reviewDept(repo: string, files: readonly string[], rules: readonly DeptRule[]): DeptId {
  const votes = new Map<DeptId, number>()
  for (const file of files) {
    const dept = ruleFor(join(repo, file), rules)
    if (dept) votes.set(dept, (votes.get(dept) ?? 0) + 1)
  }
  return [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? homeDept(repo, false, rules)
}

const remoteSlug = (url: string) => /[/:]([^/:]+\/[^/]+?)(?:\.git)?\/?$/.exec(url.trim())?.[1]?.toLowerCase()

export async function localClone(repo: string, folders: readonly string[], git: Run = run): Promise<string | undefined> {
  for (const folder of folders) {
    const url = await git('git', ['remote', 'get-url', 'origin'], folder).catch(() => '')
    if (remoteSlug(url) === repo.toLowerCase()) return folder
  }
  return undefined
}

export function createReviewQueue(gh: Run = run, onChange: (queue: ReviewQueue) => void = () => {}, now = Date.now) {
  let listed: Listed[] = []
  let notice: string | undefined
  let polling: Promise<void> | undefined
  let lastPoll = -Infinity
  let timer: ReturnType<typeof setInterval> | undefined

  const view = (): ReviewQueue => ({ requests: listed.map(({ files: _files, ...request }) => request), ...(notice ? { notice } : {}) })

  async function fetchAll() {
    lastPoll = now()
    try {
      const search = JSON.parse(await gh('gh', searchArgs, homedir())) as RawSearch[]
      const ids = search.flatMap((pr) => ['-f', `ids[]=${pr.id}`])
      const details = search.length ? await gh('gh', ['api', 'graphql', '-f', `query=${detailsQuery}`, ...ids], homedir()).then((out) => (JSON.parse(out) as { data?: RawDetails }).data, () => undefined) : undefined
      listed = toRequests(search, details)
      notice = undefined
    } catch (error) {
      notice = unavailable(error)
    }
    onChange(view())
  }

  const poll = () => (polling ??= fetchAll().finally(() => (polling = undefined)))

  return {
    view,
    poll,
    find: (url: unknown) => listed.find((request) => request.url === url),
    focus() {
      if (now() - lastPoll >= focusGapMs) void poll()
    },
    start() {
      void poll()
      timer = setInterval(() => void poll(), pollMs)
    },
    stop() {
      clearInterval(timer)
    },
  }
}
