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
