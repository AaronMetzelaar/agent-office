import { spawn } from 'node:child_process'
import { resolve, sep } from 'node:path'
import type { Editor, Review } from '../../shared/review'
import type { Hub } from '../ipc'
import type { ChatStore } from '../store/chats'
import { changedFiles, defaultBranch, gitStatus, run, toplevel, unpushedCommits, type Run } from './git'
import { ciLog, pullRequest } from './github'

export async function loadReview(cwd: string, gh: Run = run): Promise<Review> {
  const root = await toplevel(cwd)
  if (!root) return { notRepo: true, ahead: 0, behind: 0, uncommitted: 0, files: [] }
  const local = async () => {
    const [status, base] = await Promise.all([gitStatus(root), defaultBranch(root)])
    const [files, unpushed] = await Promise.all([changedFiles(root, base), status.upstream ? undefined : unpushedCommits(root).catch(() => undefined)])
    return { ...status, base, files, ...(unpushed !== undefined ? { unpushed } : {}) }
  }
  const [git, github] = await Promise.all([local(), pullRequest(root, gh)])
  return { ...git, ...(git.branch ? github : {}) }
}

export function editorArgs(editor: Editor, file: string, line?: number): string[] {
  const target = line ? `${file}:${line}` : file
  return editor === 'zed' || editor === 'subl' ? [target] : ['--goto', target]
}

export function launch(command: string, args: string[]): Promise<string | undefined> {
  return new Promise((done) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.once('error', (error) => done(`Couldn’t open ${command}: ${error.message}`))
    child.once('spawn', () => {
      child.unref()
      done(undefined)
    })
  })
}

export async function editorTarget(cwd: string, path: unknown, line: unknown): Promise<{ file: string; line?: number } | { error: string }> {
  const root = await toplevel(cwd)
  if (!root || typeof path !== 'string' || !path) return { error: 'That file isn’t in this chat’s repository.' }
  const file = resolve(root, path)
  if (!file.startsWith(root + sep)) return { error: 'That file isn’t in this chat’s repository.' }
  return { file, ...(Number.isInteger(line) && (line as number) > 0 ? { line: line as number } : {}) }
}

export function wireReview(hub: Hub, store: Pick<ChatStore, 'view'>, editor: () => Editor): void {
  const cwdOf = (chatId: unknown) => {
    const cwd = typeof chatId === 'string' ? store.view(chatId)?.cwd : undefined
    if (!cwd) throw new Error('There’s no chat with that id')
    return cwd
  }
  hub.handle('getReview', (chatId) => loadReview(cwdOf(chatId)))
  hub.handle('getCiLog', async (chatId, checkId) => ciLog(cwdOf(chatId), String(checkId)))
  hub.handle('openInEditor', async (chatId, path, line) => {
    const target = await editorTarget(cwdOf(chatId), path, line)
    if ('error' in target) return target
    const error = await launch(editor(), editorArgs(editor(), target.file, target.line))
    return error ? { error } : undefined
  })
}
