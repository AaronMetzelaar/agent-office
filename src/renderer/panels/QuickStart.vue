<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { efforts, type Effort } from '../../shared/chat'
import type { AccountView } from '../../shared/ipc'
import { isResearch } from '../../shared/office'

const props = defineProps<{ accounts: AccountView[] }>()
const emit = defineEmits<{ close: []; started: [chatId: string] }>()

const effortLabels: Record<Effort, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }
const folders = ref<string[]>([])
const promptEl = ref<HTMLTextAreaElement>()
const form = reactive({ folder: '', accountId: '', prompt: '', model: '', effort: '' as Effort | '' })
const error = ref('')
const busy = ref(false)
const ready = computed(() => !!form.folder && !!form.accountId && !!form.prompt.trim() && !busy.value)
const usable = computed(() => props.accounts.filter((account) => account.health.status !== 'needs-login'))

const percent = (value?: number) => (value === undefined ? '–' : `${Math.round(value)}%`)
const usage = (account: AccountView) => (account.health.status === 'needs-login' ? 'needs login' : `5h ${percent(account.health.headroom?.fiveHour?.utilization)} · week ${percent(account.health.headroom?.sevenDay?.utilization)}`)
const home = (path: string) => path.replace(/^\/Users\/[^/]+/, '~')
const warning = computed(() => {
  const chosen = props.accounts.find((account) => account.id === form.accountId)
  const used = chosen?.health.headroom?.fiveHour?.utilization ?? 0
  const other = usable.value.find((account) => account.id !== form.accountId)
  return chosen && other && used >= 80 ? `${chosen.label} is at ${Math.round(used)}% of its 5-hour limit. ${other.label} has more room.` : ''
})

async function choose() {
  const path = await window.office.pickFolder()
  if (!path) return
  folders.value = [path, ...folders.value.filter((folder) => folder !== path)]
  form.folder = path
}

async function start() {
  if (!ready.value) return
  busy.value = true
  error.value = ''
  const result = await window.office.startChat(form.accountId, form.folder, form.prompt, form.model || undefined, form.effort || undefined).finally(() => (busy.value = false))
  if ('error' in result) error.value = result.error
  else emit('started', result.chatId)
}

onMounted(async () => {
  folders.value = await window.office.recentFolders()
  form.folder = folders.value[0] ?? ''
  form.accountId = (usable.value.find((account) => !isResearch(account)) ?? usable.value[0])?.id ?? ''
  promptEl.value?.focus()
})
</script>

<template>
  <div class="dh">
    <span class="av new">+</span>
    <div>
      <h2>New agent</h2>
      <p class="meta">Starts in an existing folder</p>
    </div>
    <button type="button" class="ib" aria-label="Cancel" title="Cancel (Esc)" @click="emit('close')">×</button>
  </div>
  <form class="quick" @submit.prevent="start" @keydown.meta.enter.prevent="start" @keydown.esc="emit('close')">
    <label class="field">
      Folder
      <span class="pick">
        <select v-model="form.folder" aria-label="Folder">
          <option v-if="!folders.length" value="" disabled>Choose a folder</option>
          <option v-for="folder in folders" :key="folder" :value="folder">{{ home(folder) }}</option>
        </select>
        <button type="button" class="btn" @click="choose">Choose…</button>
      </span>
    </label>
    <label class="field">
      Account
      <select v-model="form.accountId" aria-label="Account">
        <option v-for="account in accounts" :key="account.id" :value="account.id" :disabled="account.health.status === 'needs-login'">{{ account.label }} · {{ usage(account) }}</option>
      </select>
      <small v-if="warning" class="warn">{{ warning }}</small>
    </label>
    <label class="field">
      Prompt
      <textarea ref="promptEl" v-model="form.prompt" rows="6" placeholder="What should this agent do?" aria-label="Prompt" />
    </label>
    <div class="fields">
      <label class="field">
        Model
        <select v-model="form.model" aria-label="Model">
          <option value="">Default</option>
          <option value="opus">Opus</option>
          <option value="sonnet">Sonnet</option>
          <option value="haiku">Haiku</option>
        </select>
      </label>
      <label class="field">
        Effort
        <select v-model="form.effort" aria-label="Effort">
          <option value="">Default</option>
          <option v-for="effort in efforts" :key="effort" :value="effort">{{ effortLabels[effort] }}</option>
        </select>
      </label>
    </div>
    <p class="auto"><b>Auto mode</b> on · asks you before risky actions</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="crow">
      <span class="hint"><span><kbd>⌘↵</kbd> start</span><span><kbd>esc</kbd> cancel</span></span>
      <span class="sp" />
      <button type="submit" class="btn accent" :disabled="!ready">Start agent</button>
    </div>
  </form>
</template>

<style>
.quick {
  flex: 1;
  overflow: auto;
  padding: 14px 16px;
  display: grid;
  align-content: start;
  gap: 12px;
}

.quick select {
  font: 13px Geist, system-ui, sans-serif;
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 7px 8px;
  background: #fff;
  color: var(--ink);
  min-width: 0;
}

.quick .pick {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.quick .fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.quick .warn {
  color: var(--needs-ink);
}

.quick .auto {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}

.quick .auto b {
  font: 500 11px var(--mono);
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 5px;
  padding: 1px 5px;
}

.quick .error {
  margin: 0;
  font-size: 12.5px;
  color: var(--danger);
}
</style>
