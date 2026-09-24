<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive } from 'vue'
import type { Decision, PendingRequestView } from '../../../shared/permissions'
import { answerDecision, questionKey, questionsOf, toggled, type Question } from './cards'

const props = defineProps<{ request: PendingRequestView; first: boolean }>()
const emit = defineEmits<{ decide: [decision: Decision] }>()

const questions = computed(() => questionsOf(props.request))
const picked = reactive<Record<string, string[]>>({})
const other = reactive<Record<string, string>>({})
const focus = reactive({ question: 0, option: 0 })
const decision = computed(() => answerDecision(questions.value, picked, other))

function pick(index: number, question: Question, label: string) {
  Object.assign(focus, { question: index, option: question.options?.findIndex((option) => option.label === label) ?? 0 })
  picked[question.question] = toggled(question, picked[question.question] ?? [], label)
}

function submit() {
  if (decision.value) emit('decide', decision.value)
}

function press(key: string) {
  const question = questions.value[focus.question]
  if (!question) return false
  const step = questionKey(key, questions.value, focus, picked[question.question] ?? [], !!other[question.question]?.trim())
  if (!step) return false
  Object.assign(focus, step.focus)
  if (step.picked) picked[question.question] = step.picked
  if (step.submit) submit()
  return true
}

function onKey(event: KeyboardEvent) {
  if (!props.first || event.metaKey || event.ctrlKey || event.altKey || (event.target as HTMLElement).closest?.('input,textarea,select')) return
  if (!press(event.key)) return
  event.preventDefault()
  event.stopImmediatePropagation()
}

function onOther(index: number) {
  focus.question = index
  press('Enter')
}

onMounted(() => addEventListener('keydown', onKey, true))
onUnmounted(() => removeEventListener('keydown', onKey, true))
</script>

<template>
  <section class="ask" role="group" aria-label="Claude has a question">
    <div class="ah">
      <span class="ai" aria-hidden="true">?</span>
      <div>
        <div class="q">Claude has a question</div>
        <div class="qs">Pick with the number or arrow keys, Enter to confirm. Or write your own.</div>
      </div>
    </div>
    <fieldset v-for="(question, index) in questions" :key="question.question" class="question">
      <legend><b v-if="question.header">{{ question.header }} · </b>{{ question.question }}</legend>
      <div class="btns options">
        <button
          v-for="(option, at) in question.options ?? []"
          :key="option.label"
          type="button"
          class="btn"
          :class="{ cursor: first && focus.question === index && focus.option === at }"
          :aria-pressed="picked[question.question]?.includes(option.label) ?? false"
          @click="pick(index, question, option.label)"
        >
          <span class="label">{{ option.label }}<small v-if="option.description">{{ option.description }}</small></span>
          <kbd v-if="first && focus.question === index && at < 9">{{ at + 1 }}</kbd>
        </button>
      </div>
      <input v-model="other[question.question]" class="other" :aria-label="`Your own answer to: ${question.question}`" placeholder="Or your own answer…" @keydown.enter.prevent="onOther(index)" />
    </fieldset>
    <div class="btns">
      <button type="button" class="btn primary" :disabled="!decision" @click="submit">Send answers</button>
      <button type="button" class="btn" @click="emit('decide', { kind: 'deny' })">Skip</button>
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
  justify-content: space-between;
  white-space: normal;
}

.ask .options .label {
  display: grid;
  gap: 2px;
}

.ask .options small {
  font-size: 11.5px;
  font-weight: 400;
  opacity: 0.7;
  white-space: normal;
}

.ask .btn.cursor {
  outline: 2px solid var(--ink);
  outline-offset: 1px;
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
