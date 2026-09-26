<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue'
import type { AccountView, AppUpdate, HostStatus } from '../shared/ipc'
import Office from './office/Office.vue'
import Accounts from './panels/Accounts.vue'
import Onboarding from './panels/Onboarding.vue'
import type { ChatSource } from './state/projection'

const accounts = ref<AccountView[]>()
const setup = ref(false)
const source = shallowRef<ChatSource>()
const settingsOpen = ref(false)
const host = ref<HostStatus>({ connected: true, updateReady: false })
const update = ref<AppUpdate>({ behind: 0, subjects: [] })
const needsLogin = computed(() => accounts.value?.some((account) => account.health.status === 'needs-login'))
const updateList = computed(() => [...update.value.subjects, ...(update.value.behind > update.value.subjects.length ? [`and ${update.value.behind - update.value.subjects.length} more`] : [])].join('\n'))
let unsubscribe = () => {}
let offHost = () => {}
let offUpdate = () => {}

function installUpdate() {
  void window.office.installAppUpdate()
}

function restartHost() {
  void window.office.restartHost()
}

onMounted(async () => {
  offHost = window.office.onHostStatus((status) => (host.value = status))
  host.value = await window.office.getHostStatus()
  offUpdate = window.office.onAppUpdate((next) => (update.value = next))
  update.value = await window.office.getAppUpdate()
  const demoMode = import.meta.env.RENDERER_VITE_OFFICE_DEMO
  if (demoMode === '1' || demoMode === 'fixture') {
    const demo = await import('./state/demo')
    const fake = demo.createDemoSource(demoMode === 'fixture')
    unsubscribe = fake.stop
    source.value = fake
    accounts.value = demo.demoAccounts
  } else {
    source.value = window.office
    unsubscribe = window.office.onAccountsChanged((list) => (accounts.value = list))
    accounts.value = await window.office.listAccounts()
  }
})
onUnmounted(() => {
  unsubscribe()
  offHost()
  offUpdate()
})
</script>

<template>
  <p v-if="!host.connected" class="host" role="status">Reconnecting to agent host…</p>
  <p v-else-if="host.updateReady" class="host" role="status">
    Agent host update ready<button @click="restartHost">Restart now</button>
  </p>
  <p v-else-if="update.stage === 'installing'" class="host" role="status">Installing the update. The window reopens in a moment.</p>
  <p v-else-if="update.stage === 'waiting'" class="host" role="status" :title="updateList">Update ready. It installs once no agent is working.<button @click="installUpdate">Install now</button></p>
  <p v-else-if="update.stage === 'building'" class="host" role="status" :title="updateList">Getting {{ update.behind }} update{{ update.behind === 1 ? '' : 's' }} ready in the background…</p>
  <p v-else-if="update.error" class="host" role="alert">{{ update.error }}<button @click="installUpdate">Try again</button></p>
  <p v-else-if="update.behind" class="host" role="status" :title="updateList">
    <template v-if="update.download">{{ update.subjects[0] }} is available<button @click="installUpdate">Download</button></template>
    <template v-else>{{ update.behind }} update{{ update.behind === 1 ? '' : 's' }} available: {{ update.subjects[0] }}<button @click="installUpdate">Update</button></template>
  </p>
  <template v-if="accounts && source">
    <Onboarding v-if="accounts.length === 0 || setup" :connected="accounts.length > 0" @adding="setup = true" @done="setup = false" />
    <template v-else>
      <Office :accounts="accounts" :source="source" @accounts="settingsOpen = true">
        <button class="tbtn" :aria-expanded="settingsOpen" title="Settings (⌘,)" @click="settingsOpen = !settingsOpen">
          Settings<span v-if="needsLogin" class="alert" aria-label="An account needs login" />
        </button>
      </Office>
      <Accounts v-if="settingsOpen" :accounts="accounts" @close="settingsOpen = false" />
    </template>
  </template>
</template>

<style scoped>
.alert {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--needs);
}

.host {
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  font: 11px var(--mono);
  color: #3b5b9a;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 999px;
}

.host button {
  all: unset;
  cursor: pointer;
  color: var(--ink);
  text-decoration: underline;
}
</style>
