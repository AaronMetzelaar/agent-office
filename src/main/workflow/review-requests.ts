import { homedir } from 'node:os'
import type { StartOptions } from '../../shared/departments'
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
  commits?: { nodes?: { commit?: { committedDate?: string; statusCheckRollup?: { state?: string } | null } }[] }
  comments?: { nodes?: { createdAt?: string; author?: { login?: string } | null }[] }
  reviews?: { nodes?: { submittedAt?: string | null; author?: { login?: string } | null }[] }
  timelineItems?: { nodes?: { createdAt?: string; requestedReviewer?: { login?: string } | null }[] }
}

interface RawDetails {
  viewer?: { login?: string }
  nodes?: (RawNode | null)[]
}

export const searchArgs = ['search', 'prs', '--review-requested=@me', '--state=open', '--json', 'id,number,title,url,repository,author,createdAt,isDraft', '--limit', '100']
const detailsQuery =
  'query($ids:[ID!]!){viewer{login} nodes(ids:$ids){... on PullRequest{id additions deletions commits(last:1){nodes{commit{committedDate statusCheckRollup{state}}}} comments(last:50){nodes{createdAt author{login}}} reviews(last:50){nodes{submittedAt author{login}}} timelineItems(itemTypes:[REVIEW_REQUESTED_EVENT],last:20){nodes{... on ReviewRequestedEvent{createdAt requestedReviewer{... on User{login}}}}}}}}'
const ciStates: Record<string, CiSummary> = { SUCCESS: 'pass', FAILURE: 'fail', ERROR: 'fail', PENDING: 'pending', EXPECTED: 'pending' }
const pollMs = 5 * 60_000
const focusGapMs = 60_000

function answered(node: RawNode, me: string): boolean {
  const mine = [
    ...(node.comments?.nodes ?? []).filter((comment) => comment.author?.login === me).map((comment) => comment.createdAt),
    ...(node.reviews?.nodes ?? []).filter((review) => review.author?.login === me).map((review) => review.submittedAt),
  ].flatMap((at) => (at ? [Date.parse(at)] : []))
  const pushed = Date.parse(node.commits?.nodes?.[0]?.commit?.committedDate ?? '')
  return mine.length > 0 && !(pushed > Math.max(...mine))
}

export function toRequests(search: RawSearch[], details: RawDetails | undefined): ReviewRequest[] {
  const nodes = new Map((details?.nodes ?? []).flatMap((node) => (node ? [[node.id, node] as const] : [])))
  const me = details?.viewer?.login
  return search.flatMap((pr) => {
    const node = nodes.get(pr.id)
    if (node && me && answered(node, me)) return []
    const events = node?.timelineItems?.nodes ?? []
    const asked = events.findLast((event) => !!me && event.requestedReviewer?.login === me) ?? events.at(-1)
    return [{
      url: pr.url,
      repo: pr.repository.nameWithOwner,
      number: pr.number,
      title: pr.title,
      author: pr.author?.login ?? 'unknown',
      requestedAt: Date.parse(asked?.createdAt ?? pr.createdAt),
      draft: pr.isDraft === true,
      ...(typeof node?.additions === 'number' ? { additions: node.additions, deletions: node.deletions ?? 0 } : {}),
      ...(node?.commits ? { ci: ciStates[node.commits.nodes?.[0]?.commit?.statusCheckRollup?.state ?? ''] ?? 'none' } : {}),
    }]
  })
}

function unavailable(error: unknown): string {
  const { code, stderr } = error as { code?: unknown; stderr?: unknown }
  const text = String(stderr || (error instanceof Error ? error.message : error))
  if (code === 'ENOENT') return 'The GitHub CLI (gh) isn’t installed, so review requests are hidden.'
  if (/gh auth login|not logged in/i.test(text)) return 'gh isn’t logged in, so review requests are hidden. Run gh auth login in a terminal.'
  return 'Couldn’t reach GitHub, so review requests may be out of date.'
}

const remoteSlug = (url: string) => /[/:]([^/:]+\/[^/]+?)(?:\.git)?\/?$/.exec(url.trim())?.[1]?.toLowerCase()

export async function localClone(repo: string, folders: readonly string[], git: Run = run): Promise<string | undefined> {
  for (const folder of folders) {
    const url = await git('git', ['remote', 'get-url', 'origin'], folder).catch(() => '')
    if (remoteSlug(url) === repo.toLowerCase()) return folder
  }
  return undefined
}

export async function reviewStart(request: Pick<ReviewRequest, 'url' | 'repo' | 'number' | 'title'>, folders: readonly string[], git: Run = run) {
  const cwd = (await localClone(request.repo, folders, git)) ?? homedir()
  const options: StartOptions = { review: true, title: `Review #${request.number} ${request.title}` }
  return { cwd, prompt: `/pr-review-rundown ${request.url}`, options }
}

export function createReviewQueue(gh: Run = run, onChange: (queue: ReviewQueue) => void = () => {}, now = Date.now) {
  let listed: ReviewRequest[] = []
  let notice: string | undefined
  let polling: Promise<void> | undefined
  let lastPoll = -Infinity
  let timer: ReturnType<typeof setInterval> | undefined

  const view = (): ReviewQueue => ({ requests: listed, ...(notice ? { notice } : {}) })

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
