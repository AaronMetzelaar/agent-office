# The four ideas (Round 15). Same look, same components — different organising principle.

Each idea's design document board (`<PREFIX>-00-Idea.dc.html`, 1440×1800) contains, tersely (no paragraph over two lines, name at 28px/700 not italic, sections separated by space and hairlines, no card grids):
1. Name + one-sentence brief + the principle in one line.
2. **The story**: why this suits a future of swarms where the user's attention and fast, high-quality decisions are the premium — 4–5 short bullets. Then **"Why this, not the other three"** — one line each naming Scale, Signal box, Stations, Flow — and one honest trade-off.
3. **Principles** (4–6, each a short imperative with a one-line gloss).
4. **The system**: the shared base (tokens, type — shown compactly as swatches and a specimen, noting "shared across all four ideas") and what THIS idea adds: its signature pattern(s), drawn as components in the existing style.
5. **How screens relate** in this idea (a small diagram: hub, chat, stop, settings, web, mobile and how you move between them).
6. **Scaling**: the same screen at 10 lines vs 100 lines (small drawn thumbnails) — what changes.
7. **3D metroline view** in this idea: small vignette + where it's toggled.
8. **Codebase map** in this idea: small specimen.
9. **Form factors**: desktop / web / mobile — one line each on the platform's strength and what this idea does with it.

---

## A · SCALE (prefix `SC-`) — "One line, every zoom"
**Principle:** there is only one object, the line. Every screen is the same lines at a different zoom level, and moving around the product is zooming.
- Zoom levels: **Fleet** (repos as trunks with counts: "storefront · 6 lines · 2 need you") → **Network** (the hub: every line) → **Line** (the chat view: the line turned vertical on the left, earlier stops as the collapsed blocks — which ARE the line at this zoom) → **Stop** (the open stop's page) → **Step** (a tool call, a diff, the codebase footprint of the stop).
- Navigation: ↵ / click zooms in, Esc zooms out one level, ⌘0 jumps to Network; a small zoom path in the title bar ("Network ▸ storefront ▸ Checkout: saved cards ▸ Review") replaces breadcrumbs. Needs-you rings **propagate up**: a trunk at Fleet zoom shows "2" in amber.
- Signature pattern: the **zoom path** in the title bar + the **transition**: a line selected on the hub straightens and turns vertical to become the chat's left line (show as a 4-frame storyboard strip on the Idea board).
- Hub (SC-01): the existing hub with a zoom control top-left of the map (Fleet · Network · Line) and the triage column right; show the Network zoom with one line selected (Checkout: saved cards highlighted, its row in Review highlighted). Include a compact Fleet mini-map at the top-left corner of the map (the zoom-out preview).
- Session (SC-02): the existing chat view (U3-Resting) with the zoom path in the title bar; the left line with collapsed stop blocks above the open stop; the **codebase map is the Step zoom of the stop**: open it as a side pane "Stop 6 footprint" (directories as neutral lines, files as stations, read = hollow ring, wrote = filled + "+48", synced to the stop), with a zoom affordance.
- Scaling story: 10 → 500 agents: you zoom out; the same grammar holds at Fleet level; no new screens.
- Web: every zoom level has a URL (`app.agentoffice.dev/storefront/checkout-saved-cards/review`) — share exactly what you see. Mobile: pinch is native — Fleet → line → stop with pinch; the phone defaults to Line zoom.
- Settings: settings also have scale — Global ▸ repo ▸ line; a setting shows where it's inherited from and can be overridden at a smaller scale.
- 3D: a camera tilt on the same zoom stack (the Network zoom tilted).

## B · SIGNAL BOX (prefix `SB-`) — "Where you're needed comes first"
**Principle:** everything is ordered by how much it needs you. In railways the signal box is where one person controls a whole network by answering requests. The triage column becomes a persistent **needs rail** present on every screen, and every decision has one anatomy that's the same everywhere.
- Signature pattern: the **decision row** — one component, identical in the hub, the chat's Open column, notifications, mobile, web: ring (matches the line tip) · line name + its small line · the ask in one line · the consequence in one muted line ("rewrites 1 commit on origin · can't be undone") · actions with keys. Kinds with fixed layouts: question (numbered options), permission, risky (click only), outward (shows the exact text; Allow once / Edit / Don't post), review (fix / plan / PR ready), default (Keep / Change, neutral marker), suggestion (Start / Not now, source chips, Why?).
- Hub (SB-01): the triage becomes the primary, left-hand column (~520px, the "signal box"), sorted by urgency, keyboard J/K + 1–9; the network map fills the right and **explains** the selected decision (the line lights up, its dependencies and sources are shown). The top of the rail shows "2 need you · 3 to review · 2 your call" as a compact bar.
- Session (SB-02): the chat view with the right column's Open section turned into the same rail: "In this line" decisions first, then a collapsed "Elsewhere · 2" strip of the global rail (answerable in place) — so you never leave to answer. Codebase map side pane open, explaining the current need: e.g. the files the default decision touches (read/wrote at stop 6).
- Scaling story: needs are the only thing whose cost is human; the design makes every need self-contained, answerable without opening the chat, and batched by kind ("3 Dependabot updates — Allow all").
- Web: a shareable decision inbox (hand a teammate the review decisions for payments-service). Mobile: the rail IS the app; rich notifications carry the same decision row.
- Settings: organised by "who may ask you, and how": Sources, Rules, Autonomy, Notifications, Permissions — each explained by the decisions it creates.
- 3D: needs float as signal posts above their lines.

## C · STATIONS (prefix `ST-`) — "Each stage is a place with its own job"
**Principle:** the route organises everything. Each stage is a station with its own purpose, its own decisions and its own page layout. The line on the left tells you which station you're at; the page adapts to the job of that station.
- The human's job per station: Brainstorm — choose direction; Plan — approve the plan; Work — watch and unblock; Review — judge findings; Ship — authorise what leaves (PR, posts, merges); Merged/Compound — capture what was learned.
- Signature pattern: the **station page** — the open stop's layout is stage-specific, headed by a thin station band in the stage colour (subtle: a 3px top rule + the stage name in the stage colour), and earlier stops collapse into compact blocks that show each station's outcome ("Plan · 7 units approved", "Review · 11 findings, 2 blocking").
- Hub (ST-01): the existing hub, but the triage column is grouped by station ("At Plan: 2 plans to approve · At Review: 3 to check · At Ship: 1 post to allow") and the map's stage columns get quiet station labels with counts; hovering a column highlights all lines at that station.
- Session (ST-02): Habit tracker at the **Work** station: conversation + tasks + live step, codebase map side pane open (the Work station's natural companion).
- Extra (ST-02b, 1440×900): Checkout: saved cards at the **Review** station: the page becomes findings (11, 2 blocking, each with file:line) beside the diff, the outward Slack post waiting at the bottom, Connected (PR #214, Sentry, Slack) in the right column. Shows how the same chat view reshapes per station.
- Scaling story: agents do the stages; you do a different kind of judgement at each. Grouping decisions by station lets you batch like with like (approve three plans in a row).
- Web: station pages are shareable to the people who own that job (a Review page for a reviewer, a Ship page for a lead). Mobile: station-specific quick actions (approve a plan, allow a post).
- Settings: **Routes & stations**: per station — the skill (`ce:plan`), what needs you, what may continue by itself (e.g. "Work may continue to Review by itself for lines started for you").
- 3D: stations as platforms along the stage columns.

## D · FLOW (prefix `FL-`) — "Signals in, lines out"
**Principle:** work flows left to right: the world's signals → merged into work → lines → `main`. Most work will begin as a signal, not a typed prompt. The product is the pipeline, and your attention goes to its valves (rules and gates), not to each item.
- Signature pattern: the **gate** — a small glyph on the flow marking where work waits for you vs where it's allowed through (rules, started-for-you limits). And **origins on lines**: a line visibly starts from its source chips (SE SL GH) — the merge shown as source chips joined into one start.
- Hub (FL-01): a left intake stream (neutral rows, source chips, newest first; merged items shown as one row with stacked chips) that feeds the network: items that became lines connect to their line's start; suggestions wait at a gate (Start / Not now); started-for-you lines leave through an open gate. Triage column right. Keep the stream rows neutral — sources are chips, never coloured lines.
- Session (FL-02): the chat's squeezed line starts at its origin (source chips at the top of the line column) and ends at `main`; right column opens with **Connected** (where this work came from, live state), then Open and Tasks. Codebase map side pane open.
- Scaling story: when hundreds of signals arrive a day, you can't judge items; you shape the flow. One rule edit changes hundreds of future decisions — so rules and gates are first-class, visible where they act.
- Web: a request intake page teammates can use to drop work into your flow (a form that becomes a signal). Mobile: the stream and its gates — "4 new since 09:00 · 1 started for you · 2 waiting at the gate".
- Settings: laid out as the pipeline itself, left to right: Sources → Rules → Gates & autonomy → Agents → Ship.
- 3D: the network as a model railway with a small yard at the left where signals arrive as neutral parcels.
