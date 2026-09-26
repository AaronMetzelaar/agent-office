import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { allowFrom, answerDecision, questionKey, questionsOf } from '../../src/renderer/panels/chat/cards'
import PlanCard from '../../src/renderer/panels/chat/PlanCard.vue'
import QuestionCard from '../../src/renderer/panels/chat/QuestionCard.vue'
import RequestCard from '../../src/renderer/panels/chat/RequestCard.vue'
import { keyAction } from '../../src/renderer/state/keys'
import type { PendingRequestView } from '../../src/shared/permissions'
import { openOffice } from '../fakes/office'

vi.mock('electron', () => import('../fakes/electron'))

const request = (fields: Partial<PendingRequestView> = {}): PendingRequestView => ({
  id: 'r1',
  tool: 'Bash',
  summary: 'pnpm test',
  input: { command: 'pnpm test' },
  createdAt: 0,
  dangerous: false,
  alwaysAllow: true,
  ...fields,
})

const render = (component: unknown, props: Record<string, unknown>) => renderToString(createSSRApp({ render: () => h(component as never, props) }))
const danger = request({ summary: 'rm -rf dist', input: { command: 'rm -rf dist' }, dangerous: true, dangerReason: 'Deletes files recursively (rm -rf)', alwaysAllow: false })

describe('request card', () => {
  it('offers Allow once, Always allow and Deny with 1 2 3 on the first card', async () => {
    const html = await render(RequestCard, { request: request(), first: true, cwd: '/repo' })
    expect(html).toContain('$ pnpm test')
    expect(html).toContain('Bash in /repo')
    expect(html).toMatch(/Allow once<kbd>1<\/kbd>/)
    expect(html).toMatch(/Always allow<kbd>2<\/kbd>/)
    expect(html).toMatch(/Deny<kbd>3<\/kbd>/)

    const later = await render(RequestCard, { request: request({ alwaysAllow: false }), first: false, cwd: '/repo' })
    expect(later).not.toContain('Always allow')
    expect(later).not.toContain('<kbd>')
  })

  it('a dangerous card shows the warning style, and only a pointer click allows it', async () => {
    const html = await render(RequestCard, { request: danger, first: true, cwd: '/repo' })
    expect(html).toContain('class="ask danger"')
    expect(html).toContain('Deletes files recursively (rm -rf) · only a click allows this')
    expect(html).not.toContain('<kbd>')
    expect(html).not.toContain('Always allow')

    expect(allowFrom(danger, { detail: 0 })).toBe(false)
    expect(allowFrom(danger, { detail: 1 })).toBe(true)
    expect(allowFrom(request(), { detail: 0 })).toBe(true)
    for (const key of ['1', '2', '3']) expect(keyAction(key, { open: 'c1', queue: [], card: danger })).toBeUndefined()
  })

  it('shows diff stats for an edit request', async () => {
    const html = await render(RequestCard, { request: request({ tool: 'Edit', summary: '/repo/BidFlow.vue', input: { file_path: '/repo/BidFlow.vue', old_string: 'a', new_string: 'a\nb' } }), first: true, cwd: '/repo' })
    expect(html).toMatch(/\+2<\/span> <span class="del">−1/)
  })
})

describe('plan and question cards', () => {
  it('renders the plan as markdown with Approve and Keep planning', async () => {
    const html = await render(PlanCard, { request: request({ tool: 'ExitPlanMode', summary: 'Plan ready for review', input: { plan: '## Plan\n\n1. Read `BidFlow.vue`\n<script>x()</script>' } }), first: true })
    expect(html).toContain('<h2>Plan</h2>')
    expect(html).toContain('<code>BidFlow.vue</code>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toMatch(/Approve plan<kbd>1<\/kbd>/)
    expect(html).toContain('Keep planning…')
  })

  it('renders each question with its options and a free answer', async () => {
    const questions = [{ question: 'Which date library?', header: 'Library', options: [{ label: 'date-fns', description: 'Tree-shakeable' }, { label: 'dayjs' }] }]
    const html = await render(QuestionCard, { request: request({ tool: 'AskUserQuestion', input: { questions } }), first: true })
    expect(html).toContain('Which date library?')
    expect(html).toMatch(/date-fns<small>Tree-shakeable<\/small><\/span><kbd>1<\/kbd>/)
    expect(html).not.toContain('title=')
    expect(html).toContain('Or your own answer…')
    expect(html).toMatch(/Send answers<\/button>/)
  })

  it('answers questions with number keys, arrows and Enter', () => {
    const questions = [
      { question: 'Library?', options: [{ label: 'date-fns' }, { label: 'dayjs' }] },
      { question: 'Targets?', multiSelect: true, options: [{ label: 'web' }, { label: 'ios' }] },
    ]
    const start = { question: 0, option: 0 }
    expect(questionKey('2', questions, start, [], false)).toEqual({ focus: { question: 0, option: 1 }, picked: ['dayjs'] })
    expect(questionKey('3', questions, start, [], false)).toBeUndefined()
    expect(questionKey('ArrowDown', questions, start, [], false)).toEqual({ focus: { question: 0, option: 1 }, picked: ['dayjs'] })
    expect(questionKey('ArrowUp', questions, start, ['date-fns'], false)).toEqual({ focus: start, picked: ['date-fns'] })
    expect(questionKey('Enter', questions, start, [], false)).toEqual({ focus: start })
    expect(questionKey('Enter', questions, start, ['dayjs'], false)).toEqual({ focus: { question: 1, option: 0 } })
    const targets = { question: 1, option: 0 }
    expect(questionKey('2', questions, targets, ['web'], false)).toEqual({ focus: { question: 1, option: 1 }, picked: ['web', 'ios'] })
    expect(questionKey('ArrowDown', questions, targets, ['web'], false)).toEqual({ focus: { question: 1, option: 1 } })
    expect(questionKey(' ', questions, targets, ['web'], false)).toEqual({ focus: targets, picked: [] })
    expect(questionKey('Enter', questions, targets, [], true)).toEqual({ focus: targets, submit: true })
  })

  it('builds AskUserQuestion answers only when every question has one', () => {
    const questions = questionsOf({ input: { questions: [{ question: 'Library?', options: [] }, { question: 'Targets?', multiSelect: true }, { nope: true }] } })
    expect(questions.map((q) => q.question)).toEqual(['Library?', 'Targets?'])
    expect(answerDecision(questions, { 'Library?': ['dayjs'] }, {})).toBeUndefined()
    expect(answerDecision(questions, { 'Library?': ['dayjs'], 'Targets?': ['web', 'ios'] }, { 'Targets?': ' android ' })).toEqual({
      kind: 'answer',
      answers: { 'Library?': 'dayjs', 'Targets?': 'web, ios, android' },
    })
    expect(answerDecision([], {}, {})).toBeUndefined()
  })
})

describe('question answers reach Claude', () => {
  let dir: string
  let office: ReturnType<typeof openOffice>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agent-office-card-'))
    vi.stubEnv('CLAUDE_CONFIG_DIR', dir)
    office = openOffice(dir)
  })

  afterEach(() => {
    office.db.close()
    rmSync(dir, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('through the broker’s updatedInput path', async () => {
    const id = office.start('Pick a library')
    office.engine.init(id)
    const questions = [{ question: 'Which date library?', options: [{ label: 'date-fns' }, { label: 'dayjs' }] }]
    const decision = office.engine.askTool(id, 'AskUserQuestion', { questions })
    const pending = office.chat(id).pendingRequests[0]!
    const answer = answerDecision(questionsOf(pending), { 'Which date library?': ['dayjs'] }, {})!
    expect(office.broker.resolveRequest(pending.id, answer, 'chat')).toEqual({ ok: true })
    expect(await decision).toEqual({ behavior: 'allow', updatedInput: { questions, answers: { 'Which date library?': 'dayjs' } } })
  })
})
