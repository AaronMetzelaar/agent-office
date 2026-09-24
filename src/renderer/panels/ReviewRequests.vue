<script setup lang="ts">
import { ref } from 'vue'
import { ago } from '../../shared/chat'
import { overdue, type ReviewQueue, type ReviewRequest } from '../../shared/workflow'

defineProps<{ queue: ReviewQueue; now: number }>()
const emit = defineEmits<{ select: [chatId: string] }>()

const ciLabels = { pass: 'CI passing', fail: 'CI failing', pending: 'CI running', none: 'no CI' }
const starting = ref('')
const error = ref('')

async function review(request: ReviewRequest) {
  if (starting.value) return
  starting.value = request.url
  error.value = ''
  const result = await window.office.startReview(request.url).finally(() => (starting.value = ''))
  if ('error' in result) error.value = result.error
  else emit('select', result.chatId)
}
</script>

<template>
  <section class="rq" :aria-label="`Review requests · ${queue.requests.length}`">
    <h3 class="sec">Review requests · {{ queue.requests.length }}</h3>
    <p v-if="queue.notice" class="rqn" role="status">{{ queue.notice }}</p>
    <p v-if="error" class="rqn err" role="alert">{{ error }}</p>
    <article v-for="request in queue.requests" :key="request.url" :class="['rqi', { late: overdue(request, now) }]">
      <div class="rqt">
        <a :href="request.url" target="_blank" rel="noopener noreferrer">{{ request.title }}</a>
        <button type="button" class="btn sm" :disabled="!!starting" @click="review(request)">{{ starting === request.url ? 'Starting…' : 'Review' }}</button>
      </div>
      <p class="rqm">
        <span>{{ request.repo.split('/').pop() }} #{{ request.number }}</span>
        <span>{{ request.author }}</span>
        <span class="age">{{ ago(now - request.requestedAt) }}</span>
        <span v-if="request.additions !== undefined"><b class="add">+{{ request.additions }}</b> <b class="del">−{{ request.deletions }}</b></span>
        <span v-if="request.ci" :class="['ci', request.ci]">{{ ciLabels[request.ci] }}</span>
        <span v-if="request.draft">draft</span>
      </p>
    </article>
    <p v-if="!queue.requests.length && !queue.notice" class="none">No PRs are waiting for your review.</p>
  </section>
</template>

<style scoped>
.rqi {
  margin: 6px 0;
  padding: 9px 11px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #fff;
}

.rqi.late {
  border-color: #f3d9a6;
  background: var(--needs-bg);
}

.rqt {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  justify-content: space-between;
}

.rqt a {
  font-size: 13px;
  font-weight: 500;
  color: var(--ink);
  text-decoration: none;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.rqt a:hover {
  color: var(--accent);
}

.rqm {
  margin: 3px 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  font: 11px var(--mono);
  color: var(--muted);
}

.late .age {
  color: var(--needs-ink);
  font-weight: 600;
}

.add {
  font-weight: 500;
  color: #0f7a38;
}

.del {
  font-weight: 500;
  color: var(--danger);
}

.ci.fail {
  color: var(--danger);
}

.ci.pending {
  color: var(--needs-ink);
}

.rqn {
  margin: 4px 2px;
  font: 11px var(--mono);
  color: var(--muted);
}

.rqn.err {
  color: var(--danger);
}
</style>
