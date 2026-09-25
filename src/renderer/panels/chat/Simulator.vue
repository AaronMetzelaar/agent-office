<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import type { SimulatorShot } from '../../../shared/chat'

const props = defineProps<{ device: string }>()
const screen = ref<string>()
const problem = ref<string>()
let timer: ReturnType<typeof setTimeout> | undefined
let alive = true
let away = false
const offVisibility = window.office.onWindowVisibility(({ visible }) => (away = !visible))

async function shoot(): Promise<SimulatorShot> {
  try {
    return await window.office.simulatorScreenshot(props.device)
  } catch {
    return { error: 'The office needs a restart to show the simulator.' }
  }
}

async function capture() {
  if (away) return void (timer = setTimeout(capture, 1000))
  const shot = await shoot()
  if (!alive) return
  if ('image' in shot) screen.value = shot.image
  problem.value = 'error' in shot ? shot.error : undefined
  timer = setTimeout(capture, problem.value ? 3000 : 500)
}

void capture()
onUnmounted(() => {
  alive = false
  clearTimeout(timer)
  offVisibility()
})
</script>

<template>
  <div class="simv">
    <img v-if="screen" :src="screen" alt="Live view of the iOS Simulator" :class="{ stale: problem }" />
    <p v-if="problem" class="meta" role="status">{{ problem }}</p>
    <p v-else-if="!screen" class="meta" role="status">Connecting to the simulator…</p>
  </div>
</template>

<style>
.simv {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 16px;
}

.simv img {
  flex: 1;
  min-height: 0;
  max-width: 100%;
  object-fit: contain;
  border-radius: 18px;
  box-shadow: 0 1px 3px rgba(17, 24, 39, 0.12);
}

.simv img.stale {
  opacity: 0.4;
}
</style>
