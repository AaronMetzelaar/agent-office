<script setup lang="ts">
import { TresCanvas, useLoop, useTres } from '@tresjs/core'
import { ACESFilmicToneMapping, type WebGLRenderer } from 'three'
import { computed, defineComponent, nextTick, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from 'vue'
import { ago } from '../../shared/chat'
import type { DeptId } from '../../shared/departments'
import type { SearchHit } from '../../shared/history'
import { gb, plural, type Finished, type HousekeepingView } from '../../shared/housekeeping'
import type { AccountView, Navigate } from '../../shared/ipc'
import type { ReviewQueue } from '../../shared/workflow'
import Chat from '../panels/Chat.vue'
import Housekeeping from '../panels/Housekeeping.vue'
import Inbox from '../panels/Inbox.vue'
import NewAgent from '../panels/NewAgent.vue'
import { buildInbox, emptyInbox, finishedOf } from '../state/inbox'
import { cycleAgent, keyAction } from '../state/keys'
import { hasNewArtifact } from '../state/artifacts'
import { createProjection, toAgents, type ChatSource } from '../state/projection'
import { createCamera, type View } from './camera'
import { isWarning, tightest } from '../../shared/guardrails'
import { stateKey, type ChipAction, type StateKey } from './labels'
import { createWorld, type AgentEntry, type World, type WorldUi } from './world'

const props = defineProps<{ accounts: AccountView[]; source: ChatSource }>()
const emit = defineEmits<{ accounts: [] }>()

const probeEnabled = import.meta.env.DEV || !!import.meta.env.RENDERER_VITE_OFFICE_DEMO
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
const labelsEl = ref<HTMLElement>()
const barEl = ref<HTMLElement>()
const inboxEl = ref<HTMLElement>()
const paletteInput = ref<HTMLInputElement>()
const camera = createCamera()
const ui = reactive<WorldUi>({ counts: [], queue: [], agents: [] })
const world = shallowRef<World>()
const projection = createProjection(props.source)
const tick = ref(0)
const colours = new Map<string, number>()
const palette = reactive({ open: false, query: '', active: 0 })
const hits = shallowRef<SearchHit[]>([])
const searching = ref(false)
let searchTimer: ReturnType<typeof setTimeout> | undefined
const inbox = shallowRef(emptyInbox)
const configErrors = shallowRef(projection.configErrors)
const mode = ref<'inbox' | 'new' | 'house'>('inbox')
const house = shallowRef<HousekeepingView>()
const reviews = shallowRef<ReviewQueue>()
const chatList = computed(() => (tick.value, [...projection.chats.values()]))
const worktreeCount = computed(() => house.value?.worktrees.length ?? 0)
const newDesk = shallowRef<{ dept: DeptId; slot: number }>()
const toast = ref('')
const demoMode = !!import.meta.env.RENDERER_VITE_OFFICE_DEMO
let toastTimer: ReturnType<typeof setTimeout> | undefined
const loose = shallowRef<AgentEntry>()
const shownAgent = computed(() => ui.selected ?? loose.value)
const openChat = computed(() => (tick.value, shownAgent.value ? projection.chats.get(shownAgent.value.id) : undefined))
const finished = computed(() => finishedOf(chatList.value))
const leaving = new Set<string>()
let pendingSelect: string | undefined
let pendingView: View = 'fly'
const tallyLabels: [StateKey, string][] = [
  ['needs', 'need you'],
  ['stuck', 'stuck'],
  ['working', 'working'],
  ['done', 'done'],
  ['idle', 'idle'],
]
const tally = computed(() => tallyLabels.map(([key, label]) => ({ key, label, n: ui.counts.find((c) => c.key === key)?.n ?? 0 })).filter((c) => c.key !== 'stuck' || c.n || ui.filter === 'stuck'))
const matches = computed(() => {
  const q = palette.query.trim().toLowerCase()
  const done = finished.value.map((row) => ({ id: row.id, title: row.title, colour: row.colour, dept: row.dept, caption: 'Finished', state: 'idle' as StateKey }))
  return [...ui.agents, ...done].filter((a) => !q || a.title.toLowerCase().includes(q) || a.dept.toLowerCase().includes(q)).slice(0, 8)
})
const found = computed(() => {
  const shown = new Set(matches.value.map((a) => a.id))
  return hits.value.filter((hit) => !hit.chatId || !shown.has(hit.chatId)).slice(0, 8)
})
const hitColour = (hit: SearchHit) => (hit.chatId && projection.chats.get(hit.chatId)?.colour) || '#9ca3af'

function push() {
  const w = world.value
  if (!w) return
  for (const id of leaving) if (projection.chats.get(id)?.finished !== undefined) leaving.delete(id)
  const agents = toAgents(projection.chats.values(), props.accounts, Date.now(), colours, hasNewArtifact).filter((a) => !leaving.has(a.id))
  for (const a of agents) colours.set(a.id, a.colour)
  inbox.value = buildInbox(projection.chats, agents, projection.logins, w.sentAway())
  configErrors.value = projection.configErrors
  w.sync(agents, projection.logins)
  w.setReviews(reviews.value?.requests ?? [])
  tick.value++
  if (pendingSelect && (agents.some((a) => a.id === pendingSelect) || projection.chats.get(pendingSelect)?.finished !== undefined)) select(pendingSelect, pendingView)
  const back = loose.value && agents.some((a) => a.id === loose.value!.id) ? loose.value.id : undefined
  if (back) select(back, 'keep')
}

function select(chatId: string | undefined, view: View = 'fly') {
  mode.value = 'inbox'
  loose.value = undefined
  const chat = chatId ? projection.chats.get(chatId) : undefined
  if (chat && (chat.finished !== undefined || chat.archived)) {
    const row = finished.value.find((r) => r.id === chat.id)
    world.value?.select(undefined, 'keep')
    loose.value = { id: chat.id, title: chat.title, colour: row?.colour ?? chat.colour ?? '#9ca3af', dept: row?.dept ?? '', caption: `${chat.archived ? 'Archived' : 'Finished'} · ${chat.cwd.split('/').pop()}`, state: stateKey(chat.state) }
    return
  }
  pendingSelect = chatId && !projection.chats.has(chatId) ? chatId : undefined
  pendingView = view
  if (!pendingSelect) world.value?.select(chatId, chatId ? view : 'overview')
}

function openNew(desk?: { dept: DeptId; slot: number }) {
  newDesk.value = desk
  mode.value = 'new'
}

function started(chatId: string, dept: DeptId) {
  const desk = newDesk.value
  if (desk?.dept === dept) world.value?.claimDesk(chatId, desk.slot)
  select(chatId, 'keep')
}

function say(message: string) {
  toast.value = message
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 5000)
}

function toLounge(chatId: string) {
  world.value?.sendToLounge(chatId)
  push()
  if (projection.chats.get(chatId)?.state === 'done') void window.office.markRead(chatId)
}

async function finish(chatIds: string[]) {
  const { finishChat, finishChats } = props.source
  if (!chatIds.length || !finishChat || !finishChats) return
  const focused = ui.selected?.id
  const stays = ui.agents.map((agent) => agent.id).filter((id) => id === focused || (!chatIds.includes(id) && !leaving.has(id)))
  const after = focused && chatIds.includes(focused) ? cycleAgent(stays, focused, false) : undefined
  const next = after === focused ? undefined : after
  world.value?.finishing(chatIds, true)
  for (const id of chatIds) leaving.add(id)
  push()
  if (next) select(next)
  const restore = (ids: string[]) => {
    world.value?.finishing(ids, false)
    for (const id of ids) leaving.delete(id)
    push()
  }
  if (chatIds.length === 1) {
    const result: Finished | undefined = await finishChat(chatIds[0]!, true).catch((error: unknown) => ({ error: String(error) }))
    if (!result || (result.error && !result.kept)) restore(chatIds)
    if (result?.error) say(result.error)
    return
  }
  const result = await finishChats(chatIds, true).catch(() => undefined)
  const done = new Set(result?.finished ?? [])
  restore(chatIds.filter((id) => !done.has(id)))
  if (result?.skipped.length) say(`Kept ${plural(result.skipped.length, 'chat')}: ${result.skipped.map((skip) => skip.reason).join('; ')}`)
}

function act(action: ChipAction, chatId: string) {
  if (action === 'lounge') toLounge(chatId)
  else void finish([chatId])
}

function demoFinish() {
  const resting = ui.agents.filter((agent) => agent.state === 'idle' || agent.state === 'done').slice(0, 2)
  void finish(resting.map((agent) => agent.id))
}

const usable = computed(() => props.accounts.filter((account) => account.health.status !== 'needs-login'))
const headroom = computed(() => {
  const now = (tick.value, Date.now())
  return props.accounts.map((account) => {
    const window = tightest(account.health.headroom, now)
    const kind = window?.window === 'sevenDay' ? 'week' : '5h'
    const resets = window?.resetsAt ? ago(window.resetsAt - now) : ''
    return {
      id: account.id,
      label: account.label,
      used: window ? Math.round(window.utilization) : undefined,
      resets: resets && `${kind === 'week' ? 'week · ' : ''}${resets}`,
      warn: isWarning(window),
      title: window ? `${account.label}: ${Math.round(window.utilization)}% of the ${kind === 'week' ? 'weekly' : '5-hour'} limit used${resets ? `, resets in ${resets}` : ''}` : `${account.label}: no usage yet`,
    }
  })
})

async function continueElsewhere(chatId: string) {
  const other = usable.value.find((account) => account.id !== projection.chats.get(chatId)?.accountId)
  const result = other && (await window.office.continueOnAccount(chatId, other.id))
  if (result && 'chatId' in result) select(result.chatId)
}

function openHousekeeping() {
  world.value?.select(undefined, 'overview')
  mode.value = mode.value === 'house' ? 'inbox' : 'house'
}

function navigate(to: Navigate) {
  if (to.to === 'accounts') return emit('accounts')
  if (to.to === 'new') return openNew()
  if (to.to === 'housekeeping') return void (mode.value !== 'house' && openHousekeeping())
  select(to.to === 'chat' ? to.chatId : undefined)
}

watch(
  () => [openChat.value?.id, openChat.value?.state],
  () => {
    const chat = openChat.value
    if (chat?.state === 'done' && !document.hidden) void window.office.markRead(chat.id)
  },
)
const offProjection = projection.subscribe(push)
watch(() => props.accounts, push)
const captions = setInterval(push, 60_000)

function region() {
  const bottom = barEl.value?.getBoundingClientRect().bottom ?? 56
  const drawer = inboxEl.value?.getBoundingClientRect()
  return { x0: 12, y0: bottom + 8, x1: drawer?.width ? drawer.left - 12 : innerWidth - 12, y1: innerHeight - 12 }
}

const Scene = defineComponent({
  setup() {
    const { scene, renderer, advance } = useTres()
    const { onBeforeRender, render } = useLoop()
    const gl = renderer as WebGLRenderer
    const w = createWorld({ scene: scene.value, renderer: gl, camera, labelsEl: labelsEl.value!, region, ui, reduce, onNewDesk: (dept, slot) => openNew({ dept, slot }), onAction: act })
    world.value = w
    if (probeEnabled) {
      const probe = w.probe
      Object.assign(window, {
        __lounge: () => w.lounge(),
        __fps: {
          sample(ms = 4000, uncapped = false) {
            probe.awake = true
            probe.uncapped = uncapped
            const f0 = probe.frames
            const t0 = performance.now()
            return new Promise((done) =>
              setTimeout(() => {
                probe.uncapped = false
                const info = gl.info.render
                done({ fps: +((probe.frames - f0) / ((performance.now() - t0) / 1000)).toFixed(1), uncapped, calls: info.calls, tris: info.triangles, dpr: gl.getPixelRatio(), size: [innerWidth, innerHeight] })
              }, ms),
            )
          },
        },
      })
    }
    render((notify) => {
      w.render()
      notify()
    })
    onBeforeRender(() => {
      if (w.frame(performance.now())) advance()
    })
    void projection.ready.then(push)
    onUnmounted(() => {
      w.dispose()
      world.value = undefined
    })
    return () => null
  },
})

function toggleFilter(key: StateKey) {
  world.value?.setFilter(ui.filter === key ? undefined : key)
}

async function openPalette() {
  palette.open = true
  palette.query = ''
  palette.active = 0
  await nextTick()
  paletteInput.value?.focus()
}

function jump(id: string | undefined) {
  palette.open = false
  if (id) select(id)
}

async function openHit(hit: SearchHit | undefined) {
  palette.open = false
  if (!hit) return
  const opened = hit.chatId ? { chatId: hit.chatId } : await window.office.openTranscript(hit.sessionId)
  if ('error' in opened) say(opened.error)
  else select(opened.chatId)
}

function movePalette(step: number) {
  const n = matches.value.length + found.value.length
  if (n) palette.active = (palette.active + step + n) % n
}

function pick() {
  const agent = matches.value[palette.active]
  if (agent) jump(agent.id)
  else void openHit(found.value[palette.active - matches.value.length] ?? found.value[0])
}

watch(
  () => palette.query.trim(),
  (query) => {
    palette.active = 0
    clearTimeout(searchTimer)
    searching.value = query.length >= 2
    if (!searching.value) return void (hits.value = [])
    searchTimer = setTimeout(async () => {
      const result = await window.office.searchChats(query).catch(() => [])
      if (palette.query.trim() !== query) return
      hits.value = result
      searching.value = false
    }, 150)
  },
)

function nextAgent(back = false) {
  const next = cycleAgent(ui.agents.map((a) => a.id), shownAgent.value?.id, back)
  if (next) select(next)
}

function onKey(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    return void (palette.open ? (palette.open = false) : openPalette())
  }
  if (event.ctrlKey && event.key === 'Tab') {
    event.preventDefault()
    return nextAgent(event.shiftKey)
  }
  const typing = !!(event.target as HTMLElement).closest?.('input,textarea,select')
  if (event.key === 'Escape') {
    if (palette.open) palette.open = false
    else if (mode.value !== 'inbox') mode.value = 'inbox'
    else {
      if (typing) (event.target as HTMLElement).blur()
      world.value?.escape()
    }
    return
  }
  if (typing || palette.open || mode.value !== 'inbox' || event.metaKey || event.ctrlKey || event.altKey) return
  const action = keyAction(event.key, { open: ui.selected?.id, queue: inbox.value.waiting, card: openChat.value?.pendingRequests[0] })
  if (!action) return
  event.preventDefault()
  if (action.kind === 'open') select(action.chatId)
  else void window.office.resolveRequest(action.requestId, action.decision, 'keyboard')
}

const offNavigate = window.office.onNavigate(navigate)
const offHousekeeping = window.office.onHousekeeping((view) => (house.value = view))
void window.office.getHousekeeping().then((view) => (house.value ??= view))
const offReviews = window.office.onReviewRequests((queue) => (reviews.value = queue))
void window.office.getReviewRequests().then((queue) => (reviews.value ??= queue))
watch([reviews, world], () => world.value?.setReviews(reviews.value?.requests ?? []))
onMounted(() => addEventListener('keydown', onKey))
onUnmounted(() => {
  removeEventListener('keydown', onKey)
  offNavigate()
  offHousekeeping()
  offReviews()
  clearInterval(captions)
  clearTimeout(toastTimer)
  clearTimeout(searchTimer)
  offProjection()
  projection.stop()
})
</script>

<template>
  <TresCanvas window-size render-mode="manual" :dpr="[1, 1.5]" shadows clear-color="#EDEFF2" :tone-mapping="ACESFilmicToneMapping" power-preference="high-performance" :camera="camera">
    <Scene />
  </TresCanvas>
  <div ref="labelsEl" class="labels" />
  <header ref="barEl" class="bar">
    <div class="brand">
      <h1><button type="button" title="Overview (Esc)" @click="world?.overview()">Agent Office</button></h1>
      <div class="tally">
        <button v-for="c in tally" :key="c.key" type="button" class="tc" :aria-pressed="ui.filter === c.key" :title="ui.filter === c.key ? 'Show everyone' : `Highlight ${c.label}`" @click="toggleFilter(c.key)">
          <i :class="['sd', c.key]" /><b>{{ c.n }}</b> {{ c.label }}
        </button>
      </div>
    </div>
    <button type="button" class="tbtn" aria-haspopup="dialog" title="Jump to an agent or search inside every chat" @click="openPalette">Search <kbd>⌘K</kbd></button>
    <button type="button" class="tbtn" title="Next agent. Ctrl+Shift+Tab goes back" :disabled="!ui.agents.length" @click="nextAgent()">Next agent <kbd>⌃Tab</kbd></button>
    <button
      type="button"
      :class="['tbtn', 'res', { hot: house?.hot }]"
      :aria-expanded="mode === 'house'"
      :aria-label="house ? `Housekeeping. RAM ${gb(house.bytes)}${house.hot ? ', high' : ''}. ${plural(worktreeCount, 'worktree')}.` : 'Housekeeping'"
      title="Housekeeping: memory and worktrees"
      @click="openHousekeeping"
    >
      <span class="rg"><i :style="{ width: house ? `${Math.min(100, (house.bytes / house.totalMemory) * 100).toFixed(1)}%` : '0%' }" /></span>
      <span class="rl">RAM</span><b>{{ house ? gb(house.bytes) : '–' }}</b> · <b>{{ worktreeCount }}</b><span class="rl">{{ worktreeCount === 1 ? 'worktree' : 'worktrees' }}</span>
    </button>
    <button type="button" :class="['tbtn', 'res', { hot: headroom.some((h) => h.warn) }]" :title="headroom.map((h) => h.title).join('\n')" aria-label="Account headroom. Open Accounts" @click="emit('accounts')">
      <template v-for="(h, index) in headroom" :key="h.id">
        <template v-if="index"> · </template><span class="rl">{{ h.label }}</span><span class="rg"><i :style="{ width: `${Math.min(100, h.used ?? 0)}%` }" /></span><b>{{ h.used === undefined ? '–' : `${h.used}%` }}</b><span v-if="h.resets" class="rl">{{ h.resets }}</span>
      </template>
    </button>
    <button v-if="demoMode" type="button" class="tbtn" title="Demo: finish two resting agents at once" @click="demoFinish">Demo Done ×2</button>
    <slot />
  </header>
  <p v-if="toast" class="toast" role="status">{{ toast }}</p>
  <aside ref="inboxEl" class="inbox" aria-label="Inbox">
    <Housekeeping v-if="mode === 'house'" :view="house" :chats="chatList" :agents="ui.agents" @close="mode = 'inbox'" @select="select" />
    <NewAgent v-else-if="mode === 'new'" :key="newDesk ? `${newDesk.dept}:${newDesk.slot}` : 'new'" :accounts="accounts" :desk="newDesk" :version="tick" @close="mode = 'inbox'" @started="started" />
    <Chat v-else-if="shownAgent" :agent="shownAgent" :chat="openChat" :queue="inbox.waiting" :can-switch="usable.length > 1" @select="select" @accounts="emit('accounts')" @continue="continueElsewhere" @lounge="toLounge" @finish="finish" @saw="push" />
    <Inbox v-else :inbox="inbox" :finished="finished" :can-switch="usable.length > 1" :cleanup="house?.candidates.length ?? 0" :reviews="reviews" :config-errors="configErrors" @select="select" @accounts="emit('accounts')" @new="openNew()" @continue="continueElsewhere" @house="openHousekeeping" @finish="finish" />
  </aside>
  <div v-if="palette.open" class="palette-back" @click.self="palette.open = false">
    <div class="palette" role="dialog" aria-label="Search">
      <input
        ref="paletteInput"
        v-model="palette.query"
        placeholder="Jump to an agent, or search inside every chat"
        aria-label="Search"
        @keydown.down.prevent="movePalette(1)"
        @keydown.up.prevent="movePalette(-1)"
        @keydown.enter="pick"
      />
      <button v-for="(a, i) in matches" :key="a.id" type="button" :class="['pr', { on: i === palette.active }]" @click="jump(a.id)" @mousemove="palette.active = i">
        <span class="av" :style="{ background: a.colour }" />
        <span class="pt">{{ a.title }}</span>
        <span :class="['pd', a.state]">{{ a.dept }} · {{ a.caption }}</span>
      </button>
      <template v-if="found.length">
        <p class="ph">In chats</p>
        <button v-for="(hit, i) in found" :key="hit.sessionId" type="button" :class="['pr', 'hit', { on: matches.length + i === palette.active }]" @click="openHit(hit)" @mousemove="palette.active = matches.length + i">
          <span class="av" :style="{ background: hitColour(hit) }" />
          <span class="pt">{{ hit.title }}<span class="pa"> · {{ ago(Date.now() - hit.at) }} ago</span></span>
          <span class="ps">{{ hit.snippet[0] }}<mark>{{ hit.snippet[1] }}</mark>{{ hit.snippet[2] }}</span>
        </button>
      </template>
      <p v-if="!matches.length && !found.length" class="none">{{ searching ? 'Searching…' : 'Nothing matches.' }}</p>
    </div>
  </div>
</template>

<style>
.toast {
  position: fixed;
  z-index: 6;
  left: 16px;
  bottom: 16px;
  max-width: min(520px, calc(100vw - 32px - 560px));
  margin: 0;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--ink);
  color: #fff;
  font-size: 12.5px;
  box-shadow: 0 4px 14px rgba(17, 24, 39, 0.18);
}

.chip .acts {
  display: flex;
  gap: 4px;
  margin-left: 8px;
}

.chip .acts button {
  all: unset;
  cursor: pointer;
  display: inline-flex;
  padding: 2px 4px;
  color: var(--ink2);
  background: var(--soft);
  border: 1px solid var(--line);
  border-radius: 6px;
}

.chip .acts button:hover {
  color: var(--ink);
  border-color: #9aa2ae;
}

.chip .acts button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.chip .acts .done {
  color: #0f7a38;
}

.labels {
  position: fixed;
  inset: 0;
  pointer-events: none;
}

.bar {
  position: fixed;
  z-index: 5;
  left: 16px;
  top: 16px;
  display: flex;
  gap: 8px;
  align-items: stretch;
  flex-wrap: wrap;
  max-width: calc(100vw - 44px - clamp(420px, 34vw, 560px));
}

.brand {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 6px 8px 6px 14px;
  display: flex;
  gap: 10px;
  align-items: center;
  box-shadow: 0 1px 2px rgba(17, 24, 39, 0.04);
}

.brand h1 {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
  letter-spacing: -0.01em;
  white-space: nowrap;
}

.brand h1 button {
  all: unset;
  cursor: pointer;
  border-radius: 6px;
}

.brand h1 button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.tally {
  display: flex;
  gap: 2px;
  font-size: 12px;
  color: var(--muted);
  flex-wrap: wrap;
}

.tc {
  all: unset;
  cursor: pointer;
  display: inline-flex;
  gap: 6px;
  align-items: center;
  white-space: nowrap;
  padding: 4px 8px;
  border-radius: 8px;
}

.tc:hover {
  background: var(--soft);
  color: var(--ink);
}

.tc:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.tc b {
  font-weight: 500;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}

.tc[aria-pressed='true'] {
  background: var(--ink);
  color: #fff;
}

.tc[aria-pressed='true'] b {
  color: #fff;
}

.sd {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
  flex: none;
}

.sd.working {
  background: var(--accent);
}

.sd.needs {
  background: var(--needs);
}

.sd.done {
  background: var(--ok);
}

.sd.idle {
  background: #b9bfc9;
}

.sd.stuck {
  background: var(--danger);
}

.tbtn.res {
  font: 500 11.5px var(--mono);
  gap: 6px;
}

.tbtn.res b {
  font-weight: 500;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}

.tbtn.res .rg {
  width: 26px;
  height: 6px;
  border-radius: 3px;
  background: var(--line);
  overflow: hidden;
  display: inline-block;
}

.tbtn.res .rg i {
  display: block;
  height: 100%;
  background: var(--ink2);
  border-radius: 3px;
}

.tbtn.res.hot {
  border-color: #f3c77a;
  background: var(--needs-bg);
  color: var(--needs-ink);
}

.tbtn.res.hot b {
  color: var(--needs-ink);
}

.tbtn.res.hot .rg i {
  background: var(--needs);
}

.tbtn.res[aria-expanded='true'] b {
  color: #fff;
}

.tbtn.res[aria-expanded='true'] .rg {
  background: rgba(255, 255, 255, 0.25);
}

.tbtn.res[aria-expanded='true'] .rg i {
  background: #fff;
}

kbd {
  font: 500 10.5px var(--mono);
  padding: 0 5px;
  border-radius: 4px;
  line-height: 17px;
  background: var(--soft);
  color: var(--muted);
  border: 1px solid var(--line);
}

.chip {
  position: relative;
  font: 500 11px var(--mono);
  display: flex;
  align-items: center;
  padding: 4px 10px 4px 4px;
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid var(--line);
  color: var(--ink);
  white-space: nowrap;
  pointer-events: auto;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(17, 24, 39, 0.1);
  transition: translate 0.15s, padding 0.2s ease, opacity 0.2s;
  translate: var(--dx, 0px) var(--lift, 0px);
}

.chip:hover {
  translate: var(--dx, 0px) calc(var(--lift, 0px) - 2px);
}

.chip [hidden] {
  display: none !important;
}

.chip .cd {
  position: relative;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  flex: none;
  box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.14);
}

.chip .tx {
  display: grid;
  max-width: 190px;
  margin-left: 7px;
  overflow: hidden;
}

.chip .tt {
  font: 500 11.5px/15px Geist, system-ui, sans-serif;
  letter-spacing: -0.005em;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chip .dn {
  font: 400 10px/13px var(--mono);
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
}

.chip.working .dn {
  color: var(--accent);
}

.chip.needs .dn {
  color: var(--needs-ink);
}

.chip.done .dn {
  color: #0f7a38;
}

.chip.stuck .dn {
  color: var(--danger);
}

.chip .ex {
  margin-left: 8px;
  color: var(--muted);
}

.chip.needs {
  background: var(--needs-bg);
  border-color: var(--needs);
}

.chip.stuck {
  border-color: #f2b8b5;
}

.chip.idle .tt {
  color: var(--ink2);
}

.chip.parked {
  opacity: 0.85;
}

.chip.sel {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft), 0 1px 3px rgba(17, 24, 39, 0.1);
}

.chip.dim {
  opacity: 0.28;
}

.chip .qn {
  font: 600 10px/14px var(--mono);
  color: var(--needs-ink);
  padding: 0 4px 0 3px;
  font-variant-numeric: tabular-nums;
}

.chip.q {
  border-color: #f3c77a;
}

.chip.stuck.q {
  border-color: #f2b8b5;
}

.chip.stuck .qn {
  color: #b42318;
}

.labels.far .chip {
  padding: 3px 9px 3px 3px;
  border-radius: 10px;
}

.labels.far .chip .cd {
  width: 12px;
  height: 12px;
}

.labels.far .chip .tt {
  font-size: 11px;
  line-height: 14px;
}

.labels.far .chip .dn {
  font-size: 9.5px;
  line-height: 12px;
}

.labels.far .chip .tx {
  max-width: 170px;
  margin-left: 6px;
}

.labels.far .chip .ex {
  display: none;
}

.chip.mini {
  padding: 3px;
}

.chip.mini .tx,
.chip.mini .ex {
  display: none;
}

.bang {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 7px);
  margin-left: -13px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid var(--needs);
  color: var(--needs);
  display: grid;
  place-items: center;
  font: 700 15px Geist, sans-serif;
  box-shadow: 0 2px 8px rgba(245, 158, 11, 0.35);
  box-sizing: border-box;
  animation: hop 1.1s ease-in-out infinite;
  pointer-events: none;
}

.bang.warn {
  border-radius: 7px;
  border-color: var(--danger);
  color: var(--danger);
  background: #fdecec;
  box-shadow: 0 2px 8px rgba(220, 38, 38, 0.3);
}

@keyframes hop {
  50% {
    translate: 0 -4px;
  }
}

.labels.far .bang {
  width: 20px;
  height: 20px;
  margin-left: -10px;
  font-size: 12px;
  border-width: 1.5px;
  bottom: calc(100% + 5px);
}

.intray {
  padding: 3px 9px;
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid var(--line);
  border-radius: 99px;
  box-shadow: 0 1px 3px rgba(17, 24, 39, 0.08);
  font: 600 11px/16px var(--mono);
  color: var(--accent);
  white-space: nowrap;
  pointer-events: none;
}

.intray.late {
  border-color: var(--needs);
  background: var(--needs-bg);
  color: var(--needs-ink);
}

.sign {
  all: unset;
  box-sizing: border-box;
  pointer-events: auto;
  cursor: pointer;
  display: grid;
  padding: 6px 10px 7px;
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: 0 1px 3px rgba(17, 24, 39, 0.08);
  white-space: nowrap;
  transition: opacity 0.2s, border-color 0.2s, box-shadow 0.2s;
}

.sign .sn {
  display: flex;
  gap: 7px;
  align-items: center;
  font: 600 12.5px/17px Geist, system-ui, sans-serif;
  color: var(--ink);
  letter-spacing: -0.01em;
}

.sign .sn b {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: inherit;
}

.sign .sn i {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 2px;
  background: var(--ac);
}

.sign .sp {
  font: 400 10px/14px var(--mono);
  color: var(--muted);
}

.cts {
  display: flex;
  gap: 9px;
  font: 500 11px/16px Geist, system-ui, sans-serif;
  color: var(--ink2);
  font-variant-numeric: tabular-nums;
}

.cts span {
  display: inline-flex;
  gap: 4px;
  align-items: center;
}

.cts em {
  font-style: normal;
}

.cts .sd {
  width: 6px;
  height: 6px;
}

.cts .needs {
  color: #b45309;
  font-weight: 600;
}

.cts .stuck {
  color: #b42318;
}

.sign .cts {
  margin-top: 2px;
}

.sign:hover,
.sign.on {
  border-color: var(--ac);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ac) 14%, transparent), 0 2px 6px rgba(17, 24, 39, 0.08);
}

.sign.dim {
  opacity: 0.4;
}

.sign:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.sign.park {
  --ac: #9ca3af;
  background: rgba(248, 249, 250, 0.95);
}

.sign.park .sn i {
  border-radius: 50%;
}

.labels.far .sign {
  padding: 4px 7px 5px;
}

.labels.far .sign .sn {
  font-size: 11px;
  line-height: 15px;
}

.labels.far .sign .sp,
.labels.far .cts em {
  display: none;
}

.labels.far .cts {
  gap: 6px;
  font-size: 10px;
  line-height: 14px;
}

.inbox {
  position: fixed;
  z-index: 6;
  top: 12px;
  right: 12px;
  bottom: 12px;
  width: clamp(420px, 34vw, 560px);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: 0 1px 2px rgba(17, 24, 39, 0.04), 0 18px 44px rgba(17, 24, 39, 0.1);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.av {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  flex: none;
  box-shadow: inset 0 -3px 0 rgba(0, 0, 0, 0.12), inset 0 2px 0 rgba(255, 255, 255, 0.25);
}

.none {
  margin: 16px 4px 2px;
  padding: 14px;
  border: 1px dashed var(--line);
  border-radius: 12px;
  font-size: 12.5px;
  color: var(--muted);
  text-align: center;
}

.pd.working {
  color: var(--accent);
}

.pd.needs {
  color: var(--needs-ink);
}

.pd.stuck {
  color: var(--danger);
}

.pd.done {
  color: #0f7a38;
}

.palette-back {
  position: fixed;
  inset: 0;
  z-index: 9;
  background: rgba(17, 24, 39, 0.12);
  display: grid;
  place-items: start center;
  padding-top: 14vh;
}

.palette {
  width: min(520px, calc(100vw - 32px));
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 14px;
  box-shadow: 0 18px 44px rgba(17, 24, 39, 0.16);
  padding: 8px;
  display: grid;
  gap: 2px;
  max-height: 72vh;
  overflow: auto;
  transition: opacity 0.15s, translate 0.15s cubic-bezier(0.2, 0, 0, 1);

  @starting-style {
    opacity: 0;
    translate: 0 -6px;
  }
}

.palette .ph {
  margin: 8px 10px 2px;
  font: 10.5px var(--mono);
  color: var(--faint);
}

.pa {
  color: var(--faint);
  font-size: 12px;
}

.ps {
  grid-area: d;
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.ps mark {
  background: var(--accent-soft);
  color: var(--ink);
  border-radius: 3px;
}

.palette input {
  font: 14px Geist, system-ui, sans-serif;
  border: none;
  outline: none;
  padding: 10px 10px 12px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 4px;
  color: var(--ink);
  background: transparent;
}

.pr {
  all: unset;
  cursor: pointer;
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  grid-template-areas: 'av t' '. d';
  column-gap: 10px;
  padding: 7px 10px;
  border-radius: 9px;
}

.pr.on,
.pr:focus-visible {
  background: var(--soft);
}

.pr .av {
  grid-area: av;
}

.pt {
  grid-area: t;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pd {
  grid-area: d;
  font: 11px var(--mono);
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 900px) {
  .inbox {
    display: none;
  }

  .bar {
    max-width: calc(100vw - 32px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .bang {
    animation: none;
  }

  .chip,
  .sign,
  .palette {
    transition: none;
  }
}
</style>
