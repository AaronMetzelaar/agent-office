<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue'
import type { AccountView, Settings } from '../shared/ipc'
import Office from './office/Office.vue'
import Accounts from './panels/Accounts.vue'
import Onboarding from './panels/Onboarding.vue'
import type { ChatSource } from './state/projection'

const version = ref('')
const accounts = ref<AccountView[]>()
const source = shallowRef<ChatSource>()
const menuOpen = ref(false)
const accountsOpen = ref(false)
const settings = ref<Settings>()
const needsLogin = computed(() => accounts.value?.some((account) => account.health.status === 'needs-login'))
let unsubscribe = () => {}

function openAccounts() {
  menuOpen.value = false
  accountsOpen.value = true
}

async function togglePhonePush() {
  if (settings.value) settings.value = await window.office.setSetting('phonePush', !settings.value.phonePush)
}

onMounted(async () => {
  if (import.meta.env.RENDERER_VITE_OFFICE_DEMO === '1') {
    const demo = await import('./state/demo')
    const fake = demo.createDemoSource()
    unsubscribe = fake.stop
    source.value = fake
    accounts.value = demo.demoAccounts
  } else {
    source.value = window.office
    unsubscribe = window.office.onAccountsChanged((list) => (accounts.value = list))
    accounts.value = await window.office.listAccounts()
  }
  version.value = (await window.office.getAppInfo()).version
  settings.value = await window.office.getSettings()
})
onUnmounted(() => unsubscribe())
</script>

<template>
  <template v-if="accounts && source">
    <Onboarding v-if="accounts.length === 0" />
    <template v-else>
      <Office :accounts="accounts" :source="source" @accounts="openAccounts">
        <div class="settings">
          <button class="tbtn" aria-haspopup="menu" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen" @keydown.esc="menuOpen = false">
            Settings<span v-if="needsLogin" class="alert" aria-label="An account needs login" />
          </button>
          <div v-if="menuOpen" class="menu" role="menu">
            <button role="menuitem" @click="openAccounts">Accounts</button>
            <button role="menuitem" disabled>Permissions</button>
            <button role="menuitem" disabled>Stats</button>
            <button
              role="menuitemcheckbox"
              :aria-checked="!!settings?.phonePush"
              :disabled="!settings?.phonePushAvailable"
              :title="settings?.phonePushAvailable ? 'Also send notifications to your phone through ntfy' : 'Add ~/.config/agent-office/ntfy-topic to use phone push'"
              @click="togglePhonePush"
            >
              Phone push<span class="state">{{ settings?.phonePush ? 'On' : 'Off' }}</span>
            </button>
          </div>
        </div>
      </Office>
      <Accounts v-if="accountsOpen" :accounts="accounts" @close="accountsOpen = false" />
      <p class="version">Agent Office {{ version }}</p>
    </template>
  </template>
</template>

<style scoped>
.settings {
  position: relative;
}

.alert {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--needs);
}

.menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  min-width: 180px;
  padding: 6px;
  display: grid;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(17, 24, 39, 0.1);
}

.menu button {
  all: unset;
  cursor: pointer;
  padding: 7px 10px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--ink);
}

.menu button:hover:not(:disabled),
.menu button:focus-visible {
  background: var(--soft);
}

.menu .state {
  float: right;
  margin-left: 16px;
  font: 11px var(--mono);
  color: var(--muted);
}

.menu button:disabled {
  cursor: default;
  color: var(--faint);
}

.version {
  position: fixed;
  left: 16px;
  bottom: 12px;
  margin: 0;
  font: 11px var(--mono);
  color: #3b5b9a;
}
</style>
