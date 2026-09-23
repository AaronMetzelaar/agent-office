<script setup lang="ts">
import { TresCanvas, useLoop, useTres } from '@tresjs/core'
import { ACESFilmicToneMapping, type WebGLRenderer } from 'three'
import { computed, defineComponent, nextTick, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from 'vue'
import type { AccountView } from '../../shared/ipc'
import { createProjection, toAgents, type ChatSource } from '../state/projection'
import { createCamera } from './camera'
import type { StateKey } from './labels'
import { createWorld, type World, type WorldUi } from './world'

const props = defineProps<{ accounts: AccountView[]; source: ChatSource }>()

const probeEnabled = import.meta.env.DEV || import.meta.env.RENDERER_VITE_OFFICE_DEMO === '1'
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
const labelsEl = ref<HTMLElement>()
const barEl = ref<HTMLElement>()
const paletteInput = ref<HTMLInputElement>()
const camera = createCamera()
const ui = reactive<WorldUi>({ counts: [], queue: [], agents: [] })
const world = shallowRef<World>()
const projection = createProjection(props.source)
const colours = new Map<string, number>()
const palette = reactive({ open: false, query: '' })
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
  return ui.agents.filter((a) => !q || a.title.toLowerCase().includes(q) || a.dept.toLowerCase().includes(q)).slice(0, 8)
})

function push() {
  const w = world.value
  if (!w) return
  const agents = toAgents(projection.chats.values(), props.accounts, Date.now(), colours)
  for (const a of agents) colours.set(a.id, a.colour)
  w.sync(agents, projection.logins)
}
const offProjection = projection.subscribe(push)
watch(() => props.accounts, push)
const captions = setInterval(push, 60_000)

const drawerWidth = () => (innerWidth <= 900 ? 0 : Math.round(Math.min(430, Math.max(360, innerWidth * 0.28))))
function region() {
  const bottom = barEl.value?.getBoundingClientRect().bottom ?? 56
  const dw = drawerWidth()
  return { x0: 12, y0: bottom + 8, x1: innerWidth - (dw ? dw + 24 : 12), y1: innerHeight - 12 }
}

const Scene = defineComponent({
  setup() {
    const { scene, renderer, advance } = useTres()
    const { onBeforeRender, render } = useLoop()
    const gl = renderer as WebGLRenderer
    const w = createWorld({ scene: scene.value, renderer: gl, camera, labelsEl: labelsEl.value!, region, ui, reduce })
    world.value = w
    if (probeEnabled) {
      const probe = w.probe
      Object.assign(window, {
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
  await nextTick()
  paletteInput.value?.focus()
}

function jump(id: string | undefined) {
  palette.open = false
  if (id) world.value?.select(id, true)
}

function onKey(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    return void (palette.open ? (palette.open = false) : openPalette())
  }
  if (event.key !== 'Escape') return
  if (palette.open) palette.open = false
  else if (!(event.target as HTMLElement).closest?.('input,textarea,select')) world.value?.escape()
}

onMounted(() => addEventListener('keydown', onKey))
onUnmounted(() => {
  removeEventListener('keydown', onKey)
  clearInterval(captions)
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
      <h1>Agent Office</h1>
      <div class="tally">
        <button v-for="c in tally" :key="c.key" type="button" class="tc" :aria-pressed="ui.filter === c.key" :title="ui.filter === c.key ? 'Show everyone' : `Highlight ${c.label}`" @click="toggleFilter(c.key)">
          <i :class="['sd', c.key]" /><b>{{ c.n }}</b> {{ c.label }}
        </button>
      </div>
    </div>
    <button type="button" class="tbtn" @click="world?.overview()">Overview</button>
    <button type="button" class="tbtn" aria-haspopup="dialog" @click="openPalette">Jump to agent <kbd>⌘K</kbd></button>
    <slot />
  </header>
  <aside class="inbox" aria-label="Inbox">
    <template v-if="ui.selected">
      <div class="dh">
        <span class="av" :style="{ background: ui.selected.colour }" />
        <div>
          <h2>{{ ui.selected.title }}</h2>
          <p class="meta">{{ ui.selected.dept }}</p>
        </div>
        <button type="button" class="ib" aria-label="Back to inbox" title="Back to inbox (Esc)" @click="world?.select(undefined, false)">×</button>
      </div>
      <p :class="['doing', ui.selected.state]">{{ ui.selected.caption }}</p>
    </template>
    <template v-else>
      <div class="ih">
        <h2><i :class="{ clear: !ui.queue.length }" />Waiting for you · {{ ui.queue.length }}</h2>
        <p>{{ ui.queue.length ? 'Auto mode handles the rest. These need a yes or no from you.' : 'Nobody is at your door right now.' }}</p>
      </div>
      <div class="ibx">
        <button v-for="q in ui.queue" :key="q.key" type="button" :class="['qi', { first: q.index === 0, stuck: q.kind !== 'request' }]" @click="q.chatId && world?.select(q.chatId, true)">
          <span class="n">{{ q.index + 1 }}</span>
          <span class="av" :style="{ background: q.colour }" />
          <span class="t">{{ q.title }}</span>
          <span class="m">{{ q.detail }}</span>
        </button>
        <p v-if="!ui.queue.length" class="none">When Auto mode needs a decision, the agent walks to your door and waits here.</p>
      </div>
    </template>
  </aside>
  <div v-if="palette.open" class="palette-back" @click.self="palette.open = false">
    <div class="palette" role="dialog" aria-label="Jump to agent">
      <input ref="paletteInput" v-model="palette.query" placeholder="Jump to an agent by name" aria-label="Agent name" @keydown.enter="jump(matches[0]?.id)" />
      <button v-for="a in matches" :key="a.id" type="button" class="pr" @click="jump(a.id)">
        <span class="av" :style="{ background: a.colour }" />
        <span class="pt">{{ a.title }}</span>
        <span :class="['pd', a.state]">{{ a.dept }} · {{ a.caption }}</span>
      </button>
      <p v-if="!matches.length" class="none">No agent matches.</p>
    </div>
  </div>
</template>

<style>
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
  max-width: calc(100vw - 32px - 430px);
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

.sign .sn i {
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
  width: clamp(360px, 28vw, 430px);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: 0 1px 2px rgba(17, 24, 39, 0.04), 0 18px 44px rgba(17, 24, 39, 0.1);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.inbox .ih {
  padding: 16px 16px 13px;
  border-bottom: 1px solid var(--line);
}

.inbox h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inbox .ih h2 i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--needs);
}

.inbox .ih h2 i.clear {
  background: var(--ok);
}

.inbox .ih p {
  margin: 3px 0 0;
  font-size: 12.5px;
  color: var(--muted);
}

.inbox .ibx {
  flex: 1;
  overflow: auto;
  padding: 2px 12px 14px;
}

.av {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  flex: none;
  box-shadow: inset 0 -3px 0 rgba(0, 0, 0, 0.12), inset 0 2px 0 rgba(255, 255, 255, 0.25);
}

.qi {
  all: unset;
  box-sizing: border-box;
  width: 100%;
  display: grid;
  grid-template-columns: auto 22px minmax(0, 1fr);
  grid-template-areas: 'n av t' '. . m';
  gap: 2px 10px;
  align-items: center;
  padding: 11px 12px;
  margin-top: 10px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #fff;
  cursor: pointer;
}

.qi:hover {
  border-color: #cbd0d8;
}

.qi:focus-visible {
  outline: 2px solid var(--accent);
}

.qi.first {
  border-color: #f5c66b;
  background: var(--needs-bg);
}

.qi.stuck {
  border-color: #f2b8b5;
  background: #fff;
}

.qi .n {
  grid-area: n;
  font: 500 10px/1 var(--mono);
  color: var(--needs-ink);
  background: var(--needs-bg);
  border: 1px solid #f3d9a6;
  border-radius: 5px;
  padding: 2px 4px;
}

.qi .av {
  grid-area: av;
}

.qi .t {
  grid-area: t;
  font-size: 13.5px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qi .m {
  grid-area: m;
  font: 11px var(--mono);
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.inbox .dh {
  padding: 14px 12px 10px 16px;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  border-bottom: 1px solid var(--line);
}

.inbox .dh .av {
  width: 34px;
  height: 34px;
}

.inbox .dh .meta {
  margin: 2px 0 0;
}

.ib {
  all: unset;
  cursor: pointer;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  color: var(--muted);
  font-size: 18px;
}

.ib:hover {
  color: var(--ink);
  background: var(--soft);
}

.ib:focus-visible {
  outline: 2px solid var(--accent);
}

.doing {
  margin: 14px 16px;
  font: 12px var(--mono);
  color: var(--muted);
}

.doing.working,
.pd.working {
  color: var(--accent);
}

.doing.needs,
.pd.needs {
  color: var(--needs-ink);
}

.doing.stuck,
.pd.stuck {
  color: var(--danger);
}

.doing.done,
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

.pr:hover,
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
  .sign {
    transition: none;
  }
}
</style>
