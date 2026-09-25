---
date: 2026-09-25
topic: rooms-for-any-setup
---

# Rooms for Any Setup

## Problem Frame

Agent Office is built around Aaron's own setup. Its seven departments are fixed in code, along with their names, colours, folder rules (`monorepo/frontend/*`) and MWS-themed props. A second account becomes the Research gym only if its label contains "research". The ship-it buttons call `/mws-*` skills.

Someone else who installs it today gets every chat on the Side projects playground outside and an empty building. An MWS colleague gets the monorepo rooms only if their clone happens to sit in a folder called `monorepo`. Nothing breaks, but the office doesn't look like their work, and that look is the whole point of the app.

The fix comes in two steps. Step 1 gives each repo its own room with a plain look. It adds a config file for anything unusual, and it recognises MWS repos so colleagues get the MWS rooms without any setup. Step 2 has workers build each new room in front of you, while Claude designs its look to match the repo. Aaron's office stays the same throughout.

## Requirements

### Step 1: A room for every repo

**Where rooms come from**
- R1. A chat's home room is its git repository. Worktrees belong to their repository's room, found through git's common directory the way Always allow rules already are. A room is identified by its repository's path and named after the repository's folder. When two rooms on the floor share a name, their signs add the parent folder. A repository that moves gets a new room. Each built room gets an accent from the chat colour palette that no other room uses, picked when it's built and kept after that.
- R2. Chats in folders outside any git repository go to the Side projects playground, as they do today. Chats started from the review queue go to the PR reviews room, a fixed room like the playground, whatever their repository.
- R3. Rooms are built when a chat starts, whether it's an office chat or an outside chat. Chats the office finds when it first launches count as starting. Placement never builds a room: a chat whose file edits point at another repository moves to that repository's room only if the room already exists. This narrows R4 of the original requirements, which was written when every department always existed.
- R4. Inside the building, rooms keep a stable order: first the MWS rooms and the rooms defined in the config file, in that order, then built rooms, oldest first. Empty rooms still fold away and come back as they do today.
- R31. Built rooms that don't have a look yet use the plain look: their accent's floor tint, the sign and standard desks, with no props.

**MWS repos**
- R28. A repository counts as MWS when its `origin` remote is in the MatchWornShirt GitHub organisation, or when its folder name, README title or package names mention MWS or MatchWornShirt.
- R29. The MWS monorepo gets today's rooms with no config: Marketplace, Admin, Mobile and Backend / infra, with today's folder split, names, colours and hand-built looks. These built-in entries follow the same most-specific-folder rule as config entries. A config entry for a parent folder, like Aaron's `~/Documents/GitHub`, doesn't take them over. An entry for the same folder or a deeper one overrides them.

**Config file**
- R5. `~/.config/agent-office/departments.json` can define rooms. Each room gets a name, the folders it covers, an optional accent colour and an optional look. The look is either one of the hand-built rooms (showroom, back office, device wall, server room, reading room, gym) or generated (R10). A room defined by subfolders is how a monorepo gets split into several rooms. The config can also send folders to the playground, so repositories under them never get a built room. The most specific folder wins, as it does today. Config entries take precedence over built rooms for every folder they cover.
- R6. A room in the config file can be tied to an account instead of to folders. It wins over folder rooms for that account's chats: they start there unless you start one from a desk in another room, and placement never moves them out, just as with the Research gym today. This replaces the `/research/i` label check.
- R7. Aaron's config and the built-in MWS rooms together reproduce today's office exactly: the same rooms, names, colours, props and placement. His config sends `~/Documents/GitHub` to the playground so his side projects stay there. It ties the Research gym to his research account and lists his skills (R24). His existing chats keep their rooms after the upgrade.
- R8. With no config file, the office works with built rooms, the MWS rooms and the playground. If the file exists but can't be read, the office shows the error and builds no new rooms until the file is fixed. Entries it can't use are skipped one by one, and the office names them.
- R9. The README documents the config file and includes Aaron's config as an example.

**No personal assumptions elsewhere**
- R24. Every skill the office starts takes its command name from the config file: the ship-it steps, Fix CI, Answer comments, and the review queue's review command. Aaron's config lists the current ones (`/mws-*`, `/gh-fix-ci`, `/pr-comment-rundown`, `/pr-review-rundown`). With no configured ship-it commands, the four ship steps are hidden. Clean up, Move ticket and the waiting states still show, along with a one-line hint pointing to the config. If commands are configured but none are installed, the ship-it area says so instead of disappearing.
- R25. Outside chats from a Claude desktop instance belong to the account whose label appears in the instance's name, ignoring case. If more than one label appears, the longest wins. An instance that matches no label belongs to the first account that no other instance's name matches. That reproduces today's mapping without a hardcoded check: `Claude-Research` goes to research, and `Claude` and `Claude-3p` go to main.
- R26. The low-usage hint suggests any other usable account with more room, in any room, instead of only the research account and only for monorepo departments.
- R27. With one account, no config file and no MWS repositories, nothing in the UI mentions research, the gym, the monorepo or MWS. That includes the label suggestions when adding an account.

### Step 2: Construction and generated looks

Step 2 starts with a generation test on about five real repos, including an MWS repo and a few that use the same stack. It checks that looks pass R13 and how long they take, before the rest gets planned in detail.

**Generated looks**
- R10. Any room without a hand-built look gets a look that Claude generates once, then stores so it survives restarts. That covers every built room plus any config room that doesn't name a look. The input is the folder name, the README, the manifest files and the top-level file list. The office reads these itself, with a size cap on each, and sends them in one request with no tools, no settings and no working directory.
- R11. The generator returns a description of the room, made of shapes, colours, positions and short labels. The office validates it and draws it. The generator never returns code that the office runs.
- R12. The generator follows written style guidelines, the same for every room:
  - Matches `docs/reference.png`: chunky, rounded, low-poly, matte, soft daylight colours. No glossy or see-through materials.
  - Themed on what the project is about, taken from its name and README, before its tech stack. Signature pieces don't repeat those of rooms already standing.
  - Scaled to the characters and desks, with a size budget per prop and a total budget per room.
  - Props sit only in the room's decoration zones (walls, corners, one signature spot). They never go on desks, chairs, walkways, the entrance gap or the sign.
  - One signature piece for a room with one or two agents, plus extra props for bigger size tiers, following the tier rules in R3 of the original requirements.
  - No real logos, crests, brand names or people. Labels are short.
  - Props are placed as offsets from a room edge, not as fractions of its width, so they stay in place as the room grows, shrinks and stretches to fill its row.
- R30. MWS repositories other than the monorepo get generated looks in the MWS theme: match-worn football shirts, auctions, pitches and kit rooms. The rule from R3 of the original requirements still applies: no real club crests or MWS logos.
- R13. The office checks every generated look against the guidelines it can measure: clearance from desks, chairs, walkways, the entrance gap and the sign; zones; budgets; materials; colours; and label length and characters. It runs the check at every size tier, at the tier's narrowest width and when stretched. If a look fails, the office asks once more and passes the failures along. If the second look also fails, or generation errors or times out, the room keeps the plain look (R31).
- R14. Generation runs on the account of the chat that caused the build, if that account is known and can take requests. Otherwise it runs on the default usable account. If no account is usable, the room keeps the plain look. Only one room generates at a time. Rooms waiting their turn stay under construction.
- R15. Every room eligible for a generated look has a Redecorate action on its sign, shown when you're zoomed into the room. That includes rooms still showing the plain look, where Redecorate works as a retry. It asks first, then generates a new look and replays the construction around the room. Seated agents stay at their desks and keep working throughout. If the new look fails, the room keeps its previous look.
- R16. A setting in Settings turns generated looks off. It only affects rooms built after it changes, and existing looks stay. With it off, new rooms keep the plain look and nothing gets sent to generate one.

**Construction**
- R17. Building a room plays a construction scene where the room will stand: a taped-out footprint, scaffolding, and small workers in hard hats. When the look is ready, the props appear piece by piece and the scaffolding comes down.
- R18. Construction lasts until the look is ready or a minimum watchable length has passed, whichever comes later. That can take up to a minute. It is never skipped. It plays again for Redecorate, and never when a folded room comes back. The host tracks each build. A window that connects mid-build shows the rest of the scene, and a room that finished while no window was showing opens as built.
- R19. Workers are decoration. They can't be clicked, they don't show up in counts, the inbox or the tally, and they don't look like chat characters.
- R20. The chat that caused the build starts working straight away. Its character waits at the site and walks to its desk when the room opens. If it needs you, it joins the door queue as usual. Other chats that belong to the room wait at the site too.
- R21. While a room is being built, its sign reads "Under construction" and shows its live counts.
- R22. A new room counts as an added desk for re-layout, so the existing re-pack and camera rules apply. A site under construction moves with the floor when it re-packs, the way rooms do today.
- R23. Demo mode shows at least one room being built.

## Success Criteria

- Step 1: On a fresh install with three unconfigured repos, each repo gets its own room without any setup.
- Step 1: An MWS colleague with no config file sees Marketplace, Admin, Mobile and Backend / infra for the monorepo, wherever their clone lives.
- Step 1: Aaron's office looks the same and places chats the same after the upgrade.
- Step 2: The same three repos get looks that differ from each other and fit the office style.
- Step 2: No generated look ever covers a desk, chair, walkway, entrance gap or sign. The office's own check catches it before anything is drawn.
- Step 2: A README written to attack the generator can't make the office run anything, and can't reach anything beyond the look of that one room.
- The floor keeps the frame rate the existing fps probe expects, and signs stay readable from the overview, with 10 rooms visible.

## Scope Boundaries

- A settings screen for editing rooms. The config file covers this until someone asks.
- Prebuilt releases, a neutral app ID and signing for people outside MWS. This is a separate follow-up.
- Per-prop animation in generated looks.
- Generated looks for the playground, your office, the Lounge, the entrance or the PR reviews room.
- Replacing the hand-built MWS rooms with generated ones.

## Key Decisions

- Two steps. Step 1 fixes the problem for everyone with little risk. Step 2 is the delight layer, and it only reaches people whose repos get built rooms.
- MWS repos are recognised, not configured. That way colleagues get the MWS office without writing a config file.
- Claude designs the props, rather than picking from a fixed set of rooms or a kit of parts. Aaron chose this for variety. Strict guidelines plus the office's own check keep rooms on-style (R12, R13).
- Looks are data, not code: the renderer can approve permission requests, and READMEs are untrusted input.
- One room per repository by default. The config file splits a repository, pins a room to an account, or sends folders to the playground.
- Construction is there because it's fun to watch. It also covers the wait for generation, which can take up to a minute.

## Dependencies / Assumptions

- The audience is MWS colleagues and developers outside MWS.
- Sending a repo's README and manifests to the API is acceptable, because the agent working in that repo reads them anyway. Anyone who disagrees can turn generation off (R16). Anyone who wants to keep one repo private can send it to the playground or give it a config room with a hand-built look.
- `~/.config/agent-office/departments.json` already exists as a list of path-to-department rules, though Aaron's machine doesn't have one. The new format replaces the list.

## Outstanding Questions

### Deferred to Planning
- [Affects R10, R14][Needs research] Which model gives on-style geometry at an acceptable cost and speed? The step 2 generation test answers this. Also confirm the model works with setup tokens through the direct API path, which has only been tested with Haiku.
- [Affects R11, R12][Technical] What description format is expressive enough for good props and small enough to validate? Can the hand-built rooms be expressed in it and serve as examples in the guidelines?
- [Affects R13, R18][Technical] What timeout applies before falling back, and what's the minimum construction length?
- [Affects R4, success criteria][Technical] The row-packing search grows exponentially with the number of visible rooms. How does it stay fast, and what happens past 10 visible rooms?
- [Affects R5, R7][Technical] How do stored department ids (`mkt`, `adm`, …) in `office.db` map to rooms after the upgrade?
- [Affects R7][Technical] How is Aaron's config in place before his first chat after the upgrade? Without it, his side projects would get built rooms. One option is to write it from today's defaults when `office.db` still holds the old department ids.
- [Affects R28][Technical] How strictly should "mention MWS" match, so a name like `mws-gate` counts and an unrelated word containing those letters doesn't?
- [Affects R5, R8][Technical] Do config edits apply live, or at the next host start?
- [Affects R6, R26][Technical] How do the account badge and the default account work once the `isResearch` check is gone?
- [Affects R17, R19][Technical] Can the workers reuse the character model with a hard hat and a different body colour scheme, or do they need their own model?

## Next Steps

-> `/ce:plan` for structured implementation planning, starting with step 1
