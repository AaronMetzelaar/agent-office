import type { Answered, ChatMode } from '../../../shared/chat'
import type { Decision, PendingRequestView } from '../../../shared/permissions'

export type Question = { question: string; header?: string; multiSelect?: boolean; options?: { label: string; description?: string }[] }

export const questionsOf = (request: Pick<PendingRequestView, 'input'>): Question[] => (Array.isArray(request.input.questions) ? (request.input.questions as Question[]).filter((q) => typeof q?.question === 'string') : [])

export interface QuestionFocus {
  question: number
  option: number
}

export interface QuestionStep {
  focus: QuestionFocus
  picked?: string[]
  submit?: true
}

export const toggled = (question: Question, current: readonly string[], label: string) => (current.includes(label) ? current.filter((entry) => entry !== label) : question.multiSelect ? [...current, label] : [label])

export function questionKey(key: string, questions: readonly Question[], focus: QuestionFocus, current: readonly string[], typed: boolean): QuestionStep | undefined {
  const question = questions[focus.question]
  if (!question) return undefined
  const options = question.options ?? []
  const digit = /^[1-9]$/.test(key) ? Number(key) : 0
  if (digit && digit <= options.length) return { focus: { ...focus, option: digit - 1 }, picked: toggled(question, current, options[digit - 1]!.label) }
  const step = key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0
  if (step && options.length) {
    const option = Math.min(options.length - 1, Math.max(0, focus.option + step))
    return { focus: { ...focus, option }, ...(question.multiSelect ? {} : { picked: [options[option]!.label] }) }
  }
  if (key === ' ' && question.multiSelect && options[focus.option]) return { focus, picked: toggled(question, current, options[focus.option]!.label) }
  if (key !== 'Enter') return undefined
  if (!current.length && !typed) return { focus }
  return focus.question + 1 < questions.length ? { focus: { question: focus.question + 1, option: 0 } } : { focus, submit: true }
}

export const planOf = (request: Pick<PendingRequestView, 'input'>) => (typeof request.input.plan === 'string' ? request.input.plan : '')

export function answerDecision(questions: readonly Question[], picked: Record<string, string[]>, other: Record<string, string>): Decision | undefined {
  const answers: Record<string, string> = {}
  for (const { question } of questions) {
    const labels = [...(picked[question] ?? []), ...(other[question]?.trim() ? [other[question]!.trim()] : [])]
    if (!labels.length) return undefined
    answers[question] = labels.join(', ')
  }
  return questions.length ? { kind: 'answer', answers } : undefined
}

export const pointerClick = (event: Pick<MouseEvent, 'detail'>) => event.detail > 0

export const allowFrom = (request: Pick<PendingRequestView, 'dangerous'>, event: Pick<MouseEvent, 'detail'>) => !request.dangerous || pointerClick(event)

const sourceLabels: Partial<Record<Answered['source'], string>> = { notification: 'notification', phone: 'phone' }
const decisionLabels: Record<Answered['decision'], string> = { allow: 'Allowed', always: 'Always allowed', deny: 'Denied', answer: 'Answered' }

export interface ElsewhereCard {
  request: PendingRequestView
  label: string
}

export function answeredElsewhere(seen: ReadonlyMap<string, PendingRequestView>, pending: readonly Pick<PendingRequestView, 'id'>[], answered: readonly Answered[] = []): ElsewhereCard[] {
  const open = new Set(pending.map((request) => request.id))
  return [...seen.values()].flatMap((request) => {
    const answer = open.has(request.id) ? undefined : answered.find((entry) => entry.id === request.id)
    const where = answer && sourceLabels[answer.source]
    return answer && where ? [{ request, label: `Answered from ${where} · ${decisionLabels[answer.decision]}` }] : []
  })
}

export const modeLabels: Record<ChatMode, string> = {
  auto: 'Auto mode',
  plan: 'Plan mode',
  default: 'Ask before edits',
  acceptEdits: 'Accept edits',
  bypassPermissions: 'Bypass permissions',
  dontAsk: 'Don’t ask',
}
