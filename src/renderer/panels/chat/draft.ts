import { imageTypes, maxImageBytes, type Attachment, type ImageType } from '../../../shared/chat'
import type { OfficeApi } from '../../../shared/ipc'
import type { PendingRequestView } from '../../../shared/permissions'

type DraftApi = Pick<OfficeApi, 'getDraft' | 'saveDraft'>
type SendApi = Pick<OfficeApi, 'sendMessage' | 'resolveRequest'>

export function createDrafts(api: DraftApi, delayMs = 400) {
  const cache = new Map<string, string>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  const write = (chatId: string) => {
    clearTimeout(timers.get(chatId))
    timers.delete(chatId)
    return api.saveDraft(chatId, cache.get(chatId) ?? '')
  }

  return {
    async load(chatId: string): Promise<string> {
      const cached = cache.get(chatId)
      if (cached !== undefined) return cached
      const saved = await api.getDraft(chatId)
      if (!cache.has(chatId)) cache.set(chatId, saved)
      return cache.get(chatId)!
    },
    set(chatId: string, text: string) {
      cache.set(chatId, text)
      clearTimeout(timers.get(chatId))
      timers.set(chatId, setTimeout(() => void write(chatId), delayMs))
    },
    async flush(chatId?: string) {
      await Promise.all((chatId ? [chatId] : [...timers.keys()]).filter((id) => timers.has(id)).map(write))
    },
  }
}

export type Drafts = ReturnType<typeof createDrafts>

let shared: Drafts | undefined
export const drafts = () => (shared ??= createDrafts(window.office))

export type SendOutcome = { sent: true } | { sent: false; error: string; needsLogin: boolean }

export async function submit(api: SendApi, chatId: string, text: string, waiting?: Pick<PendingRequestView, 'id'>, attachments?: Attachment[]): Promise<SendOutcome> {
  if (waiting) {
    const result = await api.resolveRequest(waiting.id, { kind: 'deny', message: text }, 'chat')
    return 'error' in result ? { sent: false, error: result.error, needsLogin: false } : { sent: true }
  }
  const refused = await api.sendMessage(chatId, text, attachments?.length ? attachments : undefined)
  return refused ? { sent: false, error: refused.error, needsLogin: refused.code === 'needs-login' } : { sent: true }
}

const isImage = (type: string): type is ImageType => (imageTypes as readonly string[]).includes(type)

export async function toAttachment(file: File, pathFor: (file: File) => string): Promise<Attachment | string> {
  const path = pathFor(file)
  if (!isImage(file.type)) return path ? { kind: 'file', name: file.name, path } : `Couldn’t attach ${file.name}: drop it from Finder instead`
  if (file.size > maxImageBytes) return `${file.name} is over 5 MB`
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return { kind: 'image', name: file.name || 'pasted image', mediaType: file.type, data: btoa(binary) }
}
