---
date: 2026-09-23
topic: agent-office
---

# Agent Office

## Problem Frame

Aaron runs many Claude Code chats at once across two accounts on one MacBook. Each account is a separate instance of the Claude desktop app (the default one and `Claude-Research`). Nothing shows, across both, which chats are working, which are blocked on him, and which have finished and are waiting to be read. Blocked chats waste the parallelism he is paying for.

Agent Office replaces the desktop client for his daily work. Every chat is a small character at a desk in a cute, colourful but professional 3D office, grouped into departments by the code it works on. It has to be at least as useful as Claude Code: he starts, steers, reviews and approves work from the office, not from the desktop app.

Chosen layout: the **Open floor**, plus the door queue from the **Corner office** prototype (picked from three prototypes; the chosen one is `prototypes/combined.html`, and the others are in git history).

## Requirements

**The office**
- R1. A 3D office in the style of Aaron's reference image (`docs/reference.png`): colourful glossy blob characters with big eyes, white walls, wooden desks, plants, soft daylight. Cute, but professional and legible. Characters are matte (no glossy or refractive materials), and the office must feel fast.
- R2. One character per chat, with a colour that stays stable for the life of the chat and a name tag showing the chat title.
- R3. Departments reflect where the work happens:
  - A Monorepo wing:
    - **Marketplace** (`frontend/marketplace`)
    - a small **Admin** section (`frontend/admin`)
    - **Mobile** (`frontend/mobile`)
    - **Backend / infra**: services, API, workers and infra, plus anything else in the monorepo
  - A **Research gym** holding every chat on the research account.
  - A **PR reviews** section for the agents started from the review queue (R28).
  - **Side projects**, for the main account's other folders, sits outside the building as a playground on a lawn by the entrance.

  A section only appears while it has active agents: working, needs you, stuck, or done and unread. Resting and parked chats sit in the Lounge (R5) and don't count. Empty sections fold away. Inside the building the rest keep a fixed order: Marketplace, Admin, Mobile, Backend / infra, PR reviews, Research gym. Starting an agent in a hidden department brings its section back. ⌘N, the job board and the review queue can still target hidden departments.

  Sections and the building are only as big as they need to be:
  - A section holds a desk for each active agent plus one free desk, so there's always a desk to start from. The desks form a compact grid that grows in steps (two side by side, then 2×2, 3×2, 3×3, then wider) and shrinks as agents leave. A growing section never moves an existing desk. The gym gets treadmills only for agents that run (working, or queued at the door and coming back); a done gym agent waits by the water cooler instead.
  - Props follow a size tier: a section with one or two agents keeps its signature piece (the Marketplace's auction screen and framed shirts, for example), and bigger tiers add the rest. Props never cover desks or walkways.
  - The visible sections pack into rows in that order, back to front and left to right. The row breaks are chosen to keep the footprint small and the overview close to the 16:10 canvas left of the drawer. A row narrower than the building stretches its sections to close the gap, so no empty floor is bigger than a walkway.
  - The floor, walls, windows and shadows hug the packed sections plus the fixed parts: his glass office with the door queue, the entrance with its cloakroom, and the Lounge while anyone rests there. The Lounge sits beside his office or at the end of a row, wherever it packs tighter. The overview camera refits when the building changes, and frames the playground too.
  - Resizes and moves animate instead of jumping, and agents walk to their new desks. Re-layout waits while he's hovering or zoomed into a section, and applies when he returns to the overview. The one exception is a newcomer who needs a desk: that desk appears at once, and the next free desk waits.

  The Side projects playground follows the same rules outdoors. Its desks are picnic tables with laptops, one per active agent plus a free one with a "+", each with its project's nameplate. Tier props are trees, bushes, string lights, then a swing, then a slide and a sandbox. It has a sign with live counts and folds away when empty. It goes in front of the entrance or beside the left wall, whichever frames the building and the playground more tightly. The ground out there is lawn, not floor tiles, and the playground doesn't count toward the building's footprint.

  Each department is a clearly bounded section:
  - its own subtle floor tint
  - low partitions with an opening onto the main aisle
  - a sign readable from the overview, with its name, folder and live counts (needs-you in amber)

  On the playground and in the gym, each table or treadmill carries its project's name.

  Sections look like the projects they hold. For MWS (mws.com, match-worn football shirts):
  - Marketplace: a shirt showroom with framed shirts, a hanger rail, an auction podium and pitch turf.
  - Admin: a compact back office with filing cabinets and a small ops dashboard.
  - Mobile: a device-testing wall.
  - Backend / infra: server racks and monitoring screens.
  - Side projects: a playground on a lawn, with picnic tables.
  - PR reviews: a quiet reading room with lamps, armchairs and a review board.
  - The gym keeps its gym look.
  No real club crests or MWS logos.
- R4. Placement follows the files live. A main-account chat sits in the department whose files it has recently read and edited. It walks to another department only when its work clearly and consistently shifts; one stray file read must not move it. A chat working across departments sits where it has edited the most, and a tie keeps it where it is. Subagent activity counts toward the parent.
- R5. Each state reads at a glance, and "needs you" is always the loudest:

  | State | At a desk | In the Research gym |
  |---|---|---|
  | Working | Typing at the desk | Running on a treadmill |
  | Needs you | Gets up, walks to your office door, waits in the queue with a "!" | Same: gym agents queue at your door too |
  | Done, unread | Leans back with a done mark until you read the reply | Stands by the water cooler with a done mark |
  | Idle, or done and read | Walks to the Lounge and sits back in an armchair, a mug on the armrest | Same: the Lounge |
  | Parked (quiet for a day) | Dozes in the Lounge, eyes closed and dimmed | Same |
  | Stuck (crashed, logged out, rate-limited) | Walks to your door and queues with a warning bubble instead of "!" | Same |

  The Lounge is where finished work rests:
  - A done chat stays at its desk as a result waiting for him. Once he has read it (opened it and then left it by closing it, opening another chat or going back to the overview), its agent walks to the Lounge and its desk frees up, so the section shrinks. An idle chat goes straight there.
  - An agent never walks away while its chat is open. A message to a resting chat walks it back to a desk in its department, and it goes to Working.
  - Visitor chats (R18) follow the same rules from their observed state: a visitor that starts working again walks back to a desk.
  - The Lounge is compact and sized to its occupants, one armchair each, never overlapping. It hides when nobody rests there.
  - Clicking a resting agent opens its chat. The drawer's board ends with a Standby group, collapsed by default, that lists each resting chat with its department and "done 2h ago". ⌘K finds resting chats too.
  - The unread flag survives a relaunch, for visitor chats as well.

  Two cues make every agent scannable from the overview:
  - A floor status ring in the state colour: amber for needs you, blue for working, green for done, grey for idle, red for stuck. The ring stays visible even when name tags collapse.
  - A one-line "doing now" caption on its name tag, such as "Editing BidFlow.vue", "Running pnpm test" or "Waiting for you · Bash".

  Hovering a department highlights it. Clicking a count in the tally highlights those agents.

  The overview stays uncluttered. It shows compact department signs, every agent's status ring, and tags only for agents that need you or are stuck. Other tags appear on hover or when zoomed into a department.

- R6. Subagents appear as mini versions of their parent next to it, labelled with their task. They leave when they finish.
- R7. Your office, glass-walled, sits at the front of the floor, nearest the default camera. Chats that need you (including stuck ones) queue at your door in arrival order. The order is visual only: you can open any waiting agent. When you release one (allow, deny, reply or restart), it walks back to its desk and the rest move up.
- R8. The overview shows the whole floor. Clicking an agent glides the camera in and opens its chat, and "Overview" returns. Starting an agent never moves the camera: the new agent walks in from the entrance to its desk while the view stays put. ⌘K jumps to any agent by name. Departments add desks as they fill up; there is no fixed seat count.
- R9. An in-world wall screen (the "Project status" board from the reference) and a top-bar tally show the counts per state. The tally serves you inside the app; the menu bar strip (R19) serves you outside it.

**Chat and control (Claude Code parity on day one)**

*Starting and running*
- R10. Start a new agent from an empty desk or a command:
  - Choose the folder, or ask for a fresh worktree.
  - Write the first prompt.
  - Pick model and effort. Every chat the office starts (the form, ⌘N, a desk's "+", Review, Start from ticket) runs on Opus 5.5 (`claude-opus-5-5`) at medium effort unless he picks otherwise. A pick applies to that agent only; the form doesn't remember it.
  - Every agent runs in Claude Code's Auto mode by default, so only what Auto mode escalates reaches the queue. Plan mode stays available per chat.
  - While it starts, the desk shows progress ("setting up worktree…"). A failure shows on the desk and in the chat, with Retry.
- R11. A full conversation view:
  - Streaming replies, tool calls with their results, and subagent activity.
  - Send messages and stop the agent.
  - Change model and effort mid-chat with a visible effort control (low to max); the change applies from the next turn, as in Claude Code, and stays with that chat. A chat saved without a model runs on Opus 5.5, never on the CLI's default.

*Permissions*
- R12. Handle permission requests with Allow once, Always allow or Deny, from any of:
  - the chat
  - the inbox
  - the queue
  - the keyboard (1, 2, 3)
  - native notification actions, if the platform allows it

  The keys act on the open chat, or on the first agent in the queue when no chat is open. Always allow works as in Claude Code: it saves a rule for that tool and command pattern in that project. Each department has a permissions view to see and revoke saved rules.

*Review*
- R13. Review each chat's work:
  - its diff, file by file
  - its branch and PR link
  - CI status
  - one click to open a file in your editor
  - clear empty states when there is nothing yet (no changes, branch not pushed, CI not run)

*Input*
- R14. Rich input:
  - Attach images and files.
  - Run slash commands and skills.
  - Plan mode, where you approve or reject the plan before any edits.

*History and inbox*
- R15. History:
  - Resume old chats; the agent returns to a desk.
  - Search across transcripts.
  - Rename and archive chats.
  - See token usage per chat and per account.
- R16. An inbox that lists "Waiting for you" in queue order, with quick actions, j/k to step through, and Esc to go back. Below it, every other agent appears as a scannable board grouped by department: one row each with state, title, doing now, and time in that state.

**Accounts and chats started elsewhere**
- R17. Runs sessions for both accounts side by side. The research account's own work lives in the gym, and it's also overflow capacity: when main is limited, monorepo chats can run on it too, keeping their department and showing a small account badge. The office shows headroom per account (5-hour and weekly windows), suggests the account with more room when starting an agent, and offers to move a rate-limited chat to the other account. The account shows through location (the Research gym is the research account) and in the chat header, with no extra colour coding, so the per-chat colours in R2 stay unique. Each account's login is stored in the macOS Keychain, separately per account.
- R18. Chats started outside the office (the desktop app, `claude` in a terminal) appear read-only with live status. A "Move into the office" action resumes that chat inside the office so you can chat and approve there.

**Housekeeping**
- R21. Parking: a chat with no message for 1 day dozes in the Lounge (R5), dimmed and without a tag at the overview, even if its reply is still unread. It walks back to a desk when a message arrives. Parking also stops the chat's long-running child processes (dev servers, test watchers, docker compose) to free RAM; they restart on demand. Thresholds are editable.
- R22. Resources: the office shows RAM per agent (its session plus the processes it started, such as dev servers and test runners), the number of worktrees and their disk size, and each worktree's git state. A top-bar indicator turns amber when RAM is high.
- R23. Cleanup: chats with no message for 3 days are suggested for cleanup. The possible actions are stop processes, archive the chat, and remove the worktree. Removing a worktree is blocked, with the reason shown, when it has uncommitted or unpushed changes. One "Clean up safe" action previews, then handles, all the safe candidates, and reports what was freed.

**Workflow**
- R24. Linear on the desks: each agent shows its Linear ticket (from the branch or worktree name, e.g. AUC-1302) and the ticket's status. An agent can be started from a ticket, with the worktree and branch named after it and the ticket as context. When a chat is done, the office can move its ticket to review, after confirming.
  - A ticket alone is enough instructions. A prompt that is only a ticket id (any case) or a Linear issue link, or starts with one, starts an agent without a description.
  - With a Linear key, the office reads the ticket's title, status, description and link and puts them at the top of the first prompt, followed by anything else he typed. Office sessions run on setup tokens without the claude.ai Linear connector, so the agent can't read the ticket itself. The chat is titled "AUC-1302 <title>", and a fresh worktree's branch is named after the ticket.
  - Without a key, or when Linear doesn't answer, the prompt goes as typed, and the form says quietly that the agent won't see the ticket body.
  - Reading a ticket never changes it in Linear.
- R25. Ship-it actions: agents offer the next step for their state, using Aaron's own skills:
  - Changes but no PR yet: write test cases (`/mws-test-cases`), verify (`/mws-verify`), review (`/mws-review`), then commit and open a PR (`/mws-pr`).
  - PR open with unresolved comments: answer them (`/pr-comment-rundown`).
  - CI failing: fix CI (`gh-fix-ci`).
  - PR merged: clean up the worktree (R23) and move the Linear ticket.
- R26. Job board: saved agent presets (skill, prompt template, model, effort, department, account) that can be dropped on a desk. Seeded with his recurring jobs:
  - weekly frontend Sentry prep (`frontend-sentry-meeting-prep`)
  - WBSO (`mws-wbso`)
  - review someone's PR (`pr-review-rundown`)
  - unit tests per area
  - backend warnings burn-down (`mws-backend-warnings`)
  - characterize before a refactor (`mws-characterize`)
- R28. Review queue: open PRs where Aaron's review is requested (via `gh`) form a second queue, next to "Waiting for you":
  - In the office: an in-tray on his desk holds them, with the count visible at the overview and older requests in amber.
  - In the drawer: a "Review requests" section lists repo, title, author, age, size and CI status.
  - One click starts an agent that runs `/pr-review-rundown <PR URL>`. It needs no worktree, because the skill reads the PR from the outside through `gh`: the agent runs in the repo's local clone (matched by its `origin`), or in the home folder when no clone is known.
  - Review agents sit in the PR reviews section, not the PR's department. The office knows an agent is a review from how it was started, not by guessing from the prompt.
  - A request leaves the queue once his review is submitted or the request is withdrawn.
  - His own PRs with new review comments surface the `/pr-comment-rundown` action (R25).
- R27. Morning briefing: the first time he opens the office after a break (6 hours or more, or the first open of the day), one card summarizes what finished, what's waiting, PRs ready, CI failures, and what was parked or cleaned up.

**App shell**
- R19. A native Mac app with three parts:
  - The office window.
  - A menu bar strip showing state dots and the needs-you count. Clicking it opens the office on the inbox.
  - Push notifications that say who needs help with what (the agent, its department, and the request), with Allow, Deny and Open. They go to the Mac and to his phone. On both, the notification carries the choice itself: Allow once and Deny act on that exact request. On the phone, risky requests offer only Deny, with a note to allow from the Mac.
- R20. Sessions keep running with the window closed, the menu bar stays live, and the app can start at login.

## Success Criteria
- Within two weeks, Aaron no longer opens the Claude desktop app for daily work.
- "Who needs me?" is answerable in under two seconds, from the menu bar or the office.
- From the overview, without zooming, he can tell every department's name and counts, and every agent's state.
- Stale worktrees and their processes stop piling up: one weekly "Clean up safe" leaves no safe candidate older than 3 days.
- A notification appears within a second of a permission request.
- With 15 agents running (his busy-day peak is about 10), it stays smooth on his MacBook and every label stays legible.
- The time a chat waits on him before he acts drops compared with today. The app measures this, since it sees when a chat blocks and when he responds.

## Scope Boundaries
- Single user on one Mac; no team sharing or multi-machine sync.
- macOS only.
- No code editing inside the office; files open in his editor.
- Does not replace `claude` in the terminal for scripting or CI.
- Cloud sessions (claude.ai/code) are out of scope for v1.
- New Claude Code features don't need custom 3D art: unknown tools and events appear as plain rows in the chat until they earn a visual.

## Key Decisions
- **Replace, not monitor.** Replacing the desktop client is Aaron's explicit goal (2026-09-23). A status-only tool over the existing hooks was the starting idea; it survives as the menu bar strip (R19), not as the product.
- **The 3D office is the product, not decoration.** Aaron asked for a visual, fun interface in the style of his reference. The inbox (R16) and menu bar (R19) give the fast, flat path for triage alongside it.
- **The office runs the sessions itself.** Replacing the desktop client requires chatting and approving. The desktop app offers no way to send input to its chats from outside, so jump-and-approve alone can't meet R11 to R14.
- **Open floor plus the Corner office queue.** Aaron picked this from three prototypes (Open floor, Tower, Corner office). It combines the whole-floor overview with a physical place, your office door, where "needs you" goes.
- **The research account is the gym**, not a folder-based department.
- **Feasibility first, not a blocker for planning.** The plan's first step is a go/no-go test: two headless sessions at once, one per account, plus safely moving a chat started elsewhere into the office. The desktop app already starts `claude` with a separate login per account, which is strong evidence this works. If it fails, fall back to jump-and-approve with status from hooks.
- **All four parity bundles stay day-one, built in order.** Sessions, state and the queue with approvals come first, then the conversation view, review, rich input, and history. Each step is usable on its own, so progress toward the two-week goal is visible early.
- **Placement follows files live** (Aaron's choice over desk-you-picked and manual rules), with guarding against jitter (R4).
- **Chats started elsewhere are shown and can be adopted**, which makes the switch from the desktop app gradual.

## Dependencies / Assumptions
- Verified on 2026-09-23:
  - Both desktop app instances launch `claude` processes that share `~/.claude`, so one set of hooks sees every session from both accounts.
  - The desktop app keeps a JSON file per chat with its title, CLI session id, last activity and archived flag.
  - That format is undocumented and may change.
- Unverified, tested in plan step 1: the office can hold its own login for each account and run headless sessions on both at the same time. Evidence for: each desktop app instance already starts `claude` processes with its own account's login.
- Unverified, tested in plan step 1: resuming a chat started elsewhere is safe while the original client still has it open.

## Outstanding Questions

### Resolve Before Planning
- None.

### Deferred to Planning
- [Affects R10–R15][Technical] Run sessions through the Claude Agent SDK, or drive the `claude` CLI's stream-json mode directly (as the desktop app does)? Check how much of slash commands, skills, plan mode and permission modes each path exposes, and confirm that sessions the office starts still fire the shared `~/.claude` hooks (or name the equivalent event source) that R5 and R9 rely on.
- [Affects R17][Needs research] How does the app log in to each account, refresh tokens, and respect each plan's rate limits?
- [Affects R18][Needs research] How does "Move into the office" avoid two clients writing to one chat? It needs to stop or detach the original first, and to handle worktrees. Also define what you see (a confirmation that the original client will be detached) and what happens if the resume fails after detaching.
- [Affects R4][Technical] Rules for turning file paths into departments, and the jitter guard (window size, how dominant a shift must be).
- [Affects R19][Technical] App shell: SwiftUI hosting a web view, Tauri, or Electron? Check WebGL performance, how the menu bar strip is built, and how notification actions work.
- [Affects R13][Technical] Where do git, PR and CI data come from for each worktree (for example `gh`)? How often is it refreshed? Prefer reusing your existing `gh` login over storing a new credential, and fetch CI logs on demand rather than caching them.
- [Affects R8][Technical] How does the office lay itself out when departments outgrow the floor?

## Next Steps
-> /ce:plan for structured implementation planning.
