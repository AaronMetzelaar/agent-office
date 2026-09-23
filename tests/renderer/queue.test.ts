import { describe, expect, it } from 'vitest'
import { buildQueue, queuePositions, type Queueable } from '../../src/renderer/office/queue'

const needs = (id: string, since: number, accountId = 'main'): Queueable => ({ id, accountId, state: 'needs-you', since })
const stuck = (id: string, since: number, reason: Queueable['stuckReason'], accountId = 'main'): Queueable => ({ id, accountId, state: 'stuck', since, stuckReason: reason })

describe('door queue', () => {
  it('gives three waiting chats spots 1–3 by their oldest pending request, and moves the rest up on release', () => {
    const agents = [needs('late', 300), needs('first', 100), needs('middle', 200), { id: 'busy', accountId: 'main', state: 'working', since: 50 } as Queueable]
    expect([...queuePositions(buildQueue(agents))]).toEqual([
      ['first', 0],
      ['middle', 1],
      ['late', 2],
    ])
    const released = agents.filter((a) => a.id !== 'first')
    expect([...queuePositions(buildQueue(released))]).toEqual([
      ['middle', 0],
      ['late', 1],
    ])
  })

  it('queues a stuck chat as the warning variant, in arrival order', () => {
    const queue = buildQueue([needs('ask', 200), stuck('crash', 150, 'crashed')])
    expect(queue.map((item) => [item.chatId, item.kind])).toEqual([
      ['crash', 'stuck'],
      ['ask', 'request'],
    ])
  })

  it('shows one login item per account, however many chats it affects', () => {
    const agents = [stuck('a', 300, 'needs-login'), stuck('b', 100, 'needs-login'), stuck('c', 200, 'needs-login'), needs('ask', 250)]
    const queue = buildQueue(agents, [{ accountId: 'main', label: 'main' }])
    const logins = queue.filter((item) => item.kind === 'login')
    expect(logins).toHaveLength(1)
    expect(logins[0]).toMatchObject({ chatId: 'b', label: 'main', chats: ['a', 'b', 'c'] })
    expect([...queuePositions(queue)]).toEqual([
      ['b', 0],
      ['ask', 1],
    ])
  })

  it('lists a login item with no affected chat without giving it a spot', () => {
    const queue = buildQueue([needs('ask', 10)], [{ accountId: 'research', label: 'research' }])
    expect(queue.map((item) => item.kind)).toEqual(['request', 'login'])
    expect([...queuePositions(queue)]).toEqual([['ask', 0]])
  })
})
