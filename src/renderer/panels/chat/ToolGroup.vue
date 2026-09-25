<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ChatRow } from '../../../shared/chat'
import { doing, notice } from './groups'
import { diffStats, plainLabel, resultSummary, toolDetail, toolFile, toolTarget } from './rows'

const props = defineProps<{ rows: ChatRow[]; summary: string; live?: boolean }>()

const open = ref(false)
const now = computed(() => (props.live ? doing(props.rows) : undefined))
</script>

<template>
  <div :class="['tg', { open, busy: live }]">
    <button type="button" class="tgh" :aria-expanded="open" @click="open = !open">
      <span v-if="live" class="spin" aria-hidden="true" />
      <span v-if="now" class="tgs">{{ now.verb }} <code v-if="now.target">{{ now.target }}</code>…</span>
      <span v-else class="tgs">{{ summary }}</span>
      <span class="chev" aria-hidden="true">›</span>
    </button>
    <div v-if="open" class="calls">
      <template v-for="row in rows" :key="row.id">
        <details v-if="row.kind === 'tool'" :class="['tr', { err: row.result?.isError, wait: !row.result }]">
          <summary>
            <b>{{ row.name }}</b>
            <button v-if="toolFile(row)" type="button" class="tt fp" :data-file="toolFile(row)" :title="`Show ${toolFile(row)}`">{{ toolTarget(row) }}</button>
            <span v-else class="tt">{{ toolTarget(row) }}</span>
            <span v-if="diffStats(row)" class="ds"><i class="add">+{{ diffStats(row)!.added }}</i> <i class="del">−{{ diffStats(row)!.removed }}</i></span>
            <span class="rs">{{ resultSummary(row) }}</span>
          </summary>
          <pre class="io">{{ toolDetail(row) }}</pre>
          <pre v-if="row.result" class="io out">{{ row.result.text }}</pre>
        </details>
        <p v-else-if="row.kind === 'user'" :class="['nt', { err: notice(row).failed }]">{{ notice(row).summary }}</p>
        <p v-else class="or">{{ plainLabel(row) }}</p>
      </template>
    </div>
  </div>
</template>

<style>
.tg {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  justify-items: start;
  min-width: 0;
}

.tg .tgh {
  all: unset;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  max-width: 100%;
  cursor: pointer;
  font-size: 13px;
  line-height: 1.5;
  color: var(--muted);
  border-radius: 6px;
}

.tg .tgh:hover {
  color: var(--ink2);
}

.tg .tgh:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.tg .tgs {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.tg .tgs code {
  font-size: 11.5px;
  background: var(--soft);
  border: 0;
  color: var(--ink2);
}

.tg .chev {
  flex: none;
  font-size: 15px;
  line-height: 1;
  color: var(--faint);
  transition: transform 0.15s ease;
}

.tg.open .chev {
  transform: rotate(90deg);
}

.tg .spin {
  flex: none;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1.5px solid var(--line);
  border-top-color: var(--accent);
  animation: tg-spin 0.9s linear infinite;
}

@keyframes tg-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .tg .spin {
    animation: none;
  }

  .tg .chev {
    transition: none;
  }
}

.tg .calls {
  justify-self: stretch;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1px;
  margin: 6px 0 2px 4px;
  padding-left: 10px;
  border-left: 1px solid var(--line);
  min-width: 0;
}

.tg .tr summary {
  cursor: pointer;
  list-style: none;
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 3px 0;
  font: 11.5px/1.5 var(--mono);
  color: var(--faint);
  min-width: 0;
}

.tg .tr summary::-webkit-details-marker {
  display: none;
}

.tg .tr summary:hover {
  color: var(--muted);
}

.tg .tr summary b {
  font-weight: 500;
  color: var(--muted);
}

.tg .tr .tt {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
  color: var(--ink2);
}

.tg .tr .rs {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 40%;
}

.tg .tr.err b,
.tg .tr.err .rs,
.tg .nt.err {
  color: var(--danger);
}

.tg .tr.wait .rs {
  color: var(--accent);
}

.tg .ds i {
  font-style: normal;
}

.tg .ds .add {
  color: var(--ok);
}

.tg .ds .del {
  color: var(--danger);
}

.tg .io {
  margin: 2px 0 6px;
  padding: 7px 9px;
  border-radius: 6px;
  background: var(--soft);
  font: 11.5px/1.5 var(--mono);
  color: var(--ink2);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 260px;
  overflow: auto;
}

.tg .tr.err .io.out {
  background: #fdf2f2;
}

.tg .nt,
.tg .or {
  margin: 0;
  padding: 3px 0;
  font: 11.5px/1.5 var(--mono);
  color: var(--faint);
  overflow-wrap: anywhere;
}
</style>
