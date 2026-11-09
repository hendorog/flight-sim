# Foundation streams: one stream network sized by catchment, clipped hedges on the plains only

Branch `exp/foundation-streams` (from `exp/foundation3` `95cb0f7`), worktree `~/github/fs-exp/foundation-streams`.
Nothing merged or pushed. "f3" below is `95cb0f7`; a copy is in `out/fs/base` for the before pictures and costs.

| commit | what |
|---|---|
| `0beb7ab` | gully chains (`gullies.ts`), chain streams, one width law, painted streams up to the hand-off, hedges |
| `65cba3d` | floor crossings only to water at the floor's height; rills wet earlier and spill wider pits; narrow ribbons near the viewer only |
| `172a1ef` | chain streams graded down the threshold slopes to their receivers (no hanging falls); canopy opened from 0.6 m of water |
| `3bd9a59` | painted streams turn to a pale stony bed toward the hand-off |
| `c04873b` .. `1ac7bce` | hand-off at 10 km² instead of 5 (world build time, decision 1); cheaper chain tracing; ground kept right near river carves |
| (last) | report, scripts, probes |

## Short version (what the owner will see)

- **Every V the stage-4 pass cut now carries water, from a gully head of 0.06-0.25 km² down to the sea.**
  - **Measured.** In 30 rill patches per seed, 97.8 / 94.9 / 97.7 % of the cut V's of 0.25 km² or more (seeds
    1 / 42 / 777777) have drawn water within half a node (125 m).
  - **Painted below 10 km².** Gullies under 10 km² are painted by the ground shader. These are the rills, now sized by
    the true catchment and drawn out to 4.9 km.
  - **Traced from 10 km².** From 10 km² a gully is a traced stream: a ribbon with a carved channel, falls and
    whitewater. It follows the pass's own channel down to the next stream, river, lake or the sea.
  - **More streams.** Traced streams went from 711-748 per seed (1.8-1.9 thousand km) to 1343-1430 (5.1-5.5 thousand
    km). About 1030-1130 of them are new gully-chain streams, 4.4-4.9 thousand km.
- **Size is one law of catchment.**
  - **The law.** Bed W = 2.59 A^0.45 m. The water fills 45 % of the bed at 0.1 km², rising to all of it at 45 km².
  - **Continuity with the rivers.** Above 45 km² the rivers keep their own law. This one meets it there (14.4 m) and
    stays within 5 % of it up to 3000 km².
  - **Hand-off.** The painted and the traced streams read the same functions, so the water is the same width at the
    hand-off (6.3 m at 10 km²).
  - **Before.** f3 painted a 2 km² rill 5.2 m wide and started a 6 km² stream 2.3 m wide.
- **Side streams cross a valley's floor to its river.** Before, a chain coming out of its V ran down beside the river
  as a parallel line. Now it crosses to the water already there: about 500-580 crossings per seed.
- **No clipped hedges off the plains in seeded worlds.**
  - **Plains:** under 150 m of relief over 5 km. Off them, a shelterbelt grows out as a row of trees.
  - **Poplar belts** are always rows of trees, never walls.
  - **Seed 0 is unchanged**, and has many clipped walls off its plains (decision 8).
- **Gates.** Against f3:
  - **Better:** river over a dry bank, steps over 100 m (now 0 on every seed), water over ground on seeds 42 and
    777777 (+3 on seed 1).
  - **Same:** riverZero, lakes, homeCheck, edges.
  - **Within noise:** steps over 50 m, +1 on seeds 1 and 42.
  - **Short of the aims:** traced streams reaching water on seed 42 (94.5 %), painted wet lines reaching the network
    (91 %), unfed river heads (15 / 19 / 12).
  - **One suite test over its time budget** (decision 1): `landmarks` determinism, 5.2 s against its 5.0 s limit. f3
    ran it in 4.90 s.
- **Cost.**
  - **Frame time:** +0.1-0.4 ms per frame (GPU p50 +0.3-0.5 ms in a mountain valley at cockpit height, +0.15-0.2 ms at 1500 m) on this Radeon 8060S at 1600×900; GPU memory +5 MB ribbons always drawn, +20 MB painted-stream textures.
  - **World build:** +0.25-0.3 s per seeded world per thread (3.33-3.40 → 3.61-3.66 s for seed 42 in node).
  - **Model cache:** +1.6 MB.

## Owner decisions

1. **Hand-off area against world-build time.**
   - **At 5 km².** Gullies were traced as streams from 5 km² first: 2.1-2.4 thousand chain streams, 8-8.7 thousand km.
     That cost +0.5 s of world build per thread, and four seed-42 / seed-7 tests went over their 5 s limits.
   - **At 10 km² (shipped).** +0.25-0.3 s, and only `tests/career/landmarks.test.ts` "determinism" stays over: 5.2 s
     against 5.0 s. It builds seed 0, seed 7 and seed 0 again, and f3 ran it in 4.90 s, at 98 % of its budget.
   - **At 20 km².** It passes at 4.96-5.00 s: a pass by noise.
   - **Your call:**
     - (a) give that test the longer timeout the brief allows "200 boards" (it passes functionally: 41 / 41 with `--testTimeout=120000`);
     - (b) hand off at 20 km², losing the 10-20 km² ribbons;
     - (c) speed the seeded build up elsewhere.
2. **Small gully streams are true to size, and so hard to see in forest from the air.**
   - **Widths.** Gullies are wet from 0.06 km². The water is 0.7 m wide at 0.25 km², 1.7 m at 1 km², 4.3 m at 5 km²
     and 6.3 m at 10 km².
   - **From the air.** From 300-600 m above ground, beyond about 1.5 km, a stream under about 2 m wide is a pixel or
     less. Under the forest canopy it is a faint line.
   - **Examples.** `s777777-junction2`: the walls' gullies hardly show; the valley's streams and river do.
     `s42-path-A1.5`: a thin dark line down a forested V.
   - **Your call.** Your words were "Streams can be any size within reason". If that means "big enough to see from
     the air", a visibility floor is a shader change: draw the bed and its damp margin at least about a pixel wide, and
     open the canopy over every wet gully. As now (true widths), or widened for the air?
3. **Canopy and trees.**
   - **Canopy.** A painted stream opens the forest canopy from 0.6 m of water (about 0.15 km²), fully from 2 m (about
     1.2 km²).
   - **Trees** are kept off a chain's bed from 1.5 km², where the pass's channel floor is the chain itself.
   - Smaller ones run under the trees. The thresholds are `rillShader.ts RILL_OPEN` and `placement.ts GULLY_TREE_AREA`.
4. **How far small streams are drawn.**
   - **Painted** streams (under 10 km²) are drawn to 4.9 km. They were 2.95 km; 36 patches are held now, against 16.
   - **Traced streams under 4 m half-width** (10-15 km²) are built and drawn within 9 km of the viewer only.
   - Beyond those distances such streams are not drawn. They are at most 1-2 pixels wide there.
5. **The hand-off from painted to traced still shows close up.**
   - **Picture.** `s42-handoff` sits at the 10 km² point; `s42-handoff-A5` is the same kind of view at the old 5 km²
     hand-off.
   - **What matches.** The water is the same width on both sides.
   - **What does not.** The traced stream's carved notch and gravel banks read wider and paler than the painted bed,
     from about 300-500 m off. The painted bed now turns pale and stony from 2 to 8 km², which softens it.
   - **Follow-up:** draw the traced stream's banks from the same bed law, or taper its carve in at its head.
6. **Streams follow the pass's 250 m raster, so some are dead straight.**
   - **Where.** On broad valley floors and in the pass's diagonal channels, the stage-4 routing runs straight along the
     lattice axes and diagonals. In the stage-4 hillshade those floors show a checkerboard
     (`out/fs/shots/map-777777-valley1-f3.png`).
   - **What it looks like.** The chain streams make this visible: straight lines with right-angle bends seen from
     1500 m (`s777777-junction2-hi`), and a straight canal-like reach down the floor in `s42-path-A20`.
   - **Why not fixed here.** The water is where the ground's floor is, so smoothing it would put it on the walls.
   - **Follow-up:** a finer or meandering floor routing in the pass.
7. **Perched rivers (found here, from stages 3/4).**
   - **What.** On some valley floors the held river stands up to about 80 m over the floor beside it. Seed 42 at
     -12000,-41933: the river at 782 m, the floor at 700-760 m either side.
   - **What the streams do.** The floor's own streams run beside the river and join it downstream, or where it is low
     enough. They are never backed up over the ground.
   - This is the "river over a dry bank" class: stage 4's held river cores against the pass's floors.
8. **Seed 0's clipped hedges: most are off its plains.**
   - **Counts** (1 tree cell in 9 over ±40 km about the home field, the same 150 m / 5 km relief rule): 20.9 km of
     wall on plains, 99.1 km in hill country, 3.5 km in mountains. Roughly 190 km against 920 km in all.
   - **Seed 0 is unchanged.** The plains rule and main's poplar fix would turn those walls into tree instances, so
     tests/era/presentGuard.test.ts would need a re-pin on main.
   - **Seeded worlds after the change:**
     - seed 42: 3.0 km of wall, all on the plains but 0.35 km at the edge of the census's relief measure;
     - seed 777777: 0.03 km.
   - **Not measured:** the walls f3 had in those worlds.
9. **Painted hedge bands stay off the plains.**
   - **Why kept.** The shader's hedge band carries the hedgerow trees placement.ts plants on it, so off the plains a
     field edge is a hedgerow of trees and shrubs, not a wall. The brief allowed "unclipped hedgerow trees/shrubs or
     fences" there.
   - **What removing them would take.** A relief class per tile vertex, which changes seed 0's tile data
     (presentGuard). Your call.
10. **Big rivers' water is drawn at bankfull width.** The rivers' law is unchanged, and this round's law meets it.
    - **Against NZ.** That is about 3× the NZ low-flow wet widths in validation.md: 15-31 m at 1800-5700 km², where the
      sim has 75-90 m.
    - Narrowing them would re-lay every river and move every river gate.

## What changed

- **`hillslopes.ts`.**
  - The pass hands on its own last routing (`SlopeField.dir`, 1 byte per node, cached with the slopes) and its
    catchment (`area`, not cached).
  - `MODEL_VERSION` ss4 → ss5.
- **`gullies.ts` (new).**
  - The chains: each node's catchment down the pass's routing (from the pass, or summed again from `dir` for a cached
    field; sums of 0.0625 km² are exact in any order).
  - `gullyNear`: the nearest chain segment of at least a given catchment.
- **`streams.ts`.**
  - **The width law:** `bedWidth`, `waterShare`, `channelHalfWidth`. Below 45 km² it replaces the old A^0.9.
  - **Chain streams.**
    - A chain is traced as a stream from where its catchment reaches 10 km² (`gullies.ts CHAIN_AREA`). The longest
      chains go first, so a valley's trunk is one line.
    - The stream follows its chain to the first line, lake or sea, with the chain's own catchment along it.
    - Where the pass ends, the usual trace goes on.
    - Lattice heads in the mountains are left to the chains.
  - **Floors.**
    - On a river's held floor, or out of the V's (the pass's ground a node either side under 15 m over it), a chain
      crosses to the nearest water (`crossTo`). The conditions:
      - that water lies at most 20 m under the chain's ground;
      - the way there never rises over the chain's ground;
      - the water's back-up never stands more than 4 m over the ground.
    - Beside a chain stream on a level floor, a chain joins it (`besideChain`).
  - **A trunk lowered.** A chain stream reaching a chain stream whose water stands up to 40 m over its own lowers that
    water from the junction (`CHAIN_LOWER`). This took 188 chain → stream sinks to 0.
  - **The ground between a chain's raster points** is taken as interpolated between them, where the routing ground
    there is the pass's own. Near a river's carved valley it is looked at as for any stream.
- **`riverNetwork.ts`, `falls.ts`.** A chain stream has no hanging-valley fall. Its last reach comes down to its
  receiver at up to 0.75 m/m (the threshold slopes) instead of 0.3. The old rule cut a slot up to 135 m deep back up a
  tributary of a deep trunk: seed 777777 had 3 steps over 100 m with it, and 0 without.
- **`rills.ts`, `rillShader.ts`.**
  - **Sizing.** A rill is sized by its catchment through the hand-off (size code 0.03-16 km², log). Where its
    catchment reaches beyond its window it takes the chain's catchment within 90 m (global data: window-independent).
  - **Widths and water.**
    - Bed and water widths come from the width law (the shader's twin of `streams.ts`).
    - Water starts at 0.06 km² (was 0.12).
    - Pits spill within 10 cells (was 6).
  - **Look.** The canopy opens and fields are crossed from 0.6 m of water. The bed turns pale and stony from 2 to 8 km².
  - **Range.** 6×6 patches, fading at 4.2-4.9 km (was 4×4, 2.3-2.95 km).
- **`water.ts`, `TerrainSystem.ts`.**
  - A stream ribbon's rows are thinned where its neighbours' rows draw it (within 0.25 m of level and 0.2 half-widths
    across).
  - Stream pieces under 4 m half-width go in chunks that are built within 9 km of the viewer and dropped past 11 km.
- **`vegetation/placement.ts`.**
  - No tree on a chain's bed from 1.5 km².
  - Seeded worlds only:
    - poplar belts are never clipped;
    - a belt is clipped on the plains only (`onPlains`: relief over 5 km under 150 m, from the drainage lattice);
    - off the plains a belt grows out to its untrimmed height.

## Gates (seeds 1 / 42 / 777777; f3 → fs)

Logs:
- fs: `out/fs/final3`, on code `1ac7bce`. It holds the f3 battery `gates.sh`, plus `gullyGate.log`, `gullyNet.log`,
  `suite.log`, and `hedgeWalls.log` (copied from `out/fs/final`; the hedge code is unchanged since).
- f3: `~/github/fs-exp/foundation3/out/f3/final`.

| gate | f3 | fs | aim | |
|---|---|---|---|---|
| **cut V's ≥ 0.25 km² with water in their cell** (gullyGate, 30 patches a seed) | traced water only: 6.5 % of chain nodes ≥ 0.25 km² within 150 m (seed 42; steepest descent on the pass's ground: f3 has no routing of its own) | **97.8 / 94.9 / 97.7 %**; by band 0.25-1 / 1-5 / 5-20 / > 20 km²: 93-98 / 90-100 / 95-99 / 100 % | ≥ 95 % | pass on 1 and 777777; seed 42 0.1 short |
| **traced streams reaching water** (channel, lake, sea) | 686 / 705 / 683 of 711 / 748 / 722: 96.5 / 94.3 / 94.6 % | **95.6 / 94.5 / 95.1 %** of 1343 / 1380 / 1430 | ≥ 95 % | 1 and 777777 pass; 42 0.5 short (f3 was 94.3) |
| **painted wet lines reaching the network** | n/a | 91.5 / 91.2 / 90.9 %; the rest end in hollows of the detail ground, 2-9 m deep | ≥ 95 % | short |
| **unfed river heads; dry heads with no feeder** | 19 / 20 / 15; 13 / 12 / 12 | **15 / 19 / 12; 10 / 13 / 10** | → 0 | better, not 0 (those heads lie outside the pass, with no chains) |
| water over ground > 10 m (points checked) | 4 / 69 / 35 (118k / 111k / 124k) | **7 / 55 / 20** (163k / 153k / 173k) | not worse | pass but seed 1 +3 |
| river over a dry bank > 10 m; worst | 1692 / 1824 / 1605; 123.8 / 67.5 / 111.7 m | **1181 / 1459 / 1018; 123.8 / 73.9 / 45.9 m** | not worse | pass but seed 42's worst +6 m |
| riverZero km (lines) | 0.2 / 2.2 / 0.0 | **0.2 / 2.2 / 0.0** (same lines) | not worse | pass |
| steps > 50 m; > 100 m; worst | 38 / 13 / 43; 0 / 0 / 1; 66 / 82 / 110 m | **39 / 14 / 42; 0 / 0 / 0; 66 / 82 / 88 m** | not worse | within noise (f3's noise floor: 14 / 10 / 60) |
| lakes | 71 / 74 / 61 | **71 / 74 / 61** | ±15 % | pass |
| homeCheck (8 seeds) | ok | **ok**, identical | ok | pass |
| NaN; edge steps | 0; 76.0 / 78.4 / 68.1 m | **0; 76.0 / 78.4 / 68.1 m** | not worse | pass |
| **seed-42 box**: slope p50 / peak / 1 km relief / b / pits | 30.9° / 35-37.5 / 594 m / 1.24 / 1.92 | **31.0° / 35-37.5 / 594 m / 1.18 / 1.86** | ≥ 25 / 30-40 / 400-650 / ≤ 1.3 / ≤ 2 | pass |
| seed 1 box; seed 777777 box (same) | 29.4 / 576 / 1.22 / 2.97; 30.3 / 591 / 1.27 / 1.86 | 29.4 / 577 / 1.16 / 3.08; 30.3 / 592 / 1.17 / 1.89 | report | |
| seed 0; presentGuard | | nothing new runs at seed 0; presentGuard passes, not re-pinned | | pass |
| **suite** | 744 / 745 (200 boards on time) | 743 / 745 (`final3/suite.log`); the two failures are time budgets, "200 boards at seed 7" (6.9 s against 5 s, as f3 under load) and landmarks "determinism" (5.24 s against 5.0 s); both files pass with `--testTimeout=120000`: 41 / 41 (`final3/suite-longtimeout.log`) | all pass | 200 boards as the brief allows; landmarks over its time budget (decision 1) |

Notes:
- **The gully gate counts only cut V's:** chain nodes where the pass's ground on both sides across the flow stands
  10 m or more over the node, 157-259 per seed in the 30 patches. The other 424-512 nodes of 0.25 km² or more are the
  pass's routing down even slopes, where it cut no V; on a 36° plane a raster line passes 0.25 km² after four nodes.
  There the visible gullies are the finer relief's, and the rills follow those.
- **Hollows.** Streams ending in a hollow: 22 / 40 / 37 → 33 / 58 / 52, on about twice the streams.
- **Chain streams sinking into a river that stands higher:** 24 / 15 / 17. These are the perched rivers (decision 7).
- **Coverage of the big chains.** Chain nodes of 10 km² or more within 150 m of traced water: 90.3 / 91.6 / 86.3 %
  (gullyNet). The rest are mostly parallel raster chains on floors, merged into a neighbour.

## Width law

The bed (bankfull channel: the stony or gravel strip) is W = 2.594 A^0.45 m (A in km²) below 45 km². The water is
W × (0.45 + 0.55 × clamp(ln(A/0.1) / ln(450), 0, 1)). From 45 km² both are the rivers' unchanged law, 2 (1.5 + 0.85 √A)
m (at most 90 m); this one meets it at 45 km² and stays within 5 % of it up to 3000 km². The exponent 0.45 is in the
0.4-0.5 of downstream hydraulic geometry; the coefficient is pinned by the rivers' law, so no river moves.

| A km² | bed m | water m | f3 painted water | f3 traced water | NZ (validation.md "Rivers") |
|---|---|---|---|---|---|
| 0.06 | 0.7 | wet from here | 0 | - | |
| 0.25 | 1.4 | 0.7 | 1.4 | - | |
| 1 | 2.6 | 1.7 | 3.4 | - | |
| 2 | 3.5 | 2.6 | 5.2 (its cap) | - | |
| 5 | 5.4 | 4.3 | - | 2.3 (a head's start, 6 km²) | |
| **10 (hand-off)** | 7.3 | 6.3 | - | 3.7 | |
| 20 | 10.0 | 9.3 | - | 6.9 | |
| 45 | 14.4 | 14.4 | - | 14.4 | braid belt 121 A^0.34: 441 m |
| 1000 | 56.8 | 56.8 | - | 56.8 | braid belt 1267 m |
| 1808 | 75 | 75 | - | 75 | Rangitata: wet 25 m, braided bed 1838 m |
| 3526-3593 | 90 | 90 | - | 90 | Oreti wet 28 m, bed 511 m; Waimakariri wet 15 m, bed 1979 m |
| 5661 | 90 | 90 | - | 90 | Mataura wet 31 m, bed 640 m |

- **Small catchments.** validation.md has no single-thread widths under 1800 km² to fit the coefficient to.
- **Big rivers: bankfull, not low flow.** Its single-thread widths are low-flow wet threads from the photo method,
  which it calls unreliable on brown water. At 1800-5700 km² the sim's water is 3× them, and 7-25× narrower than the
  braid beds: the sim draws its big rivers at bankfull, not at low flow (decision 10).

## Cost

| | f3 | fs |
|---|---|---|
| frame, mountain valley at cockpit height (`cost-valley`) | 7.52 / 7.73 ms; GPU p50 5.31 / 5.24 ms | **7.83 / 7.89 ms; GPU 5.65 / 5.72 ms** |
| frame, 1500 m over the seed-42 massif (`cost-massif`) | 6.59 / 6.55 ms; GPU 4.23 / 4.21 ms | **6.93 / 6.97 ms; GPU 4.37 / 4.43 ms** |
| ribbons always drawn (seed 42): vertices, MB, main-thread build | 1.65 M, 79 MB, 360-375 ms | **1.75 M, 84 MB, 400 ms** |
| narrow stream ribbons (built within 9 km only) | - | 338 chunks, 0.19 M vertices / 9 MB if all were built; built near the viewer only |
| painted patches held; texture; patch cost in the worker (mean along a row / cold) | 16; 16 MB; 286 / 460 ms | **36; 36 MB; 291 / 695 ms** |
| world build per thread (node, alone): seed 42 | 3.33 / 3.40 s (streams 0.23 s) | **3.61 / 3.66 s** (streams 0.41 s); seed 7: 3.83 → 3.98 s |
| landmarks "determinism" test (two seed 0 builds and one seed 7) | 4.90 s | 5.21-5.26 s (limit 5.0 s) |
| model cache entry | about 10.8 MB | **+1.6 MB** (`dir`) |
| per-thread memory | | **+6.6 MB** (the chains' catchment) |

- **How it was measured.** Frame time is `shot.mjs --fps --frames 240`: drained throughput, plus GPU timer queries of
  the post pipeline. This machine's Radeon 8060S, 1600×900, port 5204 (`out/fs/fps.sh`; logs `out/fs/logs/fps*.log`).
- **A 5 km² hand-off with every ribbon drawn** cost +0.8-0.9 ms at the massif (4.2 M ribbon vertices). With the
  narrow-ribbon LOD it was +0.3 ms, about half of it the painted streams' wider range.

## Pictures

- **Files.** `out/fs/shots/<view>-fs.png`, and `-f3.png` beside them where there is one.
- **How they were made.** Rendered on port 5204; the server is stopped.
- **Fly-to URLs.** `index.html?<query>&scenario=runway&tod=10&wx=clear`; add `&ui=0&cover=0&clock=0` for a clean frame.
  Every query is in `out/fs/views.txt`.

Before (f3) and after (fs), cockpit height and 1500 m:

- **s42-path-A10** (`-f3`, `-fs`): a forested V valley at about 500 m over its floor.
  - **f3:** dry.
  - **fs:** a stream down the floor with a winding side stream joining from the left, and short side-gully streams on
    the right wall.
  - `seed=42&camPos=-27500,-19000,1681&camLook=-27250,-17500,1177`
- **s42-junction3** (`-f3`, `-fs`): a farmed mountain valley with its river. With the 10 km² hand-off the two look
  almost the same from here: the side streams are painted and too thin to show at this distance.
  - `seed=42&camPos=-43818,33504,967&camLook=-45951,32578,513`
- **s42-junction3-hi** (`-f3`, `-fs`): the same valley from about 1500 m.
  - **fs adds:** a straight side-valley stream into the main valley (right of centre) and a few thin lines on the
    forest.
  - The forested walls' gullies stay all but invisible (decision 2).
  - `seed=42&camPos=-42517,34592,1997&camLook=-45912,33016,497`
- **s777777-junction2** (`-f3`, `-fs`): a forested mountain valley with a stony river. Almost the same in both.
  - The walls' gully streams do not show from here (decision 2).
  - `seed=777777&camPos=18016,-40886,1293&camLook=15555,-41232,964`
- **s777777-junction2-hi** (`-f3`, `-fs`): from about 1500 m.
  - The fs side-valley streams on the right run in straight lines with right-angle bends (decision 6).
  - `seed=777777&camPos=19616,-40246,2451&camLook=16006,-41028,951`

A junction close up (fs):

- **s777777-junction2-close:** a whitewater stream in a forested notch pours into the river. Dark side lines are
  painted streams opening the canopy.
  - `seed=777777&camPos=16479,-41014,1308&camLook=16006,-41028,951`
- **s42-junction2-close:** a stream with whitewater crosses the farmland and joins a river meandering between willows.
  - `seed=42&camPos=94388,136699,707&camLook=93909,136850,257`

The size progression along one path, from a gully head to the sea (seed 42, fs):

- **s42-path-A0.4:** looking up at the gully heads under the tops; a thin dark line down the forested V floor.
  - `seed=42&camPos=-27250,-15000,1687&camLook=-27250,-14000,1703`
- **s42-path-A1.5:** the same line widening down a forested V, with short side lines joining.
  - `seed=42&camPos=-27250,-15500,1738&camLook=-27250,-14500,1451`
- **s42-path-A5:** the painted stream, now with its pale stony bed, straight down the V floor, with short side-gully
  streams joining from both walls.
  - `seed=42&camPos=-27250,-16250,1674&camLook=-27250,-15250,1361`
- **s42-handoff:** the 10 km² switch from 500 m up: one straight line down the V, with side-gully streams joining. No
  break shows at the switch from here.
  - `seed=42&camPos=-27250,-17600,1450&camLook=-27250,-17000,1230`
  - `s42-handoff-A5` is a close view of the old 5 km² switch: there the traced stream's pale banks are wider than the
    painted bed (decision 5).
- **s42-path-A10:** see above.
- **s42-path-A20:** a Y junction of two traced streams in V valleys, running straight down their floors with sharp
  bends (the raster, decision 6). A painted side stream runs down the left wall.
  - `seed=42&camPos=-28823,-20573,1933&camLook=-27750,-19400,1057`
- **s42-path-A200:** a river in a farmed valley with its tributaries.
  - `seed=42&camPos=-36731,-31303,1010&camLook=-37836,-30172,612`
- **s42-path-A2000:** a big river with a second river joining it on a farmed plain.
  - `seed=42&camPos=-33205,-71477,588&camLook=-33085,-68874,153`
- **s42-path-A1000000000:** the mouth.
  - The river reaches the sea across a beach. Its last reach runs along the shore, from the river layout (not
    changed here).
  - `seed=42&camPos=-90990,-96017,450&camLook=-90624,-96553,0`

A valley farm without clipped hedges:

- **s42-valley1** (`-f3`, `-fs`):
  - **f3:** dark rectangular hedge walls on the valley farms.
  - **fs:** no walls; the belts stand as rows of trees. Chain streams come down the left wall and cross the fields to
    the valley's stream.
  - `seed=42&camPos=-10956,-39960,1199&camLook=-12718,-41720,682`
- **s777777-strike40** (`-f3`, `-fs`):
  - **f3:** three long dark clipped walls on the left of the river.
  - **fs:** none; the belts there are rows of trees.
  - `seed=777777&camPos=-11336,62004,715&camLook=-14132,61714,265`

## Left

- Decisions 1-10.
- Painted wet lines ending in hollows of the detail ground (about 9 %). A wider pit spill costs window width; the
  alternative is joining such a hollow to its chain.
- The hand-off's bank colour and width (decision 5).
- Straight raster streams on floors (decision 6).
- Unfed river heads outside the mountains: chains exist only where the pass ran.

## Files

- **Code:** `src/world/terrain/gullies.ts` (new), `streams.ts`, `riverNetwork.ts`, `falls.ts`, `hillslopes.ts`,
  `erosion.ts` (MODEL_VERSION), `macroCache.ts`, `macroWorker.ts`, `heightfield.ts`, `rills.ts`, `rillShader.ts`,
  `RillSystem.ts`, `water.ts`, `TerrainSystem.ts`, `vegetation/placement.ts`.
- **Probes** (`scripts/probes/`):
  - `gullyGate` (the water-in-every-gully gate);
  - `gullyNet` (chains, traced coverage, stream ends, timings);
  - `gullyAt` (chain map and transects);
  - `rillChainMap` (rills over chains, PNG);
  - `fsViews` (views);
  - `hedgeWalls` (clipped walls by relief class);
  - `lineDensity`, `lineAt`, `gullyW`, `hAt`;
  - `waterGeoCost` (with the narrow ribbons);
  - `slopeSetup.ts` (`CHAIN_AREA` env).
- **Scripts** (`out/fs/`): `gates.sh`, `validate.sh`, `final.sh`, `sum.sh`, `shot.sh`, `shots2.sh`, `fps.sh`, `views.txt`.
- **Logs:**
  - `out/fs/final3/` (final battery, gully gates, suite);
  - `out/fs/final/` (the 5 km² hand-off's battery and hedge census);
  - `out/fs/run1/`, `out/fs/try/`, `out/fs/logs/`.
- **Source copy:** `out/fs/base` (f3 `95cb0f7`).

## Fix after hand-back: the valley streams f3 traced keep their courses (`1d3a956`, `42fb077`, last)

**Cause.** The chain streams had taken over the mountains' lattice headwaters. `traceStreams` skipped every lattice head
inside the pass, so streams such as seed 42's line 517 were never traced. Line 517 is the winding 80 km² stream with
wooded banks down s42-valley1's floor. Instead, a straight raster chain stream ran 180 m off its line, beside the floor.

**Fix.**
- **Order.**
  - The outlets, the lattice headwaters and the rivers' head feeders are traced first, exactly as in f3.
  - The gully chains are traced after them, and join them: at their course, beside them on a level floor, or across
    the floor to them.
- **Catchment.** A chain joining a lattice stream raises that stream's catchment to the chain's below the junction. It
  is not added to it, because the lattice catchment holds those slopes already.
- **River heads.** A chain joining a river near its head counts in the river's head trim, as the feeders do.
- **Steep water.** The width law made these restored streams wider at small catchments: half-width 2.9 m against
  1.6 m at 8.6 km². On steep faces their water then stood up to 100 m over the dry ground beside them.
  - A stream's water now narrows to 0.45 of its width as the reach's gradient goes from 0.05 to 0.2, as a step-pool
    cascade's does among its boulders.
  - The narrowing fades out over the last 150 m into the stream's mouth.
  - The painted streams are not narrowed on steep ground.

**Survey** (`out/fs/tools2/moved.py`; dumps from probe `lineDump`). It counts the f3 rivers and streams of 10 km² or
more with 0.5 km or more of their course over 150 m from any fs line:

| | seed 1 | seed 42 | seed 777777 |
|---|---|---|---|
| f3 lines ≥ 10 km² (km) | 990 (6859) | 1019 (6619) | 1019 (7465) |
| before the fix: moved (vanished), km off | 140 (38), 235 km | 140 (37), 209 km | 157 (43), 224 km |
| after: moved (vanished), km off | 1 (0), 0.9 km | 0 | 1 (1), 1.0 km |

Before the fix, the worst five on each seed were all lattice streams of 49-89 km², 4.3-9.9 km off. On seed 42 they
were lines 588 (-37073,-29302), 473, 517 (the s42-valley1 stream), 589 and 457. After the fix two cases are left:
- **seed 1, river 241:** 0.9 km of its head, which a chain now joins further up (at 2796,136772);
- **seed 777777, stream 1140:** 1 km. f3 ran it straight down across a hillside; fs takes its water down the valley
  floor and the wall's gullies (`s777777-survey1140`).

**Gates after the fix** (`out/fs/final6`). With f3's streams back, the f3 numbers come back too: final3's lower counts
came from the streams it had dropped.

| gate | f3 | final3 (hand-back) | now |
|---|---|---|---|
| river over a dry bank > 10 m; worst | 1692 / 1824 / 1605; 123.8 / 67.5 / 111.7 m | 1181 / 1459 / 1018; 123.8 / 73.9 / 45.9 m | 1695 / 1823 / 1613; 123.8 / 70.0 / 111.3 m |
| water over ground > 10 m | 4 / 69 / 35 | 7 / 55 / 20 | 6 / 58 / 35 |
| steps > 50 m; > 100 m | 38 / 13 / 43; 0 / 0 / 1 | 39 / 14 / 42; 0 / 0 / 0 | 38 / 13 / 43; 0 / 0 / 1 (f3's 110 m step at 21500,-144000) |
| unfed river heads; dry heads with no feeder | 19 / 20 / 15; 13 / 12 / 12 | 15 / 19 / 12; 10 / 13 / 10 | 19 / 20 / 16; 10 / 12 / 10 |
| traced streams reaching water | 96.5 / 94.3 / 94.6 % | 95.6 / 94.5 / 95.1 % | 95.9 / 95.0 / 95.1 % (1732 / 1766 / 1841 streams) |
| cut V's ≥ 0.25 km² with water | | 97.8 / 94.9 / 97.7 % | 97.8 / 94.9 / 98.1 % |
| riverZero, lakes, homeCheck, edges, NaN | | | unchanged |
| seed-42 box: slope p50 / 1 km relief / b / pits | 30.9 / 594 / 1.24 / 1.92 | 31.0 / 594 / 1.18 / 1.86 | 31.0 / 594 / 1.20 / 1.83 |
| suite | | 743 / 745 | 743 / 745: the same two time budgets (landmarks 5.40 s); both 41 / 41 at the long timeout |
| world build, seed 42 (node) | 3.33-3.40 s | 3.61-3.66 s | 3.78 s |

**Pictures** (`out/fs/shots/`, `-fs2` against `-f3`):
- **s42-valley1-coord** (the coordinator's view): the winding stream with wooded banks is back down the floor, and
  the left wall's chain streams join it.
  - `seed=42&camPos=-11700,-40700,1000&camLook=-12718,-41720,600`
- **s42-valley1:** the same, from the report's camera.
- **s42-survey588:** the worst case before the fix. It now looks as in f3: a stream along the valley's left side,
  with a stony river.
  - `seed=42&camPos=-38300,-29302,1150&camLook=-37073,-29302,644`
- **s777777-survey1140:** the one case left.
  - `seed=777777&camPos=22500,-31189,1350&camLook=23700,-31189,774`

The pictures were shot on port 5205 because the coordinator's fs server held 5204. 5205 is stopped.

## Round D (after the owner's flight at 17f4f20): what is drawn follows catchment (`ec6115a` .. `9a0d141`)

The owner saw identical dark ribbons crossing a valley's fields, with no sign of catchment and no visible join. They
had three causes, each confirmed by switching one layer off at a time:
1. **The traced streams' broad breach floor.** Its half-width was 12 + 1.2 × cut m: 24–96 m wide on 1–5 m of water.
2. **The terrain shader's channel block** (bare rock, gravel bed, bank strip, reeds), drawn at full strength along a
   1 m torrent.
3. **The painted rills.**
   - Their damp margin and notch reached 2–4 × past a bed sized by a chain's catchment, even on valley floors.
   - Their water and bed were drawn at full strength 1–3 px wide.
   - They were smoothed over only 32 m, so the 250 m chains' corners showed.

**Fixes:**
- Non-outlet breaches are capped at the bed half-width; stream banks reach the bed's edge.
- Below a junction, a receiver is never narrower than what joins it.
- The channel block's strength scales with the water's width: 0.15 at 1.5 m half-width, full at 6 m.
- Painted rills:
  - nothing is drawn wider than 1.6 × the bed law;
  - their strength scales with water width the same way;
  - they fade out where the pixel can't hold the band;
  - they are smoothed over about 100 m;
  - they take a chain's catchment only in a V.
- Dead ends:
  - a stream stopped beside higher water runs in to it, up to 2 km away;
  - otherwise it runs on from the lower ground beside it;
  - a real hollow is flooded as a pond at its sill, with an outlet. Ponds added: 8 / 18 / 16 per seed
    (5.1 / 10.4 / 8.1 km²).

**Gate D, traced streams (17f4f20 → 9a0d141; seeds 1 / 42 / 777777):**
- (i) drawn width within ×0.6–1.6 of the bed law: 3.2 / 3.7 / 3.4 % → **95.9 / 95.8 / 95.5 %** (p50 1.25).
- (ii) receiver under 0.8 × the joining stream: 106 / 96 / 112 → **1 / 1 / 0**.
- (iii) breaches wider than the bed: about 100k samples a seed → **0**.
- (iv) sink ends in hills and mountains: 62 / 68 / 76 → **5 / 2 / 2**.

**Gate D, painted network (rillGate, 20 patches a seed; 2ebf85e → 9a0d141):**
- (i) band in the coordinator's view, measured as pixels changed against a rills-off render within 12 px of the course:
  - 1–3 km²: 6.9 → **0.4** px (projected bed law 1.2 px);
  - 3–10 km²: 5.1 → **2.6** px (law 3.7 px).
- (ii) wet ends more than 30 m from water: 8 / 11 / 10 → **8 / 10 / 10** of 117–132. Not met: these end in hollows of
  the detail ground away from any water.
- (iii) right-angle turns: 13.2 / 12.0 / 12.0 → **11.7 / 9.1 / 13.1 per 100 km**. Not met: the D8 raster on flat
  floors still runs straight with corners.

**Other gates at 9a0d141 (final11):**
- Steps over 50 m 39 / 15 / 43, over 100 m 0 / 0 / 0.
- Water over ground > 10 m 9 / 58 / 36.
- River over a dry bank > 10 m: 1930 / 2008 / 1859, against f3's 1692 / 1824 / 1605. Worse, from the water raise
  in `bbe5199`.
- Unfed river heads 19 / 20 / 16.
- Unchanged: riverZero, lakes, homeCheck (8/8), edges, NaN.
- Seed-42 box passes (31.0°, 594 m, b 1.16, pits 1.89).
- f3 courses: moved.py 1 / 0 / 3 lines.
- Suite 742/745, the three failures time budgets (200 boards, landmarks, airfields seed 7); all six affected files
  pass 76/76 with `--testTimeout=120000`.
- World build 3.9–4.0 s per thread (node).

## Round S: square corners, bigger streams stopping short, raised rivers (`8ade57e` .. `a26ee71`)

Seeds 1 / 42 / 777777 throughout. "Before" is `dadaf54` (round D's `final11`); "after" is `a26ee71` (`out/fs/finalS8`).
Battery logs per step: `finalS1`/`finalS2` (fix 1), `finalS3`/`finalS5` (fix 2), `finalS6`/`finalS7`/`finalS8` (fix 3). Shots
in `out/fs/shots/*-S0.png` (before, rendered from a `dadaf54` copy in `out/fs/preS`) and `*-S.png` (after); the
views are in `out/fs/viewsS.txt`. Port 5205; stopped.

### Short version

| | met? | before | after | aim |
|---|---|---|---|---|
| 1. square corners: painted right-angle turns (rillGate iii) | **no** | 11.7 / 9.1 / 13.1 per 100 km | **8.8 / 7.8 / 10.5** | < 1 |
| 1. ... of which in the course itself (not at a junction or a pit's spill) | | not split | 0.4 / 1.0 / 0.2 | |
| 1. traced gully-chain streams' turns on open floors | | 6.9 / 7.9 / 6.5 per 100 km | 4.3 / 4.6 / 4.0 | (no aim) |
| 1. floor sinuosity, 1.5 km windows under the braid line, p50 | **no** | 1.06 / 1.07 / 1.06 | 1.04 / 1.06 / 1.05 | NZ 1.3-2.5 |
| 2. traced streams ending as sinks in hills and mountains | **no** (4 left) | 5 / 2 / 2 | **2 / 1 / 1** | 0 |
| 2. painted wet ends > 30 m from water | yes (better) | 8 / 10 / 10 | **0 / 0 / 0** | not worse |
| 2. dry river heads with no feeder | yes (same) | 9 / 12 / 7 | 9 / 12 / 7 | not worse |
| 3. river over a dry neighbour > 10 m (waterWalls) | **no** | 1930 / 2008 / 1859 | **1860 / 1906 / 1780** | under 1692 / 1824 / 1605 |
| 3. ... > 30 m | **no** | | see below | 0 |
| 3. water over ground > 10 m (overGround) | yes | 9 / 58 / 36 | 9 / 58 / 35 | not worse |

What a pilot sees at the owner's three views is the same before and after (below): the painted streams there are
under forest, or a pixel wide, from 1000-1300 m. The changes show on the maps (`out/fs/shots/tm-*`) and close up.

### 1. Square corners

**What the corners were.** Three different things, found by mapping the painted lines over the ground
(`scripts/probes/turnMap.test.ts`) and splitting rillGate's turns by what is within 50 m of them:
- **The drawn ground's facets.** Beside a gully chain the terrain draws the threshold slopes' 250 m ground bilinearly
  (erosion.ts sampleErosion: Catmull-Rom ripples a V's floor). At a face's foot that makes planes facing along the
  grid's rows and columns. A painted stream came down the face's fall line, then turned onto the crease along a grid
  row and ran due west to the valley's stream (`tm-42-owner-S0.png`, the dark face on the right). That is the corner
  in the owner's valley.
- **Pits' spills.** A pit on near-level ground spills to the first lower cell a small flood reaches, up to 160 m away.
  It was drawn as one straight chord, with a corner at each end.
- **Junctions.** A side stream meeting a bigger one at more than 60 degrees counts as a turn. Before this round this
  was most of rillGate's count; it still is.

**What changed.**
- `rills.ts`: the painted streams are routed over the drawn ground with the threshold slopes' part replaced by its
  B-spline (`erosion.ts slopeSmoothDelta`). They follow the slopes' own fall lines and round their valleys' bends.
  The drawn ground is not changed. Nothing is faded or smoothed more.
- `rills.ts`: a pit's spill is drawn along the flood's own way over the low ground (the cells it crossed, corners
  cut), not as a chord.
- `rills.ts`: a dead-end bug in the strand merge. A line running into a strand hidden beside a bigger line, whose
  bigger line was the incoming one itself, stopped dead there, wet. Every one of rillGate's wet ends over 30 m from
  water (8 / 10 / 10) was this. The strand is now drawn as the line's way on.
- `streams.ts`: a gully-chain stream's points on an open floor (the slopes' ground a node either side under 15 m
  over it) are no longer pinned to the 250 m raster: its samples there are laid as a curve through them and their
  ground looked at again. A chain stream coming off an open floor, or across one, joins its receiver along a curve
  tangent to both courses, up to 400 m down it, at 45 degrees or less (a Y, not a T): 358 such joins on seed 42.

**Numbers** (`finalS8/turnClass.log`, `streamTurns.log`, `rillGate.log`):
- Painted turns 11.7 / 9.1 / 13.1 → 8.8 / 7.8 / 10.5 per 100 km. By kind, after: at a junction 7.0 / 5.6 / 8.9, at a
  spill 1.5 / 1.2 / 1.4, in the course 0.4 / 1.0 / 0.2. Before (seeds 1, 42): junction 7.9 / 6.4, spill 3.7 / 2.8.
- In the owner's valley (the 9 patches about the floor view): 7.5 → 3.1 per 100 km.
- Traced chain streams' turns: open floor 6.9 / 7.9 / 6.5 → 4.3 / 4.6 / 4.0; in a V 2.6 / 3.5 / 3.3 → 2.5 / 3.0 /
  3.1 (kept to the V's floor on purpose); off the slopes 10.3 / 8.6 / 9.6 → 7.2 / 4.6 / 7.5.
- Chain-stream mouths joining at more than 60 degrees: 781 / 794 / 856 → 713 / 705 / 749 of about 1130-1230. Only
  the mouths off an open floor are curved; those coming out of a V keep the angle the V meets its trunk at (not
  measured further).
- Floor sinuosity (1.5 km windows, gradient under the braid line 0.083 A^-0.44): p50 1.04 / 1.06 / 1.05, p90
  1.97 / 2.10 / 2.07; 13 / 17 / 15 % of windows in NZ's 1.3-2.5.
- Painted band in the floor view (`out/fs/tools2/banddiff.py`: pixels changed against a rills-off render): 1-3 km²
  0.1 → 0.0 px, 3-10 km² 2.0 → 1.7 px. Not wider.

**Not met, and why.**
- **The gate (< 1 per 100 km) is not met.** What is left is junctions (7.0 / 5.6 / 8.9) and spills (1.5 / 1.2 /
  1.4). The course itself is under 1 on seeds 1 and 777777 and at 1.0 on seed 42.
- **The landform itself follows the grid.** On gentle floors the threshold-slope pass (hillslopes.ts) routes over
  the 250 m grid and builds its channel floors along that routing. Where it ran dead straight along a row or a
  diagonal, the valley it built does too. Example: `tm-1-end-S1.png`, a 1.2 km floor chain due west along a grid row
  with column-straight tributaries joining it at right angles. A painted or traced stream in that valley follows it.
  Fixing that means changing the pass's routing, which moves the ground everywhere and every gate with it. Not done
  this round.
- **Traced streams pinned on the slopes' floors** (not gully chains: lattice streams, continuations) still keep to
  their raster points. Where the routing alternates orthogonal steps they run as a staircase (`cases/s1-1265-*.png`,
  lower left).
- **Winding.** Floor sinuosity stays at 1.04-1.06, against NZ's 1.3-2.5 for winding single threads. Nothing was
  added to make it wind: the streams are no longer cornered, but they are not meandering either.

**Pictures.**
- Maps: `tm-42-owner-S0.png` (before) and `tm-42-owner-S2.png` (after): the painted streams on the right-hand face now
  come down its fall line into the valley stream instead of running due west along the creases.
  `tm-42-b-S3.png` (junction hooks and a grid-diagonal floor chain), `tm-1-end-S1.png` (grid-row floor chain).
- The owner's views (`floor-`, `wind-`, `face-S0.png` / `-S.png`; `floor` compared on the crop 950,250-1600,900):
  - **floor:** the same picture. The valley stream runs down the floor at the face's foot; the fields beyond carry the
    same thin, crack-like painted lines. Their jaggedness is the line's drawing at a pixel wide from 2 km, not its
    course. No new corners.
  - **wind:** the same. The winding stream with wooded banks runs down the floor; the left wall is forest, and no
    side stream shows from 1000 m.
  - **face:** the same. The two small streams the brief names are not visible from this camera, before or after.
- Close pair: `foot-` and `fields-S0.png` / `-S.png` (at 250 m over the floor): the same; the face's painted streams
  are under the canopy.

### 2. Bigger streams stopping short

Each case, why the existing paths declined it (StreamReport.endWhy, probe `sinkCases`), and what now happens:

| seed, line | end N, E | catchment | why it stayed a sink | now |
|---|---|---|---|---|
| 1, 433 | 127750, 156000 | 28.6 km² | a lake's outlet: outlets were never offered the run-on or pond paths | ends in a pond filled at its end (`cases/s1-433-*`) |
| 1, 434 | -131250, -147250 | 22.1 km² | the same | ends in a pond |
| 1, 602 | 36250, 41000 | 99.7 km² | run-on sank; pond filled, but every straight way in crossed its own course | **still a sink**: cutting it back into the pond takes 0.6 km of its course |
| 1, 1265 | 25250, -98750 | 71.9 km² | run-on sank (no way out); the hollow's lowest neighbour was another line's point (801), read as its sill: no pond, no run-on | that line's water stands higher, so it walls the hollow now; the hollow is filled as a pond and the stream ends in it |
| 1, 1414 | -43000, -64500 | 119.0 km² | as 602 | **still a sink**: the cut would take 1.3 km |
| 42, 450 | 110250, -29000 | 22.0 km² | a lake's outlet, as 433 | **still a sink**: its hollow is flat (no point under its sill) and the run-on from the sill sinks at once. Run on from its own end, the trace kept beside its lake's shore round to a way out (a carved channel ringing the lake), so that is not done |
| 42, 728 | -138750, -118500 | 84.8 km² | as 602 | cut back (under 450 m) into the pond it filled (`cases/s42-728-*`) |
| 777777, 789 | -83250, -52750 | 130.4 km² | as 602 | **still a sink**: its course ran through a 6 ha hollow 5 km before its end, climbed over a sill and ended in another; the cut would take 5.0 km |
| 777777, 818 | -16500, -9000 | 82.4 km² | as 602 | cut back into its pond |

**What changed** (`streams.ts`):
- The pond pass takes lakes' outlets too. The run-on pass does not (the shore-ringing channel above).
- The pond's flood takes another line's water standing over the flood as a wall at that height. A line at the sill
  no higher than the flood is where the hollow spills: the stream runs into it.
- A stream whose every straight way into its pond crosses its own course is cut back as little as it may: to its last
  sample from which a straight reach of at most two raster steps runs in without crossing. At most 450 m: a 3 km
  allowance cut 0.6 km off seed 42's f3 line 716, which moved.py counted. Streams joining the part cut off run on to
  its new end.
- Ponds made: 8 / 18 / 16 → 14 / 20 / 20.

**Not met.** 2 / 1 / 1 left (seed 1 lines 602 and 1414, seed 42 line 450, seed 777777 line 789), for the reasons in
the table. 602, 1414 and 789 need a pond over two hollows joined by the sill their course climbed; 450 needs its lake
to keep its water (no outlet) or its hollow filled from the lake's side.

**Same fix, other counts:** painted wet ends over 30 m from water 8 / 10 / 10 → 0 / 0 / 0 (fix 1's strand bug); dry
river heads with no feeder 9 / 12 / 7, unchanged.

**Pictures:** `out/fs/shots/cases/s<seed>-<line>-before.png` / `-after.png` (4 km maps about each end: traced lines
cyan, painted blue/brown, chains pink/red).

### 3. Raised rivers

**What the count is made of.** waterWalls counts a 50 m grid point in a channel whose neighbour 50 m away is dry and
more than 10 m under the water. Split (probe `wallSplit`, at `a26ee71`):

| class | seed 1 | seed 42 | seed 777777 |
|---|---|---|---|
| a river's mouth over the sea bed (the sea, standing at 0 m, is taken as dry by the probe) | 738 | 1071 | 525 |
| along: the channel's own fall over the 50 m (a steep reach, a fall) | 962 | 666 | 1029 |
| beside, bank (no lower ground across within 250 m) | 16 | 5 | 12 |
| beside, off the floor (lower ground across: perched) | 144 | 164 | 214 |
| of the beside ones, over 30 m | 11 | 9 | 9 |
| total > 10 m | 1860 | 1906 | 1780 |

The three worst named are all "along": seed 1's 123.8 m at -23350,114100 is a waterfall over a fault (`ww1-S0/-S`),
seed 42's 70.0 m at -71300,20500 a stream on a 115 % cascade, seed 777777's 92.1 m at 21500,-144050 a stream dropping
over f3's 110 m step (`ww7`). The perched ones are mostly streams (111 / 102 / 174), then rivers (18 / 53 / 20) and chain streams (15 / 9 / 20).

**What changed.**
- `riverNetwork.ts`: bbe5199's raise of a stream's water toward the drawn ground is held to at most 2 m over the lower
  of its banks, sampled 25 m beyond its channel either side. On a spur's nose the ground falls away either side; the
  raise had stood the water over it.
- Tried and not kept: filling a perched river's floodplain up to its floor (the valley cut signed, at most 40 m;
  `8f1e22a`). It took the total down by only 12 / 32 / 15, and it raised the ground beside rivers up to 40 m over
  the natural ground, which tests/terrain/seededWorld forbids (a levee is a few metres at most). Removed in `a26ee71`.
- Tried and not kept: dropping the raise altogether. That took the total to 1625 / 1755 / 1525 (under stage 3), but
  brought back seed 777777's 110 m step at 21500,-144000 (steps > 100 m 0 → 1) and two points of water over the
  ground at a held mouth on seed 1 (overGround 9 → 11). Both are on the must-not-regress list.

**Not met.**
- The total is 1860 / 1906 / 1780 against stage 3's 1692 / 1824 / 1605 (before: 1930 / 2008 / 1859). Over half of it
  is sea-bed mouths and channels' own falls, which the metric counts and which no water level fixes.
- Over 30 m: not 0. Beside (perched) over 30 m: 11 / 9 / 9 edges. Worst perched: seed 777777 line 720 (stream) 62 m
  at -13700,31250; seed 42 line 2117 (chain) 45 m at -42950,33000; seed 1 line 2185 (chain) 38 m at 23650,-100700.
- Pictures at the three worst spots, before/after: `ww1-`, `ww42-`, `ww7-S0.png` / `-S.png`. All three look the same
  after: a waterfall over a fault (seed 1), a thin stream through a clearing on a steep forested slope (seed 42), and a
  dark notch where a stream drops through the forest to the valley farms (seed 777777).

### Must not regress (`final11` → `finalS8`)

| | before | after | |
|---|---|---|---|
| drawnGate (i) traced drawn width within ×0.6-1.6 of the bed law | 95.9 / 95.8 / 95.5 % | 96.1 / 95.7 / 95.5 % | seed 42 0.1 under (it read 95.6-95.8 over the round's steps) |
| drawnGate (ii) receivers under 0.8× the joining stream | 1 / 1 / 0 | 0 / 1 / 0 | held |
| drawnGate (iii) breaches wider than the bed | 0 | 0 | held |
| painted band, floor view (banddiff.py), 1-3 / 3-10 km² | 0.1 / 2.0 px | 0.0 / 1.7 px | held |
| moved.py (f3 courses) | 1 / 0 / 3 | 1 / 0 / 3 | held |
| seed-42 box: slope p50, peak, 1 km relief, b, pits | 31.0°, 35-37.5, 594 m, 1.16, 1.89 | 31.0°, 35-37.5, 594 m, 1.26, 1.89 | passes (b ≤ 1.3); b moved 1.12-1.26 over the round's steps |
| homeCheck; riverZero; lakes; edges; NaN | 8/8; 0.2 / 2.2 / 0.0 km; 71 / 74 / 61; 76.0 / 78.4 / 68.1 m; 0 | the same | held |
| steps > 100 m | 0 / 0 / 0 | 0 / 0 / 0 | held |
| world build per thread (node, alone; seeds 42 / 1 / 777777) | 3.9-4.0 s | **4.07-4.20 / 3.98-3.99 / 4.11-4.15 s** | **over**, by 0.1-0.2 s on seeds 42 and 777777 |
| seed 0 / presentGuard | | presentGuard passes, not re-pinned; the new terrain code is seeded-world only (the slopes' smoothing reads the threshold slopes, none at seed 0) | held |
| small streams at true width | | unchanged (no width code touched) | held |
| MODEL_VERSION | ss5 | ss6 | bumped |

Also moved, not on the list: steps over 50 m 39 / 15 / 43 → 40 / 15 / 43; streams' lower bank over the water by more
than 10 m (bankHeight) 91 / 121 / 90 → 92 / 121 / 90; the seed-42 box's b over 10-100 m 1.21 → 1.38 (it moved
between 1.21 and 1.41 over the round's steps); gullyGate cut V's with water 98.3 / 94.9 / 98.5 → 97.8 / 96.8 / 98.5 %, and wet painted line ends reaching the
network 91.5 / 92.0 / 91.2 → 93.3 / 92.4 / 94.2 %.

**Build time, where it went** (phaseTimes alone, twice each): after fix 1 3.91-3.99 / 3.83 / 3.92-4.00 s. Fix 3's
bank check on the raise costs about 130 ms a seed (without it: 4.04 / 3.88 / 4.00 s): two natural-ground samples
beside each raised sample. Looking at the banks every other sample took it to 4.06-4.09 / 3.96-3.99 / 4.05-4.08 s but
let 31-38 more perched edges back per seed (waterWalls 1891 / 1944 / 1813), so it was not kept. Not fixed.

**Suite** (`finalS8/suite.log`): 738 / 745. All 7 failures are 5 s time budgets: landmarks (3: determinism, the
rules at seed 7, the road network at seed 7), 200 boards at seed 7, airfields (2: seed 7, differs between seeds),
seededWorld seed 7 "sites its own home field". Round D had 3 of these. The six files pass 76 / 76 with
`--testTimeout=120000` (`finalS8/suite-longtimeout.log`). At `92682fe` seededWorld also failed functionally (a
self-crossing course at a pond entry, a 15-25 m bank from the floodplain fill); `a26ee71` fixed both.

### Commits

| commit | what |
|---|---|
| `8ade57e` | painted streams routed over the slopes' smoothed fall lines; spills drawn along their way; chain streams curved on open floors and joining as a Y; MODEL_VERSION ss6 |
| `4f0a823` | painted streams: no dead wet end at a hidden strand |
| `8b8da76`, `d9b0433`, `ad575e0`, `8f7f084` | dead ends: outlets in the pond pass, a higher line walls a hollow, a level line at the sill is joined, a course run past its pond cut back (at most 450 m) |
| `8f1e22a` | raised rivers: the stream water raise dropped, perched floodplains filled (both measured alternatives, undone below) |
| `92682fe` | the raise back, held to 2 m over the lower bank |
| `a26ee71` | the floodplain fill removed; a cut-back stream's reach into its pond may not hook back across its last segments |

### Probes and tools added

`scripts/probes/`: `turnMap` (map and turn classes), `streamTurns` (traced turns, mouths, sinuosity), `chainTurns`,
`floorSec`, `wetEnds`, `ptNet`, `sinkCases` (dead ends with reasons), `wallSplit` (waterWalls by class), `crossSec`.
`out/fs/`: `finalS.sh` (the battery), `shotsS.sh`, `shotsS2.sh`, `caseMaps.sh`, `tools2/banddiff.py`.

## Round T: bigger streams stopping short, square corners, raised rivers (`6c35d7e` .. `1eb8e12`)

Seeds 1 / 42 / 777777 (/ 7 where a test uses it). Plan: `out/fs/PLAN-T.md` (steps 1-5 done in order; step 6, the
channel-band interpolant, waits for the owner). "Before" is HEAD `64b3c61` (code `a26ee71`, `out/fs/T0`, pictures
rendered from a copy of HEAD in `out/fs/preT`); "after" is `1eb8e12` (`out/fs/T4` per-step checks, `out/fs/TF` the full
battery and suite). Pictures: `out/fs/shotsT/<view>-T0.png` / `-T2.png` / `-T3.png` / `-T4.png`, cameras in
`out/fs/viewsT.txt`, one line per picture in `out/fs/shotsT/notes.txt`. Port 5222 (the shot tool's own vite), stopped.

### Short version

| gate | before | after | target | met? |
|---|---|---|---|---|
| E1 dead ends, A >= 10 km² (seed 7 too) | 3 / 2 / 3 / 3 | **0 / 0 / 0 / 0** | 0 | yes |
| E2 outlets running back into the water that fills them | **5 / 12 / 8 / 9** (plan said 5: it looked at the dead ends only) | **0 / 0 / 0 / 0** | 0 | yes |
| E3 line 789's catchment at its end | 130.4 km² | **53.8 km²** | about 53.8 | yes |
| E4 tests/terrain/seededWorld | 21 / 21 | 21 / 21 | 21 / 21 | yes |
| C1 crease, node line vs mid-cell, in the band | 3.06x / 2.33x / 4.14x | the same | <= 1.5x | no (step 6, not done) |
| C2 barbed mouths > 120 deg | 138 / 126 / 157 (8.3 / 7.5 / 8.8 %) | 135 / 117 / 149 (8.1 / 7.0 / 8.4 %) | <= 4 % | **no** - BARB_FIX meets it (3.3 / 3.9 / 3.1 %) but regresses three gates: off |
| C2 staircases, non-chain floor streams | 16.2 / 10.5 / 10.1 km | the same | <= 2 km | **no** - CURVE_FLOORS gets 0.0 / 0.0 / 3.4 km but moves 517 in the owner's box: off |
| C2 non-chain floor grid share | 45 / 39 / 42 % | the same | <= 20 % | no (34 / 28 / 31 % with CURVE_FLOORS) |
| line 517's elbow and 146 deg hook | 58 deg turn, 146 deg mouth | the same | gone | **no** (gone with BARB_FIX: mouth 19 deg) |
| C3 painted out-and-back segment pairs | 3 / 15 / 9 | **2 / 4 / 9** | 0 | no |
| W1 rivers > 30 m over the floor beside them | 427.5 / 326.9 / 386.3 km | the same | -70 % | **no** - no settle (step 5 stopped: no build-time flag passes) |
| W2 water > 10 m over its own centre ground | 0.2 / 0.6 / 2.7 km | 0.2 / 0.6 / **1.2** km | 0 | no (line 720 fixed; the rest other causes) |
| W3 settle precision | - | - | <= 1.5 | not built |

What a pilot sees: at seed 777777's valley (`s7-789-along`) the third channel running back up the floor is gone and the
stream ends in a small lake; seed 1's long lake (`s1-1414-*`) has one outlet and no trenches or lines under its water;
lake 70 (`s42-450`) has no pale channel leading nowhere. Seed 42's plains get a new 9.7 km² lake (`s42-716`). The owner's
valley (`floor`, `wind`) is unchanged. Line 720 now drops into the airfield approach it crosses instead of running level
50 m above it; the pale "sheet" there is the approach's cleared zone, not water, and stays.

### Step 1: probes and baseline (`6c35d7e`)

Committed gate probes (`scripts/probes/`): `endsGate` (seed 7 added; every pond made listed with area, centre, level),
`outletLoops` (any lake or pond outlet whose way down reaches a line ending in its own pool - generic, so it found 34
loops, not the plan's 5), `wallsGate` (invWalls part 2; scan off unless SCAN=1; default ACID spots), `cornerGate`
(invJunctionsTraced with the mouths found from geometry, a GATE summary and the wiggle term), `creaseGate` (all three
seeds; 24 transects per seed picked in the channel band), `paintedLoops`. Repairs: `streamTurns` finds each mouth from
geometry (hydrology.rivers has no joinS); `invJunctionsPainted` never walks a segment twice; `waterWalls` keeps its old
count and adds a corrected one (the sea wet, the channel's own falls apart): 1860 / 1906 / 1780 old, 1122 / 835 / 1255
corrected, of which own falls 595 / 416 / 707. `out/fs/tools2/group.py` copied.

Wiggle term (G1/G2): a course's lateral offset from its own chord over +-25/50/75 m; a ruler-straight window or grid run
counts only where its rms is under 3 m. It takes chain ruler-straight from 50.4 / 43.6 / 50.7 % to 32.0 / 26.0 / 32.4 %
and traced grid runs from 2100 / 1710 / 2240 km to 1545 / 1247 / 1664 km; it clears line 517's 2.1 km reach. Both raw and
wiggle figures are kept, since the term also hides D8 runs that wander has decorated.

Timing (phaseTimes alone, median of 3): HEAD 4124 / 3992 / 4081 ms (seeds 42 / 1 / 777777), streams 559 / 547 / 587 ms.

### Step 2: bigger streams stopping short (`352e9a3`)

**Trigger.** Written as a rule, counted before anything was built: a stream the pond pass still leaves a sink ('allCross',
'flat' with nothing to join, a refused cut back). It fires on exactly the eight named lines and seed 7's three real
cases (457, 567, 1521), nothing else.

**What changed** (`streams.ts`, seeded worlds only):
- FILL_DEAD_ENDS: the hollow is filled from the pit the stream's water was held at, by a priority flood in from the water
  round it (window 12, then 24, then 48 raster steps, grown only where the way out leads to its edge - exact, and it kept
  the trace's cost to +18-42 ms), up to its real way out; water an outlet flows into stands no higher than the pond + 6 m.
  The stream ends where it first comes into the water; its tributaries past there end where they come in; the outlet
  runs along the flood's way out. Where the course never enters the water it runs in from its last sample with a
  straight reach crossing nothing; failing that the old pond stays (it is taken back and put back exactly:
  LakeMask.pondState/restorePonds).
- No outlet - of a pond or a lake - may join a line filling its water or upstream of that. The cause of all 34 loops:
  outletPath ended at the first channel point, which was the filling stream lying against the pond. Where that leaves no
  way out within OUTLET_SILL, or the way out sinks, the pond or lake is closed (no outlet), with a two-sample stand-in in
  its water so the streams after it keep their ids (wander is seeded by id: without it every later stream on seed 777777
  wiggled differently and overGround jittered).
- A pond outlet's catchment is its pond's inflow (every line ending in it, each once), summed after the network's, higher
  ponds first.
- Decision 4 default (LAKE_BACK_CLOSED): lake 70's outlet 450 and lake 57's outlet 431 drain only back into their own
  lakes; each is cut back to its samples in its lake. LAKE_RAISE (off) raises the lake to its real spill instead: lake 70
  becomes 4.44 km² at 283.4 m (+22 m), outlet into line 220 (`s42-450-T2raise.png`); lake 57 8.94 km² at 144.0 m.
- Decision 3 (POND_KEEP 3 km², POND_SILL_CUT 15 m, BIG_POND_KEEP false): only seed 42's 716 makes a pond over 3 km²;
  its sill stands 36 m over the pit, so the lake is kept. The cut-through branch (a pond over 3 km² on a sill of 15 m or
  less) fired on none of the four seeds: it is built but unexercised.

Every pond the dead-end rule made: seed 1 602 1.00 km² at 35375,41141 (185.3 m; sill 11.7 m over the pit), 738 0.56 km²
at 113861,128833 (24.2 m), 1414 1.44 km² at -42054,-62946 (322.9 m); seed 42 716 **9.69 km² at 132352,-123990** (198.9 m);
seed 777777 769 0.69 km² at -148114,-23318 (20.2 m), 789 0.50 km² at -80969,-53813 (32.8 m); seed 7 567 2.19 km² at
-12736,125757 (27.0 m), 1521 0.13 km². Pond area 7.8 / 11.4 / 8.8 / 5.7 -> 8.3 / 20.6 / 9.6 / 7.6 km². Ponds now closed by
the loop rule: 5 / 8 / 7 / 2 (and seed 777777's lake 35), each listed by endsGate with what its outlet used to join.

**Numbers:** E1 0/0/0/0; E2 0/0/0/0; 789 ends at 53.8 km² (602 and 716 become stubs inside their ponds, as the verifier
said); seededWorld 21/21; deep-notch reaches 154.6 / 225.8 / 311.0 / 228.4 -> 148.8 / 222.7 / 301.1 / 227.4 km (reported
only). moved.py 1/0/3 -> 3/2/6: 738, 602 / 716, **450** / 769, 789, **431**. 450 and 431 were not in the plan's list: they
are the lake outlets decision 4's default closes. Every one is allowed by `out/fs/tools2/allow.py` (the generated list,
decision 2): 74-100 % of each one's moved length was a notch more than 5 m under its ground. Owner's box 0/146.

### Step 3: square corners, stage A (`8ba7cc3`)

- **Line 517's hook** is not the course running past the river: a stream reaching a line's channel stops at the first
  raster point within RIVER_TOUCH (200 m) of it, and joined it at the receiver sample that marked that point - the most
  upstream one. Coming in from beside river 64, 517's last reach turned back up the river (146 deg). BARB_FIX joins such a
  stream downstream along junction()'s curve (else at the nearest sample). Measured on: barbed 3.3 / 3.9 / 3.1 % (target
  met), 80-90 deg 9.4 / 7.3 / 9.5 %, 517's mouth 19 deg (a 84 deg bend remains just before it). But drawnGate (i) on seed
  42 fell to 95.4 % (floor 95.6), bankHeight rose to 94 / 122 / 93 (limit 92 / 121 / 90) and 517's points in the owner's box
  moved. **Left off.**
- **Staircases** on non-chain streams are pinned to the slopes' channels (slopePinned), not open floors: the plan's open
  floor test alone changed nothing. CURVE_FLOORS frees a raster point where the curve through it keeps to ground within
  FLOOR_RISE of the point's, with 4 more passes at the raster's spacing, each point within 90 m of its raster point
  (lake outlets, streams ending in water and the last 3 points excluded - one ending in a lake on seed 99991 otherwise
  failed seededWorld). Measured on: staircases 0.0 / 0.0 / 3.4 km, grid share 34 / 28 / 31 %, drawnGate, bankHeight,
  overGround (9 / 47 / 32) and moved.py all held - but 3 of the owner's box's 146 points on line 517 moved more than 50 m.
  **Left off** (the wind view looked the same with it on: `wind-T3.png`).
- **Painted out-and-back pairs:** two causes. (1) Two pits' spills on flat ground running over the same cells in
  opposite directions, drawn along their ways since round S - now drawn as chords: seed 42's hottest patch's 10 pairs
  gone. (2) The strand merge redirecting a line back up its own line (`j = root(j)`): stopping it left 2 / 0 / 1 wet dead
  ends in rillGate, so it is not done. 3 / 15 / 9 -> 2 / 4 / 9.
- Not done: the optional chain-stream wander (item 3).
With both constants off the traced lines are byte-identical to step 2's.

### Step 4: water standing over its own ground, line 720 (`1eb8e12`)

The plan's two suspects (perLine against perLineBlend, wallWeight against lastWallAt) are not it: no river valley reaches
line 720 at all (probe `carveAt`). Line 720 crosses a **generated airfield's approach**: sampleTerrain trims the ground
under APPROACH_GRADIENT after the network's carve, up to 55 m there, and the airfields are sited after the streams are
traced. Fix, levels only: once the airfields are sited, Hydrology.holdUnder lowers each stream's water under the ground
the airfields' trim makes of the ground it was levelled on (the home approaches, a field's approaches and flat - fieldTrim,
the same arithmetic), falling downstream, and works its flow out again (FIELD_HOLD). 71 / 164 / 1016 samples lowered.
W2 0.2 / 0.6 / 2.7 -> 0.2 / 0.6 / 1.2 km; line 720 is out of it (the rest are other causes: seed 777777 river 6 48.6 m at
-107098,67358 over 308 m, streams 510, 1382, 561). The trim is a soft minimum, so the bed under 720 still lies up to 20 m
under its water in the cut (deep water in a narrow channel; no water over the ground beside it: probe `gridAt`).
Every thread holds the same: the airfields are sited only in heightfield.ts buildWater, which each thread runs itself
(module load and onWorldSeed), and the hold follows the siting there. Known inaccuracy: holdUnder takes the drop off the
sample's cut (as the raise does), so at a corridor's edge, where the trim is partial, the breach is understated.
**The "sheet"** in 777777-B720 is the approach's cleared zone (approach > 0, no trees), not water: it is still in the
after picture, and no stream fix will move it.

### Step 5: targeted settle - stopped at its first item

No build-time flag passes (`out/fs/T5/proxy.txt`, from the verifier's measurements at this river geometry, unchanged by
steps 2-4): p1 (the model's carve > 200 m off the axis) flags 3.5-4.5x the > 30 m shelf length and catches 75 % of it on
seed 42; p2 (coarse minus filled > 30 m) flags 4-6x and catches 65-75 %; their AND can catch no more than p1's 75 % on
seed 42. Pass needs >= 80 % at <= 1.5x. As the plan says, step 5 stops: no SETTLE built, river 64 untouched (decision 1
default), MODEL_VERSION stays ss6 (nothing the cached model holds changed this round), and the settled alternative of
the owner's valley exists only as the verifier's prototype renders (`out/fs/inv/vwalls/shots/42-valley-proto.png`,
`42-wind-proto.png`).

### Must not regress (`finalS8` -> `TF`, the full battery at `1eb8e12`)

| | before | after | rule | |
|---|---|---|---|---|
| drawnGate (i) / (ii) / (iii) | 96.1 / 95.7 / 95.5 %; 0 / 1 / 0; 0 | 96.0 / 95.7 / 95.5 %; 0 / 1 / 0; 0 | (i) >= 95.6 / 95.6 / 95.4 | held |
| moved.py (f3 courses) | 1 / 0 / 3 | 3 / 2 / 6 | named + allow-listed only | held: 738, 602 / 716, 450 / 769, 789, 431, each allowed (allow.py, 74-100 % notch) |
| owner's box (seed 42, 146 points) | - | 0 moved | 0 | held |
| overGround > 10 m | 9 / 58 / 35 | 8 / 58 / 35 | <= 9 / 58 / 35 | held |
| bankHeight > 10 m | 92 / 121 / 90 | 92 / 121 / 90 | <= 92 / 121 / 90 | held |
| steps > 100 m; > 50 m | 0; 40 / 15 / 43 | 0; 40 / 15 / 43 | 0; no worse | held |
| seededWorld | 21 / 21 | 21 / 21 | 21 / 21 | held |
| homeCheck; riverZero; lakes | 8/8; 0.2 / 2.2 / 0.0 km; 71 / 74 / 61 | the same | unchanged | held |
| seed-42 box: slope p50, b, pits | 31.0, 1.26, 1.89 | 31.0, 1.26, 1.89 | b <= 1.3 | held |
| seed-777777 box b (reported) | 1.19 | 1.34 | - | moved (step 4's held streams lie in it) |
| gullyGate; rillGate wet ends > 30 m | 97.8 / 96.8 / 98.5 %; 0 / 0 / 0 | the same; 0 / 0 / 0 | no worse | held |
| painted band (banddiff.py) | 0.0 / 1.7 px | not re-rendered | not wider | traced lines unchanged by step 3 as shipped; rills changed only for flat spills |
| waterWalls old count | 1860 / 1906 / 1780 | 1856 / 1906 / 1741 | reported | |
| presentGuard (seed 0) | passes | passes, not re-pinned | | held |
| suite | 738 / 745 | 737 / 745: 8 failures, every one a 5 s time budget (system 200 boards, landmarks x3, waterFlow seed 42, airfields x2, bedrock stones); the six files pass 76 / 76 with --testTimeout=120000 | 738 / 745, time budgets only | one more timing failure than finalS8's 7 (decision 8: no budget changed) |
| build time (phaseTimes alone, median of 3, seeds 42 / 1 / 777777) | 4124 / 3992 / 4081 ms | 4207 / 4020 / 4221 ms (streams 591 / 579 / 629 ms against 559 / 547 / 587) | <= +150 ms | held: +83 / +28 / +140 ms (seed 777777 at the edge) |

### Pictures (before `-T0`, after `-T2` / `-T3` / `-T4`; `out/fs/shotsT/`)

- `s7-789-along` (T0/T2): the third channel running back up the floor beside the stream is gone; the stream ends in a
  narrow new lake on the floor.
- `s1-1414-end`, `s1-1414-sw` (T0/T2): one outlet leaves the lake's far end; the twin trench, the dark lines under the
  water and the shore trench are gone.
- `s1-602` (T0/T2): nearly the same: a lake fed by a stream; the channel along its east shore is gone.
- `s42-716` (T0/T2): a ~6 km lake (9.7 km²) now lies along the foot of the hills - decision 3's rule keeps it (sill 36 m).
- `s42-450` (T0/T2): lake 70 without its pale channel to nowhere; `s42-450-T2raise`: the raised option, a 4.4 km² lake.
- `s42-479-close`, `h42-438` (T0/T2): unchanged, as planned (ring grooves; an unfed stony head mid-slope).
- `floor`, `v4-s42-517-elbow`, `wind` (T0/T3, rendered with BARB_FIX and CURVE_FLOORS on): the floor view the same;
  from 340 m the hook into the grey river is gone, a short straight channel crosses a field; the wind stream the same,
  calm, fields both sides. As shipped (both off) these views are as before.
- `777777-B720` (T0/T4): line 720 drops into the airfield approach in a darker cut instead of running level across it;
  the pale cleared approach zone (not water) remains.
- Before only (no settle built), with what a pilot sees in `notes.txt`: `42-V141`, `1-V194`, `777777-V239`, `777777-V215`,
  `1-V181` (rivers on shelves above dry floors), `42-valley-head`, `42-V64` (the owner's valley, two rivers), `42-L2-head`
  (a 21.9 m "shelf" that looks normal), `w42c-17`, `B-s42-diag`, `D-s1-col`, `F-s1-Vvalley`, `s1a`, `s1b` (references).

### Constants and owner decisions (defaults)

| constant (file) | default | what the other setting does |
|---|---|---|
| FILL_DEAD_ENDS (streams.ts) | true | false: the dead ends stay dead |
| POND_KEEP 3 km², POND_SILL_CUT 15 m, BIG_POND_KEEP (streams.ts) | 3 / 15 / false | decision 3: BIG_POND_KEEP true keeps every lake; only 716 is affected (kept anyway) |
| LAKE_BACK_CLOSED (streams.ts) | true | decision 4: false leaves 450/431 as dead ends |
| LAKE_RAISE (streams.ts) | false | decision 4: true raises lake 70 to 283.4 m (4.44 km²), lake 57 to 144.0 m (8.94 km²) |
| BARB_FIX, BARB_ANGLE 105 deg (streams.ts) | false | barbed mouths 3.3 / 3.9 / 3.1 %, 517's hook gone; drawnGate seed 42 95.4 %, bankHeight 94 / 122 / 93 |
| CURVE_FLOORS, FLOOR_PASSES 4, FLOOR_LAY 90 m, FLOOR_KEEP_END 3 (streams.ts) | false | staircases 0 / 0 / 3.4 km, grid 34 / 28 / 31 %; 3 points of 517 in the owner's box move |
| FIELD_HOLD (heightfield.ts) | true | false: streams stand over airfield approaches again |
| SETTLE | not built | step 5 stopped (no flag passes); decision 1 (river 64 held out) is the de facto default |
| decision 2 | allow-list | `out/fs/tools2/allow.py`: only notch-wander lines (>= 50 % of the moved length > 5 m under ground) |
| decision 6 | rillGate (iii)'s < 1 per 100 km retired | reported: 8.7 / 7.2 / 10.5 per 100 km; gated on C1-C3 instead |
| decision 7 | W1 counts > 30 m | 10-30 m band reported: 812.9 / 654.7 / 919.3 km |
| decision 8 | no time budget changed | suite as it is |

### Not done

- Step 6 (channel-band interpolant): waits for the owner (C1 3.06 / 2.33 / 4.14x unchanged).
- Step 5's settle: no build-time flag passes; W1 427.5 / 326.9 / 386.3 km unchanged; owner decision 1 not exercised.
- C2 barbed and staircases, line 517's hook: built (BARB_FIX, CURVE_FLOORS) and measured, left off for their regressions.
- C3: 2 / 4 / 9 out-and-back painted pairs remain (the strand merge's redirect back up its own line).
- W2: 0.2 / 0.6 / 1.2 km remain from other causes (seed 777777 river 6 48.6 m at -107098,67358).
- The optional chain wander (step 3 item 3); deep-notch reaches (P3-class trace fix); unfed heads; ring grooves at 479.
- "Doubled valleys" (W1's reported-only row) not measured.

### Commits

| commit | what |
|---|---|
| `6c35d7e` | step 1: gate probes, repairs, cameras, baseline numbers |
| `352e9a3` | step 2: dead ends filled, no outlet loops, lake 70/57 closed (LAKE_RAISE option), outlet catchments |
| `8ba7cc3` | step 3: BARB_FIX and CURVE_FLOORS (off), flat spills drawn as chords |
| `1eb8e12` | step 4: streams held under the airfields' cut ground (FIELD_HOLD) |
| (this) | report, step 5's proxy note (`out/fs/T5/proxy.txt`) |
