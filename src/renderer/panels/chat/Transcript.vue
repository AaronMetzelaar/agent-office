<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { maxRows, type ChatRow, type ChatView } from '../../../shared/chat'
import { Markdown } from './markdown'
import { diffStats, entries, isSubagent, plainLabel, resultSummary, subagentLine, subagentState, toolDetail, toolTarget } from './rows'

const props = defineProps<{ chat: ChatView }>()
const emit = defineEmits<{ resume: []; relogin: [] }>()

const scroller = ref<HTMLElement>()
const older = ref<ChatRow[]>([])
const more = ref<boolean>()
const loading = ref(false)
let pinned = true

const list = computed(() => entries([...older.value, ...props.chat.rows]))
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
const subagentLabels = { running: 'Working', done: 'Done', failed: 'Failed' }

async function stick() {
  await nextTick()
  const el = scroller.value
  if (el) el.scrollTop = el.scrollHeight
}

function onScroll() {
  const el = scroller.value
  if (el) pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 48
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
    pinned = true
    void stick()
  },
  { immediate: true },
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
    <template v-for="{ row, children } in list" :key="row.id">
      <div v-if="row.kind === 'user'" class="ur">{{ row.text }}</div>
      <Markdown v-else-if="row.kind === 'text'" class="ar" :source="row.text" />
      <section v-else-if="row.kind === 'tool' && isSubagent(row)" :class="['sub', subagentState(row, running)]">
        <div class="sh">
          <span class="dot" />
          <b>{{ toolTarget(row) || 'Subagent' }}</b>
          <span class="st">{{ subagentLabels[subagentState(row, running)] }}</span>
        </div>
        <p class="sm">{{ subagentLine(row, children) }}</p>
        <details v-if="children.length">
          <summary>Activity</summary>
          <ol class="steps">
            <li v-for="child in children" :key="child.id">
              <template v-if="child.kind === 'tool'"><b>{{ child.name }}</b> {{ toolTarget(child) }}</template>
              <template v-else-if="child.kind === 'text'">{{ child.text.slice(0, 160) }}</template>
            </li>
          </ol>
        </details>
        <p v-if="row.result" class="rs">{{ resultSummary(row) }}</p>
      </section>
      <details v-else-if="row.kind === 'tool'" :class="['tr', { err: row.result?.isError, wait: !row.result }]">
        <summary>
          <b>{{ row.name }}</b>
          <span class="tt">{{ toolTarget(row) }}</span>
          <span v-if="diffStats(row)" class="ds"><i class="add">+{{ diffStats(row)!.added }}</i> <i class="del">−{{ diffStats(row)!.removed }}</i></span>
          <span class="rs">{{ resultSummary(row) }}</span>
        </summary>
        <pre class="io">{{ toolDetail(row) }}</pre>
        <pre v-if="row.result" class="io out">{{ row.result.text }}</pre>
      </details>
      <p v-else class="or">{{ plainLabel(row) }}</p>
    </template>
    <Markdown v-if="chat.partial" class="ar live" :source="chat.partial" />
    <div v-if="stuck" class="stuckbox" role="alert">
      <span>{{ stuckText }}</span>
      <span class="btns">
        <button v-if="stuck.reason === 'needs-login'" type="button" class="btn sm" @click="emit('relogin')">Re-login</button>
        <button type="button" class="btn sm" @click="emit('resume')">{{ stuck.reason === 'interrupted' || stuck.reason === 'needs-login' ? 'Resume' : 'Retry' }}</button>
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
  padding: 10px 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  scrollbar-width: thin;
}

.ts .older {
  align-self: center;
}

.ts .ur {
  align-self: flex-end;
  max-width: 85%;
  background: var(--accent-soft);
  color: var(--ink);
  border-radius: 12px 12px 4px 12px;
  padding: 8px 11px;
  font-size: 13.5px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.md {
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--ink2);
  overflow-wrap: anywhere;
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
.md pre,
.md .tbl {
  margin: 0 0 8px;
}

.md ul,
.md ol {
  padding-left: 20px;
}

.md h1,
.md h2,
.md h3,
.md h4,
.md h5,
.md h6 {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ink);
  margin: 12px 0 6px;
  display: block;
}

.md h1,
.md h2 {
  font-size: 14.5px;
}

.md pre {
  font: 12px/1.5 var(--mono);
  background: var(--soft);
  border: 1px solid var(--line2);
  border-radius: 8px;
  padding: 8px 10px;
  overflow: auto;
  white-space: pre;
}

.md pre code {
  border: 0;
  padding: 0;
  background: none;
}

.md blockquote {
  border-left: 3px solid var(--line);
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
  font-size: 12.5px;
}

.md th,
.md td {
  border: 1px solid var(--line);
  padding: 4px 8px;
  text-align: left;
}

.md hr {
  border: 0;
  border-top: 1px solid var(--line);
}

.ts .live::after {
  content: '▍';
  color: var(--accent);
  margin-left: 2px;
}

.ts .tr {
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #fff;
}

.ts .tr summary {
  cursor: pointer;
  list-style: none;
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 6px 10px;
  font: 11.5px/1.5 var(--mono);
  color: var(--muted);
  min-width: 0;
}

.ts .tr summary::-webkit-details-marker {
  display: none;
}

.ts .tr summary b {
  font-weight: 600;
  color: var(--ink);
}

.ts .tr .tt {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
}

.ts .tr .rs {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 45%;
}

.ts .tr.err {
  border-color: #f2b8b5;
}

.ts .tr.err .rs {
  color: var(--danger);
}

.ts .tr.wait .rs {
  color: var(--accent);
}

.ts .ds i {
  font-style: normal;
}

.ts .ds .add {
  color: var(--ok);
}

.ts .ds .del {
  color: var(--danger);
}

.ts .io {
  margin: 0;
  border-top: 1px solid var(--line2);
  padding: 8px 10px;
  font: 11.5px/1.5 var(--mono);
  color: var(--ink2);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 260px;
  overflow: auto;
}

.ts .io.out {
  background: var(--soft);
}

.ts .sub {
  border: 1px solid var(--line);
  border-left: 3px solid var(--accent);
  border-radius: 10px;
  padding: 8px 10px;
  display: grid;
  gap: 4px;
}

.ts .sub.done {
  border-left-color: var(--ok);
}

.ts .sub.failed {
  border-left-color: var(--danger);
}

.ts .sub .sh {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 13px;
}

.ts .sub .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  flex: none;
}

.ts .sub.done .dot {
  background: var(--ok);
}

.ts .sub.failed .dot {
  background: var(--danger);
}

.ts .sub .st {
  margin-left: auto;
  font: 11px var(--mono);
  color: var(--muted);
}

.ts .sub .sm,
.ts .sub .rs {
  margin: 0;
  font: 11.5px var(--mono);
  color: var(--muted);
}

.ts .sub summary {
  cursor: pointer;
  font: 11.5px var(--mono);
  color: var(--muted);
}

.ts .steps {
  margin: 6px 0 0;
  padding-left: 18px;
  font: 11.5px/1.6 var(--mono);
  color: var(--ink2);
  overflow-wrap: anywhere;
}

.ts .or {
  margin: 0;
  font: 11px var(--mono);
  color: var(--faint);
}
</style>
