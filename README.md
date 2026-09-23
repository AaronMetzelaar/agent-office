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

## Running in the background

Closing the window hides it, and the app keeps running in the menu bar. Click the menu bar icon to bring the window back. Right-click it for Show Agent Office, Open at Login and Quit. Open at Login starts off. ⌘Q also quits. Launching the app again focuses the running one.

## Where data lives

The app keeps its data in `~/Library/Application Support/Agent Office`:
- `accounts.json` lists accounts (id, label, created at).
- `secrets/` holds each account token, and the optional Linear key, as its own file, encrypted with Electron `safeStorage` under a key held in the macOS Keychain.
- `office.db` is the metadata database (SQLite in WAL mode): chats (session id, account, folder, title, state, read state, usage, wait timestamps), Always allow rules per account and repository, wait metrics, composer drafts encrypted with `safeStorage`, and each account's last health. It never holds message text.

Claude Code transcripts stay where Claude Code writes them, in `~/.claude/projects`. The office reads them to replay a chat's history and doesn't touch `~/.claude` otherwise, apart from the optional hook entry Unit 13 adds with your consent.

`better-sqlite3` 13 ships N-API prebuilt binaries, so the same binary loads in Node (Vitest) and in Electron. There is no native rebuild step, and `package.json` lists it under `ignoredBuiltDependencies` so pnpm skips its node-gyp script.

Set `AGENT_OFFICE_USER_DATA` to use a different folder. The end-to-end tests use a temporary one, so they can run while your own copy is open.

## Accounts

On first run the office stays hidden until one account validates. Run `claude setup-token` once per account (tokens last one year), paste the token and give it a label. Validation is a one-turn Haiku query with no tools and no settings, and it reads the 5-hour and weekly usage. Settings → Accounts adds the second account, shows usage, and takes a new token for an account that needs login: adding a token under an existing label replaces that account's token.

Account health (status and usage) is saved in `office.db`, so it survives a restart. A rate limit during validation counts as a valid token that is out of headroom, not a failed login. Each running chat's rate limit events keep the usage figures current. Removing an account stops its chats and marks them Stuck (needs login).

## Chats

Each chat runs as one streaming Agent SDK session in the main process, with its account's token, its folder as the working directory, and Auto mode. Main owns the chat state. The renderer asks for a snapshot on mount and whenever the window shows, then applies per-chat patches, flushed at most once per 16ms. While the window is hidden, only state changes are pushed.

A chat moves through Starting, Working, Needs you, Done, Idle and Stuck. Stuck carries a reason: needs login, rate limited (with the retry time when Claude sends one), crashed, interrupted or error. An exception in one chat only marks that chat Stuck.

Quitting while a chat is mid-turn asks first, then interrupts its turn. After a restart, or a crash, chats that were mid-turn come back as Stuck (interrupted) and never resume by themselves. Resume continues the same session, which the office only does for sessions it started. A restored chat's earlier turns are replayed from its transcript.

## Permissions

Sessions run in Auto mode, so Claude only asks when Auto mode escalates. Each ask becomes a pending request on its chat, and the chat moves to Needs you. A chat can hold several requests, oldest first, and the snapshot carries them with the time of the oldest. Every surface answers through one `resolveRequest`: the first answer wins, and later ones get "already answered (source)". A request whose session died answers "session ended" and the chat shows Stuck.

- **Dangerous requests** need a click in the app. Keys, notifications and the phone can only deny them. The office flags `rm -rf`, `sudo`, downloads piped into a shell, `git push --force`, `git reset --hard`, credential and config paths (`.env*`, `~/.ssh`, `~/.aws`, the keychain and similar), anything outside the chat's folder, and whatever Claude Code marks `defaultToNo`. Keyboard answers only count while the window is focused.
- **Always allow** saves Claude's literal suggested rule, such as `Bash(pnpm test)`, for the account and the repository. Worktrees share their repository's rules, found through git's common directory. Rules reach sessions through the SDK's flag settings layer: at start, and live when a rule is added or revoked. WebFetch and WebSearch never get Always allow and always ask, since fetched content is the easiest way to steer an agent. Dangerous requests and asks where Claude Code suppresses the rule don't offer it either. Office rules don't apply to the terminal or the desktop app.
- **Plans and questions** use the same path. Approving a plan switches the session back to Auto mode. Answers to a question go back to Claude as the tool's input.
- **Wait metrics** in `office.db` record how long each request waited and how long a Done reply waited to be read.
- **Needs login:** while an account needs a new token, the office refuses new turns on it, and the snapshot lists one login item per account.

## Test flags

- `AGENT_OFFICE_FAKE_VALIDATOR=1` swaps in a fake validator that accepts tokens containing `fake-ok`. Packaged builds ignore it.
- `AGENT_OFFICE_FAKE_ENGINE=1` swaps the Agent SDK for the scripted engine in `tests/fakes/fake-engine.ts`, which answers every message without spending tokens. A message containing `[hang]` keeps its chat working, and one containing `[ask]` asks to run `pnpm test` first. Packaged builds ignore it.
- `RENDERER_VITE_OFFICE_DEMO=1 pnpm dev` runs the office on the prototype's sample chats instead of your accounts: working, waiting, stuck and parked agents, with Admin folded until its first agent walks in after 10 seconds. The flag is read at build time, so a normal `pnpm build` leaves the demo out. The Playwright demo check builds its own copy into `out-demo/` and reads the fps probe on `window.__fps`, which only dev and demo builds expose.
- `AGENT_OFFICE_REAL_TOKENS=1 pnpm test tests/main/real-tokens.test.ts --silent=false --reporter=verbose` uses the `MAIN_TOKEN` and `RESEARCH_TOKEN` in `~/.config/agent-office/spike.env` for real. It validates both accounts, then runs a one-turn Haiku chat on each through the session engine. It prints labels, states and usage only, and is skipped otherwise.

## Packaging and signing

`electron-builder.yml` uses the app id `com.aaronmetzelaar.agentoffice`. For an unsigned local build, run `pnpm build && pnpm exec electron-builder --mac --dir`. Signing is off for now. Unit 7 adds a stable self-signed identity, since macOS only keeps notification permissions across builds signed by the same identity.
