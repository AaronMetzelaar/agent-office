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
| `pnpm test` | Runs the Vitest unit tests in `tests/main` |
| `pnpm test:e2e` | Builds, then launches the app with Playwright and runs `tests/e2e` |

To run the built app without the dev server: `pnpm build && pnpm exec electron .`

## Running in the background

Closing the window hides it, and the app keeps running in the menu bar. Click the menu bar icon to bring the window back. Right-click it for Show Agent Office, Open at Login and Quit. Open at Login starts off. ⌘Q also quits. Launching the app again focuses the running one.

## Where data lives

The app keeps its data in `~/Library/Application Support/Agent Office`. Later units add the metadata database, the search index and the encrypted account tokens there. Claude Code transcripts stay where Claude Code writes them, in `~/.claude/projects`. The office doesn't touch `~/.claude`, apart from the optional hook entry Unit 13 adds with your consent.

Set `AGENT_OFFICE_USER_DATA` to use a different folder. The end-to-end tests use a temporary one, so they can run while your own copy is open.

## Packaging and signing

`electron-builder.yml` uses the app id `com.aaronmetzelaar.agentoffice`. For an unsigned local build, run `pnpm build && pnpm exec electron-builder --mac --dir`. Signing is off for now. Unit 7 adds a stable self-signed identity, since macOS only keeps notification permissions across builds signed by the same identity.
