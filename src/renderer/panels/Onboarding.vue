<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import type { ClaudeCode } from '../../shared/ipc'
import AddAccount from './AddAccount.vue'

const props = defineProps<{ connected: boolean }>()
const emit = defineEmits<{ done: []; adding: [] }>()

const steps = ['connect', 'notify', 'tour'] as const
const step = ref<(typeof steps)[number]>(props.connected ? 'notify' : 'connect')
const claude = ref<ClaudeCode>()
const checking = ref(false)
const install = 'curl -fsSL https://claude.ai/install.sh | bash'
const openSettings = () => void window.office.openNotificationSettings()

async function detect() {
  checking.value = true
  claude.value = await window.office.claudeCode().catch(() => ({ installed: false, signedIn: false }))
  checking.value = false
}

watch(
  () => props.connected,
  (connected) => {
    if (connected && step.value === 'connect') step.value = 'notify'
  },
)
onMounted(detect)
</script>

<template>
  <main class="onboarding">
    <section class="card" aria-labelledby="onboarding-title">
      <p class="sec">Agent Office · step {{ steps.indexOf(step) + 1 }} of {{ steps.length }}</p>
      <template v-if="step === 'connect'">
        <h1 id="onboarding-title">Connect a Claude account</h1>
        <p class="lede">The office runs Claude Code chats on your own Claude account. Connect one to open the office. You can add more later from Settings.</p>
        <p v-if="claude?.signedIn" class="found" role="status">Claude Code is signed in on this Mac. Give the account a label and click <b>Use Claude Code login</b>.</p>
        <div v-else-if="claude" class="need" role="status">
          <p v-if="claude.installed">Claude Code is installed but not signed in. In Terminal, run <code>claude</code> and sign in, then check again.</p>
          <template v-else>
            <p>Claude Code isn’t installed yet. In Terminal, run:</p>
            <code class="cmd">{{ install }}</code>
            <p>Then run <code>claude</code> and sign in.</p>
          </template>
          <button type="button" class="btn sm" :disabled="checking" @click="detect">{{ checking ? 'Checking…' : 'Check again' }}</button>
        </div>
        <p class="or">Or use a token:</p>
        <ol class="steps">
          <li>In Terminal, run <code>claude setup-token</code> and sign in with the account you want to add.</li>
          <li>Copy the token it prints. It lasts one year.</li>
          <li>Paste it below and give the account a label, such as main or work.</li>
        </ol>
        <AddAccount :taken="[]" @submitting="emit('adding')" />
        <p class="meta">A token is encrypted with a key in your macOS Keychain and only used to talk to Claude.</p>
      </template>
      <template v-else-if="step === 'notify'">
        <h1 id="onboarding-title">Turn on notifications</h1>
        <p class="lede">The office tells you when an agent needs a decision, gets stuck or finishes. When macOS asks, click Allow.</p>
        <ol class="steps">
          <li>Open Notification settings and find Agent Office.</li>
          <li>Set its style to <b>Alerts</b>, so Allow and Deny stay on screen until you answer.</li>
        </ol>
        <div class="buttons">
          <button type="button" class="btn" @click="openSettings">Open Notification settings</button>
          <button type="button" class="btn primary" @click="step = 'tour'">Next</button>
        </div>
      </template>
      <template v-else>
        <h1 id="onboarding-title">Your office</h1>
        <ul class="steps">
          <li>Start an agent with <b>New agent</b> or ⌘N. It gets a desk in a room for its repository, and each repository gets its own room.</li>
          <li>Folders outside git sit on the Side projects playground outside the building.</li>
          <li>Agents that need you queue at your door. Answer from the inbox, a notification, or the keys 1, 2 and 3.</li>
          <li>Settings has Accounts and Outside chats, which shows your chats from the Claude app and Terminal in the office too.</li>
          <li>To group folders into rooms of your own, add <code>~/.config/agent-office/departments.json</code>. The README explains the format.</li>
        </ul>
        <div class="buttons">
          <button type="button" class="btn primary" @click="emit('done')">Open the office</button>
        </div>
      </template>
    </section>
  </main>
</template>

<style scoped>
.onboarding {
  height: 100%;
  display: grid;
  place-items: center;
  padding: 16px;
  box-sizing: border-box;
  overflow: auto;
}

.card {
  width: min(480px, 100%);
  display: grid;
  gap: 16px;
  padding: 28px;
  box-sizing: border-box;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: 0 1px 2px rgba(17, 24, 39, 0.04), 0 18px 44px rgba(17, 24, 39, 0.08);
}

h1 {
  margin: -8px 0 0;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.lede,
.or {
  margin: 0;
  color: var(--ink2);
}

.or {
  font-size: 13px;
}

.found,
.need {
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 13px;
  background: var(--soft);
}

.need {
  display: grid;
  gap: 8px;
  justify-items: start;
}

.need p {
  margin: 0;
}

.cmd {
  display: block;
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--panel);
  font: 12px var(--mono);
  user-select: all;
}

.steps {
  margin: 0;
  padding-left: 20px;
  display: grid;
  gap: 6px;
  font-size: 13px;
  color: var(--ink2);
}

.buttons {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>
