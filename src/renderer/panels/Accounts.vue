<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import type { AccountStatus, AccountView, Headroom, Settings } from '../../shared/ipc'
import { editors } from '../../shared/review'
import AddAccount from './AddAccount.vue'

const props = defineProps<{ accounts: AccountView[] }>()
const emit = defineEmits<{ close: [] }>()

const statusText: Record<AccountStatus, string> = { ok: 'OK', 'needs-login': 'Needs login', unknown: 'Not checked' }
const labels = computed(() => props.accounts.map((account) => account.label))
const checking = reactive(new Set<string>())
const relogin = ref<string>()
const adding = ref(false)
const formKey = ref(0)
const hasLinearKey = ref(false)
const linearKey = ref('')
const hasJevKey = ref(false)
const jevKey = ref('')
const settings = ref<Settings>()
const hookError = ref('')
const version = ref('')
const showForm = computed(() => adding.value || !!relogin.value || props.accounts.length < 2)

const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
const dayTime = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })

function usageWindows(headroom: Headroom = {}) {
  return [
    { name: '5-hour', usage: headroom.fiveHour, format: time },
    { name: 'Weekly', usage: headroom.sevenDay, format: dayTime },
  ].flatMap(({ usage, ...rest }) => (usage ? [{ ...rest, usage }] : []))
}

async function check(id: string) {
  checking.add(id)
  await window.office.revalidateAccount(id).finally(() => checking.delete(id))
}

async function remove(account: AccountView) {
  if (confirm(`Remove ${account.label}? Its token is deleted from this Mac.`)) await window.office.removeAccount(account.id)
}

function pasteNewToken(label: string) {
  relogin.value = label
  formKey.value++
}

function added() {
  relogin.value = undefined
  adding.value = false
  formKey.value++
}

async function saveLinearKey() {
  const key = linearKey.value
  linearKey.value = ''
  await window.office.setLinearKey(key)
  hasLinearKey.value = await window.office.hasLinearKey()
}

async function clearLinearKey() {
  await window.office.clearLinearKey()
  hasLinearKey.value = false
}

async function saveJevKey() {
  const key = jevKey.value
  jevKey.value = ''
  await window.office.setJevKey(key)
  hasJevKey.value = await window.office.hasJevKey()
}

async function clearJevKey() {
  await window.office.clearJevKey()
  hasJevKey.value = false
}

async function togglePhonePush() {
  if (settings.value) settings.value = await window.office.setSetting('phonePush', !settings.value.phonePush)
}

async function toggleQuietHours() {
  if (settings.value) settings.value = await window.office.setSetting('quietHoursEnabled', !settings.value.quietHoursEnabled)
}

async function setQuietStart(event: Event) {
  settings.value = await window.office.setSetting('quietHoursStart', (event.target as HTMLInputElement).value)
}

async function setQuietEnd(event: Event) {
  settings.value = await window.office.setSetting('quietHoursEnd', (event.target as HTMLInputElement).value)
}

async function toggleOutsideChats() {
  const result = settings.value?.outsideChats ? await window.office.uninstallHook() : await window.office.installHook()
  hookError.value = 'error' in result ? result.error : ''
  if (!('error' in result)) settings.value = result
}

async function setEditor(event: Event) {
  settings.value = await window.office.setSetting('editor', (event.target as HTMLSelectElement).value)
}

const stopHost = () => window.office.stopHost()

const onKey = (event: KeyboardEvent) => {
  if (event.key === 'Escape') emit('close')
}

onMounted(async () => {
  addEventListener('keydown', onKey)
  hasLinearKey.value = await window.office.hasLinearKey()
  hasJevKey.value = await window.office.hasJevKey()
  settings.value = await window.office.getSettings()
  const info = await window.office.getAppInfo()
  version.value = info.commit ? `${info.version} · ${info.commit}` : info.version
})
onUnmounted(() => removeEventListener('keydown', onKey))
</script>

<template>
  <aside class="drawer" aria-labelledby="settings-title">
    <header class="head">
      <h2 id="settings-title">Settings</h2>
      <button class="close" aria-label="Close settings" title="Close (Esc)" @click="emit('close')">×</button>
    </header>
    <div class="body">
      <h3 class="sec">Accounts</h3>
      <article v-for="account in accounts" :key="account.id" class="account" :data-account="account.label">
        <div class="title">
          <b>{{ account.label }}</b>
          <span class="pill" :class="account.health.status">{{ statusText[account.health.status] }}</span>
          <span v-if="account.health.lastCheckedAt" class="meta checked">checked {{ time.format(account.health.lastCheckedAt) }}</span>
        </div>
        <p v-if="account.claudeLogin" class="meta">Uses Claude Code’s login, so its chats can use Claude in Chrome.</p>
        <p v-if="account.health.status === 'needs-login' && account.claudeLogin" class="meta warn">Claude Code isn’t signed in. Run <code>claude</code> in Terminal and sign in with <code>/login</code>.</p>
        <p v-else-if="account.health.status === 'needs-login'" class="meta warn">Claude rejected this account’s token. Run <code>claude setup-token</code> and paste the new token.</p>
        <div v-for="{ name, usage, format } in usageWindows(account.health.headroom)" :key="name" class="usage">
          <div class="usage-row" :class="{ hot: usage.utilization >= 80 }">
            <span>{{ name }} <b>{{ Math.round(usage.utilization) }}%</b></span>
            <span v-if="usage.resetsAt">resets {{ format.format(usage.resetsAt) }}</span>
          </div>
          <div class="bar" role="meter" :aria-label="`${account.label} ${name} usage`" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="Math.round(usage.utilization)">
            <i :style="{ width: `${Math.min(100, usage.utilization)}%` }" />
          </div>
        </div>
        <p v-if="!account.health.headroom && account.health.status !== 'needs-login'" class="meta">Check the account to see its 5-hour and weekly usage.</p>
        <div class="actions">
          <button v-if="account.health.status === 'needs-login'" class="btn primary" @click="pasteNewToken(account.label)">Paste new token</button>
          <button class="btn" :disabled="checking.has(account.id)" @click="check(account.id)">{{ checking.has(account.id) ? 'Checking…' : 'Check now' }}</button>
          <button class="btn danger push" @click="remove(account)">Remove…</button>
        </div>
      </article>

      <section v-if="showForm" class="section">
        <h3 class="sec">{{ relogin ? `New token for ${relogin}` : 'Add an account' }}</h3>
        <p class="meta">Run <code>claude setup-token</code> in Terminal, signed in to the account. The token lasts one year.</p>
        <p class="meta">Claude in Chrome needs Claude Code’s own login instead of a token. For the account Claude Code is signed in to in Terminal, choose Use Claude Code login.</p>
        <AddAccount :key="formKey" :taken="labels" :label="relogin" @added="added" />
      </section>
      <button v-else class="btn add" @click="adding = true">Add account…</button>

      <section class="section">
        <h3 class="sec">Linear</h3>
        <template v-if="hasLinearKey">
          <p class="meta">A personal API key is stored, encrypted.</p>
          <button class="btn danger" @click="clearLinearKey">Remove key</button>
        </template>
        <form v-else class="linear" @submit.prevent="saveLinearKey">
          <label class="field">
            <span>Personal API key (optional)</span>
            <input v-model="linearKey" type="password" required autocomplete="off" spellcheck="false" placeholder="lin_api_…" />
          </label>
          <button class="btn">Save key</button>
        </form>
      </section>

      <section class="section">
        <h3 class="sec">Jev</h3>
        <p class="meta">Picks the section for a new agent started in the monorepo root, from its prompt.</p>
        <template v-if="hasJevKey">
          <p class="meta">A TypeSafe API key is stored, encrypted.</p>
          <button class="btn danger" @click="clearJevKey">Remove key</button>
        </template>
        <form v-else class="linear" @submit.prevent="saveJevKey">
          <label class="field">
            <span>TypeSafe API key (optional)</span>
            <input v-model="jevKey" type="password" required autocomplete="off" spellcheck="false" />
          </label>
          <button class="btn">Save key</button>
        </form>
      </section>

      <section v-if="settings" class="section">
        <h3 class="sec">General</h3>
        <label class="opt">
          <input type="checkbox" :checked="settings.phonePush" :disabled="!settings.phonePushAvailable" @change="togglePhonePush" />
          <span>Phone push<small>{{ settings.phonePushAvailable ? 'Also send notifications to your phone through ntfy.' : 'Add ~/.config/agent-office/ntfy-topic to use phone push.' }}</small></span>
        </label>
        <label class="opt">
          <input type="checkbox" :checked="settings.quietHoursEnabled" @change="toggleQuietHours" />
          <span>Quiet hours<small>Hold normal and low priority phone pushes, then send one summary when quiet hours end.</small></span>
        </label>
        <div v-if="settings.quietHoursEnabled" class="quiet">
          <label>From <input type="time" :value="settings.quietHoursStart" @change="setQuietStart" /></label>
          <label>To <input type="time" :value="settings.quietHoursEnd" @change="setQuietEnd" /></label>
        </div>
        <label class="opt">
          <input type="checkbox" :checked="settings.outsideChats" @change="toggleOutsideChats" />
          <span>Outside chats<small>Show desktop and terminal chats live. Adds one marked hook entry to ~/.claude/settings.json, backed up first.</small></span>
        </label>
        <p v-if="hookError" class="meta warn" role="alert">{{ hookError }}</p>
        <label class="opt pick">
          <span>Editor<small>Opens files and worktrees from Review.</small></span>
          <select :value="settings.editor" @change="setEditor">
            <option v-for="(label, id) in editors" :key="id" :value="id">{{ label }}</option>
          </select>
        </label>
      </section>

      <section class="section">
        <h3 class="sec">Agent host</h3>
        <p class="meta">The host keeps agents running while this window is closed. Stopping it interrupts every agent and quits Agent Office.</p>
        <button class="btn danger" @click="stopHost">Stop agent host</button>
        <p class="meta version">Agent Office {{ version }}</p>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.drawer {
  position: fixed;
  z-index: 7;
  top: 12px;
  right: 12px;
  bottom: 12px;
  width: clamp(420px, 34vw, 560px);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: 0 1px 2px rgba(17, 24, 39, 0.04), 0 18px 44px rgba(17, 24, 39, 0.1);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: opacity 0.15s, translate 0.2s cubic-bezier(0.2, 0, 0, 1);

  @starting-style {
    opacity: 0;
    translate: 8px 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .drawer {
    transition: none;
  }
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 12px 10px 16px;
  border-bottom: 1px solid var(--line);
}

h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.close {
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

.close:hover {
  background: var(--soft);
  color: var(--ink);
}

.close:focus-visible {
  outline: 2px solid var(--accent);
}

.body {
  flex: 1;
  overflow: auto;
  padding: 4px 16px 16px;
  scrollbar-width: thin;
}

.account,
.section {
  display: grid;
  gap: 10px;
  padding: 16px 0;
}

.account + .account,
.section {
  border-top: 1px solid var(--line);
}

.title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.title b {
  font-weight: 600;
}

.checked {
  margin-left: auto;
  color: var(--faint);
}

.pill {
  font: 500 11px var(--mono);
  padding: 2px 8px;
  border-radius: 6px;
}

.pill.ok {
  background: #e8f7ee;
  color: #0f7a38;
}

.pill.needs-login {
  background: #fdecec;
  color: #b42318;
}

.pill.unknown {
  background: var(--soft);
  color: var(--muted);
}

.warn {
  color: var(--needs-ink);
}

.usage-row {
  display: flex;
  justify-content: space-between;
  font: 11px var(--mono);
  color: var(--muted);
  margin-bottom: 6px;
}

.usage-row b {
  font-weight: 500;
  color: var(--ink);
}

.usage-row.hot b {
  color: var(--needs-ink);
}

.bar {
  height: 8px;
  border-radius: 4px;
  background: var(--line2);
  overflow: hidden;
}

.bar i {
  display: block;
  height: 100%;
  min-width: 2px;
  background: var(--accent);
}

.hot + .bar i {
  background: var(--needs);
}

.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.linear {
  display: grid;
  gap: 10px;
}

.linear .btn,
.section > .btn {
  justify-self: start;
}

.body > .sec {
  margin-top: 14px;
}

.push {
  margin-left: auto;
}

.add {
  margin-bottom: 16px;
}

.opt {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  font-size: 13px;
  color: var(--ink);
}

.opt input {
  margin: 3px 0 0;
}

.opt span {
  display: grid;
  gap: 2px;
}

.opt small {
  font-size: 12px;
  color: var(--muted);
}

.opt.pick {
  align-items: center;
  justify-content: space-between;
}

.opt select,
.quiet input {
  font: 13px Geist, system-ui, sans-serif;
  border: 1px solid var(--line);
  border-radius: 8px;
  height: var(--h);
  box-sizing: border-box;
  padding: 0 8px;
  background: #fff;
  color: var(--ink);
}

.quiet {
  display: flex;
  gap: 12px;
  padding-left: 23px;
  font-size: 12px;
  color: var(--muted);
}

.quiet label {
  display: flex;
  align-items: center;
  gap: 6px;
}

.version {
  color: var(--faint);
}
</style>
