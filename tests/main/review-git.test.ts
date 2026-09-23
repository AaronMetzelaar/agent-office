import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gitStatus, parsePatch, unpushedCommits } from '../../src/main/review/git'
import { editorArgs, editorTarget, loadReview } from '../../src/main/review'

vi.mock('electron', () => import('../fakes/electron'))

let dir: string
let origin: string
let repo: string

const noPr = async () => {
  throw Object.assign(new Error('gh failed'), { stderr: 'no pull requests found for branch "feature"' })
}
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=office@test', '-c', 'user.name=office', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const write = (path: string, text: string) => writeFileSync(join(repo, path), text)

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-office-review-')))
  origin = join(dir, 'origin.git')
  repo = join(dir, 'repo')
  git(dir, 'init', '-q', '--bare', '-b', 'main', origin)
  git(dir, 'clone', '-q', origin, repo)
  write('a.ts', 'one\ntwo\nthree\n')
  write('b.ts', 'alpha\n')
  write('gone.ts', 'bye\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  git(repo, 'push', '-q', '-u', 'origin', 'main')
  git(repo, 'remote', 'set-head', 'origin', 'main')
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('review diff', () => {
  it('lists two modified files and one new file with stats and hunks, against the merge base with the default branch', async () => {
    git(repo, 'checkout', '-q', '-b', 'feature')
    write('a.ts', 'one\nTWO\nthree\nfour\n')
    git(repo, 'commit', '-q', '-am', 'edit a')
    git(repo, 'checkout', '-q', 'main')
    write('main-only.ts', 'x\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-q', '-m', 'main moves on')
    git(repo, 'push', '-q')
    git(repo, 'checkout', '-q', 'feature')
    write('b.ts', 'alpha\nbeta\n')
    write('c.ts', 'new\nfile\n')

    const review = await loadReview(repo, noPr)

    expect(review.base).toBe('origin/main')
    expect(review.files.map((file) => [file.path, file.status, file.added, file.removed])).toEqual([
      ['a.ts', 'modified', 2, 1],
      ['b.ts', 'modified', 1, 0],
      ['c.ts', 'added', 2, 0],
    ])
    const [a, b, c] = review.files
    expect(a!.hunks[0]!.lines).toEqual([
      { kind: 'ctx', text: 'one', oldNo: 1, newNo: 1 },
      { kind: 'del', text: 'two', oldNo: 2 },
      { kind: 'add', text: 'TWO', newNo: 2 },
      { kind: 'ctx', text: 'three', oldNo: 3, newNo: 3 },
      { kind: 'add', text: 'four', newNo: 4 },
    ])
    expect(b!.hunks[0]!.lines.at(-1)).toEqual({ kind: 'add', text: 'beta', newNo: 2 })
    expect(c!.hunks[0]!.lines).toEqual([
      { kind: 'add', text: 'new', newNo: 1 },
      { kind: 'add', text: 'file', newNo: 2 },
    ])
    expect(review).toMatchObject({ branch: 'feature', uncommitted: 2, unpushed: 1 })
    expect(review.upstream).toBeUndefined()
    expect(review.notice).toBeUndefined()
  })

  it('a clean worktree has no changes yet, and a branch without upstream is not pushed', async () => {
    const worktree = join(repo, '.claude/worktrees/tidy')
    git(repo, 'worktree', 'add', '-q', '-b', 'tidy', worktree)

    const review = await loadReview(worktree, noPr)

    expect(review.files).toEqual([])
    expect(review).toMatchObject({ branch: 'tidy', ahead: 0, behind: 0, uncommitted: 0, unpushed: 0 })
    expect(review.upstream).toBeUndefined()
    expect((await loadReview(repo, noPr)).files).toEqual([])
  })

  it('tracks upstream, ahead and behind, uncommitted and unpushed work', async () => {
    git(repo, 'checkout', '-q', '-b', 'feature')
    git(repo, 'push', '-q', '-u', 'origin', 'feature')
    expect(await gitStatus(repo)).toEqual({ branch: 'feature', upstream: 'origin/feature', ahead: 0, behind: 0, uncommitted: 0 })
    expect(await unpushedCommits(repo)).toBe(0)

    write('a.ts', 'changed\n')
    write('d.ts', 'untracked\n')
    git(repo, 'commit', '-q', '-am', 'local')
    expect(await gitStatus(repo)).toMatchObject({ ahead: 1, behind: 0, uncommitted: 1 })
    expect(await unpushedCommits(repo)).toBe(1)
    await expect(gitStatus(dir)).rejects.toThrow()
  })

  it('a folder outside git says so instead of failing', async () => {
    expect(await loadReview(dir, noPr)).toMatchObject({ notRepo: true, files: [] })
  })

  it('parses renames, deletions, binaries and quoted paths', async () => {
    git(repo, 'checkout', '-q', '-b', 'feature')
    git(repo, 'mv', 'b.ts', 'renamed.ts')
    git(repo, 'rm', '-q', 'gone.ts')
    writeFileSync(join(repo, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]))
    write('with space "q".ts', 'x\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-q', '-m', 'shuffle')

    const files = (await loadReview(repo, noPr)).files
    expect(files.map((file) => [file.path, file.status, file.binary, file.oldPath])).toEqual([
      ['gone.ts', 'deleted', false, undefined],
      ['logo.png', 'added', true, undefined],
      ['renamed.ts', 'renamed', false, 'b.ts'],
      ['with space "q".ts', 'added', false, undefined],
    ])
    expect(files[0]).toMatchObject({ removed: 1, added: 0 })
  })

  it('caps very long hunks but keeps the full stats', () => {
    const patch = ['diff --git a/big.txt b/big.txt', '--- a/big.txt', '+++ b/big.txt', '@@ -0,0 +1,2500 @@', ...Array.from({ length: 2500 }, (_, index) => `+line ${index}`)].join('\n')
    const [file] = parsePatch(patch)
    expect(file).toMatchObject({ added: 2500, truncated: true })
    expect(file!.hunks[0]!.lines).toHaveLength(2000)
  })
})

describe('open in editor', () => {
  it('opens files inside the repository only, at a line, with an argument array', async () => {
    expect(await editorTarget(repo, 'a.ts', 12)).toEqual({ file: join(repo, 'a.ts'), line: 12 })
    expect(await editorTarget(repo, 'a.ts', -1)).toEqual({ file: join(repo, 'a.ts') })
    expect(await editorTarget(repo, '../origin.git/config', 1)).toHaveProperty('error')
    expect(await editorTarget(repo, '/etc/passwd', 1)).toHaveProperty('error')
    expect(editorArgs('code', '/r/a.ts', 12)).toEqual(['--goto', '/r/a.ts:12'])
    expect(editorArgs('zed', '/r/a.ts')).toEqual(['/r/a.ts'])
  })
})
