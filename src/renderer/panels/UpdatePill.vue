<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { AppUpdate } from '../../shared/ipc'

const props = defineProps<{ update: AppUpdate }>()

const noteFor = 6000
const headsUpFor = 10_000

const rootEl = ref<HTMLElement>()
const card = ref<'changes' | 'busy' | 'updated'>()
const now = ref(Date.now())
const noteShown = ref(false)
let clock: ReturnType<typeof setInterval> | undefined
let noteTimer: ReturnType<typeof setTimeout> | undefined

const u = computed(() => props.update)
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const secondsLeft = computed(() => Math.max(0, Math.ceil(((u.value.restartAt ?? 0) - now.value) / 1000)))
const headsUpLeft = computed(() => Math.min(1, Math.max(0, ((u.value.restartAt ?? 0) - now.value) / headsUpFor)))
const more = (count: number, shown: number) => (count > shown ? `and ${count - shown} more` : undefined)

// One state at a time, most urgent first. 'auto' waits out of sight until its heads-up starts.
const pill = computed(() => {
  const { stage, restart, restartAt, error, download, behind } = u.value
  if (stage === 'installing') return 'installing'
  if (restartAt !== undefined) return 'headsUp'
  if (restart === 'now') return 'preparing'
  if (restart === 'asked') return 'asked'
  if (restart === 'auto') return undefined
  if (stage === 'ready') return 'ready'
  if (error) return 'failed'
  if (download && behind) return 'download'
  return undefined
})

watch(pill, (next) => {
  if (next !== 'ready' && next !== 'failed') card.value = card.value === 'updated' ? 'updated' : undefined
})

watch(
  () => u.value.restartAt,
  (restartAt) => {
    clearInterval(clock)
    if (restartAt === undefined) return
    now.value = Date.now()
    clock = setInterval(() => (now.value = Date.now()), 100)
  },
  { immediate: true },
)

async function restart(when?: 'now' | 'whenIdle') {
  if ((await window.office.installAppUpdate(when)) === 'busy') card.value = 'busy'
  else card.value = undefined
}

const cancel = () => window.office.cancelAppUpdate()
const openLog = () => window.office.openUpdateLog()

function toggle(which: 'changes' | 'updated') {
  card.value = card.value === which ? undefined : which
}

// The "Updated to" note fades on its own, but only once the window is on screen, and not while its card is open.
function startNote() {
  if (!u.value.updated || noteShown.value || document.visibilityState !== 'visible') return
  noteShown.value = true
  noteTimer = setTimeout(hideNote, noteFor)
}

function hideNote() {
  if (card.value === 'updated') return
  noteShown.value = false
  noteTimer = undefined
}

watch(() => u.value.updated, startNote)
watch(card, (next, previous) => {
  if (previous === 'updated' && next !== 'updated' && noteTimer) {
    clearTimeout(noteTimer)
    noteTimer = setTimeout(hideNote, 2000)
  }
})

function outside(event: PointerEvent) {
  if (card.value && !rootEl.value?.contains(event.target as Node)) card.value = undefined
}

function escape(event: KeyboardEvent) {
  if (event.key === 'Escape' && card.value) card.value = undefined
}

onMounted(() => {
  startNote()
  document.addEventListener('visibilitychange', startNote)
  document.addEventListener('pointerdown', outside)
  document.addEventListener('keydown', escape)
})

onUnmounted(() => {
  clearInterval(clock)
  clearTimeout(noteTimer)
  document.removeEventListener('visibilitychange', startNote)
  document.removeEventListener('pointerdown', outside)
  document.removeEventListener('keydown', escape)
})
</script>

<template>
  <div v-if="pill || noteShown" ref="rootEl" class="upd">
    <div v-if="card === 'changes' || card === 'updated'" class="card" role="dialog" :aria-label="card === 'updated' ? 'What the update changed' : 'Update ready'">
      <template v-if="card === 'updated' && u.updated">
        <h3>Updated to {{ u.updated.commit }}</h3>
        <ul>
          <li v-for="subject in u.updated.subjects" :key="subject">{{ subject }}</li>
          <li v-if="more(u.updated.count, u.updated.subjects.length)" class="more">{{ more(u.updated.count, u.updated.subjects.length) }}</li>
        </ul>
      </template>
      <template v-else>
        <h3>{{ plural(u.behind, 'change') }} since your version</h3>
        <ul>
          <li v-for="subject in u.subjects" :key="subject">{{ subject }}</li>
          <li v-if="more(u.behind, u.subjects.length)" class="more">{{ more(u.behind, u.subjects.length) }}</li>
        </ul>
        <div class="row">
          <button type="button" class="btn sm ghost" @click="card = undefined">Later</button>
          <button type="button" class="btn sm accent" @click="restart()">Restart to update</button>
        </div>
      </template>
    </div>
    <div v-else-if="card === 'busy'" class="card" role="dialog" aria-label="Agents are working">
      <h3>Agents are working</h3>
      <p class="warn">Restarting now interrupts them. They come back as Stuck, with Resume.</p>
      <div class="row">
        <button type="button" class="btn sm" @click="restart('now')">Restart now</button>
        <button type="button" class="btn sm accent" @click="restart('whenIdle')">When they finish</button>
      </div>
    </div>

    <p v-if="noteShown && u.updated" class="pill dark" role="status">
      <span class="lead">Updated to {{ u.updated.commit }} <span class="n">· {{ plural(u.updated.count, 'change') }}</span></span>
      <button type="button" class="act" :aria-expanded="card === 'updated'" @click="toggle('updated')">What's new</button>
    </p>

    <p v-if="pill === 'ready'" class="pill">
      <button type="button" class="lead" :aria-expanded="card === 'changes'" title="See what changed" @click="toggle('changes')">
        <i class="dot" />Update ready <span class="n">· {{ plural(u.behind, 'change') }}</span>
      </button>
      <button type="button" class="act" @click="restart()">Restart</button>
    </p>
    <p v-else-if="pill === 'headsUp'" class="pill dark" role="status">
      <span class="lead"><i class="ring" :style="{ '--left': headsUpLeft }" />Restarting to update in {{ secondsLeft }}s</span>
      <button type="button" class="act" @click="cancel">Not now</button>
    </p>
    <p v-else-if="pill === 'asked'" class="pill" role="status">
      <span class="lead"><i class="dot" />Restarts when agents finish</span>
      <button type="button" class="act" @click="cancel">Cancel</button>
    </p>
    <p v-else-if="pill === 'preparing'" class="pill" role="status">
      <span class="lead"><i class="spin" />Getting the latest update ready…</span>
    </p>
    <p v-else-if="pill === 'installing'" class="pill" role="status">
      <span class="lead"><i class="spin" />Restarting…</span>
    </p>
    <p v-else-if="pill === 'failed'" class="pill failed" role="alert" :title="u.error">
      <span class="lead"><i class="dot" />Update failed</span>
      <button type="button" class="act" @click="restart()">Try again</button>
      <button type="button" class="act plain" @click="openLog">Log</button>
    </p>
    <p v-else-if="pill === 'download'" class="pill">
      <span class="lead"><i class="dot" />{{ u.subjects[0] }} is available</span>
      <button type="button" class="act" @click="restart()">Download</button>
    </p>
  </div>
</template>

<style scoped>
.upd {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.pill {
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  box-sizing: border-box;
  padding: 0 4px 0 11px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 999px;
  box-shadow: 0 1px 2px rgba(17, 24, 39, 0.06);
  font: 500 12px Geist, system-ui, sans-serif;
  color: var(--ink2);
  white-space: nowrap;
}

.pill:not(:has(.act)) {
  padding-right: 12px;
}

.lead {
  all: unset;
  display: inline-flex;
  align-items: center;
  white-space: pre;
  padding-right: 4px;
}

.lead > i {
  flex: none;
  margin-right: 8px;
}

button.lead {
  cursor: pointer;
}

button.lead:hover {
  color: var(--ink);
}

.n {
  color: var(--muted);
  font-weight: 400;
}

.act {
  all: unset;
  cursor: pointer;
  padding: 3px 9px;
  border-radius: 999px;
  color: var(--accent);
  background: var(--accent-soft);
  transition: background 0.15s;
}

.act:hover {
  background: #e0e5ff;
}

.act.plain {
  background: none;
  color: var(--muted);
}

.act.plain:hover {
  color: var(--ink);
}

.lead:focus-visible,
.act:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
}

.spin {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid var(--accent-soft);
  border-top-color: var(--accent);
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    rotate: 1turn;
  }
}

.dark {
  background: var(--ink);
  border-color: var(--ink);
  color: #fff;
  box-shadow: 0 4px 14px rgba(17, 24, 39, 0.18);
}

.dark .n {
  color: #aab0bd;
}

.dark .act {
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
}

.dark .act:hover {
  background: rgba(255, 255, 255, 0.24);
}

.ring {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: conic-gradient(#fff calc(var(--left) * 1turn), rgba(255, 255, 255, 0.2) 0);
  mask: radial-gradient(circle, transparent 4px, #000 4.5px);
}

.failed {
  color: var(--danger);
}

.failed .dot {
  background: var(--danger);
}

.card {
  position: absolute;
  left: 0;
  bottom: calc(100% + 8px);
  width: 320px;
  box-sizing: border-box;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(17, 24, 39, 0.14), 0 2px 6px rgba(17, 24, 39, 0.06);
  padding: 12px 14px;
}

.card h3 {
  font-size: 13px;
  font-weight: 600;
  margin: 0 0 6px;
}

.card ul {
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 12px;
  color: var(--ink2);
  display: grid;
  gap: 4px;
}

.card li {
  display: flex;
  gap: 8px;
}

.card li::before {
  content: '';
  flex: none;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--faint);
  margin-top: 8px;
}

.card li.more {
  color: var(--muted);
}

.card li.more::before {
  background: transparent;
}

.warn {
  font-size: 11.5px;
  color: var(--needs-ink);
  background: var(--needs-bg);
  border: 1px solid #f3c77a;
  border-radius: 8px;
  padding: 6px 9px;
  margin: 0;
}

.row {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
  margin-top: 10px;
}

.btn.ghost {
  border-color: transparent;
  background: none;
  color: var(--muted);
}

.btn.ghost:hover {
  color: var(--ink);
}
</style>
