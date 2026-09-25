<script setup lang="ts">
import AddAccount from './AddAccount.vue'
</script>

<template>
  <main class="onboarding">
    <section class="card" aria-labelledby="onboarding-title">
      <p class="sec">Agent Office</p>
      <h1 id="onboarding-title">Connect a Claude account</h1>
      <p class="lede">The office runs Claude Code chats on your own accounts. Add one to open the office. You can add the second one later from Settings.</p>
      <ol class="steps">
        <li>In Terminal, run <code>claude setup-token</code> and sign in with the account you want to add.</li>
        <li>Copy the token it prints. It lasts one year.</li>
        <li>Paste it below and give the account a label, such as main or work.</li>
      </ol>
      <AddAccount :taken="[]" />
      <p class="meta">The token is encrypted with a key in your macOS Keychain and only used to talk to Claude.</p>
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

.lede {
  margin: 0;
  color: var(--ink2);
}

.steps {
  margin: 0;
  padding-left: 20px;
  display: grid;
  gap: 6px;
  font-size: 13px;
  color: var(--ink2);
}
</style>
