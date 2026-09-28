# Round 16 brief — four interactive prototypes (desktop app + mobile) per idea

Read this whole file. It supersedes the Round 15 brief wherever they differ. Still use from `v2-base.md`: the base tokens, the type (Geist / Geist Mono), the owner's rules, the review fixes that aren't overruled below, and the scenario (from `shared.md`). Your idea's principle is still in `v2-ideas.md`. The Round 15 boards for your idea are in `/tmp/claude-0/-home-user-agent-office/3f088f39-de60-521d-ab9e-ef480160be1a/scratchpad/r15/project/` and the Round 15 generator libs are in `scratchpad/sc/`, `scratchpad/sb-gen/`, `scratchpad/st/`, `scratchpad/fl-gen/`. Reuse and adapt them.

## The owner's feedback on Round 15 (hard requirements, for all four ideas)

**The network (hub)**
1. **No stage columns.** Don't section the network into Brainstorm/Plan/Work/… columns: no column headers, no grid lines, no tinted column bands. The colour of each segment tells the stage. A small colour legend (six dots with names) may sit quietly in a corner.
2. **No dotted leads for skipped stages.** A line that started at Work simply leaves its repo station in Work green. It is not scalable readability-wise.
3. **Stage-transition circles.** Where a line passes from one stage to the next, draw a small completed circle (e.g. r=4, filled with the stage colour it completed, 2px bg-coloured outline so it sits "on" the line). These circles are interactive:
   - hover (120ms delay) → a small card: stage name, its outcome in one line, time ("Plan · 9 tasks approved · 21:02") and two actions: **Open here** (↵) and **Branch from here** (B).
   - click → opens the session at that point (the session view with that earlier stop revealed).
   - Work may also carry small task circles (one per finished task) at a lower visual weight — optional per idea, only if it stays clean.
4. **No "N done" pills.** They break the line. Remove them everywhere.
5. **No grey remainder lines** by default. A line ends at its tip. (Optionally, on hover, a short ghost segment can hint the next stage, e.g. a faint 24px stub labelled "next · Review".)
6. **The text at the end of the current line looked out of place.** Don't float a status label at every tip. The line's NAME stays at its start (above the first segment, as before). Status is carried by the tip ring (state + stage colour) and appears in the hover card of the line / tip. Each idea may add ONE disciplined status treatment of its own (e.g. a right-aligned, tabular status column aligned to the lanes; or status only for lines that need you) — but no ragged labels next to tips.
7. **Starting something new comes from the repo.** Remove "Start something new…" from the top of the right column. Clicking (or hovering → "+") a repo/folder station on the left opens a composer anchored to that station (popover): prompt field, starting stage (Brainstorm · Plan · Work · Review), fresh worktree toggle, account + model. ⌘↵ starts: the popover closes and the new line **grows out of the station** (animate the stroke), its tip ring appears breathing.
8. **Adding a repo/folder needs UI.** Under the stations: a quiet "+ Add repository or folder" → a small dialog/popover: choose folder… (path field + "Choose…"), or clone from a Git URL, plus a short list of detected repos on this machine not yet added (e.g. `~/code/docs-site`, `~/code/cli`) with Add. Adding one animates a new station into place.
9. Everything else about the network stays: lines grow out of each repo's `main` station on the left, side chats branch off the stop they came from, the tip ring = amber (needs you) / red (blocked) / stage colour, rows in the triage highlight their line and vice versa, merged lines fade.
10. **No Fleet view** (Scale): it looked messy. Scale's zoom now goes Network ⇄ Line ⇄ Stop ⇄ Code.

**The session**
11. **The area above the active step is only shown when asked.** By default the active stop gets the whole page: heading, conversation, live step, composer. Earlier stops are ONLY on the left line, as compact blocks (small rounded rects in their stage colour, like U3's ticks but clickable, with the stop number/name on hover). Clicking an earlier block reveals that stop above the active one — animated (height + fade), with its outcome and a folded transcript, and a "Back to now" (Esc) control. ⌘L expands the whole line into a list next to the blocks. Nothing above the active stop by default.
12. **The codebase map is a TAB of the right column**, alternative to "Open & tasks": tabs `Open & tasks` | `Codebase` (⌘⇧M). Choosing Codebase **widens the right column** (animate ~340 → ~620px; the conversation narrows) and shows:
   - the **entire codebase as a metro network**: each top-level area is a line (neutral ink2 colour, NOT stage colours), stations are its directories/files, interchanges where areas share code;
   - the routes this line **read** and **wrote** highlighted; everything untouched dims;
   - a filter: **Written · Read · Both** (segmented, animated highlight swap);
   - a zoom: **Whole codebase ⇄ Touched routes** (animated transform zoom into the touched part);
   - the insight summary at the top, in one or two lines: "Wrote in 2 areas · read 4 · the plan named services/api only" and a flag when the change reaches further than expected: "Also changes apps/mobile — not in the plan" or "Changes packages/ui/Form — used by 3 apps". This is the point: **seeing whether the change touched a larger part of the codebase, or reached into more places, than expected**;
   - hovering a station shows the file, read/wrote, +/- lines, and at which stop; clicking opens the diff.
   - the stop filter: "This stop · Whole line" (default Whole line).
13. Session empty state (a new line) = what the repo-station composer opens into, or a full-page version when opened with ⌘N: the composer, starting stage, repo, worktree, account/model, and 3 specific starters from real state.

**3D view (design document)**
14. The previous 3D vignette "doesn't add anything". The owner wants: **stations (one per stage: Brainstorm, Plan, Work, Review, Ship, and a Merged/Compound terminus) that contain small characters working at that station** — brainstorming at a whiteboard, planning over a blueprint table, working at laptops/workbench, reviewing with a magnifier, shipping at a loading platform — **and the characters move between stations riding small metros**. It's a cute, alive overview of the same lines. One character per line (session); needs-you characters raise a hand with an amber "?" bubble; blocked ones sit behind a small red barrier; subagents are tiny helpers next to their character. **This is now a shared component** built by a separate designer: `Metro3D.dc.html` (1000×680). Use it via `<dc-import name="Metro3D" dark="{{dark}}" hint-size="1000px,680px"></dc-import>` in your hub's 3D mode (the 2D · 3D toggle) and in your design document's 3D section. Until the file exists, your render shows a placeholder — that's fine; re-render at the end.

## What to build (per idea)
Page per idea on the canvas: the updated design document + two interactive prototypes.

1. `<P>2-00-Idea.dc.html` (1440×1800; NEW file name — keep the Round 15 file untouched, copy it and update the copy) — **update** your Round 15 design document to the feedback above: the hub specimen (no columns/pills/dotted leads, stage circles), the session (blocks on the line, reveal on click, Codebase tab), the codebase map section (the whole-codebase network + filter + insight), the 3D section (use the Metro3D component, scaled if needed via a wrapper with `transform: scale()` — the component is 1000×680), and an **Interaction & motion** section: your idea's key interactions and the motion principles (durations, easing, what animates and why). Keep it terse.
2. `<P>2-10-App.dc.html` (1440×900, interactive) — **the desktop app prototype**: ONE artboard holding all screens as states:
   - Hub (2D) with every interaction above: hover a line (others dim to ~35%), hover/click stage circles (card with Open here / Branch from here), hover/click a tip ring, triage rows ↔ line highlight, answer a Jump in question (the row collapses away with a small "Answered · Undo" toast, the line's tip ring turns from amber to its stage colour), repo station → composer popover → start → new line grows, + Add repository dialog, 2D ⇄ 3D toggle (3D = the Metro3D component, cross-fade).
   - Session (active): opened by clicking a line/row/circle. Title bar with back (to hub; Esc), the chat name/switcher, branch, state. Left: the line as clickable blocks; click an earlier block → reveal above (animated), "Back to now". Main: the active stop. Right column tabs: Open & tasks | Codebase (widening animation, filter Written/Read/Both, zoom Whole/Touched, insight flag, station hover). A notification from another chat arrives bottom-right (animated in) and can be answered in place.
   - Session (empty / new line).
   - Settings (⌘,): a domain index (Accounts · Agents · Repositories & folders · Sources · Rules · Autonomy · Permissions · Routes · Notifications · Appearance · Housekeeping) with at least **four domains fully drawn and navigable** (Repositories & folders, Sources, Autonomy / started for you, Appearance incl. theme + 2D/3D default; plus Accounts if you can). Toggles/segmented controls work and animate. Appearance's theme switch flips the prototype between dark and light live (state), overriding the `dark` prop.
   - Your idea's signature interaction must be fully working (see "Per idea" below).
   - Sessions with full content: **Habit tracker** (the scenario transcript), **Checkout: saved cards** (Review: findings, the outward Slack post Allow once / Edit / Don't post), **Checkout redesign** (Work, task 4 of 7; transcript below). Any other line opens a session with its line, its stop heading, and a short plausible exchange built from the scenario data for that line (2 messages), never lorem ipsum.
3. `<P>2-20-Mobile.dc.html` (390×844, interactive) — **the mobile app prototype** (built by a separate mobile designer on your idea — see "Mobile" below).

## Interaction & motion standards (the owner cares a lot: "smooth animations, clear UI and intuitive interactions make an app stand out")
- Every interactive element has hover (desktop), pressed and focus-visible states. Cursor pointer on clickables.
- Motion: 120–180ms for hover/press/fades, 200–280ms for layout changes (pane widening, reveal, popovers), 360–480ms for the one hero transition of your idea. Easing: `cubic-bezier(.2,.8,.2,1)` (out) for entering, `cubic-bezier(.4,0,.2,1)` for moves. No bouncy springs in the 2D UI (Metro3D may be playful). Nothing moves without a reason: motion explains where things came from and went.
- Enter: fade + 4–8px translate. Exit: fade + slight scale (0.98). Collapse: animate height via `grid-template-rows: 1fr → 0fr` or `max-height`, plus opacity.
- A line growing: animate `stroke-dashoffset` from its length to 0 (~450ms). A tip ring changing state: colour transition 200ms + one soft pulse.
- Hover cards: 120ms delay, appear anchored with a 4px offset, disappear on leave after 80ms.
- Popovers/dialogs: anchored, 8px shadow-free separation (use a 1px line + panel colour, no heavy shadows; a soft 0 8px 24px rgba(0,0,0,.28) in dark / .10 in light is the maximum).
- Respect reduced motion: wrap animations in `@media (prefers-reduced-motion: no-preference)`.
- Keyboard: put `tabIndex="0"` and `onKeyDown="{{onKey}}"` on the root element (NOT a global listener) and support at least: Esc (back / close / back to now), ⌘0 / ⌃0 (hub), ⌘, (settings), ⌘⇧M (codebase tab), 1–9 (answer the top Jump in row in the hub), B (branch from the hovered circle), ⌘↵ (start in the composer). Show keys subtly in the UI as now.

## Runtime mechanics (the .dc.html runtime is React 18 underneath) — VERIFIED in the preview
- Verified working: `constructor(p){ super(p); this.state = {...}; }` + `this.setState`; `onClick`, `onMouseEnter`, `onMouseLeave`, `onPointerDown/Up`, `onKeyDown` on a `tabIndex="0"` root; `<sc-if>`; CSS transitions in `<helmet><style>` animate on BOTH class changes (`class="{{x}}"`) and style-hole changes (`style="width: {{w}}px"`) — elements are not remounted between renders; `@keyframes` animations; `<dc-import>` with a live prop (`dark="{{dark}}"`) re-rendering the child.
- File names prefix for this round: `<P>2-` (SC2-, SB2-, ST2-, FL2-). 
- State: `this.state` + `this.setState` in `class Component extends DCLogic`; initialise with `constructor(p){ super(p); this.state = {...} }` or `state = {...}` (test which works in the preview; then use it consistently). renderVals() reads state and returns everything the markup needs: flags per screen, per-item computed styles/classes, and handlers.
- Handlers: `onClick="{{go.hub}}"`, `onMouseEnter="{{it.enter}}"`, `onMouseLeave="{{it.leave}}"`, `onKeyDown="{{onKey}}"` (whole-value holes). Per-item handlers are attached to items in renderVals.
- Screens: `<sc-if value="{{screen.hub}}" hint-placeholder-val="{{true}}">…</sc-if>`. To animate BETWEEN screens, keep both mounted and toggle classes/opacity/transform via state-bound `class="{{…}}"` or style holes (allowed for live, state-driven values). Prefer class toggles with CSS in `<helmet><style>` (define your classes and @keyframes there).
- CSS in `<helmet><style>`: your component classes, transitions, keyframes, :hover/:focus-visible rules. Theme colours may be CSS variables set on the root element from renderVals (`style="--bg: {{t.bg}}; …"`), which lets classes use `var(--bg)` and makes the live theme switch trivial.
- No global listeners, no innerHTML, no script-built DOM, no iframes, no network except the one Google Fonts link.
- The child component: `<dc-import name="Metro3D" dark="{{dark}}" hint-size="1000px,680px"></dc-import>`.
- Size: these files will be large (100–250 KB). That's acceptable. Generate them with your Python generator; keep the generator in your scratch folder.

## Preview tool (interactive)
`cd /home/user/agent-office && node .design-shot.mjs <absolute file> [--light] [--out name] [--hover SEL] [--click SEL] [--type SEL TEXT] [--key KEY] [--wait MS] [--shot SUFFIX]…` — steps run in order; `--shot x` saves an intermediate PNG. Clicks/hovers/keys only wait 30ms, so use `--wait` before a `--shot` (e.g. `--click … --wait 120 --shot mid --wait 400 --shot end`); a final PNG is always saved after a 600ms settle. PNGs go to `scratchpad/shots16/`. Selectors are Playwright selectors (`text=Checkout: saved cards`, `button:has-text("Codebase")`, `[aria-label="Add repository"]`). It prints PNG paths and any runtime ERRORS. Files are served from `/tmp/claude-0/-home-user-agent-office/3f088f39-de60-521d-ab9e-ef480160be1a/scratchpad/r16/project/` — WRITE YOUR BOARDS THERE. **Test every interaction** with click/hover sequences and look at the PNGs. Both themes for the hub and session.

## Shared content additions (use exactly, all ideas)

**Checkout redesign** (storefront · Work · task 4 of 7 "Promo code in the order summary", editing `apps/web/checkout/CheckoutForm.tsx`; subagents: "Explore · find checkout callers", "Review · test coverage gaps"):
- tool line: `▸ Read 6 files · edited apps/web/checkout/PromoField.tsx +31 −12`
- You: "Make the promo field part of the order summary, not a separate step."
- Agent: "Moving PromoField into the summary. I had to add an inline variant to the shared Form in packages/ui, which admin and mobile also use — I kept the default unchanged, so they don't move."
- code: `packages/ui/Form.tsx` → `export function Form({ inline = false, ...props }: FormProps) {` / `  return <form className={inline ? styles.inline : styles.stack} {...props} />`
- live step: "Running pnpm test checkout…"; Next · 5 Payment step copy.

**The storefront codebase as a metro network** (areas = lines, neutral colours; stations = dirs/files; interchanges where marked):
- `apps/web`: layout · cart · checkout/CheckoutForm.tsx · checkout/PromoField.tsx · checkout/CardPicker.tsx · account · product
- `apps/mobile`: navigation · cards/CardRow.tsx · cards/CardList.tsx · checkout/Pay.tsx · push
- `apps/admin`: orders · export/BulkExport.tsx · users
- `services/api`: auth · saved-cards.ts · payments.ts · refunds.ts · webhooks.ts · promo.ts
- `packages/ui`: Button · Form.tsx · Sheet · Icon   (interchange with apps/web, apps/mobile, apps/admin)
- `packages/db`: schema.ts · migrations   (interchange with services/api)
- `infra`: ci.yml · deploy · terraform
- An `api client` interchange joins apps/web, apps/mobile, apps/admin to services/api.
Touched:
- **Checkout: saved cards** — wrote: services/api/saved-cards.ts (+2 −1), apps/mobile/cards/CardRow.tsx (+14 −3); read: apps/web/checkout/CardPicker.tsx, services/api/payments.ts, packages/db/schema.ts, infra/ci.yml. Insight: "Wrote in 2 areas · read 4 · the plan named services/api only" + flag "Also changes apps/mobile — not in the plan".
- **Checkout redesign** — wrote: apps/web/checkout/CheckoutForm.tsx (+58 −40), apps/web/checkout/PromoField.tsx (+31 −12), packages/ui/Form.tsx (+9 −2); read: apps/web/cart, services/api/promo.ts, packages/ui/Button. Flag: "Changes packages/ui/Form — used by 3 apps".
- **Habit tracker** (its own small repo): public/ (settings.js W +48, settings.html writing, app.js R, styles.css), server/routes/ (habits.js W at stop 3, users.js R, reminders.js W at stop 5), server/db/ (schema.sql R, migrate.js), tests/ (empty). Insight: "Wrote in 1 area at this stop · read 3 · as planned".

**Add repository**: detected on this machine, not yet added: `~/code/docs-site`, `~/code/cli`. Clone field placeholder `git@github.com:you/repo.git`.

## Per idea — the signature interaction that must be fully working in the desktop prototype
- **Scale:** zoom as navigation. Clicking a line in the hub runs the hero transition: the line highlights, the rest fades, the chosen line slides to the left edge and turns vertical into the session's block line while the session fades in (~450ms). Esc zooms back out (reverse). The title-bar zoom path (Network ▸ storefront ▸ Checkout: saved cards ▸ Review ▸ Code) is clickable at every level; the Codebase tab is the Code zoom level (its zoom Whole ⇄ Touched is the same gesture).
- **Signal box:** the decision rail. J/K (and hover) moves the selection through the rail, the map on the right re-explains the selected decision (its line lights up, the "Came from / If you allow / Waiting on this" strip updates), 1–9 / buttons answer; the answered row collapses and the next selects itself; risky rows take a click only (keys show "click only"). In the session, the "Elsewhere" dock answers other chats in place.
- **Stations:** the station page. The session's page layout changes with the stage of the open stop: opening Habit tracker shows the Work layout; opening Checkout: saved cards shows the Review layout (findings beside the diff; F/L/X on a finding animate it to its group); clicking an earlier block (e.g. Plan) reveals it in the PLAN layout (the plan document with its units). The triage groups by station, and hovering a station group highlights the lines at that station.
- **Flow:** the intake. Items in the stream can be Started: the item animates into the network — its chips travel to the repo station and a new line grows from there — or Not now (it slides to "On your list"). The gate glyph toggles per rule (click a rule's gate to switch "waits for you" ⇄ "let through"), and the affected items update. The session's line starts from its origin chips, and Connected is first in the right column.

## Mobile (separate designer, same idea)
`<P>2-20-Mobile.dc.html`, 390×844, interactive, one artboard with states and native-feeling transitions (push/pop slides 280ms, bottom sheets with a grab handle, press states that scale 0.98). No fake status bar/keyboard/home indicator. Touch targets ≥ 44px. Screens:
- Home: your idea's mobile hub — the triage (Jump in / Review / Your call) + a compact, touch-friendly view of the lines (same no-columns/no-pills rules, stage-coloured segments, tip rings, stage circles tappable). Tap a repo → the new-line sheet.
- Line/session: the active stop full-screen; the line as a horizontal strip of blocks at the top — tap a block → that stop reveals (sheet or expand); tab switch Open & tasks | Codebase; Codebase = the network with Written/Read/Both chips and the insight flag, pinch-like zoom via a Whole/Touched toggle.
- A risky decision (Dialog CI fix force-push): Face ID + hold to allow (a ring fills while held — implement with pointer down/up + a CSS animation; release early cancels), Deny.
- New line sheet (from a repo).
- Settings: a list of domains → at least Notifications (push kinds, quiet hours, Live Activity), Autonomy, Appearance (theme switch works live).
Reuse your idea's desktop components where they fit a phone; play to the phone's strengths (thumb reach, sheets, haptic-feeling holds, glanceable summaries).

## Deliverable check before you finish
- All files render with no ERRORS; all interactions tested with the preview tool; both themes checked.
- No stage columns, no pills, no dotted skipped leads, no remainder lines, no floating tip labels, no Start box in the right column, no Fleet.
- Reply with the files, sizes, the interactions that work (as a list of click paths), and anything you couldn't do.
