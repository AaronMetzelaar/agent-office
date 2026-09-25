---
title: "feat: Livelier Lounge"
type: feat
status: active
date: 2026-09-25
origin: docs/brainstorms/2026-09-25-livelier-lounge-requirements.md
---

# feat: Livelier Lounge

## Overview

Replace the Lounge's single grey armchair with four seat types in fixed colours, chosen per chat. Spread the seat grid so side tables and plants fit between seats, warm up the rug, and give resting agents slow, eyes-open seated activities with small held props. Parked agents keep dozing, in a few postures. Seat assignment, growth and re-pack rules don't change.

## Problem Frame

The Lounge reads as a waiting room: identical chairs, one direction, one pose. Most chats spend most of their life there. The room has to feel lived in while staying quieter than the door queue's "needs you" signal (see origin: `docs/brainstorms/2026-09-25-livelier-lounge-requirements.md`).

## Requirements Trace

**Seating**
- R1. Four closed seat types in a closed set of colours.
- R2. Seat look (type, colour, turn) follows the occupant's chat across re-packs and relaunches.
- R3. Seats and held props never hide the agent or its tag at overview zoom.

**Decor**
- R4. Decor: plants, floor lamp, bookshelf, side tables. The coffee corner stays.
- R5. A warm patterned rug.
- R6. A wider grid leaves room for decor between seats, and the office re-packs around the larger Lounge.
- R7. Decor scales with the room and moves with its neighbouring seats.
- R8. Walkers route around decor.

**Seated activities**
- R9. Quiet, eyes-open activities (read, sip, phone, gaze) that read from body pose alone.
- R10. Motion stays slow and small, never louder than the door queue's "needs you".
- R11. Each activity holds for tens of seconds, out of phase between agents.
- R12. Parked agents doze with eyes closed and dimmed, in a few postures chosen per chat.
- R13. Activities never move an agent, and props disappear on park or walk.

**Success criteria:**
- The room no longer reads as rows of identical chairs.
- With 5+ occupants, it usually shows 3+ seat types, and awake agents show 2+ activities.
- It's never louder than "needs you".
- Overview frame rate is unchanged, with no hitch on grow-by-one.
- An agent's chair looks the same after a re-pack or relaunch.

## Scope Boundaries

- No change to `reseat()` rules, grow-by-one or re-pack triggers. `src/renderer/office/seating.ts` stays untouched.
- No idle walking, no agent-to-agent interaction, no sofas and no pods.
- Activities carry no chat state.

## Context & Research

### Relevant Code and Patterns

- `src/renderer/office/layout.ts`: `loungeGrid`, `loungeRowsIn`, `loungeShape` and `loungeSeat` define the seat grid. `layoutFloor` and `plan` pack the Lounge beside the glass office (fixed band depth `ZF - band.z0` = 3.8 m) or at the end of a row.
- `src/renderer/office/props.ts`:
  - `loungeChair` is today's only chair. It carries a baked mug on the armrest.
  - `lounge: LoungeScene` builds the rug, the coffee corner and `seats(count, rows)`, which rebuilds and re-bakes every chair when the count or row count changes.
  - `bake()` merges geometry per material.
  - Dept scenes expose `block(w, d)`, and `applyLayout` in `world.ts` calls it with an owner id. That's the pattern for walk blockers that move with a room.
- `src/renderer/office/world.ts`:
  - `applyLayout` calls `office.lounge.seats(lz.seats, lz.rows)`.
  - `placeLounge` moves the Lounge group and the seat vectors.
  - `offsetOf(owner)` resolves blocker origins. Only `'lounge:corner'` exists for the Lounge today.
  - `seating.seats` maps chat id to seat index.
  - `placementFor` provides the pose name.
- `src/renderer/office/pose.ts`: `placementFor` returns `pose: 'lounge'` or `'sleep'` at a fixed `y: 0.36`.
- `src/renderer/office/characters.ts`:
  - A `pose` record holds a joint set per pose name.
  - `animate()` adds per-pose motion using `c.ph`, a per-character random phase.
  - The rig has `arms[0|1]` groups and no hand bone.
- Tests:
  - `tests/renderer/layout.test.ts` checks Lounge area and packing. It already imports `loungeGrid`, `loungeShape` and `loungeSeat`.
  - `tests/renderer/pose.test.ts` covers the state-to-pose mapping.
  - `tests/renderer/seating.test.ts` covers seat assignment.
  - `tests/e2e/office-demo.spec.ts` drives the office.

### Institutional Learnings

- No `docs/solutions/` entries cover the office scene. The only one is a dual-account SDK spike.

### External References

- None. Three.js, baking and nav patterns are already established locally.

## Key Technical Decisions

- **Looks come from a hash of the chat id** (a small pure string hash, since the renderer has none): the chat id is the one identity that survives re-pack renumbering and relaunch. A chair takes its occupant's look the moment `reseat()` assigns the seat, before the agent starts walking. An emptied chair keeps its last look until the next re-pack drops it (see origin, Key Decisions). Picks are independent per chat, so at small counts two neighbours, or a short row, can share a type. That's accepted: the criterion is "usually", and colour and turn still differ.
- **Look updates run on every reseat, not only on re-pack**: `relayout()` in `world.ts` returns early (`if (booted && !next.repack) return`) before `applyLayout`. An agent that reuses a vacated chair below `prev.lounge` doesn't trigger a re-pack. So `relayout()` updates the per-seat look array from `next.seats` right after `seating = next`, before that early return. It calls `office.lounge.seats(looks, rows)` whenever the joined look key changes. `applyLayout` keeps calling it for shape changes.
- **Seats sit in pairs, with side tables between pairs** (changed during implementation): widening every column gap to 1.5 m raised the packing ratio on the demo fixture from 1.21 to 1.29. Keeping today's 1 m pitch inside a pair and adding 0.5 m only between pairs gives 1.24 and a 273.6 m² building (was 261.6 m²). The layout test bounds moved from 1.22 to 1.25 and from 265 to 280 m² to match. The walkway-gap test still holds.
- **Row depth stays the same**: decor sits in column gaps, so `pitchZ` stays at 1.15 m. With band depth 3.8 m and back plus front margins of 1.45 m, that keeps 3 rows in the band. A deeper pitch would halve band capacity, roughly double a 20-seat Lounge's width and zoom the overview out, with no benefit.
- **Decor blockers use owner `'lounge'` and tag `'lounge:decor'`**: the coffee corner already registers with tag `'lounge'` and is never re-registered. Each decor rebuild calls `nav.unblock('lounge:decor')`, and the corner's tag is never touched. Decor uses a small explicit pad (0.1–0.12, like `coffeeCorner`'s 0.12) instead of the 0.3 default, so seat cells stay free.
- **All four seat types share today's seat height (0.36)**: `placementFor` has no seat context, and one height keeps agents and tags aligned across types. This settles the origin's seat-height question without threading seat data into pose.
- **The armrest mug moves off the chair**: the baked chair can't hide a mug per agent, and not every type has an armrest. Mugs go on side tables, and the "sip" activity shows a held mug. This slightly changes the parent requirements' "a mug on the armrest" (R5 of `docs/brainstorms/2026-09-23-agent-office-requirements.md`), so that line gets updated too.
- **Activities live inside `animate()`, not `placementFor()`**: `placementFor` keeps returning `'lounge'`. `animate()` turns that into one of four activity joint sets from the scene time and `c.ph`, and the existing joint springs smooth each switch. The activity and doze joint sets go in a separate `activities` record in `characters.ts`, so `PoseName`, `pose.ts` and pose tests stay unchanged. Reduced motion (the existing motion scale) scales activity amplitudes as it does today's poses, and switches keep the same pace.
- **Decor sits in fixed gaps of the seat grid, keyed by gap position**: decor spots are a pure function of the grid (for example, a side table in every other gap between neighbouring columns, and plants at row ends), so decor re-lays out together with the seats. Walk blockers use a new `'lounge'` owner that `offsetOf` resolves to the Lounge origin, and the seat rebuild clears them by tag first.
- **Doze posture comes from the chat-id hash, and activity phase from `c.ph`**: the doze posture should survive a relaunch, so it uses the hash. Activity timing runs on scene time, which restarts on launch anyway, so the existing per-character phase `c.ph` is enough to keep agents out of step. `Target` gains a precomputed `doze` variant set in `targetOf` in `world.ts`, since `animate()` gets no chat id today.

## Open Questions

### Resolved During Planning

- Seat height per type: shared at 0.36 (see above).
- Armrest mug: removed from the chair, now on side tables and in hand while sipping.
- Activity timing: scene time plus `c.ph`, with no new scheduler state.
- Decor blockers: owner `'lounge'` in `offsetOf` and tag `'lounge:decor'`, cleared on every decor rebuild. The coffee corner's `'lounge'` tag stays untouched.
- Look updates without a re-pack: done in `relayout()` before its early return.
- When a reused chair changes look: at seat assignment, before the agent walks in.

### Deferred to Implementation

- Grid spacing: resolved as a 1 m pitch within pairs, a 0.5 m pair gap, a 0.6 m left margin and a 0.85 m back margin. The band keeps 3 rows.
- Whether rebuilding every chair on a look change causes a visible hitch at 20+ seats. If it does, bake chairs in small chunks so an arrival rebuilds only one chunk.
- Exact joint values for the four activities and three doze postures. These are tuned visually.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```mermaid
flowchart LR
  S[reseat → seating.seats: chatId→seat] --> R[world.relayout, every reseat]
  R -->|looks per seat from lookFor(chatId), if key changed| P[props lounge.seats(looks, rows)]
  R -->|re-pack only| W[world.applyLayout] --> P
  P --> C[chairs by type/colour/turn]
  P --> D[decor in grid gaps + 'lounge:decor' blockers]
  T[world.targetOf: pose 'lounge' / 'sleep' + doze variant] --> A[characters.animate]
  A -->|activityAt(t, c.ph)| J[activity joints + held prop]
  A -->|parked| Z[doze posture by variant]
```

## Implementation Units

- [x] **Unit 1: Pure Lounge look and activity helpers**

**Goal:** Turn a chat id into a seat look, a doze variant and an activity schedule, with no Three.js dependency.

**Requirements:** R1, R2, R9, R11, R12

**Dependencies:** None

**Files:**
- Create: `src/renderer/office/lounge.ts`
- Test: `tests/renderer/lounge.test.ts`

**Approach:**
- Add a small deterministic string hash, and `lookFor(chatId)`, which returns a seat type (one of four), a colour index into a fixed palette, and a turn of a few degrees. The type and colour lists are closed tuples.
- Add `dozeFor(chatId)`, which returns one of three doze variants.
- Add `activityAt(t, phase)`, which returns one of `read | sip | phone | gaze`. Each activity holds for a fixed span in the tens of seconds. The caller passes the character's `c.ph` as the phase, which keeps agents out of step.

**Patterns to follow:**
- Pure helpers with Vitest coverage, like `src/renderer/office/standby.ts` with `tests/renderer/standby.test.ts`.

**Test scenarios:**
- Happy path: the same chat id always gets the same look and doze variant, and the same `(t, phase)` always gets the same activity.
- Happy path: across 50 generated ids, all four types and every palette colour appear.
- Edge case: across many random sets of 5 ids, at least 3 types appear in most sets. Assert a floor well above chance, like ≥ 75%, so the test isn't flaky.
- Happy path: `activityAt` stays constant within one hold span and changes at a span boundary for a given phase.
- Edge case: two phases spread across `[0, 6)` don't switch at the same moment.
- Edge case: turn stays within the few-degree bound for every id.

**Verification:**
- The helpers are deterministic, and the distributions meet the thresholds above.

- [x] **Unit 2: Wider seat grid and decor spots**

**Goal:** Spread the seats and define where decor goes inside and around the grid, as pure layout.

**Requirements:** R6, R7, R8

**Dependencies:** None

**Files:**
- Modify: `src/renderer/office/layout.ts`
- Test: `tests/renderer/layout.test.ts`, and a nav reachability case, either there or in a new `tests/renderer/nav.test.ts`

**Approach:**
- Widen `loungeGrid.pitchX` (to about 1.5 m) so a side table fits between neighbouring columns. Keep `pitchZ` at or below 1.25 m so the band still holds 3 rows.
- Add a pure `loungeDecor(seats, rows)` that returns decor spots (kind, local x/z and footprint) from the grid shape. Side tables go in column gaps, keyed to the column on their left. Plants and the lamp go at the left edge and the back margin. There's always at least a plant and a lamp, even for one seat. The same shape always gives the same spots. No spot enters the coffee corner's footprint in the right margin (local x from `w - 0.72` to `w - 0.18`, z from 0.43 to 1.57).
- `loungeShape`, `layoutFloor` and `plan` pick up the new widths as they are. There's no packing logic change.

**Patterns to follow:**
- `gymCooler`, `queueSpots` and `loungeSeat`: pure functions of grid shape.

**Test scenarios:**
- Happy path: the existing fixtures ("two departments and a small lounge", "a full lounge" with 20 seats) still lay out without overlap against `fixedParts` and department boxes.
- Happy path: `loungeDecor(1, rows)` returns at least a plant and a lamp inside the Lounge box.
- Edge case: no decor spot overlaps any seat's footprint or the straight line between a seat and the room's front edge (R8).
- Edge case: for 1–24 seats, every decor spot stays inside `loungeShape(...).w/d` and outside the coffee-corner footprint.
- Edge case: the band still holds 3 rows (`loungeRowsIn(3.8) === 3`).
- Integration: the same `(seats, rows)` gives identical decor spots. Growing by one seat keeps spots keyed to existing columns and the left edge unchanged.
- Integration: build a nav grid over a Lounge of 1–24 seats, with decor blockers at the chosen pad plus the coffee-corner blocker. Every seat cell is free and reachable from the Lounge's front edge.

**Verification:**
- Layout tests pass with the new pitch values, and the Lounge still packs beside the glass office for small counts.

- [x] **Unit 3: Seat types, rug, decor and blockers in the scene**

**Goal:** Build the new chairs, decor and rug, and wire looks from seating into them.

**Requirements:** R1–R8

**Dependencies:** Unit 1, Unit 2

**Files:**
- Modify: `src/renderer/office/props.ts`
- Modify: `src/renderer/office/world.ts`
- Test: `tests/e2e/office-demo.spec.ts`

**Approach:**
- Replace `loungeChair` with four builders (armchair, beanbag, tub chair, backed pouf). Each has the same footprint and a 0.36 seat top, no armrest mug, and a low enough back that the tag clears it from the overview camera. Colours come from a small closed set of materials created once.
- Change `LoungeScene.seats` to take one look per seat (or undefined for a never-occupied seat, which gets a default look) plus rows. Rebuild only when the joined look key or rows change. Also build decor from `loungeDecor` there: side tables with mug, book stack or plant, pot plants, a floor lamp with a warm unlit-emissive shade, and a low bookshelf. Register decor blockers with owner `'lounge'`, tag `'lounge:decor'` and a pad of 0.1–0.12. Call `nav.unblock('lounge:decor')` before each rebuild, and never touch the coffee corner's `'lounge'` tag.
- The rug gets a canvas-texture pattern in warm tones, like the existing `woodTex` canvas approach.
- `world.ts` keeps a per-seat look array. In `relayout()`, right after `seating = next` and before the `!next.repack` early return, each seat assigned in `next.seats` takes `lookFor(chatId)`. Emptied seats keep their look. If the joined key changed, call `office.lounge.seats(looks, lounge.rows)`. `applyLayout` also passes the array on shape changes. `offsetOf` resolves `'lounge'` to `lounge.to` origin.
- Expose a demo-only hook next to the existing `window.__fps`, for example `window.__lounge = { looks(), decor() }`, fed from the per-seat look array and `loungeDecor` output. Once `bake()` merges chairs, the scene graph can't be counted.

**Patterns to follow:**
- `DeptScene.block(w, d)` together with `offsetOf` for blockers that move with the room.
- `once()` for shared materials, `bake()` after the rebuild, and `canvasTex` or `woodTex` for the rug.

**Test scenarios:**
- Integration: in the office demo with five Lounge occupants, `__lounge.looks()` for each occupied seat equals `lookFor(occupant id)`.
- Integration: an agent that arrives in an existing emptied chair, with no re-pack, gets `lookFor(its id)` on that seat before it finishes walking.
- Integration: after a re-pack that drops an empty chair, each remaining occupant's seat look still matches `lookFor(its id)`.
- Integration: after several seat rebuilds, the coffee-corner blocker is still registered, and walkers route around the counter.
- Edge case: a Lounge with one occupant shows decor and no errors.

**Verification:**
- Visual check at overview zoom: mixed chairs, decor between seats, warm rug, and every agent tag visible.
- The overview frame-rate probe with a 20-seat Lounge stays in line with today's.

- [x] **Unit 4: Seated activities, held props and doze postures**

**Goal:** Resting agents cycle through quiet activities, and parked agents doze in varied postures.

**Requirements:** R3, R9–R13

**Dependencies:** Unit 1

**Files:**
- Modify: `src/renderer/office/characters.ts`
- Modify: `src/renderer/office/world.ts`. `Target` has no chat id today, so `targetOf` sets a new `doze` field from `dozeFor(chatId)`.
- Test: `tests/renderer/lounge.test.ts` (schedule), `tests/renderer/pose.test.ts` (unchanged mapping stays green)

**Approach:**
- Add joint sets `read`, `sip`, `phone`, `gaze` and three doze variants to a separate `activities` record in `characters.ts`. `PoseName` and the `pose` record stay unchanged. All have `eye` ≥ 0.6 so closed eyes stay reserved for `sleep`, and small offsets from `lounge`. Each should read by silhouette: arms up for a book, one arm to the mouth, head down to the lap, head tilted up.
- In `animate()`, when the target pose is `'lounge'` and the walker is settled, swap in `activityAt(t, c.ph)`. The existing springs blend the change. Keep extra motion amplitudes at or below today's `lounge` breathing and head sway.
- Add three small prop meshes per kit (a book, a phone, a mug) in muted colours, attached to an arm group. Show only the one matching the current activity, hidden whenever walking, parked or not in the Lounge. Size and place them below head height so they don't cover the tag anchor.
- Parked (`'sleep'`) picks one of three joint variants from `T.doze`, for example head tilted left, head tilted right, or slumped back. Eyes stay closed and the tint stays dimmed.

**Patterns to follow:**
- Per-pose modifiers already in `animate()` (the `name === 'lounge'` head sway, the `typ` and `rub` terms).

**Test scenarios:**
- Happy path: `placementFor` still returns `lounge` for idle and `sleep` for parked. The existing `pose.test.ts` stays unchanged and green.
- Happy path: every activity joint set has `eye` above the `sleep` value, which a unit test on the exported pose table checks, if the table is exported for testing.
- Edge case: when an agent becomes parked mid-activity, the prop hides on the next frame and the pose moves to its doze variant.
- Edge case: an agent that starts walking hides its prop.

**Verification:**
- Visual check: with five awake agents, at least two activities show. Nothing in the Lounge draws the eye before a waving "needs you" agent in the door queue. Parked agents are clearly asleep and look different from each other.

- [x] **Unit 5: Parent doc touch-up and final check**

**Goal:** Keep the parent requirements consistent with the new mug placement, and confirm success criteria end to end.

**Requirements:** Success criteria

**Dependencies:** Units 3, 4

**Files:**
- Modify: `docs/brainstorms/2026-09-23-agent-office-requirements.md` (the R5 table row "a mug on the armrest")

**Approach:**
- Reword the row so the resting agent sits in a Lounge seat, sometimes with a mug in hand.
- Run the full renderer suite and the e2e office demo. Check frame rate and grow-by-one smoothness with 20+ seats.

**Test expectation:** none, because this is a documentation change plus a verification pass.

**Verification:**
- Every success criterion in the origin doc checked by eye or by test.

## System-Wide Impact

- **Interaction graph:** A larger Lounge footprint feeds `plan()`'s cost search, so the Lounge may choose a different spot (band or row end) at lower seat counts than today. The camera refit follows automatically.
- **State lifecycle risks:** Seat looks live only in renderer memory and are rebuilt from `seating.seats` plus `lookFor`, so nothing persists and a relaunch reproduces the same looks.
- **Unchanged invariants:** `reseat()`, `spotFor()`, `placementFor()` outputs, grow-by-one, and the rule that agents only walk when their spot changes.
- **Integration coverage:** Decor blockers vs. walking paths and look stability across re-pack are covered by the e2e scenarios in Unit 3.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| A wider grid pushes the Lounge out of the band sooner and reshapes the office | Tune pitch values against the `layout.test.ts` fixtures, and accept a moved Lounge as the cost of R6 (see origin) |
| Full chair rebuild on every look change (now on every arrival, not only re-pack) causes a hitch at 20+ seats | Measure early, as soon as Unit 3 renders. If it hitches, bake chairs in chunks |
| Many chairs changing look at once during a re-pack is itself noisy (R10) | Looks follow occupants, so a re-pack mostly moves chairs with their agents. Check by eye in Unit 5 |
| More materials raise draw calls | Closed palette, with materials created once and merged by `bake()`. Check the frame-rate probe |
| Props read as "busy", or cover tags | Muted colours, below-head placement, and a visual check at overview zoom |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-09-25-livelier-lounge-requirements.md](docs/brainstorms/2026-09-25-livelier-lounge-requirements.md)
- Parent requirements: `docs/brainstorms/2026-09-23-agent-office-requirements.md` (R1, R5, R21)
- Related code: `src/renderer/office/props.ts` (`loungeChair`, `lounge`), `src/renderer/office/layout.ts` (`loungeGrid`), `src/renderer/office/characters.ts` (`pose`, `animate`), `src/renderer/office/world.ts` (`applyLayout`, `placeLounge`, `offsetOf`)
