<script setup lang="ts">
import type { Artifact } from './rows'

const props = defineProps<{ artifact: Artifact }>()

const view = () => window.office.openArtifact(props.artifact.path, props.artifact.url)
</script>

<template>
  <section :class="['art', { edited: artifact.edited }]">
    <span class="ab">{{ artifact.edited ? 'Updated artifact' : 'New artifact' }}<template v-if="artifact.version"> · v{{ artifact.version }}</template></span>
    <b>{{ artifact.title }}</b>
    <span class="aa">
      <button type="button" class="btn sm primary" @click="view">View</button>
      <a class="btn sm" :href="artifact.url" target="_blank" rel="noreferrer">Open on claude.ai</a>
    </span>
  </section>
</template>

<style>
.art {
  display: grid;
  gap: 4px;
  border: 1px solid var(--line);
  border-left: 3px solid var(--ok);
  border-radius: 10px;
  padding: 9px 12px;
  background: #fff;
}

.art.edited {
  border-left-color: var(--accent);
}

.art .ab {
  font: 11px var(--mono);
  color: var(--ok);
}

.art.edited .ab {
  color: var(--accent);
}

.art b {
  font-weight: 600;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.art .aa {
  display: flex;
  gap: 6px;
  margin-top: 2px;
}

.art a.btn {
  text-decoration: none;
}
</style>
