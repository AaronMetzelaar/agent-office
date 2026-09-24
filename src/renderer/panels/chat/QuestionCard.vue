<script setup lang="ts">
import { computed, reactive } from 'vue'
import type { Decision, PendingRequestView } from '../../../shared/permissions'
import { answerDecision, questionsOf, type Question } from './cards'

const props = defineProps<{ request: PendingRequestView; first: boolean }>()
const emit = defineEmits<{ decide: [decision: Decision] }>()

const questions = computed(() => questionsOf(props.request))
const picked = reactive<Record<string, string[]>>({})
const other = reactive<Record<string, string>>({})
const decision = computed(() => answerDecision(questions.value, picked, other))

function pick(question: Question, label: string) {
  const current = picked[question.question] ?? []
  if (!question.multiSelect) picked[question.question] = current.includes(label) ? [] : [label]
  else picked[question.question] = current.includes(label) ? current.filter((entry) => entry !== label) : [...current, label]
}

function submit() {
  if (decision.value) emit('decide', decision.value)
}
</script>

<template>
  <section class="ask" role="group" aria-label="Claude has a question">
    <div class="ah">
      <span class="ai" aria-hidden="true">?</span>
      <div>
        <div class="q">Claude has a question</div>
        <div class="qs">Pick an answer, or write your own.</div>
      </div>
    </div>
    <fieldset v-for="question in questions" :key="question.question" class="question">
      <legend><b v-if="question.header">{{ question.header }} · </b>{{ question.question }}</legend>
      <div class="btns options">
        <button v-for="option in question.options ?? []" :key="option.label" type="button" class="btn" :title="option.description" :aria-pressed="picked[question.question]?.includes(option.label) ?? false" @click="pick(question, option.label)">{{ option.label }}</button>
      </div>
      <input v-model="other[question.question]" class="other" :aria-label="`Your own answer to: ${question.question}`" placeholder="Or your own answer…" />
    </fieldset>
    <div class="btns">
      <button type="button" class="btn primary" :disabled="!decision" @click="submit">Send answers</button>
      <button type="button" class="btn" @click="emit('decide', { kind: 'deny' })">Skip<kbd v-if="first">3</kbd></button>
    </div>
  </section>
</template>

<style>
.ask .question {
  border: 0;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
}

.ask .question legend {
  padding: 0;
  margin-bottom: 6px;
  font-size: 13px;
}

.ask .options {
  flex-direction: column;
  align-items: stretch;
}

.ask .options .btn {
  text-align: left;
}

.ask .btn[aria-pressed='true'] {
  background: var(--ink);
  border-color: var(--ink);
  color: #fff;
}

.ask .other {
  font: 12.5px Geist, system-ui, sans-serif;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 6px 9px;
  background: #fff;
  color: var(--ink);
}
</style>
