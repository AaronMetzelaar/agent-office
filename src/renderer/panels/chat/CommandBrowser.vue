<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { CommandEntry } from '../../../shared/commands'
import CommandPicker from './CommandPicker.vue'
import { groupCommands, pickerKey } from './commands'

const props = defineProps<{ entries: CommandEntry[]; recent: string[]; note?: string }>()
const emit = defineEmits<{ choose: [entry: CommandEntry]; close: [] }>()

const query = ref('')
const active = ref(0)
const input = ref<HTMLInputElement>()
const box = ref<HTMLElement>()
const groups = computed(() => groupCommands(props.entries, query.value, props.recent))
const flat = computed(() => groups.value.flatMap((group) => group.entries))

watch(query, () => (active.value = 0))
onMounted(() => input.value?.focus())

async function key(event: KeyboardEvent) {
  const action = pickerKey(event, active.value, flat.value.length)
  if (!action) return
  event.preventDefault()
  event.stopPropagation()
  if (action.kind === 'close') return emit('close')
  const entry = flat.value[active.value]
  if (action.kind === 'choose') return entry && emit('choose', entry)
  active.value = action.index
  await nextTick()
  box.value?.querySelector('.cmdr.on')?.scrollIntoView({ block: 'nearest' })
}
</script>

<template>
  <Teleport to="body">
    <div class="palette-back" @click.self="emit('close')">
      <div ref="box" class="palette cmdall" role="dialog" aria-label="Commands and skills">
        <input ref="input" v-model="query" placeholder="Search commands and skills" aria-label="Search commands and skills" @keydown="key" />
        <CommandPicker :groups="groups" :active="active" :note="note" @choose="emit('choose', $event)" @hover="active = $event" />
      </div>
    </div>
  </Teleport>
</template>

<style>
.cmdall .cmdp {
  border: none;
  box-shadow: none;
  border-radius: 0;
}

.cmdall .cmdl {
  max-height: 60vh;
}

.cmdall .cmdd {
  white-space: normal;
}
</style>
