<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import type { ChatView } from '../../../shared/chat'
import type { PendingRequestView } from '../../../shared/permissions'
import { modeLabels } from './cards'
import { drafts, submit } from './draft'
import SlashInput from './SlashInput.vue'

const props = defineProps<{ chat: ChatView; waiting?: PendingRequestView }>()
const emit = defineEmits<{ accounts: [] }>()

const store = drafts()
const text = ref('')
const error = ref('')
const needsLogin = ref(false)
const sending = ref(false)
const slash = ref<InstanceType<typeof SlashInput>>()
const mode = computed(() => props.chat.permissionMode ?? 'auto')
const busy = computed(() => ['starting', 'working', 'needs-you'].includes(props.chat.state))

watch(
  () => props.chat.id,
  async (chatId, previous) => {
    if (previous) void store.flush(previous)
    text.value = ''
    error.value = ''
    needsLogin.value = false
    const saved = await store.load(chatId)
    if (props.chat.id === chatId) text.value = saved
  },
  { immediate: true },
)
onUnmounted(() => void store.flush())

const togglePlan = () => window.office.setPlanMode(props.chat.id, mode.value !== 'plan')
const stop = () => window.office.interruptChat(props.chat.id)
const loadCommands = () => window.office.getCommands({ chatId: props.chat.id })

function edit(value: string) {
  text.value = value
  store.set(props.chat.id, value)
}

async function send() {
  const chatId = props.chat.id
  const body = text.value.trim()
  if (!body || sending.value) return
  sending.value = true
  const outcome = await submit(window.office, chatId, body, props.waiting).finally(() => (sending.value = false))
  if (!outcome.sent) {
    error.value = outcome.error
    needsLogin.value = outcome.needsLogin
    return
  }
  error.value = ''
  needsLogin.value = false
  store.set(chatId, '')
  void store.flush(chatId)
  if (props.chat.id === chatId) text.value = ''
}
</script>

<template>
  <div class="comp">
    <p v-if="waiting" class="denynote">Sending now denies the waiting request and tells Claude what to do instead.</p>
    <SlashInput
      ref="slash"
      :key="chat.id"
      :model-value="text"
      :load="loadCommands"
      rows="3"
      aria-label="Message"
      :placeholder="waiting ? 'Tell Claude what to do instead…' : `Reply to ${chat.title}… (/ for commands)`"
      @update:model-value="edit"
      @blur="store.flush(chat.id)"
      @keydown.meta.enter.prevent="send"
    />
    <div v-if="error" class="cerr" role="alert">
      <span>{{ error }}</span>
      <button v-if="needsLogin" type="button" class="btn sm" @click="emit('accounts')">Re-login</button>
    </div>
    <div class="crow">
      <span :class="['mode', mode]" :title="mode === 'auto' ? 'Auto mode asks you only before risky actions' : undefined">{{ modeLabels[mode] }}</span>
      <button type="button" class="btn sm" title="Commands & skills" @click="slash?.browse()">/ Commands</button>
      <button type="button" class="btn sm" :aria-pressed="mode === 'plan'" title="Plan first: Claude proposes a plan and waits for your approval before editing" @click="togglePlan">Plan</button>
      <span class="sp" />
      <button v-if="busy" type="button" class="btn sm" title="Stop this turn" @click="stop">Stop</button>
      <button type="button" class="btn accent" :disabled="!text.trim() || sending" @click="send">{{ waiting ? 'Deny and send' : 'Send' }} <kbd>⌘↵</kbd></button>
    </div>
  </div>
</template>

<style>
.comp .denynote {
  margin: 0;
  font-size: 12px;
  color: var(--needs-ink);
}

.comp .cerr {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  font-size: 12.5px;
  color: var(--danger);
}

.comp .mode {
  font: 500 11px var(--mono);
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 6px;
  padding: 3px 7px;
}

.comp .mode.plan {
  color: var(--needs-ink);
  background: var(--needs-bg);
}

.comp .btn[aria-pressed='true'] {
  background: var(--ink);
  border-color: var(--ink);
  color: #fff;
}
</style>
