import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { pinFolder, pinnedFolders } from '../../src/main/folders'

it('keeps each picked folder once, in the order it was picked', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'folders-')), 'config')
  expect(pinnedFolders(dir)).toEqual([])
  pinFolder('/code/agent-office', dir)
  pinFolder('/code/monorepo', dir)
  pinFolder('/code/agent-office', dir)
  expect(pinnedFolders(dir)).toEqual(['/code/agent-office', '/code/monorepo'])
  expect(readFileSync(join(dir, 'folders'), 'utf8')).toBe('/code/agent-office\n/code/monorepo\n')
})
