<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Decision, PendingRequestView } from '../../../shared/permissions'
import { planOf } from './cards'
import { Markdown } from './markdown'

const props = defineProps<{ request: PendingRequestView; first: boolean }>()
const emit = defineEmits<{ decide: [decision: Decision] }>()

const plan = computed(() => planOf(props.request))
const rejecting = ref(false)
const feedback = ref('')

function reject() {
  const message = feedback.value.trim()
  emit('decide', message ? { kind: 'deny', message } : { kind: 'deny' })
}
</script>

<template>
  <section class="ask plancard" role="group" aria-label="Plan ready for review">
    <div class="ah">
      <span class="ai" aria-hidden="true">✓</span>
      <div>
        <div class="q">Plan ready for review</div>
        <div class="qs">Approving leaves plan mode, and Claude starts on it.</div>
      </div>
    </div>
    <Markdown v-if="plan" class="planmd" :source="plan" />
    <textarea v-if="rejecting" v-model="feedback" rows="2" aria-label="Feedback on the plan" placeholder="What should change in the plan?" @keydown.meta.enter.prevent="reject" />
    <div class="btns">
      <template v-if="!rejecting">
        <button type="button" class="btn primary" @click="emit('decide', { kind: 'allow' })">Approve plan<kbd v-if="first">1</kbd></button>
        <button type="button" class="btn" @click="rejecting = true">Keep planning…</button>
      </template>
      <template v-else>
        <button type="button" class="btn primary" @click="reject">Send feedback</button>
        <button type="button" class="btn" @click="rejecting = false">Cancel</button>
      </template>
    </div>
  </section>
</template>

<style>
.ask .planmd {
  max-height: 280px;
  overflow: auto;
  background: #fff;
  border: 1px solid #f1ddb4;
  border-radius: 8px;
  padding: 8px 10px;
}
</style>
