# Round 17 brief — desktop feedback on the Round 16 prototypes

Everything in `v3.md` still holds unless this file changes it. This round is DESKTOP ONLY: update your desktop prototype and your design document. Mobile waits for the owner's mobile feedback — don't touch `*-20-Mobile`.

Files this round (NEW names; leave Round 16 files untouched): `<P>3-10-App.dc.html` (copy your `<P>2-10-App` generator output and change it) and `<P>3-00-Idea.dc.html`. Prefixes: SC3-, SB3-, ST3-, FL3-. Same folder: `/tmp/claude-0/-home-user-agent-office/3f088f39-de60-521d-ab9e-ef480160be1a/scratchpad/r16/project/` (the preview server serves it; Metro3D.dc.html is there).

## The owner's feedback (hard requirements)

### 1. No hover "+" on the repo station — it "feels wrong and cheap"
- Remove every hover-revealed "+" / "+ New" on stations. Nothing pops out of a station on hover.
- The station itself is the control: it gets a proper button hover state (subtle fill/outline change, pointer) and a pressed state. Clicking it opens the anchored composer. ⌘N opens the composer for the repo you're in (or the last one). The sidebar's repo header also opens it on click.
- Make the composer feel native and premium: anchored to the station with a 1px line and panel fill, auto-growing prompt field, the repo as its header, one quiet "Options" disclosure (fresh worktree, account, model). **No stage picker** (see 4).

### 2. The network → session transition "feels like a bug and it's in the way"
- Remove any geometry morph/staged hero transition between the network and a session (Scale: the line-becomes-the-session morph goes).
- Replace with a calm, fast, symmetric transition: the session fades in with a small 8px translate (or scale .985 → 1), 180–200ms, `cubic-bezier(.2,.8,.2,1)`; the hub fades out in 120ms; input is live immediately (no waiting on an animation); Back/Esc reverses at the same speed. Continuity comes from the sidebar (the selected line stays highlighted there), not from moving geometry.
- Apply the same restraint everywhere: nothing that animates should block the next click.

### 3. A sidebar you can toggle on and off
- Left sidebar, ~248px, toggled with **⌘B** and a sidebar icon button at the left of the title bar (after the traffic lights). Width animates 200ms and the content reflows (no overlay). Available on the hub AND in sessions; the prototype remembers its state across screens.
- Baseline contents: a filter field; repos (small station pill + name) each with their lines as rows — tip ring (same state/colour as on the network), name, a few words of status; side chats indented under their parent; rows that need you are visible at a glance (the ring does it — no extra badges); the current line highlighted; clicking a row opens that session; clicking a repo header opens the new-line composer for that repo; at the bottom "+ Add repository or folder" (opens the existing dialog) and Settings.
- Idea-specific: you may order/group it by your idea's principle (Scale: the zoom tree — repos ▸ lines ▸ the open line's stops; Signal box: needs-you first; Stations: grouped by station; Flow: may carry the intake at the top). Make sure the hub layout still breathes with the sidebar open at 1440×900 (you may collapse other columns when it's open, but explain it in the doc).

### 4. The user doesn't choose the starting stage — the app decides
- Remove the starting-stage selector everywhere (composer, new-line page, side-chat composer, starters).
- After Start, the new line grows out of the station in neutral ink2 with a short, calm "choosing where to start…" state (≈700ms: a soft shimmer along the stub, no spinner, NO mention of any classifier or model), then the segment recolours (200ms) to the chosen stage and the tip ring appears. Pick sensibly from the prompt: a vague idea → Brainstorm; "plan/design …" → Plan; a concrete fix or a Sentry/bug item → Work; "review #…" → Review. A toast/hover card says it in plain words: "Starts at Plan" with a quiet "Change" (optional override, never required).

### 5. Merged + done sessions resolve by collapsing back into the repository
- When a line is merged and marked done, it retracts into its repo's `main` station: the stroke un-draws from the tip back to the station (~500ms, ease in-out), stage circles fade as the stroke passes them, the station gives one soft pulse, and a small quiet counter on/beside the station ticks up ("4 merged today"). Its sidebar row collapses into the repo header. The lanes below glide up to close the gap (200ms after).
- Demo triggers (must work): add a line **Sentry sourcemaps** (storefront, merged at 12:10, waiting for Done) — "Done" in the triage (e.g. Review or Finished today) and "Mark done" in its session both trigger the collapse. Also: on **Saved-cards crash fix**, "Approve & merge" moves it to Merged (tip ring → merged colour, then after ~1s a "Done" affordance appears; clicking it collapses the line).

### 6. A side chat merged back collapses into its parent
- **Try token bucket** → "Reconnect" (summary + code) → its branch retracts along its fork back into Rate limiter at the fork stop (~450ms); an interchange mark appears on Rate limiter at that stop (a small double ring), Rate limiter's status updates ("token bucket merged in"), and the side chat's sidebar row collapses into its parent. Reconnect is available from the triage row, the side chat's session, and the fork stop's hover card.

### 7. The codebase view — rethink it as a graph of endpoints
The owner: "a graphed out view of the entire codebase, where every file is an endpoint of the graph; this view shows a zoomed-in version of all graph endpoints' files touched, to indicate the size of the changes, without having to show the actual file names. Clicking on this view shows more details. We're moving to an age where you don't need to see the individual files changed at first glance."
- **Data** (shared by all four ideas, use it exactly): `/tmp/claude-0/-home-user-agent-office/3f088f39-de60-521d-ab9e-ef480160be1a/scratchpad/brief/codebase.json` — `storefront` (589 files in 7 areas), `habit-tracker` (16 files), and `touched` per session (Checkout: saved cards, Checkout redesign, Habit tracker) with kind (wrote / read / writing), +/−, stop, the plan's areas, the insight line and the flag.
- **The graph**: the repo is the root, directories are internal nodes, **every file is an endpoint (leaf)**. Lay it out deterministically in Python (a tidy radial tree, or a hierarchical tree drawn with the metro grammar — your idea's choice), and draw ALL endpoints as tiny dots with hairline edges in neutral colours. Label only the 7 top-level areas (apps/web, apps/mobile, apps/admin, services/api, packages/ui, packages/db, infra). **No file names in the graph.**
- **The default view is zoomed in on the touched endpoints**: show the pruned subgraph — only the paths from the root to each touched endpoint — laid out compactly and large. Each touched endpoint is a circle whose **area is proportional to its change size** (+add −del; read-only endpoints are small hollow rings; the one being written breathes). Branch strokes can thicken with the change they carry. This is the at-a-glance answer to "how big is this change and how far does it reach".
- **Context**: a small inset (or a strip) of the whole-codebase graph with the touched endpoints lit and a frame showing the zoomed region. Opening the tab plays ONE camera move from whole → touched (~400ms). A quiet toggle "Touched · Whole" switches back and forth (same camera move).
- **Reach**: keep the insight line and the flag from the data at the top (one line each). Endpoints in areas outside the plan's areas get a subtle neutral marker (e.g. a small flag glyph or dashed halo) — do NOT use amber or red for this (they mean needs you / blocked).
- **Details on click**: clicking an endpoint or a branch opens a details panel inside the column: that branch's files by name with +/−, read/wrote, stop, and "Open diff" per file (diff view as before); Esc closes. Hovering an endpoint shows only its size ("+18 −6 · wrote at Work 2") — the name appears in the details, not on hover.
- Filters stay small: Written · Read · Both, and This stop · Whole line.
- The tab still widens the right column (~620px) with the same 200–260ms width animation.
- Habit tracker's small repo: same view; with only 16 files the "touched" zoom shows most of it — that's fine and honest.

## Also
- Update `<P>3-00-Idea.dc.html`: reflect the new composer (no stage picker; the app decides), the calm transition, the sidebar, merge-collapse and reconnect-collapse (drawn as small before/after specimens), and the new codebase graph (a specimen from the real data). Keep the doc terse.
- Test everything with the preview tool (both themes; mid-transition shots for: composer open, line growing + recolour, session open/back, sidebar toggle, codebase camera move, merge collapse, reconnect collapse). Nothing should look like a glitch mid-way.
- Reply with the files, sizes, working click paths, and anything you couldn't do.
