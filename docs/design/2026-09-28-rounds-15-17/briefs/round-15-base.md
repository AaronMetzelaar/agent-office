# Round 15 brief — one design philosophy, four ways to get there

## What the owner wants (read carefully — the last attempt missed it)
The owner is HAPPY with the existing design direction. Do NOT invent a new visual identity, new fonts, new palettes or new metaphors. Keep:
- the **hub** (Round 14, `Z5-Hub`): the network of lines growing from each repo's `main` through shared stage columns, plus a triage column (Start something new / Jump in / Review / Your call / Finished today)
- the **chat view** (Round 9, `U3-Resting`, `U1-Switcher`, `U2-CtrlTab`): header merged into the title bar, the chat's **metro line squeezed on the left** showing the current stage in the process, **earlier stops collapsed into compact blocks** above the open stop, the open stop gets the page, a right column (Open / Tasks / tests & changes / Connected), notifications bottom-right answerable in place
- **connectors** (Round 10, `V1-Incoming`, `V2-Connected`) and the ⌘J **workbench** / branching ideas (`S4-Workbench`, `S5-Branch` — their content, not their older shell)
- the visual language: dark-first with a light theme, Geist + Geist Mono at 12–14px, stage colours, amber = needs you, red = blocked, neutral chrome, metro elements only where they explain.

The task: bring all of it together into ONE coherent design philosophy + design document, covering every screen and form factor. There are FOUR ideas for what that unifying philosophy is. Each idea keeps the same look and components; they differ in the organising principle — what the product is "about", what's primary, how screens relate, how it scales to swarms of agents, and how it plays each platform. Each needs a name, a brief, a system outline, and a convincing story for why it (and not the other three) suits an agentic future where the user's attention and fast, high-quality decisions are the premium.

## Start from the real files
The existing boards are in `/home/user/agent-office/docs/design/2026-09-27-hub-and-workspace/` (`Z5-Hub.dc.html`, `U3-Resting.dc.html`, `U1-Switcher.dc.html`, `U2-CtrlTab.dc.html`, `V1-Incoming.dc.html`, `V2-Connected.dc.html`, `S4-Workbench.dc.html`, `S5-Branch.dc.html`, and `hub.py` which generated the hub's geometry). Screenshots of them rendered are in `/tmp/claude-0/-home-user-agent-office/3f088f39-de60-521d-ab9e-ef480160be1a/scratchpad/render/*.png` (e.g. `Z5-Hub-dark.png`, `Z5-Hub-light.png`, `U3-Resting-dark.png`, `U1-Switcher-light.png`, `V2-Connected-dark.png`, `S4-Workbench-dark.png`, `S5-Branch-dark.png`, `Z5-1280-dark.png`). READ THE MARKUP AND LOOK AT THE SCREENSHOTS before designing. Reuse their markup, spacing, sizes and component shapes — copy and adapt, don't redraw from scratch. Your boards must look like the same product, a step further.

## Keep, but fix (these came out of the design review — apply them in every idea)
- **Connector marks are neutral monogram chips** (as in `V2-Connected`: small rounded squares, raised fill, muted mono 2-letter code: GH, SE, GM, SL, LN, IC (Intercom), MP (Mixpanel), MB (Metabase), CC (Claude Code)). Never coloured squares, never lines.
- **A row's ring always matches its line's tip** (same colour, same state).
- **"N done" pills sit on the solid part of a line**, never on a dashed skipped lead; status labels never sit on top of their own line; side-chat names don't cross the parent's fork.
- **Amber only for needs you.** "Defaults in use" (Keep / Change) use a neutral marker, not amber.
- **Status isn't hue alone:** needs you = amber ring + a small dot/"?"-style inner mark; blocked = red ring + a short bar. Keep it subtle.
- **Compound** exists after Merged: show it as the last stop in the Merged column.
- **Map text ≥ 12px** (no scaling a fixed SVG down); **triage rows are two lines max** with actions inline; the triage column scrolls with Jump in pinned.
- Shortcuts: the hub is **⌘0** (not ⌘1). Esc returns to the hub. ⌘K search, ⌃Tab switcher, ⌘J workbench, ⌘L expand line, ⌘D diff, ⌥Y/⌥N in notifications.
- Never show machinery: no classifier names, no confidence scores, no scan counts, no "N filtered", no "scans hourly".

## Base tokens (from the existing boards, with the contrast fixes)
Dark (default):
- t: bg `#0b0c0e`, panel `#121316`, raised `#1b1c20`, line `#232428`, grid `#15161a`, sel `#1d1e22`, ink `#ececE8`, ink2 `#b9b9b3`, muted `#84847e`, faint `#34353a` (remaining track / hairline tracks only), stop `#5c5e66` (future stop markers, ≥3:1), onColour `#0d0e10`
- c (stages): brainstorm `#a78bfa`, plan `#5b93ff`, work `#3cc98a`, review `#f06cc1`, ship `#38c6d6`, merged/compound = ink2
- s: needs `#ffb224`, needsInk `#ffcf70`, soft `rgba(255,178,36,0.10)`, fail `#ff6b5e`, failInk `#ff8a80`, ok `#3cc98a`
Light:
- t: bg `#f4f4f1`, panel `#f7f7f5`, raised `#efefec`, line `#e6e6e1`, grid `#ecece8`, sel `#e9e9e5`, ink `#141414`, ink2 `#3d3d3a`, muted `#6d6d68`, faint `#d0d0ca`, stop `#8e8e80`, onColour `#ffffff`
- c: brainstorm `#7c4ddb`, plan `#1f63e0`, work `#13905a`, review `#c2338f`, ship `#0b8c9c`
- s: needs `#c67a00` (rings/strokes), needsInk `#8a4b06` (text), soft `#fdf3e1`, fail `#d92d20`, failInk `#b42318`, ok `#13905a`
Type: Geist 400/500/600/700 and Geist Mono 400/500 — the existing Google Fonts link. 12–14px UI; 17px/600 for a stop heading; nothing under 11px.

## Rules from the owner (break none)
No large italic headers, no hero headlines, no slide-deck layouts, no decorative empty space. Not text-heavy (transcripts are content and may be). No heavy box-in-box (one level of container max; separate with space, hairlines, alignment and weight). Every colour means one thing. Every desktop action has a shortcut. Rejected before, never bring back: characters/mascots, the isometric office, a permanent sidebar of chats, sources drawn as coloured lines, scan/judging dashboards.

## Two future features every idea must accommodate natively
1. A cute **3D "virtual agent metroline" view** as an alternative to the 2D network (toy-like raised tracks in stage colours, stations as little platforms, each line's tip as a small rounded train car, no faces). Show where it lives in your idea and a small vignette of it in your idea's language.
2. A **codebase metro map side view** in a session: the repo drawn as a metro map (directories = neutral lines, files = stations) showing which files the agent READ and WROTE at which stops, synced to the chat's line (hovering a stop lights up files touched there). Show it open in your idea's active session board.

## Scenario (use exactly — standalone product, no company-specific content, never a real person's name)
Use the scenario section ("One scenario, used by all four designs") and "Extra product facts" in `/tmp/claude-0/-home-user-agent-office/3f088f39-de60-521d-ab9e-ef480160be1a/scratchpad/brief/shared.md`: repos `storefront`, `payments-service`, `habit-tracker`; lines Saved-cards crash fix (started for you), Checkout redesign, Dialog CI fix (risky force-push, needs you), Checkout: saved cards (Review, outward Slack post), Refund webhook retries (blocked, waits for #214), Review #412, Admin: bulk export (plan ready), Rate limiter (question: per user or per API key?), Try token bucket (side chat), Idempotency keys (plan ready), Webhooks v2 (suggestion from Linear), Habit tracker (task 6 of 9 Settings page), Codex · Search index rebuild (companion). Signals: Sentry + Slack + PR #214 merged into one; Mixpanel iOS checkout −8%; Intercom 6 reports promo code field; Gmail security review; Linear PAY-812; Dependabot ×3; Metabase refunds report (FYI). Active session transcript and codebase map data are there too. Mobile is a real native app (rich notifications, widgets/Live Activities, Face ID); risky requests need a deliberate confirmation (click on desktop, Face ID + hold on the phone), never a notification button.

## File format
Follow the "Format rules for every artboard" section in `shared.md` exactly (skeleton, support.js line, fixed root size = `$preview`, `{{holes}}` are lookups only, tokens in renderVals, `dark` boolean prop default true that switches every token, real buttons/inputs/labels, SVG with role="img" + aria-label, no emoji, no fake phone status bar/keyboard, macOS traffic lights in the desktop title bar, a minimal browser frame for web boards). Copy the existing boards' `renderVals` token structure (t, c, s) with the values above.

## How to work
- Write boards to `/tmp/claude-0/-home-user-agent-office/3f088f39-de60-521d-ab9e-ef480160be1a/scratchpad/r15/project/<PREFIX>-NN-Name.dc.html` with the Write tool. Only your own files. Don't publish.
- Preview: `cd /home/user/agent-office && node .design-shot.mjs <absolute path>` prints a PNG path (add `--flip` for the other theme); Read the PNG and fix overlaps, clipping, text < 11px, visible `{{…}}`, contrast. ERRORS lines = runtime errors — fix them.
- Quality bar: high-fidelity, dense, precise, consistent with the existing boards. Compute SVG coordinates carefully. No lorem ipsum, no invented metrics beyond the scenario.
- Reply when done with the files, sizes, and 2–3 lines on anything you couldn't do.
