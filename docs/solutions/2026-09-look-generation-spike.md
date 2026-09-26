# Generated room looks: the step 2 test

Step 2 of `docs/brainstorms/2026-09-25-rooms-for-any-setup-requirements.md` starts with a generation test on about five real repos. This is that test.

## Setup

- Repos: `mws-gate` (MWS, Go), `frontend-stp-Aaron-Metzelaar` and `portfolio` (both JavaScript), `homelab` (no manifest), `poseidon-q4` (research notes).
- Models: `claude-haiku-4-5` with thinking off, `claude-sonnet-5` and `claude-opus-5` at low effort.
- Call: a one-turn Agent SDK query on a setup token, with no tools, no settings, a temporary working directory and `outputFormat` set to the design schema in `src/shared/looks.ts`. Input is the folder name, the README (capped at 6,000 characters), manifest files (2,000 each) and the top-level file list (80 names), read by `repoInput` in `src/main/looks/generate.ts`.
- Rooms already standing were passed along, so the models could avoid repeating signature pieces.
- `AGENT_OFFICE_LOOK_SPIKE=1 pnpm test tests/main/look-spike.test.ts` reruns it and writes each model's attempts to `docs/solutions/look-spike/<model>/<repo>.json`. `AGENT_OFFICE_LOOK_SHOTS=1 pnpm exec playwright test tests/e2e/look-spike.spec.ts` draws one model's looks on the real floor and saves screenshots to `docs/solutions/look-spike/shots/`.

## Results

First try and retry, checked with the final rules:

| Model | Designs returned | Pass on first try | Pass after one retry | First try |
|---|---|---|---|---|
| Opus 5 | 10 of 10 | 4 of 5 | 5 of 5 | 34–48 s, 2.7k–4.2k output tokens |
| Sonnet 5 | 7 of 9 | 2 of 5 | 4 of 5 | 27–94 s, 3.0k–11.0k |
| Haiku 4.5 | 6 of 9 | 3 of 5 | 4 of 5 | 27–59 s, 4.4k–10.0k |

Sonnet and Haiku each ran out of turns on some repos without returning a design. The run allowed 2 turns; the limit is 4 now, which hasn't been retested. Haiku also dropped the signature piece on a retry. Opus always returned a design and used the fewest tokens.

**Opus 5 is the generator.** A first try takes about 40 seconds, which the construction scene covers (R18 allows up to a minute). A retry takes 35–80 seconds more.

## What changed on the way

- **The office places props, not the model.** On the first pass every model failed almost every room, mostly on geometry: props sticking out of the room, running into the side zone at tier 2, reaching the chairs, or overlapping. The models design good props but can't keep coordinates straight across three room sizes. Now the model only says which zone a prop belongs in (the back wall, hung on the wall, or the side strip from tier 2) and in what order. `arrange` in `src/shared/looks.ts` lines them up for each tier: it centres the signature piece, spreads the rest across the wall, shrinks anything too big for its zone, and drops extras past the tier budget. The check still runs on the result, so R13 holds.
- **Rooms looked timid.** Placed flush left at the size the model chose, props read as small clutter. The office now enlarges the signature piece toward 2.2 m wide (up to 1.6×, within its zone), and the guidelines ask for a showpiece of 2 m or more with 12 to 24 parts, plus 4 or 5 props at tier 1 and no generic office filler.
- **Rules that were wrong, not the models.**
  - Panels took two size numbers, as the guidelines said, but the check wanted three.
  - The office's own paper white `#fbfbf9` counted as too bright.
  - Saturated accents such as amber counted as neon. Neon now means pure primaries only, and strong colours are only held back on big parts.
  - 2.4 m was too low for gantries, so the height limit is 2.8 m.
  - Labels such as `q=4` and `$64k` were rejected. Labels are painted on a canvas, so only control characters and links are blocked now.
- **Thinking was most of the output.** Claude Code turns thinking on by default, and Haiku spent 18k output tokens on a 1.8k-token design. Thinking is off for Haiku, and the others run at low effort.

## Still open

- The looks are on theme and pass the check, but they're tidy rather than over the top. The next lever is the guidelines and a few examples drawn from the hand-built rooms, then another look at the screenshots.
- The rest of step 2 hasn't been started: generating when a room is made, storing the design on the room (the `design` field on `RoomDef` is already drawn by `props.ts`), the construction scene, Redecorate and the setting.
