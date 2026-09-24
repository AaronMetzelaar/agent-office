<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { efforts, type Effort } from '../../shared/chat'
import { accountHint, defaultAccount, defaultRules, deptIds, deptNames, homeDept, isResearch, ruleFor, showsAccountBadge, type DeptId, type DeptRule } from '../../shared/departments'
import type { AccountView } from '../../shared/ipc'
import { hexOf } from '../../shared/office'
import { dept as deptDefs, kindOf } from '../office/layout'

const props = defineProps<{ accounts: AccountView[]; desk?: { dept: DeptId; slot: number } }>()
const emit = defineEmits<{ close: []; started: [chatId: string, dept: DeptId] }>()

interface Remembered {
  model: string
  effort: Effort | ''
  worktree: boolean
}

const memoryKey = 'agent-office:new-agent'
const effortLabels: Record<Effort, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }

function recall(): Remembered {
  try {
    return { model: '', effort: '', worktree: false, ...JSON.parse(localStorage.getItem(memoryKey) ?? '{}') }
  } catch {
    return { model: '', effort: '', worktree: false }
  }
}

const remembered = recall()
const rules = ref<readonly DeptRule[]>(defaultRules)
const folders = ref<string[]>([])
const promptEl = ref<HTMLTextAreaElement>()
const form = reactive({ folder: '', accountId: '', section: '' as DeptId | '', prompt: '', model: remembered.model, effort: remembered.effort, worktree: remembered.worktree })
const error = ref('')
const busy = ref(false)
const ticket = reactive({ text: '', note: '', busy: false })

const accountId = computed({
  get: () => form.accountId || defaultAccount(props.accounts, props.desk?.dept) || '',
  set: (id: string) => (form.accountId = id),
})
const account = computed(() => props.accounts.find((candidate) => candidate.id === accountId.value))
const research = computed(() => !!account.value && isResearch(account.value))
const section = computed<DeptId>({
  get: () => form.section || props.desk?.dept || homeDept(form.folder, research.value, rules.value),
  set: (id: DeptId) => (form.section = id),
})
const hint = computed(() => accountHint(props.accounts, accountId.value, section.value))
const overflow = computed(() => !!account.value && showsAccountBadge(section.value, research.value))
const ready = computed(() => !!form.folder && !!accountId.value && !!form.prompt.trim() && !busy.value)
const place = computed(() => (props.desk ? `${kindOf(props.desk.dept) === 'gym' ? 'treadmill' : 'desk'} ${props.desk.slot + 1}` : 'first free desk'))

const percent = (value?: number) => (value === undefined ? '–' : `${Math.round(value)}%`)
const usage = (candidate: AccountView) => (candidate.health.status === 'needs-login' ? 'needs login' : `5h ${percent(candidate.health.headroom?.fiveHour?.utilization)} · week ${percent(candidate.health.headroom?.sevenDay?.utilization)}`)
const home = (path: string) => path.replace(/^\/Users\/[^/]+/, '~')

function useSuggested() {
  if (!hint.value) return
  form.section = section.value
  form.accountId = hint.value.accountId
}

async function choose() {
  const path = await window.office.pickFolder()
  if (!path) return
  folders.value = [path, ...folders.value.filter((folder) => folder !== path)]
  form.folder = path
}

async function fromTicket() {
  if (!ticket.text.trim() || ticket.busy) return
  ticket.busy = true
  const found = await window.office.lookupTicket(ticket.text).finally(() => (ticket.busy = false))
  if ('error' in found) return void (ticket.note = found.error)
  const { id, title, description } = found.ticket
  form.prompt = [title ? `${id} ${title}` : id, description, form.prompt.trim()].filter(Boolean).join('\n\n')
  form.worktree = true
  ticket.note = found.notice ?? (title ? '' : `Without a Linear key only ${id} is filled in. Add one in Accounts to get the title.`)
  promptEl.value?.focus()
}

async function start() {
  if (!ready.value) return
  busy.value = true
  error.value = ''
  const dept = section.value
  const result = await window.office.startChat(accountId.value, form.folder, form.prompt, form.model || undefined, form.effort || undefined, { dept, worktree: form.worktree }).finally(() => (busy.value = false))
  if ('error' in result) return void (error.value = result.error)
  try {
    localStorage.setItem(memoryKey, JSON.stringify({ model: form.model, effort: form.effort, worktree: form.worktree } satisfies Remembered))
  } catch {}
  emit('started', result.chatId, dept)
}

onMounted(async () => {
  promptEl.value?.focus()
  const [recent, configured] = await Promise.all([window.office.recentFolders(), window.office.departmentRules()])
  rules.value = configured
  folders.value = recent
  const wanted = props.desk?.dept
  form.folder = (wanted && recent.find((folder) => ruleFor(folder, configured) === wanted)) || recent[0] || ''
})
</script>

<template>
  <div class="dh">
    <span class="av new">+</span>
    <div>
      <h2>New agent</h2>
      <p class="meta"><span class="dd" :style="{ background: hexOf(deptDefs[section].accent) }" />{{ deptNames[section] }} · {{ place }}</p>
    </div>
    <button type="button" class="ib" aria-label="Cancel" title="Cancel (Esc)" @click="emit('close')">×</button>
  </div>
  <form class="nw" @submit.prevent="start" @keydown.meta.enter.prevent="start" @keydown.esc="emit('close')">
    <div class="field">
      Start from ticket
      <span class="pick">
        <input v-model="ticket.text" aria-label="Linear ticket" placeholder="AUC-1302 or a Linear link" @keydown.enter.prevent="fromTicket" />
        <button type="button" class="btn" :disabled="!ticket.text.trim() || ticket.busy" @click="fromTicket">Use ticket</button>
      </span>
      <p v-if="ticket.note" class="note" role="status">{{ ticket.note }}</p>
    </div>
    <label class="field">
      Prompt
      <textarea ref="promptEl" v-model="form.prompt" rows="5" placeholder="What should this agent do?" aria-label="Prompt" />
    </label>
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
    <label class="check">
      <input v-model="form.worktree" type="checkbox" aria-label="Fresh worktree" />
      <span><b>Fresh worktree</b> in <code>.claude/worktrees</code> on a new branch</span>
    </label>
    <div class="fields">
      <label class="field">
        Section
        <select v-model="section" aria-label="Section">
          <option v-for="id in deptIds" :key="id" :value="id">{{ deptNames[id] }}</option>
        </select>
      </label>
      <label class="field">
        Account
        <select v-model="accountId" aria-label="Account">
          <option v-for="candidate in accounts" :key="candidate.id" :value="candidate.id" :disabled="candidate.health.status === 'needs-login'">{{ candidate.label }} · {{ usage(candidate) }}</option>
        </select>
      </label>
    </div>
    <p v-if="hint" class="suggest">
      <span>{{ hint.text }}</span>
      <button type="button" class="btn sm" @click="useSuggested">Use {{ accounts.find((candidate) => candidate.id === hint?.accountId)?.label }}</button>
    </p>
    <p v-else-if="overflow" class="note">Runs on {{ account?.label }} in {{ deptNames[section] }}, with an account badge.</p>
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
.dh .meta .dd {
  display: inline-block;
  margin-right: 6px;
  vertical-align: 1px;
}

.nw {
  flex: 1;
  overflow: auto;
  padding: 14px 16px;
  display: grid;
  align-content: start;
  gap: 12px;
}

.nw select {
  font: 13px Geist, system-ui, sans-serif;
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 7px 8px;
  background: #fff;
  color: var(--ink);
  min-width: 0;
}

.nw .pick {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.nw .fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.nw .check {
  display: flex;
  gap: 8px;
  align-items: baseline;
  font-size: 12.5px;
  color: var(--muted);
  cursor: pointer;
}

.nw .check b {
  font-weight: 500;
  color: var(--ink);
}

.nw .suggest,
.nw .note {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}

.nw .suggest {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--needs-bg);
  color: var(--needs-ink);
}

.nw .auto {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}

.nw .auto b {
  font: 500 11px var(--mono);
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 5px;
  padding: 1px 5px;
}

.nw .error {
  margin: 0;
  font-size: 12.5px;
  color: var(--danger);
}
</style>
