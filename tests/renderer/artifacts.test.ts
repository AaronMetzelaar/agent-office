import { describe, expect, it } from 'vitest'
import type { ChatRow } from '../../src/shared/chat'
import { hasNewArtifact, sawArtifacts } from '../../src/renderer/state/artifacts'

const publish = (id: string, url: string): ChatRow => ({ kind: 'tool', id, name: 'Artifact', input: { file_path: '/tmp/report.html' }, result: { text: `Published /tmp/report.html at ${url}`, isError: false } })

describe('new artifact folder', () => {
  it('holds the folder up until the newest artifact is seen, and again after an update', () => {
    const chat = { id: 'c1', rows: [] as ChatRow[] }
    expect(hasNewArtifact(chat)).toBe(false)
    chat.rows = [publish('t1', 'https://claude.ai/artifact/a')]
    expect(hasNewArtifact(chat)).toBe(true)
    expect(sawArtifacts(chat)).toBe(true)
    expect(hasNewArtifact(chat)).toBe(false)
    expect(sawArtifacts(chat)).toBe(false)
    chat.rows = [...chat.rows, publish('t2', 'https://claude.ai/artifact/a')]
    expect(hasNewArtifact(chat)).toBe(true)
  })
})
