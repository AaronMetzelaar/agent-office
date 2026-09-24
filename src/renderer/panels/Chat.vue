<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, shallowReactive, watch } from 'vue'
import { effortLabels, efforts, type ChatView, type Effort } from '../../shared/chat'
import type { Decision, PendingRequestView } from '../../shared/permissions'
import type { AgentEntry } from '../office/world'
import type { WaitingItem } from '../state/inbox'
import { answeredElsewhere } from './chat/cards'
import Composer from './chat/Composer.vue'
import PlanCard from './chat/PlanCard.vue'
import QuestionCard from './chat/QuestionCard.vue'
import RequestCard from './chat/RequestCard.vue'
import ShipIt from './chat/ShipIt.vue'
import Transcript from './chat/Transcript.vue'
import Review from './Review.vue'

const props = defineProps<{ agent: AgentEntry; chat?: ChatView; queue: WaitingItem[]; canSwitch?: boolean }>()
const emit = defineEmits<{ select: [chatId: string | undefined]; accounts: []; continue: [chatId: string] }>()

const aliases = ['opus', 'sonnet', 'haiku']
const tab = ref<'chat' | 'review'>('chat')
const flash = ref('')
const moving = ref(false)
const seen = shallowReactive(new Map<string, PendingRequestView>())
const dismissed = reactive(new Set<string>())
let flashTimer: ReturnType<typeof setTimeout> | undefined

const waiting = computed(() => [...new Set(props.queue.flatMap((item) => (item.chatId ? [item.chatId] : [])))])
const at = computed(() => waiting.value.indexOf(props.agent.id))
const pending = computed(() => props.chat?.pendingRequests ?? [])
const elsewhere = computed(() => answeredElsewhere(seen, pending.value, props.chat?.answered).filter((card) => !dismissed.has(card.request.id)))
const models = computed(() => {
  const current = props.chat?.model
  return current && !aliases.includes(current) ? [current, ...aliases] : aliases
})
const visitorFrom = computed(() => (props.chat?.visitor === 'terminal' ? 'a terminal' : 'the desktop app'))
const modelLabel = (model: string) => (aliases.includes(model) ? model[0]!.toUpperCase() + model.slice(1) : model)

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

function setModel(event: Event) {
  const model = (event.target as HTMLSelectElement).value
  if (props.chat && model) void window.office.setModel(props.chat.id, model)
}

function setEffort(effort: Effort) {
  if (!props.chat) return
  void window.office.setEffort(props.chat.id, effort)
  say(`${effortLabels[effort]} effort applies from the next turn.`)
}

watch(
  () => props.agent.id,
  (chatId) => {
    seen.clear()
    dismissed.clear()
    tab.value = 'chat'
    flash.value = ''
    void window.office.setOpenChat(chatId)
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
        <h2>{{ agent.title }}</h2>
        <p class="meta">{{ agent.dept }}<template v-if="chat"> · {{ chat.cwd.split('/').pop() }}</template><span v-if="chat?.visitor" class="vb">Visitor</span></p>
      </div>
      <button type="button" class="ib" aria-label="Back to inbox" title="Back to inbox (Esc)" @click="emit('select', undefined)">×</button>
    </div>
    <div v-if="chat?.visitor" class="visit" role="status">
      <p>{{ chat.moved ? 'Moved into the office. This original stays read-only.' : `Read-only. It runs in ${visitorFrom}.` }}</p>
      <button v-if="!chat.moved" type="button" class="btn primary sm" :disabled="moving" @click="move">Move into the office</button>
    </div>
    <ShipIt v-else-if="chat" :chat="chat" />
    <div class="ctl">
      <div class="tabs" role="tablist" aria-label="Chat views">
        <button type="button" role="tab" :aria-selected="tab === 'chat'" @click="tab = 'chat'">Chat</button>
        <button type="button" role="tab" :aria-selected="tab === 'review'" @click="tab = 'review'">Review</button>
      </div>
      <select v-if="chat && !chat.visitor" aria-label="Model" :value="chat.model ?? ''" @change="setModel">
        <option v-if="!chat.model" value="">Default model</option>
        <option v-for="model in models" :key="model" :value="model">{{ modelLabel(model) }}</option>
      </select>
    </div>
    <div v-if="chat && !chat.visitor" class="effort" role="radiogroup" aria-label="Effort" title="Effort applies from the next turn">
      <span class="lbl">Effort</span>
      <button v-for="effort in efforts" :key="effort" type="button" role="radio" :aria-checked="chat.effort === effort" @click="setEffort(effort)">{{ effortLabels[effort] }}</button>
    </div>
    <p :class="['doing', agent.state]">{{ agent.caption }}</p>
    <template v-if="tab === 'chat'">
      <Transcript v-if="chat" :chat="chat" :can-switch="canSwitch" @resume="resume" @relogin="emit('accounts')" @continue="emit('continue', chat.id)" />
    </template>
    <Review v-else-if="chat" :chat="chat" />
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
  margin: 0;
  font-size: 12.5px;
  color: var(--muted);
}

.chatp .doing {
  margin: 8px 16px 0;
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
