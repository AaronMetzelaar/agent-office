---
date: 2026-09-25
topic: livelier-lounge
---

# Livelier Lounge

## Problem Frame

The Lounge (R5 in `docs/brainstorms/2026-09-23-agent-office-requirements.md`) is where done and idle chats rest. Right now every occupant sits in the same grey armchair on a strict grid, facing the same way and holding the same pose, on a plain rug with a coffee corner. It reads as a waiting room, not a lounge, and it is the dullest part of the office. Most chats spend most of their life resting there.

This change gives the room mixed seating and decor and gives resting agents something quiet to do. It keeps the existing seating rules: one armchair per occupant, no overlap, grow by one chair when full, and walk only when your own spot changes. It also keeps the parent rule that "needs you" is always the loudest thing in the office.

## Requirements

**Seating**
- R1. Each seat is one of four single-seat types: a classic armchair, a beanbag, an egg or tub chair, and a pouf with a backrest. Each type comes in a fixed set of fabric colours that fit the office palette. The lists are closed: they are a fixed table, not a configurable catalog.
- R2. A seat's type, colour and small turn (a few degrees) come from the occupant's chat. An agent keeps the same-looking chair wherever it sits, across re-packs and relaunches.
- R3. Every seat type keeps the occupant legible from the overview camera. Neither the seat nor a held prop hides the agent or its tag.

**Decor**
- R4. The room gets clutter between and around the seats: potted plants, a floor lamp with a warm glow, a low bookshelf, side tables with small objects (a mug, a book stack, a plant). The coffee corner stays.
- R5. The rug gets a warmer, patterned look instead of flat pale grey.
- R6. The seat grid spreads out so side tables and plants fit between seats. The Lounge gets bigger to match, and the office layout adapts through the existing packing.
- R7. Decor scales with the room. A one-seat Lounge still looks furnished, and a large one has decor inside the grid, not only at its edges. When the Lounge grows or re-packs, decor moves with the seats it sits beside and isn't reshuffled.
- R8. Walking agents route around decor, and decor never blocks the path to or from a seat.

**Seated activities**
- R9. A resting agent that isn't parked cycles through quiet, eyes-open seated activities: reading a book, sipping from a mug, looking at a phone, and gazing up or out the window. Where it helps, an activity shows a small, muted prop in hand, but it reads from body pose alone at overview zoom.
- R10. Motion stays slow and small. No Lounge motion is as noticeable as the door queue's "needs you" signal at overview zoom.
- R11. An agent holds an activity for tens of seconds before switching. Agents run out of phase with each other, so the room never changes all at once.
- R12. Parked agents keep dozing (eyes closed, dimmed, no cycling). Closed eyes belong only to parked agents. Each parked agent takes one of a few dozing postures based on its chat, so sleepers aren't identical.
- R13. Activities never move an agent off its seat. Walking still happens only when its spot changes. A prop disappears when its agent parks or starts walking.

## Success Criteria
- At the overview zoom, the Lounge no longer reads as rows of identical chairs.
- With five or more occupants, the room usually shows at least three seat types, and awake agents show at least two different activities.
- The Lounge never draws the eye away from a "needs you" agent in the door queue.
- Frame rate at the overview with a full Lounge stays in line with today's (parent R1: "the office must feel fast"), and growing the Lounge by one seat doesn't cause a visible hitch.
- An agent's chair looks the same before and after a re-pack or relaunch.

## Scope Boundaries
- No change to seat assignment, growth or re-pack rules, and no seating pods or conversation circles.
- No idle walking: no coffee runs and no stretching breaks.
- No agent-to-agent interaction (turning to chat, speech puffs).
- Activities are cosmetic. They carry no chat state beyond the existing parked-dozes rule.
- Multi-seat furniture (sofas) is out, because it breaks one seat per occupant.

## Key Decisions
- Kept the grid logic and changed what sits on it. Only the spacing grows. This is the biggest visual gain without touching the seating rules that re-pack and animation depend on.
- Looks follow the chat, not the seat number. Re-pack renumbers seats and relaunch reseats everyone, so keying on the seat number would reshuffle looks. Keying on the chat keeps an agent's chair stable, and variety becomes probable rather than guaranteed.
- The grid is widened for decor rather than keeping decor to the edges, because the interior of a large Lounge would otherwise stay bare. The cost is a bigger Lounge footprint and office layout shifts.
- Quiet, eyes-open activities only, so the Lounge stays background and closed eyes still mean "parked".
- Everything ships in one change.

## Alternatives Considered
- Seating pods of four around coffee tables: the strongest "lounge" read, but it breaks grow-by-one and leaves up to three empty chairs. Revisit if the room still feels regimented after this ships.
- Full idle behaviour (coffee runs, stretching, pairs chatting): more life, but it needs new movement rules and would compete with the door queue. Deferred.
- Looks keyed to grid position with a fixed pattern: guarantees variety, but an agent's chair changes look after a re-pack.
- Two phases (colour and decor first, then seat types and activities): rejected, and everything ships at once.

## Outstanding Questions

### Deferred to Planning
- [Affects R3][Technical] Does each seat type need its own seated height? Today the lounge pose uses one fixed height with no seat context.
- [Affects R6, R7][Technical] How much wider does the spacing need to be, and how does decor get placed inside the grid so it follows its neighbouring seats through re-packs?
- [Affects R8][Technical] Lounge seats and decor register no walk blockers today, apart from the coffee corner. Decor blockers need to move with the room and be cleared whenever the seats are rebuilt.
- [Affects R9, R12][Technical] Are the new activity and dozing poses variations of the existing lounge and sleep poses, or new joint sets? The rig has no hand bone, so props attach to the arm.
- [Affects R9][Technical] The existing chair holds a mug on the armrest. Is it hidden while the agent holds the mug, and what happens on seat types without an armrest?
- [Affects R11][Technical] Reuse the per-character animation phase for activity timing instead of adding new state.
- [Affects Success Criteria][Needs research] What do the extra seat types, colours and decor cost with a large Lounge (20+ seats), and how long does rebuilding the seats take when the Lounge grows by one?

## Next Steps
-> /ce:plan for structured implementation planning
