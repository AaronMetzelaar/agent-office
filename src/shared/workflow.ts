export interface Ticket {
  id: string
  title?: string
  status?: string
  url?: string
  description?: string
}

export type StepId = 'test-cases' | 'verify' | 'review' | 'pr' | 'comments' | 'fix-ci' | 'cleanup' | 'move-ticket'

export interface NextStep {
  id: StepId
  label: string
  command?: string
}

export interface ShipIt {
  steps: NextStep[]
  ticket?: Ticket
  waiting?: string
  notice?: string
}

export type TicketLookup = { ticket: Ticket; notice?: string } | { error: string }

export type CiSummary = 'pass' | 'fail' | 'pending' | 'none'

export interface ReviewRequest {
  url: string
  repo: string
  number: number
  title: string
  author: string
  requestedAt: number
  draft: boolean
  additions?: number
  deletions?: number
  ci?: CiSummary
}

export interface ReviewQueue {
  requests: ReviewRequest[]
  notice?: string
}

const day = 86_400_000

export function workingMs(from: number, to: number): number {
  let total = 0
  for (let at = from; at < to; ) {
    const date = new Date(at)
    const end = Math.min(to, new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime())
    if (date.getDay() % 6) total += end - at
    at = end
  }
  return total
}

export const overdue = (request: Pick<ReviewRequest, 'requestedAt'>, now: number) => workingMs(request.requestedAt, now) > 2 * day
