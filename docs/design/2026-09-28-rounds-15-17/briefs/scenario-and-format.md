# Shared brief for all four identities

## What the product is (read this twice)

Agent Office is a desktop app (macOS, Electron) and future web/mobile companion for ONE power developer who runs 8–30+ coding agents at once — Claude Code chats it hosts itself (on two Claude subscription accounts), plus "companion" agents the user runs elsewhere (Claude Code in a terminal/IDE, Codex CLI, Copilot CLI, OpenCode, Cursor) that the app watches through their hooks and session files and answers permission prompts for. It is going open source for every developer who runs agents in parallel.

Its job: the user's attention is the only scarce resource. Agents are cheap and plentiful; the app turns everything happening into the few high-impact decisions only the human can make, and makes each decision fast and well-informed.

The settled product model (from the requirements, R1–R33):
- **Lines.** Every chat/agent is a *line* on a metro map. Its *stops* are its stages and tasks. Lines grow out of their repository's `main` (a station). Stage route: Brainstorm → Plan → Work → Review → Ship → Merged (→ Compound). Work has one stop per plan task ("task 6 of 9"). Skipped stages are drawn dashed. *Side chats* branch off the stop they came from and can *reconnect* (summary, code, or both). Merged lines fade and leave after a day.
- **The hub / overview (home, ⌘0).** The network of every line + a triage of where you're needed: **Start something new** (one-line composer, repo picker, starting stage), **Jump in** (questions + permission requests answered on the row; number keys answer), **Review** (fix ready, plan ready, PR ready), **Your call** (defaults the agent chose — Keep/Change; suggested work — Start/Not now), **Finished today** (folded).
- **The intake.** Signals from GitHub (review requests, PR comments, CI), Sentry (errors), Gmail (mail), Slack (questions), Linear (tickets moving into the cycle), customer feedback, product telemetry (Mixpanel/Metabase), Claude Code sessions' leftover next-steps, and the office's own follow-ups (review findings left for later) are scanned hourly, judged invisibly (importance: act now / today / this week / FYI / not for you; can an agent do it; which repo/line it belongs to; kind), MERGED when about the same thing (a Sentry error + a Slack question + a PR about saved cards = one), and the worth-doing ones become **suggestions with a drafted kickoff** (repo, stage to start at, skill, one-sentence prompt) with Edit and "Why?". Important-not-now items wait on **a list**; left-out items stay reviewable. The user's **rules** are plain sentences ("Anything from the security team is act now"); "Not now" and "Never for this kind" teach new ones.
- **Started for you.** Low-risk work starts by itself: own worktree, no push, no messages sent as the user, no deploys, stops at every permission request. Carries a quiet "started for you" tag and one-action Stop. Anything that would act as the user outside (post in Slack, send mail, comment on a PR, move a ticket) waits as an **outward request**: Allow once / Edit / Don't post, showing the exact content.
- **The workspace / session.** One chat: header merged into the title bar (back/forward, the chat switcher, branch + state, "N need you ⌃Tab"); the chat's *line squeezed* in a narrow column left of the reply (finished stops short ticks in stage colours, the open stop a tall bar, future stops faint, ending at `main`; ⌘L expands with one-line outcomes); the **open stop gets the page** (heading + task number, the conversation with full replies, code with Copy/Apply, tool work collapsed to one line per step with connector steps labelled by source, the live step and next stop at the bottom, then the message box: `/` skills, `@` files, model/effort/permission-mode); a right column **Open** (open questions, defaults in use Keep/Change, permission requests, blockers or "nothing blocked"), **Tasks** (plan tasks crossed off, sub-steps nested), one quiet line each for tests and changes (⌘D diff), **Connected to this line** (the PR, Sentry issue, Slack thread or mail with live state). A **workbench** (⌘J) pane with tabs: app preview, changes, terminals, documents — each tab marked with the stop it came from. Workspace state persists per chat.
- **Getting around.** Chat switcher dropdown from the chat name (needs you / running / waiting groups, each row with its small line; side chats indented), ⌃Tab hold-and-release overlay, ⌘K search over chats/files/decisions, notifications from other chats bottom-right, answerable in place (⌥Y/⌥N), never stealing focus.
- **Existing features that must keep a home:** one or more Claude accounts or an API key with usage headroom (5-hour and 7-day windows, warn at 80%), moving a chat to the other account; models and effort; permission modes (default / accept edits / plan); saved "always allow" rules per repo; dangerous-request rules that always need a click; phone decisions (today a temporary push bridge; the design targets a real mobile app); desktop notifications; rooms/departments (one per repo, `departments.json`, routes, ship-it commands like `/test-cases`, `/verify`, `/review`, fix CI, answer comments); housekeeping (worktrees, RAM of sessions, cleanup of merged branches); subagents (type, tool uses, tokens, runtime, open full history); rewind to a message (files + conversation); plan cards, question cards (numbered options), request cards; terminals per chat; terminal handoff to iTerm/Terminal; Linear ticket expansion; a hidden classifier (NEVER shown in UI, never named); companion agents' adapters (install hooks consent per agent).

## Hard rules (from the owner — break none)
- No large italic headers. No hero headlines, no slide-deck layouts, no decorative empty space. It's a dense, calm TOOL.
- Not text-heavy. Transcript content is text-heavy by nature; chrome, labels, status must be terse: a few words, numbers, glyphs.
- No heavy box-in-box. Separate with space, rules (hairlines), alignment and type weight, not nested bordered cards. One level of container max.
- Never show machinery: no classifier names (Jev), no confidence scores, no scan counts, no "397 filtered". Say what's happening, where you're needed, what to start.
- Every colour means one thing. Stage colours only for stages. Status colours: "needs you" and "blocked/failed" are reserved and never used for a stage. Connectors are labelled by neutral monogram/glyph marks, never by colour and never drawn as lines.
- Contrast: text ≥ 4.5:1, strokes/rings/marks ≥ 3:1 against their backgrounds, in both light and dark. Status must not rely on hue alone — pair each status with a shape.
- Every action has a keyboard shortcut on desktop (show the key subtly).
- Rejected earlier (never bring back): characters/mascots with faces, the isometric office, a permanent sidebar of chats, sources drawn as coloured lines, scan/judging dashboards.
- Metro elements appear only where they explain progress, structure or provenance. They never decorate.

## Two future features the system must visibly accommodate
1. **3D "virtual agent metroline" view** — a cute, toy-like 3D alternative to the 2D network (trains/cars on raised tracks, stations as platforms, no faces). Show on your System board how it would look IN YOUR system (a small rendered vignette drawn with SVG — isometric/perspective is fine here), and where it's toggled from (e.g. a 2D/3D segmented control on the overview).
2. **Codebase metro map side view** in a session — the codebase drawn as a metro map (directories = lines, files/modules = stations), showing which parts the agent READ and WROTE at which stops of the conversation. Show it OPEN as a side pane on the active session board, synced to the conversation (e.g. hovering a stop highlights files touched there). It must look native to your system.

## One scenario, used by all four designs (so they can be compared)

User: a developer running many agents (the product is standalone and for anyone; never show a real person's name — use "you"). Two Claude accounts: "Main" (5h window 62%, 7d 71%) and "Research" (5h 8%, 7d 35%).

Repositories (stations/`main`): `storefront` (an online shop monorepo: apps/web, apps/admin, apps/mobile, services/api), `payments-service` (a payments API), `habit-tracker` (a side project).

Lines (use these names; pick subsets as needed):
- storefront · **Saved-cards crash fix** — started for you from a Sentry issue; Work task 2 of 3 → now "Fix ready · 2 files · tests pass" (Review).
- storefront · **Checkout redesign** — Work, task 4 of 7, editing `CheckoutForm.tsx`; 2 subagents (Explore · find checkout callers; Review · test coverage gaps).
- storefront · **Dialog CI fix** — NEEDS YOU: permission `git push --force-with-lease origin dialog-ci-fix` (dangerous → needs a click).
- storefront · **Checkout: saved cards** — Review, 4 reviewers, 11 findings, 2 blocking; wants to post in #payments (outward request: "Saved cards fix is merged and live. The token logging is gone.").
- storefront · **Refund webhook retries** — BLOCKED: waits for PR #214.
- storefront · **Review #412 Round prices to the cent** — Review.
- storefront · **Admin: bulk export** — Plan, "plan ready · 7 units".
- payments-service · **Rate limiter** — NEEDS YOU: question "Limit per user, or per API key?" options 1 Per user / 2 Per API key.
- payments-service · **Try token bucket** — side chat of Rate limiter, "results ready".
- payments-service · **Idempotency keys** — Plan, plan ready.
- payments-service · **Webhooks v2** — suggestion (from Linear, moved into this cycle) "Worth starting?".
- habit-tracker · **Habit tracker** — Work, task 6 of 9 "Settings page", sub-steps: Time zone from the browser (done), Default reminder time (now), Delete account (todo). Used a default: "browser notifications plus an in-app banner" (Keep/Change).
- companion: **Codex · Search index rebuild** (a Codex CLI session in a terminal, running `python reindex.py`) — shows it's not only Claude.

Incoming signals (the intake):
- Sentry: `TypeError: card is undefined` · saved-cards.ts:88 · 34 users since today's release — merged with Slack #payments "Is saved cards still shipping today?" and PR #214 → one item, already a started-for-you line.
- Mixpanel (telemetry): checkout conversion on iOS −8% since 4.12.0 → suggestion "Investigate iOS checkout drop" (start at Brainstorm? no — Work: investigate).
- Customer feedback (Intercom): 6 reports "promo code field clears on refresh" → suggestion "Fix promo code field" merged with an old line "Promo code field" (idle).
- Gmail: security team "Security review requested for PR #214" → attached to Checkout line.
- Linear: PAY-812 "Webhooks v2" moved into the cycle → suggestion.
- GitHub: review requested on #219; Dependabot security bumps (3) → started for you.
- Metabase: nightly refunds report — FYI (goes to the list, not a suggestion).

Session content for the ACTIVE session board: use **habit-tracker · Habit tracker**, task 6 · Settings page. Transcript: `Read 4 files · edited public/settings.js +48` (collapsed tool line) · You: "Keep the settings page to one screen. Time zone should default to the browser's." · Agent: "Makes sense. I'm reading the time zone from the browser on first load and saving it with the user, so reminders fire at the right local time. Default reminder time comes next, then account deletion." · code block `public/settings.js`: `const zone = Intl.DateTimeFormat().resolvedOptions().timeZone` / `if (!user.timeZone) await api.patch('/me', { timeZone: zone })` with Copy · Apply · live step "Writing public/settings.html…" · Next: 7 · Landing page. Tests: none yet, added in task 8. Changes: 14 files +1,284 −96.
Codebase map for habit-tracker: lines = `public/` (settings.js, settings.html, app.js, styles.css), `server/routes/` (habits.js, users.js, reminders.js), `server/db/` (schema.sql, migrate.js), `tests/` (empty). Read at stop 6: settings.js, users.js, schema.sql, app.js. Written at stop 6: settings.js (+48), settings.html (being written). Earlier stops touched habits.js, reminders.js.

EMPTY session board: a new chat in `storefront` with nothing yet — composer focused, starting stage picker (Brainstorm/Plan/Work/Review), repo + worktree toggle, account, model/effort, and a few *specific* starters derived from real state (e.g. "Continue: Admin bulk export plan is ready", "From Sentry: refund webhook 500s", "Review #219"), not generic prompts.

## Format rules for every artboard (Design canvas `.dc.html`) — follow EXACTLY
Skeleton:
```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Short screen name</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link href="https://fonts.googleapis.com/css2?family=...&display=swap" rel="stylesheet">
<style>
body{margin:0}
a{color:inherit}a:hover{opacity:.8}
</style>
</helmet>
<div style="width: 1440px; height: 900px; box-sizing: border-box; overflow: hidden; position: relative; background: {{t.bg}}; color: {{t.ink}}; font-family: ...">
 ... markup ...
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"dark":{"editor":"boolean","default":true},"$preview":{"width":1440,"height":900}}'>
class Component extends DCLogic {
  renderVals() {
    const dark = this.props.dark ?? true;
    const t = dark ? { bg: '#...', ink: '#...' } : { bg: '#...', ink: '#...' };
    return { t };
  }
}
</script>
</body>
</html>
```
Rules that fail silently if broken:
- Keep `<script src="./support.js"></script>` exactly. Close every non-void element; quote every attribute.
- Root element has a FIXED size equal to the board size, and the same `$preview` size.
- `{{hole}}` is a dotted lookup into renderVals() only — never an expression (`{{a+b}}`, `{{!x}}` fail). Compute in renderVals.
- Theme: every board has a boolean `dark` (or `light`, per your identity's default) prop that switches ALL tokens (t.*, stage colours, status colours) so the board renders correctly in both themes. Put token objects in renderVals. Don't hardcode theme-dependent hex in markup (neutral fixed things like the macOS traffic lights are fine).
- Repeats: `<sc-for list="{{items}}" as="it" hint-placeholder-count="3"> ... {{it.name}} ... </sc-for>`; branches: `<sc-if value="{{cond}}" hint-placeholder-val="{{true}}">…</sc-if>`. Precompute per-item styles in renderVals (e.g. it.colour, it.weight). Writing rows literally in markup is also fine and often clearer.
- All UI is markup (no innerHTML, no appendChild, no own window components). No global keydown handlers. No iframes. No network except ONE Google Fonts css2 `<link>` in `<helmet>`. Icons: inline stroke SVG (never emoji).
- Use real `<button type="button">`, `<a href>`, `<input>` with `<label>` (visually hidden label is fine: `position:absolute;left:-9999px`). aria-label on icon-only buttons.
- Layout with flex/grid + gap. SVG for maps/lines (give `role="img"` and `aria-label`).
- Mobile boards are 390×844: NO fake iOS status bar, NO fake keyboard, no fake home indicator. Touch targets ≥ 44px.
- Desktop app boards are 1440×900 and include the macOS window chrome (traffic lights: #ff5f57 #febc2e #28c840, 12px circles) in the app's own title bar. Web boards are 1440×900 and show a minimal browser frame (address bar with a URL like `app.agentoffice.dev/...` or similar) — or render the page edge-to-edge at 1280 inside the board, your choice, but make it read clearly as "the web version".
- Type sizes: UI 12–14px, never below 11px for any text (including SVG labels AFTER any scaling — don't scale SVG down with viewBox).
- No lorem ipsum, no invented metrics beyond the scenario. Copy is plain, short sentences.
- Keep each file under ~60 KB.

## Extra product facts to get right
- `storefront` is a generic online shop monorepo (apps/web, apps/admin, apps/mobile, services/api): checkout, saved cards, promo codes, refunds. `payments-service` is a separate API (webhooks, rate limits, idempotency). `habit-tracker` is a small side project. This is a standalone product: no company-specific content.
- Request types: permission (tool + exact command, e.g. `$ git push --force-with-lease origin dialog-ci-fix`; buttons Allow once [1] · Always allow [2] · Deny [3]); **risky requests** (force-push, rm -rf, sudo, .env/~/.ssh paths, outside the chat's folder) need a deliberate confirmation — a click on desktop (keys can only Deny), Face ID + hold in the mobile app, never a notification button; questions (AskUserQuestion: numbered options with descriptions, single/multi select, "Or your own answer…"); plan approval (plan as markdown, Approve plan / Keep planning…); outward actions (Allow once / Edit / Don't post, showing the exact text).
- Chat states: starting · working · needs you · done · idle · stuck (needs login / rate limited until 14:05 / crashed / interrupted / error). Parked after a day.
- Composer today: textarea "Reply to Habit tracker… (/ for commands)", `/` picker (Recently used / Skills / Custom commands / Plugin skills / Built-in), attachments (images, files), permission mode label (Ask before edits / Accept edits / Plan), Model (Opus 5.5 / Sonnet 5 / Haiku 4.5), Effort (Low → Max), a context ring with % (warn at 80%), Send ↵ / Stop.
- Subagents: "Explore · 9 tool uses · 21.4k tokens · 1m 4s".
- Mobile: today there's only a temporary push bridge; the design assumes a REAL native mobile app (iOS/Android): rich push notifications with actions, a full app for triage, sessions and settings, widgets / Live Activities, biometrics. Risky requests (force-push, rm -rf, secrets, outside the folder) are never allowed from a lock-screen button or a keyboard shortcut: they need a deliberate confirmation — a click on desktop, Face ID + hold in the mobile app.
- Housekeeping: RAM per agent, worktrees, disk, "Clean up 4 safe · frees 3.1 GB", park after 1 day, clean up after 3 days.
- Settings domains that exist or are planned (use them): Accounts (Main, Research: token or Claude login, usage 5h/7d, check now, replace token), API key (hosted chats in the open-source build), Agents (companion adapters: Claude Code, Codex CLI, Copilot CLI, OpenCode, Cursor — hook installed / not; what each supports: live state, approvals, replay), Sources (GitHub via gh, Sentry, Gmail, Slack, Linear, Intercom, Mixpanel, Metabase — connected / not connected), Rules (plain sentences; learned ones marked), Autonomy / Started for you (on/off, at most 2 at once, never on battery below 20%, the fixed limits: own worktree · no push · no messages as you · no deploys · stops at every request; deploy commands to deny), Permissions (saved always-allow rules per repo, revoke; risky list), Routes & rooms (stages, skills `ce:brainstorm` etc., ship-it commands `/test-cases` `/verify` `/review`, fix CI `/gh-fix-ci`, answer comments `/pr-comment-rundown`), Notifications & phone (desktop, phone push, quiet hours 22:00–07:30, batching), Housekeeping (park after, clean up after), Appearance (dark/light/system, density, 2D/3D network), Editor (VS Code / Cursor / Zed…), Agent host (version, restart).
- Competitors (for "why not the standard"): Claude Squad, Vibe Kanban (kanban of agents), Pixel Agents (pixel-art office), plain chat apps with a sidebar of conversations. The standard pattern is sidebar + chat or a kanban board. Our claim: one place to see and answer every local agent, organised as lines.

## The 00-System board (1440×1800) — same structure for all four identities
Documentation board, but still terse — no paragraphs longer than 2 lines. No hero headline; the name is set at 28px/700 (not italic), not bigger. Sections, separated by space and hairlines (no card grids):
1. **Name + brief** (one sentence) + the identity's signature mark drawn large-ish (e.g. the line bullet, the seal, the carriage, the pulse step) — this is the "you'd recognise it" element.
2. **The argument**: the theory of attention in one line; 4–5 short bullets on why this suits the agentic age; then **"Why this, not the other three"**: three one-line comparisons (name the other three identities: Interchange, Ledger, Diorama, Cadence); and one honest trade-off line.
3. **Colour**: neutrals, stages, status — dark and light side by side, swatch + role + hex. State the one-meaning-per-colour rule in one line.
4. **Type**: the families with a specimen line each and the size scale.
5. **Grammar & components** (drawn, not described): a line with done/current/future/skipped stops; needs you / blocked / ready / started-for-you states (showing the shape paired with each colour); connector marks (GH SE GM SL LN IC MP MB CC); a triage/decision row; the composer; a notification; a side chat branch + reconnect.
6. **The 3D metroline view in this system**: an SVG vignette (~560×320) of the cute 3D view drawn in this identity's language, plus where the 2D/3D toggle lives.
7. **The codebase map in this system**: a small specimen (~560×260) of the codebase side view (read vs wrote, synced to stops).
8. **Form factors**: desktop / web / mobile — for each, one line on the platform's strength and what this identity does with it, with a tiny wireframe thumbnail (simple shapes).

## How to work (for build agents)
- Write your boards to `/tmp/claude-0/-home-user-agent-office/3f088f39-de60-521d-ab9e-ef480160be1a/scratchpad/root/project/<PREFIX>-NN-Name.dc.html` using the Write tool. Don't write any other files there (no canvas.json, no support.js edits). Don't publish anything.
- Preview renderer (a local copy of the canvas runtime is served at http://127.0.0.1:8766/): run `cd /home/user/agent-office && node .design-shot.mjs <absolute path to your .dc.html>` → prints a PNG path; add `--flip` to render the other theme. Then Read the PNG to look at it. Fix overlaps, clipping, text below 11px, broken holes (literal `{{...}}` showing), and contrast problems. Render every board at least once, and the overview + one mobile board in both themes. ERRORS lines in the output mean a runtime error — fix them.
- Quality bar: this is high-fidelity product design for a demanding designer. Real density (a working tool), precise alignment, consistent spacing (4/8 scale), consistent components across your boards, and the identity's signature visible on every board. Use the scenario's exact names and copy. Draw maps/tracks with SVG, positioned carefully (compute coordinates; avoid labels colliding with lines). No emoji. No lorem ipsum. No invented stats beyond the scenario.
- When done, reply with: the list of files, their sizes (w×h), and 2–3 lines on anything you couldn't do.
