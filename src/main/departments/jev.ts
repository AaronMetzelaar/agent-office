import { repoPath, type DeptId, type DeptRule, type Room } from '../../shared/departments'
import type { Post } from '../workflow/linear'

export type Jev = ReturnType<typeof createJev>
export type Placement = DeptId | 'new'

const endpoint = 'https://api.typesafe.ai/v1/systemone'
export const minConfidence = 0.5

const monorepo: Partial<Record<DeptId, string>> = {
  mkt: 'The customer-facing marketplace website: shop pages, listings, bidding, checkout, accounts',
  adm: 'The internal admin portal: back-office tools for staff',
  mob: 'The mobile app',
  plat: 'Backend services, APIs, databases, infrastructure or CI of the monorepo, or work spread across several of its apps',
}

function criteriaFor(rules: readonly DeptRule[], rooms: readonly Room[], full: boolean): Record<string, string> {
  const inFolders = (id: DeptId, text: string) => {
    const paths = rules.filter((rule) => rule.dept === id).map((rule) => rule.path)
    return paths.length ? `${text}. Its agents work in ${paths.join(' or ')}` : text
  }
  return {
    ...Object.fromEntries(Object.entries(monorepo).map(([id, text]) => [id, inFolders(id as DeptId, text)])),
    ...Object.fromEntries(rooms.map((room) => [room.id, inFolders(room.id, `${room.name}: ${room.about}`)])),
    ...(full
      ? { side: 'Side projects: work in a repository none of the rooms above cover, or work that fits none of them' }
      : { new: 'None of the rooms above: the agent works in a repository none of them cover, or on work that clearly fits none of them, so it gets a new room' }),
  }
}

export function createJev(key: () => string | undefined, rules: readonly DeptRule[], rooms: { list(): readonly Room[]; full(): boolean }, post: Post = fetch) {
  return async function place(cwd: string, task: string): Promise<Placement | undefined> {
    const apiKey = key()
    if (!apiKey) return undefined
    const criteria = criteriaFor(rules, rooms.list(), rooms.full())
    try {
      const response = await post(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'jev-latest',
          state: { task, folder: repoPath(cwd) },
          questions: { room: { type: 'choice', instructions: 'A coding agent starts in `folder` with the instructions in `task`. The office has one room per repository or per part of a repository. Which room should the agent sit in?', criteria } },
        }),
        signal: AbortSignal.timeout(3000),
      })
      if (!response.ok) throw new Error(`Jev answered ${response.status}`)
      const answer = ((await response.json()) as { answers?: { room?: { choice?: string; confidence?: number } } }).answers?.room
      const choice = answer?.choice
      return choice && choice in criteria && (answer?.confidence ?? 0) >= minConfidence ? (choice as Placement) : undefined
    } catch (error) {
      console.warn('[jev] could not pick a room', error)
      return undefined
    }
  }
}
