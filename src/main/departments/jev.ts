import { ruleFor, type DeptId, type DeptRule } from '../../shared/departments'
import type { Post } from '../workflow/linear'

export type Jev = ReturnType<typeof createJev>

const endpoint = 'https://api.typesafe.ai/v1/systemone'
export const minConfidence = 0.5

const criteria: Partial<Record<DeptId, string>> = {
  mkt: 'The customer-facing marketplace website in frontend/marketplace: shop pages, listings, bidding, checkout, accounts',
  adm: 'The internal admin portal in frontend/admin: back-office tools for staff',
  mob: 'The mobile app in frontend/mobile',
  plat: 'Backend services, APIs, databases, infrastructure or CI, or work spread across several apps',
}

export function createJev(key: () => string | undefined, rules: readonly DeptRule[], post: Post = fetch) {
  return async function place(cwd: string, task: string): Promise<DeptId | undefined> {
    const apiKey = key()
    if (!apiKey || ruleFor(cwd, rules) !== 'plat') return undefined
    try {
      const response = await post(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'jev-latest',
          state: { task, folder: cwd },
          questions: { section: { type: 'choice', instructions: 'A coding agent starts in the root of a monorepo with the instructions in `task`. Which part of the monorepo will it mostly change?', criteria } },
        }),
        signal: AbortSignal.timeout(3000),
      })
      if (!response.ok) throw new Error(`Jev answered ${response.status}`)
      const answer = ((await response.json()) as { answers?: { section?: { choice?: string; confidence?: number } } }).answers?.section
      const choice = answer?.choice as DeptId | undefined
      return choice && choice in criteria && (answer?.confidence ?? 0) >= minConfidence ? choice : undefined
    } catch (error) {
      console.warn('[jev] could not pick a section', error)
      return undefined
    }
  }
}
