<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { isBusy, maxRows, type ChatRow, type ChatView, type RewindPreview } from '../../../shared/chat'
import { items } from './groups'
import { Markdown } from './markdown'
import { plainLabel, subagentState } from './rows'
import ArtifactCard from './ArtifactCard.vue'
import Subagent from './Subagent.vue'
import ToolGroup from './ToolGroup.vue'

const props = defineProps<{ chat: ChatView; canSwitch?: boolean }>()
const emit = defineEmits<{ resume: []; relogin: []; continue: [] }>()

const scroller = ref<HTMLElement>()
const older = ref<ChatRow[]>([])
const more = ref<boolean>()
const loading = ref(false)
const rewind = ref<{ id: string; preview?: RewindPreview; busy?: boolean }>()
const canRewind = computed(() => !props.chat.visitor && !!props.chat.sessionId && !isBusy(props.chat.state))
let pinned = true

const list = computed(() => items([...older.value, ...props.chat.rows]))
const live = computed(() => {
  const last = list.value.at(-1)
  return last?.kind === 'group' && props.chat.state === 'working' && !props.chat.partial ? last : undefined
})
const running = computed(() => new Set(props.chat.subagents.map((agent) => agent.id)))
const canLoad = computed(() => !!props.chat.sessionId && (more.value ?? (!!props.chat.earlier || props.chat.rows.length >= maxRows)))
const stuck = computed(() => (props.chat.state === 'stuck' ? (props.chat.stuck ?? { reason: 'crashed' as const }) : undefined))
const stuckText = computed(() => {
  const value = stuck.value
  if (!value) return ''
  switch (value.reason) {
    case 'needs-login':
      return 'This account needs a new login. Log in again, then resume.'
    case 'rate-limited':
      return value.retryAt ? `Rate limited until ${new Date(value.retryAt).toTimeString().slice(0, 5)}.` : 'Rate limited.'
    case 'interrupted':
      return 'Interrupted. Nothing runs until you resume.'
    default:
      return value.detail ?? 'The Claude process stopped.'
  }
})

async function stick() {
  await nextTick()
  const el = scroller.value
  if (el) el.scrollTop = el.scrollHeight
}

function onScroll() {
  const el = scroller.value
  if (el) pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 48
}

async function previewRewind(messageId: string) {
  rewind.value = { id: messageId, busy: true }
  const preview = await window.office.rewindFiles(props.chat.id, messageId, true)
  if (rewind.value?.id === messageId) rewind.value = { id: messageId, preview }
}

async function confirmRewind(messageId: string) {
  rewind.value = { id: messageId, busy: true }
  const result = await window.office.rewindFiles(props.chat.id, messageId, false)
  rewind.value = result.canRewind ? undefined : { id: messageId, preview: result }
}

const previewText = ({ canRewind, error, files = 0, insertions = 0, deletions = 0 }: RewindPreview) => {
  if (!canRewind) return error ?? 'Can’t undo the file changes from here.'
  if (!files) return 'No file changes since this message.'
  return `Restore ${files} file${files === 1 ? '' : 's'} to how they were before this message (+${insertions} −${deletions})?`
}

async function loadOlder() {
  const chatId = props.chat.id
  loading.value = true
  const page = await window.office.olderRows(chatId, older.value[0]?.id).finally(() => (loading.value = false))
  if (props.chat.id !== chatId) return
  const el = scroller.value
  const from = el ? el.scrollHeight - el.scrollTop : 0
  const known = new Set([...older.value, ...props.chat.rows].map((row) => row.id))
  older.value = [...page.rows.filter((row) => !known.has(row.id)), ...older.value]
  more.value = page.more
  await nextTick()
  if (el) el.scrollTop = el.scrollHeight - from
}

watch(
  () => props.chat.id,
  () => {
    older.value = []
    more.value = undefined
    rewind.value = undefined
    pinned = true
    void stick()
  },
  { immediate: true },
)
watch(
  () => props.chat.rows,
  (rows, previous) => {
    if (!older.value.length) return
    const kept = previous.findIndex((row) => row.id === rows[0]?.id)
    if (kept > 0) older.value = [...older.value, ...previous.slice(0, kept)]
    else if (kept === -1) {
      older.value = []
      more.value = undefined
    }
  },
)
watch(
  () => [props.chat.rows, props.chat.partial],
  () => {
    if (pinned) void stick()
  },
)
</script>

<template>
  <div ref="scroller" class="ts" role="log" aria-label="Transcript" @scroll="onScroll">
    <button v-if="canLoad" type="button" class="btn sm older" :disabled="loading" @click="loadOlder">{{ loading ? 'Loading…' : 'Load earlier messages' }}</button>
    <template v-for="item in list" :key="item.kind === 'group' ? `g:${item.id}` : item.row.id">
      <ToolGroup v-if="item.kind === 'group'" :rows="item.rows" :summary="item.summary" :live="item === live" />
      <ArtifactCard v-else-if="item.kind === 'artifact'" :artifact="item.artifact" />
      <Subagent v-else-if="item.kind === 'agent'" :item="item" :state="subagentState(item.row, running)" />
      <div v-else-if="item.row.kind === 'user'" class="uw">
        <div class="ur">{{ item.row.text }}</div>
        <div v-if="rewind?.id === item.row.id" class="rw" role="status">
          <template v-if="rewind.busy">Checking…</template>
          <template v-else-if="rewind.preview">
            <span>{{ previewText(rewind.preview) }}</span>
            <button v-if="rewind.preview.canRewind && rewind.preview.files" type="button" class="btn sm danger" @click="confirmRewind(item.row.id)">Restore</button>
            <button type="button" class="btn sm" @click="rewind = undefined">{{ rewind.preview.canRewind && rewind.preview.files ? 'Cancel' : 'OK' }}</button>
          </template>
        </div>
        <button v-else-if="canRewind" type="button" class="rwb" title="Put the files back to how they were before this message. The conversation stays." @click="previewRewind(item.row.id)">Undo file changes from here</button>
      </div>
      <Markdown v-else-if="item.row.kind === 'text'" class="ar" :source="item.row.text" />
      <p v-else class="or">{{ plainLabel(item.row) }}</p>
    </template>
    <Markdown v-if="chat.partial" class="ar live" :source="chat.partial" />
    <div v-if="stuck" class="stuckbox" role="alert">
      <span>{{ stuckText }}</span>
      <span class="btns">
        <button v-if="stuck.reason === 'needs-login'" type="button" class="btn sm" @click="emit('relogin')">Re-login</button>
        <button type="button" class="btn sm" @click="emit('resume')">{{ stuck.reason === 'interrupted' || stuck.reason === 'needs-login' ? 'Resume' : 'Retry' }}</button>
        <button v-if="canSwitch && stuck.reason === 'rate-limited' && chat.sessionId" type="button" class="btn sm" title="Continue in a new chat on the other account; this one is parked" @click="emit('continue')">Other account</button>
      </span>
    </div>
    <p v-if="!list.length && !chat.partial && !stuck" class="none">No messages yet.</p>
  </div>
</template>

<style>
.inbox .ts {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 18px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  scrollbar-width: thin;
}

.fp {
  all: unset;
  cursor: pointer;
  color: var(--accent);
  text-decoration: underline dotted;
  text-underline-offset: 2px;
}

.fp:hover {
  text-decoration-style: solid;
}

.fp:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
  border-radius: 3px;
}

.ts .older {
  align-self: center;
}

.ts .uw {
  align-self: flex-end;
  max-width: 85%;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.ts .rwb {
  all: unset;
  cursor: pointer;
  font-size: 11.5px;
  color: var(--faint);
  opacity: 0;
}

.ts .uw:hover .rwb,
.ts .rwb:focus-visible {
  opacity: 1;
}

.ts .rwb:hover {
  color: var(--ink2);
}

.ts .rw {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  justify-content: flex-end;
  font-size: 12.5px;
  color: var(--ink2);
}

.ts .ur {
  background: var(--accent-soft);
  color: var(--ink);
  border-radius: 12px 12px 4px 12px;
  padding: 8px 12px;
  font-size: 14px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.md {
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--ink2);
  overflow-wrap: anywhere;
}

.ts .ar {
  font-size: 14.5px;
  line-height: 1.6;
  color: var(--ink);
  max-width: 68ch;
}

.md > :first-child {
  margin-top: 0;
}

.md > :last-child {
  margin-bottom: 0;
}

.md p,
.md ul,
.md ol,
.md blockquote,
.md .code,
.md .tbl {
  margin: 0 0 0.7em;
}

.md ul,
.md ol {
  padding-left: 1.3em;
}

.md li + li {
  margin-top: 0.25em;
}

.md li > p {
  margin: 0;
}

.md h1,
.md h2,
.md h3,
.md h4,
.md h5,
.md h6 {
  font-size: 1em;
  font-weight: 600;
  line-height: 1.4;
  color: var(--ink);
  margin: 1.1em 0 0.4em;
  display: block;
}

.md h1,
.md h2 {
  font-size: 1.07em;
}

.md strong {
  font-weight: 600;
  color: var(--ink);
}

.md code {
  font: 0.84em var(--mono);
  color: var(--accent);
  background: var(--accent-soft);
  border: 0;
  border-radius: 5px;
  padding: 0.1em 0.4em;
}

.md pre {
  font: 12.5px/1.6 var(--mono);
  color: var(--ink2);
  background: var(--soft);
  border-radius: 12px;
  padding: 10px 14px;
  overflow: auto;
  white-space: pre;
  scrollbar-width: thin;
}

.md .code {
  background: #f3f5f9;
  border-radius: 14px;
  overflow: hidden;
}

.md .code pre {
  margin: 0;
  background: none;
  border-radius: 0;
  padding: 12px 14px 10px;
}

.md .cfoot {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 6px 4px 14px;
  box-shadow: inset 0 1px 0 rgba(17, 24, 39, 0.06);
}

.md .clang {
  margin-right: auto;
  font: 11px var(--mono);
  color: #5f6672;
}

.md .cfoot button {
  all: unset;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  font: 500 12px Geist, system-ui, sans-serif;
  color: var(--ink2);
  cursor: pointer;
  transition: background-color 0.15s, scale 0.12s cubic-bezier(0.2, 0, 0, 1);
}

.md .cfoot button:hover {
  background: rgba(17, 24, 39, 0.06);
  color: var(--ink);
}

.md .cfoot button:active {
  scale: 0.96;
}

.md .cfoot button:focus-visible {
  outline: 2px solid var(--accent);
}

.hljs-comment,
.hljs-quote {
  color: #5f6672;
  font-style: italic;
}

.hljs-keyword,
.hljs-selector-tag,
.hljs-doctag,
.hljs-meta .hljs-keyword {
  color: #8430ce;
}

.hljs-string,
.hljs-regexp,
.hljs-template-tag,
.hljs-meta .hljs-string {
  color: #137333;
}

.hljs-number,
.hljs-literal,
.hljs-symbol,
.hljs-bullet {
  color: #b3261e;
}

.hljs-title,
.hljs-title.function_,
.hljs-section,
.hljs-name {
  color: #1a5fd6;
}

.hljs-type,
.hljs-title.class_,
.hljs-built_in,
.hljs-selector-class {
  color: #9a4d00;
}

.hljs-attr,
.hljs-attribute,
.hljs-property,
.hljs-variable,
.hljs-template-variable,
.hljs-selector-id,
.hljs-params {
  color: #0b6e79;
}

.hljs-meta,
.hljs-tag {
  color: #5b6472;
}

.hljs-addition {
  color: #146c2e;
  background: #e6f4ea;
}

.hljs-deletion {
  color: #a50e0e;
  background: #fce8e6;
}

.hljs-emphasis {
  font-style: italic;
}

.hljs-strong {
  font-weight: 600;
}

@media (prefers-reduced-motion: reduce) {
  .md .cfoot button {
    transition: none;
  }

  .md .cfoot button:active {
    scale: none;
  }
}

.md pre code {
  font: inherit;
  color: inherit;
  padding: 0;
  background: none;
}

.md blockquote {
  border-left: 2px solid var(--line);
  padding-left: 10px;
  color: var(--muted);
}

.md a {
  color: var(--accent);
}

.md .tbl {
  overflow: auto;
}

.md table {
  border-collapse: collapse;
  font-size: 0.9em;
}

.md th,
.md td {
  border-bottom: 1px solid var(--line2);
  padding: 4px 10px 4px 0;
  text-align: left;
}

.md th {
  font-weight: 600;
  border-bottom-color: var(--line);
}

.md hr {
  border: 0;
  border-top: 1px solid var(--line2);
  margin: 1em 0;
}

.ts .live::after {
  content: '▍';
  color: var(--accent);
  margin-left: 2px;
}

.ts .or {
  margin: 0;
  font-size: 12px;
  color: var(--faint);
}
</style>
