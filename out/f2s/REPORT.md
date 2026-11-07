# Sea-level rivers: cause and fix (foundation stage 2 follow-up)

Branch `exp/foundation2-sealevel` (from stage 2's `9105bde`), worktree `~/github/fs-exp/foundation2-sealevel`. Nothing
merged or pushed.

| commit | what |
|---|---|
| `9a318f9` | **a river runs on its own floor**: the relief finer than the lattice gives way across each drawn river's floodplain and swing (erosion.ts `markCourse`, riverNetwork.ts lays the axes out first), so the level follows the graded valley |
| `6d1a819` | **a fault's fall and its gorge stay within the river's own fall** (falls.ts `faultFit`): the gorge below a fault always meets the river's level again |
| `fedd409` | probes `rzPhase`, `rzLine`, `rzDecomp`, `rzShape`, `rzAt`, `rzMouth`, `rzTime` |

## Short version

- **Two causes, both traced with probes.** Neither is one of the four candidates exactly.
  1. **The noise's sub-kilometre relief left on a lowered plain** (most lines, every seed). The model grades a plateau of
     ~200 m down to a valley floor at 10-25 m, and the drawn river runs 300-1000 m off the lattice course. The noise
     relief finer than the lattice (+-35-50 m) gave way only within 450 m of the lattice course and in deep model valleys,
     so most of it was still there. Where a trough of it lay under the river, the ground came down to the cushion just
     above the sea (2-3 m), 20-50 km inland. The level is the running minimum of the ground along the river, so it took
     that trough's level and kept it for the rest of the river. Every rise of the same relief downstream (35-63 m) was
     then cut down to sea level.
  2. **A fault's gorge that never met the river again** (seed 42's main river, the "4.5 m/km from 60 km out" in the stage
     2 report). Below a fault's fall the gorge falls at least 0.4 %. On a gentle reach that is steeper than the river,
     and a second fall within the first one's gorge was sized on the level before the first cut. Either way the gorge
     ran on down to the line's floor, the sea's level.
- **riverZero** (level < 1 m over ground > 30 m), seeds 1 / 42 / 777777: **29.5 / 96.4 / 42.5 km -> 0 / 2.9 / 2.0 km**
  (10 / 22 / 11 lines -> 0 / 2 / 1). That is below where things stood before stage 1 (3 / 10 / 7 km). What is left lies
  2.2-8.1 km from the mouths, along valleys the model itself grades to 2-4 m near the coast.
- **Lake-shore walls > 10 m: 1 / 4 / 0 -> 0 / 0 / 0** (seed 42's 65 m and 56 m walls are gone). River banks > 10 m 1371 /
  1568 / 1108 -> 1312 / 1485 / 1129. The worst bank walls were 147 / 78 / 147 m and are now 147 / 81 / 74 m. Seed 1's
  147 m and seed 42's 81 m walls are on mountain streams, not this defect; seed 777777's 147 m wall is gone.
- Lakes, kept hollows and the lattice tree measures are unchanged. Water over ground > 10 m moved 13 / 29 / 6 -> 15 / 33 /
  11, all on meander loops > 200 m off the axis, as before. World build time is unchanged within noise.
- Pictures: the pale floor carved to sea level through the plain at s777777-gorge is gone. The river now runs in its own
  shallow valley through the farmland.

## How it was traced

**Per stage** (`rzPhase`, through riverNetwork.ts `levelProbe`). For every line riverZero flags, the probe shows where
the axis level first falls under 1 m after each stage: A the running minimum, B the confluence cut, C0 the parent's level
or the sea's at the mouth, C capFall, D the other valleys' carve, E destair. On all three seeds the level is already
under 1 m at **stage A** on nearly every line, at a sample whose ground is 1-3 m (`out/f2s/before/rzPhase.log`).
- **8c757bb (candidate 4) is not involved.** The level is 0 tens of kilometres before the mouth clamp.
- **The confluence cut and capFall (candidates 1 and 2) only pass it on.** On seed 42 lines 1 and 10, tributaries that
  had hit a trough near their mouths cut their receivers down (stage B), and capFall carried that drop upstream.

**The ground under the axis** (`rzLine`, `rzDecomp`). Seed 1's main river (line 0, 13 279 km²) at s 147.4 km of 176,
point -83818,-104396:
- noise ground 166 m;
- the model's change -162.5 m;
- noise B-spline 200.6 m, so a residual of -34 m;
- residual give-way w only 0.08 (valley-floor weight f 0.08, model valley depth under 20 m);
- lattice cell of the line 21.5 m, 436 m away.

Without the cushion the ground there would be about -14 m; the cushion holds it at 3.0 m. The level becomes 0.5 m and
stays there for the 29 km to the sea. Downstream, at 153.4-157.8 km, f and w are 0 and the same residual stands up as
35-63 m knolls over a lattice valley at 12-14 m. Those knolls are the canyon walls. Seed 42 line 3 and seed 777777 line 0
show the same pattern.

This is close to candidate 3 but not the B-spline itself. The relief the model removed was only removed along the lattice
course. On a plain lowered wholesale, the "model valley" fade does not fire either: the neighbouring cells were lowered
too, so valley depth is about 0. The drawn river leaves the 450 m floor strip, through the axis wander (900 m + 350 m +
jitter) and the meander belt. Before stage 1 the same relief sat on a 200 m noise ground, so its troughs never reached the
sea. That is why stage 1 made the defect 3-10x worse.

**The fault gorge** (`rzShape`, `rzAt`). With the floor fixed, seed 42 still had 65 km. The channel level of line 1 at
60884,-36230 was 72.5 m after the channel pass and 0.6 m after falls.ts `shapeLines`. Two fault falls 540 m apart (at
49936,-33002, 13 m and 10 m) were both sized on the level before either cut. The second one's gorge started under the
river's own level and fell at 0.4-0.6 %, so it never met the level again and ran to the sea. Fixing only the 0.4 % minimum
did not help; refitting each fall to the level the earlier falls left did.

## The fixes

**1. The river's own floor** (`erosion.ts` `ErosionField.course` / `markCourse`, `riverNetwork.ts` `floorHalf`, wired in
`heightfield.ts`).
- riverNetwork.ts now lays out every valley axis first. The courses depend only on the lattice and noise, not on the
  ground. It then hands the axes to the model to mark, and only after that reads the ground for the levels.
- The mark is a 250 m fine-grid mask, like the channel floor. It covers the widest meander belt the catchment could take
  where the lattice is gentle enough to meander, or the floodplain, plus the 80 m side samples and one fine cell; it
  tapers off over 500 m.
- In the mask the residual gives way: `w = 1 - (1-f)(1-g)(1-k)`, with the gradient carried through. The gullies stay.
- Grid points within a fine cell of a lake's domain and ring (`LakeMask.smooth`) are not marked. Lake basins and shores
  were flooded on the unmarked ground. Kept lakes and shore walls came through unchanged.
- The terrain and the levels read the same `naturalHeight`, so they agree; nothing in carveNetwork changed. All axes are
  marked in one pass: about 35-65 ms per world.

**2. Fault falls** (`falls.ts` `faultFit`).
- A fault's gorge gradient is still the larger of 40 % of the channel's own fall over 1500 m and 0.4 %.
- The drop is now `min(throw, fall over 1500 m - gorge x 1500 m)`. Fall plus gorge never exceed the river's own fall, so
  the gorge meets the level within 1500 m. Where the share gradient binds, this equals the old 60 %, so it is unchanged.
- Each fall is refitted when it is cut, on the level that the falls above it left.

Seed 0 does not use either piece (no model, no network): byte-identical. `tests/era/presentGuard.test.ts` passes unchanged.

## Numbers (before = `9105bde` copy in `out/f2s/base`, after = this branch; logs `out/f2s/before`, `out/f2s/after`)

| | before | after |
|---|---|---|
| **riverZero km** (lines), seeds 1 / 42 / 777777 | 29.5 / 96.4 / 42.5 (10 / 22 / 11) | **0 / 2.9 / 2.0** (0 / 2 / 1) |
| riverZero km, floor fix only (`9a318f9`) | | 0 / 65.0 / 2.0 |
| riverZero km, fault fix only | | 29.5 / 39.9 / 42.5 |
| (before stage 1, `cea3349`, from stage 2's report) | 3 / 10 / 7 | |
| water over ground > 10 m (overGround) | 13 / 29 / 6 | 15 / 33 / 11 (13 / 31 / 11 on meander loops > 200 m off the axis) |
| water over ground > 2 m | 517 / 434 / 475 | 506 / 393 / 507 |
| river over a dry bank > 10 m (waterWalls) | 1371 / 1568 / 1108 | 1312 / 1485 / 1129 |
| worst river-bank wall | 147 / 78 / 147 m | 147 / 81 / 74 m |
| lake-shore walls > 10 m; worst | 1 / 4 / 0; 10.8 / 65.5 / 8.9 m | **0 / 0 / 0**; 1.9 / 3.1 / 2.3 m |
| lakes (lakeStats, lakeKinds, lakeKeep) | 70 / 74 / 59 | 70 / 74 / 59 (logs identical) |
| tree measures (treeMeasure) | | lattice measures identical; drawn-river classes: one confluence hill -> plain |
| streams; unfed; dry heads with no feeder (headFeed) | 700 / 720 / 743; 32 / 18 / 20; 17 / 14 / 14 | 706 / 722 / 750; 36 / 20 / 19; 23 / 16 / 13 |
| rivers >= 500 km², 2 km gradient p50/p90 at 0-200 m | 0.11/0.79, 0.12/0.85, 0.06/0.65 % | 0.15/0.71, 0.14/0.65, 0.09/0.52 % |
| plains 0-200 m: placid / riffle; 200 m gradient p50 | 65/24, 63/25, 64/23 %; 0.13 / 0.20 / 0.14 % | 61/29, 59/31, 60/30 %; 0.29 / 0.34 / 0.32 % |
| edgeScan: NaN; largest step | 0; 76.0 / 78.4 / 68.1 m | 0; 76.0 / 78.4 / 68.1 m |
| homeCheck (8 seeds) | ok | ok (circuit 67 -> 65 m seed 7, 102 -> 100 m seed 777777) |
| world build, min of 2 rounds, model handed over (rzTime) | 2093-2231 / 1887-2040 / 2000-2048 ms | 2147-2155 / 1930-1939 / 1985-2000 ms |

Notes:
- **Which bank walls the fix touched.** The 147 m wall on seed 1 (18950,-74450) is a 59 km² river at 561 m. The 81 m wall
  on seed 42 (-7550,25750) is a 5 km² stream at 622 m. Neither is a sea-level river. Seed 777777's 147 m wall was one,
  and it is gone.
- **What is left of riverZero** (`rzMouth`): seed 42 line 1 at 2.2-2.7 km from its mouth, line 3 at 2.6-5.6 km, seed
  777777 line 0 at 2.7-8.1 km along the meandering channel. There the model's own lattice valley is 2.4-4 m over its last
  7 km. The channel's loops touch valley sides over 30 m on a river at estuary level, which is not this defect.
- **Lowland rivers no longer lie dead flat at 0 m for tens of kilometres.** So the share of placid water on the plains
  fell by 4 points, the 200 m gradient median rose from 0.13-0.20 % to 0.29-0.34 %, and the 2 km gradient barely moved.
- **Seed 1 has 6 more dry river heads with no feeder** (17 -> 23). The marks smooth the ground near some heads that
  streams route over. Stage 1 to stage 2 moved this measure by about as much (11/16/9 -> 17/14/14); worth watching, not
  chased.
- **Build time.** A first version marked one line at a time and swept the whole fine grid per line: +1.3 s. Marking all
  axes in one pass brought it back to noise.

## Pictures (`out/f2s/shots`, port 5199, stopped; `out/f2s/shots.sh`)

`<view>-before.png` is stage 2's own shot (`~/github/fs-exp/foundation2/out/f2/shots/<view>-f2.png`); `<view>-f2s.png` is this branch.

- **s777777-gorge**: before, a pale floor about 1.5 km wide carved to sea level through the plain. After, the same 2847
  km² river runs in a narrow valley through farmland and forest; the mountains behind are unchanged. Its level at
  -10000,-112000 in the foreground was -0.3 m and is now 30.9 m. At the look point (-7000,-109000), where the canyon
  begins, it is 30.7 -> 30.9 m.
  `index.html?seed=777777&camPos=-14950,-116950,1500&camLook=-7000,-109000,60&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`
- **s1-gorge**: the 3428 km² river leaving the mountains. This one was never held at sea level: its level here is
  292-327 m before and after (`linesNear` at three points). Its course changes as a side effect. The ground across its
  floor lost the noise's sub-kilometre relief, and the meander belt is confined against that ground. Before, a wide
  winding loop sat on an open floor at the valley mouth; after, a narrower course winds through forest down the same
  valley. Farmland and the range are unchanged. Any river can look like this now: its meanders are laid on its own
  smoothed floor rather than between noise knolls.
  `index.html?seed=1&camPos=61930,-145990,1900&camLook=54000,-144000,301&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`

## Tests

`npx vitest run --no-file-parallelism tests/terrain tests/world tests/era tests/career`: 58 files, 744 of 745 tests pass
(686 s, `out/f2s/suite.log`). The one failure was the golden boards for seed 7: pay on some offers moved (e.g. 1020 -> 960),
because the terrain around seed 7's fields shifted. Re-baked with `FS_CAREER_BAKE=1`; `tests/career/jobs.test.ts` then
passes 31 of 31. The re-bake changes only seed 7's entry: seed 0's JSON is deep-equal to `9105bde`'s. The career 200-boards
test passed in the full run with no timeout. `tests/era/presentGuard.test.ts` passes, not re-pinned.

Not changed, worth knowing: markCourse sets its chord length from each axis's first sample spacing (60-120 m). Its
chords can reach about 1 km, but a smooth axis strays at most about 65 m from them, inside the 250 m margin.

## Files

- Code: `src/world/terrain/erosion.ts` (`course`, `courseAny`, `markCourse`, `sampleErosion[Grad]`), `riverNetwork.ts`
  (axes laid out before the levels, `floorHalf`, `levelProbe`), `heightfield.ts` (the marking, not by a lake),
  `falls.ts` (`faultFit`).
- Probes: `scripts/probes/rz{Phase,Line,Decomp,Shape,At,Mouth,Time}.test.ts`.
- Logs (untracked): `out/f2s/before/`, `out/f2s/after/` (gates, riverZero, rzPhase, rzMouth;
  `riverZero-floorOnly.log`, `riverZero-faultOnly.log`), `out/f2s/suite.log`. Source copies: `out/f2s/base` (`9105bde`),
  `out/f2s/fixA` (`9a318f9`).
