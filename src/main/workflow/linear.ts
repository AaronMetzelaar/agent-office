import { leadingTicket, type Ticket } from '../../shared/workflow'

export type Post = (url: string, init: RequestInit) => Promise<Response>
export type Linear = ReturnType<typeof createLinear>

interface RawState {
  id: string
  name: string
  type: string
  position: number
}

interface RawIssue {
  id: string
  identifier: string
  title: string
  url: string
  description?: string | null
  state: { name: string }
  team: { states: { nodes: RawState[] } }
}

const endpoint = 'https://api.linear.app/graphql'
const ttlMs = 5 * 60_000
const issueQuery = 'query($id:String!){issue(id:$id){id identifier title url description state{name} team{states{nodes{id name type position}}}}}'
const moveMutation = 'mutation($id:String!,$stateId:String!){issueUpdate(id:$id,input:{stateId:$stateId}){success}}'

export function ticketId(text: string | undefined): string | undefined {
  const match = /(?:^|\/)([a-z]{2,6})-(\d{1,6})(?![^-_/\s])/i.exec(text?.trim() ?? '')
  return match ? `${match[1]!.toUpperCase()}-${match[2]}` : undefined
}

const worktreeName = (cwd: string) => /\/\.claude\/worktrees\/([^/]+)/.exec(cwd)?.[1]

export const chatTicketId = (branch: string | undefined, cwd: string) => ticketId(branch) ?? ticketId(worktreeName(cwd))

export const ticketPrompt = (ticket: Ticket, rest: string) => [`Work on Linear ticket ${ticket.id}: ${ticket.title}`, ticket.status && `Status: ${ticket.status}`, ticket.description, ticket.url, rest].filter(Boolean).join('\n\n')

export async function withTicket(linear: Pick<Linear, 'ticket'>, prompt: string, options: unknown): Promise<{ prompt: string; options: unknown }> {
  const lead = leadingTicket(prompt)
  if (!lead) return { prompt, options }
  const wanted = typeof options === 'object' && options ? options : {}
  const { ticket } = await linear.ticket(lead.id)
  if (!ticket.title) return { prompt, options: { ...wanted, title: [lead.id, lead.rest].filter(Boolean).join(' ') } }
  return { prompt: ticketPrompt(ticket, lead.rest), options: { ...wanted, title: `${ticket.id} ${ticket.title}` } }
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createLinear(key: () => string | undefined, post: Post = fetch) {
  const cache = new Map<string, { at: number; issue: RawIssue }>()

  async function call<T>(query: string, variables: Record<string, string>): Promise<T> {
    const apiKey = key()
    if (!apiKey) throw new Error('there’s no Linear API key')
    const response = await post(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: apiKey }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(10_000) })
    const body = (await response.json().catch(() => ({}))) as { data?: T; errors?: { message?: string }[] }
    if (!response.ok || body.errors?.length || !body.data) throw new Error(body.errors?.[0]?.message ?? `Linear answered ${response.status}`)
    return body.data
  }

  async function issue(id: string, fresh = false): Promise<RawIssue> {
    const hit = cache.get(id)
    if (!fresh && hit && Date.now() - hit.at < ttlMs) return hit.issue
    const { issue } = await call<{ issue: RawIssue }>(issueQuery, { id })
    cache.set(id, { at: Date.now(), issue })
    return issue
  }

  return {
    async ticket(id: string): Promise<{ ticket: Ticket; notice?: string }> {
      if (!key()) return { ticket: { id } }
      try {
        const found = await issue(id)
        return { ticket: { id: found.identifier, title: found.title, status: found.state.name, url: found.url, ...(found.description ? { description: found.description } : {}) } }
      } catch {
        return { ticket: { id }, notice: `Couldn’t read ${id} from Linear, so only its id shows.` }
      }
    },

    async moveToDone(id: string, confirm: (from: string, to: string) => Promise<boolean>): Promise<{ status?: string; error?: string }> {
      try {
        const found = await issue(id, true)
        const done = found.team.states.nodes.filter((state) => state.type === 'completed').sort((a, b) => a.position - b.position)[0]
        if (!done) return { error: `${id}’s team has no Done status.` }
        if (found.state.name === done.name) return { status: done.name }
        if (!(await confirm(found.state.name, done.name))) return {}
        const { issueUpdate } = await call<{ issueUpdate: { success: boolean } }>(moveMutation, { id: found.id, stateId: done.id })
        cache.delete(id)
        return issueUpdate.success ? { status: done.name } : { error: `Linear didn’t move ${id}.` }
      } catch (error) {
        return { error: `Couldn’t move ${id}: ${errorText(error)}` }
      }
    },
  }
}
