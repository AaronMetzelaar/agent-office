# Hub and workspace design boards

These are the chosen boards from the design canvas: https://claude.ai/artifact/VriJh789MbBDismRPxar73

They're artboard sources for the canvas's Design type. They use its `support.js` and `{{holes}}`, so open them on the canvas to see them rendered. Here they're for reading markup, colours and geometry.

| Board | What it shows | Requirements |
|---|---|---|
| `Z5-Hub.dc.html` | The hub: the network on the left, the triage column on the right | R4–R9 |
| `Z3-Auto.dc.html` | Suggested work and lines started for you (Round 13; see the deviations below) | R26–R32 |
| `U1-Switcher.dc.html` | The workspace with the title-bar switcher open | R10–R13, R17 |
| `U2-CtrlTab.dc.html` | The ⌃Tab overlay | R17 |
| `U3-Resting.dc.html` | The workspace at rest: squeezed line, open stop, right column | R10–R13 |
| `V1-Incoming.dc.html` | Connector items arriving | R26–R29 |
| `V2-Connected.dc.html` | "Connected to this line" in the workspace | R13, R26 |
| `S4-Workbench.dc.html` | The ⌘J workbench (Round 7, drawn in the older shell) | R14 |
| `S5-Branch.dc.html` | Branching from an earlier stop into a new chat (Round 7, drawn in the older shell) | R23–R25 |

`hub.py` generates `Z5-Hub`. Its constants hold the network geometry that Unit 7 of the plan ports: the stage column x positions, the lane spacing and the 45° fan-out.

The rejected rounds are kept on the canvas only: characters, the isometric office, and the early skins.

## Where the boards disagree with the requirements

Found in the 2026-09-28 review. The requirements win. Treat these as known deviations when building, not as spec.

- **`Z3-Auto` shows machinery** that R2 rules out: "Jev", "397 stop here", per-source scan counts, and "Scans hourly · last 12:00 · next 13:00 · 412 in". It also draws the sources as lines, which R3 rules out. Use only its right half, the "Started for you" and "Waiting for your go" rows, as the pattern for rows.
- **`V1-Incoming` lists raw connector items**, the Sentry error, the Slack question and the Gmail request, separately at the top of the switcher. R27 merges them into one suggestion, R28 puts suggestions in the hub's Your call, and R17's switcher has no connector section.
- **`S4-Workbench` and `S5-Branch` are Round 7 boards.** They have a separate chat header row, a bottom status bar and a horizontal line, which contradicts R10 and R11. Their content (tabs marked with stops; "Continue from a stop" against "Reply at the tip") is the reference, and the shell comes from `U3-Resting`.
- **Shortcuts:** the boards say "Network ⌘1" and "Whole network ⌘1". The hub is ⌘0 (R4, R17), and ⌘1 is the current menu's Inbox.
- **Connector colours** are hard-coded outside the theme tokens (`#fb923c`, `#a78bfa`, `#34d399`, `#60a5fa`, `#e879f9`, `#d9a066`), so they don't change in the light theme, where they reach about 2:1. Each also sits within 12° of hue of a stage or status colour. GitHub is the exact Brainstorm purple, Linear is about Work green, Gmail is about Plan blue, and Sentry and Claude Code are about the amber for needs you. The workspace boards (`V2-Connected`) use neutral monogram chips (GH, SE, SL, GM) instead, and those fit R3.
- **A row's ring doesn't always match its line's tip** (R9). In `Z5-Hub`, "Fixing the saved-cards crash" has a Review-pink tip and a Work-green row ring.
- **Pills and status labels collide with lines.** In `Z5-Hub` the "N done" pill sits on the dashed skipped lead ("Answer comments #212", "Fixing the saved-cards crash"). The status labels "fix ready" and "reviewing" are drawn over their own line, and "Try canvas" crosses its parent's fork.
- **Map text is under 12 px.** The map is a fixed 860×620 SVG scaled to 1000 px wide. The pill labels are 9.5 units, and at a 1280-wide window they render at about 9 px.
- **Contrast:** light amber `#e08a00` is 2.4:1 on `#f4f4f1`. Light `muted` is 4.3:1. Dark `muted` on `raised` is 4.2:1. Future-stop markers (`faint`) are 1.4–1.8:1 in both themes. Plan Unit 6 has the target values.
- **`U3-Resting` uses amber dots for "defaults in use"** (Keep / Change) under an "Open · nothing blocked" header. R3 keeps amber for needs you.
- **Copy slip:** `V2-Connected`'s message box says "Message Habit tracker" on the Checkout chat.
