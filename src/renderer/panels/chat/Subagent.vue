<script setup lang="ts">
import { computed, inject } from 'vue'
import type { AgentItem } from './groups'
import { toolTarget } from './rows'
import { agentOutcome, agentStats, openSubagentKey, statusLabels } from './subagents'

const props = defineProps<{ item: AgentItem; running: ReadonlySet<string> }>()
const open = inject(openSubagentKey, undefined)

const outcome = computed(() => agentOutcome(props.item, props.running, props.item.note))
const line = computed(() => [props.item.summary, agentStats(outcome.value)].filter(Boolean).join(' · '))
const report = computed(() => {
  const line = outcome.value.report?.split('\n').find((text) => text.trim()) ?? ''
  return line.length > 160 ? `${line.slice(0, 159)}…` : line
})
</script>

<template>
  <section :class="['sub', outcome.status]">
    <div class="sh">
      <span class="dot" />
      <b>{{ toolTarget(item.row) || 'Subagent' }}</b>
      <span class="st">{{ statusLabels[outcome.status] }}</span>
      <button v-if="open" type="button" class="btn sm" :aria-label="`Open ${toolTarget(item.row) || 'subagent'}`" @click="open(item)">Open</button>
    </div>
    <p v-if="line" class="sm">{{ line }}</p>
    <p v-if="report" class="rs">{{ report }}</p>
  </section>
</template>

<style>
.sub {
  border: 1px solid var(--line2);
  border-left: 2px solid var(--accent);
  border-radius: 10px;
  padding: 8px 11px;
  display: grid;
  gap: 4px;
  min-width: 0;
}

.sub.done {
  border-left-color: var(--ok);
}

.sub.failed {
  border-left-color: var(--danger);
}

.sub.stopped {
  border-left-color: var(--faint);
}

.sub .sh {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 13px;
  color: var(--ink2);
  min-width: 0;
}

.sub .sh b {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sub .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  flex: none;
}

.sub.done .dot {
  background: var(--ok);
}

.sub.failed .dot {
  background: var(--danger);
}

.sub.stopped .dot {
  background: var(--faint);
}

.sub .st {
  margin-left: auto;
  font-size: 12px;
  color: var(--faint);
  white-space: nowrap;
  flex: none;
}

.sub .sm,
.sub > .rs {
  margin: 0;
  font-size: 12.5px;
  color: var(--muted);
  overflow-wrap: anywhere;
}
</style>
