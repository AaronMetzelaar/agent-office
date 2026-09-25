<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { FilePreview } from '../../../shared/review'

const props = defineProps<{ chatId: string; path: string }>()
const emit = defineEmits<{ close: [] }>()

const shown = ref<FilePreview>()
const full = computed(() => shown.value?.path || props.path)
const name = computed(() => full.value.split('/').pop())

watch(
  () => [props.chatId, props.path] as const,
  async ([chatId, path]) => {
    shown.value = undefined
    const result = await window.office.previewFile(chatId, path).catch(() => ({ path, error: 'The office needs a restart to show files.' }))
    if (props.chatId === chatId && props.path === path) shown.value = result
  },
  { immediate: true },
)

function onKey(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  emit('close')
}

onMounted(() => addEventListener('keydown', onKey, true))
onUnmounted(() => removeEventListener('keydown', onKey, true))
</script>

<template>
  <section class="pv" aria-label="File preview">
    <header>
      <div>
        <b>{{ name }}</b>
        <p class="meta">{{ full }}</p>
      </div>
      <button type="button" class="ib" aria-label="Close preview" title="Close (Esc)" @click="emit('close')">×</button>
    </header>
    <p v-if="!shown" class="meta" role="status">Loading…</p>
    <p v-else-if="'error' in shown" class="meta" role="alert">{{ shown.error }}</p>
    <img v-else-if="'image' in shown" :src="shown.image" :alt="name" />
    <pre v-else>{{ shown.text }}</pre>
  </section>
</template>

<style>
.pv {
  position: fixed;
  z-index: 7;
  top: 12px;
  bottom: 12px;
  right: calc(clamp(420px, 34vw, 560px) + 24px);
  width: min(760px, calc(100vw - clamp(420px, 34vw, 560px) - 36px));
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: 0 1px 2px rgba(17, 24, 39, 0.04), 0 18px 44px rgba(17, 24, 39, 0.1);
  overflow: hidden;
}

.pv header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px 10px 16px;
  border-bottom: 1px solid var(--line);
}

.pv header div {
  min-width: 0;
}

.pv header .meta {
  margin: 2px 0 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pv > .meta {
  margin: 16px;
}

.pv img {
  flex: 1;
  min-height: 0;
  padding: 16px;
  object-fit: scale-down;
}

.pv pre {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 12px 16px;
  overflow: auto;
  font: 12px/1.55 var(--mono);
  color: var(--ink2);
  white-space: pre;
}

@media (max-width: 900px) {
  .pv {
    display: none;
  }
}
</style>
