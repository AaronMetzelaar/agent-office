<script setup lang="ts">
import { computed, nextTick, ref, shallowRef } from 'vue'
import { sourceNotes, type CommandEntry, type CommandList } from '../../../shared/commands'
import CommandBrowser from './CommandBrowser.vue'
import CommandPicker from './CommandPicker.vue'
import { groupCommands, insertCommand, pickerKey, recentCommands, rememberCommand, slashTrigger, type Span, type Trigger } from './commands'

defineOptions({ inheritAttrs: false })
const props = defineProps<{ modelValue: string; load: () => Promise<CommandList | undefined>; below?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const area = ref<HTMLTextAreaElement>()
const root = ref<HTMLElement>()
const list = shallowRef<CommandList>()
const recent = ref(recentCommands())
const trigger = ref<Trigger>()
const dismissed = ref<number>()
const active = ref(0)
const browsing = ref<Span>()

const note = computed(() => (list.value ? sourceNotes[list.value.source] : ''))
const groups = computed(() => (trigger.value ? groupCommands(list.value?.entries ?? [], trigger.value.query, recent.value, 60) : []))
const flat = computed(() => groups.value.flatMap((group) => group.entries))
const open = computed(() => !!list.value && !!trigger.value && dismissed.value !== trigger.value.start)

async function refresh() {
  const loaded = await props.load().catch(() => undefined)
  if (loaded) list.value = loaded
}

function sync() {
  const el = area.value
  const next = el && el.selectionStart === el.selectionEnd ? slashTrigger(el.value, el.selectionStart) : undefined
  if (next && next.start !== trigger.value?.start) void refresh()
  if (next?.query !== trigger.value?.query || next?.start !== trigger.value?.start) active.value = 0
  if (!next) dismissed.value = undefined
  trigger.value = next
}

function input(event: Event) {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
  sync()
}

function caret(event: KeyboardEvent) {
  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) sync()
}

async function key(event: KeyboardEvent) {
  if (!open.value) return
  const action = pickerKey(event, active.value, flat.value.length)
  if (!action) return
  event.preventDefault()
  event.stopPropagation()
  if (action.kind === 'close') return void (dismissed.value = trigger.value?.start)
  const entry = flat.value[active.value]
  if (action.kind === 'choose') return entry && choose(entry)
  active.value = action.index
  await nextTick()
  root.value?.querySelector('.cmdr.on')?.scrollIntoView({ block: 'nearest' })
}

function choose(entry: CommandEntry, span: Span | undefined = trigger.value) {
  const el = area.value
  if (!el) return
  const next = insertCommand(el.value, entry.name, span ?? { start: el.selectionStart, end: el.selectionEnd })
  recent.value = rememberCommand(entry.name, recent.value)
  trigger.value = undefined
  browsing.value = undefined
  emit('update:modelValue', next.text)
  void nextTick(() => {
    el.focus()
    el.setSelectionRange(next.caret, next.caret)
  })
}

function browse() {
  const el = area.value
  browsing.value = trigger.value ?? { start: el?.selectionStart ?? props.modelValue.length, end: el?.selectionEnd ?? props.modelValue.length }
  trigger.value = undefined
  void refresh()
}

function closeBrowser() {
  browsing.value = undefined
  area.value?.focus()
}

defineExpose({ focus: () => area.value?.focus(), browse })
</script>

<template>
  <div ref="root" :class="['slash', { below }]">
    <textarea ref="area" v-bind="$attrs" :value="modelValue" @input="input" @keydown="key" @keyup="caret" @click="sync" @blur="trigger = undefined" />
    <CommandPicker v-if="open" class="slashpop" :groups="groups" :active="active" :note="note" browse @choose="choose" @hover="active = $event" @browse="browse" />
    <CommandBrowser v-if="browsing" :entries="list?.entries ?? []" :recent="recent" :note="note" @choose="choose($event, browsing)" @close="closeBrowser" />
  </div>
</template>

<style>
.slash {
  position: relative;
  display: grid;
}

.slashpop {
  position: absolute;
  z-index: 5;
  left: 0;
  right: 0;
  bottom: calc(100% + 6px);
}

.slash.below .slashpop {
  bottom: auto;
  top: calc(100% + 6px);
}
</style>
