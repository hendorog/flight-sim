# Foundation: one continuous stream network (every gully a stream), and hedges only on the plains

Branch exp/foundation-streams, worktree ~/github/fs-exp/foundation-streams, from exp/foundation3 95cb0f7 (stages 1,
2, 4, 3 and fixes). Nothing merges. Don't touch other worktrees (the owner flies 5202/5203; never 5177/5178).

## Owner's words (2026-11-08, after flying stage 3)
"Every large valley should have a stream fed from smaller streams, one for each gully. The catchment size should
dictate the width of the stream bed, and amount of water in it. Streams can be any size within reason. Trimmed hedges
only happen on the plains."
Earlier principle: "Following any tiny stream down will lead to bigger and bigger streams, rivers and eventually the sea."

## Read first
- out/f3/REPORT.md, out/f4/REPORT.md, out/f4s/REPORT.md (hillslopes.ts: channels routed on the 250 m grid first,
  ground built from their floors; streams.ts then traces that ground; 79-89 % of stream samples on pass channels).
- src/world/terrain/{streams.ts, rills.ts, rillShader.ts, riverNetwork.ts, hillslopes.ts, water.ts} and how each
  water kind is drawn (ribbons / texture / shader) and where the kind thresholds are (STREAM_AREA 35,
  HEAD_START_AREA 6, RILL_WET_AREA 0.12, RIVER_AREA 45 km2, HEAD_TAPER, feedHeads).
- Earlier open items this should close: feeders don't reach the ridges; rills weak from the air; dry carved valleys
  above trimmed river junctions; unfed dry river heads (23 / 17 / 15).

## Task A: one network, sized by catchment
1. Every channel the stage-4 pass cuts (each gully / V valley) carries visible water from its head (a gully-scale
   start area, ~0.05-0.3 km2, your choice with numbers) down to its junction, and every junction is a join of the
   two waters (no gaps, no dry carved valleys under a wet one, no stream ending mid-slope except in a lake or a
   genuine sink). Valley floors with a channel: always a stream in them.
2. Size is continuous in catchment A from the smallest head to the biggest river: bed width, water width, depth/
   flow (and therefore the whitewater/regime look) as functions of A (and slope where the regime needs it), not of a
   kind (rill/stream/river). Hand-offs between the drawing methods must be invisible: equal width and colour at the
   switch. Use hydraulic geometry with a stated law (e.g. bankfull width ~ a A^b with b ~0.4-0.5) calibrated on
   ~/github/fs/out/landforms/validation.md "Rivers" (braided belt ~121 A^0.34 m where braiding applies; single-thread
   widths) - read-only, another session owns it. Report the width-vs-A curve you ship next to the NZ numbers.
3. Streams follow the ground the slopes were built from (hillslopes channels), so they sit in the V floors.
4. Gates (seeds 1 / 42 / 777777): share of stage-4 channels >= the start area that carry drawn water (aim >= 95 %);
   streams reaching a larger water or a lake or the sea (aim >= 95 %); unfed dry river heads -> ~0; water over
   ground and river-over-dry-bank not worse than f3; riverZero, steps, lakes, homeCheck, edge steps not worse;
   seed-42 box slope/relief/b/pits gates still pass (out/f3/validate.sh).
5. Cost: drawn stream count will rise a lot. Measure frame time at cockpit height in a mountain valley and at
   1500 m over a massif (before/after, same views), plus world build and cache size. Keep the GPU cost acceptable
   (state the numbers; if a method can't scale, change method, e.g. texture/shader for the smallest sizes).

## Task B: clipped (trimmed) hedges only on the plains
- Clipped hedge walls (placement.ts walls / TreeCellData.walls) and painted hedges belong to plains farmland only,
  not to farmland in mountain or hill valleys (they show in out/f4s/shots/s42-valley1-f4s.png, f3 strike40). Use the
  layout's relief classes (plain vs hill/mountain) or an equivalent ground measure; outside the plains, field edges
  get unclipped hedgerow trees/shrubs or fences instead.
- Poplar belts: main has fixed them (main b687e8b: `const clipped = species !== SPECIES.poplar && age >= 0.4;` in
  placement.ts) - poplar belts are rows of trees, never walls. Do NOT re-pin presentGuard on this branch: apply the
  poplar rule to seeded worlds only (seed 0 keeps its current code path; main's fix reaches seed 0 when the branches
  are eventually merged). Do not merge main.
- Seed 0: report whether seed 0 has clipped hedges off its plains (count/locations). Do not change seed 0; the owner
  decides later (it would need a presentGuard re-pin on main).

## Constraints
- Seed 0 byte-identical; tests/era/presentGuard.test.ts passes without any re-pin.
- Seed 7 boards may re-bake (seed 0 entry byte-equal). Full suite: npx vitest run --no-file-parallelism tests/terrain
  tests/world tests/era tests/career (career "200 boards" re-run with --testTimeout=120000 before calling it failed).
- Port 5204 for your server; stop it at the end. Commits on exp/foundation-streams, messages end
  "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>". No merge, no push. Shell heredocs if Write is refused.

## Pictures
Cockpit-height (300-600 m) and 1500 m views in mountain valleys on seeds 42 and 777777 showing gullies feeding a
valley stream feeding a river (f3 vs fs), a close view of a junction, the size progression along one path from a
gully head to the sea (4-6 shots), and a valley farm without clipped hedges. Each with a fly-to URL
(index.html?seed=..&camPos=..&camLook=..&scenario=runway&tod=10&wx=clear). Shot tool:
V2_ROOT=<tree> node ~/github/fs-exp/streams3/out/verify3/shot.mjs "<url>&ui=0&cover=0&clock=0" out.png --wait 7000 --timeout 180000

## Deliverable
out/fs/REPORT.md: short version first (what the owner will see), owner decisions, gates f3 -> fs, width law, cost,
paths. Hand back concisely: owner decisions first, then gates, then paths.
