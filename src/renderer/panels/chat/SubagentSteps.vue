<script setup lang="ts">
import type { Item } from './groups'
import { toolTarget } from './rows'
import ToolGroup from './ToolGroup.vue'

defineProps<{ items: Item[] }>()
</script>

<template>
  <div class="steps">
    <template v-for="child in items" :key="child.kind === 'group' ? `g:${child.id}` : child.row.id">
      <ToolGroup v-if="child.kind === 'group'" :rows="child.rows" :summary="child.summary" />
      <p v-else-if="child.kind === 'row' && child.row.kind === 'text'" class="step">{{ child.row.text.slice(0, 240) }}</p>
      <p v-else-if="child.kind === 'agent'" class="step">{{ child.row.name }} · {{ toolTarget(child.row) }}</p>
    </template>
  </div>
</template>

<style>
.steps {
  display: grid;
  gap: 6px;
  margin: 6px 0 2px;
}

.steps .step {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--ink2);
  overflow-wrap: anywhere;
}
</style>
