<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { ChatRow, ChatView } from '../../../shared/chat'
import { items, type AgentItem } from './groups'
import { Markdown } from './markdown'
import { plainLabel, toolTarget } from './rows'
import { agentOutcome, agentStats, findAgent, statusLabels } from './subagents'
import Subagent from './Subagent.vue'
import ToolGroup from './ToolGroup.vue'

const props = defineProps<{ chat: ChatView; item: AgentItem }>()
const emit = defineEmits<{ close: [] }>()

const fetched = ref<ChatRow[]>([])
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined
onMounted(() => (clock = setInterval(() => (now.value = Date.now()), 1000)))
onUnmounted(() => clearInterval(clock))

const current = computed(() => findAgent(items(props.chat.rows), props.item.row.id) ?? props.item)
const running = computed(() => new Set(props.chat.subagents.map((agent) => agent.id)))
const live = computed(() => props.chat.subagents.find((agent) => agent.id === props.item.row.id))
const outcome = computed(() => agentOutcome(current.value, running.value, current.value.note))
const title = computed(() => toolTarget(current.value.row) || 'Subagent')
const prompt = computed(() => {
  const value = (current.value.row.input as { prompt?: unknown } | undefined)?.prompt
  return typeof value === 'string' ? value : ''
})
const stats = computed(() => {
  const agent = live.value
  if (agent && outcome.value.status === 'running') return agentStats({ ...agent, ms: now.value - agent.startedAt })
  const agentType = (current.value.row.input as { subagent_type?: unknown } | undefined)?.subagent_type
  return agentStats({ ...outcome.value, ...(typeof agentType === 'string' ? { agentType } : {}) })
})
const steps = computed(() => {
  const loaded = items(fetched.value.filter((row) => !(row.kind === 'user' && row.text === prompt.value)))
  return loaded.length > current.value.items.length ? loaded : current.value.items
})

async function load() {
  const { agentId } = outcome.value
  if (!agentId) return
  const chatId = props.chat.id
  const rows = await window.office.subagentRows(chatId, agentId)
  if (props.chat.id === chatId) fetched.value = rows
}

const stop = () => window.office.stopTask(props.chat.id, props.item.row.id)
function onKey(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  emit('close')
}

watch(() => [outcome.value.agentId, outcome.value.status], load, { immediate: true })
onMounted(() => addEventListener('keydown', onKey, true))
onUnmounted(() => removeEventListener('keydown', onKey, true))
</script>

<template>
  <section class="sav" :aria-label="`Subagent: ${title}`">
    <header :class="['savh', outcome.status]">
      <button type="button" class="btn sm" @click="emit('close')">← Chat</button>
      <span class="dot" />
      <span class="savt">
        <b>{{ title }}</b>
        <small>{{ [stats, outcome.status === 'running' ? '' : statusLabels[outcome.status]].filter(Boolean).join(' · ') }}</small>
      </span>
      <button v-if="outcome.status === 'running'" type="button" class="btn sm" :aria-label="`Stop ${title}`" title="Stop this subagent only" @click="stop">Stop</button>
    </header>
    <div class="ts" role="log" :aria-label="`${title} transcript`">
      <div v-if="prompt" class="uw">
        <div class="ur">{{ prompt }}</div>
      </div>
      <template v-for="step in steps" :key="step.kind === 'group' ? `g:${step.id}` : step.row.id">
        <ToolGroup v-if="step.kind === 'group'" :rows="step.rows" :summary="step.summary" />
        <Subagent v-else-if="step.kind === 'agent'" :item="step" :running="running" />
        <div v-else-if="step.kind === 'row' && step.row.kind === 'user'" class="uw">
          <div class="ur">{{ step.row.text }}</div>
        </div>
        <Markdown v-else-if="step.kind === 'row' && step.row.kind === 'text'" class="ar" :source="step.row.text" />
        <p v-else-if="step.kind === 'row'" class="or">{{ plainLabel(step.row) }}</p>
      </template>
      <p v-if="!steps.length && outcome.status === 'running'" class="or">No steps yet</p>
      <template v-if="outcome.report && outcome.status !== 'running'">
        <p class="or">Report</p>
        <Markdown class="ar" :source="outcome.report" />
      </template>
    </div>
  </section>
</template>

<style>
.sav {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.savh {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 18px;
  border-bottom: 1px solid var(--line2);
  min-width: 0;
}

.savh .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  flex: none;
}

.savh.done .dot {
  background: var(--ok);
}

.savh.failed .dot {
  background: var(--danger);
}

.savh.stopped .dot {
  background: var(--faint);
}

.savt {
  display: grid;
  min-width: 0;
  flex: 1;
}

.savt b {
  font-weight: 500;
  font-size: 13.5px;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.savt small {
  font: 11px var(--mono);
  color: var(--faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
