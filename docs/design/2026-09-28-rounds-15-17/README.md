# Design Rounds 15–17: one philosophy, four ideas, interactive prototypes

The boards live on the design canvas: https://claude.ai/artifact/VriJh789MbBDismRPxar73. Round 17 is the latest.

| Canvas page | Boards | What it is |
|---|---|---|
| Round 17 · A · Scale | `SC3-00-Idea`, `SC3-10-App` | Design document and interactive desktop prototype |
| Round 17 · B · Signal box | `SB3-00-Idea`, `SB3-10-App` | same |
| Round 17 · C · Stations | `ST3-00-Idea`, `ST3-10-App` | same |
| Round 17 · D · Flow | `FL3-00-Idea`, `FL3-10-App` | same |
| Round 16 · A–D | `…2-20-Mobile` | Interactive mobile prototypes. They don't have the Round 17 changes yet |
| Round 16 · 3D stations | `Metro3D` | The shared 3D view, embedded by every prototype |
| Round 15 · A–D | `…-00-Idea`, `…-01-Hub`, `…-02-Session` | The first, static pass at the four ideas |

The prototypes are interactive. Press Play on an artboard, and click inside once so the keyboard shortcuts work. Each one is a single `.dc.html` file whose CSS holds the real tokens, component classes, transitions and keyframes. Read them for exact values.

## The four ideas

They share one look: Geist, dark-first, stage colours, amber for needs you, red for blocked. They differ in what organises the product:

- **Scale** (one line, every zoom): the line is the only object, and you move between zoom levels (Network, Line, Stop, Code). A clickable zoom path sits in the title bar.
- **Signal box** (where you're needed comes first): the decision rail is primary, and one decision row is used everywhere. The map explains the selected decision.
- **Stations** (each stage has its own job): the session page changes layout per stage (Work, Review, Plan, Ship, Merged), and the triage is grouped by station.
- **Flow** (signals in, lines out): the intake stream feeds the network, lines start from their source chips, and rules act as gates.

No idea has been chosen yet. Pick one before implementing, or combine them deliberately.

## Decisions that change the requirements

These override `docs/brainstorms/2026-09-27-metro-workspace-requirements.md` and the plan `docs/plans/2026-09-27-001-feat-hub-and-workspace-plan.md` where they disagree.

**Network (hub)**
- No stage columns, headers or grid. Segment colour alone tells the stage (changes R5).
- No dashed leads for skipped stages; a line leaves its repo in its first stage's colour (changes R5).
- No "N done" pills (changes R6) and no grey remainder line to `main`; a line ends at its tip.
- Stage-transition circles are interactive. Hover shows the outcome and time with **Open here** and **Branch from here (B)**; click opens the session at that stop.
- No loose status text at tips. The name sits at the line's start, and status shows through the tip ring, the hover card and one aligned status treatment per idea.
- You start a new line by clicking the repo station itself: no hover "+", and no Start box in the triage (changes R8). ⌘N also works.
- "+ Add repository or folder" sits under the stations. It offers a folder path, a clone URL, and repos detected on the machine.
- **The user doesn't pick the starting stage; the app decides** from the prompt (changes R8's starting-stage picker).
  - The new line grows in neutral grey with "choosing where to start…", then recolours to the chosen stage.
  - A toast says "Starts at Plan · Change".
  - The classifier is never named in the UI.
- A merged line marked done un-draws back into its repo station. The station pulses and a "N merged today" counter ticks up.
- A reconnected side chat retracts into its parent at the fork and leaves an interchange mark.

**Getting around**
- A **toggleable sidebar** (⌘B, and a button after the traffic lights) on the hub and in sessions. It lists repos, their lines and indented side chats; a repo header starts a new line; "Add repository" and Settings sit at the foot. This changes R10's "no sidebar": it's allowed because it's toggleable.
- Opening a session is calm and fast: a 180–200ms fade with an 8px rise, the same speed back, and input live immediately. No geometry morphs between screens.

**Session**
- Nothing sits above the active stop by default. Earlier stops live as blocks on the left line, and clicking one reveals it above (animated), with "Back to now" (Esc). This changes R12's folded earlier stops.
- The **codebase view is a tab** of the right column next to "Open & tasks" (⌘⇧M), and the column widens (~340 → 620px).
  - It's a graph of the whole codebase: every file is an endpoint and directories are internal nodes. Only the top-level areas are labelled; there are no file names.
  - It opens with one camera move onto the touched endpoints, as a pruned tree. Endpoint area is proportional to the lines changed, read-only files are rings, and the file being written breathes.
  - A small inset shows the whole graph.
  - A reach line and a flag say how far the change reached, e.g. "Changes packages/ui/Form — used by 3 apps". Endpoints outside the plan get a neutral dashed halo, never amber or red.
  - Clicking an endpoint or branch shows file names, +/−, stop and the diff.
  - The shared demo data is `codebase.json` here.

**3D view**
- The 2D/3D toggle shows `Metro3D`: one station per stage, where small matte blob characters (the office's character style) work at each station. Small metros carry them between stations.
- Needs-you characters raise a hand with an amber "?", and blocked ones sit behind a barrier. Clicking a character opens its line.
- Characters are welcome here, and only here.

**Motion**
- 120–180ms for hover, press and fades; 200–280ms for layout changes; stroke-dashoffset for lines growing and un-drawing.
- `cubic-bezier(.2,.8,.2,1)` for entering and `cubic-bezier(.4,0,.2,1)` for moves.
- No springs in 2D, reduced motion respected, and nothing animated blocks the next click.

**Mobile**
- The phone is a real native app, not a push bridge: rich notifications, Live Activities, sheets.
- Risky requests need Face ID plus a hold, and are never allowed from a notification button.
- The mobile prototypes still need the Round 17 changes, and your mobile feedback is still to come.

## Files here

- `briefs/`: the briefs the prototypes were built from, in order: `round-15-base.md`, `round-15-ideas.md`, `round-16.md` and `round-17.md`, plus `scenario-and-format.md` (the demo scenario and the canvas file format). Paths in them that point to `/tmp/…` were the cloud build folders and no longer exist.
- `codebase.json`: the demo codebase for the endpoint graph (589 files in `storefront`, 16 in `habit-tracker`) and what three sessions touched.
