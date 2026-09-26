import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import markdownLang from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import scss from 'highlight.js/lib/languages/scss'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
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

const shells = new Set(['', 'sh', 'bash', 'zsh', 'shell', 'console', 'terminal'])

const languages = { bash, csharp, css, diff, dockerfile, go, ini, java, javascript, json, kotlin, markdown: markdownLang, python, ruby, rust, scss, sql, swift, typescript, xml, yaml }
for (const [name, language] of Object.entries(languages)) hljs.registerLanguage(name, language)
hljs.registerAliases(['tsx', 'mts', 'cts'], { languageName: 'typescript' })
hljs.registerAliases(['jsx', 'mjs', 'cjs'], { languageName: 'javascript' })
hljs.registerAliases(['vue', 'svelte', 'svg', 'plist'], { languageName: 'xml' })
hljs.registerAliases(['jsonc', 'json5'], { languageName: 'json' })
hljs.registerAliases(['toml', 'env'], { languageName: 'ini' })
hljs.registerAliases(['sh', 'zsh', 'shell', 'console', 'terminal'], { languageName: 'bash' })

const names: Record<string, string> = { bash: 'Shell', csharp: 'C#', css: 'CSS', diff: 'Diff', dockerfile: 'Dockerfile', go: 'Go', ini: 'Config', java: 'Java', javascript: 'JavaScript', json: 'JSON', kotlin: 'Kotlin', markdown: 'Markdown', python: 'Python', ruby: 'Ruby', rust: 'Rust', scss: 'SCSS', sql: 'SQL', swift: 'Swift', typescript: 'TypeScript', xml: 'HTML', yaml: 'YAML', tsx: 'TSX', jsx: 'JSX', vue: 'Vue', svelte: 'Svelte', svg: 'SVG', toml: 'TOML', html: 'HTML' }
const autoLimit = 4000
const paintCache = new Map<string, { html: string; label: string }>()
const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' }
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => entities[char]!)

export function highlight(text: string, lang = ''): { html: string; label: string } {
  const tag = lang.trim().split(/\s+/)[0]!.toLowerCase()
  const key = `${tag}\0${text}`
  const cached = paintCache.get(key)
  if (cached) return cached
  const known = tag ? hljs.getLanguage(tag) : undefined
  const result = known ? hljs.highlight(text, { language: tag, ignoreIllegals: true }) : !tag && text.length <= autoLimit ? hljs.highlightAuto(text) : undefined
  const detected = result?.language && Object.keys(languages).find((name) => hljs.getLanguage(name) === hljs.getLanguage(result.language!))
  const used = !!result && (!!known || result.relevance >= 5)
  const out = { html: used ? result.value : escapeHtml(text), label: names[tag] ?? (used && detected ? names[detected] : undefined) ?? tag }
  if (paintCache.size > 400) paintCache.clear()
  paintCache.set(key, out)
  return out
}

export const runnable = (lang: string | undefined) => shells.has((lang ?? '').trim().toLowerCase())

export const commandOf = (text: string) => text.replace(/^\$ /gm, '')

const CodeBlock = defineComponent({
  props: { text: { type: String, required: true }, lang: { type: String, default: '' } },
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
    const painted = computed(() => highlight(props.text, props.lang))
    return () =>
      h('div', { class: 'code' }, [
        h('pre', h('code', { class: 'hljs', innerHTML: painted.value.html })),
        h('div', { class: 'cfoot' }, [
          h('span', { class: 'clang' }, painted.value.label),
          runnable(props.lang) ? h('button', { type: 'button', title: 'Run in a terminal next to the chat', 'data-run': commandOf(props.text) }, [h(Icon, { name: 'play' }), 'Run']) : null,
          h('button', { type: 'button', 'aria-live': 'polite', onClick: copy }, [h(Icon, { name: copied.value ? 'check' : 'copy' }), copied.value ? 'Copied' : 'Copy']),
        ]),
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
      return h(CodeBlock, { text: token.text, lang: token.lang })
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
