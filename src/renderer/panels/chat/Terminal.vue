<script setup lang="ts">
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { onMounted, onUnmounted, ref } from 'vue'
import { Icon } from '../../icons'

const props = defineProps<{ chatId: string; title: string; buffer: string }>()
const emit = defineEmits<{ close: [] }>()

const host = ref<HTMLElement>()
const exited = ref(false)
const term = new Terminal({ fontFamily: 'Geist Mono, ui-monospace, monospace', fontSize: 12, cursorBlink: true, theme: { background: '#111827', foreground: '#e5e7eb' } })
const fit = new FitAddon()
term.loadAddon(fit)

const resize = () => {
  fit.fit()
  void window.office.terminalResize(props.chatId, term.cols, term.rows)
}
const observer = new ResizeObserver(resize)
const offData = window.office.onTerminalData(({ chatId, data }) => chatId === props.chatId && term.write(data))
const offExit = window.office.onTerminalExit(({ chatId }) => chatId === props.chatId && (exited.value = true))
term.onData((data) => void window.office.terminalInput(props.chatId, data))

function close() {
  void window.office.closeTerminal(props.chatId)
  emit('close')
}

onMounted(() => {
  term.open(host.value!)
  term.write(props.buffer)
  observer.observe(host.value!)
  term.focus()
})
onUnmounted(() => {
  observer.disconnect()
  offData()
  offExit()
  term.dispose()
})
</script>

<template>
  <section class="term" aria-label="Terminal" @keydown.esc.stop>
    <header>
      <Icon name="terminal" />
      <span class="tn">{{ title }}</span>
      <span v-if="exited" class="tx">exited</span>
      <button type="button" class="ib" aria-label="Hide terminal" title="Hide. The shell keeps running." @click="emit('close')"><Icon name="minus" :size="16" /></button>
      <button type="button" class="ib" aria-label="Close terminal" title="Close and end the shell" @click="close"><Icon name="close" :size="16" /></button>
    </header>
    <div ref="host" class="screen" />
  </section>
</template>

<style scoped>
.term {
  position: fixed;
  z-index: 6;
  top: 64px;
  bottom: 12px;
  right: calc(24px + clamp(420px, 34vw, 560px));
  width: clamp(360px, 34vw, 640px);
  display: flex;
  flex-direction: column;
  background: #111827;
  border-radius: 16px;
  box-shadow: 0 18px 44px rgba(17, 24, 39, 0.25);
  overflow: hidden;
}

header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 6px 6px 14px;
  color: #9ca3af;
  font: 11px var(--mono);
}

.tn {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #e5e7eb;
}

.tx {
  color: #f59e0b;
}

header .ib {
  width: 26px;
  height: 26px;
  color: #9ca3af;
}

header .ib:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
}

.screen {
  flex: 1;
  min-height: 0;
  padding: 0 10px 10px 14px;
}
</style>
