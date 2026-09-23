<script setup lang="ts">
import { TresCanvas } from '@tresjs/core'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { AccountView } from '../shared/ipc'
import Accounts from './panels/Accounts.vue'
import Onboarding from './panels/Onboarding.vue'

const version = ref('')
const accounts = ref<AccountView[]>()
const menuOpen = ref(false)
const accountsOpen = ref(false)
const needsLogin = computed(() => accounts.value?.some((account) => account.health.status === 'needs-login'))
let unsubscribe = () => {}

function openAccounts() {
  menuOpen.value = false
  accountsOpen.value = true
}

onMounted(async () => {
  unsubscribe = window.office.onAccountsChanged((list) => (accounts.value = list))
  accounts.value = await window.office.listAccounts()
  version.value = (await window.office.getAppInfo()).version
})
onUnmounted(() => unsubscribe())
</script>

<template>
  <template v-if="accounts">
    <Onboarding v-if="accounts.length === 0" />
    <template v-else>
      <TresCanvas clear-color="#f6f8fc" render-mode="on-demand">
        <TresPerspectiveCamera :position="[9, 9, 9]" :look-at="[0, 0, 0]" />
        <TresMesh :rotation-x="-Math.PI / 2">
          <TresPlaneGeometry :args="[14, 10]" />
          <TresMeshBasicMaterial color="#e3eaf6" />
        </TresMesh>
        <TresGridHelper :args="[14, 14, '#9fb4dc', '#c9d6ee']" :position="[0, 0.01, 0]" />
      </TresCanvas>
      <header class="bar">
        <div class="brand">Agent Office</div>
        <div class="settings">
          <button class="tbtn" aria-haspopup="menu" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen" @keydown.esc="menuOpen = false">
            Settings<span v-if="needsLogin" class="alert" aria-label="An account needs login" />
          </button>
          <div v-if="menuOpen" class="menu" role="menu">
            <button role="menuitem" @click="openAccounts">Accounts</button>
            <button role="menuitem" disabled>Permissions</button>
            <button role="menuitem" disabled>Stats</button>
          </div>
        </div>
      </header>
      <Accounts v-if="accountsOpen" :accounts="accounts" @close="accountsOpen = false" />
      <p class="version">Agent Office {{ version }}</p>
    </template>
  </template>
</template>

<style scoped>
.bar {
  position: fixed;
  z-index: 5;
  left: 16px;
  top: 16px;
  display: flex;
  gap: 8px;
}

.brand,
.tbtn {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  min-height: 40px;
  box-sizing: border-box;
  box-shadow: 0 1px 2px rgba(17, 24, 39, 0.04);
  display: inline-flex;
  align-items: center;
}

.brand {
  padding: 0 14px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.settings {
  position: relative;
}

.tbtn {
  font: 500 12px Geist, system-ui, sans-serif;
  padding: 0 14px;
  gap: 8px;
  color: var(--ink2);
  cursor: pointer;
}

.tbtn:hover {
  border-color: #cbd0d8;
  color: var(--ink);
}

.tbtn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.tbtn[aria-expanded='true'] {
  background: var(--ink);
  border-color: var(--ink);
  color: #fff;
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
