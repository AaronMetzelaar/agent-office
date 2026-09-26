import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import type { Hub } from '../../src/main/ipc'
import { commandInput, wireTerminal } from '../../src/main/terminal'
import type { ChatView } from '../../src/shared/chat'

const dir = mkdtempSync(join(tmpdir(), 'agent-office-terminal-'))
let close = () => {}
afterEach(() => close())

function hub() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const sent: { name: string; payload: { chatId: string; data?: string } }[] = []
  const fake = { handle: (name: string, command: (...args: unknown[]) => unknown) => handlers.set(name, command), send: (name: string, payload: never) => sent.push({ name, payload }) } as unknown as Hub
  return { fake, sent, call: (name: string, ...args: unknown[]) => handlers.get(name)!(...args) }
}

it('turns a multi-line block into lines the shell runs one by one', () => {
  expect(commandInput('cd a\nls')).toBe('cd a\rls\r')
})

it('opens a shell in the chat folder without running anything, and reuses it', async () => {
  const { fake, sent, call } = hub()
  close = wireTerminal(fake, { chat: (id) => (id === 'c2' ? ({ cwd: dir } as ChatView) : undefined) }).close
  expect(call('openShell', 'nope')).toEqual({ error: 'That chat isn’t open any more.' })
  expect(call('openShell', 'c2')).toHaveProperty('buffer')
  call('terminalInput', 'c2', 'echo "shell in $(basename $PWD)"\r')
  const output = () => sent.filter((event) => event.name === 'terminalData').map((event) => event.payload.data).join('')
  await expect.poll(output, { timeout: 10_000 }).toContain(`shell in ${dir.split('/').pop()}`)
  expect((call('openShell', 'c2') as { buffer: string }).buffer).toContain('shell in')
  call('closeTerminal', 'c2')
  await expect.poll(() => sent.some((event) => event.name === 'terminalExit'), { timeout: 5_000 }).toBe(true)
})

it('runs a code block in a real shell in the chat folder and streams its output', async () => {
  const { fake, sent, call } = hub()
  close = wireTerminal(fake, { chat: (id) => (id === 'c1' ? ({ cwd: dir } as ChatView) : undefined) }).close
  expect(call('runInTerminal', 'nope', 'ls')).toEqual({ error: 'That chat isn’t open any more.' })
  expect(call('runInTerminal', 'c1', '  ')).toEqual({ error: 'Nothing to run.' })
  expect(call('runInTerminal', 'c1', 'echo "ran in $(basename $PWD)"')).toHaveProperty('buffer')
  const output = () => sent.filter((event) => event.name === 'terminalData').map((event) => event.payload.data).join('')
  await expect.poll(output, { timeout: 10_000 }).toContain(`ran in ${dir.split('/').pop()}`)
  expect(call('terminalBuffer', 'c1')).toContain('ran in')
  call('closeTerminal', 'c1')
  await expect.poll(() => sent.some((event) => event.name === 'terminalExit'), { timeout: 5_000 }).toBe(true)
  rmSync(dir, { recursive: true, force: true })
})
