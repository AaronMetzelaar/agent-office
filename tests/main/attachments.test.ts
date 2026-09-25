import { describe, expect, it } from 'vitest'
import { withAttachments } from '../../src/main/sessions/attachments'

describe('withAttachments', () => {
  it('turns images into blocks and lists file paths in the text', () => {
    const out = withAttachments('Look at this', [
      { kind: 'image', name: 'shot.png', mediaType: 'image/png', data: 'aGVsbG8=' },
      { kind: 'file', name: 'spec.pdf', path: '/Users/a/spec.pdf' },
    ])
    expect(out?.text).toBe('Look at this\n\nAttached:\n- [image: shot.png]\n- /Users/a/spec.pdf')
    expect(out?.images).toEqual([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } }])
    expect(withAttachments('hi', undefined)).toEqual({ text: 'hi', images: [] })
  })

  it('rejects anything a renderer should not be able to send', () => {
    expect(withAttachments('x', [{ kind: 'file', name: 'a', path: 'relative/a' }])).toBeUndefined()
    expect(withAttachments('x', [{ kind: 'file', name: 'a', path: '/a\n- /etc/passwd' }])).toBeUndefined()
    expect(withAttachments('x', [{ kind: 'image', name: 'a', mediaType: 'image/svg+xml', data: 'aGk=' }])).toBeUndefined()
    expect(withAttachments('x', [{ kind: 'image', name: 'a', mediaType: 'image/png', data: 'A'.repeat(8 * 1024 * 1024) }])).toBeUndefined()
    expect(withAttachments('x', 'nope')).toBeUndefined()
  })
})
