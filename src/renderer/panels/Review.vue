<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from 'vue'
import type { ChatView } from '../../shared/chat'
import { ciState, type CiCheck, type DiffFile, type FileStatus, type Review } from '../../shared/review'
import { createRefresher, endedTurn } from './review/refresh'

const props = defineProps<{ chat: ChatView }>()

const statusLetters: Record<FileStatus, string> = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R' }
const reviewLabels = { approved: 'Approved', 'changes-requested': 'Changes requested', 'review-required': 'Review required' }
const ciLabels = { pass: 'Passing', fail: 'Failing', pending: 'Running', none: 'CI not run' }

const review = shallowRef<Review>()
const failed = ref('')
const flash = ref('')
const expanded = reactive(new Set<string>())
const logs = reactive(new Map<string, string>())
const fetching = reactive(new Set<string>())

const pr = computed(() => review.value?.pr)
const ci = computed(() => ciState(pr.value?.checks ?? []))
const totals = computed(() => (review.value?.files ?? []).reduce((sum, file) => ({ added: sum.added + file.added, removed: sum.removed + file.removed }), { added: 0, removed: 0 }))
const prLabel = computed(() => (pr.value?.draft && pr.value.state === 'open' ? 'Draft' : { open: 'Open', merged: 'Merged', closed: 'Closed' }[pr.value?.state ?? 'open']))

const folder = (path: string) => path.slice(0, path.lastIndexOf('/') + 1)
const name = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const firstLine = (file: DiffFile) => file.hunks.flatMap((hunk) => hunk.lines).find((line) => line.kind === 'add')?.newNo

async function load() {
  try {
    review.value = await window.office.getReview(props.chat.id)
    failed.value = ''
  } catch (error) {
    failed.value = `Couldn’t read this chat’s changes. ${error instanceof Error ? error.message.replace(/^Error invoking remote method '\w+': (Error: )?/, '') : ''}`
  }
}

const refresher = createRefresher(load)

function toggle(path: string) {
  if (!expanded.delete(path)) expanded.add(path)
}

async function openFile(path: string, line?: number) {
  const refused = await window.office.openInEditor(props.chat.id, path, line)
  flash.value = refused?.error ?? ''
}

async function toggleLog(check: CiCheck) {
  const job = check.job
  if (!job || fetching.has(job)) return
  if (logs.delete(job)) return
  fetching.add(job)
  const result = await window.office.getCiLog(props.chat.id, job).catch(() => ({ error: 'Couldn’t fetch the log.' }))
  fetching.delete(job)
  logs.set(job, 'log' in result ? result.log : result.error)
}

watch(
  () => props.chat.state,
  (after, before) => {
    if (endedTurn(before, after)) refresher.poke()
  },
)
onMounted(() => {
  void load()
  window.addEventListener('focus', refresher.poke)
})
onUnmounted(() => {
  refresher.stop()
  window.removeEventListener('focus', refresher.poke)
})
</script>

<template>
  <div class="rv">
    <header class="rvh">
      <div class="row">
        <span class="lbl">Branch</span>
        <div class="val">
          <template v-if="review?.branch">
            <code>{{ review.branch }}</code>
            <span v-if="review.upstream" class="meta">→ {{ review.upstream }}<template v-if="review.ahead"> · {{ review.ahead }} ahead</template><template v-if="review.behind"> · {{ review.behind }} behind</template></span>
            <template v-else>
              <span class="pill warn">Not pushed</span>
              <span v-if="review.unpushed" class="meta">{{ review.unpushed }} local commit{{ review.unpushed === 1 ? '' : 's' }}</span>
            </template>
            <span v-if="review.uncommitted" class="meta">· {{ review.uncommitted }} uncommitted</span>
          </template>
          <span v-else-if="review && !review.notRepo" class="meta">Detached HEAD</span>
          <span v-else class="meta">—</span>
        </div>
        <button type="button" class="ib" aria-label="Refresh review" title="Refresh" @click="load">↻</button>
      </div>
      <div class="row">
        <span class="lbl">PR</span>
        <div class="val">
          <template v-if="pr">
            <a :href="pr.url" target="_blank" rel="noopener noreferrer">#{{ pr.number }} {{ pr.title }}</a>
            <span :class="['pill', pr.state, { draft: pr.draft }]">{{ prLabel }}</span>
            <span v-if="pr.review" class="meta">{{ reviewLabels[pr.review] }}</span>
            <span v-if="pr.unresolved" class="meta">· {{ pr.unresolved }} unresolved</span>
          </template>
          <span v-else-if="review?.notice" class="meta">Unavailable</span>
          <span v-else-if="review?.branch" class="empty">No PR yet</span>
          <span v-else class="meta">—</span>
        </div>
      </div>
      <div v-if="pr" class="row">
        <span class="lbl">CI</span>
        <div class="val">
          <span :class="['pill', ci === 'none' ? 'quiet' : ci]">{{ ciLabels[ci] }}</span>
        </div>
      </div>
      <ul v-if="pr?.checks.length" class="checks">
        <li v-for="(check, index) in pr.checks" :key="index">
          <div class="ck">
            <i :class="['dot', check.state]" :aria-label="check.state" />
            <a v-if="check.url" :href="check.url" target="_blank" rel="noopener noreferrer">{{ check.name }}</a>
            <span v-else>{{ check.name }}</span>
            <button v-if="check.state === 'fail' && check.job" type="button" class="lnk" :disabled="fetching.has(check.job)" @click="toggleLog(check)">
              {{ fetching.has(check.job) ? 'Fetching…' : logs.has(check.job) ? 'Hide log' : 'Show log' }}
            </button>
          </div>
          <pre v-if="check.job && logs.has(check.job)" class="log">{{ logs.get(check.job) }}</pre>
        </li>
      </ul>
      <p v-if="review?.notice" class="notice" role="status">{{ review.notice }}</p>
    </header>
    <p v-if="failed" class="notice err" role="alert">{{ failed }}</p>
    <p v-if="flash" class="notice err" role="alert">{{ flash }}</p>
    <section class="files" aria-label="Changed files">
      <p v-if="!review" class="meta pad">Reading changes…</p>
      <p v-else-if="review.notRepo" class="meta pad">This folder isn’t a git repository, so there’s nothing to review.</p>
      <div v-else-if="!review.files.length" class="nochanges">
        <strong>No changes yet</strong>
        <span>Files this agent changes show here, compared with {{ review.base ?? 'the last commit' }}.</span>
      </div>
      <template v-else>
        <p class="sum">
          {{ review.files.length }} file{{ review.files.length === 1 ? '' : 's' }} · <span class="add">+{{ totals.added }}</span> <span class="del">−{{ totals.removed }}</span>
          <span v-if="review.base" class="meta">vs {{ review.base }}</span>
        </p>
        <article v-for="file in review.files" :key="file.path" class="file">
          <div class="fh">
            <button type="button" class="ft" :aria-expanded="expanded.has(file.path)" @click="toggle(file.path)">
              <span :class="['st', file.status]" :title="file.status">{{ statusLetters[file.status] }}</span>
              <span class="fp"><span class="dir">{{ folder(file.path) }}</span>{{ name(file.path) }}</span>
              <span class="n"><span class="add">+{{ file.added }}</span> <span class="del">−{{ file.removed }}</span></span>
            </button>
            <button v-if="file.status !== 'deleted'" type="button" class="lnk" :aria-label="`Open ${file.path} in editor`" @click="openFile(file.path, firstLine(file))">Open</button>
          </div>
          <div v-if="expanded.has(file.path)" class="hunks">
            <p v-if="file.oldPath" class="meta">Renamed from {{ file.oldPath }}</p>
            <p v-if="file.binary" class="meta">Binary file</p>
            <p v-else-if="!file.hunks.length && !file.oldPath" class="meta">{{ file.truncated ? 'Too large to show here.' : 'No line changes.' }}</p>
            <div v-for="(hunk, index) in file.hunks" :key="index" class="hunk">
              <div class="hh">{{ hunk.header }}</div>
              <div v-for="(line, at) in hunk.lines" :key="at" :class="['ln', line.kind]">
                <button v-if="line.newNo" type="button" class="no" :aria-label="`Open ${file.path} at line ${line.newNo}`" @click="openFile(file.path, line.newNo)">{{ line.newNo }}</button>
                <span v-else class="no">{{ line.oldNo }}</span>
                <span class="tx">{{ line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' ' }}{{ line.text }}</span>
              </div>
            </div>
            <p v-if="file.truncated && file.hunks.length" class="meta">Diff cut short. Open the file to see the rest.</p>
          </div>
        </article>
      </template>
    </section>
  </div>
</template>

<style>
.rv {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 10px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  scrollbar-width: thin;
}

.rv .rvh {
  display: grid;
  gap: 6px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}

.rv .row {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 26px;
}

.rv .lbl {
  font: 11px var(--mono);
  color: var(--faint);
}

.rv .val {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  min-width: 0;
  font-size: 12.5px;
}

.rv .val a {
  color: var(--ink);
  text-decoration: none;
  font-weight: 500;
  overflow-wrap: anywhere;
}

.rv .val a:hover,
.rv .checks a:hover {
  color: var(--accent);
  text-decoration: underline;
}

.rv .ib {
  width: 26px;
  height: 26px;
  font-size: 15px;
}

.rv .empty {
  color: var(--muted);
}

.rv .pill {
  font: 500 10.5px var(--mono);
  padding: 1px 7px;
  border-radius: 99px;
  background: var(--soft);
  color: var(--muted);
  white-space: nowrap;
}

.rv .pill.warn,
.rv .pill.pending {
  background: var(--needs-bg);
  color: var(--needs-ink);
}

.rv .pill.open,
.rv .pill.pass {
  background: #e8f7ee;
  color: #0f7a38;
}

.rv .pill.merged {
  background: var(--accent-soft);
  color: var(--accent);
}

.rv .pill.fail {
  background: #fdecec;
  color: var(--danger);
}

.rv .pill.draft,
.rv .pill.closed,
.rv .pill.quiet {
  background: var(--soft);
  color: var(--muted);
}

.rv .checks {
  list-style: none;
  margin: 0 0 0 60px;
  padding: 0;
  display: grid;
  gap: 3px;
  font-size: 12px;
}

.rv .ck {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.rv .checks a {
  color: var(--ink2);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rv .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
  background: var(--faint);
}

.rv .dot.pass {
  background: var(--ok);
}

.rv .dot.fail {
  background: var(--danger);
}

.rv .dot.pending {
  background: var(--needs);
}

.rv .lnk {
  all: unset;
  cursor: pointer;
  font: 500 11.5px Geist, system-ui, sans-serif;
  color: var(--accent);
  white-space: nowrap;
}

.rv .lnk:hover {
  text-decoration: underline;
}

.rv .lnk:disabled {
  cursor: default;
  color: var(--faint);
}

.rv .lnk:focus-visible,
.rv .ft:focus-visible,
.rv .ln .no:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.rv .log {
  margin: 4px 0 6px;
  max-height: 260px;
  overflow: auto;
  padding: 8px 10px;
  border-radius: 8px;
  background: #0f172a;
  color: #e2e8f0;
  font: 11px/1.5 var(--mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.rv .notice {
  margin: 0;
  padding: 7px 10px;
  border-radius: 9px;
  background: var(--soft);
  color: var(--ink2);
  font-size: 12px;
}

.rv .notice.err {
  background: #fdecec;
  color: var(--danger);
}

.rv .files {
  display: grid;
  gap: 8px;
  align-content: start;
}

.rv .pad {
  padding: 8px 0;
}

.rv .nochanges {
  display: grid;
  gap: 2px;
  padding: 18px 0;
  text-align: center;
  font-size: 12.5px;
  color: var(--muted);
}

.rv .nochanges strong {
  color: var(--ink);
  font-weight: 500;
  font-size: 13.5px;
}

.rv .sum {
  margin: 0;
  display: flex;
  align-items: baseline;
  gap: 6px;
  font: 12px var(--mono);
  color: var(--ink2);
}

.rv .sum .meta {
  margin-left: auto;
}

.rv .add {
  color: var(--ok);
}

.rv .del {
  color: var(--danger);
}

.rv .file {
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
}

.rv .fh {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-right: 10px;
}

.rv .ft {
  all: unset;
  cursor: pointer;
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  font: 12px var(--mono);
}

.rv .st {
  width: 16px;
  flex: none;
  text-align: center;
  font-weight: 600;
  color: var(--muted);
}

.rv .st.added {
  color: var(--ok);
}

.rv .st.deleted {
  color: var(--danger);
}

.rv .st.renamed {
  color: var(--accent);
}

.rv .fp {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink);
}

.rv .fp .dir {
  color: var(--faint);
}

.rv .n {
  flex: none;
  font-size: 11px;
}

.rv .hunks {
  border-top: 1px solid var(--line2);
  padding: 6px 0;
  display: grid;
  gap: 6px;
}

.rv .hunks > .meta {
  padding: 0 10px;
}

.rv .hh {
  padding: 2px 10px;
  background: var(--accent-soft);
  color: #4a5bd4;
  font: 11px/1.6 var(--mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rv .ln {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  align-items: start;
  font: 11.5px/1.55 var(--mono);
  color: var(--ink2);
}

.rv .ln.add {
  background: #ecfaf1;
}

.rv .ln.del {
  background: #fdf0f0;
}

.rv .ln .no {
  all: unset;
  padding-right: 8px;
  text-align: right;
  color: var(--faint);
  font-size: 10.5px;
  user-select: none;
}

.rv .ln button.no {
  cursor: pointer;
}

.rv .ln button.no:hover {
  color: var(--accent);
}

.rv .ln .tx {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  padding-right: 10px;
}

.rv .ln.add .tx {
  color: #0f5f2e;
}

.rv .ln.del .tx {
  color: #9b1c1c;
}
</style>
