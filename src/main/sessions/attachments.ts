import { isAbsolute } from 'node:path'
import { imageTypes, maxImageBytes, type Attachment, type ImageType } from '../../shared/chat'

export type ImageBlock = { type: 'image'; source: { type: 'base64'; media_type: ImageType; data: string } }

const maxAttachments = 20
const base64 = /^[A-Za-z0-9+/]*={0,2}$/

function valid(item: unknown): item is Attachment {
  if (!item || typeof item !== 'object') return false
  const a = item as Record<string, unknown>
  if (typeof a.name !== 'string' || /[\n\r]/.test(a.name)) return false
  if (a.kind === 'file') return typeof a.path === 'string' && isAbsolute(a.path) && !/[\n\r]/.test(a.path)
  return a.kind === 'image' && imageTypes.includes(a.mediaType as ImageType) && typeof a.data === 'string' && a.data.length * 0.75 <= maxImageBytes && base64.test(a.data)
}

export function withAttachments(text: string, attachments: unknown): { text: string; images: ImageBlock[] } | undefined {
  if (attachments == null) return { text, images: [] }
  if (!Array.isArray(attachments) || attachments.length > maxAttachments || !attachments.every(valid)) return undefined
  const lines = attachments.map((a) => (a.kind === 'file' ? `- ${a.path}` : `- [image: ${a.name}]`))
  const images = attachments.flatMap((a): ImageBlock[] => (a.kind === 'image' ? [{ type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.data } }] : []))
  return { text: lines.length ? `${text}\n\nAttached:\n${lines.join('\n')}`.trim() : text, images }
}
