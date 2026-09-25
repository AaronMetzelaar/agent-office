<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ChatView } from '../../../shared/chat'
import { items } from './groups'
import SubagentSteps from './SubagentSteps.vue'

const props = defineProps<{ chat: ChatView }>()
const open = ref<string>()

const agents = computed(() => {
  const byId = new Map(items(props.chat.rows).flatMap((item) => (item.kind === 'agent' ? [[item.row.id, item] as const] : [])))
  return props.chat.subagents.map((agent) => ({ ...agent, steps: byId.get(agent.id)?.items.slice(-8) ?? [] }))
})
const toggle = (id: string) => (open.value = open.value === id ? undefined : id)
const jobs = computed(() => props.chat.backgroundJobs ?? [])
const summary = computed(() => {
  const parts = [agents.value.length && `${agents.value.length} subagent${agents.value.length === 1 ? '' : 's'}`, jobs.value.length && `${jobs.value.length} background command${jobs.value.length === 1 ? '' : 's'}`]
  return `${parts.filter(Boolean).join(' and ')} running`
})
const stop = (id: string) => window.office.stopTask(props.chat.id, id)
</script>

<template>
  <section v-if="agents.length || jobs.length" class="subs" aria-label="Running in the background">
    <p class="sc">{{ summary }}</p>
    <ul>
      <li v-for="agent in agents" :key="agent.id" :class="{ open: open === agent.id }">
        <div class="sr">
          <button type="button" class="sat" :aria-expanded="open === agent.id" @click="toggle(agent.id)">
            <span class="dot" />
            <b>{{ agent.description }}</b>
            <span class="act">{{ agent.activity ?? 'Starting' }}</span>
          </button>
          <button type="button" class="btn sm" :aria-label="`Stop ${agent.description}`" title="Stop this subagent only" @click="stop(agent.id)">Stop</button>
        </div>
        <template v-if="open === agent.id">
          <SubagentSteps v-if="agent.steps.length" :items="agent.steps" />
          <p v-else class="none">No steps yet</p>
        </template>
      </li>
      <li v-for="job in jobs" :key="job.id">
        <div class="sr">
          <span class="sat">
            <span class="dot" />
            <b>{{ job.description || 'Background command' }}</b>
            <span class="act">Background command</span>
          </span>
          <button type="button" class="btn sm" :aria-label="`Stop ${job.description || 'background command'}`" title="Stop this command only" @click="stop(job.id)">Stop</button>
        </div>
      </li>
    </ul>
  </section>
</template>

<style>
.subs {
  flex: none;
  max-height: 40%;
  overflow: auto;
  margin: 8px 16px 0;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel);
}

.subs .sc {
  margin: 0;
  padding: 6px 10px;
  font: 11.5px var(--mono);
  color: var(--accent);
  border-bottom: 1px solid var(--line2);
}

.subs ul {
  list-style: none;
  margin: 0;
  padding: 2px 0;
}

.subs li + li {
  border-top: 1px solid var(--line2);
}

.subs li.open {
  padding-bottom: 6px;
}

.subs .sat {
  all: unset;
  box-sizing: border-box;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  padding: 6px 10px;
  font-size: 12.5px;
  min-width: 0;
}

.subs button.sat:hover {
  background: var(--soft);
}

.subs span.sat {
  cursor: default;
}

.subs .sat:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.subs .sr {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-right: 8px;
}

.subs .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  flex: none;
}

.subs b {
  font-weight: 500;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 0 1 auto;
  min-width: 0;
}

.subs .act {
  margin-left: auto;
  padding-left: 8px;
  color: var(--muted);
  font: 11.5px var(--mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 0 1 55%;
  min-width: 0;
  text-align: right;
}

.subs li .steps,
.subs li .none {
  margin: 2px 10px 0 24px;
}

.subs .none {
  font-size: 12.5px;
  color: var(--faint);
}
</style>
