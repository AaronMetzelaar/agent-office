import { describe, expect, it } from 'vitest'
import { finishedPage, pageFinished, type FinishedRow } from '../../src/renderer/state/inbox'

const rows: FinishedRow[] = Array.from({ length: 45 }, (_, i) => ({ id: `c${i}`, title: i % 3 ? `Fix bid flow ${i}` : `Sentry prep ${i}`, colour: '#000', dept: i % 2 ? 'Marketplace' : 'Research', accent: '#000', at: 45 - i, visitor: false }))

describe('finished group', () => {
  it('shows one page at a time in the order given, and says how many are left', () => {
    expect(pageFinished(rows, '', finishedPage)).toMatchObject({ left: 25 })
    expect(pageFinished(rows, '', finishedPage).rows.map((row) => row.id)).toEqual(rows.slice(0, 20).map((row) => row.id))
    expect(pageFinished(rows, '', 3 * finishedPage)).toMatchObject({ left: 0 })
  })

  it('filters by name or department as you type, ignoring case and spaces', () => {
    const sentry = pageFinished(rows, '  SENTRY ', finishedPage)
    expect(sentry.rows).toHaveLength(15)
    expect(sentry.rows.every((row) => row.title.startsWith('Sentry'))).toBe(true)
    expect(sentry.left).toBe(0)
    expect(pageFinished(rows, 'research', 100).rows).toHaveLength(23)
    expect(pageFinished(rows, 'nothing like this', finishedPage)).toEqual({ rows: [], left: 0 })
  })
})
