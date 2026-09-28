---
date: 2026-09-27
topic: metro-workspace
---

# A hub and a workspace for many agents

## Problem Frame

Agent Office shows every chat as a character in a full-screen 3D office. A chat opens as a floating side panel about a third of the screen wide, and the terminal floats next to it. Most of the screen shows characters, while the work itself (replies, plans, diffs, code, terminals) is squeezed into what's left. That's the opposite of what someone running eight agents at once needs most of the day.

The app also doesn't guide the work or bring it to you:
- It knows only the ship-it steps, not brainstorm → plan → work → review → compound.
- You can't see what a chat has done, what it chose on your behalf, or what it's waiting for without reading its transcript.
- Work that starts elsewhere (a Sentry issue, a review request by mail, a Linear ticket moving into the cycle, a Slack question) never reaches the office unless you carry it there yourself.
- Nothing about a chat's workspace is kept between switches.

This iteration replaces the 3D office with two places:
- **The hub** is where you see what's happening, jump in where you're needed, review what's ready, make the calls that are yours, and start new work.
- **The workspace** is one chat, with its conversation, its progress and whatever it needs from you.

Metro maps are the supporting visual language. Each chat is a line whose stops are its stages and tasks. Lines grow outward from their repository's `main`, and side chats branch off the stop they came from. The theme explains progress and structure. It never decorates, and it never shows machinery the user doesn't care about.

The design was explored on a canvas of prototypes: https://claude.ai/artifact/VriJh789MbBDismRPxar73. The final direction is Round 14 (the hub) together with Rounds 8 to 10 (the chat view, the switcher and connectors). Earlier rounds show what was rejected and why.

```
┌ Agent Office · 11 lines · 2 need you · 3 to review ─────────────── ⌘K ─┐
│  Brainstorm  Plan   Work ─────────────  Review  Ship  Merged │ Start something new… ⌘↵ │
│ (habit-tracker)━━━━━━━━━━(5 done)━━━━◉─ ─ ─ ─ ─ ─ ─         │ Jump in · 2             │
│ (agent-office)━━(4 done)━━◉  Rail renderer (needs you)      │  ◯ Rail renderer  [1][2]│
│        ┗━━━◉ Try canvas (side chat)                          │ Review · 3              │
│ (monorepo)┅┅┅┅┅┅━━◉ Fixing the saved-cards crash (Sentry)    │  ◯ Crash fix  [Review]  │
│        ━━━━━━━━━━━━━━━━━━━━━━◉ Checkout · reviewing          │ Your call · 2           │
└──────────────────────────────────────────────────────────────┴─────────────────────────┘
```

## Requirements

**Visual language**
- R1. The app is a dense, calm tool, not a presentation. It's dark by default and has a light theme. The type is Geist and Geist Mono at working sizes (12–14 px). Every action has a keyboard shortcut. No screen uses slide-like layouts, hero headlines or empty decorative space.
- R2. The metro theme supports and explains; it doesn't decorate. Lines, stops, stage colours and branch marks appear only where they show progress, structure or where something came from. The UI never shows internal machinery: classifiers, scan counts, triage gates or confidence scores.
- R3. Every colour means one thing:
  - **Stage colours.** Each stage of the route has a fixed colour, used on lines and on the ring before a chat's name.
  - **Status colours.** Amber means needs you, and red means blocked or failed. They're reserved and never used for a stage.
  - **Source colours.** Each connector has a small coloured square, shown only as a source label, never as a line.
  - **Chrome.** Everything else is neutral ink and greys.

**The hub (home, ⌘0)**
- R4. The hub is one view with two parts: the network on the left, taking most of the width, and a triage column on the right. It replaces the 3D office as the home screen.
- R5. **The network shows what's happening.**
  - Each repository's `main` is a station on the left edge. Every chat is a line that leaves it and grows to the right through shared stage columns: Brainstorm, Plan, Work, Review, Ship, Merged.
  - Work has one stop per task once the chat has a plan, so how far a chat has come can be compared by eye.
  - Stages a chat skipped are drawn as a thin dashed line.
  - Side chats fork from the stop they branched from.
  - Merged chats fade and leave the map after a day.
- R6. Each line is collapsed by default: a pill with the number of finished stops, the current stop, and a thin grey line for what's left. Space or clicking a line expands it to every stop. From an expanded line, B starts a new chat from any stop (R25).
- R7. A line's tip carries its state:
  - an amber ring for needs you, and a red ring for blocked
  - otherwise a ring in the stage colour
  - at most a few words of status: "task 6 of 9", "fix ready", "waits for #214"

  A line that came in from a connector has that connector's square before its name.
- R8. **The triage column says where you're needed**, in this order:
  - **Start something new:** a one-line composer with a repository picker and a starting stage.
  - **Jump in:** questions and permission requests, answered on the row.
  - **Review:** work ready for your eyes, such as a fix, a plan, results or a PR.
  - **Your call:** defaults the agent chose that you can keep or change, and suggested work you can start or decline.
  - **Finished today:** folded to one line.

  Every item is one row: the chat's ring, its name, one line of what's needed, and the actions. Numbers 1–9 answer the top row's options.
- R9. A row's ring matches its line's tip. Hovering or selecting a row highlights its line on the map, and the reverse. Opening a row or a line (↵) opens the workspace for that chat.

**The workspace (one chat)**
- R10. A chat's header is merged into the title bar:
  - back and forward arrows between recent chats
  - the chat switcher (R17)
  - branch and state
  - a "N need you ⌃Tab" pill

  There's no sidebar and no status bar. Esc returns to the hub, unless something inside the chat wants Esc: a terminal, an open popup or a sheet.
- R11. **The line, squeezed, left of the reply.**
  - A narrow column shows the chat's whole line: finished stops as short ticks in their stage colours, the open stop as a tall bar in its stage colour next to its conversation, and the stops still to come as faint ticks, ending at `main`.
  - Expand line (⌘L) shows every stop with its one-line outcome.
- R12. **The open stop gets the page.**
  - Its heading and task number come first, then its conversation. Replies are shown in full, and suggested code has Copy and Apply.
  - Tool work collapses to one line per step, with connector steps labelled by source.
  - The live step and the next stop sit at the bottom, then the message box (`/` for skills, `@` for files).
  - Earlier stops are folded until you expand the line or scroll up.
- R13. **The right column shows what matters now:**
  - **Open:** open questions, defaults in use (Keep / Change), permission requests, and blockers, with "nothing blocked" when clear.
  - **Tasks:** the plan's tasks, crossed off as they finish. The current task's sub-steps are nested and crossed off too.
  - One quiet line each for tests and for changes (⌘D opens the diff).
  - **Connected to this line:** the PR, Sentry issue, Slack thread or mail this chat is working from, with its live state.
- R14. **The workbench (⌘J)** opens as a pane beside the conversation, holding tabs for:
  - the running app preview
  - the changes
  - the chat's terminals
  - its documents (brainstorm, plan)

  Each tab is marked with the stop it came from. It's closed by default and remembers per chat whether it was open and which tab.
- R15. Each chat keeps its workspace: whether the workbench is open, its tabs and sizes, the expanded state of the line, scroll position, and its terminals (count, names, folders, scrollback). Switching back restores it exactly. It survives restarts, stored with the chat in SQLite. Terminals reopen in their folder with their scrollback below a "restarted" divider.
- R16. **Notifications from other chats appear in the bottom right.**
  - The newest is shown in full and can be answered there (⌥Y / ⌥N for permission requests). Older ones shrink to one line above it.
  - Go there switches chats. Nothing takes focus by itself.

**Getting around**
- R17. Clicking the chat's name opens the switcher, a dropdown with:
  - a filter box
  - lines grouped as needs you, running and waiting, each row with its state in words and the chat's small line
  - side chats indented under their parent
  - New line (⌘N) and the hub (⌘0) at the bottom
- R18. Holding ⌃Tab shows the same list as a centred overlay, needs-you first and then most recent. Tab moves the selection and releasing ⌃ opens it. ⌘K searches chats, files and decisions from anywhere.

**The route**
- R19. The default route is compound engineering: Brainstorm → Plan → Work → Review → Ship → Compound. Each stage runs the user's installed skill for it (`ce:brainstorm`, `ce:plan`, `ce:work`, `ce:review`, `ce:compound`). Ship takes in today's ship-it steps as its stops. A missing skill falls back to a plain prompt.
- R20. A stage starts when its skill runs or when the user picks it. A chat that clearly does a stage's work moves to that stage: plan mode means Plan, the first edit means Work, and opening a PR means Ship. A chat can enter at any stage.
- R21. When a stage looks finished, the next stop offers "Continue to <stage>". The app never moves on by itself, except for lines started for you (R31), which follow their route up to the first thing that needs you.
- R22. Routes are config in `departments.json`: stations with a label, a skill or a prompt, and a colour from the line palette. A room can use its own route. The `commands` section that `departments.json` already has (`ship`, `fixCi`, `answerComments`, `review`) maps onto Ship's stops.

**Side chats**
- R23. A side chat branches from any stop with the conversation up to that point, and from then on runs separately. It's a full chat with its own route, tasks, workspace and PR. It works in the main folder while it only reads, and moves to its own worktree before its first edit.
- R24. A side chat draws as a branch of its parent's line on the network and in the switcher, and reconnects when you choose. Reconnect offers a summary, the code, or both: the default is both when it changed files and summary when it didn't. The summary is written by the side chat and editable before it's sent. Code merges into the parent's branch, and conflicts are listed with the option to hand them to the parent.
- R25. From an expanded line or an earlier stop in the conversation, the message box offers "Continue from <stop> in a new chat" alongside "Reply at the tip". The new chat starts in its own worktree from the files as they were at that stop.

**Connectors and suggested work**
- R26. The app reads the user's GitHub, Sentry, Gmail, Linear and Slack through their connectors, plus the user's Claude Code sessions on this Mac and follow-ups left by the office's own lines (for example review findings left for later). It scans about once an hour, and at once on events the app sees itself: a new GitHub notification, a Claude Code session ending, or a line leaving a follow-up. The connectors don't push to a local app.
- R27. Each new item is judged for importance (act now, today, this week, FYI or not for you), for whether an agent can do it, for which repository or line it belongs to, and for what kind of work it is. The judging runs through Jev (TypeSafe), and the user never sees it. Items about the same thing (the Sentry error, the Slack question and the PR about saved cards) merge into one.
- R28. For the few worth doing, Claude drafts a kickoff: the repository, the stage to start at, the skill, and a one-sentence prompt. Suggestions appear in the hub's Your call with a small source label, and expanding one shows its kickoff with Edit and Why?. Items that are important but not now wait on a list reachable from the hub. Nothing is dropped silently, and what was left out can be reviewed.
- R29. The user's rules are plain sentences, such as "Anything from the security team is act now". "Not now" and "Never for this kind" teach new ones. Rules are editable in Settings.
- R30. Anything that would act as the user outside the office waits in the chat's Open for Allow once, Edit or Don't post. That covers posting in Slack, sending mail, commenting on a PR, or moving a ticket.

**Lines that start by themselves**
- R31. Low-risk work starts without asking. Low risk means:
  - its own worktree
  - no push
  - no messages sent as the user
  - no deploys
  - stopping at every permission request

  A new Sentry issue that matches the user's rules starts an investigation-and-fix line this way.
- R32. Lines started for you carry a quiet "started for you" tag on the network and in the switcher, and can be stopped with one action. They reach the user only through Jump in, Review and notifications, like any other line.

**Companion agents**
- R33. Sessions the office watches but doesn't host (see the open-source release doc) get the same line, hub rows and notifications, built from their hooks and transcripts. Their workspace has no message box. Their next-stop and suggested-work buttons copy the command and bring the agent forward. Branching and side chats work for hosted chats only; a companion Claude Code session can be branched into a hosted chat.

## Success Criteria
- Aaron works from the hub and the workspace all day, with eight or more chats, and doesn't miss a question or permission request from a chat he isn't looking at.
- At a glance on the hub, you can say which chats need you, what's ready to review, and how far each chat has come.
- A chat can go from Brainstorm to Compound using only next-stop suggestions, without typing a skill name.
- A Sentry issue that matches the rules is being worked on in its own worktree before Aaron opens the app, and reaches him as a fix to review.
- Coming back to a chat, including after a restart, shows the same workspace with no visible reset.

## Scope Boundaries
- The 3D office and characters are parked. The hub replaces them as home. Characters may come back later in a way that doesn't cost space or clarity.
- No time estimates or predictions of when a chat will need you.
- No code editor. Files and diffs are shown and open in the user's editor.
- No reading of claude.ai conversations. Only Claude Code sessions on disk, until a supported way exists.
- Nothing is sent, pushed or deployed on the user's behalf without an explicit allow.
- Only one level of branches is drawn on a line. Deeper side chats show as a count.

## Key Decisions
- **One hub instead of an office, a network and a home.** The network explains what's happening and the triage column says what to do about it. Two separate views made you switch to connect the two.
- **The workspace is the chat's present.** The open stop gets the page, the past folds away, and the whole line stays visible as a squeezed column next to the reply. Earlier designs duplicated the line in a header, a sidebar and dividers.
- **Summoned navigation instead of a sidebar.** Vertical space is scarce, and a sidebar repeated the network. The switcher, ⌃Tab and ⌘K cost no permanent space.
- **Notifications bottom right, answerable in place.** You only switch when you choose to.
- **Hide the machinery.** Users care about what's happening, where they're needed and what to start, not about how items were sorted. Jev and scan counts stay out of the UI.
- **Low-risk work starts by itself; everything that acts as you waits.** This is what makes hourly scanning useful without making it dangerous.
- **Connectors are source labels, not lines.** Stage colours already use up the palette, and connector lines made the map unreadable.

## Dependencies / Assumptions
- The compound-engineering skills are installed. R19's fallbacks cover machines without them.
- Connectors are available as MCP servers or the app's existing integrations (GitHub through `gh`, Linear through its API key). Gmail, Slack and Sentry need credentials the user grants per source.
  - The office's `setup-token` sessions can't see claude.ai connectors (`docs/solutions/2026-09-sdk-dual-account-spike.md`). Reading Sentry, Gmail and Slack needs a Claude-login account or local MCP servers for those services. This is settled in the plan's Unit 11.
- Jev (TypeSafe `systemone`) can answer several structured questions per item within a few seconds, as it does for room picking today.
- Chat rows are capped at 200 in memory, and full history is rebuilt from session files, so the line and tasks must be built from full history.
- The open-source release (`docs/brainstorms/2026-09-27-open-source-release-requirements.md`) is planned in parallel. R33 assumes its adapters.

## Outstanding Questions

### Resolve Before Planning
- None.

### Deferred to Planning
- [Affects R11, R13][Technical] Where tasks come from: the plan document's units, the agent's todo list, or both, and how sub-steps are tracked.
- [Affects R20][Technical] The rules that move a chat between stages without its skill, and how to avoid flapping.
- [Affects R26, R27][Technical] How connectors are read on a schedule outside any chat, and where items and their judgements are stored.
- [Affects R31][Technical] How "low risk" is enforced, not just promised: which permission modes, tool rules and hooks guarantee no push, no send and no deploy.
- [Affects R25][Needs research] Whether the Agent SDK can fork a session at an earlier message, or whether the office trims the transcript itself.
- [Affects R14][Technical] How the app preview finds the chat's dev server.
- [Sequencing] How this lands next to the open-source release, and whether the 3D office stays reachable during the transition.

## Next Steps
→ Implementation plan: `docs/plans/2026-09-27-001-feat-hub-and-workspace-plan.md`.
