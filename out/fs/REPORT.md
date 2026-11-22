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

## Round T: bigger streams stopping short, square corners, raised rivers (`6c35d7e` .. `09bd446`)

Seeds 1 / 42 / 777777 (and 7 where a test uses it). Plan: `out/fs/PLAN-T.md`. Steps 1-5 were done in order. Step 6, the
channel-band interpolant, waits for the owner. "Before" is HEAD `64b3c61` (code `a26ee71`, `out/fs/T0`, pictures from a
copy of HEAD in `out/fs/preT`). The round as first handed in was `1ac0dc9` (code `1eb8e12`, battery `out/fs/TF`). Three
checkers then found faults. The fixes are `793d666`, `671eaf2` and `09bd446`; the final battery is `out/fs/UF`, with
per-fix checks in `out/fs/U10`, `out/fs/U9` and `out/fs/U8`. Pictures are in `out/fs/shotsT/<view>-T0/-T2/-T3/-T4.png`
(cameras in `out/fs/viewsT.txt`) and `out/fs/shotsU/<view>-T0/-V/-U.png` (cameras in `out/fs/viewsU.txt`). The checkers'
renders of `1ac0dc9` are in `out/fs/verifyT1/pictures/*-V.png`. `out/fs/shotsT/notes.txt` has one line per picture.
Port 5222 was used by the shot tool's own vite and is stopped.

### Short version: what the owner asked, and what a pilot will see

| owner's words | as shipped | met? |
|---|---|---|
| "the bigger streams stopping short" | The eight named dead ends now end in water. A filled hollow becomes a pond with an outlet, or a closed lake. No outlet runs back into the water that fills it, through a lake or not. | **yes** for the named cases (pictures: s7-789-along, s1-1414-*, s1-602, s42-450, s42-716) |
| "Fix the square corners" | **Unchanged.** The two fixes (BARB_FIX, CURVE_FLOORS) are built but switched off. With them off, floor, v4-s42-517-elbow, wind and the s1-1265 staircase render the same as before (0.14-0.48 % of pixels differ, all tree jitter). Line 517's elbow and its hook into river 64 are still there, and so is the zigzag square-cornered channel upstream of line 720. | **no** |
| "the raised rivers" | **Unchanged, apart from line 720.** 42-V141, 1-V194, 777777-V239, 777777-V215, 1-V181, 42-V64, 42-valley-head and 42-L2-head render the same as before (0.02-0.14 %). Rivers still run on shelves above dry hollows, and the owner's valley still has two rivers (64 on its shelf, 517 in the floor). The settle (step 5) was not built: no build-time flag passed its test. Line 720 now drops into the airfield approach it crosses, in its own shallow channel. The pale "sheet" beside it is still visible: it is the approach's tree-free clear zone, not water. | **no** (line 720 only) |

What a pilot sees, from the pictures:
- **Seed 777777 valley (`s7-789-along`).** The third channel running back up the floor is gone, and the stream ends in a
  small lake. The other channel down the same valley is river 237, already there before round T: its head at
  -83311,-53203 carries 45.9 km². That second stream is left for the source-to-sea work.
- **Seed 1.** The long lake (`s1-1414-*`) has one outlet, with no trenches and no lines under its water.
- **Lake 70 (`s42-450`).** The pale channel leading nowhere is gone.
- **Seed 42's plain (`s42-716`).** A new 9.7 km² lake lies here (owner decision 3). Its outlet is now drawn as a stream of
  the lake's size (`x716-outlet-U`).
- **Line 720 (`777777-B720-U`).** It comes down the forested slope as a thin line, as it did before round T. The raw scar
  that `1ac0dc9` cut there is gone. It meets the approach's floor in its own channel.
- **The owner's valley (`floor`, `wind`).** As before.

### Gates

| gate | before (T0) | as handed in (`1ac0dc9`) | final (`09bd446`) | target | met? |
|---|---|---|---|---|---|
| E1 dead ends, A >= 10 km² (seed 7 too) | 3 / 2 / 3 / 3 | 0 / 0 / 0 / 0 | **0 / 0 / 0 / 0** | 0 | yes |
| E2 outlets running back into the water that fills them | 7 / 13 / 10 / 11 (34 found by outletLoops - 5 / 12 / 8 / 9 - plus the 7 dead-end loops it cannot see: 2181→602, 2187→1414 / 2250→716 / 2299→789, 2297→769 / 2620→457, 2622→567) | 0 / 0 / 0 / 0 | **0 / 0 / 0 / 0** | 0 | yes |
| E2b cycles through a lake (pond outlet into a lake whose outlet fills the pond) | not measured | **1** / 0 / 0 / 0 (seed 1: lake 48 → 434 → pond 79 → 2178 → lake 48) | **0 / 0 / 0 / 0** | 0 | yes |
| E3 line 789's catchment at its end | 130.4 km² | 53.8 | 53.8 | about 53.8 | yes |
| E3 the pond outlets' catchment (each pond's whole inflow) | (the loops doubled them) | 716's outlet 2250 6.2-7.6 km² from a 51 km² lake | 2250 50.9-52.3 km²; 602's 70.1, 738's 60.7, 1414's 59.1; 789's 64.4, 769's 118.5 | the inflow | yes |
| E4 tests/terrain/seededWorld | 21 / 21 | 21 / 21 | 21 / 21 | 21 / 21 | yes |
| C1 crease, node line vs mid-cell, in the band | 3.06x / 2.33x / 4.14x | the same | 3.06x / 2.33x / 4.14x | <= 1.5x | no (step 6 not done) |
| C2 barbed mouths > 120 deg | 138 / 126 / 157 (8.3 / 7.5 / 8.8 %) | 135 / 117 / 149 (8.1 / 7.0 / 8.4 %) | 135 / 117 / 149 (8.1 / 7.0 / 8.4 %) | <= 4 % | **no**. BARB_FIX alone gets 3.3 / 3.9 / 3.2 % but regresses three gates, so it is off. |
| C2 staircases, non-chain floor streams | 16.2 / 10.5 / 10.1 km | the same | 16.2 / 10.5 / 10.1 km | <= 2 km | **no**. CURVE_FLOORS alone gets 0.0 / 0.0 / 3.4 km but moves 517 in the owner's box, so it is off. |
| C2 non-chain floor grid share | 45.3 / 39.1 / 41.9 % | 45.7 / 39.2 / 41.9 % | 45.7 / 39.2 / 41.9 % | <= 20 % | no (34.4 / 27.7 / 31.3 % with CURVE_FLOORS) |
| line 517's elbow and hook | 58 deg turn, 146 deg mouth | the same | the same | gone | **no** (see step 3 for what each option does to it) |
| C3 painted out-and-back segment pairs | 3 / 15 / 9 | 2 / 4 / 9 | 2 / 4 / 9 | 0 | no |
| W1 rivers > 30 m over the floor beside them | 427.5 / 326.9 / 386.3 km | the same | the same | -70 % | **no**: no settle was built |
| W2 water > 10 m over its own centre ground (wallsGate class 4) | 0.2 / 0.6 / 2.7 km | 0.2 / 0.6 / 1.2 km | **0.2 / 0.6 / 1.1 km** | 0 | no: line 720 is gone from it; the rest have other causes |
| W2b water > 3 m over both drawn banks inside the airfields' reach (checker's heldOver, 20 m steps) | not measured | 4 / 0 / **206** | **4 / 0 / 18** | 0 | no: see step 4 |
| W3 settle precision | - | - | - | <= 1.5 | not built |

### Step 1: probes and baseline (`6c35d7e`)

Committed gate probes in `scripts/probes/`:
- `endsGate`: seed 7 added, and every pond made is listed with its area, centre and level.
- `outletLoops`: any lake or pond outlet whose way down, through joins, reaches a line ending in its own pool. Since
  `671eaf2` it also counts water-flow cycles through lakes and ponds (Tarjan's algorithm on line → line, line → pool and
  pool → outlet). It cannot see a dead-end filler that ended dry beside its pond, which is why the T0 baseline above adds
  7 loops by hand.
- `wallsGate`: invWalls part 2, with the scan off unless SCAN=1.
- `cornerGate`: mouths found from geometry, a GATE summary and the wiggle term.
- `creaseGate`: all three seeds.
- `paintedLoops`.

Repairs:
- `streamTurns` and `invJunctionsPainted` now find mouths from geometry.
- `waterWalls` keeps its old count (1860 / 1906 / 1780) and adds a corrected one: 1122 / 835 / 1255, of which the
  channels' own falls are 595 / 416 / 707.
- `out/fs/tools2/group.py` copied in.

The wiggle term takes chain ruler-straight from 50.4 / 43.6 / 50.7 % to 32.0 / 26.0 / 32.4 %. It takes traced grid runs
from 2100 / 1710 / 2240 km to 1545 / 1247 / 1665 km.

Timing (phaseTimes alone, median of 3, seeds **42 / 1 / 777777**): 4124 / 3992 / 4081 ms, of which streams take
559 / 547 / 587 ms.

### Step 2: bigger streams stopping short (`352e9a3`)

**Trigger.** The trigger was written as a rule and counted before anything was built. It fires on a stream that the
pond pass still leaves as a sink ('allCross', 'flat' with nothing to join, or a refused cut-back). It fires on exactly
the eight named lines and seed 7's three real cases (457, 567, 1521), and nothing else.

**What changed** (`streams.ts`, seeded worlds only):
- **FILL_DEAD_ENDS.** The hollow is filled from its pit, by a priority flood in from the water around it, up to its real
  way out. The stream ends where it first reaches the water, and the outlet runs along the flood's way out.
- **No outlet may join a line that fills its water**, or any line upstream of that. Where no way out is left, the pond
  or lake is closed and a two-sample stand-in keeps the later streams' ids.
- **A pond outlet's catchment is its pond's inflow.**
- **Decision 4 default (LAKE_BACK_CLOSED).** Three lake outlets drain only back into their own lakes, so each is cut back
  to its samples in its lake: lake 70's outlet 450 (seed 42), lake 57's outlet 431 (seed 777777), and seed 7's 457,
  which the first report left out. LAKE_RAISE (off) raises lake 70 to 283.4 m (4.44 km²) and lake 57 to 144.0 m (8.94 km²).
- **Decision 3 (POND_KEEP 3 km², POND_SILL_CUT 15 m).** Only seed 42's 716 makes a pond over 3 km², and its sill stands
  36 m over the pit, so the pond is kept. The cut-through branch fired on no seed.

**Ponds made by the dead-end rule:**
- Seed 1: 602 1.00 km², 738 0.56 km², 1414 1.44 km².
- Seed 42: 716 **9.69 km²** at 132352,-123990.
- Seed 777777: 769 0.69 km², 789 0.50 km².
- Seed 7: 567 2.19 km², 1521 0.13 km².

Total pond area went from 7.8 / 11.4 / 8.8 / 5.7 to 8.3 / 20.6 / 9.6 / 7.6 km².

**Closed ponds (no outlet), by cause, as finally shipped:**
- **The loop rule** (its only way out joined its own filler or a line upstream): 3 / 6 / 5 / 2. Seed 1 pools 78, 79 (new
  in `671eaf2`, see below) and 85; seed 42 pools 77, 78, 83, 86, 88 and 91; seed 777777 pools 69, 71, 79, 83 and 84;
  seed 7 pools 36 and 38. Also seed 777777's lake 35 (the lake-outlet pass).
- **The JOIN_TOL height guard** (the only water within reach stands 7-17 m over the pond): 2 / 0 / 2 / 0. Seed 1 pool 87
  (line 1265, 72 km², 8.9 m) and pool 92 (line 1793, 23 km², 10.4 m); seed 777777 pool 78 (line 796, 42 km², 16.6 m)
  and pool 86 (line 2193, 19 km², 7.4 m). These had a way on at T0 and are now closed lakes.
- **Its way out sank**: 1 / 2 / 0 / 0. Seed 1 pool 80 (line 510); seed 42 pool 84 (line 634) and pool 94 (line 871,
  42 km², at 101567,124783).

The first report called all of these "closed by the loop rule". The checker's render of pool 87 shows a closed lake
where there was an outlet with white rapids. That reads acceptably, but it is a judgement call for the owner (`x1-pond1265`).

**Numbers after step 2:**
- E1 0/0/0/0 and outletLoops 0/0/0/0. The lake-aware cycle was not yet counted (see the checker fixes).
- Line 789 ends at 53.8 km². Lines 602 and 716 are 2-sample stubs inside their ponds.
- seededWorld 21/21.
- Deep-notch reaches (reported only) went from 154.6 / 225.8 / 311.0 / 228.4 to 148.8 / 222.7 / **299.5** / 227.4 km
  (301.1 on seed 777777 after step 4).
- moved.py went from 1/0/3 to 3/2/6: 738, 602 / 716, 450 / 769, 789, 431. The plan named 738, 602, 716, 769 and 789. The
  other two, **450 and 431, are not in the plan's list.** They are held only under decision 2's allow-list
  (`out/fs/tools2/allow.py`: 86 % and 92 % of their moved length was a notch more than 5 m under the ground). Their real
  reason is decision 4: their lake outlets were closed. Line 431 loses 8.4 km (97 %).
- Owner's box 0/146.

### Checker fixes (`793d666`, `671eaf2`, `09bd446`)

**1. A pond's outlet carries its whole inflow (`793d666`).** fillPond cuts the filling stream back to where it first
reaches the pond's water, and its area array was cut with it. The catchment it gathered along its drowned course was
lost, so 716's 9.7 km² lake fed an outlet drawn for 6.2-7.6 km².

The fix: cutInto() records what a cut-back stream gathered past the samples it keeps (lostArea), and the inflow pass
adds it. A tributary cut into the pond from its filler's course is counted the way the network's sum would have counted
it into the filler (summed, max, or held), not twice. On seed 7, pool 26 would otherwise read 89.0 km² instead of 51.8.

Outlets after the fix:
- Seed 42: 2250 goes from 6.2 to **50.9 km²**, half-width from 2.4 to 7.6 m. 716 itself is still a 6.2 km² stub inside
  its lake.
- Seed 1: 602's pond 26.6 → 70.1 km², 738's 41.3 → 60.7, 1414's 41.0 → 59.1.
- Seed 777777: 789's 53.8 → 64.4 km² (the plan's f3 bound is ≤ 64), 769's 105.8 → 118.5.
- Seed 7: 2621 43.5 → 51.8 km², 2623 38.2 → 40.4.

No course moved.

**602's outlet is over the plan's f3 reference (≤ 50 km²).** It reads 70.1 km², made up of:
- 6.1 km² at the stub's head;
- 20.5 km² from the tributaries that now end at the stub;
- 43.5 km² lost to the pond: the head's lattice catchment ramped in (about 38 km²) plus 11.4 km² of LATERAL_GAIN along a
  5.7 km course that wound about within 1.3 km of its head.

That lateral gain probably over-counts what the hollow drains. Whether a drowned course's gain should count as pond
inflow at all is open. 716's head catchment counts the same way and lands on the plan's reference (50.9 against ≤ 51).

**2. No loop through a lake (`671eaf2`).** The guard excluded only lines, so a pond's outlet could still end in a lake
whose own outlet fills the pond. Seed 1: lake 48's outlet 434 fills pond 79 (2.5 m over lake 48), and pond 79's outlet
2178 ran back into lake 48.

The fix: poolsUpstream gives the lakes and ponds whose outlet is among the lines filling the water, then on up through
what fills them. Those are walls to outletPath, to a pond outlet's onward trace, and to fillPond's flood. A lake
outlet's own lake stays a way out, so LAKE_BACK_CLOSED decides that case as before.

Pond 79 is now closed. 2178 becomes a stand-in in its water; it is the only line that changed. From 1.6 km the scene is
unchanged (`x1-pond79-T0/-V/-U`). Physically, pond 79 and lake 48 should merge at 238.9 m. That merge is not built.

**3. Streams by the airfields stand in their own channel (`09bd446`).** FIELD_HOLD put each stream's water 1 m under the
approach-trimmed ground. But sampleTerrain trimmed after the network's carve, so the stream's bed and banks, already
carved down to the new level, were trimmed a second time. The trim is a soft minimum, so it also lowers ground under the
approach plane. Line 720 stood 6-24 m over its own bed and banks for 1.15 km, and the lowered reach cut a raw scar
40-60 m wide down the slope.

The fix has three parts:
- **FIELD_FIRST.** A seeded world's ground is trimmed under the approaches before the network carves it.
- **The blends into the flats stay after the carve.** Moving them too let a valley's walls cut 124 m under the flat's
  edge at seed 777777's field at 27520,19852. That was stepScan's first step over 100 m, so it was not done.
- **holdUnder(trim, under, near).** The water is held 1 m under the trimmed ground. Where a blend follows the carve, the
  water is held no higher than leaves its banks (HOLD_BANK 1 m) over it once blended. The cut is now taken against the
  trimmed ground; before, it was reduced by the drop, the opposite sign. The breach is recomputed from the cut, never
  wider than the channel index lists.

Line 720 now has its water 0.5-1 m under its drawn banks all down the approach (cross-sections at s 230-869; before,
the water stood 7-24 m over them). Water stands more than 5 m over its centre ground only on its first 50 m, where the
head's level is 12 m over the natural ground. That is outside the approach (approach weight 0) and was already so before
round T. The checker's heldOver went from 206 to 18 steps on seed 777777, all of them on 720's first 100 m. Seed 1's
4 steps are line 661's mouth on river 1 and two others; none of them is made by an airfield.

### Step 3: square corners, stage A (`8ba7cc3`) - built, left off; nothing changes as shipped

- **Line 517's hook.** A stream reaching a line's channel joined it at the most upstream receiver sample within 200 m.
  Coming in beside river 64, 517's last reach turned back up the river (146 deg). BARB_FIX joins such a stream further
  down instead.
- **Staircases** on non-chain streams are pinned to the slopes' channels. CURVE_FLOORS frees a raster point where the
  curve through it keeps to the ground.
- **Painted out-and-back pairs.** Two pits' flat spills over the same cells are now drawn as chords: 3 / 15 / 9 became
  2 / 4 / 9. The strand merge's redirect back up its own line is not fixed: stopping it left wet dead ends.
- **Not done:** the optional chain-stream wander.

**Each option on its own**, measured at `1ac0dc9` by the checker (`out/fs/verifyT1/gates/*-barb.log`, `*-curve.log`).
The checker fixes do not touch these code paths or line 517: the owner's box is still 0/146, and seed 42's lines changed
only at 361, 2250 and 2252.

| | BARB_FIX alone | CURVE_FLOORS alone | both on (T3, the first report's figures) |
|---|---|---|---|
| barbed mouths > 120 deg | 55 / 66 / 57 (3.3 / 3.9 / 3.2 %): met | 132 / 121 / 150 (7.9 / 7.2 / 8.5 %) | 3.3 / 3.9 / 3.1 % |
| 80-90 deg mouths | 9.3 / 6.9 / 9.2 % | 11.4 / 10.7 / 12.4 % | 9.4 / 7.3 / 9.5 % |
| staircases; grid share | 16.2 / 10.4 / 10.7 km; 47.2 / 40.4 / 43.4 % | **0.0 / 0.0 / 3.4 km; 34.4 / 27.7 / 31.3 %** | 0.0 / 0.0 / 3.4 km |
| line 517 | mouth 26 deg, but a **new 99 deg bend** at -13535,-42995 (before, its sharpest turn was 58 deg) | sharpest turn **76 deg** at -13751,-42500, mouth **149 deg** (barbed) | mouth 19 deg, an 84 deg bend |
| owner's box (146 points) | 3 move: lines 517, 1075, 1863 | 3 move, all on 517 | 517 moves |
| drawnGate (i) seed 42; bankHeight > 10 m | 95.4 % (floor 95.6); 94 / 122 / 93 (limit 92 / 121 / 90) | 95.7 %; 92 / 120 / 90 | |
| moved.py | 3 / 2 / 6 | 3 / 2 / 6 | |

**Pictures with both on (T3, an option, not shipped):**
- `v4-s42-517-elbow-T3`: the hook into the grey river is gone. But the owner's calm winding stream is straightened and
  widened, white rapids run along it, a white fall shows at its turn, and a long straight dark channel runs down the middle
  field. In this view the option fails the plan's own rule of no new white water.
- `floor-T3`: the stream runs on straight down the forest edge.
- `wind-T3`: the near reach looks the same, but the far reach takes a visibly different line (it bends left instead of
  right), not "a few metres".

The first report's "a short straight dark channel" understated all this.

### Step 4: line 720 and the airfields (`1eb8e12`, fixed in `09bd446`)

No river valley reaches line 720 (probe `carveAt`). It crosses a **generated airfield's approach**. The field is at
-14572,32553, heading 135 deg. 720's floor reach heads 129 deg about 150 m off the runway's centreline and runs past the
runway in its blend. sampleTerrain trims the ground there under APPROACH_GRADIENT by up to 55 m, and the airfields are
sited after the streams are traced. `1eb8e12` lowered the water (FIELD_HOLD); `09bd446` made the carve and the hold agree
(above). Samples held: 1098 / 96 / 203 (seeds 777777 / 1 / 42). Every thread holds the streams the same way: the
airfields are sited in heightfield.ts buildWater, which each thread runs.

**The "sheet" is still visible**, so the plan's pass rule ("no translucent sheet") is **not met**. Its cause is confirmed
by an A/B render: with the approach's clear zone switched off in a debug tree (`777777-B720-Uap0`, `fly7-720-Uap0`), the
sheet is gone and forest covers the band. So it is the approach's obstacle-clear zone (biome.ts: forest x (1 - approach)),
not water. Along transects the approach weight is 0.5-1.0 across the band. Its feathered edges are the corridor's fade
from halfW to 1.8 halfW. It hugs the river because the river runs inside the corridor, nearly along the runway's
extended centreline. Making it read as mown grass is a land-cover change, not a stream fix, and is left for the owner.
720's floor reach is still a dead-straight grey channel with white water, as before round T.

### Step 5: targeted settle - stopped at its first item

No build-time flag passes (`out/fs/T5/proxy.txt`):
- **p1** (the model's carve > 200 m off the axis) flags 3.5-4.5x the > 30 m shelf length and catches 2335 / 3108 = 75 %
  of it on seed 42.
- **p2** (coarse minus filled > 30 m) flags 4-6x. Its 65-75 % recall is inferred from the shelf-reach distribution, not
  measured on the > 30 m reaches. It fails on precision either way.
- **Their AND** can catch no more than p1's 75 % on seed 42.

Pass needs >= 80 % recall at <= 1.5x. So no SETTLE was built, river 64 is untouched (decision 1 by default), and
MODEL_VERSION stays ss6. The settled version of the owner's valley exists only as the verifier's prototype renders
(`out/fs/inv/vwalls/shots/42-valley-proto.png`, `42-wind-proto.png`).

### Must not regress (`finalS8` -> `UF`, the full battery at `09bd446`)

| | before | after | rule | |
|---|---|---|---|---|
| drawnGate (i) / (ii) / (iii) | 96.1 / 95.7 / 95.5 %; 0 / 1 / 0; 0 | 96.0 / 95.7 / 95.6 %; 0 / 1 / 0; 0 | (i) >= 95.6 / 95.6 / 95.4 | held |
| moved.py (f3 courses) | 1 / 0 / 3 | 3 / 2 / 6: 738, 602 / 716, 450 / 769, 789, 431 | named + allow-listed only | held only under decision 2's allow-list: 450 and 431 are outside the plan's named set (decision 4's closed lake outlets) |
| owner's box (seed 42, 146 points) | - | 0 moved | 0 | held |
| overGround > 10 m | 9 / 58 / 35 | 8 / 58 / 35 | <= 9 / 58 / 35 | held |
| bankHeight > 10 m | 92 / 121 / 90 | 92 / 121 / 90 | <= 92 / 121 / 90 | held |
| steps > 100 m; > 50 m | 0; 40 / 15 / 43 | 0; 40 / 15 / 43 | 0; no worse | held |
| seededWorld; airfields tests | 21 / 21; 6 / 6 | 21 / 21; 6 / 6 | all | held |
| homeCheck; riverZero; lakes | 8/8; 0.2 / 2.2 / 0.0 km; 71 / 74 / 61 | the same | unchanged | held |
| seed-42 box: slope p50, b, pits | 31.0, 1.26, 1.89 | 31.0, 1.26, 1.89 | b <= 1.3 | held |
| seed-777777 and seed-1 box b (reported) | 1.19; 1.25 | **1.35** (1.18 before step 4; 1.34 at `1ac0dc9`); **1.27** | - | moved: seed 777777's rise comes with the airfield work (FIELD_HOLD, FIELD_FIRST); its approaches lie in the box (-13000,1000 +-30 km) - not yet looked at in pictures |
| gullyGate; rillGate wet ends > 30 m | 97.8 / 96.8 / 98.5 %; 0 / 0 / 0 | the same; 0 / 0 / 0 | no worse | held |
| painted band (banddiff.py) | 1-3 km² 0.0 px, 3-10 km² 1.7 px | **not measured** (step 3 changed rills.ts for flat spills; neither the round nor its checkers re-rendered it) | not wider | unknown |
| waterWalls old count; corrected | 1860 / 1906 / 1780; 1122 / 835 / 1255 | 1856 / 1906 / 1740; 1118 / 835 / 1215 | reported | |
| presentGuard (seed 0) | passes | passes, not re-pinned | | held |
| suite | 738 / 745 | 736 / 745: 9 failures, every one "Test timed out in 5000ms" (career system 200 boards, landmarks x3, airfields x2, bedrock stones, waterFlow seed 42 x2). The seven files that time out pass 80 / 80 with --testTimeout=120000 (steepWater is now in that rerun list). The count depends on load: 8 at `1ac0dc9` (TF), 11 in the checker's run of the same code, 9 here | 738 / 745, time budgets only | not met as the plan wrote it (738 / 745); every failure is a 5 s time budget (decision 8: no budget changed) |
| build time (phaseTimes alone, median of 3, seeds 42 / 1 / 777777) | 4117 / 3978 / 4086 ms (streams 566 / 541 / 594) | 4176 / 4023 / 4178 ms (streams 570 / 572 / 625); `1ac0dc9` 4198 / 4016 / 4134 | <= +150 ms | held: +59 / +45 / +92 ms (interleaved, same session, `out/fs/UF/phase`) |

### Pictures

Before and after exist only where the shipped code changed something:
- **T2** (dead ends): `s7-789-along`, `s1-1414-end`, `s1-1414-sw`, `s1-602`, `s42-716`, `s42-450` (+ `s42-450-T2raise`, the LAKE_RAISE option).
- **U** (the checker fixes): `777777-B720`, `xB720-high`, `xB720-tod17`, `fly7-720`, `x716-outlet`, `x1-pond79`; and `s1-1414-end`, `s1-1414-sw`, `s1-602`, `s7-789-along` again (their outlets widened: they look as T2).
- **Every other view renders the same as T0 as shipped** (checker V renders, 0.02-0.48 %): `floor`, `v4-s42-517-elbow`,
  `wind`, `s1-1265`, `h42-438`, `s42-479-close`, `42-V141`, `1-V194`, `777777-V239`, `777777-V215`, `1-V181`, `42-V64`,
  `42-valley-head`, `42-L2-head`, `w42c-17` and the references.

What a pilot sees:
- `s7-789-along` (T0 / T2): the third channel running back up the floor is gone, and the stream ends in a narrow new lake.
  The other channel down the valley is river 237, as before.
- `s1-1414-end`, `s1-1414-sw` (T0 / T2): one outlet leaves the lake's far end. The twin trench, the dark lines under the
  water and the shore trench are gone.
- `s1-602` (T0 / T2): nearly the same: a lake fed by a stream, its east bay gone.
- `s42-450` (T0 / T2): lake 70 without its pale channel to nowhere.
- `s42-716`, `x716-near`, `x716-east`, `fly42-716`: a lake about 6 km long (9.7 km²) where there was a small pond (owner
  decision 3).
  - From 2.7 km south (`x716-near-U`) its near shore is a ruler-straight line about 4 km long, with rectangular fields and
    a poplar row running parallel to it right to the water. It looks man-made.
  - From the south-east (`x716-east-U`) and from the cockpit it reads as a natural oval lake.
  - Line 716 itself is a stub inside it, so this valley's stream has been replaced by a lake.
- `x716-outlet` (T0 / V / U): the lake's outlet now leaves its SW end as a visible blue channel into the wooded river.
  In V it was a thin line.
- `777777-B720`, `xB720-high`, `xB720-tod17`, `fly7-720` (T0 / T4 = V / U):
  - V had a raw bare scar about 40-60 m wide, with a dark slot, down the forested slope. In U it is gone: 720 is a thin
    line in the forest as at T0.
  - The pale clear zone beside the floor reach is still there in every view, and plain from the cockpit.
  - `-Uap0` (debug, not shipped) shows it gone with the clear zone off.
- `x1-pond79` (T0 / V / U): no visible change from 1.6 km.
- Unchanged and still faulty (owner input):
  - `h42-438`: an unfed stony head starting mid-slope, the likely next meaning of "stopping short".
  - `s42-479-close`: ring grooves.
  - `fly7-720`: the zigzag grey channel out of the left window.
  - `42-V141`: a grey river with rapids on a shelf, with a dry pale hollow below.

### Constants and owner decisions (defaults)

| constant (file) | default | what the other setting does |
|---|---|---|
| FILL_DEAD_ENDS (streams.ts) | true | false: the dead ends stay dead |
| POND_KEEP 3 km², POND_SILL_CUT 15 m, BIG_POND_KEEP (streams.ts) | 3 / 15 / false | decision 3: only 716 is affected, and it is kept anyway (sill 36 m) |
| LAKE_BACK_CLOSED (streams.ts) | true | decision 4: false leaves 450 / 431 / seed 7's 457 as dead ends |
| LAKE_RAISE (streams.ts) | false | decision 4: true raises lake 70 to 283.4 m (4.44 km²) and lake 57 to 144.0 m (8.94 km²) |
| BARB_FIX, BARB_ANGLE 105 deg (streams.ts) | false | alone: barbed 3.3 / 3.9 / 3.2 %, 517's mouth 26 deg but a new 99 deg bend at -13535,-42995; drawnGate seed 42 95.4 %; bankHeight 94 / 122 / 93; box: 517, 1075, 1863 move |
| CURVE_FLOORS, FLOOR_PASSES 4, FLOOR_LAY 90 m, FLOOR_KEEP_END 3 (streams.ts) | false | alone: staircases 0 / 0 / 3.4 km, grid 34 / 28 / 31 %; 517's sharpest turn 58 → 76 deg and its mouth 146 → 149 deg; 3 of its box points move |
| both on | - | `v4-s42-517-elbow-T3`: the owner's calm stream straightened, with white rapids and a fall (fails the wind rule) |
| FIELD_HOLD, FIELD_FIRST, HOLD_BANK 1 m (heightfield.ts) | true / true | false: streams stand over the approaches (FIELD_HOLD), or over their own trimmed banks (FIELD_FIRST) |
| SETTLE | not built | step 5 stopped; decision 1 (river 64 held out) is the default in effect |
| decision 2 | allow-list | `out/fs/tools2/allow.py`; 450 and 431 are held only under it (their real reason is decision 4) |
| decision 3 | keep the 716 lake | show the owner `x716-near-U` (straight man-made-looking south shore) and `x716-east-U` (natural) |
| decisions 6, 7, 8 | as the plan | rillGate (iii) reported (8.7 / 7.2 / 10.5 per 100 km); W1 counts > 30 m (the 10-30 m band is 812.9 / 654.7 / 919.3 km); no time budget changed |

### Not done

- **Square corners: the owner's request is unmet as shipped.** Line 517's elbow and hook, the s1-1265 staircase, the
  sawtooth bank in h42-438 and the zigzag channel by 720 are all unchanged. BARB_FIX and CURVE_FLOORS each fix part of it
  but regress other gates, and together they break the owner's calm stream. Step 6 (C1 crease) waits for the owner.
- **Raised rivers: the owner's request is unmet as shipped, apart from line 720.** There is no settle (W1 427.5 / 326.9 /
  386.3 km unchanged), and the owner's valley still has two rivers.
- **The B720 sheet** (the approach's clear zone) is still visible.
- **W2** 0.2 / 0.6 / 1.1 km remain, from other causes (seed 777777 river 6 48.6 m at -107098,67358, among others). Line
  720's first 50 m stand 5-7 m over their banks (its head's level, as before round T).
- **C3**: 2 / 4 / 9 painted out-and-back pairs remain.
- **Pond 79 and lake 48 (seed 1)** should merge. Pond 79 is closed instead.
- Also not done: closed ponds whose way on was refused by the JOIN_TOL guard (seed 1 pools 87 and 92, seed 777777 pools
  78 and 86); river 237 beside 789; the unfed head at h42-438; the ring grooves at 479; the deep-notch reaches; the
  chain wander; doubled valleys (not measured).

### Commits

| commit | what |
|---|---|
| `6c35d7e` | step 1: gate probes, repairs, cameras, baseline numbers |
| `352e9a3` | step 2: dead ends filled, no outlet loops, lakes 70 / 57 / seed 7's closed (LAKE_RAISE option), outlet catchments |
| `8ba7cc3` | step 3: BARB_FIX and CURVE_FLOORS (off), flat spills drawn as chords |
| `1eb8e12` | step 4: streams held under the airfields' cut ground (FIELD_HOLD) |
| `26a1f90`, `1ac0dc9` | report as first handed in |
| `793d666` | checker fix: a pond's outlet carries what its filler gathered along the drowned course |
| `671eaf2` | checker fix: no pond outlet runs into a lake upstream of its filler; outletLoops counts cycles through lakes |
| `09bd446` | checker fix: approaches trimmed before the network's carve, held streams in their own channels (FIELD_FIRST) |
| (this) | report and picture notes corrected to the shipped code; finalS.sh reruns steepWater with the long timeout |

## Round T repairs: pond inflow, streams into standing water, line 720 by KPMH, slow tests (`f654e1c` .. `cc7f23a`)

The round-T checkers found four regressions at `3f9d795` (code `09bd446`). Each is fixed in its own commit.
verifyR1 then checked these repairs and found six problems; they are answered in "Second pass" at the end of this
section (`0911f22` .. `f168159`).

Before and after:
- **Before** is `3f9d795`. Its pictures are verifyT2's `-F` renders (`out/fs/verifyT2/pictures`, the same code)
  and this round's `-R0` renders of a copy of it (`out/fs/trees/R0`).
- **After** pictures are `-R1` / `-R2` / `-R3`, rendered from copies of each commit (`out/fs/trees/R1..R3`).

Where things are:
- Probes: `out/fs/R/probes`. Logs: `out/fs/R`. Pictures and crops: `out/fs/R/pictures`.
- Renders used port 5222: the shot tool's own vite, one shot at a time, now stopped. A render whose log says
  "preload timed out" (machine under other jobs' load) is not used as evidence. Those are `xR692-R3`, `fly7-final-R3`,
  `xB720-high-R0` and `x567-entry-R2`; `fly7-abeam-R3` and `xR720-low-R0` are used only where they look complete.
- Final battery: `out/fs/finalR` (`finalS.sh finalR suite`, then `extrasR.sh` = extrasU.sh into finalR).

### Short version

| item | verdict | what a pilot sees |
|---|---|---|
| 1. pond inflow double count | **fixed** | 602's outlet and river 232 are drawn for 49.6-51 km², not 70-72; slightly narrower water in the wooded corridor |
| 2. trench and water wall under standing water | **partly: fixed for 602 and wherever the banks hold, about half the cases (70 streams raised; shore steps > 1 m 98 -> 47 and trench > 3 m 27.8 -> 8.8 km over four seeds); not fixed for the 53 blocked runs, among them round T's named pool 26 (567, 15 m under its pond) and 738** | at 602 the dark line across the lake is gone, and the inflow meets the lake level in a shallow channel; the blocked inflows look as before |
| 3. line 720 by KPMH | **dry reach fixed; ladder and sawtooth not fixed** | the stream flows in its own channel beside the runway all the way; the stepped pools and the serrated bank on the approach reach are unchanged |
| 4. slow tests | **done** | - |

### 1. Pond inflow (`f654e1c`): fixed

**What was wrong.** A pond outlet's inflow added the filler's lost area (what it gathered along the course the pond
drowned) on top of its end area after the network's sum. 602's end had already been raised to its tributary
1853's 26.6 km² by the max rule, so the sum was max(6.1, 26.6) + 43.5 = 70.1. It should be
max(6.1 + 43.5, 26.6) = 49.6.

**The fix.** The sum now mirrors each stream's end with its lost area counted as its own catchment (`endLost`, with
the same sum, max and continuation steps). The inflow takes the difference (`lostGain`).

**Numbers** (`out/fs/R/pondIn-item1.log`, `receivers-item1.log`, the same at the final code in `receivers-final.log`):

| | before | after |
|---|---|---|
| outlet 2181 (seed 1 pool 82) | 70.1..71.6 km², hw 8.6 m | 49.6..51.2 km², hw 7.6 m |
| river 232 below the junction, 0 / 0.5 / 1.0 / 1.5 / 2.0 / 2.5 km | 71.6 for 3 km (hw 8.7 m) | 51.2 / 51.2 / 51.2 / 51.2 / 52.1 / 53.3 |
| f3, about the same places (verifyT2 receivers.txt) | 49 / 49 / 49.3 / 51.1 / 52.7 / 54.1 | |

The check outlets are unchanged: 716's 2250 50.9 km², seed 7 pool 26's 2621 51.8, 1414's 2188 59.1, 738's 2185 60.7,
789's 2299 64.4, 769's 2297 118.5, and every other pond outlet on seeds 1 / 42 / 777777 / 7. drawnGate is unchanged.

**Picture.** `cmp-r602-outlet-R0vsR1.png` (`r602-outlet-R0/-R1`) looks from 600 m at the outlet and river 232's wooded
corridor south-west of the pond. The water ribbon in the trees is a little narrower; nothing else changed (0.10 % of
pixels, all along that corridor).

### 2. Streams into standing water (`527cde0`): fixed where the banks hold, not for the blocked inflows

**The rule** (riverNetwork.ts `AT_THE_SURFACE`, after the pitches). Where a stream runs into a lake or pond
(LakeMask's domain):
- Its water there stands at the lake's surface, with no cut and no breach, so there is no channel under the lake's
  bed.
- On the way in, the lake backs its channel up to that level. The whole reach is raised or none of it.
- It is raised only where every sample's banks hold the level: the lower natural bank, at its half-width + 25 m, no
  more than 2 m under it, or in the lake.
- A run whose backwater is blocked keeps all its levels, inside the water too. Water may not rise downstream: raising
  only the inside made lines rise downstream (seededWorld failed on five seeds), and an unconditional backwater put
  overGround > 10 m at 52 / 76 / 119.
- Streams joining a raised reach get the same backwater. Falls and lips on a reach that is now level are removed.

The terrain also no longer paints a channel's bed, banks or bank trees under a seeded world's lake water
(tileBuilder.ts). verifyT2's "dead-straight dark line" across 602's lake was this paint as much as the trench: with
the trench gone and the paint still on, the line was still there.

**Seed 1, 602.** Line 1853 ran 12.2 m under the pond (173.1 vs 185.3 m) in a dead-straight trench 14-16 m deep. It ran
430 m through the shore's tree belt (natural ground 185.4-191 m), then 820 m under the lake. It now stands at 185.3 m
from s 4711. Through the tree belt its channel is 1.6 m deep. Under the lake the ground is the lake's bed (it was cut
3-11 m into it). See `tail1853-v1.log`.
- `cmp-x602-drown-FvsR2.png` (500 m over the lake): the dark line from the east shore across the water is gone. Only
  a faint shallow groove about 200 m long remains at the mouth, the stream's bed where the lake is shallow.
- `cmp-x602-face2-R0vsR2.png` (about 40 m over the wood, down the tail to the lake): before, a deep straight canal
  with dark steep walls, its water well under the lake. After, a shallow straight channel whose water is level with
  the lake and runs into it. The course is still dead-straight: truncate's tail to 602's stub is unchanged.
- `x602-1853` (330 m) and `x602-mouth` (2 km): the inflow is hidden in its tree belt in both.
- `s1-602` (4 km): the same as before (0.06 %).

**Every seed** (`underLake.test.ts`; streams; seeds 1 / 42 / 777777 / 7; `underLake-before.log` -> `underLake-item2.log`):

| | before | after |
|---|---|---|
| channel carved > 3 m under a lake's bed, under water | 4.64 / 9.68 / 8.38 / 5.06 km | 2.28 / 2.57 / 3.33 / 0.64 km |
| ... > 1 m | 7.17 / 13.85 / 10.77 / 8.53 km | 3.53 / 5.21 / 4.96 / 2.97 km |
| stream water > 3 m under the surface inside a lake | 17.88 / 32.60 / 25.99 / 18.63 km | 4.43 / 5.72 / 6.79 / 2.69 km |
| shore steps (water under the surface on the way in) > 1 m | 19 / 26 / 29 / 24 | 13 / 11 / 13 / 10 |
| ... > 5 m | 12 / 19 / 20 / 15 | 10 / 9 / 12 / 5 |
| streams raised (km of samples) | - | 12 / 22 / 17 / 19 (17.4 / 36.4 / 41.7 / 25.9 km) |
| blocked runs (the remaining steps and trenches) | - | 14 / 13 / 15 / 11 |

The rivers are unchanged. Their trench is 0 / 0.48 / 0.08 / 0 km, and seed 777777's river 15 runs 3.1 m under lake 1
for 6.6 km.

**Not fixed: the blocked inflows.** The stream pass filled a pond at each of these streams' ends, on its routing
ground, and the pond stands over the stream's banks, so raising the water would stand it over them.
- Most of these streams climbed out of their hollow through a notch: their cut on the last kilometre is up to 97 m,
  and the water in the notch kept the hollow's level.
- The rest run in a valley whose banks are lower than that pond.
- Seed 1: 1793 (26.1 m step), 1265 (25.6), 729 (20.9), 510 (19.2), 590, 1268, **738** (4.5), 1760.
- Seed 42: 557, 569, 702, 479, 797, 719, 494, 514.
- Seed 777777: 1814 (53.8), 2157 (38.3), 646, 1640, 2193, 818, 694, 796, 2075, 2255.
- Seed 7: 571, **567** (15.3), 2611, 781, 2338, 610, 2392, 478, 2170.

**738 and 567 are round T's own FILL_DEAD_ENDS ponds**, and pool 26 (567) is one of the named cases. So the
claim that those named dead ends "end in water" holds only in that the line ends in the pond's domain. 567's water
reaches the pond 15 m under its surface, in a notch 18-20 m deep. That is how it was before this repair.
- `x567-pond26-R0/-R2` (100 m up, 700 m off): two tree-lined corridors run to the pond. The notch is under the
  trees and no wall shows. The two renders are the same (0.09 %).
- `x567-entry-R0` (18 m over the field at the notch's end): a small pool ringed by trees in a field. The R2 render
  of that camera is degraded, and the pond itself is out of shot, so this picture neither shows nor rules out a
  wall at the shore.
- `x729-shore-R0/-R2`: the same (0.05 %); the notch is hidden in its tree belt.

Fixing these needs the pond pass to see the drawn ground, not the routing ground: these ponds stand over the notch
that drains them. That is a pond-pass change with lake ripple, not made here.

**Gates.** overGround > 10 m stays 8 / 58 / 35. drawnGate (i) stays 96.0 / 95.7 / 95.6 %, outletLoops and cycles 0,
seededWorld 21 / 21. endsGate is unchanged apart from the climbed reaches: 148.8 / 222.7 / 301.1 / 227.4 ->
148.8 / 220.5 / 295.7 / 224.8 km.

### 3. Line 720 by KPMH (`d2e6c40`): the dry reach is fixed; the ladder and the sawtooth are not

**Cause of the dry reach.** It was the blend into the field's flat, not the approach trim. 720 runs about 165 m off
the runway's centreline: 142-156 m from the runway rectangle, inside flatMargin 70 + blend 320. There the blend
weight is 0.08-0.12. The blend follows the network's carve, so it pulled the carved bed and banks up to the field's
elevation (405.7 m). fieldUnder had held the water at 404.6 m, so the bed stood over the water.

**The fix, option (a).** After the blends, a seeded world's streams are cut again into the blended ground with
carveNetwork's bed and banks (heightfield.ts `keepChannels`, `FIELD_CHANNEL`). It is weighted by how far the blends
moved the ground as carved: nothing where they left it, all of it from 1 m. The flats themselves are untouched (no
traced line crosses one), and so is seed 0. Siting is unchanged (option (b) was not needed), so no seed board
changes: the airfields, seededWorld and landmarks tests pass and homeCheck is 8/8.

**Numbers.**
- Line 720, every 10 m from s 1400 to 2700: dry at its centre 1130 m -> 0 m. Beside the runway its water is 1.1-1.5 m
  under the banks (404.6 m against 405.7-406.0 m). At the SE end, where it falls to 388.5 m in the blend, it is 2-3 m
  under them (`line720-fine-1400-before.log` / `-after.log`).
- verifyT2's dryNear (water hidden under the ground within a field's reach): 1674 / 395 / 87 -> 120 / 115 / 87 m on
  seeds 777777 / 42 / 1. 720 goes 1111 -> 0, 734 397 -> 0, 1727 47 -> 0, seed 42 692 280 -> 0. What is left is
  rivers 5, 7, 39 and 106 at 0.2-0.9 m, and seed 1 line 435's head (`dryNear-item3.log`).

**Pictures.**
- `cmp-xR720-zoom-FvsR3.png`: before, the white water stops at the runway's NW end and a pale dry bed runs beside the
  runway for about 1 km. After, dark water runs on in its channel past the runway and beyond.
- `cmp-xR720-low-R0vsR3.png` (115 m over the runway, looking SE): before, a pale dry bed; after, a blue stream in its
  own channel with grass banks. The dark gash on the slope to the right is in both.
- `cmp-xR734-zoom-FvsR3.png` (KHLT): 734's water is drawn again (dryNear 397 -> 0 m). It shows as pale and white
  streaks in the channel, and from this zoom it is not settled whether that reads as a stream or as a pale scar. The
  channel's straight course and corners are as before.
- **The pale "sheet" is not water.** In `777777-B720-R3`, `xR720-low-R3` and the cockpit view `fly7-abeam-R3` the
  clear zone reads as a mown, pale-green clearing with feathered edges: no reflection, no blue. From B720's angle its
  whitish tint still reads somewhat like a haze band.
- `cmp-B720-bank-FvsR3.png`: the zigzag reach by the runway (top left) now has water in it. **The ladder of
  rectangular pools and the serrated right bank on the approach reach are unchanged.** That reach has blend weight
  1.0, so it is not the blend.
  - The fine profile there (`line720-fine-before.log`, every 5 m from s 550 to 1600) shows flat pools (samples 134-136,
    145-146 and 156, 40-130 m long) between steeper runs. The water is 1-2.5 m under its banks and wet throughout.
  - An A/B with the held line's pitch units off (`777777-B720-R3dbg.png`, `cmp-B720-bank-R3vsDbg.png`, debug tree,
    not shipped) changes only two small spots, so it is not the pitch units.
  - The cause was not found. The likeliest is the held level's staircase: holdUnder's running minimum of a target
    that rises and falls as the stream weaves across the approach corridor. That is not verified.

### 4. Slow tests (`cc7f23a`): done

**The suite.** This branch's suite has always been tests/terrain, tests/world, tests/era and tests/career (745 tests,
as in finalS.sh). Here it was run with vitest's default file parallelism, which makes it the "full parallel suite".
A whole-repo `npx vitest run` was started first. It finished 56 of 457 files in 22 minutes, with timeouts in
aircraft, rotorcraft and fauna files this branch does not touch. It was stopped, and those files are left alone
(`wholerepo-partial.log`).

**Run 1, no change** (`suiteP-1.log`): 20 of 745 failed, 19 of them "timed out in 5000ms", in nine files. Their slowest
test ran to completion in this many seconds:

| file | slowest test | limit set |
|---|---|---|
| tests/terrain/airfields.test.ts | 23.8 s | testTimeout 60 s |
| tests/terrain/steepWater.test.ts | 23.0 s | 60 s |
| tests/terrain/seededWorld.test.ts | 22.8 s | 60 s |
| tests/terrain/waterFlow.test.ts | 22.2 s | 60 s |
| tests/terrain/bedrock.test.ts | 22.1 s | 60 s |
| tests/career/landmarks.test.ts | 25.2 s | 60 s |
| tests/career/system.test.ts | 21.8 s | 60 s |
| tests/terrain/rills.test.ts | 13.5 s | 30 s |
| tests/career/jobsW4.test.ts | 6.9 s | 20 s |

**Run 2** (`suiteP-2.log`): all nine passed. tests/career/jobs.test.ts then failed a beforeAll on the 10 s hook default,
so it gets hookTimeout 60 s.

**Run 3, all ten** (`suiteP-3.log`): every test under these limits passed. The slowest were 55.1 s (system, seed 7),
52.3 s (steepWater) and 24.6 s (rills), so 60 s and 30 s are the margin chosen, not a minimum. Run 3 ran under other
jobs' load on the machine (another worktree's vitest and Chrome renders) and was 40 % slower than run 1. That load
also broke tests this commit leaves alone: pre-existing 30 s / 60 s limits (features, worldSeed, the rills and
seededWorld determinism tests) and era/career tests that pass in runs 1 and 2.

**Left alone.** tests/terrain/heightfield.test.ts "is fast enough for the physics" fails under parallel load on its
assertion (10.1 µs against 10 µs). That is not a time limit.

**Validation.**
- The nine testTimeout files were validated by runs 2 and 3, and jobs.test.ts by run 3.
- Run 4, at the final commit (`suiteP-4.log`, on a quieter machine): **745 / 745**. The slowest tests under the new
  limits were 22.9 s (airfields), 23.9 s (landmarks) and 16.1 s (system, seed 7).
- The battery's suite (`--no-file-parallelism`, below) also passed 745 / 745.

### Battery (`out/fs/finalR`, the code at `d2e6c40`; tests at `cc7f23a`) against round T's final (`out/fs/UF`)

| gate | round T final (UF) | after the repairs (finalR) | rule | |
|---|---|---|---|---|
| dead ends, endsGate IG_MIN 10 (seed 7 too) | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 | held |
| outlet loops; cycles through lakes | 0; 0 | 0; 0 | 0 | held |
| overGround > 10 m | 8 / 58 / 35 | 8 / 58 / 35 | <= 8 / 58 / 35 | held |
| steps > 100 m; > 50 m | 0; 40 / 15 / 43 | 0; 40 / 15 / 43 | 0 | held |
| riverZero | 0.2 / 2.2 / 0.0 km | 0.2 / 2.2 / 0.0 km | no worse | held |
| lakes | 71 / 74 / 61 | 71 / 74 / 61 (ponds made and their sizes unchanged) | the same | held |
| drawnGate (i); (ii); (iii) | 96.0 / 95.7 / 95.6 %; 0 / 1 / 0; 0 | 96.0 / 95.7 / 95.6 %; 0 / 1 / 0; 0 | (i) >= 95.6 | held |
| wallsGate class 4 (water > 10 m over its centre ground) | 0.2 / 0.6 / 1.1 km | 0.2 / 0.6 / 1.1 km | no worse | held |
| heldOver (> 3 m over both banks by the fields) | 4 / 0 / 18 | 4 / 0 / 18 | no worse | held |
| bankHeight > 10 m | 92 / 121 / 90 | 92 / 121 / 90 | no worse | held |
| waterWalls old; corrected | 1856 / 1906 / 1740; 1118 / 835 / 1215 | the same | reported | held |
| homeCheck | 8/8 | 8/8 | 8/8 | held |
| moved.py (f3 courses) | 3 / 2 / 6 | 3 / 2 / 6, the same lines | reported | held |
| gullyGate, rillGate, cornerGate, creaseGate, paintedLoops | | identical logs | no worse | held |
| climbed reaches (endsGate, reported) | 148.8 / 222.7 / 301.1 / 227.4 km | 148.8 / 220.5 / 295.7 / 224.8 km | reported | less |
| seed boxes b; pits10 (validate) | 1.27 / 1.26 / 1.35; 2.92 / 1.89 / 1.97 | 1.27 / 1.26 / 1.35; 2.92 / 1.89 / 1.94 | b <= 1.3 (seed 42) | held |
| seededWorld; airfields tests; presentGuard (seed 0) | 21 / 21; 6 / 6; passes | 21 / 21; 6 / 6; passes, tests/fixtures and tests/era untouched (never re-pinned) | all | held |
| suite (finalS.sh: four directories, --no-file-parallelism) | 736 / 745 (9 time budgets) | **745 / 745**; the seven slow files' rerun with --testTimeout=120000 80 / 80 | 738 / 745 | met |
| build time (phaseTimes alone, median of 3, seeds 42 / 1 / 777777) | | not measured cleanly: the machine carried other worktrees' jobs throughout. Interleaved medians (`out/fs/R/phase.log`) were 5.9 / 5.6 / 5.7 s before (`out/fs/trees/R0`) and 6.0 / 5.9 / 6.0 s after (R3), about 40 % over round T's quiet 4.1 s, and single runs varied by up to 1.9 s | reported | |

### Left

- **Item 2's blocked inflows** (53 runs over the four seeds, including FILL_DEAD_ENDS ponds 567 / pool 26 and 738).
  These are streams that climbed out of their hollow through a notch into a pond the stream pass filled on its routing
  ground. The fix belongs in the pond pass.
- **1853's tail** to 602's stub is still a dead-straight 430 m channel through the shore's wood (truncate's run-on to
  a cut-back filler's new end). It is now shallow and at the lake's level.
- **720's approach reach**: the ladder of stepped pools and the serrated right bank (cause not found; not the blend,
  not the pitch units). The zigzag square-cornered channel by the runway is still there, now with water in it.
- Seed 1's 2188 -> 692 is still +61 km² over f3 at the junction (verifyT2). 1414 is not an f3 line; not looked at here.
- tests/terrain/heightfield.test.ts's speed assertion under parallel load.
- Seed 777777's river 15 runs 3.1 m under lake 1 for 6.6 km (rivers are outside item 2's rule).
- Not rendered: a river through a drainage lake after item 2's paint change (no channel bed, banks or bank trees
  painted under any seeded lake's water, rivers included). River 15 through lake 1 is the case to look at.

### Commits

| commit | what |
|---|---|
| `f654e1c` | item 1: a pond's inflow counts a filler's drowned course as its own catchment, ahead of the streams joining it |
| `527cde0` | item 2: streams into standing water stand at its surface (where their banks hold it); no channel paint under a lake |
| `d2e6c40` | item 3: a traced stream keeps its channel through a field's blend into its flat |
| `cc7f23a` | item 4: time limits for the ten files that ran over their budget in a full parallel suite run |
| (this) | report |

### Second pass: verifyR1's six problems (`0911f22` .. `f168159`)

verifyR1 checked the repairs above and found six problems: its pictures are in `out/fs/verifyR1/pictures`, its code
checks in `out/fs/verifyR1/gates-code`. Each problem was confirmed here before any work on it.

Where things are:
- Probes: `out/fs/R2/probes` (run with `--config out/fs/R2/probes/vitest.config.ts`). The new committed probe is
  `scripts/probes/junctionGate.test.ts`. Logs are in `out/fs/R2` (untracked).
- Pictures: `out/fs/R2/pictures`, rendered from the worktree on port 5222 (the shot tool's own vite, one shot at a time,
  started and stopped per shot; `out/fs/R2/shots.sh`, cameras in `out/fs/R2/views.txt`).
  - `-p1` is after the raise (`c662af9`'s code), `-p2` adds earth banks, `-p3` the neighbour cap (`d0f5c9e`), and
    `-p4` is the final code (`f168159`).
  - Before is verifyR1's `-A` (`00866e4`, code `d2e6c40`) or its gates-code `-VH` (the same code).
  - No render log says "preload timed out" or "never set window.__ready". Nothing is left running on 5222.
- Battery: `out/fs/finalR2` (`finalS.sh finalR2 suite`, then `out/fs/extrasR2.sh`).

#### Short version

| problem | verdict | what a pilot sees now |
|---|---|---|
| 1. KHLT, line 734: a 9 m V gully with its water hidden | **fixed** (`c662af9`, `d0f5c9e`, `f168159`) | a small stream with water in a shallow channel down the approach slope; no pale smear |
| 2. 720 by KPMH: pale scallops on the far cut bank | **fixed** (`0b40438`, `f168159`) | a continuous blue-grey stream with a thin earthy bank line; no teeth or fans. From the cockpit the reach by the runway still reads as a grey beaded line, from its corners (problem 3) |
| 3. 720's approach reach: ladder of pools, serrated bank, pale band; square corners by the runway | **not fixed** | as before; the cause is now measured |
| 4. 567 into pool 26 reads dry | **not fixed** | as before |
| 5. AT_THE_SURFACE: water running uphill at junctions | **fixed for 474 -> 2267** (`0911f22`); the two step-ups inside lakes are drowned mouths of blocked inflows, the same case as problem 6 | no visible change: the junction is under canopy |
| 6. 567's wall of water at pool 26 | **not fixed** | as before: a blue sheet where the notch meets the pond |

#### 1. KHLT, line 734: fixed

**Confirmed.** verifyR1's `profile-734across-A.log` crosses 734 at 19950..20060,31780 at `d2e6c40`. It is a V 9 m
deep and about 30 m across: ground 396.5 m 13 m off, 387.6 m at the centre, 402.1 m 20 m the other side, water
388.2 m. `cmp-xR734-low-BvsA.png` shows it from 60 m as a broad pale band.

**Cause.**
- KHLT, at about 414.6 m, stands above 734. Its blend into the flat follows the carve, so it raised the ground over the
  stream. At s 220 the blend weight is 0.62 and the ground rose about 9 m.
- `d2e6c40` cut the stream back into that ground at its own level, with the network's stream banks. Those are rock
  walls at 30-50 degrees, so the cut opened into a V as deep as the blend had raised the ground.

**The fix.**
- FIELD_RAISE (`c662af9`; heightfield.ts `fieldOver`, riverNetwork.ts `holdUnder`): where a field's blend raises the
  ground over a stream, the stream's water rises with it, to where the blended ground stands no more than RAISE_UNDER
  (1.5 m) over it.
  - A blend of weight k towards the field's elevation E leaves ground h at E + (h - E) k.
  - The target is the lower of two levels. One is E + (t - E) k - 1.5, where t is the ground the stream was levelled
    on, trimmed under the approaches. The other is E - (1.5 - 1.3 k) / (1 - k): where that ground stands higher, the
    carve leaves the banks 1.3 m over the water.
  - A raise never goes over the water above it. A stream joining a raised reach is backed up to it, receivers first.
  - The carve no longer builds a stream's banks up by what the blend will add (`blendLift`). Built up first and then
    blended, they stood 5-7 m over the raised water.
- `d0f5c9e`: a raise stays within RAISE_BESIDE (1 m) of another stream's water beside it. 1727 runs beside 734, 8 m
  bank to bank, for its last 40 m before joining it. Raised alone, 734 stood 3 m over 1727 with a 4-5 m wall between
  them.
- Problem 2's earth banks (`0b40438`, `f168159`) shape the cut.

**Numbers.**
- 734's water at s 160-220 is 396.3 m; it was 388.2 m.
- Its banks at hw + 3 m are 1-1.5 m over the water from s 80 to s 400 (`line734-p3.log`).
- Across at s 220 (`profile-734across-p4.log`):
  - ground 397.3 m 5 m off;
  - 395.7 m at the centre, with the water at 396.3 m;
  - then rising 1.4 m every 4 m on the other side (398.0, 399.4, 400.8 m).
  - Beyond 6 m it is the field's slope as before the repairs.
- Steepest bank face (`fieldFaces`, problem 2's table): 734 over 35 degrees 470 -> 160 m, over 45 degrees 360 -> 30 m.
- Lower ground at hw + 12 m standing more than 7 m over the water (`fieldBanks`): 734 200 -> 0 m.

**Pictures.**
- `cmp-xR734-low-AvsP4.png`, 60 m up on verifyR1's camera.
  - Before: a pale translucent band 25-30 m wide lies down the approach slope, with no water in it.
  - After: a thin stream with water, grey-blue with white flecks where it steepens, runs down the slope in a shallow
    channel. A thin brownish line follows its far bank.
- `cmp-k734-close-HvsP4.png`, 500 m: the pale V scar from the approach down to the river is gone. A faint thin line
  runs down the slope, which is how a stream 3-5 m wide looks from there.
- `cmp-xR734-zoom-AvsP4.png`, 800 m, zoomed 2.5 times: before the repairs (`-B`) a narrow brown dry groove; at `-A` a
  broad pale feathered smear; now a thin dark line down the approach corridor, with a faint pale wisp at its head and
  near its foot.
- `cmp-k734-mouth-HvsP4.png`, the same camera zoomed 2.5 times on the mouth: 734 runs down to its receiver with water,
  white water and an earthy far bank. The dark sawtooth at its junction with 1727, seen at `-p2` before `d0f5c9e`, is
  gone.

#### 2. Line 720 by KPMH: the pale scallops are fixed

**Confirmed.**
- verifyR1's `profile-720across-s2000-A.log` shows a channel 4.4 m deep, its far (SW) face rising 4.4 m in about 9 m.
- verifyR1's pictures (`cmp-xR720-comb-BvsA.png`, `cmp-xR720-side-comb-A.png`, `cmp-xR720-obl-ne-BvsA.png`) show a
  regular row of pale scallops along it.
- A land-cover debug render (`xR720-comb-dbg1.png`, terrain debug view 1, albedo by cover weight) still shows the band
  pale with every cover weight zero. So it is light off the face, not cover paint. The bank's wet-gravel paint has a
  roughness of 0.45, and the face is steep.
- The scallops are the bank profile itself. `streamBanks` is a gorge's rock wall, with ledges and buttresses that
  change along the stream every few tens of metres.

**The fix** (heightfield.ts `keepChannels`, `fieldBanks`).
- `0b40438`: the cut through a blend keeps the bed and the low strip, then an earth bank rising at FIELD_BANK_SLOPE
  (0.35), with no noise and no ledges.
- `0b40438`: the cut's weight is now how far the blend moved the ground at the stream's water, (1 - k) |E - level|,
  which is smooth along the stream. Before, it was how far the blend moved the ground at the point, which followed the
  carved ledges.
- `0b40438`: the cut keeps the ground over another stream's water only on that stream's own banks (FIELD_KEEP, 6 m).
- `f168159`: the earth bank is cut fully only out to 8 m beyond the low strip, then fades out over 16 m. Carried on at
  0.35 it reached a hillside 75 m off 720's SE reach. The nearest segment's water level changes from one 4 m cell to
  the next along the winding course, so it cut that hillside as a row of teeth (`p720-se-p3`).
- Problem 1's raise also takes the 3.7 m drop at s 1980-2080 down to 0.5 m. The water is at 404.6-404.05 m to s 2290,
  with its banks 1.8-2 m over it.

**Numbers.** `fieldFaces` takes the streams in a field's blend every 10 m and measures the steepest slope across hw ..
hw + 15 m:

| | over 35 degrees | over 45 degrees |
|---|---|---|
| seed 777777 | 1730 -> 240 m | 1370 -> 40 m |
| 720 | 1180 -> 60 m | 950 -> 0 m |
| seed 42 (692 at KIVY) | 350 -> 10 m | 70 -> 0 m |
| seed 1 | 60 -> 50 m | 0 -> 0 m |

- Across 720 at s 2000 (`profile-720across-s2000-p4.log`) the water is at 404.3 m. The SW bank rises 1 m in 3 m and
  2.6 m in 12 m; the NE bank rises 1.5 m in 6 m. It was a 4.4 m face in 9 m.
- On a 4 m grid of 600 x 600 m round -14950,32700 (`grid.test.ts` against verifyR1's VH tree), slopes over 0.7 cover
  2684 cells (VH 3234), of which 2 are new.

**Pictures** (verifyR1's cameras):
- `cmp-xR720-comb-AvsP4.png` (30 m up, 80 m off):
  - Before: white water under a pale scalloped band with a feathered top.
  - After: a continuous blue-grey stream, its far bank a thin earthy line under grass.
- `cmp-xR720-side-AvsP4.png` (20 m over the runway): the row of pale fans is gone. A thin tan bank line is left.
- `cmp-xR720-obl-ne-AvsP4.png` (180 m): the teeth are gone. A thin dark stream line runs between smooth banks.
- `cmp-p720-se-HvsP4.png` (30 m over the SE reach): before, the stream had dark serrated banks on both sides. After,
  it runs with water between smooth banks, and the slope beside it is clean.
- `cmp-fly7-abeam-near-AvsP4.png` (cockpit, 300 m abeam): the reach beside the runway is no longer a white rope; its
  far end is a thin grey-blue line. The near part still reads as a grey beaded line. The beads are the course's 44 m
  chords, which turn 5-15 degrees at each sample: problem 3's square corners.
- `cmp-xR720-AvsP4.png` (800 m) and `cmp-xR720-low-AvsP4.png` (115 m): the water is continuous past the runway, as in
  `-A`.
- `cmp-xR692-low-AvsP4.png` (seed 42, KIVY): 692 has water and white water, and the pale fringe on its far bank is
  thinner.

#### 3. 720's approach reach: not fixed

**Confirmed.** `cmp-B720-AvsP4.png` shows the approach reach as verifyR1 found it:
- the ladder of rectangular pools;
- the serrated right bank;
- the pale translucent band over the valley floor. This is the approach's obstacle-clear zone: no trees, ending along a
  straight line at the approach's end.

The zigzag reach by the runway has water and keeps its corners.

**What was measured** (`dump720-p1.log`, `dump720-runway-p2.log`).
- On the approach reach the water lies flat for 44-133 m at a time: i 134-137 (432.09 m), i 145-147 (420.71 m) and
  i 156-157 (407.61 m). Steep runs of 4-6 % lie between them.
- At the flats the water runs 1.3-2.7 m under the ground it is carved into. Elsewhere that depth is 0.4-0.9 m.
- The flats are therefore holdUnder's running minimum. Under the approach, the trimmed ground rises along the stream as
  it weaves across the corridor's edge, and the held water keeps its lower level until the ground falls again. This
  confirms the first pass's suspicion.
- The samples are 44 m apart, and the course turns 5-15 degrees at most of them, so each pool is one straight chord.
- The same chords make the square corners of the reach by the runway, and the beads seen from the cockpit.
- The raise of problem 1 does not act on the approach reach, which lies outside the blend (weight 1.0).

**Not done.**
- A graded profile under the staircase would lower the water by up to 5 m mid-run and cut that much deeper.
- Smoothing the approach trim along the corridor's edge would move the airfield siting gates.
- The corners are round S/T's square-corner work, which regressed when it was tried.

#### 4 and 6. Line 567 into pool 26 (seed 7): not fixed

**Confirmed.**
- `out/fs/R2/dump567.log`: 567 comes down into a hollow where the natural ground is 12.8-13.5 m (s 750-1006). Its
  water there is 12.38-11.69 m.
- It then climbs north-east for 1.3 km through a notch at 11.69 m. The natural ground along the notch rises to
  28.5-32 m, so the notch is cut 15-19.3 m deep.
- It meets pool 26 (26.96 m) at s 2267, 15.3 m under the pond's surface.
- `cmp-x567-up-HvsP3.png` shows the same blue sheet at the notch's end as verifyR1's `x567-up-VH.png`.

**What was found** (`poolMap-567-route.log`: the stream pass's routing ground on the 250 m lake raster).
- The hollow 567 is held in lies at 14 m (-14250,124250 and -14500,124000).
- Its lowest way out is about 25 m, to the west: -14250,124000 at 22 m, then -14000,123750 at 25 m. Beyond that a
  coastal lowland falls to the sea (`poolMap-567-west.log`).
- Pool 26's basin is north-east of the hollow, beyond a ridge of 27-35 m on the routing ground. The trace notched
  through that ridge.
- The stream report's fill for 567 is pool 26: "fill: pond (2.19 km², its sill 22.3 m over the pit)". Its inflow is
  43.5 + lost 8.3 km², to outlet 2621.
- That pit level (4.7 m) matches neither the routing ground (14 m at the hollow) nor the natural ground (12.8 m). How
  deadEnd's fill reached pool 26's basin was not traced to the line.

**Why no fix was made.**
- The stream's water cannot reach the pond's surface. The hollow it comes through lies 12-14 m under it, and the
  hollow's own way out (about 25 m) is lower than the pond.
- Raising the notch's water to the pond would stand it 14 m over the hollow's banks. That is AT_THE_SURFACE's block.
- Lowering pool 26 to the notch (11.7 m) would cut its outlet 15.3 m through its rim. That is over the owner's 15 m
  limit, and the owner's rule keeps a new lake under 3 km² whole.
- A consistent fix belongs in the stream pass: fill the hollow 567 is held in up to its own way out, about 25 m to the
  west, so that 567 ends in that pond and its outlet runs west. Pool 26 would then lose 567's inflow. That changes
  ponds and outlets on every seed, so it was not made in a repair pass.
- 738 (seed 1, pool 86, 4.5 m) is in the same class, as are all 53 blocked runs.

#### 5. Water running uphill at junctions: fixed for 474 -> 2267

**Confirmed** at `00866e4`.
- Line 2267 runs flat at 204.26 m in a notch along lake 12's edge (212.68 m) for 234 m (i 191-196), then on for 10 km.
- AT_THE_SURFACE backed the 5 km above it up to 212.68 m.
- 474 joins 2267's head and was processed first, so it stayed at 204.26 m: an 8.42 m step up (verifyR1's
  `junctions-VH.log`).

**The fix** (`0911f22`, riverNetwork.ts AT_THE_SURFACE).
- Only a lake a line ends in or stays in backs it up. A line that passes a lake keeps its levels as traced: its water
  is already more than LEAVE_BELOW (1 m) under the lake's level as it comes to it, it does not come down while in the
  lake, and it leaves that lake for good under that level.
- Lines that come down into a lake and leave it below its level are raised as before (537, 634, 510, ...).
- Lines are taken receivers first: a continuation before the stream it continues.

**Junction gate** (new: `scripts/probes/junctionGate.test.ts`). At every junction it compares the joining line's last
water with the receiver's water, interpolated along the receiver's course. Step-ups over 0.5 / 2 / 5 m outside lakes:

| seed | before AT_THE_SURFACE (`f654e1c`) | `00866e4` | now |
|---|---|---|---|
| 1 | 177 / 76 / 43 | 177 / 76 / 43 | 177 / 76 / 43 |
| 42 | 166 / 69 / 32 | 165 / 69 / 32 | 165 / 69 / 32 |
| 777777 | 199 / 72 / 45 | 200 / 73 / 46 | 199 / 72 / 45 |
| 7 | 208 / 84 / 52 | 207 / 84 / 52 | 207 / 84 / 52 |
| 1234 | 146 / 55 / 30 | 146 / 55 / 30 | 146 / 55 / 30 |
| 99991 | 200 / 83 / 58 | 200 / 83 / 58 | 200 / 83 / 58 |

- The battery's rule is no more step-ups than before AT_THE_SURFACE. It holds.
- Two step-ups in a lake, made by AT_THE_SURFACE, remain: 2075 -> 784 (seed 777777, 32.6 m) and 1298 -> 530
  (seed 1234, 18.9 m). Both joining lines are blocked inflows whose water runs under the lake's surface on the way in,
  so both waters lie under the lake's water at the junction. They belong with problem 6.
- **The 150-210 step-ups per seed outside lakes are old.** They were there before AT_THE_SURFACE, up to 73 m (seed
  777777, 2019 -> 1458). Most are tributaries joining a stream 300-550 m from its head. They are not this round's, and
  they are listed in `junctionGate-before-item2.log`.
- underLake (seeds 1 / 42 / 777777 / 7) is unchanged on 1, 42 and 7. On 777777 the water more than 3 m under a lake's
  surface inside it goes 6.79 -> 7.07 km, and shore steps over 1 m go 13 -> 14. Both are 2267's 234 m along lake 12,
  as before AT_THE_SURFACE.
- Pictures `j2267-top-p3.png` and `j2267-lo-p3.png`: the junction is under the forest canopy, as in verifyR1's
  renders.

#### Battery (`out/fs/finalR2`, the code at `f168159`) against the first pass (`out/fs/finalR`)

| gate | first pass (finalR, `d2e6c40`) | now (finalR2, `f168159`) | rule | |
|---|---|---|---|---|
| dead ends, endsGate IG_MIN 10 (seed 7 too); climbed reaches | 0 / 0 / 0 / 0; 148.8 / 220.5 / 295.7 / 224.8 km | identical log | 0 | held |
| outlet loops; cycles through lakes | 0; 0 | identical logs | 0 | held |
| junctionGate step-ups outside lakes > 0.5 / 2 / 5 m (new; first pass measured on its code, `junctionGate-HEAD.log`) | 777777 200 / 73 / 46 (474 -> 2267) | 177/76/43, 165/69/32, 199/72/45, 207/84/52, 146/55/30, 200/83/58 (seeds 1 / 42 / 777777 / 7 / 1234 / 99991) | <= before AT_THE_SURFACE (`f654e1c`) | held |
| overGround > 10 m; > 2 m | 8 / 58 / 35; 507 / 645 / 589 | 8 / 58 / 35; 507 / 645 / **598** | > 10 m <= 8 / 58 / 35 | held (see below) |
| steps > 100 m; > 50 m | 0; 40 / 15 / 43 | 0; 40 / 15 / 43 | 0 | held |
| riverZero | 0.2 / 2.2 / 0.0 km | the same | no worse | held |
| lakes | 71 / 74 / 61 | 71 / 74 / 61, ponds identical | the same | held |
| drawnGate (i); (ii); (iii) | 96.0 / 95.7 / 95.6 % | 96.0 / 95.7 / 95.6 % (777777: 9784 -> 9790 profiles) | (i) >= 95.6 | held |
| wallsGate class 4 (water > 10 m over its centre ground) | 0.2 / 0.6 / 1.1 km | 0.2 / 0.6 / 1.1 km (777777: classes 1, 2 and 5 one line or 0.2 km more) | no worse | held |
| heldOver (> 3 m over both banks by the fields) | 4 / 0 / 18 | 4 / 0 / 18 (fieldHeld 1098 -> 1057 and 203 -> 199: those samples are raised now, not lowered) | no worse | held |
| bankHeight > 10 m | 92 / 121 / 90 | 92 / 121 / 90 | no worse | held |
| waterWalls > 10 m; corrected | 1856 / 1906 / 1740; 1118 / 835 / 1215 | the same (777777 > 2 m 8046 -> 8050) | reported | held |
| underLake (shore steps > 1 m; water > 3 m under inside) | 13 / 11 / 13 / 10; 4.43 / 5.72 / 6.79 / 2.69 km | 13 / 11 / **14** / 10; 4.43 / 5.72 / **7.07** / 2.69 km | reported | 2267's run, as before AT_THE_SURFACE |
| dryNear (water hidden by the fields) | 120 / 115 / 87 m | 120 / 115 / 87 m | no worse | held |
| fieldFaces (new: bank face > 35 / > 45 degrees in a field's blend) | 60 / 0, 350 / 70, 1730 / 1370 m | 50 / 0, 10 / 0, 240 / 40 m | reported | better |
| homeCheck | 8/8 | 8/8 | 8/8 | held |
| moved.py (f3 courses) | 3 / 2 / 6 | identical | reported | held |
| gullyGate, rillGate, cornerGate, creaseGate, paintedLoops, turnClass | | identical logs (streamTurns: 777777 n 1936 -> 1937) | no worse | held |
| seed boxes b; pits10 (validate) | 1.27 / 1.26 / 1.35; 2.92 / 1.89 / 1.94 | identical | b <= 1.3 (seed 42) | held |
| suite (finalS.sh: four directories, --no-file-parallelism) | 745 / 745 | **745 / 745**; the seven slow files with --testTimeout=120000 80 / 80 | 738 / 745 | met |
| seededWorld; airfields; presentGuard (seed 0) | pass | pass (in the suite); tests/fixtures and tests/era untouched, never re-pinned | all | held |
| build time (phaseTimes, one run in the battery, seeds 42 / 1 / 777777) | 10.4 / 8.2 / 9.7 s (under load) | 6.1 / 5.6 / 5.8 s | reported | |

**overGround over 2 m on seed 777777, 589 -> 598.**
- overGround measures the water against the *natural* ground. FIELD_RAISE puts 734's head 3.6-9.2 m over its
  natural ground (23 samples from s 238 to s 376), and the field's blend raises the drawn ground over that water. The
  water stands 1-1.5 m under its banks there (`line734-p3.log`).
- Over 10 m is unchanged, as is wallsGate class 4 (water over its own *drawn* centre ground).

#### Left

- **Blocked inflows** (problems 4 and 6): 53 runs over the four seeds, including FILL_DEAD_ENDS ponds 567 / pool 26 and
  738. The fix is in the stream pass: fill the hollow a stream is held in up to its own way out (567: about 25 m, west).
- **720's approach reach** (problem 3): holdUnder's staircase under the approach trim, and the 44 m chords. The pale
  band is the approach's obstacle-clear zone.
- **Old junction step-ups**: 150-210 per seed outside lakes, before AT_THE_SURFACE (`junctionGate`).
- The first pass's other items are as listed there: 1853's straight tail, 2188 -> 692 over f3, river 15 under lake 1,
  heightfield.test.ts's speed assertion.

#### Commits

| commit | what |
|---|---|
| `0911f22` | problem 5: no backwater from a lake a stream only passes; receivers first; junctionGate |
| `c662af9` | problem 1: a stream's water rises with the ground a field's blend raises over it; banks not built up by what the blend adds |
| `0b40438` | problem 2: a stream cut again through a field's blend has earth banks, its cut weighed at its water, kept only on another stream's own banks |
| `d0f5c9e` | problem 1: a raise stays within 1 m of another stream's water beside it (1727 by 734) |
| `f168159` | problem 2: the earth bank's cut fades out beyond 8 m (the teeth on the slope by 720's SE reach); extrasR2.sh |
| (this) | report |
