<script setup lang="ts">
import type { AgentItem } from './groups'
import { resultSummary, toolTarget } from './rows'
import SubagentSteps from './SubagentSteps.vue'

defineProps<{ item: AgentItem; state: 'running' | 'done' | 'failed' }>()

const labels = { running: 'Working', done: 'Done', failed: 'Failed' }
</script>

<template>
  <section :class="['sub', state]">
    <div class="sh">
      <span class="dot" />
      <b>{{ toolTarget(item.row) || 'Subagent' }}</b>
      <span class="st">{{ labels[state] }}</span>
    </div>
    <p v-if="item.summary" class="sm">{{ item.summary }}</p>
    <details v-if="item.items.length">
      <summary>Activity</summary>
      <SubagentSteps :items="item.items" />
    </details>
    <p v-if="item.row.result" class="rs">{{ resultSummary(item.row) }}</p>
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

.sub .st {
  margin-left: auto;
  font-size: 12px;
  color: var(--faint);
}

.sub .sm,
.sub > .rs {
  margin: 0;
  font-size: 12.5px;
  color: var(--muted);
  overflow-wrap: anywhere;
}

.sub > details > summary {
  cursor: pointer;
  width: fit-content;
  font-size: 12.5px;
  color: var(--faint);
}

.sub > details > summary:hover {
  color: var(--muted);
}
</style>
