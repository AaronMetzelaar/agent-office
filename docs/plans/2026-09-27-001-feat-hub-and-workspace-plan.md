---
title: "feat: The hub and the workspace"
type: feat
status: active
date: 2026-09-27
origin: docs/brainstorms/2026-09-27-metro-workspace-requirements.md
---

# feat: The hub and the workspace

## Overview

This plan replaces the 3D office as the app's home with two places (see origin: `docs/brainstorms/2026-09-27-metro-workspace-requirements.md`):

- **The hub.** A network of every chat's line on the left and a triage column on the right: Start something, Jump in, Review and Your call.
- **The workspace.** One chat, with its line squeezed beside the reply, the open stop given the page, a right column for what matters now, and a ⌘J workbench.

Around them it adds:
- a route of stages with tasks, which gives every chat a line
- a switcher, ⌃Tab and bottom-right notifications for getting around
- side chats and branching from any stop
- an intake that reads the user's connectors hourly and turns what matters into suggested work
- low-risk lines that start by themselves

The work is split into five phases so each one ships on its own and leaves the app usable:
- **A.** The data a line needs.
- **B.** The new shell, hub and workspace.
- **C.** Branching.
- **D.** Connectors and suggested work.
- **E.** Companion parity and retiring the office as home.

## Problem Frame

The 3D office uses most of the screen for characters and leaves the work about a third of it. The app doesn't know the compound-engineering stages. You can't see a chat's progress, the defaults it chose, or what it's waiting for without reading its transcript. Work that starts in Sentry, Gmail, Linear, GitHub or Slack never reaches the office by itself. The design rounds on the prototype canvas settled the direction, with Round 14 for the hub and Rounds 8–10 for the chat view, switcher and connectors: https://claude.ai/artifact/VriJh789MbBDismRPxar73

## Requirements Trace

Grouped from the origin document. Every unit names the requirements it covers.

- **Visual language (R1–R3):** a dense, dark-first tool; metro elements only where they explain; one meaning per colour; no machinery shown.
- **Hub (R4–R9):**
  - the network grows outward from each repo's `main` through shared stage columns
  - lines are collapsed by default and expand, with branching from a stop
  - state shows at each line's tip
  - a triage column with Start, Jump in, Review, Your call and Finished
  - rows and lines are linked
- **Workspace (R10–R15):**
  - the header in the title bar and no sidebar
  - the squeezed line
  - the open stop gets the page
  - a right column with Open, Tasks and Connected
  - a ⌘J workbench
  - the workspace kept per chat and restored after restart
- **Getting around (R16–R18):** bottom-right notifications answered in place; the switcher dropdown; the ⌃Tab overlay; ⌘K.
- **Route (R19–R22):** the CE route with skill fallbacks; stage detection; next-stop suggestions; routes as config.
- **Side chats (R23–R25):** branch from any stop; worktree on first edit; reconnect with a summary, code or both; continue from a stop in a new chat.
- **Connectors (R26–R30):**
  - hourly scans of GitHub, Sentry, Gmail, Linear, Slack, Claude Code sessions and the office's own follow-ups
  - hidden judging and merging
  - drafted kickoffs
  - rules that learn
  - acting as the user always waits for an allow
- **Started for you (R31–R32):** low-risk lines start themselves under enforced limits; a Sentry rule; a "started for you" tag and Stop.
- **Companion agents (R33):** the same lines and rows, no message box, branching only for hosted chats.

## Scope Boundaries

- The 3D office and characters are parked. They stay reachable behind a setting until Phase E, then leave the default path. Their code isn't deleted in this plan.
- No time estimates or predictions.
- No code editor.
- No reading of claude.ai conversations.
- Nothing is sent, pushed or deployed for the user without an explicit allow, including by lines started for you.
- One level of branch drawing.

### Deferred to Separate Tasks

- Characters in a new form: a later brainstorm.
- A dark and light theme for the 3D office: not needed, since it's parked.
- Mobile or web access to the hub: out of scope.
- Public-release packaging of the connector scanner: handled with `docs/brainstorms/2026-09-27-open-source-release-requirements.md`.

## Context & Research

### Relevant Code and Patterns

- **Renderer entry**
  - `src/renderer/App.vue:29-76` picks the `ChatSource`, which is the demo source or `window.office`, and mounts `Office`.
  - `src/renderer/office/Office.vue` holds the scene, the `<aside class="inbox">` panel switching (:419-424), `select()` (:90-103), `navigate()` (:203) and keyboard handling (:328-352).
- **Renderer state that is coupled to the office**
  - `state/projection.ts:22-100` applies `chatPatches`, but imports `three` and `office/layout`.
  - `state/inbox.ts:5-7,98-138` imports `office/labels`, `layout` and `standby`.
  - `state/keys.ts:11-39` holds the 1/2/3 answers and the waiting-chat navigation.
- **Chat panel pieces reusable as they are:** `panels/chat/`
  - `Transcript.vue`, including rewind
  - `Composer.vue` with `SlashInput`, `CommandPicker` and `CommandBrowser`
  - `PlanCard`, `QuestionCard`, `RequestCard`
  - `SubagentStrip`, `SubagentView`
  - `Terminal.vue`, `Simulator.vue`, `ArtifactCard.vue`, `Preview.vue`
  - `ShipIt.vue`
  - `panels/Review.vue`

  `panels/Chat.vue` depends on the office's `AgentEntry` and `canRest`.
- **Data model:** `src/shared/chat.ts`, with `ChatRow` at :38-42, `ChatFields` at :74-113, `Subagent` at :115-123 and `applyPatch` at :177. Pending requests are in `src/shared/permissions.ts:13-22`. Plan mode is `permissionMode: 'plan'` (`store/chats.ts:517-527`). Todo lists are only a tool row's `input.todos` today (`panels/chat/groups.ts:32`).
- **Persistence:** `src/main/store/db.ts`.
  - A new chat column goes in four places: `addedColumns` (:64-70), `columns` (:72-97), the `json`/`flags` sets (:98-99) and `ChatRecord` (:7-32).
  - Settings are stored through `db.setting`/`saveSetting` (:160-164).
  - Runtime-only fields are stripped in `store/chats.ts:145-148`.
- **Sessions:** `src/main/sessions/manager.ts`.
  - `StartOptions` (:17-26) includes `resume` and `forkSession`.
  - `rewindFiles` is at :219-221.
  - There's no `resumeSessionAt` yet.
  - The events come from `sessions/normalize.ts:4-23,101`.
- **Worktrees:** `src/main/worktrees/create.ts:56-89` and `store/chats.ts:381-403,530-560`.
- **Requests and notifications**
  - `permissions/registry.ts:62,102,140` covers the broker, `resolveRequest` and the window resolver.
  - `notify/index.ts:77-148` covers desktop notifications.
  - `shared/queue.ts:21` is `buildQueue`.
  - `panels/Inbox.vue:37` answers requests inline.
- **Integrations**
  - `workflow/index.ts:28` has `wireWorkflow`.
  - `workflow/linear.ts:23-96` reads Linear over GraphQL with the vault key and a 5-minute cache.
  - `workflow/review-requests.ts:33-38,129` polls `gh` every 5 minutes and on focus.
  - `review/github.ts` has `pr view`, review threads and failed runs.
  - `departments/jev.ts` has the Jev client with its choice and confidence fields and a 3-second timeout.
- **Companion sessions:** `outside/index.ts:53-106` watches `~/.claude/projects/**/*.jsonl` and hooks, and `visitors.ts:48` builds visitor chats.
- **Terminals:** `main/terminal.ts:23-77` keeps one pty per chat with a 200 KB buffer. `state/terminal.ts` holds a global "shown" flag in localStorage.
- **IPC:** channel names equal the keys of `Commands`/`Events` (`shared/ipc.ts:82-177`). Every new command is also listed in `main/host/forwarded.ts:5` and wired in `main/host/core.ts`.
- **Tests**
  - vitest runs a node project (`tests/**/*.test.ts`) and a client project (`*.client.test.ts`).
  - Playwright e2e specs are in `tests/e2e`, using the fake engine, fake `gh` and the inline host (`tests/e2e/chat-panel.spec.ts`).
  - The demo source is `state/demo.ts:184`.

### Institutional Learnings

- `docs/solutions/2026-09-sdk-dual-account-spike.md`: SDK sessions can fork, and the spike (`spikes/fork-adopt.ts`) showed forked sessions don't disturb the original transcript.
- The rooms plan (`docs/plans/2026-09-25-001-feat-rooms-for-any-setup-plan.md`) established that the host owns derived structure and sends it in the snapshot plus a dedicated event. This plan follows the same pattern for lines and intake items.

### External References

- Claude Agent SDK: `resume` plus `forkSession`, `canUseTool`, permission modes, `settingSources`, MCP server configuration and file checkpointing are already in use. Whether a fork can target an earlier message is to be verified in U10.
- TypeSafe `systemone` (Jev): `state` plus `questions` with `choice` criteria, returning `answers.<q>.choice/confidence`, as used in `departments/jev.ts`.

## Key Technical Decisions

- **The host owns each chat's line.** A new `src/shared/line.ts` defines `Line`, `Stop`, `Stage` and `Task`. `src/main/store/line.ts` keeps each chat's line up to date from session events and persists it in a new `line` JSON column.
  - Rationale: rows are capped at 200 in memory, so a line built in the renderer would lose early stages. Stage history must survive restarts, and companion chats need the same line built from transcripts.
- **Tasks come from the plan first, then the agent's todo list.**
  - When the chat wrote or read a plan document in `docs/plans/`, its implementation units become Work's tasks.
  - Otherwise the latest `TodoWrite` list is used. A new `todos` event in `normalize.ts` carries it.
  - A task's sub-steps come from the todo list while that task is current.
- **Stage detection is event-driven and never goes backwards on its own.**
  - A stage starts when its skill runs (slash command or Skill tool), when the user picks it, or on the first strong signal:
    - plan mode or `ExitPlanMode` → Plan
    - the first file edit outside `docs/` → Work
    - a review skill or review subagent → Review
    - `gh pr create` or an open PR on the branch → Ship
    - a merged PR → Merged
  - Only the user or a skill moves a chat back to an earlier stage. That prevents flapping.
- **Routes are config.** A `routes` section in `departments.json` defines stations with a label, skill or prompt, and palette colour. The CE route is the built-in default. `nextSteps` in `next-step.ts` becomes the source of Ship's stops instead of its own strip.
- **The renderer gets a new shell and keeps the office as an optional view.**
  - `App.vue` mounts `Shell.vue`, which holds the title bar, the view router (hub or workspace), the overlays (switcher, ⌃Tab, ⌘K) and the notifications.
  - `Office.vue` stays reachable through a setting during Phases B–D.
  - `projection.ts` and `inbox.ts` lose their `three` and office imports first (U5), so the shell doesn't load the 3D bundle.
- **The network is drawn by a pure layout function plus SVG.** `src/renderer/hub/network.ts` turns lines into positioned segments, stops, pills and labels (repo hubs, lanes, stage columns, branches), and `Network.vue` renders them.
  - Rationale: layout can be unit-tested, SVG keeps every stop focusable, and the prototype's geometry (`scratchpad/gen/hub.py`) transfers directly.
- **Workspace state is a per-chat JSON column.** A `workspace` column holds the workbench state, tabs, sizes, the line's expanded state and scroll. Terminals get a small per-chat registry in `main/terminal.ts`: several shells per chat, each with a name and folder. Their scrollback is persisted, capped at 200 KB, in a `terminals` table.
- **Side chats reuse forking.**
  - A side chat is a chat with `parentId`, `forkStopId` and `forkMessageId`. Branching at the tip uses `resume` plus `forkSession`.
  - Branching at an earlier stop needs a resume point. U10 first checks the SDK for a resume-at-message option. If there isn't one, the office writes a trimmed copy of the transcript up to that message and resumes from it, and files come from `rewindFiles` applied in a fresh worktree.
- **The intake is a host service with its own table, and it scans with the user's connectors.**
  - GitHub and Linear use the existing integrations (`gh`, the Linear key).
  - Sentry, Gmail and Slack are read by a headless scanner session. It's an Agent SDK query run with the user's configured MCP servers and an allowlist of their read-only tools, and it returns strict JSON items. Nothing else in the app talks to those APIs.
  - Claude Code sessions come from the outside watcher, specifically the "next step" notes at the end of sessions. Office follow-ups come from the line store, such as review findings left for later.
  - Rationale: this reuses auth the user already granted, and adds no OAuth apps for Gmail or Slack.
- **Judging is Jev first and Haiku as fallback, and neither is ever shown.**
  - `departments/jev.ts` gains a `judge(item, context)` call with several questions:
    - `importance`
    - `agent_can_do`
    - `belongs_to` (the choices are the current lines, the repositories, new or none)
    - `kind`
  - The user's rules become the criteria text. Without a Jev key, or below 0.5 confidence, a Haiku call answers the same questions.
  - Merging keys on shared entities (PR number, ticket id, file path, Sentry issue id), then on a `same_as` question for near matches.
- **Kickoffs are drafted by one short model call per suggestion, not per item.** A suggestion stores its repository, starting stage, skill and one-sentence prompt. `startChat` gains `route` and `origin` options so a started suggestion keeps its sources for "Connected to this line".
- **"Low risk" is enforced by the host, not promised by a prompt.** A line started for you runs with all of these:
  - a mandatory new worktree
  - permission mode `default`
  - deny rules for `git push`, `gh pr create|merge|comment`, deploy scripts named in config, and any MCP tool not on the read-only allowlist
  - a `canUseTool` guard that turns every other ask into a Jump in request

  The deny list lives in `src/main/permissions/guardrails` next to the dangerous-request rules.
- **Acting as the user is always a request.** MCP tools that send (Slack post, Gmail send, GitHub comment, Linear update) are classified as outward actions and always raise a request, even in accept-edits mode. The request card shows the exact content, with Allow once, Edit and Don't post.

## Open Questions

### Resolved During Planning

- Where the line lives: in the host, persisted, sent in the snapshot and patches.
- Where tasks come from: plan units first, then `TodoWrite`.
- How connectors are read: the existing integrations plus a read-only scanner session with the user's MCP servers.
- How low risk is guaranteed: a worktree, deny rules and the request guard, enforced in the host.

### Deferred to Implementation

- Whether the SDK exposes resume-at-message (U10). The transcript-trim fallback is specified either way.
- The exact default rules and importance thresholds (U12). They'll be tuned on Aaron's real traffic in the first week.
- How the app preview finds a dev server (U8): the first `localhost:<port>` printed in the chat's terminals, or a `preview` entry in config.
- Whether Merged lines leave the map after 24 hours or at the next day's first scan (U7).

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification.*

```mermaid
flowchart LR
  subgraph Host
    SES[sessions/normalize<br/>+ todos event] --> LS[store/line<br/>stages, stops, tasks]
    LS --> DB[(chats.line, chats.workspace,<br/>terminals, items)]
    SRC[intake sources<br/>gh · Linear · scanner session · outside · follow-ups] --> IN[intake<br/>hourly + on event]
    IN --> J[judge: Jev → Haiku fallback<br/>merge by entities]
    J --> SG[suggestions + drafted kickoffs]
    SG --> AUTO{low risk and<br/>rule allows?}
    AUTO -- yes --> START[startChat in new worktree<br/>guarded, startedForYou]
    AUTO -- no --> SG
    START --> SES
  end
  LS -- snapshot + chatPatches --> R
  SG -- intake event --> R
  subgraph Renderer
    R[state: projection, needs] --> HUB[Hub: Network + Triage]
    R --> WS[Workspace: line column, open stop,<br/>right column, workbench]
    R --> NAV[Switcher · ⌃Tab · notifications]
  end
```

A chat's stage over time:

```mermaid
stateDiagram-v2
  [*] --> Brainstorm: ce:brainstorm / picked
  [*] --> Plan: plan mode / ce:plan
  [*] --> Work: first edit / ce:work
  Brainstorm --> Plan: skill or user
  Plan --> Work: skill, user or first edit
  Work --> Review: review skill / reviewers
  Review --> Ship: PR opened
  Ship --> Merged: PR merged
  Merged --> Compound: ce:compound
  Review --> Work: only user or skill
```

## Implementation Units

```mermaid
flowchart TB
  U1[U1 Line model] --> U3[U3 Routes and next stop]
  U2[U2 Tasks capture] --> U1
  U1 --> U7[U7 Hub]
  U4[U4 Workspace + terminals persistence] --> U8[U8 Workspace]
  U5[U5 Decouple renderer state] --> U6[U6 Shell and navigation]
  U6 --> U7
  U6 --> U8
  U6 --> U9[U9 Switcher, ⌃Tab, notifications]
  U3 --> U8
  U8 --> U10[U10 Side chats and branching]
  U7 --> U10
  U11[U11 Intake store and sources] --> U12[U12 Judging, merging, kickoffs]
  U12 --> U13[U13 Started for you]
  U12 --> U14[U14 Suggestions in the hub, rules]
  U7 --> U14
  U13 --> U15[U15 Companion parity, e2e, retire office default]
  U14 --> U15
  U10 --> U15
  U9 --> U15
```

### Phase A: the data a line needs

- [ ] **Unit 1: Line model**

**Goal:** Every chat, hosted or companion, has a persisted line: the stages it entered and when, its stops, its current stop and its tasks. It travels in the snapshot and patches.

**Requirements:** R5–R7, R11, R19, R20

**Dependencies:** U2

**Files:**
- Create: `src/shared/line.ts`, `src/main/store/line.ts`
- Modify: `src/shared/chat.ts` (`line` on `ChatFields`), `src/main/store/db.ts` (`line` JSON column), `src/main/store/chats.ts` (feed events, persist), `src/main/outside/visitors.ts` (lines for companion chats), `src/main/sessions/normalize.ts` (skill-started events if missing)
- Test: `tests/main/line.test.ts`, `tests/main/line-store.test.ts`

**Approach:**
- `advance(line, event, route)` is a pure reducer over `ChatEvent`s and PR state, following the detection rules in Key Technical Decisions. It never moves backwards unless the event is a skill run or a user pick.
- Work stops come from the tasks (U2). Ship stops come from `nextSteps` (U3).
- The store applies the reducer on each event, saves only when the line changes, and emits a `line` patch.
- For companion chats, the reducer replays the transcript once on discovery, then follows new lines.

**Patterns to follow:** the host-owned rooms in `src/main/departments/rooms.ts`, and the patch emission in `store/chats.ts`.

**Test scenarios:**
- Happy path: running `ce:brainstorm`, then `ce:plan`, then the first edit gives Brainstorm → Plan → Work with timestamps.
- Happy path: a chat whose first action is an edit enters at Work, and Brainstorm and Plan are marked skipped.
- Edge case: after Work, a read-only question to the agent doesn't move it back.
- Edge case: a user pick of Plan from Review moves it back and adds a new stop.
- Happy path: `gh pr create` in a Bash tool moves it to Ship, and a merged PR moves it to Merged.
- Integration: the line survives a restart. Rebuild the store from `office.db` and get an equal line.
- Integration: replaying a companion transcript fixture gives the same line as live events.

**Verification:** The snapshot for a fake-engine chat carries a line whose current stop follows the script's stages.

- [ ] **Unit 2: Tasks capture**

**Goal:** A chat knows its task list and the current task's sub-steps.

**Requirements:** R11, R13

**Dependencies:** None

**Files:**
- Modify: `src/main/sessions/normalize.ts` (a `todos` event from `TodoWrite` input), `src/shared/line.ts` (`Task`)
- Create: `src/main/store/plan-tasks.ts` (reads the implementation units from a plan file the chat wrote or read)
- Test: `tests/main/plan-tasks.test.ts`, `tests/main/normalize.test.ts` (extend)

**Approach:**
- The plan parser reads the `- [ ] **Unit N: …**` and `- [x]` headings in `docs/plans/*.md`, the format used in this repo. Other plan formats fall back to the todo list.
- A task's done state comes from plan checkboxes, or from todo status for todo-based tasks.
- Sub-steps are the todo items while that plan task is current.

**Test scenarios:**
- Happy path: this plan file yields 15 tasks with the right titles, all open.
- Happy path: a `TodoWrite` with three items, one in progress, gives three tasks with the right current task.
- Edge case: a plan file with no units falls back to todos.
- Edge case: a todo list replaced by a shorter one drops the removed items.

**Verification:** The fake engine's `TodoWrite` script shows as tasks on the chat's line.

- [ ] **Unit 3: Routes and the next stop**

**Goal:** Routes come from config, with the CE route as the default. Each stage knows its skill or fallback prompt, and a finished stage offers "Continue to <stage>".

**Requirements:** R19, R21, R22

**Dependencies:** U1

**Files:**
- Modify: `src/shared/departments.ts` (the `routes` type), `src/main/departments/config.ts` (parse `routes`), `src/main/workflow/next-step.ts` (Ship's stops, the next-stop suggestion), `src/shared/workflow.ts`
- Test: `tests/main/routes.test.ts`, `tests/main/next-step.test.ts` (extend)

**Approach:**
- The built-in route is Brainstorm, Plan, Work, Review, Ship, Compound, each with its `ce:*` skill and a plain-prompt fallback.
- A room's `route` picks a named route.
- "Looks finished" means the stage's skill ended, its document was written, and the turn is done.
- The suggestion carries the next stage's skill and what the last stage produced (the document path).
- `commands.ship/fixCi/answerComments` map onto Ship stops.

**Test scenarios:**
- Happy path: with no config, a chat gets the CE route.
- Happy path: a config route with three stations replaces it for its room.
- Edge case: a missing skill uses the fallback prompt, and the suggestion says it's a prompt.
- Happy path: Plan finished with `docs/plans/x.md` written suggests Work with `/ce:work docs/plans/x.md`.
- Error path: an invalid route entry is skipped and named in the config errors.

**Verification:** A fake-engine chat that finishes Plan exposes a next-stop suggestion in its snapshot.

- [ ] **Unit 4: Workspace and terminals persistence**

**Goal:** Each chat keeps its workspace state and several named terminals across switches and restarts.

**Requirements:** R14, R15

**Dependencies:** None

**Files:**
- Modify: `src/main/store/db.ts` (a `workspace` JSON column and a `terminals` table), `src/main/terminal.ts` (several shells per chat, names, persisted scrollback), `src/shared/ipc.ts`, `src/main/host/forwarded.ts`, `src/main/host/core.ts`
- Test: `tests/main/terminal.test.ts` (extend), `tests/main/workspace-store.test.ts`

**Approach:**
- `setWorkspace(chatId, state)` is debounced and validated against a small schema.
- Terminals are keyed by `chatId` and `name`. Scrollback is flushed to the table on exit and every 10 seconds while dirty, capped at 200 KB.
- On restart, the saved terminals reopen in their folder, with a "restarted" line written into the buffer before new output.

**Test scenarios:**
- Happy path: two terminals for one chat keep separate buffers.
- Integration: after closing and reopening the store, the terminals list and scrollback come back, with the divider.
- Edge case: scrollback over 200 KB keeps the newest 200 KB.
- Error path: an invalid workspace payload is rejected, and the stored state stays as it was.

**Verification:** A chat with a shell and an open workbench restores both after an app restart in e2e (U15).

### Phase B: the shell, the hub and the workspace

- [ ] **Unit 5: Decouple renderer state from the office**

**Goal:** `projection` and the needs model work without `three` or office modules.

**Requirements:** R4, R8

**Dependencies:** None

**Files:**
- Modify: `src/renderer/state/projection.ts`, `src/renderer/state/inbox.ts` (split it)
- Create: `src/renderer/state/needs.ts` (Jump in, Review, Your call and Finished from chats; suggestions are added in U14)
- Test: `tests/renderer/needs.test.ts`, `tests/renderer/projection.test.ts` (extend)

**Approach:**
- Colour and layout derivations move to `office/` adapters that the office view still uses.
- The needs model:
  - **Jump in:** pending requests and questions.
  - **Review:** a stage that finished with an output (a plan written, a fix ready meaning Work done with tests passing, results, an open PR awaiting you).
  - **Your call:** defaults in use (answered questions where the agent chose), next-stop suggestions that need a decision, and later, intake suggestions.
  - **Finished today:** lines merged or done today.

**Test scenarios:**
- Happy path: a chat with an `AskUserQuestion` request appears once in Jump in with its options.
- Happy path: a chat whose Plan finished with a document appears in Review with "Plan ready".
- Edge case: a request answered in another window leaves Jump in on the next patch.
- Integration: importing `state/projection` in a client test doesn't load `three`. Assert the module graph.

**Verification:** `pnpm typecheck` passes, and the office view still renders its inbox from the split modules.

- [ ] **Unit 6: Shell and navigation**

**Goal:** A new app shell with the title bar, the hub and workspace views, back and forward, Esc, ⌘K, and the office behind a setting.

**Requirements:** R1, R3, R10, R18 (⌘K)

**Dependencies:** U5

**Files:**
- Create: `src/renderer/Shell.vue`, `src/renderer/shell/TitleBar.vue`, `src/renderer/shell/router.ts`, `src/renderer/theme.css` (dark and light tokens, Geist)
- Modify: `src/renderer/App.vue` (mount Shell, with an Office setting), `src/renderer/styles.css`, `src/renderer/state/keys.ts`
- Test: `tests/renderer/router.test.ts`, `tests/renderer/keys.test.ts` (extend)

**Approach:**
- The router state is `{ view: 'hub' } | { view: 'chat', chatId }`, with a history stack for ‹ › and Esc going to the hub.
- `navigate()` events from main (notification clicks) route to the chat.
- Theme tokens follow R3's four colour roles. Stage colours come from the route config.
- The existing ⌘K palette is reused, and extended to files and decisions later.

**Test scenarios:**
- Happy path: opening chat A, then B, then going back returns to A, and forward returns to B.
- Happy path: Esc in a chat goes to the hub. Esc in the hub does nothing.
- Edge case: a `navigate` to an unknown chat stays put and shows a notice.
- Happy path: with the Office setting on, the office view mounts instead of the hub.

**Verification:** The app boots into the hub with the fake engine, and every existing e2e flow that doesn't rely on the canvas still passes.

- [ ] **Unit 7: The hub**

**Goal:** The network and the triage column in one view.

**Requirements:** R4–R9

**Dependencies:** U1, U6

**Files:**
- Create: `src/renderer/hub/network.ts` (pure layout), `src/renderer/hub/Network.vue`, `src/renderer/hub/Triage.vue`, `src/renderer/hub/TriageRow.vue`, `src/renderer/hub/StartSomething.vue`
- Modify: `src/renderer/state/needs.ts` (selection linking)
- Test: `tests/renderer/network.test.ts`, `tests/renderer/triage.client.test.ts`

**Approach:**
- The layout groups lines by repository (the room registry gives repositories). Each group has a hub at the left, and lines fan out at 45° into lanes.
- Stage columns are shared. Work's width is split by that line's task count.
- A collapsed line gets a pill ("N done"), its current stop, and a faint remainder. An expanded line shows every stop.
- Side chats start at their parent's fork stop. Skipped stages are dashed.
- A connector-origin square is shown when the line has `origin` items (U14).
- The triage rows reuse the request answering from `Inbox.vue`, through `resolveRequest`, with number keys.
- Start something calls `startChat` with the repository, stage and prompt.

**Patterns to follow:** the prototype geometry in `scratchpad/gen/hub.py` from the design session (copied into the plan's references when implementing), and `panels/Inbox.vue` for answering.

**Test scenarios:**
- Happy path: three repositories with 1, 4 and 6 lines lay out without overlapping labels. Assert the label boxes don't intersect.
- Happy path: a line that entered at Work draws a dashed lead through Brainstorm and Plan.
- Happy path: a side chat forks at its parent's stop x and gets its own lane.
- Edge case: a repository with 12 lines stays within the view height by compressing lane spacing down to a minimum, then scrolling.
- Happy path: answering the top Jump in row with key 1 resolves the request and removes the row.
- Integration: hovering a row sets the selected line, and the network highlights it.

**Verification:** The demo source renders the hub with every row type. A screenshot test matches the reviewed baseline.

- [ ] **Unit 8: The workspace**

**Goal:** One chat with its squeezed line, the open stop's page, the right column and the workbench.

**Requirements:** R10–R15, R19–R21 (next-stop offer), R30 (outward request card)

**Dependencies:** U1, U3, U4, U6

**Files:**
- Create: `src/renderer/workspace/Workspace.vue`, `workspace/LineColumn.vue`, `workspace/StopPage.vue`, `workspace/RightColumn.vue`, `workspace/Workbench.vue`, `workspace/OutwardCard.vue`
- Modify: `src/renderer/panels/Chat.vue` (extract what's reusable; drop `AgentEntry`), `panels/chat/Transcript.vue` (scope to a stop's rows, fold earlier stops), `panels/chat/Composer.vue` (the "Continue from…" mode, added in U10)
- Test: `tests/renderer/stop-rows.test.ts`, `tests/renderer/workspace.client.test.ts`

**Approach:**
- The line column draws finished stops as ticks, the open stop as a tall bar in its stage colour, and faint future ticks. ⌘L expands it into the stop list with one-line outcomes.
- The stop page shows the stop's rows, from the stop's first row to the next stop's first row. Earlier stops fold into one row each. Tool groups keep today's `ToolGroup` collapse, and connector tools get a source label.
- The right column:
  - **Open:** pending requests, answered defaults with Keep / Change (Change sends a correction message), and blockers.
  - **Tasks:** the tasks with sub-steps.
  - Tests and changes, from `getShipIt` and git status.
  - **Connected:** origin items and the PR.
- The workbench tabs are:
  - **Preview:** a webview on the detected localhost port.
  - **Changes:** reuses `panels/Review.vue`.
  - **Terminals:** U4.
  - **Documents:** brainstorm and plan files rendered with `markdown.ts`.
- Workspace state is saved through U4 on change.

**Test scenarios:**
- Happy path: a chat at task 6 of 9 shows 7 finished ticks, a Work bar and 5 future ticks.
- Happy path: the stop page for task 6 contains only rows after task 6 started.
- Happy path: an answered `AskUserQuestion` with a chosen default shows in Open with Keep and Change.
- Happy path: a Slack send tool request renders as an outward card with the message text and Allow once, Edit and Don't post.
- Integration: switching away and back restores the workbench tab and scroll position.

**Verification:** The existing chat-panel e2e flows (send, answer a plan, answer a question, terminal) pass against the workspace.

- [ ] **Unit 9: Switcher, ⌃Tab and notifications**

**Goal:** Getting between chats without a sidebar, and answering other chats' requests where they appear.

**Requirements:** R16–R18

**Dependencies:** U6

**Files:**
- Create: `src/renderer/shell/Switcher.vue`, `shell/CtrlTab.vue`, `shell/Notifications.vue`
- Modify: `src/renderer/state/keys.ts` (⌃Tab hold and release, ⌥Y / ⌥N), `src/main/notify/index.ts` (align desktop notifications with in-app ones, and skip them while the app is focused on that chat)
- Test: `tests/renderer/switcher.client.test.ts`, `tests/renderer/keys.test.ts` (extend)

**Approach:**
- The switcher groups are needs you, running and waiting. Rows show the state in words and a small line, drawn by the collapsed-line renderer from U7. Side chats are indented.
- ⌃Tab orders needs-you first, then by most recent focus.
- Notifications stack in the bottom right. The newest is shown in full, older ones collapse to one line, and answered ones animate away. They never take focus.

**Test scenarios:**
- Happy path: holding ⌃ and pressing Tab twice selects the third entry, and releasing opens it.
- Happy path: a permission request from another chat shows a notification, and ⌥Y allows it through `resolveRequest`.
- Edge case: a request for the chat in view doesn't raise a notification, because it's in Open already.
- Edge case: three notifications show one in full and two collapsed.

**Verification:** e2e: a request raised in a background chat is answered from the notification without leaving the current chat.

### Phase C: branching

- [ ] **Unit 10: Side chats and branching from any stop**

**Goal:** Branch from any stop into a side chat with its own worktree, see it on the lines, and reconnect with a summary, code or both.

**Requirements:** R23–R25

**Dependencies:** U7, U8

**Files:**
- Modify: `src/shared/chat.ts` (`parentId`, `forkStopId`, `forkMessageId`, `reconnects`), `src/main/store/db.ts`, `src/main/store/chats.ts` (a `branch` command, the move to a worktree on first edit, `reconnect`), `src/main/sessions/manager.ts` (resume at a message, or the trimmed-transcript fallback), `src/main/worktrees/create.ts` (create from a checkpoint)
- Create: `src/main/store/reconnect.ts`
- Test: `tests/main/branch.test.ts`, `tests/main/reconnect.test.ts`

**Approach:**
- Branching at the tip uses `resume` plus `forkSession`. Branching at an earlier stop uses resume-at-message if the SDK offers it; otherwise it writes a trimmed JSONL copy up to the stop's last message and resumes from that.
- Files for an earlier stop come from a new worktree on the parent's branch, with `rewindFiles` to the stop's message applied inside it.
- A side chat that only reads stays in the parent's folder. The first edit or non-read-only Bash pauses the tool call, creates the worktree, restarts the engine there with `resume`, and replays the call.
- Reconnect has three parts:
  - **Summary:** a model call inside the side chat, shown to the user for editing.
  - **Code:** commit the side chat's work (after asking), then merge it into the parent's branch. Conflicts are listed with "Hand to <parent>".
  - **The parent's line** records an interchange at the reconnect.

**Execution note:** Start with a spike test against the real SDK to settle resume-at-message before building the fallback.

**Test scenarios:**
- Happy path: branching at the tip gives a new chat whose first message sees the parent's context, and the parent's transcript is unchanged.
- Happy path: branching at an earlier stop gives a chat whose context ends at that stop, with files as they were then.
- Happy path: a side chat's first edit moves it to `.claude/worktrees/<slug>` before the edit lands.
- Happy path: reconnect with the code merges cleanly and the parent's line gains an interchange.
- Error path: reconnect with conflicting code lists the files and leaves both branches untouched.
- Edge case: reconnecting while the parent is mid-turn queues the summary until the turn ends.

**Verification:** e2e: branch, edit and reconnect from the workspace, with the network showing the branch and its rejoin.

### Phase D: connectors and suggested work

- [ ] **Unit 11: Intake store and sources**

**Goal:** A host service that collects items from every source hourly and on events, into an `items` table.

**Requirements:** R26

**Dependencies:** None

**Files:**
- Create: `src/main/intake/index.ts` (the scheduler), `src/main/intake/store.ts`, `src/main/intake/sources/github.ts`, `sources/linear.ts`, `sources/scanner.ts` (the headless session for Sentry, Gmail and Slack through the user's MCP servers), `sources/sessions.ts` (next-step notes from Claude Code sessions), `sources/followups.ts` (review findings and "later" notes from the office's lines), `src/shared/intake.ts`
- Modify: `src/main/store/db.ts` (the `items` table), `src/main/host/core.ts`, `src/shared/ipc.ts` (an `intake` event), `src/main/workflow/review-requests.ts` (feed the intake instead of its own queue)
- Test: `tests/main/intake-store.test.ts`, `tests/main/intake-sources.test.ts`, `tests/main/scanner.test.ts`

**Approach:**
- An item is `{ source, externalId, url, title, excerpt, author, at, entities: { repo?, pr?, ticket?, files?, sentryIssue? } }`, deduped by `source + externalId`.
- The scheduler runs hourly, on app start, and when a source signals (a GitHub notification, or a companion session ending).
- The scanner session runs with `settingSources` so the user's MCP servers load, and with `allowedTools` limited to a read-only list per connector (for example the Sentry `search_issues` and Gmail `search_threads` tools). It never gets send, update or trash tools. It returns JSON that's validated against the item schema, and anything invalid is dropped and logged.
- Sources without credentials are skipped quietly and shown as "not connected" in Settings.

**Test scenarios:**
- Happy path: the fake `gh` returns two PR notifications and a review request, and three items are stored.
- Happy path: the scanner's JSON with a Sentry issue and a Gmail thread stores two items with entities.
- Error path: scanner output that isn't valid JSON stores nothing and logs once.
- Edge case: a repeated scan of the same items stores nothing new.
- Integration: the scanner session is created with no send-capable tools. Assert the `allowedTools` passed to the fake engine.

**Verification:** After a scan with fakes, the `items` table holds each item once, with entities.

- [ ] **Unit 12: Judging, merging and drafted kickoffs**

**Goal:** Each item gets an importance, where it belongs, and whether an agent can do it. Related items merge. The ones worth doing get a drafted kickoff.

**Requirements:** R27–R29

**Dependencies:** U11

**Files:**
- Modify: `src/main/departments/jev.ts` (`judge()` with several questions; rules as criteria)
- Create: `src/main/intake/judge.ts` (Jev, then the Haiku fallback), `src/main/intake/merge.ts`, `src/main/intake/kickoff.ts`, `src/main/intake/rules.ts`
- Test: `tests/main/judge.test.ts`, `tests/main/merge.test.ts`, `tests/main/kickoff.test.ts`

**Approach:**
- The questions:
  - `importance`: act now, today, this week, FYI or none
  - `agent_can_do`: yes, partly or no
  - `belongs_to`: current line ids, repositories, new or none
  - `kind`: bug, review, reply, feature or question
- Rules are plain sentences stored in settings. The user's rules are appended to the criteria, and learned ones come from "Not now" and "Never for this kind".
- Merging uses shared entities first, then a `same_as` Jev question against the open groups in the same repository.
- A group becomes a suggestion when its importance is today or higher and an agent can do it. Its kickoff (repository, start stage, skill, one-sentence prompt) comes from one short model call.
- Everything else is placed on the list or left out, and stays reviewable.

**Test scenarios:**
- Happy path: a Sentry issue with 34 users after a release, under the rule "more than 10 users after a release is act now", is judged act now.
- Happy path: a Sentry issue, a Slack message and a PR that share `saved-cards.ts` and PR #214 merge into one group.
- Edge case: Jev times out, the Haiku fallback answers, and the judgement is marked with its source for logs only.
- Edge case: confidence below 0.5 on `belongs_to` gives "new line", not a guess.
- Happy path: "Never for this kind" on a Dependabot item adds a learned rule, and the next Dependabot item is left out.
- Happy path: a kickoff for a bug group starts at Work, with a prompt naming the file and the issue.

**Verification:** Replaying a recorded day of items (a fixture) gives a stable number of suggestions, list entries and left-out items.

- [ ] **Unit 13: Started for you**

**Goal:** Low-risk suggestions start themselves under limits the host enforces.

**Requirements:** R31, R32

**Dependencies:** U12

**Files:**
- Create: `src/main/intake/autostart.ts`, `src/main/permissions/guardrails/started-for-you.ts`
- Modify: `src/main/store/chats.ts` (a `startedForYou` flag, and `origin` items), `src/main/permissions/registry.ts` (apply the guard to flagged chats), `src/shared/guardrails.ts`
- Test: `tests/main/autostart.test.ts`, `tests/main/started-for-you-guard.test.ts`

**Approach:**
- A suggestion is low risk when its kind is a bug, review or update, its repository is known, and the rule set allows auto-start for it. The default rule is Sentry act-now issues and Dependabot security updates.
- Autostart always creates a worktree and sets permission mode `default`. It adds deny rules for push, PR create, merge and comment, deploy commands from config, and all non-allowlisted MCP tools. It marks every other ask as a Jump in request.
- A cap limits how many lines can be started for you at once (two by default), and nothing starts while the machine is on battery below 20%.
- Stop ends the session and keeps the worktree for housekeeping.

**Test scenarios:**
- Happy path: an act-now Sentry group starts a line in a new worktree, flagged, and its origin lists the group's items.
- Error path: the flagged chat's `git push` is denied without asking, and shows as a denied step.
- Error path: the flagged chat's attempt to use a Slack send tool raises a request instead of running.
- Edge case: a third low-risk suggestion while two are running waits in Your call.
- Happy path: Stop ends the session, and the line shows as stopped.

**Verification:** e2e with the fake engine: a fixture Sentry item produces a started-for-you line that pauses at its push request.

- [ ] **Unit 14: Suggestions in the hub, and rules**

**Goal:** Suggestions, the list and what was left out appear in the hub. Rules can be edited. Chats show what they're connected to.

**Requirements:** R7 (origin marks), R8 (Your call), R13 (Connected), R28, R29

**Dependencies:** U7, U12

**Files:**
- Modify: `src/renderer/state/needs.ts`, `src/renderer/hub/Triage.vue`, `src/renderer/hub/Network.vue` (origin squares), `src/renderer/workspace/RightColumn.vue` (Connected), `src/renderer/panels/Accounts.vue` (or a new Settings section: sources and rules)
- Create: `src/renderer/hub/Suggestion.vue`, `src/renderer/hub/ListSheet.vue`
- Test: `tests/renderer/suggestions.client.test.ts`

**Approach:**
- A suggestion row shows its title, "worth starting?", source squares, Start and Not now. Expanding it shows the kickoff with Edit and Why?. Why? lists the items in words and never shows scores.
- The list and the left-out items open as sheets from the Finished-style rows at the foot of the column.
- Rules are edited as sentences, with learned ones marked and removable.

**Test scenarios:**
- Happy path: a suggestion appears in Your call with its source squares, and Start opens the new chat with the kickoff prompt.
- Happy path: Not now moves it to the list. "Never for this kind" removes it and adds a learned rule.
- Happy path: a chat started from a suggestion shows its items under Connected, with links.
- Edge case: with no connected sources, the hub shows no suggestions area and no empty-state noise.

**Verification:** The demo source shows suggestions, list and left-out sheets. A screenshot test matches.

### Phase E: parity, tests, and the default switch

- [ ] **Unit 15: Companion parity, e2e, and retiring the office as home**

**Goal:** Companion chats get the same lines and rows. The whole flow is covered end to end. The hub becomes the default.

**Requirements:** R33, and the success criteria

**Dependencies:** U9, U10, U13, U14

**Files:**
- Modify: `src/main/outside/visitors.ts`, `src/renderer/workspace/Workspace.vue` (no message box for companion chats; copy-command next steps), `src/renderer/App.vue` (the hub as default, the Office setting defaulting to off), `README.md`
- Create: `tests/e2e/hub.spec.ts`, `tests/e2e/workspace.spec.ts`, `tests/e2e/notifications.spec.ts`, `tests/e2e/branch.spec.ts`, `tests/e2e/intake.spec.ts`
- Modify: existing e2e specs that locate `canvas` or the Inbox aside

**Approach:**
- Existing specs move to hub and workspace locators, with role-based locators throughout.
- The README drops the office tour for the hub and workspace, explains rules and started-for-you limits, and documents `routes` in `departments.json`.

**Test scenarios:**
- Integration: a companion session fixture appears on the network with its line and in Jump in when it asks for permission.
- Integration: after a restart, the chat opens with the same workbench tab, terminals and scroll.
- Integration: an act-now Sentry fixture produces a started-for-you line that reaches Review with "Fix ready".
- Integration: branch, reconnect and merge from the workspace, with the parent's line updated.

**Verification:** `pnpm typecheck`, `pnpm test` and `pnpm test:e2e` pass. Aaron uses the build for a day with the Office setting off.

## System-Wide Impact

- **Interaction graph:**
  - Every new command is added to `Commands` in `shared/ipc.ts`, `main/host/forwarded.ts` and `main/host/core.ts`.
  - `notify` and the permission broker gain the started-for-you guard and the outward-action classification.
  - `review-requests.ts` feeds the intake instead of its own queue.
- **Error propagation:**
  - Scanner, Jev and kickoff failures never block chats. They log once, keep the last good items, and show a source as "not connected" in Settings only.
  - Guard denials show as denied steps in the chat.
- **State lifecycle risks:**
  - The `line` column must be updated in the same save as the state change that caused it, so a crash can't leave a line ahead of its chat.
  - Side chat worktrees join housekeeping's cleanup.
  - Started-for-you worktrees are never deleted without the existing safety checks.
- **API surface parity:** companion chats get lines and rows through `visitors.ts`. Anything added to hosted chats' `ChatFields` needs a companion value or an explicit absence.
- **Integration coverage:** the e2e specs in U15 cover the cross-layer flows: a request from a background chat answered in a notification, a restart restoring the workspace, and an intake item becoming a started line.
- **Unchanged invariants:**
  - Permission decisions still go through the one `resolveRequest` path.
  - Dangerous-request rules still need a click.
  - `departments.json` stays backwards compatible.
  - The office view keeps working behind its setting until it's removed in a later plan.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| The SDK has no resume-at-message, and trimmed transcripts break resume | Spike first in U10. If both fail, earlier-stop branching starts a fresh chat seeded with a summary of the conversation up to the stop, and the UI says so |
| The scanner session costs tokens every hour | Use Haiku, limit to new items since the last scan, skip sources with no changes (GitHub and Linear are checked directly first), and show the monthly scan cost in Settings |
| MCP servers for Gmail, Slack or Sentry aren't configured, or expose tools with different names | Per-connector read-only allowlists keyed by server name, with a "not connected" state. Recorded fixtures of the tool names are checked into `tests/fixtures/mcp/` |
| Jev's multi-question calls are slower than 3 seconds | Judge in the background with no UI wait. Allow 10 seconds per call for intake, with the Haiku fallback |
| Started-for-you lines do something the user didn't expect | Host-enforced guard, a worktree always, a concurrency cap of two, Stop on every row, and a default rule set limited to Sentry act-now issues and Dependabot security updates |
| The hub's network gets crowded with many lines | Lane compression with a minimum spacing, then scroll. Merged lines leave after a day. Filters by state stay in ⌘K |
| The renderer rewrite breaks today's flows | The office stays behind a setting through Phase D. Phase B keeps the existing chat components, and the e2e flows are migrated rather than rewritten |

## Documentation / Operational Notes

- README: hub, workspace, routes config, rules, started-for-you limits, and connectors setup (which MCP servers are read, and that only read tools are used).
- Settings: sources with their state, rules, started-for-you on or off, and the concurrency cap.
- Per `CLAUDE.md`, each phase lands on `main` after `pnpm typecheck` and `pnpm test`, and the user updates the installed app from the Update button.

## Sources & References

- **Origin document:** `docs/brainstorms/2026-09-27-metro-workspace-requirements.md`
- Design canvas: https://claude.ai/artifact/VriJh789MbBDismRPxar73 (Round 14 hub; Rounds 8–10 chat view, switcher, connectors)
- Related plans: `docs/plans/2026-09-25-001-feat-rooms-for-any-setup-plan.md` (host-owned structure in the snapshot)
- Related requirements: `docs/brainstorms/2026-09-27-open-source-release-requirements.md` (companion agents, adapters)
- Code: `src/shared/chat.ts`, `src/main/store/db.ts`, `src/main/store/chats.ts`, `src/main/sessions/manager.ts`, `src/main/departments/jev.ts`, `src/main/workflow/*`, `src/main/outside/*`, `src/renderer/panels/chat/*`, `src/renderer/state/*`
