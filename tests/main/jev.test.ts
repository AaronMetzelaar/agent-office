import { describe, expect, it } from 'vitest'
import { createJev } from '../../src/main/departments/jev'
import type { Post } from '../../src/main/workflow/linear'
import { defaultRules } from '../../src/shared/departments'

function jevApi(answer: unknown, status = 200) {
  const calls: { headers: Record<string, string>; body: { state: { task: string }; questions: { section: { criteria: object } } } }[] = []
  const post: Post = async (_url, init) => {
    calls.push({ headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) })
    return new Response(JSON.stringify({ answers: { section: answer } }), { status })
  }
  return { post, calls }
}

const root = '/Users/me/code/monorepo'

describe('Jev section pick', () => {
  it('asks Jev for a chat in the monorepo root and uses a confident monorepo section', async () => {
    const api = jevApi({ choice: 'mob', confidence: 0.9 })
    expect(await createJev(() => 'ts_key', defaultRules, api.post)(root, 'Fix the bid screen crash')).toBe('mob')
    expect(api.calls[0]!.headers.authorization).toBe('Bearer ts_key')
    expect(api.calls[0]!.body.state.task).toBe('Fix the bid screen crash')
    expect(Object.keys(api.calls[0]!.body.questions.section.criteria)).toEqual(['mkt', 'adm', 'mob', 'plat'])
  })

  it('keeps the folder rule when Jev is unsure, fails, has no key, or the folder already names a section', async () => {
    expect(await createJev(() => 'k', defaultRules, jevApi({ choice: 'mob', confidence: 0.3 }).post)(root, 'x')).toBeUndefined()
    expect(await createJev(() => 'k', defaultRules, jevApi({ choice: 'gym', confidence: 1 }).post)(root, 'x')).toBeUndefined()
    expect(await createJev(() => 'k', defaultRules, jevApi({}, 500).post)(root, 'x')).toBeUndefined()
    const unused = jevApi({ choice: 'mob', confidence: 1 })
    expect(await createJev(() => undefined, defaultRules, unused.post)(root, 'x')).toBeUndefined()
    expect(await createJev(() => 'k', defaultRules, unused.post)(`${root}/frontend/admin`, 'x')).toBeUndefined()
    expect(await createJev(() => 'k', defaultRules, unused.post)('/Users/me/side', 'x')).toBeUndefined()
    expect(unused.calls).toHaveLength(0)
  })
})
