import { playgroundRoom, repoPath, reviewRoom, type DeptId, type RoomDef } from '../../shared/departments'
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

interface Registry {
  list(): readonly RoomDef[]
  folders(id: string): string[]
}

function criteriaFor(rooms: Registry): Record<string, string> {
  const inFolders = (id: DeptId, text: string) => {
    const paths = rooms.folders(id)
    return paths.length ? `${text}. Its agents work in ${paths.join(' or ')}` : text
  }
  const choices = rooms.list().filter((room) => room.id !== playgroundRoom.id && room.id !== reviewRoom.id && !room.account)
  return {
    ...Object.fromEntries(choices.map((room) => [room.id, inFolders(room.id, monorepo[room.id] ?? (room.about ? `${room.name}: ${room.about}` : room.name))])),
    [playgroundRoom.id]: 'Side projects: quick questions, one-off scripts and experiments, and anything that isn’t ongoing work in one repository',
    new: 'A new room: ongoing project work in a repository that none of the rooms above cover. Never for a quick question or a one-off task, and never for a folder a room above already covers',
  }
}

export function createJev(key: () => string | undefined, rooms: Registry, post: Post = fetch) {
  return async function place(cwd: string, task: string): Promise<Placement | undefined> {
    const apiKey = key()
    if (!apiKey) return undefined
    const criteria = criteriaFor(rooms)
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
