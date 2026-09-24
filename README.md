# Agent Office

A personal macOS app that hosts Claude Code chats for two accounts and shows each chat as a character in a 3D office. The plan lives in `docs/plans/2026-09-23-001-feat-agent-office-app-plan.md`.

Stack: Electron built with electron-vite, Vue 3, TresJS, TypeScript in strict mode. Vitest for unit tests, Playwright for end-to-end tests against the built app.

## Setup

Needs Node 22.12+ and pnpm 10.

```sh
pnpm install
pnpm dev
```

The Electron binary downloads on first launch.

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev` | Runs the app against the Vite dev server with hot reload |
| `pnpm build` | Builds main, preload and renderer into `out/` |
| `pnpm typecheck` | Type-checks the main side and the Vue renderer |
| `pnpm test` | Runs the Vitest unit tests in `tests/main` and `tests/renderer` |
| `pnpm test:e2e` | Builds, then launches the app with Playwright and runs `tests/e2e` |

To run the built app without the dev server: `pnpm build && pnpm exec electron .`

## Processes

Agent Office runs as two processes of the same app:
- **The agent host** runs every chat. It owns the Agent SDK sessions and their `claude` subprocesses, `office.db`, permission requests and rules, phone push, the outside-chats listener, housekeeping and the review queue. It has no window and no Dock icon. It shows up in Activity Monitor as a second Agent Office process, started with `--agent-host`.
- **The window app** is the office you see: the window, the menu bar strip, the menus and macOS notifications. It talks to the host over a socket in the data folder, which only your user can open and which needs a per-install secret.

The window app starts the host when it isn't running, including after Open at Login, and in `pnpm dev`. Quitting, restarting, updating or crashing the window app leaves the host and its agents running. When the window app comes back, it picks up the office where it was. While it can't reach the host, the office stays on screen with "Reconnecting to agent host…" at the top.

When the host's own code changes (an update, or a main-side change in `pnpm dev`), the window app shows "Agent host update ready". It restarts the host at the first moment no office chat is Starting, Working or Needs you. Restart now does it at once. Renderer-only changes never restart the host.

### Stopping the host

- Settings → Stop agent host, or right-click the menu bar icon → Quit… → Quit and Stop All Agents. Both ask first if an agent is mid-turn, then stop the host and quit the window app.
- From a terminal: `kill "$(cat ~/Library/Application\ Support/Agent\ Office/host.pid)"`. The host shuts down the same way.

An idle host keeps running, since it costs almost nothing. Stopping it marks chats that were mid-turn Stuck (interrupted), exactly like quitting did before the split.

## Running in the background

Closing the window hides it, and the app keeps running in the menu bar. Launching the app again focuses the running one. ⌘Q quits the window app only; agents keep working.

The menu bar icon is a live strip. The ring fills and a number appears next to it while anyone waits at your door (requests, stuck chats and accounts that need login, the same count as the inbox). Small dots to its right show agents at work: a solid dot per working agent and a hollow one per unread reply, up to eight. Clicking it opens the window on the inbox. Right-click it for Show Agent Office, Open at Login and Quit…, which asks whether to quit the window app only or stop all agents too. Open at Login starts off.

## Where data lives

The app keeps its data in `~/Library/Application Support/Agent Office`:
- `accounts.json` lists accounts (id, label, created at).
- `secrets/` holds each account token, the optional Linear key and the ntfy signing key, each as its own file, encrypted with Electron `safeStorage` under a key held in the macOS Keychain.
- `host.sock`, `host.secret` (mode 0600), `host.pid` and `host.log` belong to the agent host, and `host/` holds its Chromium profile.
- `office.db` is the metadata database (SQLite in WAL mode): chats (session id, account, folder, title, colour, state, read state, usage, wait timestamps), Always allow rules per account and repository, wait metrics, composer drafts encrypted with `safeStorage`, each account's last health, and settings (phone push, whether you've seen the Alerts hint). It never holds message text.

Claude Code transcripts stay where Claude Code writes them, in `~/.claude/projects`. The office reads them to replay a chat's history and to show outside chats, and doesn't touch `~/.claude` otherwise, apart from the optional hook entry described under Outside chats.

`better-sqlite3` 13 ships N-API prebuilt binaries, so the same binary loads in Node (Vitest) and in Electron. There is no native rebuild step, and `package.json` lists it under `ignoredBuiltDependencies` so pnpm skips its node-gyp script.

Set `AGENT_OFFICE_USER_DATA` to use a different folder, and with it a separate host. The end-to-end tests use a temporary one, so they can run while your own copy is open. Use one when you try a worktree build too: two builds on the same folder share one host, and the second to connect sees a different build hash and restarts the host with its own code once it's idle. macOS caps socket paths at 104 bytes, so keep the folder's path short.

## Accounts

On first run the office stays hidden until one account validates. Run `claude setup-token` once per account (tokens last one year), paste the token and give it a label. Validation sends a Haiku request with `max_tokens: 0` straight to the API and reads the 5-hour and weekly usage from its rate limit headers, which costs about 8 input tokens. If that request fails for any reason other than a 401, it falls back to a one-turn Agent SDK query with no tools and no settings. The host re-checks every account every 10 minutes, and the bottom of the inbox shows each account's 5-hour and weekly usage. Settings → Accounts adds the second account, shows usage, and takes a new token for an account that needs login: adding a token under an existing label replaces that account's token.

Account health (status and usage) is saved in `office.db`, so it survives a restart. A rate limit during validation counts as a valid token that is out of headroom, not a failed login. Each running chat's rate limit events keep the usage figures current. Removing an account stops its chats and marks them Stuck (needs login).

## Chats

Each chat runs as one streaming Agent SDK session in the agent host, with its account's token, its folder as the working directory, and Auto mode. The host owns the chat state. The renderer asks for a snapshot on mount and whenever the window shows, then applies per-chat patches, flushed at most once per 16ms. While the window is hidden, only state changes are pushed.

A chat moves through Starting, Working, Needs you, Done, Idle and Stuck. Stuck carries a reason: needs login, rate limited (with the retry time when Claude sends one), crashed, interrupted or error. An exception in one chat only marks that chat Stuck.

Stopping the host while a chat is mid-turn asks first, then interrupts its turn. After the host restarts, or crashes, chats that were mid-turn come back as Stuck (interrupted) and never resume by themselves. Resume continues the same session, which the office only does for sessions it started. A restored chat's earlier turns are replayed from its transcript.

## Outside chats

Chats running in the desktop app (both instances) or `claude` in a terminal show up as visitors: read-only, with a Visitor badge. At startup, and whenever a transcript or a desktop chat file changes, the office lists the chats active in the last 24 hours:
- Desktop chats come from each instance's `~/Library/Application Support/<instance>/claude-code-sessions/**/local_*.json`, which gives the title, archived state and account (the `Claude-Research` instance maps to the research account). Archived chats are left out.
- Terminal chats are transcripts whose entrypoint is `cli`. Their account shows as unknown, and their title is the first prompt.
- Transcripts from Agent SDK sessions, including the office's own, are left out.

A first state comes from the transcript: written in the last 5 minutes and mid-turn means Working; a finished turn means Done if the desktop app hasn't focused the chat since, otherwise Idle. Placement uses the same path rules and file classifier as office chats, and research chats sit in the gym.

Settings → Outside chats installs the hook bridge after a consent dialog. It backs up `~/.claude/settings.json` to `settings.json.agent-office-<time>.bak`, then adds one hook entry, marked by its `agent-office-hook` command, for SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Notification, Stop, SubagentStop and SessionEnd. Every write re-reads the file and replaces it through a temporary file, so edits Claude Code makes in between survive. Turning it off removes exactly that entry. The hook script lives in `~/.config/agent-office/agent-office-hook` and posts each event with `curl` to `127.0.0.1`, reading the port and a per-install secret from `~/.config/agent-office/hook.curlrc` (mode 0600). With the office closed it exits at once. Hook events then drive the visitors' states live: a permission prompt shows the chat as Needs you.

Move into the office asks first, then creates an office chat that forks the original on your next message (`resume` with `forkSession`). The office never writes to the original's transcript, and the visitor stays behind, marked Moved.

## Permissions

Sessions run in Auto mode, so Claude only asks when Auto mode escalates. Each ask becomes a pending request on its chat, and the chat moves to Needs you. A chat can hold several requests, oldest first, and the snapshot carries them with the time of the oldest. Every surface answers through one `resolveRequest`: the first answer wins, and later ones get "already answered (source)". A request whose session died answers "session ended" and the chat shows Stuck.

- **Dangerous requests** need a click in the app. Keys, notifications and the phone can only deny them. The office flags `rm -rf`, `sudo`, downloads piped into a shell, `git push --force`, `git reset --hard`, credential and config paths (`.env*`, `~/.ssh`, `~/.aws`, the keychain and similar), anything outside the chat's folder, and whatever Claude Code marks `defaultToNo`. Keyboard answers only count while the window is focused.
- **Always allow** saves Claude's literal suggested rule, such as `Bash(pnpm test)`, for the account and the repository. Worktrees share their repository's rules, found through git's common directory. Rules reach sessions through the SDK's flag settings layer: at start, and live when a rule is added or revoked. WebFetch and WebSearch never get Always allow and always ask, since fetched content is the easiest way to steer an agent. Dangerous requests and asks where Claude Code suppresses the rule don't offer it either. Office rules don't apply to the terminal or the desktop app.
- **Plans and questions** use the same path. Approving a plan switches the session back to Auto mode. Answers to a question go back to Claude as the tool's input.
- **Wait metrics** in `office.db` record how long each request waited and how long a Done reply waited to be read.
- **Needs login:** while an account needs a new token, the office refuses new turns on it, and the snapshot lists one login item per account.

## Inbox and keys

The drawer opens on the inbox. "Waiting for you" lists every request in door-queue order, with the full command and quick Allow and Deny. Dangerous requests show Open instead of Allow, plus the reason. Stuck chats offer Resume, and an account that needs login shows up once, with a button to Accounts. Click an item's title to see the chat's last reply and a reply box. On a waiting request the reply denies it and passes your text to Claude as the reason; anywhere else it sends a message. Below the queue, the board lists everyone else by department, in floor order, with state, title, what each agent is doing and how long it has been in that state.

Clicking an agent in the office, a chip, or a board row opens that chat in the drawer, with its request cards oldest first. Keys only act on a card you can see:

- `1` Allow once, `2` Always allow (when offered), `3` Deny, on the open chat's oldest card.
- With no chat open, `1` opens the first queued card. Press it again to decide.
- `j` and `k` step through the queue and stop at either end. Esc goes back to the inbox.
- Dangerous requests ignore all three keys. Only a click in the app allows them.

## Quick start

⌘N (File → New Agent…) or the New agent button opens a form in the drawer: a recent folder or one from the folder picker, the account with its 5-hour and weekly usage, the prompt, the model and the effort. Every new agent starts on Opus 5.5 at medium effort unless you change it, for that agent only. A Linear ticket id or link on its own is enough of a prompt. It warns when the chosen account is past 80% of its 5-hour window and the other one has room. Sessions always start in Auto mode. Worktrees come with the full new-agent flow in Unit 9.

Each chat gets a colour from a 22-colour palette when it starts, never one already used in its department. The colour lives in `office.db`, so a reload never reshuffles it.

## Notifications

Every new permission request raises a macOS notification within the same event loop tick. It names the agent and its department, and says what Auto mode wants, as a short summary ("Auto mode wants to run: pnpm test …"). Its actions are Allow once, Deny and Open, plus an inline reply that denies with your text. Dangerous requests get Deny and Open only. Stuck chats and finished chats notify too; a reply to a finished chat is sent to it. An account that needs login raises one notification, whatever number of chats it stops. When a request is answered anywhere else, the office withdraws its notification, and a late tap on it does nothing.

On first run the inbox asks you to switch Agent Office to the Alerts style in System Settings → Notifications, so Allow and Deny stay on screen. Signed builds already ask macOS for Alerts through `NSUserNotificationAlertStyle`.

macOS only delivers notifications from signed apps. In `pnpm dev` and the unsigned build, the office still creates every notification and wires its actions (the tests check them), but macOS drops them with `UNErrorDomain error 1`. See Packaging and signing.

## Phone push

Every notification also goes to a private [ntfy](https://ntfy.sh) topic, so the phone buzzes when you're away. The office reads three files in `~/.config/agent-office/`:

| File | What it holds |
|---|---|
| `ntfy-topic` | The topic your phone subscribes to |
| `ntfy-reply-topic` | A second topic where the phone posts decisions |
| `ntfy-hmac-key` | The key that signs decisions, in hex |

On first run the office copies the key into `safeStorage` (`secrets/ntfy-hmac.bin`) and uses that copy afterwards. Phone push is on whenever the topic files exist. Settings → Phone push turns it off.

Needs-you and stuck messages go out at high priority, finished chats at default. Payloads carry the agent, department, tool and a short summary. They never carry the full command or file contents; secrets and anything after the second word of a command are cut.

Permission messages carry ntfy `http` buttons, Allow once and Deny, that post `{r, d, e, s}` to the reply topic: the request id, the decision, an expiry 30 minutes out, and an HMAC-SHA256 over `r.d.e`. The office listens to the reply topic over ntfy's JSON stream, starting from the time it launched, and reconnects with backoff. It checks the signature with `timingSafeEqual` and the expiry, then answers through `resolveRequest` as the phone. It logs and ignores anything unsigned, expired, replayed or already answered. Dangerous requests only get Deny on the phone, and the message says to allow them from your Mac. No port opens on the Mac.

## Test flags

- `AGENT_OFFICE_FAKE_VALIDATOR=1` swaps in a fake validator that accepts tokens containing `fake-ok`. Packaged builds ignore it.
- `AGENT_OFFICE_FAKE_ENGINE=1` swaps the Agent SDK for the scripted engine in `tests/fakes/fake-engine.ts`, which answers every message without spending tokens. A message containing `[hang]` keeps its chat working, one containing `[ask]` asks to run `pnpm test` first, and one containing `[danger]` asks to run `rm -rf dist`. Packaged builds ignore it.
- `AGENT_OFFICE_INLINE_HOST=1` runs the host inside the window app's process, the way the app worked before the split, so a test can reach `store`, `notifier` and `dialog` in one process. `playwright.config.ts` sets it, and `tests/e2e/host.spec.ts` clears it to test the real host. Packaged builds ignore it.
- `AGENT_OFFICE_FAKE_GH=1` answers the review queue's `gh` calls from `tests/fakes/github.ts` instead of GitHub. `playwright.config.ts` sets it, so no end-to-end test reaches GitHub. Packaged builds ignore it.
- `AGENT_OFFICE_HIDDEN=1` keeps the window off screen. It still renders at 1440×900 with WebGL, timers and animation running, but it never shows, never takes focus and never posts a macOS notification banner. An uncaught error in main goes to stderr instead of the error dialog. `show()`, `hide()` and `isVisible()` track a visibility flag instead of the real window. `playwright.config.ts` sets it, so the end-to-end suite runs without a window appearing. A test that depends on focus pins `isFocused` in main, as `approve-from-inbox.spec.ts` does. Packaged builds ignore it.
- `AGENT_OFFICE_CONFIG_DIR` replaces `~/.config/agent-office` as the place the office reads the ntfy files from and writes the hook script and endpoint to. `playwright.config.ts` points it at an empty folder, so the end-to-end tests never post to your real topic.
- `CLAUDE_CONFIG_DIR` and `AGENT_OFFICE_DESKTOP_DIR` replace `~/.claude` and `~/Library/Application Support` for outside chats and the hook installer. `playwright.config.ts` points both at empty folders, so the end-to-end tests never read your chats or touch your settings.
- `RENDERER_VITE_OFFICE_DEMO=1 pnpm dev` runs the office on the prototype's sample chats instead of your accounts: working, waiting, stuck and parked agents, with Admin folded until its first agent walks in after 10 seconds. The flag is read at build time, so a normal `pnpm build` leaves the demo out. The Playwright demo check builds its own copy into `out-demo/` and reads the fps probe on `window.__fps`, which only dev and demo builds expose.
- `tests/e2e/real-floor.spec.ts` launches the office once per floor in `tests/fixtures/floors.ts`: an anonymised capture of a real floor (`real-floor.json`), then 1, 3 and 25 agents, then sections at every size tier. It seeds office chats into `office.db` and visitors through the outside-chat store. It fails on any `[renderer]` line, console error or page error. It also fails when a section with a desk agent has no sign, when the sign counts don't add up to the chats that belong on the floor, or when the canvas is a flat colour. `AGENT_OFFICE_CAPTURE_FLOOR=1 pnpm test tests/main/capture-real-floor.test.ts` refreshes `real-floor.json` from your own chats. It runs the app's discovery code on a copy of `office.db`, then keeps states, departments, accounts, visitor flags, worktrees and ages. Titles, paths and ids become placeholders of the same length, and the department part of each path stays. It's skipped otherwise.
- `AGENT_OFFICE_REAL_TOKENS=1 pnpm test tests/main/real-tokens.test.ts --silent=false --reporter=verbose` uses the `MAIN_TOKEN` and `RESEARCH_TOKEN` in `~/.config/agent-office/spike.env` for real. It validates both accounts, then runs a one-turn Haiku chat on each through the session engine. It prints labels, states and usage only, and is skipped otherwise.

## Post-merge check

`pnpm hooks` (also run by `postinstall`) points `core.hooksPath` at `.githooks`, so every merge into `main` builds a throwaway worktree in the background and runs `tests/e2e/real-floor.spec.ts` against it, logging to `~/Library/Logs/agent-office/post-merge-e2e.log` and raising a macOS notification, plus an ntfy push if `~/.config/agent-office/ntfy-topic` exists, on failure.

## Packaging and signing

`electron-builder.yml` uses the app id `com.aaronmetzelaar.agentoffice`. Build with `pnpm build && pnpm exec electron-builder --mac --dir`. Without a signing identity the app comes out ad-hoc signed, runs fine, and gets no notifications.

Notifications need a stable signature, and a self-signed certificate is enough. macOS also keys notification permissions to that identity, so every build must use the same one. One-time setup:

1. Open Keychain Access, then Keychain Access → Certificate Assistant → Create a Certificate…
2. Name it `Agent Office Local`, set Identity Type to Self Signed Root and Certificate Type to Code Signing, and create it in the login keychain.
3. Double-click the new certificate, open Trust, and set Code Signing to Always Trust. `security find-identity -v -p codesigning` should now list it.
4. Build signed: `pnpm build && CSC_NAME="Agent Office Local" pnpm exec electron-builder --mac --dir`.
5. Open `dist/mac-arm64/Agent Office.app`, allow notifications when macOS asks, and check that System Settings → Notifications → Agent Office uses Alerts.

The builder config turns hardened runtime off, because library validation rejects a self-signed app's own frameworks, and asks macOS for the Alerts style. Once the certificate exists, electron-builder finds it without `CSC_NAME` too.
