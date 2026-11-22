# Foundation stage 4 steps: the pale slabs on the valley sides

Branch `exp/foundation4-steps` (from stage 4's `872eda5`), worktree `~/github/fs-exp/foundation4-steps`. Nothing merged
or pushed. "Stage 4" below means `872eda5`; "stage 2" means `e9997ef`, as in `out/f4/REPORT.md`.

| commit | what |
|---|---|
| `02c1e53` | the fix (`riverNetwork.ts` wallLift, perLineBlend, per-side wall gaps; `heightfield.ts` carveNetwork, breachLift; `erosion.ts` the core's taper); probes `stepWhy`, `viewRay`, `section`, `gapDump`, `bankHeight` |
| (last) | this report, scripts and tools (no golden re-bake was needed) |

## Short version

- **The slabs are carve artefacts, but not mainly from the segment switch.** Most of them are the outer band of the
  valley carve's reach on 36° walls:
  - The carve's walls climb as t² to the ground at the reach's edge.
  - On a straight threshold wall that cuts about a third of the wall's height at mid-reach.
  - The carve then meets the wall at twice its slope, and fades out over the last quarter of the reach.
  - The result is a band of 50-70° rock along the valley side, about a reach from the river (I ≈ 500 m for the small
    rivers).
  - The nearest-segment switch caused only the three worst steps (181, 172, 167 m). Stream breaches against 36° slopes
    were a third cause (about 50 steps a seed). Details under item 1.
- **The fix:**
  - Where the threshold hillslopes stand, the carve now only lowers their walls. It lowers them by the floor's gap,
    tapering out to the reach's edge, so the V stays a V, sunk to its water.
  - Stream breaches are handled the same way.
  - A valley's stretches are blended where its nearest point switches.
  - Outside the mountains nothing changes. Seed 0 does not run any of this.
- **Steps over 50 m** (stepScan, seeds 1 / 42 / 777777):
  - stage 4: 174 / 148 / 233;
  - now: **12 / 17 / 64**;
  - stage 2: 37 / 44 / 70; the gate (1.3× stage 2) is 48 / 57 / 91.
- **Steps over 100 m:** stage 4 1 / 1 / 3, now **0 / 1 / 2** (stage 2 had 1 / 3 / 2).
- **In the pictures the long benches are gone.** Ground steeper than 50° in the two views:
  - `s42-valley1`: 5.4 % → 1.6 %;
  - `s777777-valley1`: 6.7 % → 1.2 %.
- **Seed 42 box: every gate passes.**
  - p50 31.4°;
  - peak 35-37.5°;
  - relief over 1 km 604 m;
  - valley b 1.20;
  - pits > 10 m 1.56 per 100 km².
- **Unchanged:** riverZero, lakes, homeCheck, edge steps, and river levels on every river whose channel is laid as
  before. `riverLift` stays at 1: it was never needed lower.
- **Worse:**
  - Seed 1's valley b is 1.24 → 1.33. Seed 1 is not a gate box.
  - Seed 1's water over ground > 10 m is 40 → 55. Item 4 explains it.
  - One stream on seed 42 now drops 150 m in one sample beside a wall: the worst waterWalls entry there, 74 → 151 m.

## 1. What the slabs are (evidence)

**Steps classified** (probe `stepWhy`):

- Each step over 50 m in stepScan's profiles is put in one class:
  - the natural ground jumping with it;
  - a line's nearest axis point jumping more than 150 m along the axis (a switch);
  - a stream breach;
  - a river channel's margin;
  - otherwise, the step's position in the valley's reach, t = (d - floodplain) / I.
- Logs: `base/stepWhy.log` (stage 4), `base/stepWhy-f2.log` (stage 2); classifier `cat.py`.

| stage 4, seeds 1 / 42 / 777777 | steps > 50 m |
|---|---|
| outer reach t ≥ 0.75, small river (I ≈ 500 m) | 97 / 92 / 89 |
| outer reach, big river (I > 1000 m) | 9 / 5 / 75 (the 777777 one is a 1000 m deep gorge, below) |
| stream breach against a slope (no valley near) | 58 / 47 / 51 (stage 2: none) |
| segment switch | 5 / 1 / 4: the worst three, 181 / 149 / 172 m |
| natural ground, channel margin | 5 / 3 / 6 |

**The pictures** (probe `viewRay`; script `tools_overlay.py`):

- **How it was measured.**
  - Rays are cast from each view's camera (fov 55°) onto `sampleTerrain`.
  - Each hit is classified by slope, the CPU's surface class and the valley reach.
  - The result is set against the shot's pale pixels (saturation < 0.22, value > 120).
- **The match** (`ray/s777777-valley1-overlay.png`, `ray/s42-valley1-overlay.png`):
  - The red overlay (slope > 50° in a valley's outer reach, t 0.6-1) lies exactly on the long pale bands. Those are the
    three horizontal benches in `s777777-valley1-f4` and the big slab on the right of `s42-valley1-f4`.
  - Of the pale pixels, 63 % / 74 % lie in a valley's outer reach. Their median slope is 49° / 52°; 57 % / 72 % are
    the CPU's rock class.
  - The reach is that of the I ≈ 500 m valleys of the small rivers.
  - Only 1-4 % of pale pixels sit on a step over 50 m. The slabs are 50-70° faces about 125 m wide, not sheer steps:
    the stepScan count and the slabs are related, but not the same thing.
- **Not rock cover on smooth steep slopes.** The pass's own slopes under the same view have slope p50 28°, p90 40°.
- **Cross-section** (`section` probe, seed 777777 at 11328,-33982):
  - The river runs at 977 m. The ground the pass built rises from its floor at about 36°.
  - The carve cut that wall up to 135 m below it near t = 0.5.
  - Toward the edge it rose 126 m in 125 m (t 0.73-1), and 35 m in 25 m at the steepest.

**Why the stage-4 raise made it worse.** The step at the reach's edge grows with the wall's height over the floor:
`excess * t²` with excess about the wall's height there. Stage 2's walls were gentle (18°). The pass raised them into
36° V's, and `riverLift` raised them further. Setting riverLift to 0 helped only because it lowered the walls.

## 2. The fix

All of this is in the carve at sample time, and in the same carve the streams are routed over. Nothing changes in
`hillslopes.ts`, so the model cache (`ss3` key) stays valid and needs no version bump.

**The walls are only lowered** (`riverNetwork.ts wallLift`; `heightfield.ts carveNetwork`):

- **Where it applies.** Only where the threshold hillslopes stand: `ErosionSample.mw`, the pass's own weight. It is
  smooth across a river's core, unlike `mg`, which is 0 on the core and gave 500 m jumps at its edge in a first try.
- **What it does.**
  - The carve's own target is raised so the ground is only lowered by its **gap**, the height where the wall starts over
    the floor.
  - The lowering tapers as (1 - t)² to the reach's edge.
  - The V stays a V, and meets the carve's floor where it starts.
- **Where it starts.** Past the floodplain and past the channel's swing (`ValleyNear.swing` = meander belt + half-width,
  + 70 m). Until there, the carve's own floor stays, because channels swing past the floodplain's edge in about 1 % of
  river samples.
- **The gap is measured per side.** At build time, the natural ground is read at the wall's start on each side of every
  other axis sample. Read on the axis instead, a gorge's wall started hundreds of metres above its floor's edge, a
  950 m step on seed 777777.
- **On the way in.** Over the first 0.1 of the reach after the start, the carve's own target gives way to this one.
  From there on, the cut is at most 0.25 × the distance to the reach's edge, or the gap's taper if that is more.
  Where the carve must cut deeper (a gorge), the walls steepen evenly instead of in a step at the edge.

**Breaches** (`heightfield.ts breachLift`): a stream's or gorge's breach is handled the same way.

- The walls are only lowered by the breach's own cut (`ChannelNear.cut`), tapering out by 0.8 of its reach.
- Breach walls of at most 45° never meet a 36° slope within the reach, which is why breaches left steps.
- Breach steps go from 58 / 47 / 51 to 1-3 a seed.

**Segment switches** (`SegmentIndex.perLineBlend`; `NetworkQuery.valleys`):

- **What was wrong.** At a bend's inside a line's nearest point jumps from one stretch to another. The level, floodplain,
  reach, gap and swing were taken from the nearest stretch alone, so they jumped too.
- **The blend.**
  - Every stretch the point lies square to, within 40 m + 0.1 d of the nearest (at most 300 m), is blended, weighted
    by a smoothstep of its extra distance.
  - The segments are listed 300 m further out, in a second index, so the blend does not jump at a cell's edge.
  - An end of a stretch counts only as the nearest point. Blending ends smoothed the valley along the line, which is
    not what this is for.
- **Its effect on the drawn ground is small.** After the wall fix it moves the ground by at most 2.9 m, on about 185
  of 9 M samples in the seed-42 box.
- **What still reads the nearest stretch alone.** The levels (D-stage, `carvedUnder`) and the streams' routing, as
  before. The blend moves the ground by too little to matter there, and blending the routing would only re-roll the
  streams.

**A river's core taper** (`erosion.ts COURSE_SLOPES`, `COURSE_GULLIES` from 0 instead of 0.5 / 0.85):

- **The problem.** The old deep carve had been hiding a wall at a river core's edge.
  - Where a river's floor is narrower than a 250 m node, the pass's ground stands 100-280 m over the model's beside it.
  - It blended in over the taper's last half, about 100 m: walls 60-90 m high in 25 m.
  - That was 128 / 80 / 268 steps once the carve stopped cutting them away (`try/stepWhy-M2-0.25.log`, classified by
    the pass weight `m` changing across the step).
- **The fix.** Blending over the whole taper brings them to 15 / 12 / 30.
- **The gullies.** They now give way over the same band. Before, the pass's ground stood over the model's full gully
  relief across most of the taper.
- **What is not touched.** Levels are read where kr ≈ 1, where both weights stay 0 as before.

**`riverLift` stays at 1.** The b gate holds with it, and the steps are well inside their gate.

## 3. Gates (stage 4 → now)

Logs: `after/` (the battery `gates.sh`, which is stage 4's plus stepScan and bankHeight), validate.py on the three boxes
(`data/validate/s*-f4s`), `after/gate.txt`. Stage 4's are `~/github/fs-exp/foundation4/out/f4/after2`.

**Steps** (stepScan, whole domain, profiles every 2 km at 25 m):

| | stage 2 | stage 4 | now | gate |
|---|---|---|---|---|
| over 50 m, seeds 1 / 42 / 777777 | 37 / 44 / 70 | 174 / 148 / 233 | **12 / 17 / 64** | ≤ 48 / 57 / 91: pass |
| over 100 m | 1 / 3 / 2 | 1 / 1 / 3 | **0 / 1 / 2** | not worse: pass |
| over 25 m | 4101 / 4521 / 3949 | 15270 / 14652 / 15469 | 11850 / 12407 / 12479 | (the slopes themselves) |
| worst | 115-124 m | 181 / 149 / 172 m | 98 / 141 / 137 m | |

The worst steps that remain:

- **Seed 42, 141 m at -40000,38425.** A river channel whose level drops 150 m between two samples, a fall. It was
  149 m in stage 4.
- **Seed 777777, 137 m at 30000,225.** A river channel swung onto ground 280 m over its water, where the channel's own
  carve ends at its margin. That is item 4's class.
- **Seed 777777, the 1000 m deep gorge.** Line 6, near 0..6000,14000..19000. Its natural ground stands up to 1280 m over
  its water (a stage-2 sea-level river through the range) within a reach of 1.2 km. It accounts for about 20 of seed
  777777's 64; its walls are steep by construction.

**Seed 42 validation box** (validate.py, 60 km at 20 m):

| | stage 4 | now | target |
|---|---|---|---|
| slope p50 | 31.3° | **31.4°** | ≥ 25°: pass |
| slope peak | 35-37.5° | **35-37.5°** | 30-40°: pass |
| slope p90 | 42.9° | 42.8° | |
| relief over 1 km | 606 m | **604 m** | 400-650 m: pass |
| valley b, 1-100 km² (1-10 / 10-100) | 1.18 | **1.20** (1.18 / 1.27) | ≤ 1.3: pass |
| pits > 10 m per 100 km² | 0.89 | **1.56** | ≤ 2: pass |
| relief over 5 km; elevation p50/p99 | 1385; 1169/2234 | 1385; 1169/2234 | |

**The other two boxes** (reported, not gated): p50, peak, 1 km relief, b, pits.

| box | stage 4 | now |
|---|---|---|
| seed 1 | 28.4 / 35-37.5 / 584 / 1.24 / 3.94 | 28.8 / 35-37.5 / 583 / **1.33** / 3.08 |
| seed 777777 | 30.7 / 35-37.5 / 601 / 1.19 / 1.22 | 31.0 / 35-37.5 / 601 / 1.19 / 1.69 |

**Valley b is sensitive to small changes in the DEM.**

- On seed 42, with the stretch blend switched off, the box measures b 1.22.
- With it on and the gullies at stage 4's band, it measured 1.30. The two DEMs differ by at most 3 m on 185 samples.
- validate.py's valley sections move with small changes in the routed channels. Read b to about ±0.05.
- Seed 1's rise to 1.33-1.39 came with the wall change itself, in every variant tried.

**Unchanged:**

- **lakes:** lakeStats / lakeKinds / lakeKeep logs identical (70 / 74 / 59).
- **homeCheck:** identical on the 8 seeds.
- **riverZero:** 0 / 2.9 / 2.0 km.
- **edge steps:** largest 76.0 / 78.4 / 68.1 m at the same points (counts over 25 m 4815 / 2525 / 3105, against 4816 /
  2524 / 3106).
- **river levels:**
  - 346 / 356 / 354 rivers have their channel laid exactly as in stage 4. Their level changed by **0.0 m** at every
    sample.
  - The other 85 / 69 / 80 differ because the streams changed (`tools/rivermove.py`). A river's head is trimmed to where
    its first feeder joins, and its meanders are phased from its head, so a moved head swings the whole channel
    differently over the same floor.
  - Measured from the mouth, half of those are identical but for the head. On the parts matched sample for sample, the
    level differs by at most 0.8 m.
  - At the nearest sample, the levels differ by p90 0.5-0.7 and p99 2.5-2.7 m. That is the same class as stage 4's own
    difference from stage 2 (p99 1.6-2.3 m).
  - Seed 777777's maximum is 122 m: a sample beside a fall.
- **D-stage:** the levels are still read against the old carve. The new carve stands at or over it in the mountains, so
  no water is left over ground by it.
  - Trench check (probe `bankHeight`): the lower bank's height over the water, every 4th sample of every river.
  - Stage 4: p50 1.3-1.4, p99 3.2-3.5, max 13 m, none over 30 m.
  - Now: p50 1.4, p99 3.4-3.7, max 13 m, none over 30 m.
- **NaN:** 0.

**Report items** (not gates), stage 4 → now, seeds 1 / 42 / 777777:

- **Water over ground > 10 m** (overGround): 40 / 6 / 34 → 55 / 10 / 23. Nearly all are on loops more than 200 m off
  the axis. See item 4.
- **River over a dry bank > 10 m** (waterWalls):
  - Count: 1885 / 1876 / 1609 → 1888 / 1810 / 1548.
  - Worst: 147 / 74 / 68 → 147 / **151** / 71 m.
  - Seed 42's 151 m is stream 812 at -26500,-45000. It leaves the upper wall of river 0's valley at 563 m and drops
    150 m in one sample to 412 m, then runs on cut 140 m into the wall. In stage 4 it ran there on the old carve's
    trough, about 120 m lower.
- **Streams:**
  - count 685 / 711 / 734 → 705 / 704 / 734;
  - length 1891 / 1755 / 2092 → 2020 / 1775 / 2147 km;
  - ending in a hollow 41 / 45 / 41 → 32 / 42 / 36;
  - dry river heads with no feeder 23 / 17 / 15 → 14 / 15 / 12;
  - stream samples past their first km on a pass channel's floor 79 / 89 / 86 → 81 / 91 / 88 %.
- **Cover** (coverShare, rock): 13.3 / 10.8 / 12.1 → 13.1 / 10.3 / 11.9 %.
- **Cost:**
  - `naturalHeight` unchanged (2.28-2.30 µs).
  - `sampleTerrain` in the four mountain windows: 2.90 / 2.56 / 2.75 / 3.07 → 2.99 / 2.63 / 2.77 / 3.14 µs, +1-3 %
    (the blend and the wall weight).
  - World build in node: 2.82-3.02 → 3.02-3.16 s (the per-side gaps and the routing).

## 4. Water over ground > 10 m

**Stage 4's rise** (15 / 11 → 40 / 34 from stage 2, now 55 / 10 / 23): its cause is not the step's, though it lives in
the same place. `try/overGround-f4.log` and `try/overGround-now.log` list them:

- **Where they are.** Nearly every point is a meander loop more than 200 m off the axis. There the channel has swung
  past the floodplain, onto the river core's taper.
- **Why the water stands over the ground.** About three quarters are "gullies only": the model's ground there (coarse)
  holds the water, and the gully relief kept on a river's core (`mg` = 0) puts a trough 15-22 m deep under it. The rest
  have the coarse ground itself under the water.
- **How many channel samples swing out** (probe `gapDump`, rivers in the mountains): past the floodplain 210 / 147 / 254
  of about 20 000 samples, by more than 100 m 68 / 40 / 73. The floodplain's width is smoothed along the river
  (`smoothAlong`), so the belt can run past it.
- **What the fix did to it.** Fading the gullies over the whole core taper (`COURSE_GULLIES`) took the count down
  (60 / 13 / 28 with the slopes' band alone → 55 / 10 / 23).
- **The rest is not a cheap local fix.**
  - Taking the gullies off the whole core, or widening the floodplain to the belt, would move the levels read there.
  - Raising river banks over a 20 m trough would build walls.
  - It belongs with the meander belt / floodplain mismatch, which is stage 2's.

## 5. Pictures

The four valley views and `s42-massif` are re-shot from this tree as `shots/<view>-f4s.png`, beside stage 4's
`<view>-f4.png` copies. They were rendered on port 5201, and the server is stopped. URLs: `out/f4/views4.txt`.

- **s777777-valley1:** the three long benches (left, centre and right of centre) are gone. Small irregular rock patches
  remain on the steepest faces.
- **s42-valley1:** the big slab on the right is gone, leaving a smaller rock face near the crest. The tributary valley
  on the right now shows its fields on its floor; stage 4's trough edge was a forested bench there.
- **s777777-valley2:** the pale cliff band along the river's left bank is gone.
- **s42-valley2, s42-massif:** look as before; nothing there was on a reach's edge.
- **Ray-cast shares** (`raystats.py`), stage 4 → now:

  | view | ground over 50° | over 43° in a valley's outer reach | rock class |
  |---|---|---|---|
  | s42-valley1 | 5.4 → 1.6 % | 5.6 → 2.6 % | 9.8 → 6.6 % |
  | s777777-valley1 | 6.7 → 1.2 % | 7.4 → 3.2 % | 11.6 → 7.0 % |

## 6. Suite

`npx vitest run --no-file-parallelism tests/terrain tests/world tests/era tests/career` (`suite.log`):

- **744 / 745 pass.** The one failure is career's "200 boards at seed 7", a 5 s timeout under load. Re-run alone
  with `--testTimeout=120000` (`suite-career.log`), career passes 28 files and 528 tests.
- **No re-bake.** Seed 7's golden boards still match, so `tests/` is unchanged from stage 4. Seed 0's entry is
  untouched with it.
- **presentGuard** passes, not re-pinned.
- **Seed 0** runs none of the changed code: carveNetwork, the network hydrology and the slopes are all for seeded
  worlds only, and the wall weight is 0 at seed 0.

## Files

- **Code:**
  - `src/world/terrain/riverNetwork.ts`: `wallLift`, `wallStart`, the per-side gaps (`Axis.gapR`, `gapL`),
    `SegmentIndex.perLineBlend`, the blend index `valleyBlend`, `blendValley`, the streams' routing carve.
  - `heightfield.ts`: the wall weight (`lastWall` from `ErosionSample.mw`), `carveNetwork`, `breachLift`.
  - `erosion.ts`: `ErosionSample.mw`; `COURSE_SLOPES` and `COURSE_GULLIES` from 0.
  - `hydrology.ts`: `ValleyNear.gap`, `swing`, `line`, `s`; `ChannelNear.cut`.
- **Probes** (`scripts/probes/`):
  - `stepWhy`: steps by cause;
  - `viewRay`: a view's rays onto the terrain;
  - `section`: a cross-section with the pass's weights;
  - `gapDump`: the rivers' gaps and swing past the floodplain;
  - `bankHeight`: trenches.
- **Scripts** (`out/f4s/`):
  - `gates.sh`, `try.sh`, `shots.sh`, `cat.py`, `raystats.py`, `tools_overlay.py`;
  - `tools/`: stage 4's, plus `rivermove.py`.
- **Logs:**
  - `after/` (gates) and `after/gate.txt`;
  - `base/` (stage 4 and stage 2 step diagnoses);
  - `try/` (the variants tried);
  - `ray/` (view rays and overlays);
  - `data/validate/`;
  - `suite.log`.
- **Source copies:**
  - `base-src/` (stage 2, with the probe patch);
  - `base4-src/` (stage 4).
