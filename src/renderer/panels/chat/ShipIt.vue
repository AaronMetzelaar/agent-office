<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import type { ChatState, ChatView } from '../../../shared/chat'
import { summaryText } from '../../../shared/housekeeping'
import type { NextStep, ShipIt } from '../../../shared/workflow'
import { createRefresher, endedTurn } from '../review/refresh'

const props = defineProps<{ chat: ChatView }>()

const midTurn = new Set<ChatState>(['starting', 'working', 'needs-you'])
const ship = shallowRef<ShipIt>()
const confirming = ref(false)
const flash = ref('')

const busy = computed(() => midTurn.has(props.chat.state))
const shown = computed(() => !!ship.value && (!!ship.value.ticket || ship.value.steps.length > 0 || !!ship.value.waiting))

async function load() {
  const chatId = props.chat.id
  const loaded = await window.office.getShipIt(chatId).catch(() => undefined)
  if (chatId === props.chat.id) ship.value = loaded
}

const refresher = createRefresher(load)

async function run(step: NextStep) {
  flash.value = ''
  if (step.command) flash.value = (await window.office.sendMessage(props.chat.id, step.command))?.error ?? ''
  else if (step.id === 'cleanup') confirming.value = true
  else if (step.id === 'move-ticket') {
    const moved = await window.office.moveTicket(props.chat.id)
    flash.value = moved.error ?? (moved.status ? `Moved to ${moved.status}.` : '')
    if (moved.status) refresher.poke()
  }
}

async function cleanUp() {
  confirming.value = false
  const summary = await window.office.cleanUp([props.chat.id])
  flash.value = summary.skipped[0] ? `Not cleaned up: ${summary.skipped[0].reason}.` : summaryText(summary)
}

watch(
  () => props.chat.id,
  () => {
    ship.value = undefined
    confirming.value = false
    flash.value = ''
    void load()
  },
)
watch(
  () => props.chat.state,
  (after, before) => {
    if (endedTurn(before, after)) refresher.poke()
  },
)
onMounted(() => {
  void load()
  window.addEventListener('focus', refresher.poke)
})
onUnmounted(() => {
  refresher.stop()
  window.removeEventListener('focus', refresher.poke)
})
</script>

<template>
  <section v-if="shown || flash" class="ship" aria-label="Next steps">
    <p v-if="ship?.ticket" class="tk">
      <a v-if="ship.ticket.url" :href="ship.ticket.url" target="_blank" rel="noopener noreferrer">{{ ship.ticket.id }}</a>
      <b v-else>{{ ship.ticket.id }}</b>
      <span v-if="ship.ticket.title" class="tt">{{ ship.ticket.title }}</span>
      <span v-if="ship.ticket.status" class="st">{{ ship.ticket.status }}</span>
    </p>
    <div v-if="ship && (ship.steps.length || ship.waiting)" class="steps">
      <button v-for="step in ship.steps" :key="step.id" type="button" class="btn sm" :disabled="busy" :title="step.command ? `Sends ${step.command} to this chat` : undefined" @click="run(step)">{{ step.label }}</button>
      <span v-if="ship.waiting" class="wait">{{ ship.waiting }}</span>
    </div>
    <div v-if="confirming" class="confirm" role="group" aria-label="Confirm cleanup">
      <span>Archive this chat, stop its processes and remove its worktree if it’s safe?</span>
      <button type="button" class="btn sm accent" @click="cleanUp">Clean up</button>
      <button type="button" class="btn sm" @click="confirming = false">Cancel</button>
    </div>
    <p v-if="shown && ship?.notice" class="note">{{ ship.notice }}</p>
    <p v-if="flash" class="note" role="status">{{ flash }}</p>
  </section>
</template>

<style scoped>
.ship {
  margin: 8px 16px 0;
  display: grid;
  gap: 6px;
}

.tk {
  margin: 0;
  display: flex;
  align-items: baseline;
  gap: 7px;
  min-width: 0;
  font-size: 12px;
  color: var(--muted);
}

.tk a,
.tk b {
  font: 600 11.5px var(--mono);
  color: var(--accent);
  text-decoration: none;
  white-space: nowrap;
}

.tk .tt {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tk .st {
  font: 500 10.5px var(--mono);
  padding: 1px 7px;
  border-radius: 99px;
  background: var(--soft);
  white-space: nowrap;
}

.steps,
.confirm {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.wait {
  font: 11px var(--mono);
  color: var(--muted);
}

.confirm {
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--needs-bg);
  color: var(--needs-ink);
  font-size: 12px;
}

.note {
  margin: 0;
  font: 11px var(--mono);
  color: var(--muted);
}
</style>
