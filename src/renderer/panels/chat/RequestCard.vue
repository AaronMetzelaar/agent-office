<script setup lang="ts">
import { computed } from 'vue'
import type { Decision, PendingRequestView } from '../../../shared/permissions'
import { allowFrom } from './cards'
import { diffStats } from './rows'

const props = defineProps<{ request: PendingRequestView; first: boolean; cwd: string }>()
const emit = defineEmits<{ decide: [decision: Decision] }>()

const command = computed(() => (props.request.tool === 'Bash' ? `$ ${props.request.summary}` : props.request.summary))
const stats = computed(() => diffStats({ name: props.request.tool, input: props.request.input }))
const keys = computed(() => props.first && !props.request.dangerous)

function allow(event: MouseEvent) {
  if (allowFrom(props.request, event)) emit('decide', { kind: 'allow' })
}
</script>

<template>
  <section :class="['ask', { danger: request.dangerous }]" role="group" :aria-label="request.dangerous ? 'Risky request, needs a click' : 'Auto mode needs you to confirm'">
    <div class="ah">
      <span class="ai" aria-hidden="true">!</span>
      <div>
        <div class="q">{{ request.dangerous ? 'Risky request' : 'Auto mode needs you to confirm' }}</div>
        <div class="qs">{{ request.dangerous ? `${request.dangerReason} · only a click allows this` : `${request.tool} in ${cwd}` }}</div>
      </div>
    </div>
    <code class="cmd">{{ command }}</code>
    <p v-if="stats" class="stats"><span class="add">+{{ stats.added }}</span> <span class="del">−{{ stats.removed }}</span> lines</p>
    <div class="btns">
      <button type="button" class="btn primary" :title="request.dangerous ? 'Allow with a mouse click' : undefined" @click="allow">Allow once<kbd v-if="keys">1</kbd></button>
      <button v-if="request.alwaysAllow" type="button" class="btn" @click="emit('decide', { kind: 'always' })">Always allow<kbd v-if="keys">2</kbd></button>
      <button type="button" class="btn" @click="emit('decide', { kind: 'deny' })">Deny<kbd v-if="keys">3</kbd></button>
    </div>
  </section>
</template>

<style>
.ask .stats {
  margin: 0;
  font: 11.5px var(--mono);
  color: var(--muted);
}

.ask .stats .add {
  color: var(--ok);
}

.ask .stats .del {
  color: var(--danger);
}
</style>
