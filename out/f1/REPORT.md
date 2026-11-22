# Foundation stage 1: steady-state macro ground (plumbing)

Branch `exp/foundation` (from `exp/drainage-tree` cea3349), worktree `~/github/fs-exp/foundation`. Not merged.

| commit | what |
|---|---|
| `0174025` | inventory (`out/f1/INVENTORY.md`), gate probes plainsRegime + heightExport |
| `52ed235` | the model, the signed interface, the consumers, tests, seed-7 boards (one commit: they only build together) |
| `40600ac` | the model worked out once in one worker and handed to every thread |
| `badc733` | IndexedDB cache (own commit, so the geometry bisects without it) |

## Short version
- The plumbing works: steady-state stream power over today's uplift, signed macro interface (nothing clamps at 0),
  one worker + per-seed cache, home runway held and re-checked, full suite green, seed 0 untouched.
- Tree measures stay within the spike's spread; the drawn rivers are still the lattice lines one for one.
- Big dry closed basins in the seed-42 box: 56 -> 2. Rivers at 400-700 m: 3.7-5.4 % -> 1.5-2.7 % (p50, 2 km).
- **It does not look "much like today" everywhere.** n = 1 steady state sets every height from the tree, so closed
  lowland basins fill and rise (a seed-777777 lake basin at 170-224 m now stands at ~670 m), intermontane uplands are
  graded down to their outlets (a seed-1 lake plateau at ~1400 m is now a low farmed valley), and the highest cores
  rise (seed-42 box p99 2465 -> 2995 m, more snow). Hill country and the big valleys read much as before.
- **Every lake goes**, not only the mountain ones: 225-256 lakes and 18-27 tarns per world -> 0. About 40 % of
  them were hill-country and plain lakes. Needs the owner's call (below).

## What changed

**The model** (`src/world/terrain/erosion.ts` `steadyLattice`). The 20 lowering-only FastScape steps are gone. T is the
steady state of stream power under an uplift field, by the steady-state iteration (Cordonnier et al. 2016): 30 rounds of
route + "each cell = its receiver + U L / (K A^m)", downstream first, started from today's noise ground (so the first
routing is today's tree). Routing is the spike's (priority flood, then steepest descent on the filled surface);
`drainage.ts` now routes the same way, so the rivers run down the model's own valleys (channel cells routed
differently from the model: 2.4 % with the old flood receivers, 0.0 % now).
- Uplift (`heightfield.ts upliftRate`): `(uplift/1.15 + 0.5 hillAmp/830) * smooth(0, 15 km, inland)` (the spike's
  `full`, hill share 0.2 -> 0.5).
- m = 0.45, n = 1, U/K 450 m per km at 1 km²; threshold slope 0.45 per 1 km step; gentlest gradient 0.06 A^-0.45,
  half of it at the coast fading in over 15 km (graded fully, coastal plains rose 40 m in their first km and the
  B-spline carried the raised land over the shallows, so river mouths ended on land).
- Calibrated against today's eroded lattice (`scripts/probes/ssCalib.test.ts`: 288-point grid on seed 42, checked on
  1 and 777777). Lattice, field classes, today -> stage 1:

| | mountain h p50/p90/max | mtn 5 km relief | hill h p50/p90 | hill relief | plain h p50/p90 | plain relief | relief classes m/h/p % |
|---|---|---|---|---|---|---|---|
| s1 | 1292/1912/2863 -> 1216/2072/3496 | 937 -> 1069 | 401/719 -> 425/882 | 364 -> 375 | 195/348 -> 126/390 | 186 -> 140 | 38/48/14 -> 38/40/22 |
| s42 | 1296/1968/2970 -> 1156/2051/3442 | 952 -> 1080 | 411/742 -> 311/733 | 392 -> 363 | 177/359 -> 96/265 | 201 -> 128 | 38/49/13 -> 37/37/26 |
| s777777 | 1272/1958/2951 -> 1130/1945/3125 | 977 -> 1077 | 394/696 -> 381/777 | 353 -> 345 | 201/345 -> 174/493 | 178 -> 152 | 32/53/15 -> 31/47/22 |

  One scalar cannot match all of it: with n = 1 relief concentrates (valleys lower, cores higher, max +170-650 m).
  Hill country matches; plains come out lower and flatter.
- Model cost 0.5-0.6 s per world here (node, one thread).

**Signed interface.** Terrain = `noise + B-spline(T - noise lattice) + carve` = `B-spline(T) + (noise relief finer
than the lattice) + carve` (the B-spline is linear). `erosionCutAt`, `roundMin0`, `REPLACE`/`erosionWeight` and
`applyCut`'s early return are gone; `macroOffset`/`macroOffsetGrad` are signed; `applyMacro` keeps the sea cushion
for lowerings (the one place a lowering is special). The finer relief gives way on channel floors and in the model's
valleys (valley depth 20 -> 100 m; with it only on floors the seed-42 box kept 43 dry basins > 50 m deep, with it 1-2,
and slope/relief over 1 km stay as before). The shore stays where the noise put it (`coastKeep`). riverNetwork
`free()` pins courses by the model's valley depth (3 x 3 mean minus the cell; on river cells it matches the old cut,
p50 45-55 m, so `PIN_CUT` is unchanged). Inventory of every consumer: `out/f1/INVENTORY.md`.

**Home field.** Sited on the noise ground, held during the run (as before), and new: under the runway's approach
and climb-out corridors (10.9 km, +-400 m) and the circuit box the model may lower but not raise the ground (`cap`;
without it seed 777777's climb-out ground stood 192 m over its 4 % surface). One re-check on the finished ground
(`homeSiting.ts siteRunway`, `heightfield.ts homeRecheck`, probe homeCheck): passes on seeds 1, 7, 42, 1234,
99991, 777777, same elevation and pad spread as sited.

**Fixed on the way.** The macro gradient was 0 outside the lattice's inner ring, so the gullies jumped at +-159 km
(today's worst edge step, 158 m at seed 42): now continuous (`latticeGrad`). The edge cells' copied change no longer
goes into the lattice the drainage routes (it made false rims that the drainage breached with 1 km-deep gorges).

**Workers and cache.** `macroWorker.ts` (`heightfield.ts computeSeededModel`) works the model out; main.ts waits for
it, or for the IndexedDB entry (`macroCache.ts`, key seed + `MODEL_VERSION`, checked at build against a hash of the
sampled inputs and settings; a stale entry is rebuilt and re-stored), before constructing the Simulator;
TerrainSystem sends the 412 KB to the terrain workers in their setup message. A terrain worker that computes the
model itself warns in the console: none did. Node tests compute synchronously. `modelcache=0` skips the cache read.

## Gates (seeds 1 / 42 / 777777; before = cea3349, after = badc733; logs out/f1/before, out/f1/after5)

**Tree measures** (field classes; lattice the world routes over; drawn kind-0 rivers in brackets):

| | conf45 inside % | conf200 n; inside % | exits >= 45: n; NN p50 km | exits >= 200 | top-3 % | largest exit / mouth p50 |
|---|---|---|---|---|---|---|
| before | 10 / 12 / 7 | 63, 42, 64; 10 / 10 / 5 | 63, 79, 63; 8 / 9 / 11 | 6 / 11 / 2 | 26 / 19 / 23 | 0.07 (0.08) / 0.12 (0.13) / 0.08 (0.08) |
| after | 10 / 10 / 11 | 54, 31, 54; 7 / 3 / 7 | 76, 87, 67; 7 / 7 / 9 | 8 / 9 / 5 | 20 / 16 / 23 | 0.07 (0.07) / 0.08 (0.15) / 0.08 (0.08) |

Within the spread of the spike's own variants (exit/mouth 0.07-0.13, exits >= 45 59-99). One measure moved: range
exits >= 10 km² 228/235/223 -> 359/349/320 (more small catchments leaving the front side by side, as in the spike's
steady-state rows, 296-333). Full table: `out/f1/after5/summary.md`.

**Drawn rivers:** 385/401/400 -> 428/452/431; index and parent match the lattice for all (428/428, 452/452, 431/431).

**Streams, feeders, heads** (streamReport, headFeed): streams 585/591/648 (1199/1194/1473 km, sinks 67/64/87) ->
740/733/714 (2016/1805/1849 km, sinks 31/44/35); feeders 233/234/282 -> 281/287/297; unfed dry river heads
15/17/23 -> 11/16/9.

**Lakes:** before 263/258/231 lattice lakes (mountain 153/163/110, hill 97/82/104, plain 13/13/17; 54-77 per world
below 300 m; water 1324/1348/1173 km²), tarns 21/28/24. After: 0 lakes, 0 tarns on all three. The ground drains by
construction; the only hollows left are the held home field and the era's volcano. **The owner accepted losing the
mountain lakes; this also removes ~100 hill-country and plain lakes per world (40 % of the lakes, most of the water
area, the lowland "lake districts").** Options: wait for the ice and deposition stages, or a stand-in now (e.g. the
model not filling the noise ground's own hollows below some level). Not done here.

**Closed dry basins** (seed-42 mountain box, 20 m export through validate.py, > 50 m deep and > 0.2 km²):
56 (98.7 km²) -> 2 (0.8 km²). All hollows 1004 -> 1005; > 10 m deep 359 -> 315. Same box: slope p50/p90
15.8/35.4° -> 16.6/33.9°, relief over 1 km 346 -> 369 m, elevation p50 1398 -> 1283 m, p95 2235 -> 2613 m,
p99 2465 -> 2995 m; Flint θ 0.39 -> 0.47.

**River gradient over 2 km, p50 (p90), %:**

| band | s1 | s42 | s777777 |
|---|---|---|---|
| 0-200 m | 0.26 (1.87) -> 0.37 (1.45) | 0.40 (2.31) -> 0.41 (1.60) | 0.15 (1.93) -> 0.36 (1.39) |
| 200-400 m | 1.24 (4.34) -> 1.18 (3.43) | 1.84 (4.98) -> 1.94 (4.36) | 1.43 (4.40) -> 0.88 (3.02) |
| 400-700 m | 3.67 (9.37) -> 1.78 (4.82) | 5.43 (10.30) -> 2.70 (6.27) | 4.99 (10.55) -> 1.49 (4.32) |
| > 700 m | 4.11 (13.43) -> 3.56 (6.62) | 5.39 (13.81) -> 5.60 (8.91) | 7.90 (18.22) -> 3.41 (6.65) |

400-700 m halves and the steep tails drop by a third to a half; 200-400 m barely moves. Real foothill rivers are
0.2-0.7 %, so still 2-4x too steep. Not tuned here: the stage-2 number.

**Water over ground** (overGround, > 10 m): 2/10/0 -> 5/9/8 of ~105k points (steep streams over deep gully troughs:
stream levels follow the smoother ground). **River over bank** (waterWalls, river over a dry neighbour > 2 m):
2.77/3.66/2.58 % -> 2.21/2.76/1.64 %; > 10 m 1028/1313/1010 -> 1190/1429/828; worst 55/47/74 -> 68/65/45 m (the one
I traced is a stream doubling back on itself 150 m lower, an existing class). Lake-shore walls: seed 42 has 3 > 10 m
(worst 48 m) at an oxbow beside a steep bank; before 0.

**Edges** (edgeScan, profiles 150-180 km out every 500 m): NaN 0/0/0 before and after; largest step between samples
25 m apart 93/158/86 -> 88/72/68 m.

**Tests:** tsc clean. `npx vitest run --no-file-parallelism tests/terrain tests/world tests/era tests/career`: 58
files, 745 tests pass (presentGuard untouched, passing). Also tests/atc, tests/instruments, tests/sim (seeded users):
44 files, 665 pass. Assertions changed (premise changed by the owner's lake decision):
- `tests/terrain/seededWorld.test.ts`: no longer requires more than 3 lakes (any lake there is must still hold water).
- `tests/career/landmarks.test.ts`: at seed 7, `> 4` lake landmarks -> at most one per lake the world has.
- `tests/career/boards.golden.json`: seed 7's entry re-baked (the world changed); seed 0's entry byte-equal.

**Seed 0 and shader twins:** every new path is in the `SEEDED` branch of `buildWater` or behind seed != 0 in main.ts.
No shader recomputes the macro ground (grep of terrainMaterial, water, glsl, rillShader, channelStones for
mountainShape/hillShape/macroAt/uplift finds nothing); tiles carry the CPU heights.

## Load times
Seed 42, runway start, second load (vite transforms warm), navigation to `window.__ready`, ms; 2 rounds each, run
alternately on this machine (`out/f1/boot.sh`, logs `out/f1/logs/`). "Model" = time main.ts waited for the model
cells before building the world.

| | 1x CPU | 4x CPU (main thread throttled) |
|---|---|---|
| before (cea3349) | 10009, 10164 | 23516, 24094 |
| after, warm (cells from IndexedDB) | 9916, 9799 (model 15, 11) | 23058, 23498 (model 65, 58) |
| after, cold (`modelcache=0`: model worker) | 10640, 10714 (model 863, 862) | 23583, 24606 (model 873, 887) |

Warm boots are no slower than before (about 0.1-0.5 s faster: the world build no longer runs the erosion pass or
floods ~250 lakes). A first visit to a seed costs about +0.6 s at 1x: the worker's ~0.86 s (sampling plus model),
partly offset by the cheaper build. At 4x the cold cost looks small only because DevTools throttling does not reach
the worker: on a laptop 4x slower the worker would take ~3.5 s, so a first visit there costs about +2.5-3 s; cached
visits cost nothing. Each terrain worker still samples the noise lattice itself (the macro cache needs it); sharing
saves only the iteration.

## Terrain sample cost (paired, 2 rounds; `out/f1/cost.log`)
- `naturalHeight` over a world-wide grid (heightCost, seed 42): 1.94-2.03 -> 2.07-2.10 µs (+0.05-0.15); coarse
  0.47-0.48 -> 0.55-0.56 µs.
- `sampleTerrain` in four 8 km mountain windows (costMountain, min of 5): 2.66-2.77 -> 2.68-2.79, 1.51-1.59 -> 2.35-2.46,
  2.10-2.14 -> 2.61-2.63, 2.35-2.38 -> 2.79-2.83 µs. Three windows are over the old +0.3 µs line (+0.45 to +0.85).
  Part of it is the extra reads (valley B-spline on every sample, the noise lattice's wherever the finer relief fades,
  carve and floor), part is that the ground there changed (the windows were picked on the old world; the +0.85 one had
  lake and flat floor before). Not tuned here.

## Pictures
`out/f1/shots/<view>-{before,after}.png` (camera URLs in `out/f1/views.txt`, `views2.txt`; port 5197 via shot.mjs):
- `s42-home`: the same farmland and field; a distant lake on the right gone. Held as intended.
- `s42-mtn`: the near peak is lower with less rock; the range behind is a bigger, higher snow massif; the lake in the
  right-hand valley is now farmland.
- `s42-river`: the 560 km² river and its two lakes are gone from this valley: the lake basin filled and the ground
  under the camera rose ~360 m (630 m now). The river was rerouted when its basin filled.
- `s42-river2` (the biggest river, 1786 km², at 254 m): still a broad farmed valley with a winding river; the valley
  walls are a little lower and the river takes a different line near the camera.
- `s1-mtnlakes`: the ~1400 m upland with its lake cluster is now a low farmed valley between forested ridges.
- `s1-river`: much as before; the river splits into two channels at a junction, more streams visible.
- `s1-lowlakes`: the lowland lakes are gone; the ground under the camera rose into a forested hill.
- `s777777-mtn`: same range, similar ridge forms, different snow and less bare rock.
- `s777777-lowlakes`: the lake basin (bed 170 m, water 224 m) now stands at ~670 m: a raised hill country of
  plantations; the lake and the open view are gone.
- `s777777-home`: farmland and field as before, range behind.

## What's left
- **Owner decision: the hill and plain lakes** (see Lakes).
- **Look:** basins that were closed in the noise are filled and raised (lowland) or graded down (upland) by
  hundreds of metres; peaks rise (more snow above 2500 m). That is the steady state doing what it does; the
  "same look" premise only holds where the noise already drained. U/K is one scalar to re-set with stage 2's layout.
- River gradients 200-700 m still 1-2.7 % p50: the stage-2 number.
- Plains lower and flatter (relief-class plain share 13-15 % -> 22-26 %).
- Build per thread in node 2.2-2.7 s -> 2.5-3.1 s (the model); in the browser only the model worker pays it.
- shot.mjs's 4x CPU throttle applies to the page's main thread, not to the model worker, so the throttled cold number
  understates a slow laptop: a first visit there costs about +2.5-3 s (see Load times).
- Old probes using removed names (`scripts/probes/erosion.test.ts`) are left as they were; not in the suite.
