import { describe, expect, it, vi } from 'vitest'
import type { Placement } from '../../src/main/departments/jev'
import type { Hub } from '../../src/main/ipc'
import { wireWorkflow, type WorkflowDeps } from '../../src/main/workflow'

function wire(pick: Placement | undefined) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const hub = { handle: (name: string, command: (...args: unknown[]) => unknown) => handlers.set(name, command), send: () => {} } as unknown as Hub
  const starts: unknown[] = []
  const moves: [string, string][] = []
  const jev = vi.fn(async () => pick)
  const store = {
    view: () => undefined,
    views: () => [],
    start: (...args: unknown[]) => (starts.push(args[5]), { chatId: 'c1' }),
    setDepartment: (chatId: string, dept: string) => void moves.push([chatId, dept]),
  } as unknown as WorkflowDeps['store']
  wireWorkflow(hub, {
    store,
    commandNames: () => [],
    commands: {},
    tiedRoom: () => undefined,
    accounts: () => [{ id: 'main', label: 'Main' }, { id: 'lab', label: 'Research' }] as never,
    linear: { ticket: async () => ({}) } as never,
    jev,
    rooms: { make: async () => ({ id: 'r1', name: 'Agent Office', about: 'x', subtitle: '', accent: 0, look: 'plain' }), resolve: (_cwd, _label, choice) => choice?.chosen ?? 'side' },
    gh: async () => '',
    confirm: async () => true,
  })
  const start = (options: object, accountId = 'main') => handlers.get('startChat')!(accountId, '/nowhere/agent-office', 'Do it', undefined, undefined, options)
  return { start, starts, moves, jev }
}

describe('starting a chat', () => {
  it('seats it where Jev says, over the desk or section that was picked', async () => {
    const office = wire('adm')
    await office.start({ dept: 'mob' })
    expect(office.starts).toEqual([{ dept: 'adm' }])
  })

  it('keeps the picked section when Jev has no answer, and skips Jev only for reviews', async () => {
    const office = wire(undefined)
    await office.start({ dept: 'mob' })
    expect(office.starts).toEqual([{ dept: 'mob' }])
    const skipped = wire('adm')
    await skipped.start({ review: true })
    expect(skipped.jev).not.toHaveBeenCalled()
    await skipped.start({}, 'lab')
    expect(skipped.starts.at(-1)).toEqual({ dept: 'adm' })
  })

  it('starts the chat right away and walks it into the new room once Claude has named it', async () => {
    const office = wire('new')
    await office.start({ dept: 'side' })
    expect(office.starts).toEqual([{ dept: 'side' }])
    await vi.waitFor(() => expect(office.moves).toEqual([['c1', 'r1']]))
  })
})
