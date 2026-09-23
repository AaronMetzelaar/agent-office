import { Lexer, type Token, type Tokens } from 'marked'
import { computed, defineComponent, h, type VNodeArrayChildren, type VNodeChild } from 'vue'

export function webUrl(href: string): string | undefined {
  const url = URL.parse(href)
  return url && (url.protocol === 'https:' || url.protocol === 'http:') ? url.href : undefined
}

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
      case 'codespan':
        return h('code', token.text)
      case 'br':
        return h('br')
      case 'link': {
        const href = webUrl(token.href)
        return href ? link(href, inline(token.tokens)) : inline(token.tokens)
      }
      case 'image': {
        const href = webUrl(token.href)
        return href ? link(href, `Image: ${token.text || href}`) : token.text
      }
      case 'text':
        return token.tokens ? inline(token.tokens) : token.text
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
      return h('pre', h('code', token.text))
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
