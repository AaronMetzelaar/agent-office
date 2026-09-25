import { Lexer, type Token, type Tokens } from 'marked'
import { computed, defineComponent, h, onUnmounted, ref, type VNodeArrayChildren, type VNodeChild } from 'vue'
import { Icon } from '../../icons'

export function webUrl(href: string): string | undefined {
  const url = URL.parse(href)
  return url && (url.protocol === 'https:' || url.protocol === 'http:') ? url.href : undefined
}

const segment = String.raw`[\w@+-][\w.@+-]*`
const fileName = String.raw`[\w@+-][\w.@+-]*\.[A-Za-z0-9]{1,10}(?::\d+){0,2}`
const inPath = new RegExp(String.raw`^(?:~/|\.{1,2}/|/)?(?:${segment}/)*${fileName}$`)
const bareAbsolute = new RegExp(String.raw`(?<![\w/.~])(?:~/|/)(?:${segment}/)*${fileName}`, 'g')
const imageName = /\.(?:png|jpe?g|gif|webp|svg)$/i
const withoutLine = (path: string) => path.replace(/(?::\d+){1,2}$/, '')

export function localFile(text: string): string | undefined {
  const path = text.trim()
  return inPath.test(path) && (path.includes('/') || imageName.test(withoutLine(path))) ? withoutLine(path) : undefined
}

export const fileButton = (path: string, children: VNodeChild) => h('button', { type: 'button', class: 'fp', 'data-file': path, title: `Show ${path}` }, [children])

function withFiles(text: string): VNodeChild {
  const parts: VNodeChild[] = []
  let last = 0
  for (const match of text.matchAll(bareAbsolute)) {
    parts.push(text.slice(last, match.index), fileButton(withoutLine(match[0]), match[0]))
    last = match.index + match[0].length
  }
  return parts.length ? [...parts, text.slice(last)] : text
}

const CodeBlock = defineComponent({
  props: { text: { type: String, required: true } },
  setup(props) {
    const copied = ref(false)
    let timer: ReturnType<typeof setTimeout> | undefined
    async function copy() {
      await navigator.clipboard.writeText(props.text)
      copied.value = true
      clearTimeout(timer)
      timer = setTimeout(() => (copied.value = false), 1500)
    }
    onUnmounted(() => clearTimeout(timer))
    return () =>
      h('div', { class: 'code' }, [
        h('pre', h('code', props.text)),
        h('button', { type: 'button', class: 'copy', 'aria-label': copied.value ? 'Copied' : 'Copy code', title: copied.value ? 'Copied' : 'Copy', onClick: copy }, h(Icon, { name: copied.value ? 'check' : 'copy' })),
      ])
  },
})

const link = (href: string, children: string | VNodeArrayChildren) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, children)
const aligned = (align: Tokens.TableCell['align']) => (align ? { style: { textAlign: align } } : {})

function inline(tokens: Token[] = []): VNodeChild[] {
  return tokens.map((token): VNodeChild => {
    switch (token.type) {
      case 'strong':
        return h('strong', inline(token.tokens))
      case 'em':
        return h('em', inline(token.tokens))
      case 'del':
        return h('del', inline(token.tokens))
      case 'codespan': {
        const file = localFile(token.text)
        return file ? fileButton(file, h('code', token.text)) : h('code', token.text)
      }
      case 'br':
        return h('br')
      case 'link': {
        const href = webUrl(token.href)
        const file = href ? undefined : localFile(token.href)
        return href ? link(href, inline(token.tokens)) : file ? fileButton(file, inline(token.tokens)) : inline(token.tokens)
      }
      case 'image': {
        const href = webUrl(token.href)
        const file = href ? undefined : localFile(token.href)
        return href ? link(href, `Image: ${token.text || href}`) : file ? fileButton(file, `Image: ${token.text || file}`) : token.text
      }
      case 'text':
        return token.tokens ? inline(token.tokens) : withFiles(token.text)
      default:
        return token.raw
    }
  })
}

function item(entry: Tokens.ListItem): VNodeChild {
  return h(
    'li',
    entry.tokens.map((token) => (token.type === 'checkbox' ? h('input', { type: 'checkbox', checked: !!token.checked, disabled: true }) : token.type === 'text' ? inline(token.tokens ?? [token]) : block(token))),
  )
}

function block(token: Token): VNodeChild {
  switch (token.type) {
    case 'space':
    case 'def':
      return null
    case 'paragraph':
    case 'text':
      return h('p', inline(token.tokens ?? [{ type: 'text', raw: token.raw, text: token.text }]))
    case 'heading':
      return h(`h${Math.min(6, Math.max(1, token.depth))}`, inline(token.tokens))
    case 'code':
      return h(CodeBlock, { text: token.text })
    case 'blockquote':
      return h('blockquote', token.tokens?.map(block))
    case 'list':
      return h(token.ordered ? 'ol' : 'ul', token.ordered && typeof token.start === 'number' && token.start !== 1 ? { start: token.start } : {}, (token.items as Tokens.ListItem[]).map(item))
    case 'table': {
      const table = token as Tokens.Table
      return h('div', { class: 'tbl' }, [
        h('table', [
          h('thead', h('tr', table.header.map((cell) => h('th', aligned(cell.align), inline(cell.tokens))))),
          h('tbody', table.rows.map((row) => h('tr', row.map((cell) => h('td', aligned(cell.align), inline(cell.tokens)))))),
        ]),
      ])
    }
    case 'hr':
      return h('hr')
    default:
      return h('p', token.raw)
  }
}

export function markdown(source: string): VNodeChild[] {
  return Lexer.lex(source, { gfm: true }).map(block)
}

export const Markdown = defineComponent({
  props: { source: { type: String, required: true } },
  setup(props) {
    const nodes = computed(() => markdown(props.source))
    return () => h('div', { class: 'md' }, nodes.value)
  },
})
