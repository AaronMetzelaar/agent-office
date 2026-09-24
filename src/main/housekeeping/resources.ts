import { basename, sep } from 'node:path'
import type { Proc } from '../../shared/housekeeping'
import type { Run } from '../review/git'

export interface ProcessRow {
  pid: number
  ppid: number
  bytes: number
  args: string
}

export interface Worktree {
  path: string
  branch?: string
  locked: boolean
}

const stdoutOf = (error: unknown) => String((error as { stdout?: unknown }).stdout ?? '')

export function parsePs(out: string): ProcessRow[] {
  const rows: ProcessRow[] = []
  for (const line of out.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    if (match) rows.push({ pid: Number(match[1]), ppid: Number(match[2]), bytes: Number(match[3]) * 1024, args: match[4]!.trim() })
  }
  return rows
}

export const processTable = async (run: Run) => parsePs(await run('ps', ['-axo', 'pid=,ppid=,rss=,args='], '/'))

export function processTree(rows: readonly ProcessRow[], root: number): ProcessRow[] {
  const children = new Map<number, ProcessRow[]>()
  for (const row of rows) if (row.pid !== row.ppid) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row])
  const tree = rows.filter((row) => row.pid === root)
  for (let index = 0; index < tree.length; index++) tree.push(...(children.get(tree[index]!.pid) ?? []))
  return tree
}

export const commandLabel = (args: string) =>
  args
    .split(' ')
    .map((part) => (part.includes('/') ? basename(part) : part))
    .join(' ')
    .slice(0, 60)

export const toProc = (row: ProcessRow, command = commandLabel(row.args)): Proc => ({ pid: row.pid, command, bytes: row.bytes })

export const isClaude = (args: string) => /^(?:(?! -).)*?(?:^|\/)claude(?: |$)/.test(args)

export const inside = (path: string, folder: string) => path === folder || path.startsWith(folder + sep)

export async function workingDirs(run: Run, pids: readonly number[], known: Map<number, string>): Promise<Map<number, string>> {
  const missing = pids.filter((pid) => !known.has(pid))
  if (missing.length) {
    const out = await run('lsof', ['-a', '-d', 'cwd', '-Fn', '-p', missing.join(',')], '/').catch(stdoutOf)
    let pid = 0
    for (const line of out.split('\n')) {
      if (line.startsWith('p')) pid = Number(line.slice(1))
      else if (line.startsWith('n') && pid) known.set(pid, line.slice(1))
    }
    for (const pid of missing) if (!known.has(pid)) known.set(pid, '')
  }
  for (const pid of known.keys()) if (!pids.includes(pid)) known.delete(pid)
  return known
}

export function parseWorktrees(out: string): Worktree[] {
  return out
    .trim()
    .split(/\n\s*\n/)
    .slice(1)
    .flatMap((block) => {
      const lines = block.split('\n')
      const path = lines.find((line) => line.startsWith('worktree '))?.slice(9)
      if (!path || lines.some((line) => line === 'bare' || line.startsWith('prunable'))) return []
      const branch = lines.find((line) => line.startsWith('branch '))?.slice(7).replace(/^refs\/heads\//, '')
      return [{ path, ...(branch ? { branch } : {}), locked: lines.some((line) => line.startsWith('locked')) }]
    })
}

export const listWorktrees = async (run: Run, repo: string) => parseWorktrees(await run('git', ['worktree', 'list', '--porcelain'], repo))

export async function diskBytes(run: Run, path: string): Promise<number | undefined> {
  const kilobytes = Number((await run('du', ['-sk', path], path).catch(stdoutOf)).split('\t')[0])
  return Number.isFinite(kilobytes) && kilobytes > 0 ? kilobytes * 1024 : undefined
}
