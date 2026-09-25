<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import type { AccountStatus, AccountView, Headroom } from '../../shared/ipc'
import AddAccount from './AddAccount.vue'

const props = defineProps<{ accounts: AccountView[] }>()
const emit = defineEmits<{ close: [] }>()

const statusText: Record<AccountStatus, string> = { ok: 'OK', 'needs-login': 'Needs login', unknown: 'Not checked' }
const labels = computed(() => props.accounts.map((account) => account.label))
const checking = reactive(new Set<string>())
const relogin = ref<string>()
const formKey = ref(0)
const hasLinearKey = ref(false)
const linearKey = ref('')
const hasJevKey = ref(false)
const jevKey = ref('')

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

const onKey = (event: KeyboardEvent) => {
  if (event.key === 'Escape') emit('close')
}

onMounted(async () => {
  addEventListener('keydown', onKey)
  hasLinearKey.value = await window.office.hasLinearKey()
  hasJevKey.value = await window.office.hasJevKey()
})
onUnmounted(() => removeEventListener('keydown', onKey))
</script>

<template>
  <aside class="drawer" aria-labelledby="accounts-title">
    <header class="head">
      <h2 id="accounts-title">Accounts</h2>
      <button class="close" aria-label="Close accounts" @click="emit('close')">×</button>
    </header>
    <div class="body">
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
          <button class="btn" :disabled="checking.has(account.id)" @click="check(account.id)">{{ checking.has(account.id) ? 'Checking…' : 'Check now' }}</button>
          <button v-if="account.health.status === 'needs-login'" class="btn" @click="pasteNewToken(account.label)">Paste new token</button>
          <button class="btn danger" @click="remove(account)">Remove</button>
        </div>
      </article>

      <section class="section">
        <h3 class="sec">{{ relogin ? `New token for ${relogin}` : 'Add an account' }}</h3>
        <p class="meta">Run <code>claude setup-token</code> in Terminal, signed in to the account. The token lasts one year.</p>
        <p class="meta">Claude in Chrome needs Claude Code’s own login instead of a token. For the account Claude Code is signed in to in Terminal, choose Use Claude Code login.</p>
        <AddAccount :key="formKey" :taken="labels" :label="relogin" @added="added" />
      </section>

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
  width: min(400px, calc(100vw - 24px));
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: 0 1px 2px rgba(17, 24, 39, 0.04), 0 18px 44px rgba(17, 24, 39, 0.1);
  display: flex;
  flex-direction: column;
  overflow: hidden;
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
</style>
