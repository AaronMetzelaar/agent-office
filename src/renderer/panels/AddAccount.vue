<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{ taken: string[]; label?: string }>()
const emit = defineEmits<{ added: []; submitting: [] }>()

const suggestions = ['main', 'work', 'personal']
const label = ref(props.label ?? suggestions.find((name) => !props.taken.includes(name)) ?? '')
const token = ref('')
const busy = ref(false)
const error = ref('')
const replaces = computed(() => props.taken.some((name) => name.toLowerCase() === label.value.trim().toLowerCase()))

async function submit(useClaudeLogin = false) {
  if (busy.value) return
  emit('submitting')
  const pasted = useClaudeLogin ? null : token.value
  token.value = ''
  error.value = ''
  busy.value = true
  const result = await window.office.addAccount(label.value, pasted).catch(() => ({ error: 'Something went wrong. Try again.' }))
  busy.value = false
  if ('error' in result) error.value = result.error
  else emit('added')
}
</script>

<template>
  <form class="add" @submit.prevent="submit()">
    <label class="field">
      <span>Label</span>
      <input v-model="label" list="account-labels" maxlength="32" required autocomplete="off" spellcheck="false" :disabled="busy" />
      <datalist id="account-labels">
        <option v-for="name in suggestions" :key="name" :value="name" />
      </datalist>
    </label>
    <label class="field">
      <span>Token</span>
      <input v-model="token" type="password" required autocomplete="off" spellcheck="false" placeholder="sk-ant-oat01-…" :disabled="busy" />
    </label>
    <p v-if="replaces && !busy" class="meta">This replaces the stored token for {{ label.trim() }}.</p>
    <div class="buttons">
      <button class="btn primary" :disabled="busy">{{ busy ? 'Checking…' : replaces ? 'Replace token' : 'Add account' }}</button>
      <button type="button" class="btn" :disabled="busy || !label.trim()" @click="submit(true)">Use Claude Code login</button>
    </div>
    <p v-if="busy" class="meta progress" role="status">Running a one-line test chat on this account…</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </form>
</template>

<style scoped>
.add {
  display: grid;
  gap: 12px;
}

.buttons {
  display: flex;
  gap: 8px;
}

.progress {
  color: var(--accent);
}

.error {
  margin: 0;
  padding: 9px 11px;
  border-radius: 9px;
  background: #fdecec;
  color: #b42318;
  font-size: 12.5px;
}
</style>
