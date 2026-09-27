<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref } from 'vue'
import type { ChatView, Subagent } from '../../../shared/chat'
import { items } from './groups'
import { agentStats, findAgent, openSubagentKey } from './subagents'

const props = defineProps<{ chat: ChatView }>()
const open = inject(openSubagentKey, undefined)
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined
onMounted(() => (clock = setInterval(() => (now.value = Date.now()), 1000)))
onUnmounted(() => clearInterval(clock))

const agents = computed(() => {
  const list = items(props.chat.rows)
  return props.chat.subagents.map((agent) => ({ ...agent, item: findAgent(list, agent.id) }))
})
const jobs = computed(() => props.chat.backgroundJobs ?? [])
const summary = computed(() => {
  const parts = [agents.value.length && `${agents.value.length} subagent${agents.value.length === 1 ? '' : 's'}`, jobs.value.length && `${jobs.value.length} background command${jobs.value.length === 1 ? '' : 's'}`]
  return `${parts.filter(Boolean).join(' and ')} running`
})
const stop = (id: string) => window.office.stopTask(props.chat.id, id)

const stats = (agent: Subagent) => agentStats({ ...agent, ms: now.value - agent.startedAt })
</script>

<template>
  <section v-if="agents.length || jobs.length" class="subs" aria-label="Running in the background">
    <p class="sc">{{ summary }}</p>
    <ul>
      <li v-for="agent in agents" :key="agent.id">
        <div class="sr">
          <button type="button" class="sat" :disabled="!agent.item" :title="`Open ${agent.description}`" @click="agent.item && open?.(agent.item)">
            <span class="dot" />
            <span class="nm">
              <b>{{ agent.description }}</b>
              <small>{{ stats(agent) }}</small>
            </span>
            <span class="act">{{ agent.activity ?? 'Starting' }}</span>
          </button>
          <button type="button" class="btn sm" :aria-label="`Stop ${agent.description}`" title="Stop this subagent only" @click="stop(agent.id)">Stop</button>
        </div>
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

.subs .nm {
  display: grid;
  min-width: 0;
  flex: 0 1 auto;
}

.subs small {
  font: 11px var(--mono);
  color: var(--faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
  flex: 1 1 0;
  min-width: 0;
  text-align: right;
}
</style>
