<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref } from 'vue'
import { ago } from '../../shared/chat'
import type { Decision, PendingRequestView, WindowSource } from '../../shared/permissions'
import type { ReviewQueue } from '../../shared/workflow'
import type { Inbox, WaitingItem } from '../state/inbox'
import ReviewRequests from './ReviewRequests.vue'

const props = defineProps<{ inbox: Inbox; canSwitch?: boolean; cleanup?: number; reviews?: ReviewQueue }>()
const emit = defineEmits<{ select: [chatId: string | undefined]; accounts: []; new: []; continue: [chatId: string]; house: [] }>()

const now = ref(Date.now())
const expanded = reactive(new Set<string>())
const drafts = reactive<Record<string, string>>({})
const flash = ref('')
const alertsHint = ref(false)
let flashTimer: ReturnType<typeof setTimeout> | undefined
const clock = setInterval(() => (now.value = Date.now()), 30_000)

const quick = (request: PendingRequestView) => !request.dangerous && request.tool !== 'AskUserQuestion'
const command = (request: PendingRequestView) => (request.tool === 'Bash' ? `$ ${request.summary}` : request.summary)
const since = (at: number) => ago(now.value - at)

function say(message: string) {
  flash.value = message
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => (flash.value = ''), 4000)
}

async function decide(requestId: string, decision: Decision, source: WindowSource) {
  const result = await window.office.resolveRequest(requestId, decision, source)
  if ('error' in result) say(result.error)
}

async function send(chatId: string, source: WindowSource) {
  const text = drafts[chatId]?.trim()
  if (!text) return
  const request = props.inbox.waiting.find((item) => item.chatId === chatId)?.requests[0]
  drafts[chatId] = ''
  if (request) return decide(request.id, { kind: 'deny', message: text }, source)
  const refused = await window.office.sendMessage(chatId, text)
  if (refused) {
    drafts[chatId] = text
    say(refused.error)
  }
}

async function resume(chatId: string) {
  const refused = await window.office.resumeChat(chatId)
  if (refused) say(refused.error)
}

function toggle(item: WaitingItem) {
  if (item.kind === 'login') return emit('accounts')
  if (expanded.has(item.key)) expanded.delete(item.key)
  else expanded.add(item.key)
}

async function dismissHint(openSettings: boolean) {
  if (openSettings) await window.office.openNotificationSettings()
  alertsHint.value = !(await window.office.setSetting('alertsHintSeen', true)).alertsHintSeen
}

onMounted(async () => {
  alertsHint.value = !(await window.office.getSettings()).alertsHintSeen
})
onUnmounted(() => {
  clearInterval(clock)
  clearTimeout(flashTimer)
})
</script>

<template>
  <div class="ih">
    <div>
      <h2><i :class="{ clear: !inbox.waiting.length }" />Waiting for you · {{ inbox.waiting.length }}</h2>
      <p>{{ inbox.waiting.length ? 'Auto mode handles the rest. These need a yes or no from you.' : 'Nobody is at your door right now.' }}</p>
    </div>
    <button type="button" class="btn sm" title="New agent (⌘N)" @click="emit('new')">New agent</button>
  </div>
  <div v-if="alertsHint" class="hintcard">
    <p>Set Agent Office notifications to <b>Alerts</b> in System Settings, so Allow and Deny stay on screen until you answer.</p>
    <div class="btns">
      <button type="button" class="btn sm" @click="dismissHint(true)">Open Settings</button>
      <button type="button" class="btn sm" @click="dismissHint(false)">Got it</button>
    </div>
  </div>
  <p v-if="flash" class="flash" role="status">{{ flash }}</p>
  <div class="ibx">
    <article v-for="(item, index) in inbox.waiting" :key="item.key" :class="['qi', { first: index === 0, stuck: item.kind !== 'request', danger: item.requests[0]?.dangerous }]" :data-chat="item.chatId">
      <span class="av" :style="{ background: item.colour }" />
      <button type="button" class="t" :aria-expanded="item.kind === 'login' ? undefined : expanded.has(item.key)" @click="toggle(item)">
        <span class="n">{{ index + 1 }}</span><b>{{ item.title }}</b>
      </button>
      <div class="qa">
        <template v-if="item.requests[0]">
          <button v-if="quick(item.requests[0])" type="button" class="btn primary sm" @click="decide(item.requests[0].id, { kind: 'allow' }, 'inbox')">{{ item.requests[0].tool === 'ExitPlanMode' ? 'Approve' : 'Allow' }}</button>
          <button v-else type="button" class="btn sm" @click="emit('select', item.chatId)">Open</button>
          <button type="button" class="btn sm" @click="decide(item.requests[0].id, { kind: 'deny' }, 'inbox')">Deny</button>
        </template>
        <button v-else-if="item.visitor" type="button" class="btn sm" @click="emit('select', item.chatId)">Open</button>
        <template v-else-if="item.kind === 'stuck' && item.chatId">
          <button type="button" class="btn sm" @click="resume(item.chatId)">Resume</button>
          <button v-if="canSwitch && item.stuckReason === 'rate-limited'" type="button" class="btn sm" title="Continue on the other account" @click="emit('continue', item.chatId)">Other account</button>
          <button type="button" class="btn sm" @click="emit('select', item.chatId)">Open</button>
        </template>
        <button v-else type="button" class="btn sm" @click="emit('accounts')">Log in</button>
      </div>
      <div class="m">
        <template v-if="item.dept"><span class="dd" :style="{ background: item.accent }" /><span>{{ item.dept }}</span><span>·</span></template>
        <span>{{ item.requests[0] ? `Auto mode · ${item.requests[0].tool}` : item.detail }}</span>
        <template v-if="item.kind !== 'login'"><span>·</span><span>{{ since(item.since) }}</span></template>
      </div>
      <template v-if="item.requests[0]">
        <code class="cmd">{{ command(item.requests[0]) }}</code>
        <p v-if="item.requests[0].dangerous" class="why">{{ item.requests[0].dangerReason }}. Open it to allow with a click.</p>
        <p v-if="item.requests.length > 1" class="more">+{{ item.requests.length - 1 }} more from this agent</p>
      </template>
      <div v-if="expanded.has(item.key) && item.chatId" class="xp">
        <p class="last">{{ item.lastReply ?? 'No reply yet.' }}</p>
        <textarea v-if="!item.visitor" v-model="drafts[item.chatId]" rows="2" :placeholder="item.requests[0] ? 'Or tell Claude what to do instead…' : 'Reply…'" aria-label="Reply" @keydown.meta.enter.prevent="send(item.chatId, 'inbox')" />
        <div v-if="!item.visitor" class="crow">
          <span class="sp" />
          <button type="button" class="btn accent sm" @click="send(item.chatId, 'inbox')">Send <kbd>⌘↵</kbd></button>
        </div>
      </div>
    </article>
    <p v-if="!inbox.waiting.length" class="none">When Auto mode needs a decision, the agent walks to your door and waits here.</p>
    <ReviewRequests v-if="reviews" :queue="reviews" :now="now" @select="emit('select', $event)" />
    <h3 class="sec">Everyone else</h3>
    <section v-for="group in inbox.board" :key="group.id" class="grp" :data-dept="group.id">
      <h4>
        <span class="dd" :style="{ background: group.accent }" />{{ group.name }}
        <span class="cts"><span v-for="count in group.counts" :key="count.key" :class="count.key"><i :class="['sd', count.key]" />{{ count.n }}</span></span>
      </h4>
      <button v-for="row in group.rows" :key="row.id" type="button" class="brow" @click="emit('select', row.id)">
        <i :class="['sd', row.state]" />
        <span class="bt">{{ row.title }}</span>
        <span class="bm">{{ since(row.since) }}</span>
        <span :class="['bd', row.state]">{{ row.caption }}</span>
      </button>
    </section>
    <p v-if="!inbox.board.length" class="none">Nobody else is working right now.</p>
    <details v-if="inbox.standby.length" class="grp standby">
      <summary>Standby<span class="cts">{{ inbox.standby.length }} in the lounge</span></summary>
      <button v-for="row in inbox.standby" :key="row.id" type="button" class="brow" @click="emit('select', row.id)">
        <i class="sd" :style="{ background: row.colour }" />
        <span class="bt">{{ row.title }}</span>
        <span class="bm">{{ row.dozing ? 'dozing' : '' }}</span>
        <span class="bd"><span class="dd" :style="{ background: row.accent }" />{{ row.dept }} · done {{ since(row.at) }} ago</span>
      </button>
    </details>
    <button v-if="inbox.parked || cleanup" type="button" class="pfoot" @click="emit('house')">
      <span><b>{{ inbox.parked }} parked</b> · quiet for a while</span><span>{{ cleanup ? `${cleanup} to clean up →` : 'Housekeeping →' }}</span>
    </button>
  </div>
  <div class="ifoot">
    <span><kbd>1</kbd> opens the first in line, then <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> answer</span>
    <span><kbd>j</kbd><kbd>k</kbd> step through</span>
    <span><kbd>⌘N</kbd> new agent</span>
  </div>
</template>

<style>
.inbox .ih {
  padding: 16px 16px 13px;
  border-bottom: 1px solid var(--line);
  display: flex;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
}

.inbox h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inbox .ih h2 i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--needs);
}

.inbox .ih h2 i.clear {
  background: var(--ok);
}

.inbox .ih p {
  margin: 3px 0 0;
  font-size: 12.5px;
  color: var(--muted);
}

.inbox .ibx {
  flex: 1;
  overflow: auto;
  padding: 2px 12px 14px;
  scrollbar-width: thin;
}

.inbox .ibx.chat {
  padding: 4px 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.btns {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.qi {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  grid-template-areas: 'av t qa' 'av m qa' '. c c';
  gap: 2px 10px;
  align-items: center;
  padding: 11px 12px;
  margin-top: 10px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #fff;
}

.qi.first {
  border-color: #f5c66b;
  background: var(--needs-bg);
}

.qi.stuck,
.qi.danger {
  border-color: #f2b8b5;
}

.qi.stuck {
  background: #fff;
}

.qi .av {
  grid-area: av;
  width: 28px;
  height: 28px;
}

.qi .t {
  all: unset;
  grid-area: t;
  cursor: pointer;
  display: flex;
  gap: 7px;
  align-items: center;
  min-width: 0;
  font-size: 13.5px;
  color: var(--ink);
}

.qi .t:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 4px;
}

.qi .t b {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qi .n {
  font: 500 10px/1 var(--mono);
  color: var(--needs-ink);
  background: var(--needs-bg);
  border: 1px solid #f3d9a6;
  border-radius: 5px;
  padding: 2px 4px;
  flex: none;
}

.qi.stuck .n {
  color: #b42318;
  background: #fdecec;
  border-color: #f2b8b5;
}

.qi .m {
  grid-area: m;
  font: 11px var(--mono);
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  gap: 6px;
  align-items: center;
  min-width: 0;
}

.dd {
  width: 7px;
  height: 7px;
  border-radius: 2px;
  flex: none;
}

.qi .qa {
  grid-area: qa;
  display: flex;
  gap: 6px;
}

.qi > code,
.qi > .why,
.qi > .more,
.qi > .xp {
  grid-column: 1 / -1;
}

.cmd {
  display: block;
  margin-top: 8px;
  font: 12px/1.5 var(--mono);
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 6px 9px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--ink);
}

.qi.first .cmd {
  border-color: #f1ddb4;
}

.why,
.more {
  margin: 6px 0 0;
  font-size: 12px;
}

.why {
  color: #b42318;
}

.more {
  color: var(--muted);
}

.xp {
  margin-top: 10px;
  display: grid;
  gap: 8px;
}

.xp .last,
.last p {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--ink2);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 180px;
  overflow: auto;
}

.inbox textarea {
  font: 13.5px/1.5 Geist, system-ui, sans-serif;
  resize: none;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 10px 12px;
  min-height: 44px;
  max-height: 140px;
  color: var(--ink);
  background: #fff;
  outline: none;
}

.inbox textarea:focus {
  border-color: #aeb6ff;
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.crow {
  display: flex;
  gap: 6px;
  align-items: center;
}

.crow .sp {
  flex: 1;
}

.hint {
  font: 11px var(--mono);
  color: var(--faint);
  display: flex;
  gap: 14px;
}

.hint span {
  display: inline-flex;
  gap: 5px;
  align-items: center;
}

.inbox .sec {
  margin: 22px 4px 2px;
}

.last .sec {
  margin: 0 0 6px;
}

.grp {
  margin-top: 10px;
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
}

.grp h4 {
  margin: 0;
  padding: 8px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink);
  background: var(--soft);
  border-bottom: 1px solid var(--line);
}

.grp h4 .dd {
  width: 8px;
  height: 8px;
}

.grp h4 .cts {
  margin-left: auto;
  font-size: 10.5px;
}

.brow {
  all: unset;
  box-sizing: border-box;
  width: 100%;
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) auto;
  column-gap: 10px;
  align-items: center;
  padding: 7px 12px;
  cursor: pointer;
}

.brow + .brow {
  border-top: 1px solid var(--line2);
}

.brow:hover {
  background: var(--soft);
}

.brow:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.brow .sd {
  grid-row: span 2;
}

.brow .bt {
  font-size: 13px;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.brow .bm {
  font: 11px var(--mono);
  color: var(--faint);
  font-variant-numeric: tabular-nums;
}

.brow .bd {
  grid-column: 2 / 4;
  font: 11px/1.45 var(--mono);
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bd.working,
.doing.working {
  color: var(--accent);
}

.bd.done,
.doing.done {
  color: #0f7a38;
}

.bd.stuck,
.doing.stuck {
  color: var(--danger);
}

.doing.needs {
  color: var(--needs-ink);
}

.standby summary {
  padding: 8px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink);
  background: var(--soft);
  cursor: pointer;
}

.standby[open] summary {
  border-bottom: 1px solid var(--line);
}

.standby summary .cts {
  margin-left: auto;
  font-size: 10.5px;
  font-weight: 400;
  color: var(--muted);
}

.standby .bd .dd {
  width: 6px;
  height: 6px;
  margin-right: 5px;
}

.pfoot {
  all: unset;
  cursor: pointer;
  box-sizing: border-box;
  width: 100%;
  margin-top: 14px;
  padding: 10px 12px;
  border: 1px dashed var(--line);
  border-radius: 12px;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12.5px;
  color: var(--muted);
}

.pfoot:hover {
  border-color: #cbd0d8;
  color: var(--ink);
}

.pfoot:focus-visible {
  outline: 2px solid var(--accent);
}

.ifoot {
  flex: none;
  border-top: 1px solid var(--line);
  padding: 10px 16px;
  font: 11px var(--mono);
  color: var(--faint);
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}

.ifoot span {
  display: inline-flex;
  gap: 5px;
  align-items: center;
}

.hintcard {
  margin: 12px 12px 0;
  padding: 10px 12px;
  border: 1px solid #c7cdff;
  background: var(--accent-soft);
  border-radius: 12px;
  display: grid;
  gap: 8px;
}

.hintcard p {
  margin: 0;
  font-size: 12.5px;
  color: var(--ink2);
}

.flash {
  margin: 10px 16px 0;
  font: 11.5px var(--mono);
  color: var(--needs-ink);
}

.inbox .dh {
  padding: 14px 12px 10px 16px;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  border-bottom: 1px solid var(--line);
}

.inbox .dh .av {
  width: 34px;
  height: 34px;
}

.inbox .dh .meta {
  margin: 2px 0 0;
}

.inbox .dh .av.new {
  background: transparent;
  border: 1.5px dashed #c3c8d0;
  box-shadow: none;
  box-sizing: border-box;
  display: grid;
  place-items: center;
  color: var(--faint);
  font-size: 18px;
}

.ib {
  all: unset;
  cursor: pointer;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  color: var(--muted);
  font-size: 18px;
}

.ib:hover {
  color: var(--ink);
  background: var(--soft);
}

.ib:focus-visible {
  outline: 2px solid var(--accent);
}

.doing {
  margin: 12px 16px 4px;
  font: 12px var(--mono);
  color: var(--muted);
}

.ask {
  border: 1px solid #f5c66b;
  background: var(--needs-bg);
  border-radius: 12px;
  padding: 12px;
  display: grid;
  gap: 10px;
}

.ask.danger {
  border-color: #f2b8b5;
  background: #fdf3f2;
}

.ask .ah {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.ask .ai {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--needs);
  color: #241300;
  display: grid;
  place-items: center;
  font: 600 12px Geist, sans-serif;
  flex: none;
  margin-top: 1px;
}

.ask.danger .ai {
  background: var(--danger);
  color: #fff;
}

.ask .q {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ink);
}

.ask .qs {
  font-size: 12px;
  color: var(--needs-ink);
  overflow-wrap: anywhere;
}

.ask.danger .qs {
  color: #b42318;
}

.ask .cmd {
  margin: 0;
  border-color: #f1ddb4;
}

.ask .question p {
  margin: 0 0 6px;
  font-size: 13px;
}

.plan {
  margin: 0;
  max-height: 240px;
  overflow: auto;
  font: 12px/1.5 var(--mono);
  background: #fff;
  border: 1px solid #f1ddb4;
  border-radius: 8px;
  padding: 8px 10px;
  white-space: pre-wrap;
}

.stuckbox {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border: 1px solid #f2b8b5;
  border-radius: 12px;
  font-size: 12.5px;
  color: #b42318;
}

.comp {
  border-top: 1px solid var(--line);
  padding: 12px 16px;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
}
</style>
