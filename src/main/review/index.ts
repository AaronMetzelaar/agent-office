import { spawn } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, resolve, sep } from 'node:path'
import type { Editor, FilePreview, Review } from '../../shared/review'
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

const imageTypes: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' }
const maxPreviewBytes = 20 * 1024 * 1024
const maxTextChars = 200_000

export async function previewFile(cwd: string, path: unknown): Promise<FilePreview> {
  if (typeof path !== 'string' || !path) return { path: '', error: 'There’s no file to show.' }
  const file = resolve(cwd, path.replace(/^~(?=\/)/, homedir()))
  const info = await stat(file).catch(() => undefined)
  if (!info?.isFile()) return { path: file, error: 'That file isn’t there anymore.' }
  if (info.size > maxPreviewBytes) return { path: file, error: 'That file is too big to show here.' }
  const data = await readFile(file)
  const type = imageTypes[extname(file).toLowerCase()]
  if (type) return { path: file, image: `data:${type};base64,${data.toString('base64')}` }
  if (data.includes(0)) return { path: file, error: 'This file isn’t text or an image, so it can’t be shown here.' }
  const text = data.toString('utf8')
  return { path: file, text: text.length > maxTextChars ? `${text.slice(0, maxTextChars)}\n…` : text }
}

export function wireReview(hub: Hub, store: Pick<ChatStore, 'view'>, editor: () => Editor): void {
  const cwdOf = (chatId: unknown) => {
    const cwd = typeof chatId === 'string' ? store.view(chatId)?.cwd : undefined
    if (!cwd) throw new Error('There’s no chat with that id')
    return cwd
  }
  hub.handle('getReview', (chatId) => loadReview(cwdOf(chatId)))
  hub.handle('getCiLog', async (chatId, checkId) => ciLog(cwdOf(chatId), String(checkId)))
  hub.handle('previewFile', (chatId, path) => previewFile(cwdOf(chatId), path))
  hub.handle('openInEditor', async (chatId, path, line) => {
    const target = await editorTarget(cwdOf(chatId), path, line)
    if ('error' in target) return target
    const error = await launch(editor(), editorArgs(editor(), target.file, target.line))
    return error ? { error } : undefined
  })
}
