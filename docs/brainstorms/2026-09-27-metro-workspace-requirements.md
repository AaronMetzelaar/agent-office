---
date: 2026-09-27
topic: metro-workspace
---

# A metro map for every chat

## Problem Frame

The 3D office always fills the whole window. A chat opens as a side panel floating over it, `clamp(420px, 34vw, 560px)` wide (`src/renderer/office/Office.vue`). The docked terminal is a second floating card next to that panel (`src/renderer/panels/chat/Terminal.vue`). Most of the screen shows characters, while the work itself (text, plans, diffs, code, terminals) gets squeezed into about a third of it. That's the opposite of what an agentic coding session needs most of the time.

The app also doesn't guide the work. The only process it knows is the ship-it strip (test cases, verify, code review, fix CI, answer comments, clean up, move ticket in `src/main/workflow/next-step.ts`), and it only shows once there are changes. It has no idea of brainstorm → plan → work → review → compound. You can't see what a chat has done so far, which subagents it sent out, or which connectors it used, except by scrolling the transcript.

Nothing about a chat's workspace is kept. The open tab resets to Chat on every switch (`Chat.vue`), "terminal shown" is one global flag, and each chat has at most one shell.

This iteration changes what the app is centred on. Text, documents, code and terminals get most of the window, laid out per chat and restored exactly. A metro map shows each chat's progress: the process stages are the lines, turns are the stops, subagents branch off and rejoin, and connectors run in from the side. The route guides the user through the full compound-engineering process, using their skills at each stage. The characters stay, but on a departure board instead of a 3D floor.

```
┌────────┬─────────────────────────────────────┬──────────────────────────┐
│ board  │  ● Brainstorm ─ ● Plan ─ ◉ Work ─ ○ Review ─ ○ Ship ─ ○ Compound │  ← route strip
│ (thin) ├──────┬──────────────────────────────┼──────────────────────────┤
│ 🟢 ··· │  ┃   │ transcript                    │ document / diff / code   │
│ 🟠 ··· │  ●   │  you: …                       │                          │
│ 🔵 ··· │  ┣━╮ │  Explore agent …              │                          │
│        │  ┃ ┃ │                               ├──────────────────────────┤
│        │  ┣━╯ │                    ═══ Linear │ terminals  [1] [2] [+]   │
│        │  ◉   │  (working…)                   │                          │
│        │ rail │ composer                      │                          │
└────────┴──────┴───────────────────────────────┴──────────────────────────┘
```

## Requirements

**Visual language**
- R1. The look comes from metro maps, kept clean, modern and minimal. Lines are thick and flat-coloured and run only at 0°, 45° and 90°. Stops are short ticks or small circles, and interchanges are white capsules with a dark outline. Labels use one sans typeface, and the background is white or near-white. There are no gradients, textures or drop shadows on the map.
- R2. Every colour means one thing. Colours have four roles:
  - **Stage lines.** Each stage of the route has its own fixed colour (R6).
  - **Connector lines.** Each connector has its own colour, and it's the same in every chat and on the board (R10).
  - **Status.** Amber means needs you, and red means failed, stuck or dangerous. These two are reserved, and no line ever uses them.
  - **Chrome.** Buttons, panes, text and borders are neutral ink and greys. The chrome has no accent hue of its own, so today's accent blue (`--accent #1b34ff`) becomes ink and blue is free for a line.
- R3. Every chat has a map key, one click away, like the key on a metro map. It lists each colour that appears in this chat and what it means: its stages, its connectors and the status colours.

**A chat's line**
- R4. The line runs as a vertical rail down the left of the transcript, from oldest at the top to newest at the bottom. The rail scrolls with the transcript. Each stop sits level with the message it belongs to, and clicking a stop scrolls to that message.
- R5. A route strip across the top of the chat shows the whole route: every stage as a station, with the ones already passed filled in, the current one lit, and the ones ahead in grey. The strip stays visible when the rail has scrolled away from the current stop.
- R6. **Stages are lines.** Each stage is its own coloured line, and the chat "changes line" at each interchange. The rail segment for a stage is drawn in that stage's colour, so the colour always tells you the stage. An interchange marks each stage the chat enters and is labelled with the stage name and the skill that started it.
- R7. **Turns are stops.** Each user prompt inside a stage is a small stop on that stage's line. Tool calls don't get stops; they stay in the transcript.
- R8. A chat can enter the route at any stage. A quick fix can start at Work. A stage the chat skipped shows as a hollow "not stopping" station on the route strip, not as a gap. Going back to an earlier stage, for example from Review back to Work, draws a new interchange further down the rail. The line never rewinds.
- R9. **Subagents branch off and rejoin.** A subagent's branch leaves the trunk at the stop that sent it out. It runs alongside in the parent stage's colour, thinner than the trunk, labelled with the subagent type.
  - While it runs, its tip shows live tool uses and runtime, from the stats shipped in `SubagentStrip`.
  - When its result comes back, the branch rejoins the trunk at that point.
  - Subagents that run in parallel are drawn as parallel branches.
  - A subagent that fails or is stopped ends in a terminus bar instead of rejoining.
  - Clicking a branch opens its history (the shipped `SubagentView`).
  - Only one level of branching is drawn. Deeper subagents show as a count on their parent's branch.
- R10. **Connectors join from the side.** When a connector is used, a line in that connector's colour runs in from the right edge of the rail to the stop where it was used, labelled with the connector's name. Several uses in the same stage share one line with a count. A connector is:
  - any MCP server, found from the `mcp__<server>__` tool prefix: GitHub, Linear, Figma, Sentry, Slack and so on
  - a service the app itself talks to on the chat's behalf, such as GitHub through `gh` or Linear tickets
  Connector colours come from the app's line palette and are assigned once, then kept. `departments.json` can pin a connector's colour. No vendor logos are used anywhere (as in the open-source release doc, R12/R35).
- R11. The current stop shows the chat's state. Working shows a moving marker (the "train"). Needs you gets an amber ring, and stuck or failed gets red. This is the only place on the line where status colours appear.
- R12. The rail is narrow when the trunk is all there is and widens only while branches or connectors need the room. The user can collapse it to a hairline for maximum text width. The route strip stays either way.

**The guided route**
- R13. The default route is compound engineering: Brainstorm → Plan → Work → Review → Ship → Compound. Each stage runs one of the user's installed skills (for example `ce:brainstorm`, `ce:plan`, `ce:work`, `ce:review` and `ce:compound`). Ship takes in today's ship-it steps (test cases, verify, PR, fix CI, answer comments, clean up, move ticket) as stops on its line, and keeps their conditions from `next-step.ts`.
- R14. A stage starts when its skill runs, either as a slash command or through the Skill tool, or when the user picks the station. If a chat does work that clearly belongs to a stage without running its skill, the chat moves to that stage. For example: plan mode or `ExitPlanMode` means Plan, the first file edit means Work, and opening a PR means Ship.
- R15. **Suggest the next station, never force it.** When a stage looks finished (its skill ended, its document was written, the turn is done), the next station on the route strip lights up and a "Continue to Plan" button appears above the composer. The button sends that stage's skill along with what the last stage produced, such as the path of the brainstorm doc. The user can take it, skip ahead, jump to any station, or keep chatting. The app never moves on by itself.
- R16. If a stage's skill isn't installed, its station says so and offers a plain-prompt fallback, so the route still works for someone without the compound-engineering plugin. This matches how the open-source release doc handles ship-it steps (R27).
- R17. Each interchange links to what its stage produced: the brainstorm doc, the plan, the diff, the review findings, the PR or the compound doc. Clicking it opens that output in the document pane (R19).
- R18. Routes are config. A `routes` section in `departments.json` defines each route's stations: a label, a colour from the line palette, a skill or a prompt, and optionally a default layout (R21). A room can use a different route. The shipped `commands.ship`, `fixCi` and `answerComments` settings map onto the Ship stage, so existing config keeps working.

**The workspace**
- R19. An open chat gets most of the window. It has three kinds of pane:
  - **Conversation.** The rail, the transcript and the composer, with permission, plan and question cards.
  - **Document.** Tabs for documents, diffs, files, artifacts and the simulator. Files are shown with highlighting and open in the editor, since the app isn't a code editor.
  - **Terminals.** One or more shells for this chat as tabs, which can be split in two.
- R20. Panes can be resized, collapsed and swapped side for side. A pane can be maximised to fill the workspace. "Give me the whole screen for this diff" is one keystroke away.
- R21. **Stage defaults, then remembered.** The first time a chat enters a stage, the workspace takes that stage's default layout:
  - Brainstorm and Plan: conversation and the document being written.
  - Work: conversation, diff or code, and a terminal.
  - Review: the diff and the review findings.
  - Ship: PR and CI status, and a terminal.
  - Compound: conversation and the document being written.
  Whatever the user changes after that is saved for that chat and that stage. Coming back to the stage restores it. A setting turns off switching layout by stage, for users who want one layout per chat.
- R22. Each chat keeps its whole workspace. That covers:
  - which panes are open, their sizes and arrangement
  - the open tabs and which one is active
  - scroll positions
  - the rail collapsed or not
  - its terminals: how many, their names, folders and scrollback
  Switching to a chat puts it back exactly as it was, instead of resetting to the Chat tab as today. It's stored in SQLite with the chat, not in `localStorage`, so it survives restarts and updates.
- R23. Terminals already stay alive while you switch chats (`src/main/terminal.ts`). After an app restart, each saved terminal reopens in its folder with its old scrollback, below a "restarted" divider. Processes don't survive a quit, and the divider says so honestly.
- R24. The existing keys keep working: ⌘K search, Ctrl+Tab to the next chat that needs attention first, and running a code block in the terminal. New keys move focus between panes and maximise the focused one.

**The departure board**
- R25. The home screen is a departure board, one row per chat. Each row shows:
  - the chat's character
  - its title and repository
  - its route as a small horizontal line, with the current station lit in its stage colour
  - small dots for the connectors it's using right now
  - how many subagents are running
  - its state
  - how long it has been in the current stage
  Rows are sorted the way Ctrl+Tab picks: needs you, then working, then idle and done.
- R26. Rooms become sections on the board, one per repository as shipped. Sections are labelled by name only. Room accent colours leave the UI, because on a metro map colour belongs to lines.
- R27. The door queue and inbox move onto the board. A permission request shows on its chat's row with its answer buttons and goes through the one `resolveRequest` path. PR review requests get their own section with the start-review button.
- R28. The characters stay, in the same big-eyed matte style, drawn small on the board with the poses that show state (working, waiting for you, done). A character wears the colour of the line its chat is on. The 3D floor stops being the home screen. It stays reachable as an optional Floor view until the board has proven itself in daily use, and then it's decided whether it goes.
- R29. While a chat is open, the board folds into a narrow column on the left with each chat's character and a state mark. Chats that need you, across the whole office, stay visible there. The column expands back to the full board on hover or with a key.

**Companion agents**
- R30. Sessions the office watches but doesn't host (the open-source release doc's companion agents) get the same line and the same board row, built from their hooks and transcripts. Their workspace shows the line, a read-only transcript, the diff and terminals, but no composer. Their next-station button copies the stage's command and brings the agent forward so the user can paste it, as in that doc's R15.

## Success Criteria
- Aaron does his daily work in the workspace, not the 3D floor, and doesn't reach for the desktop app to read long output or diffs.
- A chat can go from Brainstorm to Compound without the user typing a skill name, using only the next-station suggestions.
- The five-second test on the board: at a glance, the user can say which chats need them and which stage every chat is in.
- Coming back to a chat after switching away or restarting the app shows the same panes, tabs, scroll positions and terminals, with no visible reset.
- Every coloured mark in the app can be explained by the map key.

## Scope Boundaries
- No code editor. Files and diffs are shown and open in the user's editor.
- No drag-and-drop route editor. Routes are `departments.json` config.
- Only one level of subagent branches is drawn.
- Light theme only in this iteration. Dark comes later, and the colour roles in R2 have to hold for it.
- The chat engine, accounts and permission handling don't change. This is a new shell around them.
- No CI dashboard. Ship shows the PR's checks, as the review panel does today.

## Key Decisions
- **Workspace first, characters on a board.** A full-screen office leaves the least room for the thing people read most. A departure board keeps the characters and makes "who needs me" scannable across many chats. The 3D floor stays reachable until the board has earned its place.
- **Stages are the lines.** With the trunk coloured by stage, the colour of any stretch of line answers "what was happening here". The other options were a colour per chat, like today's avatars, or a colour per room. Either would have made colour mean identity and needed another channel to show stage.
- **Subagents take their parent stage's colour.** A subagent is part of the stage that sent it, and this keeps the palette for connectors. Its type goes on its label, not in a hue.
- **Status colours are reserved, and the chrome has no hue.** "Every colour means something" only works if nothing else takes amber, red or the stage colours. The chrome goes neutral so it never reads as a line.
- **Characters wear their line's colour.** This follows from one colour, one meaning. The cost is that two chats in the same stage look alike, so the character's shape (one per agent type in the release doc) and the row title carry identity. This is the decision most worth checking against daily use.
- **Room accents leave the UI.** Rooms stay as sections because they're useful, but their colour would compete with the lines.
- **Suggest, don't force.** The route guides the user and each suggestion is one click. Skipping and jumping are always allowed, because much real work (a quick fix, a review-only chat) doesn't need every stage.
- **Stage defaults, then remembered per chat.** Each stage knows what it needs on screen, and the user's own changes win and stick.
- **A compound-engineering route by default, as config.** It works out of the box for the user's own setup, and the plain-prompt fallbacks keep it usable without the plugin.

## Dependencies / Assumptions
- The compound-engineering skills are installed in the user's Claude Code, and the app already scans skills (`src/main/commands/scan.ts`). They aren't installed in every environment, so R16's fallbacks matter.
- Chat rows are capped at 200 in memory (`src/shared/chat.ts`), and full history is rebuilt from Claude's session files (`src/main/sessions/replay.ts`). A line that covers a whole chat has to be built from that full history, not from the cap.
- The open-source release (`docs/brainstorms/2026-09-27-open-source-release-requirements.md`) is planned in parallel. R30 assumes its adapters and companion-agent events.

## Outstanding Questions

### Resolve Before Planning
- None.

### Deferred to Planning
- [Affects R14][Technical] The exact rules that move a chat to a stage without its skill, and how to avoid flapping between stages.
- [Affects R10][Technical] Which tool uses count as connectors beyond `mcp__*`. For example, whether a `gh` or `linear` Bash command counts as a GitHub or Linear connector.
- [Affects R4, R9][Technical] How to draw the rail: SVG laid out against the transcript's message positions, or a canvas. How it stays in sync as messages stream in and resize.
- [Affects R22, R23][Technical] The shape of saved layouts per chat and stage in SQLite, and how much terminal scrollback to keep on disk.
- [Affects R28][Design] Whether the board's characters are small renders of the existing Three.js characters or redrawn in 2D, and how poses read at that size.
- [Affects R2][Design] The line palette: six stage colours plus enough connector colours that are clearly different from each other, from amber and red, and from each other at thin widths, and that work for colour-blind users (shapes and labels back up every colour).
- [Affects R18][Technical] How `routes` config merges with the shipped `commands` section, and how a room picks its route.
- [Affects R30][Technical] Which stages can be detected for companion agents that don't use Claude skills.
- [Sequencing] Whether this lands before or after the open-source release, or its board replaces the release doc's floor as what strangers see first.

## Next Steps
→ A clickable HTML prototype of the board, the rail and the workspace, to settle the palette and the rail's look before `/ce:plan`.
→ Then `/ce:plan` for structured implementation planning.
