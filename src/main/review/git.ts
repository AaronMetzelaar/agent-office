import { execFile } from 'node:child_process'
import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { DiffFile, DiffLine, GitStatus, Hunk } from '../../shared/review'

export type Run = (command: string, args: string[], cwd: string) => Promise<string>

const exec = promisify(execFile)
const emptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const maxLines = 2000
const maxNewFileBytes = 1024 * 1024

export const run: Run = async (command, args, cwd) => (await exec(command, args, { cwd, encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024 * 1024 })).stdout

const git = (cwd: string, ...args: string[]) => run('git', ['--no-optional-locks', '-c', 'core.quotePath=false', ...args], cwd)
const tryGit = (cwd: string, ...args: string[]) => git(cwd, ...args).then((out) => out.trim() || undefined, () => undefined)

export const toplevel = (cwd: string) => tryGit(cwd, 'rev-parse', '--show-toplevel')

export async function gitStatus(cwd: string): Promise<GitStatus> {
  const status: GitStatus = { ahead: 0, behind: 0, uncommitted: 0 }
  for (const line of (await git(cwd, 'status', '--porcelain=v2', '--branch')).split('\n')) {
    if (line.startsWith('# branch.head ')) status.branch = line.slice(14) === '(detached)' ? undefined : line.slice(14)
    else if (line.startsWith('# branch.upstream ')) status.upstream = line.slice(18)
    else if (line.startsWith('# branch.ab ')) {
      const [ahead = 0, behind = 0] = line.slice(12).split(' ').map((part) => Math.abs(Number(part)))
      Object.assign(status, { ahead, behind })
    } else if (line && !line.startsWith('#')) status.uncommitted++
  }
  return status
}

export async function unpushedCommits(cwd: string): Promise<number> {
  return Number((await git(cwd, 'rev-list', '--count', 'HEAD', '--not', '--remotes')).trim())
}

export async function defaultBranch(cwd: string): Promise<string | undefined> {
  const head = await tryGit(cwd, 'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD')
  if (head) return head
  for (const ref of ['origin/main', 'origin/master', 'main', 'master']) if (await tryGit(cwd, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`)) return ref
  return undefined
}

async function diffBase(cwd: string, base: string | undefined): Promise<string> {
  const mergeBase = base ? await tryGit(cwd, 'merge-base', 'HEAD', base) : undefined
  return mergeBase ?? (await tryGit(cwd, 'rev-parse', '--verify', '--quiet', 'HEAD')) ?? emptyTree
}

const unquote = (text: string) => {
  if (!text.startsWith('"')) return text
  try {
    return JSON.parse(text) as string
  } catch {
    return text
  }
}

const headerPath = (rest: string) => unquote(rest.slice((rest.length + 1) / 2)).replace(/^b\//, '')

export function parsePatch(patch: string): DiffFile[] {
  const files: DiffFile[] = []
  let file: DiffFile | undefined
  let hunk: Hunk | undefined
  let oldNo = 0
  let newNo = 0
  let kept = 0
  const keep = (line: DiffLine) => {
    if (kept++ < maxLines) hunk!.lines.push(line)
    else file!.truncated = true
  }
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      file = { path: headerPath(line.slice(11)), status: 'modified', added: 0, removed: 0, binary: false, hunks: [] }
      files.push(file)
      hunk = undefined
      kept = 0
      continue
    }
    if (!file) continue
    const range = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (range) {
      hunk = { header: line, lines: [] }
      file.hunks.push(hunk)
      oldNo = Number(range[1])
      newNo = Number(range[2])
    } else if (!hunk) {
      if (line.startsWith('new file mode')) file.status = 'added'
      else if (line.startsWith('deleted file mode')) file.status = 'deleted'
      else if (line.startsWith('rename from ')) Object.assign(file, { status: 'renamed', oldPath: unquote(line.slice(12)) })
      else if (line.startsWith('rename to ')) file.path = unquote(line.slice(10))
      else if (line.startsWith('Binary files ')) file.binary = true
    } else if (line[0] === '+') {
      keep({ kind: 'add', text: line.slice(1), newNo: newNo++ })
      file.added++
    } else if (line[0] === '-') {
      keep({ kind: 'del', text: line.slice(1), oldNo: oldNo++ })
      file.removed++
    } else if (line[0] === ' ') keep({ kind: 'ctx', text: line.slice(1), oldNo: oldNo++, newNo: newNo++ })
  }
  return files
}

async function untrackedFile(root: string, path: string): Promise<DiffFile> {
  const file: DiffFile = { path, status: 'added', added: 0, removed: 0, binary: false, hunks: [] }
  const info = await lstat(join(root, path)).catch(() => undefined)
  if (!info?.isFile()) return file
  if (info.size > maxNewFileBytes) return { ...file, truncated: true }
  const text = await readFile(join(root, path), 'utf8')
  if (!text) return file
  if (text.includes('\0')) return { ...file, binary: true }
  const lines = text.split('\n')
  if (text.endsWith('\n')) lines.pop()
  const kept = lines.slice(0, maxLines).map((text, index): DiffLine => ({ kind: 'add', text, newNo: index + 1 }))
  return { ...file, added: lines.length, hunks: [{ header: `@@ -0,0 +1,${lines.length} @@`, lines: kept }], ...(lines.length > maxLines ? { truncated: true } : {}) }
}

export async function changedFiles(root: string, base: string | undefined): Promise<DiffFile[]> {
  const from = await diffBase(root, base)
  const [patch, others] = await Promise.all([git(root, 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '-M', from, '--'), git(root, 'ls-files', '--others', '--exclude-standard', '-z')])
  const untracked = await Promise.all(others.split('\0').filter((path) => path && !path.endsWith('/')).map((path) => untrackedFile(root, path)))
  return [...parsePatch(patch), ...untracked].sort((a, b) => a.path.localeCompare(b.path))
}
