<script setup lang="ts">
import { computed, onUnmounted, ref, toRaw, watch } from 'vue'
import type { Attachment, ChatView } from '../../../shared/chat'
import type { PendingRequestView } from '../../../shared/permissions'
import { modeLabels } from './cards'
import { drafts, submit, toAttachment } from './draft'
import SlashInput from './SlashInput.vue'

const props = defineProps<{ chat: ChatView; waiting?: PendingRequestView }>()
const emit = defineEmits<{ accounts: [] }>()

const store = drafts()
const text = ref('')
const error = ref('')
const needsLogin = ref(false)
const sending = ref(false)
const slash = ref<InstanceType<typeof SlashInput>>()
const picker = ref<HTMLInputElement>()
const attachments = ref<Attachment[]>([])
const mode = computed(() => props.chat.permissionMode ?? 'auto')
const busy = computed(() => ['starting', 'working', 'needs-you'].includes(props.chat.state))
const suggestion = computed(() => (props.waiting ? undefined : props.chat.suggestion))

watch(
  () => props.chat.id,
  async (chatId, previous) => {
    if (previous) void store.flush(previous)
    text.value = ''
    attachments.value = []
    error.value = ''
    needsLogin.value = false
    const saved = await store.load(chatId)
    if (props.chat.id === chatId) text.value = saved
  },
  { immediate: true },
)
onUnmounted(() => void store.flush())
watch(slash, (input) => props.waiting || input?.focus(), { flush: 'post' })

const togglePlan = () => window.office.setPlanMode(props.chat.id, mode.value !== 'plan')
const stop = () => window.office.interruptChat(props.chat.id)
const loadCommands = () => window.office.getCommands({ chatId: props.chat.id })

function edit(value: string) {
  text.value = value
  store.set(props.chat.id, value)
}

function acceptSuggestion(event: KeyboardEvent) {
  if (text.value || !suggestion.value) return
  event.preventDefault()
  edit(suggestion.value)
}

function enter(event: KeyboardEvent) {
  if (event.isComposing || slash.value?.picking) return
  event.preventDefault()
  void send()
}

async function attach(files: FileList | null | undefined) {
  if (!files?.length) return
  const chatId = props.chat.id
  const results = await Promise.all([...files].map((file) => toAttachment(file, window.office.pathForFile)))
  if (props.chat.id !== chatId) return
  attachments.value = [...attachments.value, ...results.filter((r): r is Attachment => typeof r !== 'string')]
  error.value = results.filter((r): r is string => typeof r === 'string').join(' · ')
}

function paste(event: ClipboardEvent) {
  if (!event.clipboardData?.files.length) return
  event.preventDefault()
  void attach(event.clipboardData.files)
}

function picked() {
  void attach(picker.value?.files)
  if (picker.value) picker.value.value = ''
}

const thumb = (a: Attachment) => (a.kind === 'image' ? `data:${a.mediaType};base64,${a.data}` : undefined)
const canSend = computed(() => !!text.value.trim() || (!props.waiting && attachments.value.length > 0))

async function send() {
  const chatId = props.chat.id
  const body = text.value.trim()
  if (!canSend.value || sending.value) return
  sending.value = true
  const sent = props.waiting ? [] : toRaw(attachments.value)
  const outcome = await submit(window.office, chatId, body, props.waiting, sent)
    .catch((failure: unknown) => ({ sent: false as const, error: `Couldn’t send: ${failure instanceof Error ? failure.message : String(failure)}`, needsLogin: false }))
    .finally(() => (sending.value = false))
  if (!outcome.sent) {
    error.value = outcome.error
    needsLogin.value = outcome.needsLogin
    return
  }
  error.value = ''
  needsLogin.value = false
  store.set(chatId, '')
  void store.flush(chatId)
  if (props.chat.id === chatId) {
    text.value = ''
    attachments.value = []
  }
}
</script>

<template>
  <div class="comp" @dragover.prevent @drop.prevent="attach($event.dataTransfer?.files)">
    <p v-if="waiting" class="denynote">Sending now denies the waiting request and tells Claude what to do instead.</p>
    <SlashInput
      ref="slash"
      :key="chat.id"
      :model-value="text"
      :load="loadCommands"
      rows="3"
      aria-label="Message"
      :placeholder="waiting ? 'Tell Claude what to do instead…' : suggestion ? `${suggestion}   (Tab to use)` : `Reply to ${chat.title}… (/ for commands)`"
      @update:model-value="edit"
      @blur="store.flush(chat.id)"
      @keydown.enter.exact="enter"
      @keydown.tab.exact="acceptSuggestion"
      @paste="paste"
    />
    <ul v-if="attachments.length && !waiting" class="atts">
      <li v-for="(a, i) in attachments" :key="i" :title="a.kind === 'file' ? a.path : a.name">
        <img v-if="thumb(a)" :src="thumb(a)" alt="" />
        <span>{{ a.name }}</span>
        <button type="button" :aria-label="`Remove ${a.name}`" @click="attachments.splice(i, 1)">×</button>
      </li>
    </ul>
    <div v-if="error" class="cerr" role="alert">
      <span>{{ error }}</span>
      <button v-if="needsLogin" type="button" class="btn sm" @click="emit('accounts')">Re-login</button>
    </div>
    <div class="crow">
      <span :class="['mode', mode]" :title="mode === 'auto' ? 'Auto mode asks you only before risky actions' : undefined">{{ modeLabels[mode] }}</span>
      <span v-if="chat.context" :class="['ctx', { full: chat.context.percent >= 80 }]" :title="`${chat.context.tokens.toLocaleString()} of ${chat.context.max.toLocaleString()} tokens in context`">Context {{ chat.context.percent }}%</span>
      <button type="button" class="btn sm" title="Commands & skills" @click="slash?.browse()">/ Commands</button>
      <button v-if="!waiting" type="button" class="btn sm" title="Attach files or images (or paste / drop them)" @click="picker?.click()">Attach</button>
      <input ref="picker" type="file" multiple hidden @change="picked" />
      <button type="button" class="btn sm" :aria-pressed="mode === 'plan'" title="Plan first: Claude proposes a plan and waits for your approval before editing" @click="togglePlan">Plan</button>
      <span class="sp" />
      <button v-if="busy" type="button" class="btn sm" title="Stop this turn" @click="stop">Stop</button>
      <button type="button" class="btn accent" :disabled="!canSend || sending" @click="send">{{ waiting ? 'Deny and send' : 'Send' }} <kbd>↵</kbd></button>
    </div>
  </div>
</template>

<style>
.comp .atts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.comp .atts li {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 220px;
  padding: 3px 4px 3px 8px;
  font: 500 11.5px var(--mono);
  background: var(--soft);
  border: 1px solid var(--line);
  border-radius: 6px;
}

.comp .atts img {
  width: 22px;
  height: 22px;
  margin-left: -4px;
  object-fit: cover;
  border-radius: 4px;
}

.comp .atts span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.comp .atts button {
  border: 0;
  background: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}

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

.comp .ctx {
  font: 11px var(--mono);
  color: var(--muted);
}

.comp .ctx.full {
  color: var(--needs-ink);
}

.comp .btn[aria-pressed='true'] {
  background: var(--ink);
  border-color: var(--ink);
  color: #fff;
}
</style>
