<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ago, type ChatView } from '../../shared/chat'
import { cleanupChoices, gb, parkChoices, plural, runsIn, size, stopText, summaryText, visitorHold, type AgentMemory, type HousekeepingView, type Proc, type WorktreeView } from '../../shared/housekeeping'
import type { AgentEntry } from '../office/world'

const props = defineProps<{ view?: HousekeepingView; chats: ChatView[]; agents: AgentEntry[] }>()
const emit = defineEmits<{ close: []; select: [chatId: string] }>()

interface Row {
  chat: ChatView
  agent?: AgentEntry
  memory?: AgentMemory
  tree?: WorktreeView
  stubborn: Proc[]
}

const confirming = ref(false)
const busy = ref(false)
const flash = ref('')
const now = ref(Date.now())
let flashTimer: ReturnType<typeof setTimeout> | undefined
const clock = setInterval(() => (now.value = Date.now()), 60_000)

const inside = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`)
const bytesOf = (row: Row) => row.memory?.bytes ?? 0
const byMemory = (a: Row, b: Row) => bytesOf(b) - bytesOf(a)
const total = (rows: Row[]) => rows.reduce((sum, row) => sum + bytesOf(row), 0)
const folderName = (path: string) => path.split('/').filter(Boolean).pop() ?? path

const rows = computed<Row[]>(() => {
  const view = props.view
  const agents = new Map(props.agents.map((agent) => [agent.id, agent]))
  const memory = new Map(view?.agents.map((use) => [use.chatId, use]))
  return props.chats
    .filter((chat) => !chat.archived)
    .map((chat) => ({ chat, agent: agents.get(chat.id), memory: memory.get(chat.id), tree: view?.worktrees.find((tree) => inside(chat.cwd, tree.path)), stubborn: view?.stubborn[chat.id] ?? [] }))
})
const candidateIds = computed(() => new Set(props.view?.candidates))
const visiting = computed(() => rows.value.filter((row) => row.chat.visitor && !row.chat.moved && (row.tree || row.chat.retained)))
const candidates = computed(() => rows.value.filter((row) => candidateIds.value.has(row.chat.id) && !visiting.value.includes(row)).sort(byMemory))
const parked = computed(() => rows.value.filter((row) => row.chat.parked && !candidateIds.value.has(row.chat.id)).sort(byMemory))
const atDesks = computed(() => rows.value.filter((row) => !row.chat.parked && !row.chat.retained && !candidateIds.value.has(row.chat.id) && row.memory).sort(byMemory))
const safe = computed(() => rows.value.filter((row) => props.view?.safe.includes(row.chat.id)))
const sections = computed(() => [
  { key: 'clean', title: `Cleanup candidates · ${candidates.value.length}`, hint: `quiet ${cleanupChoices.find(([ms]) => ms === props.view?.thresholds.cleanupAfterMs)?.[1] ?? ''}+ · by RAM`, empty: 'Nothing has been quiet that long.', rows: candidates.value },
  { key: 'park', title: `Parked · ${parked.value.length}`, hint: '', empty: '', rows: parked.value },
  { key: 'visit', title: `Visitors in worktrees · ${visiting.value.length}`, hint: 'desktop and terminal chats · not on the floor while quiet', empty: '', rows: visiting.value },
])
const otherTrees = computed(() => props.view?.worktrees.filter((tree) => !tree.chatIds.length) ?? [])
const diskTotal = computed(() => props.view?.worktrees.reduce((sum, tree) => sum + (tree.bytes ?? 0), 0) ?? 0)
const outsideTotal = computed(() => props.view?.outside.reduce((sum, use) => sum + use.bytes, 0) ?? 0)
const officeSafe = computed(() => safe.value.filter((row) => !row.chat.visitor))
const preview = computed(() => ({
  bytes: total(officeSafe.value),
  processes: officeSafe.value.reduce((sum, row) => sum + (row.memory?.processes.length ?? 0), 0),
  visitors: safe.value.length - officeSafe.value.length,
  trees: safe.value.filter((row) => row.tree).length,
  disk: safe.value.reduce((sum, row) => sum + (row.tree?.bytes ?? 0), 0),
}))
const width = (bytes: number) => `${props.view ? Math.min(100, (bytes / props.view.totalMemory) * 100).toFixed(2) : 0}%`
const segments = computed(() => [
  ...candidates.value.map((row) => ({ key: row.chat.id, title: row.chat.title, bytes: bytesOf(row), kind: 'clean' })),
  ...parked.value.map((row) => ({ key: row.chat.id, title: row.chat.title, bytes: bytesOf(row), kind: 'park' })),
  ...atDesks.value.map((row) => ({ key: row.chat.id, title: row.chat.title, bytes: bytesOf(row), kind: 'desk' })),
  ...(props.view?.outside.map((use) => ({ key: use.cwd, title: `Outside the office · ${folderName(use.cwd)}`, bytes: use.bytes, kind: 'out' })) ?? []),
])

function say(message: string) {
  flash.value = message
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => (flash.value = ''), 6000)
}

async function act(work: () => Promise<string>) {
  if (busy.value) return
  busy.value = true
  try {
    say(await work())
  } finally {
    busy.value = false
    confirming.value = false
  }
}

const stop = (row: Row) => act(async () => stopText(await window.office.stopProcesses(row.chat.id)))
const archive = (row: Row) => act(async () => `Archived ${row.chat.title} · freed ${size((await window.office.archiveChat(row.chat.id)).freedBytes)} · worktree kept`)
const cleanUp = (chatIds?: string[]) =>
  act(async () => {
    const summary = await window.office.cleanUp(chatIds)
    const skipped = chatIds && summary.skipped[0] ? ` · ${summary.skipped[0].reason}` : ''
    return summaryText(summary) + skipped
  })
const archiveVisitor = (row: Row) =>
  act(async () => {
    const result = await window.office.archiveVisitor(row.chat.id)
    return result ? (result.error ?? `Archived ${row.chat.title} in the office`) : ''
  })
const removeVisitorTree = (row: Row) =>
  act(async () => {
    const result = await window.office.removeVisitorWorktree(row.chat.id)
    if (!result) return ''
    return result.error ?? `Removed ${folderName(row.tree?.path ?? '')}${result.bytes ? ` · ${size(result.bytes)}` : ''} · chat archived`
  })
const removeTree = (tree: WorktreeView) =>
  act(async () => {
    const result = await window.office.removeWorktree(tree.path)
    if (!result) return ''
    return result.error ?? `Removed ${folderName(tree.path)}${result.bytes ? ` · ${size(result.bytes)}` : ''}`
  })

async function setThreshold(key: 'parkAfterMs' | 'cleanupAfterMs', event: Event) {
  if (!props.view) return
  const value = Number((event.target as HTMLSelectElement).value)
  const next = { ...props.view.thresholds, [key]: value }
  if (next.cleanupAfterMs < next.parkAfterMs) next[key === 'parkAfterMs' ? 'cleanupAfterMs' : 'parkAfterMs'] = value
  await window.office.setThresholds(next)
}

const processLine = (row: Row) => row.memory?.processes.map((proc) => `${proc.command} · ${size(proc.bytes)}`).join('  ·  ') || (row.chat.visitor ? `runs in ${runsIn(row.chat)}` : 'no processes running')
const ram = (row: Row) => (row.memory || !row.chat.visitor ? size(bytesOf(row)) : `RAM: in ${row.chat.visitor === 'terminal' ? 'terminal' : 'desktop app'}`)
const hold = (row: Row) => (row.chat.visitor ? visitorHold(row.chat, now.value) : undefined)
const quiet = (row: Row) => ago(now.value - row.chat.lastActivityAt)

onMounted(() => void window.office.getHousekeeping(true))
onUnmounted(() => {
  clearInterval(clock)
  clearTimeout(flashTimer)
})
</script>

<template>
  <div class="dh">
    <span class="av new" aria-hidden="true">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2.5 11.5a5.5 5.5 0 1111 0" /><path d="M8 11.5l2.6-3.4" /></svg>
    </span>
    <div>
      <h2>Housekeeping</h2>
      <p class="meta">{{ view ? `${rows.length} chats · ${plural(view.worktrees.length, 'worktree')} · ${gb(diskTotal)} on disk` : 'Measuring…' }}</p>
    </div>
    <button type="button" class="ib" aria-label="Close housekeeping" title="Close (Esc)" @click="emit('close')">×</button>
  </div>
  <div v-if="view" class="hk">
    <div class="ramb">
      <div :class="['ramt', { hot: view.hot }]">
        <span>RAM used by agents</span><span><b>{{ gb(view.bytes) }}</b> of {{ gb(view.totalMemory) }}</span>
      </div>
      <div class="rbar" role="img" :aria-label="`${gb(total(candidates))} in cleanup candidates, ${gb(total(parked))} parked, ${gb(total(atDesks))} at desks, ${gb(outsideTotal)} outside the office`">
        <i v-for="segment in segments" :key="segment.key" :class="segment.kind" :style="{ width: width(segment.bytes) }" :title="`${segment.title} · ${size(segment.bytes)}`" />
      </div>
      <div class="rleg">
        <span><i class="clean" />Cleanup {{ gb(total(candidates)) }}</span>
        <span><i class="park" />Parked {{ gb(total(parked)) }}</span>
        <span><i class="desk" />At desks {{ gb(total(atDesks)) }}</span>
        <span v-if="view.outside.length"><i class="out" />Outside {{ gb(outsideTotal) }}</span>
      </div>
    </div>
    <div class="hset">
      <label>
        Park after
        <select :value="view.thresholds.parkAfterMs" @change="setThreshold('parkAfterMs', $event)">
          <option v-for="[ms, label] in parkChoices" :key="ms" :value="ms">{{ label }}</option>
        </select>
        <small>no message: leaves its desk</small>
      </label>
      <label>
        Clean up after
        <select :value="view.thresholds.cleanupAfterMs" @change="setThreshold('cleanupAfterMs', $event)">
          <option v-for="[ms, label] in cleanupChoices" :key="ms" :value="ms">{{ label }}</option>
        </select>
        <small>suggested below</small>
      </label>
    </div>
    <div v-if="safe.length" class="hcta">
      <div v-if="confirming && safe.length" class="hconf" role="group" aria-label="Confirm cleanup">
        <h4>Clean up {{ safe.length }} chat{{ safe.length === 1 ? '' : 's' }}?</h4>
        <ul>
          <li>Stop <b>{{ preview.processes }} processes</b>, freeing <b>{{ gb(preview.bytes) }}</b> of RAM</li>
          <li>Remove <b>{{ preview.trees }} worktree{{ preview.trees === 1 ? '' : 's' }}</b> ({{ gb(preview.disk) }} on disk)</li>
          <li>Archive: {{ safe.map((row) => row.chat.title).join(', ') }}</li>
          <li v-if="preview.visitors">Hide <b>{{ plural(preview.visitors, 'visitor') }}</b> from the office. The desktop app and terminal keep them.</li>
        </ul>
        <p>Only chats with a clean worktree or a merged PR. Nothing uncommitted or unpushed is touched, and nothing is force-removed.</p>
        <div class="btns">
          <button type="button" class="btn primary" :disabled="busy" @click="cleanUp()">Clean up {{ safe.length }}</button>
          <button type="button" class="btn" @click="confirming = false">Cancel</button>
        </div>
      </div>
      <button v-else type="button" class="btn primary" :disabled="busy" @click="confirming = true">Clean up {{ safe.length }} safe · frees {{ gb(preview.bytes) }}</button>
    </div>
    <p v-if="flash" class="flash toast" role="status">{{ flash }}</p>

    <section v-for="section in sections" :key="section.key" :aria-label="section.title">
      <h3 v-if="section.rows.length || section.empty" class="sec">{{ section.title }}<i>{{ section.hint }}</i></h3>
      <p v-if="!section.rows.length && section.empty" class="none">{{ section.empty }}</p>
      <article v-for="row in section.rows" :key="row.chat.id" class="hrow" :data-chat="row.chat.id">
        <div class="hr1">
          <span class="dd" :style="{ background: row.agent?.colour ?? '#9ca3af' }" />
          <b>{{ row.chat.title }}</b>
          <em>{{ ram(row) }}</em>
        </div>
        <div class="hr2">
          <span>{{ row.agent?.dept ?? folderName(row.chat.cwd) }}</span><span>·</span><span>{{ quiet(row) }} ago</span><span>·</span>
          <span>{{ row.tree ? `worktree ${row.tree.bytes === undefined ? '…' : size(row.tree.bytes)}` : 'no worktree' }}</span>
          <span v-if="row.tree" :class="['gc', { safe: row.tree.git?.safe, block: row.tree.git?.blocked }]">{{ row.tree.git?.label ?? 'checking…' }}</span>
        </div>
        <div class="hr3" :title="row.chat.cwd">{{ processLine(row) }}</div>
        <p v-if="row.tree?.git?.discardable" class="hwhy">Removing it discards {{ row.tree.git.blocked }}.</p>
        <p v-else-if="row.tree?.git?.blocked" class="hwhy">Can’t remove the worktree: {{ row.tree.git.blocked }}. {{ row.chat.visitor ? `Commit or push in ${runsIn(row.chat)} first.` : 'Open the chat to commit or push first.' }}</p>
        <p v-else-if="row.tree && hold(row)" class="hwhy">Can’t remove the worktree: {{ hold(row) }}.</p>
        <p v-for="proc in row.stubborn" :key="proc.pid" class="hwhy">{{ proc.command }} (pid {{ proc.pid }}) kept running after a stop request. Quit it yourself if you don’t need it.</p>
        <div v-if="row.chat.visitor" class="hr4">
          <button type="button" class="btn sm" :disabled="busy" @click="archiveVisitor(row)">Archive chat</button>
          <button v-if="row.tree" type="button" class="btn sm" :disabled="!(row.tree.git?.safe || row.tree.git?.discardable) || !!hold(row) || busy" @click="removeVisitorTree(row)">Remove worktree</button>
        </div>
        <div v-else class="hr4">
          <button v-if="row.memory?.processes.length" type="button" class="btn sm" :disabled="busy" @click="stop(row)">Stop processes</button>
          <button type="button" class="btn sm" :disabled="busy" @click="archive(row)">Archive chat</button>
          <button v-if="row.tree?.git?.blocked" type="button" class="btn sm primary" @click="emit('select', row.chat.id)">Open chat</button>
          <button v-if="row.tree && (!row.tree.git?.blocked || row.tree.git.discardable)" type="button" class="btn sm" :disabled="!(row.tree.git?.safe || row.tree.git?.discardable) || busy" @click="cleanUp([row.chat.id])">Remove worktree</button>
        </div>
      </article>
    </section>

    <template v-if="atDesks.length">
      <h3 class="sec">At desks · {{ atDesks.length }}</h3>
      <button v-for="row in atDesks" :key="row.chat.id" type="button" class="hrow" @click="emit('select', row.chat.id)">
        <span class="hr1"><span class="dd" :style="{ background: row.agent?.colour ?? '#9ca3af' }" /><b>{{ row.chat.title }}</b><em>{{ ram(row) }}</em></span>
        <span class="hr3">{{ processLine(row) }}</span>
      </button>
    </template>

    <template v-if="view.outside.length">
      <h3 class="sec">Outside the office · {{ view.outside.length }}</h3>
      <div v-for="use in view.outside" :key="use.cwd" class="hrow gone">
        <div class="hr1"><span class="dd" /><b>{{ folderName(use.cwd) }}</b><em>{{ size(use.bytes) }}</em></div>
        <div class="hr3" :title="use.cwd">{{ use.pids.length }} claude session{{ use.pids.length === 1 ? '' : 's' }} · {{ use.cwd }}</div>
      </div>
    </template>

    <template v-if="otherTrees.length">
      <h3 class="sec">Other worktrees · {{ otherTrees.length }}</h3>
      <div v-for="tree in otherTrees" :key="tree.path" class="hrow gone" :data-tree="tree.path">
        <div class="hr1"><span class="dd" /><b>{{ folderName(tree.path) }}</b><em>{{ tree.bytes === undefined ? '…' : size(tree.bytes) }}</em></div>
        <div class="hr2">
          <span>{{ folderName(tree.repo) }}</span><template v-if="tree.branch"><span>·</span><span>{{ tree.branch }}</span></template>
          <span :class="['gc', { safe: tree.git?.safe, block: tree.git?.blocked }]">{{ tree.locked ? 'Locked' : (tree.git?.label ?? 'checking…') }}</span>
        </div>
        <p v-if="tree.git?.discardable" class="hwhy">Removing it discards {{ tree.git.blocked }}.</p>
        <p v-else-if="tree.git?.blocked" class="hwhy">Kept: {{ tree.git.blocked }}.</p>
        <div v-if="!tree.git?.blocked || tree.git.discardable" class="hr4">
          <button type="button" class="btn sm" :disabled="!(tree.git?.safe || tree.git?.discardable) || tree.locked || busy" @click="removeTree(tree)">Remove worktree</button>
        </div>
      </div>
    </template>
  </div>
</template>

<style>
.hk {
  flex: 1;
  overflow: auto;
  padding: 4px 16px 16px;
  scrollbar-width: thin;
}

.inbox .dh .av.new svg {
  width: 15px;
  height: 15px;
}

.hk .ramb {
  margin-top: 12px;
}

.hk .ramt {
  display: flex;
  justify-content: space-between;
  font: 11px var(--mono);
  color: var(--muted);
  margin-bottom: 6px;
}

.hk .ramt b {
  font-weight: 500;
  color: var(--ink);
}

.hk .ramt.hot b {
  color: var(--needs-ink);
}

.hk .rbar {
  display: flex;
  height: 12px;
  border-radius: 6px;
  background: var(--line2);
  overflow: hidden;
  gap: 1px;
}

.hk .rbar i {
  display: block;
  height: 100%;
  min-width: 2px;
}

.hk .clean {
  background: var(--ink);
}

.hk .park {
  background: #9ca3af;
}

.hk .desk {
  background: #c7cedb;
}

.hk .out {
  background: #e3e7ee;
}

.hk .rleg {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-top: 7px;
  font: 10.5px var(--mono);
  color: var(--muted);
}

.hk .rleg span {
  display: inline-flex;
  gap: 5px;
  align-items: center;
}

.hk .rleg i {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}

.hk .hset {
  margin-top: 14px;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 4px 12px;
}

.hk .hset label {
  display: grid;
  grid-template-columns: 96px auto minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  padding: 7px 0;
  font-size: 12.5px;
  color: var(--ink);
}

.hk .hset label + label {
  border-top: 1px solid var(--line2);
}

.hk .hset select {
  font: 12px Geist, system-ui, sans-serif;
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 4px 6px;
  background: #fff;
  color: var(--ink);
}

.hk .hset small {
  font: 10.5px/1.4 var(--mono);
  color: var(--muted);
}

.hk .hcta {
  margin-top: 14px;
  display: grid;
  gap: 8px;
}

.hk .hcta > .btn {
  justify-content: center;
  padding: 9px 12px;
}

.hk .hconf {
  border: 1px solid var(--ink);
  border-radius: 12px;
  padding: 12px;
  display: grid;
  gap: 8px;
  font-size: 12.5px;
  color: var(--ink2);
}

.hk .hconf h4 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}

.hk .hconf ul {
  margin: 0;
  padding-left: 16px;
  font: 11.5px/1.7 var(--mono);
  color: var(--muted);
}

.hk .hconf ul b {
  font-weight: 500;
  color: var(--ink);
}

.hk .hconf p {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}

.hk .hconf .btns {
  display: flex;
  gap: 8px;
}

.hk .toast {
  margin: 12px 0 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--ink);
  color: #fff;
  font: 500 12px Geist, system-ui, sans-serif;
}

.hk .sec {
  margin: 20px 0 2px;
  display: flex;
  gap: 8px;
}

.hk .sec i {
  font-style: normal;
  text-transform: none;
  letter-spacing: 0;
  font-family: var(--mono);
  margin-left: auto;
}

.hk .none {
  margin: 8px 0 0;
  padding: 12px;
  border: 1px dashed var(--line);
  border-radius: 12px;
  font-size: 12px;
  color: var(--muted);
  text-align: center;
}

.hk .hrow {
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 10px 12px;
  margin-top: 8px;
  display: grid;
  gap: 5px;
  background: #fff;
}

.hk button.hrow {
  all: unset;
  box-sizing: border-box;
  width: 100%;
  cursor: pointer;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 10px 12px;
  margin-top: 8px;
  display: grid;
  gap: 5px;
}

.hk button.hrow:hover {
  border-color: #cbd0d8;
}

.hk button.hrow:focus-visible {
  outline: 2px solid var(--accent);
}

.hk .hrow.gone .hr1,
.hk .hrow.gone .hr2 {
  opacity: 0.7;
}

.hk .hr1 {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) auto;
  gap: 9px;
  align-items: center;
}

.hk .hr1 .dd {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #9ca3af;
}

.hk .hr1 b {
  font-size: 13px;
  font-weight: 500;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hk .hr1 em {
  font: 500 11.5px var(--mono);
  font-style: normal;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}

.hk .hr2 {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  align-items: center;
  padding-left: 17px;
  font: 11px var(--mono);
  color: var(--muted);
}

.hk .hr3 {
  padding-left: 17px;
  font: 10.5px var(--mono);
  color: var(--faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hk .gc {
  font: 500 10.5px var(--mono);
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--soft);
  color: var(--ink2);
  border: 1px solid var(--line);
}

.hk .gc.safe {
  background: #e8f7ee;
  color: #0f7a38;
  border-color: #c6ebd3;
}

.hk .gc.block {
  background: #fff;
  color: var(--ink);
  border-color: #9ca3af;
}

.hk .hwhy {
  margin: 0;
  padding-left: 17px;
  font-size: 11.5px;
  color: var(--ink2);
}

.hk .hr4 {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding-left: 17px;
  margin-top: 3px;
}
</style>
