---
date: 2026-09-23
topic: sdk-dual-account-spike
plan: docs/plans/2026-09-23-001-feat-agent-office-app-plan.md (Unit 1)
sdk: "@anthropic-ai/claude-agent-sdk 0.3.280 (CLI 2.1.280)"
---

# Phase 0 spike: dual accounts, controls and fork adoption

**Verdict: GO on every must-pass assumption.** Units 2–13 proceed as planned. The connector gap needs its follow-up task.

| Assumption | Result | Evidence |
|---|---|---|
| Two accounts run headless sessions at the same time in one Node process | Go | `dual-account.ts`: both sessions succeeded, overlapping by 7.8s. `account-identity.ts`: different tokens with different usage windows (main 60% of 5h / 77% of 7d, research 0% / 35%), so they are two accounts. |
| Runtime controls | Go | `controls.ts`: allow-once wrote the file. `setModel('sonnet')` moved Opus 5.5 to Sonnet 5 mid-session. `applyFlagSettings({ effortLevel })` accepted. `setPermissionMode('plan')`, then ExitPlanMode arrived through `canUseTool`. `interrupt()` returned `{ still_queued: [] }` and the session answered the next message. |
| `canUseTool` reaches the broker | Go | Every ask arrived with `toolName`, `displayName` and `suggestions`. |
| Fork adoption is safe while the original is open | Go | `fork-adopt.ts`: the fork got a new id and remembered the context. The original transcript was untouched, and the original kept working. |
| A chat can continue on the other account | Go | Forking a main-account session under the research token gave a new id with the context intact. |
| Shell hooks fire in SDK sessions | Go | `hook_started` / `hook_response` system messages were seen with default `settingSources`. |

## Findings that change the build

- **Plain resume while another client has the chat open appends to the same transcript** (7 lines, no error). Adoption must always fork, as planned. The office must never plain-resume a chat it doesn't own.
- **The SDK doesn't flag obviously destructive commands.** For `rm -rf ./build-cache`, both `defaultToNo` and `suppressAlwaysAllowRule` were unset. The office's own danger list (Unit 5) is required, not a nice-to-have. Still honour both flags when present.
- **Permission suggestions carry literal rules**, e.g. `addRules` → `Bash(mv notes.txt notes.md && ls)` with destination `localSettings`, plus `setMode acceptEdits` for edits. Store the literal `ruleContent` per account and repository (Unit 5).
- **Errors are thrown from the message iterator.** One run died on an uncaught `Claude Code returned an error result: [ede_diagnostic] result_type=user`, around the interrupt step; a rerun didn't reproduce it. An invalid token throws `Failed to authenticate. API Error: 401 OAuth access token is invalid`. The session engine (Unit 4) must wrap each chat's iterator, map thrown errors to Stuck reasons (401 → needs login), and offer Resume.
- **`accountInfo()` only returns `tokenSource`** for `setup-token` logins: no email, organization or plan, because the token is scoped to model requests. Accounts are identified by the label given at onboarding (Unit 3). Validation is a one-turn query.
- **Headroom per account is available.**
  - `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })` returns the `five_hour` and `seven_day` utilization and reset times.
  - `rate_limit_event` messages stream the same kind of data per session.
  - Prefer `rate_limit_event`. Use the experimental call only as an on-demand refresh, behind a guard (R17).
- **Tokens last one year** (the `claude setup-token` output). Plan for a yearly re-login, plus the 401 path for revoked tokens.
- **Connector gap confirmed.** Token sessions see only local MCP servers (growthbook pending, indesign connected, storyblok needs auth). None of the claude.ai connectors (Linear, Slack, Sentry, Figma, Google…) are present. This matters for the Sentry prep and WBSO presets and for Linear-driven work. The follow-up task decides between local MCP servers per service and keeping those jobs in the desktop app.
- **Slash commands:** `supportedCommands()` lists at least 60 in a scratch folder. Repository skills add more in real repositories.
- **Cost:** the plan-mode step cost $0.50 alone (Sonnet started subagents). Keep future spikes minimal.

## Phone decisions (added 2026-09-23)

`spikes/phone-decision.ts` sent an ntfy notification to Aaron's topic with two `http` action buttons, Allow once and Deny, each posting an HMAC-signed `{request id, decision, expiry}` to a private reply topic. On his iPhone he tapped Allow once, and the script received and verified `allow` through `/<reply-topic>/json?poll=1`. Decisions from the phone work with no inbound port on the Mac. The app should use ntfy's streaming subscribe instead of polling.

## Scripts

`spikes/dual-account.ts`, `spikes/account-identity.ts`, `spikes/controls.ts`, `spikes/fork-adopt.ts` and `spikes/phone-decision.ts`. They read `~/.config/agent-office/spike.env` (0600) and never print tokens. Results go to the git-ignored `spikes/results/`.
