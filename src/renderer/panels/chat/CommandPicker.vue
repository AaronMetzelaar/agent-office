<script setup lang="ts">
import { computed } from 'vue'
import type { CommandEntry } from '../../../shared/commands'
import type { CommandGroup } from './commands'

const props = defineProps<{ groups: CommandGroup[]; active: number; note?: string; browse?: boolean }>()
const emit = defineEmits<{ choose: [entry: CommandEntry]; hover: [index: number]; browse: [] }>()

const indexed = computed(() => {
  let index = 0
  return props.groups.map((group) => ({ label: group.label, items: group.entries.map((entry) => ({ entry, index: index++ })) }))
})
</script>

<template>
  <div class="cmdp">
    <div class="cmdl" role="listbox" aria-label="Commands and skills">
      <p v-if="!groups.length" class="cmdnone">No command or skill matches.</p>
      <template v-for="group in indexed" :key="group.label">
        <h4 class="cmdg">{{ group.label }}</h4>
        <button
          v-for="item in group.items"
          :key="item.entry.name"
          type="button"
          role="option"
          :aria-selected="item.index === active"
          :class="['cmdr', { on: item.index === active }]"
          @mousedown.prevent
          @mousemove="emit('hover', item.index)"
          @click="emit('choose', item.entry)"
        >
          <span class="cmdn">/{{ item.entry.name }}<span v-if="item.entry.argumentHint" class="cmda">{{ item.entry.argumentHint }}</span></span>
          <span v-if="item.entry.description" class="cmdd">{{ item.entry.description }}</span>
        </button>
      </template>
    </div>
    <div v-if="note || browse" class="cmdf">
      <span>{{ note }}</span>
      <button v-if="browse" type="button" class="cmdb" @mousedown.prevent @click="emit('browse')">Browse all</button>
    </div>
  </div>
</template>

<style>
.cmdp {
  display: grid;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(17, 24, 39, 0.14);
  overflow: hidden;
}

.cmdl {
  max-height: 280px;
  overflow: auto;
  padding: 4px;
}

.cmdg {
  margin: 6px 8px 2px;
  font: 500 10.5px var(--mono);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--faint);
}

.cmdr {
  all: unset;
  box-sizing: border-box;
  width: 100%;
  cursor: pointer;
  display: grid;
  gap: 1px;
  padding: 6px 8px;
  border-radius: 8px;
}

.cmdr.on {
  background: var(--accent-soft);
}

.cmdn {
  font: 12.5px var(--mono);
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cmda {
  margin-left: 0.6ch;
  color: var(--faint);
}

.cmdd {
  font-size: 12px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cmdnone {
  margin: 8px;
  font-size: 12.5px;
  color: var(--muted);
}

.cmdf {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  border-top: 1px solid var(--line2);
  font: 11px var(--mono);
  color: var(--faint);
}

.cmdb {
  all: unset;
  cursor: pointer;
  font: 500 11.5px Geist, system-ui, sans-serif;
  color: var(--accent);
}

.cmdb:focus-visible {
  outline: 2px solid var(--accent);
  border-radius: 4px;
}
</style>
