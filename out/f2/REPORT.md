# Foundation stage 2: the wide orogen, lowland lakes back, snow line re-set

Branch `exp/foundation2` (from stage 1's `cbaeee4`), worktree `~/github/fs-exp/foundation2`. Nothing merged or pushed.

| commit | what |
|---|---|
| `d0e4bda` | airfields: shortlist further spots while too few fields stand far enough apart (no change where the first 60 spots suffice: seed 0) |
| `8c757bb` | river network: a river reaching the sea ends at the sea's level |
| `9443fab` | **the model**: wide orogen, lowland lakes kept, U/K and concavity re-set, seeded snow line, coast ramp beyond the lattice; tests, seed-7 board |
| `536fe8a` | probes (orogenSweep, gradFloor, lakeKeep, riverZero, ...) |
| `bb6b641` | no kept lake on a trunk river (>= 500 km²) that would breach it anyway |
| `eef8ece` | river network: a meander belt narrows to nothing over its line's last meander length (no self-crossing at a line's end) |

## Short version (what the owner will see)

- **3 seeds in 4 now have one wide mountain mass** (40-80 km across) instead of narrow ridges in wide hill country; the
  rest keep the narrow type. Seeds 1, 7, 42, 1234, 99991 and 777777 all rolled wide; 2, 5, 12 are narrow examples.
  Inside the mass, big rivers join in the mountains and leave through fewer, bigger exits (largest exits 1600-4600 km²,
  up to 85 % of their river's mouth).
- **Peaks are lower and less white.** Seed-42 box p99 2995 m (stage 1) -> 2349 m (before stage 1: 2465 m); world
  lattice p99 2100-2250 m, highest summits 2900-3500 m. Seeded snow line 100 m under seed 0's: snow on the highest
  summits and ridges, not whole massifs (`s42-mtn`, `s777777-mtn`, `s42-snow`).
- **Lowland lakes are back:** 70 / 74 / 59 lakes on seeds 1 / 42 / 777777 (stage 1: 0; before: 110 / 95 / 121 lowland of
  263 / 258 / 231). All in hill country and plains, ~45 % on a river with inflow and outflow. Mountain lakes and tarns
  stay lost (owner's call).
- **Big rivers are gentler:** 2 km gradient of rivers >= 500 km² at 200-400 m 0.12-0.58 % (stage 1 0.12-0.67, before
  0.19-0.72); at 400-700 m 0.12-1.12 % (stage 1 0.08-1.00, before 0.01-3.94). The level-band medians stay 0.7-3 %
  because 2/3 of the samples are 45-100 km² streams, now mostly inside the mountains.
- **Still the same look close up:** the new mountain mass has hill-country fine relief between the old belts (smooth
  massifs, stage 4), and a stage-1 defect remains: some big rivers' water is held at sea level far inland, so they run in
  canyons up to ~150 m deep (seed 42 ~96 km of river; stage 1 had the same, 88 km). Details under "Left".

## Owner decisions first

1. **Gate "largest exit / mouth >= 0.4" missed, as the review predicted.** Relief classes 0.24 / 0.38 / 0.23 (before
   0.09 / 0.20 / 0.16, stage 1 0.10 / 0.14 / 0.08). In the orogen's own classes (mountain where the model's range uplift
   >= 0.3) it is 0.40 / 0.51 / 0.36. The spike's widefull gave 0.26-0.37; the landform review (§3) proposed >= 0.25 for
   stage 2 and >= 0.4 for stage 3 (structure: front blocks, longitudinal valleys). Recommend accepting that split.
2. **Re of sea basins <= 0.65 missed** (0.74 / 0.73 / 0.69; before 0.73 / 0.72 / 0.70). The review moves it to
   deposition (stage 6): fans make the long parallel plain rivers. Recommend moving it.
3. **Concavity m = 0.6 on the 1 km lattice** (was 0.45), U/K 400 m/km (was 450). This is what makes the trunks gentle
   while the ridges keep their height. With m 0.45 the wide orogen needs U/K 300 to bring peaks down, and then trunks
   at 400-700 m run 0.7-2 % and exit/mouth drops to 0.23 / 0.30 / 0.28. Against it: the 20 m Flint θ came out 0.51,
   just over the 0.4-0.5 target (stage 1 0.47, before 0.39). Alternative: keep 0.45 and accept steeper trunks.
4. **Type mix: 74 % wide, 26 % narrow** (`seededLayout.ts OROGEN_WIDE`, salt 0x0a06e). Wide everywhere, or more narrow?
5. **Lakes: fewer in total, more per lowland km².** The orogen turned about half the old hill country into mountains,
   where lakes still go. Per 1000 km² of remaining lowland: 3.1 / 2.6 / 2.6 lakes (before 2.3 / 1.9 / 2.2 per 1000 km²
   of the old lowland). A narrow seed keeps far more (seed 2: 206 lakes). Keep as is, or also keep hollows in the
   orogen's outer margin (they would sit in raised, steeper ground)?
6. **Fix the sea-level river defect before merging?** It predates stage 2 (stage 1, see "Left"), but the bigger relief
   makes its canyons and the walls they leave more visible (bank walls up to 147 m, two lake-shore walls of 50-65 m on
   seed 42). Recommend a small separate task before stage 3.

## What changed

**Wide orogen** (`erosion.ts orogenEnvelope`, `seededLayout.ts seededOrogen`). The model's range uplift is the
ridged-noise belts' uplift blurred (Gaussian, σ 12 km), scaled so the blurred field's top share rises at the full rate
(gain 2.2), the belts kept where higher: the spike's `wide`, run as `widefull` (started from today's noise ground).
Computed on the lattice in `modelInputs`; the noise ground, the home-site search and the layout are unchanged. 74 % of
seeds roll it (`mulberry32(seeded(0x0a06e))() < 0.75`); the rest keep stage 1's narrow ranges. Sweeps (probe
`orogenSweep`, logs `out/f2/sweep*.full.log`, `out/f2/sweepfmt.sh` to compact them): σ 9/12/14/16 km, gain 2.2/2.8,
U/K 250-450, m 0.45-0.65 on seeds 1/42/777777. σ 12 / gain 2.2 was as good as any; wider masses gave no better
relief-class exits and fewer lakes.

**U/K and concavity** (`erosion.ts STEADY`): ridge 450 -> 400 m/km, m 0.45 -> 0.6 (see decision 3). Grade floor and
threshold slope unchanged. `MODEL_VERSION` ss1 -> ss2 (the IndexedDB key).

**Lowland lakes** (`erosion.ts keptHollows`). The noise ground's closed hollows that drainage.ts could make a lake of
(>= 15 m deep, 2-120 cells, off the orogen's mountains: range uplift at the hollow's floor < 0.25/1.15, clear of the home
field; and for a river of >= 500 km² through it, 15 m deep beyond its 3 sqrt(A) breach allowance) are held: their cells
may not rise over the noise ground (`cap`, the mechanism the home runway's corridors use), the rim and the ring beyond
may not fall under it, and the rim is raised toward the spill by up to 20 m (`sill`). They are not base level: the
priority flood still fills and routes through them, so each sits in the drainage tree with its inflows and its outflow.
What the probes caught on the way: without the ring hold, the B-spline of the model's change carried the graded
ground's lowering into the rims (only 46 of 135 kept hollows became lakes on seed 42); with the rim held at the full
spill level, an outlet cell beside the sea was raised 200 m into a cliff (a 140 m lake wall); trunk rivers through held
hollows got a breach notch through ungraded ground instead of their graded valley (hence the >= 500 km² rule).

**Snow line** (`heightfield.ts seededSnow`): -100 m in a seeded world, through `snowLineBase()` (shader text) and
`snowLine()` (CPU, biome.ts); exactly 0 at seed 0, so seed 0's shader text and presentGuard are unchanged. A -200 m
trial made seed 777777's highest massif white again (`out/f2/shots/s*-mtn-f2b.png`); 0 left only a few caps
(`s42-mtn-f2a.png`).

**Coast beyond the lattice** (`erosion.ts coastKeep`): outside the lattice no sea cell holds the model's change down at
the shore, so a +220 m change carried on from the edge cells made a 145 m cliff at the water's edge (seed 777777's edge
step). There the change now comes in over the noise ground's first 80 m above the sea. Inside the lattice unchanged.

**Fixes the new worlds needed** (each found by the suite): seed 7 found only 7 of 8 airfields in the first shortlist
(the flattest 60 spots crowded onto one plain): further spots are shortlisted in turn, up to four rounds; a seed that
found its set in the first round is byte-identical (seed 0). A sea-reaching river's last level is the sea's (seed 7: a
mouth at 0.7 m read as a river ending on nothing). A meandering line came back onto its axis at its end in one 850 m jump
across its own loop (seed 1234): its belt now narrows to nothing over its last meander length.

**Tests**: `tests/terrain/seededWorld.test.ts` > 3 lakes and `tests/career/landmarks.test.ts` seed 7 > 4 lake
landmarks are back, comments updated. `waterFlow.test.ts`: the ice key may carry a negative snow level (the test shifts
the line by -2500 m: -100 m at a seeded world). `bedrock.test.ts`: builds the tile holding the steep reach's sample
(the tile at its boulder cell's corner missed the channel on the new ground). Seed 7's golden board re-baked; seed 0's
entry byte-equal (the diff touches seed 7's lines only; JSON of seed 0 equal to cbaeee4's). Full suite
`npx vitest run --no-file-parallelism tests/terrain tests/world tests/era tests/career`: 58 files, 745 tests pass
(`out/f2/suite3.log`), presentGuard untouched and passing.

## Gates (seeds 1 / 42 / 777777; before = cea3349, stage 1 = cbaeee4, stage 2 = eef8ece)

Logs: before and stage 1 from `~/github/fs-exp/foundation/out/f1/{before,after5}`, stage 2 `out/f2/after4`
(`out/f2/gates.sh`). Tree measures on the lattice the world's drainage routes (treeMeasure).

**Relief classes** (5 km relief >= 500 m mountain, >= 150 m hill: the NZ-comparable rule; Canterbury 1 km in brackets):

| | before | stage 1 | stage 2 | target |
|---|---|---|---|---|
| largest exit / mouth p50 (rivers >= 500 km² to the sea) | 0.09 / 0.20 / 0.16 | 0.10 / 0.14 / 0.08 | **0.24 / 0.38 / 0.23** (n 16 / 25 / 11) | >= 0.4 (0.52): **miss** |
| >= 45 km² joins inside the ranges | 38 / 32 / 32 % | 18 / 17 / 14 % | **56 / 45 / 52 %** | >= 40 % (49 %): pass |
| >= 200 km² joins inside the ranges | | | 42 / 27 / 43 % | (47 %) |
| mountain distance to front p90 | 7.4 / 9.5 / 8.2 km | 12.5 / 12.2 / 9.2 km | **30.9 / 29.4 / 22.1 km** | >= 15 km (16): pass |
| Re, sea basins >= 100 km² p50 | 0.73 / 0.72 / 0.70 | 0.72 / 0.71 / 0.67 | **0.74 / 0.73 / 0.69** | <= 0.65 (0.44): **miss** |
| exits >= 45 km²: n; nearest-neighbour spacing p50 | | | 91 / 96 / 103; 7 / 8 / 4 km | |

**Orogen classes** (stage 2 only; mountain where the model's range uplift with the envelope >= 0.3, the spike's
"variant's uplift classes"): exit / mouth 0.40 / 0.51 / 0.36; >= 45 km² joins inside 66 / 55 / 64 %; distance to front
p90 36 / 37 / 29 km. **Field classes** (the generator's old narrow belts, kept for continuity; no longer the mountains):
exit / mouth 0.10 / 0.12 / 0.10 (before 0.07 / 0.12 / 0.08, stage 1 0.07 / 0.08 / 0.08), joins inside 12 / 14 / 10 %.

Drawn rivers are the lattice lines one for one (431/431, 425/425, 434/434). Hack h 0.55 / 0.57 / 0.55 (not a 1 km gate).

**River gradient over 2 km, p50 %** (drawn kind-0 rivers; probe `gradFloor`; before: `out/f2/gradFloor-before.log`):

| band | catchment | before | stage 1 | stage 2 |
|---|---|---|---|---|
| 200-400 m | all | 1.24 / 1.84 / 1.43 | 1.18 / 1.94 / 0.88 | 0.92 / 1.70 / 0.73 |
| | >= 500 km² | 0.72 / 0.19 / 0.34 | 0.31 / 0.67 / 0.12 | **0.28 / 0.58 / 0.12** |
| 400-700 m | all | 3.67 / 5.43 / 4.99 | 1.78 / 2.70 / 1.49 | 2.38 / 3.05 / 1.25 |
| | 45-100 km² | 4.02 / 5.41 / 5.12 | 2.06 / 3.19 / 1.94 | 2.62 / 3.42 / 1.54 |
| | 100-500 km² | 3.69 / 5.63 / 4.62 | 1.36 / 1.98 / 0.68 | 1.89 / 2.09 / 0.90 |
| | >= 500 km² | 0.01 / 3.94 / - | 1.00 / 0.08 / 0.53 | **0.42 / 1.12 / 0.12** (n 790 / 142 / 2005) |
| 0-200 m | >= 500 km² | | | 0.11 / 0.12 / 0.06 |

Real foothill rivers (0.2-0.7 %) are big rivers: stage 2's >= 500 km² rows are there or near (seed 42's 400-700 m row
is 142 samples of one river). The "all" rows are 2/3 45-100 km² streams; at 400-700 m these now lie inside the orogen
(model uplift ~1.1-1.2 there against ~0.4 in stage 1), where 2-3.5 % is a mountain stream's gradient (the NZ braid line
at 60 km² is 1.4 %). An aim, not a hard gate: met for big rivers; the band medians are not, and could not be without
making mountain streams unrealistically gentle.

**Lakes** (lakeKinds, lakeStats, tarnCount):

| | before (cea3349) | stage 1 | stage 2 |
|---|---|---|---|
| lakes | 263 / 258 / 231 | 0 / 0 / 0 | **70 / 74 / 59** |
| by field class, mountain / hill / plain | 153/97/13, 163/82/13, 110/104/17 | 0 | 0/44/26, 0/47/27, 0/45/15 |
| by relief class on the lattice, mountain / hill / plain | 163/91/9, 161/88/9, 112/103/16 | 0 | 0/56/14, 2/58/14, 2/45/13 |
| on a river (inflow and outflow) | 131 / 115 / 106 | 0 | 31 / 30 / 27 |
| level < 300 m; 300-800 m | 74; 52 / 54; 58 / 77; 62 | 0 | 55; 15 / 63; 11 / 43; 17 |
| tarns | 21 / 28 / 24 | 0 | 0 |
| water, km² | 1324 / 1348 / 1173 | 0 | 620 / 562 / 573 |
| lowland lakes per 1000 km² of lowland (¹) | 2.3 / 1.9 / 2.2 | 0 | 3.1 / 2.6 / 2.6 |
| kept hollows (model) -> lakes | | | 101 -> 70, 111 -> 74, 88 -> 59 |

(¹) before: field-class hill + plain land (48.5 / 50.2 / 54.0 thousand km²); stage 2: land off the orogen's mountains
(22.6 / 27.9 / 22.7 thousand km²). Lake levels settle within 7 / 23 / 38 m of their spill (one per seed lowered by more
than 10 m). About 30 % of the kept hollows do not become lakes: drainage.ts's own rules (breach allowance, water over the
detailed ground at the middle) drop them, as they dropped noise hollows before stage 1.

**Home siting** (homeCheck): ok on seeds 1, 7, 42, 1234, 99991, 777777 and the narrow seeds 2 and 5; elevation and pad
spread as sited; approach and far end 0 m over the 4 % surface, circuit 15-102 m. **Coast and plains present**: relief
plain class 13-17 % of land, most lakes at < 300 m, rivers reaching the sea on every seed. **No NaNs** (edgeScan 0/0/0).

**Other checks** (before -> stage 1 -> stage 2):
- Edge steps (largest step between samples 25 m apart, 150-180 km out): 93 / 158 / 86 -> 88 / 72 / 68 -> **76 / 78 / 68
  m**. Seed 42's 78 m sits on the lattice edge (N -160000 E -123500) where the model lowers the ground 467 m: the
  gullies' fall line turns across the edge (stage 1's edge class, larger offset). Worst of three 78 < stage 1's 88, but
  seed 42 alone is 6 m worse.
- Water over ground > 10 m (overGround, ~110k points): 2 / 10 / 0 -> 5 / 9 / 8 -> **13 / 29 / 6** (all but a few on
  meander loops > 200 m off the valley axis: steeper valleys under the same meander rule).
- River over a dry bank (waterWalls) > 10 m: 1028 / 1313 / 1010 -> 1190 / 1429 / 828 -> **1371 / 1568 / 1108**; worst
  55 / 47 / 74 -> 68 / 65 / 45 -> **147 / 78 / 147 m** (seed 1 at N 18950 E -74450, seed 777777 at N 72750 E -71050).
- Lake-shore walls > 10 m: 0 / 3 / 0 (stage 1) -> 1 / 4 / 0; seed 42 has two > 50 m (worst 65.5 m at N 63150
  E -33200): a pool beside a river carved down to sea level (the defect under "Left").
- Streams 700 / 720 / 743 (2006 / 1778 / 2143 km, sinks 19 / 45 / 38); feeders 290 / 274 / 287, unfed 32 / 18 / 20;
  dry river heads with no feeder 17 / 14 / 14 (stage 1 11 / 16 / 9).

## Task 2: is the 400-700 m gradient on the floor? No: on U/K.

Probe `gradFloor` on stage 1 (`out/f2/gradFloor-stage1.log`): for every drawn river sample, the lattice cell's catchment,
the model's uplift there, the stream-power slope (U/K) u A^-m and the floor 0.06 A^-0.45 (steadyLattice takes the
larger). At 400-700 m the floor binds on 0-16 % of samples; the stream-power slope (1.1-4.4 % p50) sets the rest. So the
layout and U/K are the levers, and the U/K / concavity change moved the big rivers. Two more things:
- The floor is a true slope (`grade * g * L * A^-0.45` with L the cell in metres: 0.06 at 1 km², 0.27 % at 1000 km²).
  The review's "1000x too small" (`~/github/fs/out/landforms/review-drainage-tree.md` §2) applied to the spike's probe
  code, not to `erosion.ts`; nothing to chase.
- After stage 2 the floor sets the big rivers' gradient in the lowland (it binds on 62-83 % of >= 500 km² samples at
  0-200 m, which run at 0.06-0.12 % over 2 km), and partly higher up on seed 777777 (28-48 % at 200-700 m). From here the
  floor constant is the lever for the plains: the review's two floors (k ~0.14 braided gravel, ~0.035 winding) belong
  with deposition.

## Snow line, peaks, slopes (validate.py, seed-42 mountain box, 20 m export; `out/f2/data/validate/`)

| | before | stage 1 | stage 2 |
|---|---|---|---|
| elevation p50 / p95 / p99, m | 1398 / 2235 / 2465 | 1283 / 2613 / 2995 | 1236 / 2118 / 2349 |
| slope p50 / p90, ° | 15.8 / 35.4 | 16.6 / 33.9 | 18.6 / 34.3 |
| relief over 1 / 5 km, m | 346 / 1234 | 369 / 1285 | 398 / 1258 |
| Flint θ / Hack h | 0.39 / 0.42 | 0.47 / 0.43 | 0.51 / 0.42 |
| dry closed basins > 50 m deep, > 0.2 km² | 56 (98.7 km²) | 2 (0.8 km²) | 1 (1.1 km²) |

Whole lattice (orogenSweep at the final settings): land p99 2246 / 2120 / 2243 m, p99.9 2746 / 2451 / 2589 m, highest
3529 / 2887 / 3100 m (U/K 450 and m 0.45 over the orogen gave p99 3495-3795 m, highest 4705-5324 m). Snow line 2400 m
± 180 m noise in seeded worlds (2500 at seed 0). Baseline for stage 4 (validation.md targets: NZ ranges 27-34° p50 at
20 m, 1 km relief 450-650 m): the box is at 18.6° and 398 m; on the 1 km lattice the mountain slope p50 is ~13°
(Canterbury block means 9.6°), hill 3.4-3.6° (Rangitikei 2.6°).

## Load time and sample cost

Seed 42, runway start, second load, navigation to `window.__ready`, ms (`out/f2/boot.sh`, logs `out/f2/logs/`,
`out/f2/boot.out`, `boot2.out`); stage 1 (`out/f2/s1`, cbaeee4) run alternately on the same port. "Model" = the wait
for the model cells.

| | 1x CPU | 4x CPU (main thread throttled) |
|---|---|---|
| stage 1, warm (cells from IndexedDB) | 9846, 9897 (model 12, 12) | 23007, 23267 (model 43, 66) |
| stage 2, warm | 10606, 10575 (model 15, 11) | 24612, 24761 (model 43, 69) |
| stage 2, cold (`modelcache=0`: model worker) | 11389, 11389 (model 905, 896) | 25420, 25484 (model 919, 942) |

A warm load is ~0.7 s slower than stage 1 at 1x (~1.5 s at 4x); stage 1's report had before (cea3349) at ~10.0 s and
23.5-24.1 s. In node the world build (min of rounds, seed 42, `phaseTimes`) goes 1708 -> 1987 ms: airfield siting
143 -> 208 ms, the rest mostly the lakes being back (pond settling against the detailed ground, the lake mask and its
shore smoothing; cea3349 with 256 lakes built in ~2.2 s), plus the kept-hollow routing (one more lattice route, ~20 ms).
A first visit adds the worker's ~0.9 s (sampling plus the model), as in stage 1. The owner set load time as no concern.

Paired, 2 rounds, stage 1 copy against stage 2 (`out/f2/cost.log`):
- `naturalHeight` over a world-wide grid (heightCost, seed 42): 2.04-2.08 -> 2.08-2.16 µs; coarse 0.53-0.62 -> 0.55-0.58 µs.
- `sampleTerrain` in four 8 km mountain windows (costMountain, min of 5): 2.62-2.64 -> 2.60-2.67, 2.33-2.36 -> 2.34-2.39,
  2.54-2.56 -> 2.61, 2.71-2.72 -> 2.87-2.88 µs. All within +0.16 µs of stage 1 (the windows now lie on different ground).

## Pictures

`out/f2/shots/<view>-{before,after,f2}.png`: `-before` (cea3349) and `-after` (stage 1) are stage 1's own shots,
copied; `-f2` is this stage (`out/f2/shots.sh`, views `out/f2/views.txt`, port 5198, stopped). Fly-to URL per view:

- **s42-home**: farmland and the home field as before, rolling hills, the ranges off to the right.  
  `index.html?seed=42&camPos=-2500,-2500,900&camLook=0,0,415&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`
- **s42-mtn**: near range much as in stage 1 but lower; snow only on the highest summits and ridgelines (stage 1: a white massif behind).  
  `index.html?seed=42&camPos=-12000,-4000,2900&camLook=-29000,-4000,1800&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`
- **s42-river**: the camera (800 m) is now underground: the 560 km² valley at ~270 m lies inside the orogen, raised to 1600-1800 m. See s42-river-hi.  
  `index.html?seed=42&camPos=-54900,43200,800&camLook=-53182,40667,270&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`
- **s42-river-hi**: (new: the same look point from 2600 m) the old valley is now a smooth forested ridge between two farmed valleys (smooth: stage 4).  
  `index.html?seed=42&camPos=-54900,43200,2600&camLook=-53182,40667,1626&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`
- **s42-river2**: the biggest river's valley: still a broad farmed valley with a winding river between forested mountain walls, side valleys joining.  
  `index.html?seed=42&camPos=-26300,-54300,800&camLook=-25606,-57552,254&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`
- **s1-mtnlakes**: the old ~1400 m lake plateau: a farmed valley floor between forested mountains, snow on one summit; no lakes (mountain ground).  
  `index.html?seed=1&camPos=8750,79000,2700&camLook=17750,79000,1400&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`
- **s1-river**: two rivers joining on a farmed floor in a valley that leaves between steep forested mountain walls (stage 1: open valley).  
  `index.html?seed=1&camPos=-2600,66200,750&camLook=-667,63778,253&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`
- **s1-lowlakes**: the noise world's lowland lake cluster: forested hill country here now (these hollows lay in what is now the orogen's reach).  
  `index.html?seed=1&camPos=-42750,-48500,1300&camLook=-36750,-48500,488&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`
- **s777777-mtn**: same range, lower and greener; a few snow patches and one snow-capped summit far off (stage 1: a white summit dome).  
  `index.html?seed=777777&camPos=-10000,22000,3200&camLook=-28000,22000,2000&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`
- **s777777-lowlakes**: the 170-224 m lake basin: plantations on rolling hills, no lake at this spot.  
  `index.html?seed=777777&camPos=17750,40000,1000&camLook=23750,40000,224&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`
- **s777777-home**: farmland and field as before, range behind.  
  `index.html?seed=777777&camPos=-2500,-2500,800&camLook=0,0,278&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`
- **s777777-gorge**: (new) the 2847 km² river (79 % of its mouth) leaving the ranges at -7000,-109000: it shows the open defect, a pale 1.5 km floor carved down to sea level through the plain (riverZero).  
  `index.html?seed=777777&camPos=-14950,-116950,1500&camLook=-7000,-109000,60&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`
- **s1-gorge**: (new) the 3428 km² river (85 % of its mouth) leaving the mountains at 54000,-144000 down one valley, winding through farmland; snow on the range behind.  
  `index.html?seed=1&camPos=61930,-145990,1900&camLook=54000,-144000,301&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`
- **s777777-yjoin**: (new) the 841 + 546 km² join at 42000,-15000 (450 m) inside the ranges: one valley between forested mountain walls, the branches meeting upstream.  
  `index.html?seed=777777&camPos=42000,-7000,2000&camLook=42000,-15000,450&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`
- **s777777-lake**: (new) an 81-cell lowland lake at 365 m (catchment 384 km²) with its inflow and outflow, farmland on its shores.  
  `index.html?seed=777777&camPos=46750,-75500,1265&camLook=52750,-72500,365&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`
- **s42-snow**: (new) the seed-42 ranges further out: snow on the summits and some ridgelines, green and rock below.  
  `index.html?seed=42&camPos=-12000,-4000,3400&camLook=-40000,-4000,2200&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`

Trials: `s42-mtn-f2a.png` (snow line unchanged), `s42-mtn-f2b.png` / `s777777-mtn-f2b.png` (-200 m, earlier model).

## Left (stage 3 / 4 and open items)

- **Rivers held at sea level far inland** (a stage-1 class): probe `riverZero` counts lines whose water level is under
  1 m while the natural ground under them stands > 30 m: before 5 / 5 / 3 lines (3 / 10 / 7 km), stage 1 9 / 21 / 13
  (22 / 88 / 34 km), stage 2 10 / 23 / 11 (29 / 96 / 42 km). The river is carved into a canyon down to sea level. On
  seed 42's main river the level falls ~4.5 m/km along a 150-250 m plateau from 60 km out (`lineLevel`); no other line
  near that spot is held at 0 m (`linesNear`). Not traced: candidates are riverNetwork.ts's confluence cut (a tributary
  arriving low "cuts the river it joins down with it below the confluence"), capFall's spread of a drop upstream, and the
  B-spline not reproducing a one-cell-wide graded valley near the coast. The probes are the handle.
- Exit / mouth >= 0.4 and Re (decisions 1, 2): stage 3 (front blocks, erodibility along strike) and stage 6.
- The orogen's mountains between the old belts carry hill-country fine relief and gully amplitude (`amplitude =
  hillAmp + 3100 uplift`, from the noise): smooth massifs. Stage 4 (PLAN §3.3: amplitude from T's own relief).
- Water over ground and river-bank walls rose with the steeper mountain valleys (numbers above).
- Seed 42's 78 m edge step: the gullies' fall line turns at the lattice edge where the change is large.
- Kept-hollow selection copies drainage.ts's rules (depth, cells, breach allowance); keep them in step if those change.

## Files

- Model: `src/world/terrain/erosion.ts` (orogenEnvelope, keptHollows, coastKeep, STEADY), `heightfield.ts`
  (upliftParts, seededSnow, the seededInputs probe hook), `seededLayout.ts` (OROGEN, seededOrogen, forceOrogen),
  `airfieldSiting.ts`, `riverNetwork.ts`.
- Probes: `scripts/probes/{orogenSweep,gradFloor,lakeKeep,lakeKinds,lakeWall,riverZero,lineLevel,lineCellsT,linesNear,
  riverNear,selfCross,edgePoint,viewSites2,treeMeasure}.test.ts`.
- Scripts: `out/f2/gates.sh`, `shots.sh`, `boot.sh`, `views.txt`, `sweepfmt.sh`, `tools/{validate,lf,basins,boxstats}.py`.
- Logs (untracked): `out/f2/after4/` (final gates; `tree/` measures and lattice pictures), `out/f2/sweep*.full.log`,
  `out/f2/gradFloor-{stage1,before}.log`, `out/f2/lakeKinds-before.log`, `out/f2/suite3.log`, `out/f2/data/validate/`,
  `out/f2/logs/` (boots), `out/f2/cost.log`.
- Untracked source copies used for the before / stage-1 numbers: `out/f2/base` (cea3349), `out/f2/s1` (cbaeee4).
