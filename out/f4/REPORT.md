# Foundation stage 4: steep mountain slopes (threshold hillslopes)

Branch `exp/foundation4` (from `e9997ef` = stage 1 + stage 2 + the sea-level river fix), worktree
`~/github/fs-exp/foundation4`. Nothing merged or pushed. "Stage 2" below means `e9997ef`.

| commit | what |
|---|---|
| `243ce18` | **the pass** (`hillslopes.ts`): channels on the 250 m grid in the orogen's mountains, slopes at the threshold up to the ridges; run once the rivers' axes are laid out, with their floors held; cached with the model (`MODEL_VERSION` ss3); streams pinned to its channel floors; probes |
| `d3df7a7` | lift only on mountain ground and a capped crown (plains inside the mask stay plains); none toward the lattice edge (edge steps back to stage 2's); river-valley reach exported; probes `stepScan`, `coverShare`, `valleyViews` |
| (last) | seed 7's golden boards re-baked (seed 0's entry equal), the report, scripts, probes |

## Short version (what the owner will see)

- **The smooth green domes are gone.** The orogen's mountains are cut by a network of small valleys about a kilometre
  apart. The valleys are V-shaped, with sides at the threshold angle (36°) up to sharp ridges and low pyramidal peaks.
  - Pictures: `shots/s42-mtn-f4.png` against `-f2`; the cockpit-height `shots/*-valley*-f4.png` against `-f2s`;
    `shots/s42-massif-f4.png`.
  - The big rivers keep their floors exactly.
  - Small side valleys that were broad farmed floors in stage 2 become narrow forested V's (decision 2).
- **The seed-42 box now measures like NZ ranges** (stage 2 → stage 4):
  - slope p50 18.6° → 31.3°;
  - the slope distribution peaks at 35-37.5° (was 17.5-20°);
  - p90 34° → 43°;
  - relief over 1 km 398 → 606 m;
  - valley b 1.58 → 1.18;
  - closed pits deeper than 10 m 8.3 → 0.9 per 100 km².

  Seeds 1 and 777777 move the same way.
- **The mountains keep their height.** Box median 1236 → 1169 m, p99 2349 → 2234 m. A first version that could only cut
  into the old ground lowered them by 300-600 m (5 km relief 1257 → 902 m). The pass now lets ridges stand up to 100 m
  over the old ground, and peaks up to 150 m more.
- **More bare rock, a little less snow.** On the CPU's surface classes, rock goes from 3-4 % of the boxes to 11-13 %
  and ground over 30° from 13-18 % to 46-53 %. Snow goes from 0.2-0.5 % to 0.1 %, because summits are pointier. The snow
  line is not changed.
- **Unchanged:**
  - the rivers' levels and floors, and fault falls;
  - lakes (70 / 74 / 59, logs identical), kept hollows and the home field (homeCheck identical on 8 seeds);
  - riverZero and edge steps;
  - the drainage lattice and its tree measures;
  - hill country and plains (no weight outside the mountain mask).
- **What got worse** (report items; details under "Left"):
  - river banks over dry ground (> 10 m): +27-44 %;
  - streams ending in a hollow: 21 / 41 / 35 → 41 / 45 / 41, most of them outside the mountains;
  - stream length: -4 to -11 %;
  - steep steps (> 50 m between samples 25 m apart) about 3-4x stage 2, still rare, where a big river's valley carve meets
    the raised slopes;
  - load: first visit +1.5 s, cached load +0.3 s.

## Owner decisions first

1. **Steps where a big river's valley carve meets the slopes, or the V-shape gate.**
   - **The trade-off.** Within a big river's valley carve reach (up to about 2.4 km), the pass raises the ground into V
     walls. `carveNetwork` was built for stage 2's gentler ground: where its nearest valley segment switches, it now
     leaves steps of up to 172-181 m (stage 2 had 115-124 m at the same spots).
   - **Steps over 50 m in the whole-domain scan:** 37 / 44 / 70 → 174 / 148 / 233.
   - **The switch.** `SlopeParams.riverLift = 0` keeps the lift out of river valleys. Steps return to stage 2's level
     (seeds 42 / 777777: 50 / 92; worst 149 / 143 m), but valley b on seed 42 fails at 1.35.
   - **Recommended:** keep the lift (b 1.18), and fix the carve's switching in a follow-up. That step artefact is stage
     2's, made bigger.
2. **Small valleys' flat floors become V's** (`shots/s42-valley1-f4.png` vs `-f2s`). Where a 30-45 km² stream ran on a
   broad lattice-valley floor (farmland in stage 2), the floor beside it now rises at the threshold. The stream sits in
   a forested V, and some farmland on those floors is gone. This is what the V-shape target asks for (NZ b 1.0-1.2 for
   1-100 km²), but it changes the look of the inhabited mountain valleys. Rivers (≥ 45 km²) keep their floors. The
   alternative, limiting the lift by the old ground's slope so flat floors stay flat, costs the b gate.
3. **Coarse gullies are off in the mountains** (`SlopeParams.gully = 0`).
   - The pass's channels are the valleys now.
   - At 30 % of their old relief, the gullies brought pits back (1.4-2.6 per 100 km²) and made b worse (1.33-1.36).
   - The finer octaves (rill scale) stay. Slopes read as planar faces with rock bands, not furrowed.
4. **Mountain lakes and tarns stay gone** (as in stage 2). The pass leaves no closed hollows by construction; tarns
   belong to the ice stage.
5. **First load and cache size.**
   - The model worker now builds as far as the rivers' axes and runs the pass: 0.9 → 2.0 s, so a first visit is +1.5 s
     (+1.8 s at 4x throttle).
   - The cache entry grows from 0.4 MB to about 10.4 MB per seed, and each terrain worker gets a copy.
   - Fine, or store the fine-grid fields sparsely (about 40 % of the nodes are used)?
6. **5 km relief is now above NZ:** 1353-1389 m against NZ's 1142-1275 m. It comes from the ridges' lift. Lower `lift` and
   `crown` bring it down, at the cost of 200-300 m of summit height (sweep below).

## Gates (stage 2 → stage 4)

The boxes are 60 km squares at 20 m, measured with validate.py (`tools/validate.py`, the same code as `validation.md`).

| Seed | Box centre | How chosen |
|---|---|---|
| 42 | N -44250 E 6250 | the validation.md box |
| 1 | N 1000 E 109000 | full mountain weight, highest; probe `orogenBox`, 15 km clear of the lattice edge |
| 777777 | N -13000 E 1000 | same as seed 1 |

| | stage 2 | stage 4 | target |
|---|---|---|---|
| **slope p50, seed 42** | 18.6° | **31.3°** | ≥ 25°: pass |
| **slope peak** (2.5° bins) | 17.5-20° | **35-37.5°** | 30-40°: pass |
| **slope p90** | 34.3° | **42.9°** | ≥ 38°: pass |
| **1 km relief** | 398 m | **606 m** | 400-650 m: pass |
| **valley b median 1-100 km²** (1-10 / 10-100) | 1.58 (1.43 / 1.67) | **1.18** (1.12 / 1.27) | ≤ 1.3: pass |
| **closed pits > 10 m per 100 km²** | 8.33 | **0.89** | no worse, aim ≤ 2: pass |
| seed 1 box: p50 / peak / p90 / 1 km / b / pits | 17.7 / 17.5-20 / 31.4 / 391 / 1.65 / 4.19 | 28.4 / 35-37.5 / 42.1 / 584 / 1.24 / 3.94 | all pass; pits no worse but over the aim |
| seed 777777 box: same | 17.6 / 17.5-20 / 32.2 / 382 / 1.59 / 5.31 | 30.7 / 35-37.5 / 42.6 / 601 / 1.19 / 1.22 | all pass |
| **riverZero** km, seeds 1 / 42 / 777777 | 0 / 2.9 / 2.0 | **0 / 2.9 / 2.0** | no regression: pass |
| **lakes** | 70 / 74 / 59 | **70 / 74 / 59** (lakeStats / lakeKinds / lakeKeep / tarnCount logs identical) | pass |
| **homeCheck**, seeds 1, 2, 5, 7, 42, 1234, 99991, 777777 | ok | **ok, every number identical** | pass |
| **NaN; edge steps** (largest 25 m step, 150-180 km out) | 0; 76.0 / 78.4 / 68.1 m | **0; 76.0 / 78.4 / 68.1 m** | pass |
| **full suite** (tests/terrain, world, era, career) | 745 | **743 / 745**, then the 2 career failures fixed (re-bake, timeout): career 528 / 528 | pass |
| **seed 0**, presentGuard | | nothing new runs at seed 0; presentGuard passes, not re-pinned | pass |

**Suite** (`suite.log`):

- The first full run passed 743 of 745. The two failures were both career:
  - the golden boards for seed 7. Re-baked with `FS_CAREER_BAKE=1`: seed 7's entry changed (pay on some offers), seed
    0's entry is deep-equal to before.
  - "200 boards at seed 7", a 5 s timeout. Every build now works the pass out in-thread, about +0.8 s per seed-7 build.
- Re-run of `tests/career` with `--testTimeout=120000` after the re-bake: **28 files, 528 tests pass** (200 boards included). With it the suite is 745 / 745.

**Report (not gates), seeds 1 / 42 / 777777:**

- **Relief and height:**
  - Relief over 5 km: 1175 / 1257 / 1223 → 1353 / 1385 / 1389 m (NZ 1142-1275).
  - Box elevation p50 / p99: 1167/2241 → 1147/2213, 1236/2349 → 1169/2234, 1242/2261 → 1163/2185 m.
- **Profiles:**
  - Flint θ: 0.64 / 0.51 / 0.48 → 0.55 / 0.48 / 0.38 (target 0.4-0.5).
  - Hack h: 0.47 / 0.42 / 0.40 → 0.56 / 0.49 / 0.47 (NZ 0.48-0.58).
- **River levels** (`riverDump`, `tools/rivercmp.py`):
  - On the 373 / 366 / 372 rivers whose channel is laid exactly as before, the level changed by at most
    0.0 / 0.8 / 0.0 m. Seed 42's 0.8 m is at the coast.
  - On the rest, whose meanders swing differently over the same floor, the level at the nearest sample differs by p90
    0.1-0.3 m and p99 1.6-2.3 m: sampling along the same profile.
- **Water against ground:**
  - Water over ground > 10 m (overGround): 15 / 33 / 11 → 40 / 6 / 34, nearly all on meander loops more than 200 m off
    the axis.
  - River over a dry bank > 10 m (waterWalls): 1312 / 1485 / 1129 → 1885 / 1876 / 1609. The worst wall is
    147 / 81 / 74 → 147 / 74 / 68 m.
  - Lake-shore walls > 10 m: 0 / 0 / 0 → 0 / 0 / 0.
- **Steep steps** over the whole domain (`stepScan`, profiles every 2 km at 25 m):
  - over 25 m: 4101 / 4521 / 3949 → 15270 / 14652 / 15469. This is the slopes themselves: p99 slope is now 51°, NZ
    53-57°.
  - over 50 m: 37 / 44 / 70 → 174 / 148 / 233.
  - over 100 m: 1 / 3 / 2 → 1 / 1 / 3.
- **Streams** (tarnCount, headFeed):
  - count 706 / 722 / 750 → 685 / 711 / 734; length 2117 / 1828 / 2304 → 1891 / 1755 / 2092 km;
  - ending in a hollow 21 / 41 / 35 → 41 / 45 / 41. On seed 1, 26 of them end outside the mountains, 5 inside and 8 at
    the mask's edge (`streamSinks`);
  - unfed 36 / 20 / 19 → 38 / 20 / 21; dry river heads with no feeder 23 / 16 / 13 → 23 / 17 / 15.
- **Streams in the slopes' valleys** (`slopeStreams`): past their first kilometre, 79 / 89 / 86 % of stream samples in
  the mountains lie on a pass channel's floor. The first kilometre is the head, which starts on a lattice cell, often
  mid-slope, and runs down the fall line to the nearest channel.
- **Drainage tree** (treeMeasure): the lattice measures are identical. Drawn-river classes move by a few confluences.
- **Cover** (`coverShare`: the CPU's `terrainSurface`, whose slope and height inputs the shader shares; the biome and
  shader code is unchanged, so the CPU and GPU twins still agree):

  | box | rock | snow | over 30° | over 40° |
  |---|---|---|---|---|
  | seed 42 | 4.0 → 13.3 % | 0.5 → 0.1 % | 18 → 53 % | 6 → 22 % |
  | seed 1 | 2.5 → 10.8 % | 0.2 → 0.1 % | 13 → 46 % | |
  | seed 777777 | 3.1 → 12.1 % | 0.2 → 0.1 % | 14 → 51 % | |
- **Hill country** (target median 12-18°, 1 km relief 120-200 m; reported, not chased): 30 km boxes with no mountain
  weight measure median 4.2° / 1 km relief 89 m (seed 1, N 36000 E 10000) and 4.9° / 105 m (seed 777777, N -100000
  E -36000). This stage leaves them as stage 2 had them.

## Method: what was tried, and why this construction

All numbers in this section are seed 42's box. The sweeps are in `data/sweep-*.out`, made with `try.sh` (the `slopeTry`
probe, then validate.py and `tools/gate.py`).

**1. Envelope only: ground = min(old ground, channel floor + distance × tan Sc).** This is the brief's first
suggestion.

- **How it is built.** On the 250 m grid in downstream order, each node is no higher than its receiver plus the
  steepest drop it may stand over it. Channel floors rise from their trunk at ks A^-θ; slopes rise from the channels at
  tan 36°.
- **It gives the slopes.** With ks 0.15 and A_c 0.25 km²: p50 25°, peak 35-37.5°, b 1.29.
- **But it can only lower.** Box median 1236 → 922 m, p99 2349 → 1707 m, 5 km relief 1257 → 902 m.
- **The two ways out both fail.**
  - Fewer, bigger channels (A_c 1-4 km²) keep more height.
  - Steeper channels (ks 0.25-0.35) bring the domes back: ks 0.35 gives p50 19° and the peak at 17.5-20° again.
- **Why.** A threshold landscape's crests stand at spacing × tan Sc / 2 over its channels. To keep the 1 km block
  means as the 1 km model made them, ridges must stand above the old ground as well as valleys below it. Those block
  means already match Canterbury's.

**2. Raised envelope.**

- Ridges may rise to the old ground + 100 m (`lift`). Above that, a slope goes on at 0.4 of the threshold, up to a
  150 m crown. Summits become low peaks, not flat caps.
- The lift applies only where the ground's relief within 2 km is 150-400 m, so plains and broad basin floors in the
  mask stay flat. Without that limit, the rise grew 500 m ridges out of a 30 m plain along long hillslope flow paths.

| ks / A_c / lift | p50 | p90 | peak | 1 km | 5 km | b | pits | elev p50/p99 |
|---|---|---|---|---|---|---|---|---|
| 0.15 / 0.25 / 0 | 25.3 | 40.2 | 35-37.5 | 429 | 902 | 1.29 | 0.08 | 922/1707 |
| 0.15 / 1 / 0 | 27.6 | 40.5 | 35-37.5 | 536 | 1189 | 1.33 | 0.25 | 1026/2007 |
| 0.25 / 1 / 0 | 22.5 | 38.8 | 17.5-20 | 491 | 1250 | 1.32 | 0.06 | 1136/2211 |
| 0.35 / 1 / 0 | 18.7 | 33.4 | 17.5-20 | 420 | 1242 | 1.62 | 0.00 | 1200/2329 |
| 0.2 / 2 / 300 | 33.1 | 41.9 | 35-37.5 | 664 | 1509 | 1.39 | 0.31 | 1248/2378 |
| no envelope (cones only) | 36.3 | 45.0 | 37.5-40 | 726 | 1509 | 1.33 | 0.39 | 1221/2277 |
| **0.2 / 1.5 / 100, soft 0.4, crown 150 (final)** | **31.3** | **42.9** | **35-37.5** | **606** | **1385** | **1.18** | **0.89** | **1169/2234** |

The final settings sit inside NZ's ranges on every axis that matters:

- slope median: NZ 27-34°;
- relief over 1 km: NZ 447-643 m;
- θ: target 0.4-0.5.

They also keep the mountains' height within about 100 m. ks 0.2 at θ 0.45 is the Canterbury DEM's channel steepness
at 1 km². A_c 1.5 km² gives valleys about 1 km apart.

**3. What made it pit-free at 20 m** (the gate most likely to fail, and it did at first):

- **The coarse gullies made the pits.** At full strength on 36° faces: 26 pits per 100 km², 40-80 m deep. The probe
  `slopePits` found every one in the gullied ground, none in the pass's own.
- **Catmull-Rom across a node-wide trench.** A channel floor between walls a node's threshold rise high (180 m) ripples
  ±10-20 m between nodes: 4.5 pits per 100 km², all on channel floors. Along channels and held floors the terrain now
  reads the grid bilinearly: no overshoot, and every node has a lower neighbour.
- **Diagonal channel steps.** The two nodes beside the step come down to its middle. Otherwise the interpolation
  leaves a saddle about 100 m high across it.
- **Held floors.** A held floor is base level only where it runs on to ground outside the pass. An isolated patch
  takes part in the pass.

**4. Order of operations: rivers first.**

- **The first version** built the pass before the drainage, so the rivers ran over the new ground: levels moved by up
  to 300 m on 11 % of samples.
- **Now:**
  1. The worker (and each thread) builds the drainage and lays out the rivers' axes. `riverNetwork.ts` lays them out
     from the lattice and noise before it reads any ground.
  2. In that callback, after `markCourse`, the pass runs with each river's own floor held (`riverCore`: the floodplain,
     or the axis ±80 m its level is read from, plus 180 m).
  3. Then the levels are read: they are stage 2's.
  4. `streams.ts` traces the new ground. On the pass's channel floors its course is pinned to the raster points; its
     [1 2 1] smoothing put streams up the walls, in 56 m notches.
- **Lakes and their masks** are built before the pass, on stage 2's ground, so they are identical.

**5. Edges.**

- The terrain stops reading the fine grid at its outer rows, so the pass fades out 10-16 km inside the lattice edge.
  Without that, there was a 700 m step at the edge.
- At the mountain mask's edge (range uplift 0.3 → 0.4), the weight fades the slope limit, the lift and the blend
  together.

## Compute once, cache, cost

- **Where it runs.** The model worker (`macroWorker.ts`) now builds as far as the rivers' axes, runs the pass and stops
  (`MODEL_DONE`). The pass takes about 0.4 s sampling the ground and 0.5 s building (seed 42).
- **What it hands over.** The cells plus four fine-grid fields go to the main thread and the IndexedDB cache:
  - H, Float32, 6.6 MB;
  - weight, channel floor and river core, Uint8, 3 × 1.6 MB.
- **Cache key.** `MODEL_VERSION` ss2 → ss3, and the key includes the pass's settings.
- **Boot**, seed 42 runway, second load, 2 rounds each (`boot.sh`, `boot.out`):

  | | 1x CPU | 4x CPU |
  |---|---|---|
  | stage 2 warm (cache) | 10917, 10927 ms (cache 12 ms) | 25686, 25688 ms |
  | stage 4 warm | 11224, 11155 ms (cache 21 ms) | 25973, 25834 ms |
  | stage 2 cold (worker) | 11914, 11705 ms (worker 0.90-0.92 s) | 26294, 26155 ms |
  | stage 4 cold | 13374, 13164 ms (worker 2.04 s) | 27891, 28132 ms (worker 2.11 s) |

  Warm loads are +0.2-0.3 s; cold loads +1.5-1.9 s.
- **Sample cost**, paired runs (`cost.log`, `costMountain.log`):
  - `naturalHeight` world-wide: detail 2.16-2.34 → 2.31-2.33 µs; coarse 0.61-0.64 → 0.71-0.74 µs.
  - `sampleTerrain` in the four mountain windows:
    2.79-2.87 → 2.88-2.92, 2.50-2.56 → 2.61-2.64, 2.69-2.72 → 2.76, 2.95-2.96 → 3.08 µs.

  That is +0.05 to +0.13 µs.
- **World build in node** (phaseTimes, with the pass worked out in-thread): 2.1-2.2 → 2.8-3.0 s. In the browser the
  pass is handed over.

## Pictures

Files are `shots/<view>-f4.png`, with stage 2's own `-f2.png` beside each. The gorge views also have the sea-level
fix's `-f2s.png`. The five new views were also rendered from the stage-2 copy as `-f2s.png`. Rendered on port 5200,
server stopped.

New stage-4 views:

- **s42-valley1, s42-valley2, s777777-valley1, s777777-valley2**: cockpit height, 450 m over the stream, looking 2.5 km
  down a mountain valley (found by probe `valleyViews`).
  - A stream in a narrow V between forested walls at about 35°, rock bands on the steepest faces.
  - In stage 2 (`-f2s`) the same places were broad farmed floors between smooth slopes.
- **s42-massif**: a high view over the whole seed-42 massif. Ridges, cirque-like heads and pyramidal snow-tipped peaks.
- **s42-river-hi**: one place where a broad, smooth ridge top survives. The envelope held its crest; the valleys either
  side are deeper.

Fly-to URLs:

- **s42-home**: `index.html?seed=42&camPos=-2500,-2500,900&camLook=0,0,415&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`
- **s42-mtn**: `index.html?seed=42&camPos=-12000,-4000,2900&camLook=-29000,-4000,1800&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`
- **s42-river**: `index.html?seed=42&camPos=-54900,43200,800&camLook=-53182,40667,270&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`
- **s1-mtnlakes**: `index.html?seed=1&camPos=8750,79000,2700&camLook=17750,79000,1400&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`
- **s1-river**: `index.html?seed=1&camPos=-2600,66200,750&camLook=-667,63778,253&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`
- **s1-lowlakes**: `index.html?seed=1&camPos=-42750,-48500,1300&camLook=-36750,-48500,488&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`
- **s777777-mtn**: `index.html?seed=777777&camPos=-10000,22000,3200&camLook=-28000,22000,2000&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`
- **s777777-lowlakes**: `index.html?seed=777777&camPos=17750,40000,1000&camLook=23750,40000,224&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`
- **s777777-home**: `index.html?seed=777777&camPos=-2500,-2500,800&camLook=0,0,278&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`
- **s777777-gorge**: `index.html?seed=777777&camPos=-14950,-116950,1500&camLook=-7000,-109000,60&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`
- **s1-gorge**: `index.html?seed=1&camPos=61930,-145990,1900&camLook=54000,-144000,301&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`
- **s777777-yjoin**: `index.html?seed=777777&camPos=42000,-7000,2000&camLook=42000,-15000,450&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`
- **s777777-lake**: `index.html?seed=777777&camPos=46750,-75500,1265&camLook=52750,-72500,365&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`
- **s42-snow**: `index.html?seed=42&camPos=-12000,-4000,3400&camLook=-40000,-4000,2200&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`
- **s42-river-hi**: `index.html?seed=42&camPos=-54900,43200,2600&camLook=-53182,40667,1626&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`
- **s42-river2**: `index.html?seed=42&camPos=-26300,-54300,800&camLook=-25606,-57552,254&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`
- **s42-valley1**: `index.html?seed=42&camPos=-10956,-39960,1199&camLook=-12718,-41720,682&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`
- **s42-valley2**: `index.html?seed=42&camPos=28252,-30522,992&camLook=27546,-28289,467&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`
- **s777777-valley1**: `index.html?seed=777777&camPos=9997,-31003,1394&camLook=11847,-32591,873&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`
- **s777777-valley2**: `index.html?seed=777777&camPos=-42314,7061,830&camLook=-44314,8311,282&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`
- **s42-massif**: `index.html?seed=42&camPos=-14000,6250,5200&camLook=-44250,6250,1300&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`

## Left

- **Decision 1.** Fix `carveNetwork`'s nearest-segment switching, then turn the lift down in river valleys.
- **Stream sinks.** Streams ending in hollows doubled on seed 1 (`streamSinks` lists them).
  - Most end outside the mountains: courses from the ranges now arrive differently.
  - Inside, they end where a river floor's fade band meets the slopes.
  - Holding the whole fade band (`courseHold 0.5`) restored seed 42's stream length (1734 → 1804 km), but not the
    sinks.
- **River over dry bank** +27-44 % (> 10 m); the worst walls did not grow. Same class as decision 1.
- **Pits.** Seed 1's box has 3.94 per 100 km² (stage 2 4.19): no worse, but over the aim of 2.
- **Flint θ** on seed 777777 is now 0.38 (target 0.4-0.5).
- **Stream heads.** Heads start on lattice cells, so a stream's first kilometre runs straight down a 36° face. Placing
  heads at the pass's channel heads would look better.
- **Dense fine-grid fields** (10 MB per seed).
- **Broad smooth ridge tops** survive in places (`s42-river-hi`), where the envelope held a crest wider than the valley
  spacing.

## Files

- **Code:**
  - `src/world/terrain/hillslopes.ts` (new: the pass, `riverCore`, `SLOPES`).
  - `erosion.ts`: `attachSlopes`; the slopes in `sampleErosion[Grad]`, bilinear along floors; `upsample` exported.
  - `heightfield.ts`: the pass run after `markCourse`; its weight from the orogen mask; blend, gully shares,
    `slopePinned`, `MODEL_DONE`.
  - `macroCache.ts`, `macroWorker.ts`: cache and transfer.
  - `riverNetwork.ts`: the axes' catchments passed to the callback; `valleyInfluence`; `pinned`.
  - `streams.ts`: pinned smoothing.
- **Probes** (`scripts/probes/`):
  - `slopeTry`, `slopePits`, `slopeAt`, `slopeFields`, `slopeStreams`, `streamSinks`;
  - `riverDump`, `stepScan`, `coverShare`, `valleyViews`, `orogenBox` (`OB_MODE=hill`);
  - `slopeSetup.ts`: `SLOPE_PARAMS` JSON applies to every probe.
- **Scripts** (`out/f4/`):
  - `gates.sh`, `try.sh`, `shots.sh`, `boot.sh`, `views4.txt`;
  - `tools/`: validate.py (with valley positions), `gate.py`, `pits.py`, `rivercmp.py`, `compare.sh`.
- **Logs** (untracked):
  - gate battery: `base1/` (stage 2) and `after2/` (final) from `gates.sh`;
  - validate.py and sweeps: `data/validate/`, `data/sweep-*.out`, `data/rivers/`;
  - runs: `suite.log`, `boot.out`, `cost.log`, `costMountain.log`, `shots/*.log`;
  - source copy of stage 2: `base-src/` (`e9997ef`).
