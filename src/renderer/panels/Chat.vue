<script setup lang="ts">
import { computed, nextTick, onUnmounted, reactive, ref, shallowReactive, watch } from 'vue'
import { defaultModel, effortLabels, efforts, modelLabels, simulatorOf, usingSimulator, type ChatView, type Effort } from '../../shared/chat'
import { canRest } from '../office/standby'
import { hasNewArtifact, sawArtifacts } from '../state/artifacts'
import { runsIn } from '../../shared/housekeeping'
import type { Decision, PendingRequestView } from '../../shared/permissions'
import type { AgentEntry } from '../office/world'
import type { WaitingItem } from '../state/inbox'
import ArtifactCard from './chat/ArtifactCard.vue'
import { answeredElsewhere } from './chat/cards'
import { latestArtifacts } from './chat/rows'
import Composer from './chat/Composer.vue'
import PlanCard from './chat/PlanCard.vue'
import QuestionCard from './chat/QuestionCard.vue'
import RequestCard from './chat/RequestCard.vue'
import ShipIt from './chat/ShipIt.vue'
import Simulator from './chat/Simulator.vue'
import SubagentStrip from './chat/SubagentStrip.vue'
import Transcript from './chat/Transcript.vue'
import Review from './Review.vue'

const props = defineProps<{ agent: AgentEntry; chat?: ChatView; queue: WaitingItem[]; canSwitch?: boolean; removable?: boolean }>()
const emit = defineEmits<{ select: [chatId: string | undefined]; accounts: []; continue: [chatId: string]; lounge: [chatId: string]; saw: []; finish: [chatIds: string[], withTrees?: boolean] }>()

const tab = ref<'chat' | 'review' | 'simulator' | 'artifacts'>('chat')
const flash = ref('')
const moving = ref(false)
const naming = ref<string>()
const nameInput = ref<HTMLInputElement>()
const seen = shallowReactive(new Map<string, PendingRequestView>())
const dismissed = reactive(new Set<string>())
let flashTimer: ReturnType<typeof setTimeout> | undefined

const waiting = computed(() => [...new Set(props.queue.flatMap((item) => (item.chatId ? [item.chatId] : [])))])
const at = computed(() => waiting.value.indexOf(props.agent.id))
const device = computed(() => (props.chat ? simulatorOf(props.chat.rows) : undefined))
const published = computed(() => (props.chat ? latestArtifacts(props.chat.rows) : []))
const pending = computed(() => props.chat?.pendingRequests ?? [])
const elsewhere = computed(() => answeredElsewhere(seen, pending.value, props.chat?.answered).filter((card) => !dismissed.has(card.request.id)))
const models = computed(() => {
  const current = props.chat?.model
  return current && !(current in modelLabels) ? [current, ...Object.keys(modelLabels)] : Object.keys(modelLabels)
})

function say(message: string) {
  flash.value = message
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => (flash.value = ''), 4000)
}

function step(delta: number) {
  const next = waiting.value[at.value + delta]
  if (next) emit('select', next)
}

async function decide(request: PendingRequestView, decision: Decision) {
  const result = await window.office.resolveRequest(request.id, decision, 'chat')
  if ('error' in result) say(result.error)
  else if (request.tool === 'AskUserQuestion') emit('select', undefined)
}

async function openInTerminal() {
  if (!props.chat) return
  const result = await window.office.openInTerminal(props.chat.id)
  if (result?.error) say(result.error)
}

async function openInDesktop() {
  if (!props.chat) return
  const result = await window.office.openInDesktop(props.chat.id)
  if (result?.error) say(result.error)
}

async function move() {
  if (!props.chat) return
  moving.value = true
  const result = await window.office.moveIntoOffice(props.chat.id).finally(() => (moving.value = false))
  if (result && 'error' in result) say(result.error)
  else if (result) emit('select', result.chatId)
}

async function resume() {
  if (!props.chat) return
  const refused = await window.office.resumeChat(props.chat.id)
  if (refused) say(refused.error)
}

async function rename() {
  if (!props.chat || props.chat.visitor) return
  naming.value = props.chat.title
  await nextTick()
  nameInput.value?.select()
}

function saveName() {
  const title = naming.value?.trim()
  naming.value = undefined
  if (props.chat && title && title !== props.chat.title) void window.office.renameChat(props.chat.id, title)
}

function setModel(event: Event) {
  const model = (event.target as HTMLSelectElement).value
  if (props.chat && model) void window.office.setModel(props.chat.id, model)
}

function setEffort(effort: Effort) {
  if (!props.chat) return
  void window.office.setEffort(props.chat.id, effort)
  say(`${effortLabels[effort]} effort applies from the next turn.`)
}

function setLimit(key: 'turns' | 'costUsd', event: Event) {
  if (!props.chat) return
  void window.office.setLimits(props.chat.id, { ...props.chat.limits, [key]: Number((event.target as HTMLInputElement).value) })
}

watch(
  () => props.agent.id,
  (chatId) => {
    seen.clear()
    dismissed.clear()
    tab.value = props.chat && usingSimulator(props.chat) ? 'simulator' : props.chat && hasNewArtifact(props.chat) ? 'artifacts' : 'chat'
    flash.value = ''
    naming.value = undefined
    void window.office.setOpenChat(chatId)
  },
  { immediate: true },
)
watch(
  () => tab.value === 'artifacts' && props.chat,
  (chat) => {
    if (chat && sawArtifacts(chat)) emit('saw')
  },
  { immediate: true },
)
watch(
  pending,
  (list) => {
    for (const request of list) if (!seen.has(request.id)) seen.set(request.id, request)
  },
  { immediate: true },
)
onUnmounted(() => {
  clearTimeout(flashTimer)
  void window.office.setOpenChat()
})
</script>

<template>
  <div class="chatp">
    <nav v-if="waiting.length" class="qstrip" aria-label="Waiting chats">
      <button type="button" class="ib" aria-label="Previous waiting chat" :disabled="at <= 0" @click="step(-1)">‹</button>
      <span>{{ at >= 0 ? `Waiting for you · ${at + 1} of ${waiting.length}` : `Waiting for you · ${waiting.length}` }}</span>
      <button type="button" class="ib" aria-label="Next waiting chat" :disabled="at >= waiting.length - 1" @click="step(1)">›</button>
    </nav>
    <div class="dh">
      <span class="av" :style="{ background: agent.colour }" />
      <div>
        <input v-if="naming !== undefined" ref="nameInput" v-model="naming" class="rename" maxlength="60" aria-label="Chat name" @keydown.enter.prevent="saveName" @keydown.esc.stop="naming = undefined" @blur="saveName" />
        <h2 v-else :class="{ named: chat && !chat.visitor }" :title="chat && !chat.visitor ? 'Rename' : undefined" @click="rename">{{ chat?.title ?? agent.title }}</h2>
        <p class="meta">{{ agent.dept }}<template v-if="chat"> · {{ chat.cwd.split('/').pop() }}</template><span v-if="chat?.visitor" class="vb">Visitor</span></p>
      </div>
      <div class="hact">
        <button v-if="chat?.sessionId" type="button" class="btn sm" title="Resumes this session in a terminal, on its own account. The office chat is untouched." @click="openInTerminal">Open in terminal</button>
        <button v-if="chat?.visitor === 'desktop'" type="button" class="btn sm" title="Focuses the right Claude desktop window. It can't jump to this exact chat yet." @click="openInDesktop">Open in Claude desktop</button>
        <template v-if="chat && chat.finished === undefined && !chat.archived">
          <button v-if="canRest(chat.state)" type="button" class="btn sm" title="Move to the lounge, keeping its desk" @click="emit('lounge', chat.id)">Lounge</button>
          <button type="button" class="btn sm" title="Finish: clear the desk and move the chat to Finished" @click="emit('finish', [chat.id])">Done</button>
          <button v-if="removable" type="button" class="btn sm" title="Finish and remove its worktree, which is safe to remove" @click="emit('finish', [chat.id], true)">Done + worktree</button>
        </template>
        <button type="button" class="ib" aria-label="Back to inbox" title="Back to inbox (Esc)" @click="emit('select', undefined)">×</button>
      </div>
    </div>
    <div v-if="chat?.visitor" class="visit" role="status">
      <p>{{ chat.moved ? 'Moved into the office. This original stays read-only.' : `Read-only. It runs in ${runsIn(chat)}.` }}</p>
      <button v-if="!chat.moved" type="button" class="btn primary sm" :disabled="moving" @click="move">Move into the office</button>
    </div>
    <ShipIt v-else-if="chat" :chat="chat" />
    <div class="ctl">
      <div class="tabs" role="tablist" aria-label="Chat views">
        <button type="button" role="tab" :aria-selected="tab === 'chat'" @click="tab = 'chat'">Chat</button>
        <button type="button" role="tab" :aria-selected="tab === 'review'" @click="tab = 'review'">Review</button>
        <button v-if="device" type="button" role="tab" :aria-selected="tab === 'simulator'" @click="tab = 'simulator'">Simulator</button>
        <button v-if="published.length" type="button" role="tab" :aria-selected="tab === 'artifacts'" @click="tab = 'artifacts'">Artifacts · {{ published.length }}</button>
      </div>
      <select v-if="chat && !chat.visitor" aria-label="Model" :value="chat.model || defaultModel" @change="setModel">
        <option v-for="model in models" :key="model" :value="model">{{ modelLabels[model] ?? model }}</option>
      </select>
    </div>
    <div v-if="chat && !chat.visitor" class="effort" role="radiogroup" aria-label="Effort" title="Effort applies from the next turn">
      <span class="lbl">Effort</span>
      <button v-for="effort in efforts" :key="effort" type="button" role="radio" :aria-checked="chat.effort === effort" @click="setEffort(effort)">{{ effortLabels[effort] }}</button>
    </div>
    <div v-if="chat && !chat.visitor" class="effort limits" title="Stops the agent and waits for you when a run goes past this without your reply. Blank uses the default from Settings.">
      <span class="lbl">Limits</span>
      <input type="number" min="1" step="1" placeholder="–" aria-label="Turn limit" :value="chat.limits?.turns" @change="setLimit('turns', $event)" /><span class="lbl">turns</span>
      <input type="number" min="0" step="0.5" placeholder="–" aria-label="Cost limit in dollars" :value="chat.limits?.costUsd" @change="setLimit('costUsd', $event)" /><span class="lbl">$</span>
    </div>
    <p :class="['doing', agent.state]">{{ agent.caption }}</p>
    <SubagentStrip v-if="chat" :chat="chat" />
    <template v-if="tab === 'chat'">
      <Transcript v-if="chat" :chat="chat" :can-switch="canSwitch" @resume="resume" @relogin="emit('accounts')" @continue="emit('continue', chat.id)" />
    </template>
    <Simulator v-else-if="tab === 'simulator' && device" :key="device" :device="device" />
    <Review v-else-if="tab === 'review' && chat" :chat="chat" />
    <div v-else-if="tab === 'artifacts'" class="arts">
      <ArtifactCard v-for="artifact in published" :key="artifact.url" :artifact="artifact" />
    </div>
    <div v-if="chat && (pending.length || elsewhere.length)" class="cards">
      <template v-for="(request, index) in pending" :key="request.id">
        <PlanCard v-if="request.tool === 'ExitPlanMode'" :request="request" :first="index === 0" @decide="decide(request, $event)" />
        <QuestionCard v-else-if="request.tool === 'AskUserQuestion'" :request="request" :first="index === 0" @decide="decide(request, $event)" />
        <RequestCard v-else :request="request" :first="index === 0" :cwd="chat.cwd" @decide="decide(request, $event)" />
      </template>
      <section v-for="card in elsewhere" :key="card.request.id" class="ask answered" role="status">
        <div class="ah">
          <span class="ai" aria-hidden="true">✓</span>
          <div>
            <div class="q">{{ card.label }}</div>
            <div class="qs">{{ card.request.tool }} · {{ card.request.summary }}</div>
          </div>
          <button type="button" class="ib" aria-label="Dismiss" @click="dismissed.add(card.request.id)">×</button>
        </div>
      </section>
    </div>
    <p v-if="flash" class="flash" role="status">{{ flash }}</p>
    <Composer v-if="chat && !chat.visitor" :chat="chat" :waiting="pending[0]" @accounts="emit('accounts')" />
  </div>
</template>

<style>
.chatp {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.chatp h2.named {
  cursor: text;
}

.chatp .rename {
  box-sizing: border-box;
  width: 100%;
  margin: 0;
  padding: 0 4px;
  font: 600 15px Geist, system-ui, sans-serif;
  letter-spacing: -0.01em;
  color: var(--ink);
  border: 1px solid var(--line);
  border-radius: 6px;
  outline: none;
}

.chatp .hact {
  display: flex;
  gap: 6px;
  align-items: center;
}

.chatp .qstrip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 8px;
  background: var(--needs-bg);
  border-bottom: 1px solid #f3d9a6;
  font: 11.5px var(--mono);
  color: var(--needs-ink);
}

.chatp .qstrip .ib {
  width: 26px;
  height: 26px;
}

.chatp .qstrip .ib:disabled {
  opacity: 0.35;
  cursor: default;
}

.chatp .ctl {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 16px 0;
}

.chatp .tabs {
  display: flex;
  gap: 2px;
  background: var(--soft);
  border-radius: 9px;
  padding: 2px;
}

.chatp .tabs button,
.chatp .effort button {
  all: unset;
  cursor: pointer;
  font: 500 12px Geist, system-ui, sans-serif;
  color: var(--muted);
  padding: 4px 10px;
  border-radius: 7px;
}

.chatp .tabs button[aria-selected='true'] {
  background: #fff;
  color: var(--ink);
  box-shadow: 0 1px 2px rgba(17, 24, 39, 0.08);
}

.chatp .tabs button:focus-visible,
.chatp .effort button:focus-visible {
  outline: 2px solid var(--accent);
}

.chatp .ctl select {
  font: 12px Geist, system-ui, sans-serif;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 4px 6px;
  background: #fff;
  color: var(--ink);
  max-width: 50%;
}

.chatp .effort {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  padding: 6px 16px 0;
}

.chatp .effort .lbl {
  font: 11px var(--mono);
  color: var(--faint);
  margin-right: 4px;
}

.chatp .effort button {
  font-size: 11.5px;
  padding: 3px 7px;
}

.chatp .effort button[aria-checked='true'] {
  background: var(--accent-soft);
  color: var(--accent);
}

.chatp .limits input {
  width: 44px;
  margin-right: 4px;
  font: 11px var(--mono);
  color: var(--ink);
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 2px 4px;
  background: #fff;
}

.chatp .vb {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--soft);
  font: 10.5px var(--mono);
  color: var(--muted);
}

.chatp .visit {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 8px 16px 0;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--soft);
}

.chatp .visit p {
  flex: 1;
  margin: 0;
  font-size: 12.5px;
  color: var(--muted);
}

.chatp .doing {
  margin: 8px 16px 0;
}

.chatp .arts {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 16px;
  display: grid;
  align-content: start;
  gap: 10px;
}

.chatp .cards {
  flex: none;
  max-height: 48%;
  overflow: auto;
  padding: 10px 16px 0;
  display: grid;
  gap: 10px;
  border-top: 1px solid var(--line);
}

.chatp .ask.answered {
  border-color: var(--line);
  background: var(--soft);
}

.chatp .ask.answered .ai {
  background: var(--ok);
  color: #fff;
}

.chatp .ask.answered .ah > div {
  flex: 1;
}

.chatp .ask.answered .qs {
  color: var(--muted);
}
</style>
