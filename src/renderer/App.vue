<script setup lang="ts">
import { TresCanvas } from '@tresjs/core'
import { onMounted, ref } from 'vue'

const version = ref('')

onMounted(async () => {
  version.value = (await window.office.getAppInfo()).version
})
</script>

<template>
  <TresCanvas clear-color="#f6f8fc" render-mode="on-demand">
    <TresPerspectiveCamera :position="[9, 9, 9]" :look-at="[0, 0, 0]" />
    <TresMesh :rotation-x="-Math.PI / 2">
      <TresPlaneGeometry :args="[14, 10]" />
      <TresMeshBasicMaterial color="#e3eaf6" />
    </TresMesh>
    <TresGridHelper :args="[14, 14, '#9fb4dc', '#c9d6ee']" :position="[0, 0.01, 0]" />
  </TresCanvas>
  <p class="version">Agent Office {{ version }}</p>
</template>

<style>
html,
body,
#app {
  margin: 0;
  height: 100%;
  overflow: hidden;
  background: #f6f8fc;
}

.version {
  position: fixed;
  left: 16px;
  bottom: 12px;
  margin: 0;
  font: 11px ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #3b5b9a;
}
</style>
