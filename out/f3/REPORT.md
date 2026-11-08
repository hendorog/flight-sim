# Foundation stage 3: structure (front block, faults as uplift steps, erodibility bands)

Branch `exp/foundation3` (from stage 4 steps `c6eafff`), worktree `~/github/fs-exp/foundation3`. Nothing merged or
pushed. "f4s" below is `c6eafff`, the stage this builds on.

| commit | what |
|---|---|
| `fd214f1` | `structure.ts` (new): erodibility bands, the faults as uplift steps, the late front block; `erosion.ts` steadyLattice runs them and its router can hold receivers; wired in `buildWater` on wide-orogen seeds; `MODEL_VERSION` ss4; probes `structSweep`, `faultKnick` |
| `b97c269` | the block's gorges stand back from the channel; no meanders in a deep valley; the meander belt stays inside the smoothed floodplain |
| `d2316bf` | final settings: bands K-only and patchy; structure fades out toward the lattice edge; probes `f3Views`, `blockAt` |
| (last) | seed 7's golden boards re-baked; this report, scripts, probes |

## Short version (what the owner will see)

- **Big rivers now leave the mountains through one gap.** The largest range exit carries most of a big river's water
  at its mouth: p50 **0.73 / 0.63 / 0.43** on seeds 1 / 42 / 777777. f4s had 0.24 / 0.38 / 0.23; Canterbury is 0.52.
  Seed 1's 2203 km² river and seed 777777's 2931 km² river each leave the ranges through one valley in the front, their
  branches already joined behind it.
- **A line of foothill ranges along the mountains' outer edge (the "front block").**
  - **Where.** Wherever the mountains face lowland at least 15 km inland, a belt 3-12 km out from them now stands as
    forested ridges 300-700 m high, with the stage-4 V valleys.
  - **The rivers.** The big rivers (400 km² or more) cut through it where they already ran. Smaller streams that used
    to cross it now run along its back to the nearest big river.
  - **How much.** 3900-5900 km² of hill country per seed became foothill range. It is kept clear of the home field and
    of the lowland lakes.
- **The gorges are wide gaps, not slots.** From 450 m, a river crosses the front block in a valley 2-4 km wide between
  forested ridges 300-700 m high, with farms on the floor (`s1-gorge6`, `s777777-gorge0`, `s42-gorge14`). The Rakaia's
  gorge is a single channel about 90 m wide, cut about 200 m into the block. A 1 km model cannot make that (decision 2).
- **Strike valleys.**
  - **Behind the block.** A stream runs 10-17 km along the back of the block, under its forested face
    (`s777777-strike40`).
  - **Inside the main ranges.** Weak bands of soft and hard rock make some valleys and ridges follow the range
    (`s42-massif`: one long ridge with a farmed valley in front). Strong bands gave concentric "onion-ring" ridges, so
    they are kept weak and patchy (decision 1).
- **Unchanged within noise:**
  - lakes;
  - the home field;
  - the lattice edge;
  - the seed-42 box's slopes and relief;
  - the mountains' height (box p99 2234 → 2263 m).
- **Worse:**
  - Seed 1: steps over 50 m 12 → 38. They are smaller: the worst is now 66 m (it was 98 m).
  - Seed 42: water standing over meander loops 10 → 69 points.
  - Stream length: down 10-12 % on seeds 1 and 777777.

## Owner decisions first

1. **Bands along strike: weak and patchy, not ×1/4..×4.**
   - **What ×4 looked like.** At the brief's strength (K ×1/4 to ×4, bands everywhere) the ranges became concentric
     parallel ridges following the front (`pics/s42-lattice-bands-x4.png`).
   - **What else ×4 broke.**
     - The soft belts drop under 500 m of relief, so the relief classes split the mass into strips. Mountain distance
       to the front p90 fell to about 10 km (gate ≥ 15).
     - Peaks rose 250-400 m.
   - **Shipped:** K ×0.71 to ×2.8 over about 40 % of the ranges (`STRUCT.kAmp 1`, `kSoft 0.25`, `kPatch 0.4`), wobbling
     along strike, with no start-surface offset.
   - **What they buy:** seed 777777's exit / mouth (0.30 without them, 0.43 with).
   - **What they cost:**
     - Seed 1 gets about 20 more steep steps (the class where the slopes pass meets a gentler model valley).
     - With the start offset (`kStart`), the seed-42 box's pits went over 2 (2.2-2.5).
   - **Your call:** keep them this weak; turn them off (`kAmp 0`: seed 777777 then misses the gate at 0.30); or ask for
     the strong look.
2. **The range-front gorges are 2-4 km gaps.**
   - **Why.** The front block is a 1 km-lattice feature. Within one cell of a held river the block rises less
     (`blockGorge 1`), and the B-spline spreads that into a broad gap.
   - **A one-cell gorge** (`blockGorge 0`) gave narrower gaps, but walls at the channel's margin: steps up to 186 m.
   - **A two-cell gorge** lost the gate (seed 777777 exit / mouth 0.30).
   - **What a real gorge needs:** a narrow incised gorge like the Rakaia's needs a carve at the 250 m or 20 m scale where
     a held river crosses the block (follow-up).
   - **Your call:** accept the gaps for now?
3. **The block is continuous along the whole front, not segments.**
   - **Continuous (as built):** 3900-5900 km² of hill country becomes foothill range. Some lowland trunk rivers that ran
     along the range front now run 15-38 km in a valley between the main range and the block (faultKnick lists them).
   - **Segments centred on the big rivers' exits** (`blockSpan` 25 km): about a quarter of the area. On the proxy they
     gave exit / mouth 0.42 / 0.47 / 0.41, too close to the gate to keep.
   - **Your call:** continuous, or segments with the gate as a target to tune.
4. **Falls at knickpoints: a proposal, not built.**
   - **What exists now.** The faults are now uplift steps: the up side rises 1.1-1.3× faster, fading out over 12 km.
     The drawn fault falls sit on the traces, which is where those steps are. So they already sit at the model's block
     edges.
   - **The slope break is weak.** At 1 km, through the B-spline, it does not show in the model's river gradients: the
     steeper reach lies on the up side at 28 of 55 falls, a coin flip (`final-faultKnick.log`).
   - **Proposed rule.** A fall only where a river leaves the up side of a fault (the scarp). Where it enters the up side
     it is an antecedent rapid, not a fall. This roughly halves the fault falls.
   - **Not built this round.** Re-placing falls re-rolls riverZero and the steps, and I could not re-gate them in time.
5. **The step gate on seed 1 cannot be held exactly.**
   - **The noise floor.** With no structure at all, moving the start routing by 5 m gives:
     - steps over 50 m: 14 / 10 / 60;
     - pits on the seed-42 box: 2.11;
     - riverZero: 2.7 / 3.2 / 2.9 km.
     So these "not worse" gates sit inside the noise of any terrain change.
   - **Seed 1's 38 steps** are more than noise: they come from the bands (decision 1).
   - **The other seeds are better:** 13 and 43 steps over 50 m, against 17 and 64.
   - **Over 100 m:** only one step on seed 777777 (f4s had 1 on seed 42 and 2 on seed 777777).
   - **The worst steps** are smaller on every seed.
   - **Your call:** accept, or drop the bands and lose seed 777777's exit / mouth.

## What changed

**`structure.ts` (new).** Settings are in `STRUCT`, with `setStructParams` for probes (the `STRUCT_PARAMS` env in every
probe, via `scripts/probes/slopeSetup.ts`).

- **Erodibility bands.**
  - **Shape.** K × 2^(kAmp (band − mean)). The band is a soft square wave of the distance in from the orogen's front
    (smoothed).
  - **Variation.** A slow noise wobbles their phase along strike (kWob 1.2 spacings). A second noise patches them in
    and out (kPatch 0.4).
  - **Spacing.** Bands are 9 km apart, and the soft belt takes a quarter of that.
  - **Height kept.** Their log-mean is 0, so the ranges keep their height.
  - **Where.** Only on the orogen's mountains (ur ≥ 0.3), faded out 10-16 km inside the lattice edge.
- **Faults as uplift steps.** Each fault of `faults.ts` raises the uplift rate on one side by up to 1.3× (faultU 0.3).
  The side is chosen by the fault's index and the seed. The step follows the fault's throw along the trace and fades
  out over 12 km from it and past its tips. Only on mountain ground, and not toward the lattice edge.
- **The late front block** (PLAN §3.6 item 3).
  - **Where.** Land off the orogen's mask, 3-12 km out from it (1.5 km fades), from 15 km inland. It is kept 8-14 km
    clear of the home field, 3 cells clear of the kept lakes and the runway's protected surfaces, and 10-16 km inside
    the lattice edge.
  - **In `steadyLattice`, after the usual 30 iterations:**
    1. The receivers of every cell draining ≥ 400 km² are held (`SteadyRouter.route` takes a `hold`). These are the
       antecedent rivers.
    2. The rest is routed once over the block raised by 3000 m. The smaller rivers behind it fill up to their lowest
       spill, which is a held river's gorge. That is how they are "turned aside".
    3. The steady-state heights are solved once on that routing, with the block's uplift rate raised to 0.6 of the
       peak.
    4. No free iterations follow (`blockIter` 0). Ten free iterations let the turned-aside rivers drift back across the
       block, and exit / mouth fell by about 0.1.
  - **The 3000 m is a routing wall only.** It never enters the ground: T is the steady state on that routing.
  - **The gorge.** Within one cell of a held river the block rises less (`blockGorge 1`).
- **Cache and key.** `MODEL_VERSION` ss3 → ss4, and `modelKey` hashes the structure's fields and settings.
- **Off means off.** With no structure, the model is bit-identical to f4s: the "none" variant reproduces every f4s gate
  number exactly.
- **Only on wide-orogen seeds** (`seededOrogen()` non-null). Narrow seeds and seed 0 build no structure.

**The threshold hillslopes in the block** (`heightfield.ts mountainSlopes`). The pass's mask takes the block's weight:
ur is raised to between onset and full by it, for the pass only. `ur` itself is unchanged, because the kept lakes and
the classes read it. The foothill ranges get the stage-4 V valleys, not smooth domes. Seed 42's pass covers 608k
fine-grid nodes, against 470k in f4s.

**Rivers in deep valleys** (`riverNetwork.ts`, general fixes for every seeded world).
- **No meanders in a deep valley.** A river does not meander where the macro ground's valley depth at its cell is
  100-180 m or more (`GORGE_CUT`). The floodplain keeps its width.
- **The belt stays inside the floodplain.** The meander belt is clamped to the smoothed floodplain, less the channel
  and its bank.
- **Why.** Big rivers in the new mountain valleys swung loops 200-300 m past their floor into the walls, leaving steps
  of 171-395 m. This is stage 4's "channel swings onto the core taper" class, made worse here.

## Gates (seeds 1 / 42 / 777777; f4s → f3)

Logs:
- f4s: `~/github/fs-exp/foundation4-steps/out/f4s/after`.
- f3: `out/f3/final` (`gates.sh`, the f4s battery).
- validate.py: `out/f3/data/validate/s*-fin`.

| gate | f4s | f3 | target | |
|---|---|---|---|---|
| **largest exit / mouth p50** (relief classes; n rivers) | 0.24 / 0.38 / 0.23 | **0.73 / 0.63 / 0.43** (18 / 28 / 17) | ≥ 0.4 | pass |
| **≥ 45 km² joins inside the ranges** | 56 / 45 / 52 % | **70 / 58 / 64 %** | ≥ 40 % | pass |
| **mountain distance to front p90** | 30.9 / 29.4 / 22.1 km | **23.1 / 28.6 / 19.8 km** | ≥ 15 km | pass |
| **range-front gorge** (a big river through a front block) | - | 10 / 1 / 7 rivers ≥ 500 km² cross it; pictures below | one per wide seed | pass, as gaps (decision 2) |
| **seed-42 box**: slope p50 / peak / 1 km relief / valley b / pits > 10 m per 100 km² | 31.4° / 35-37.5 / 604 m / 1.20 / 1.56 | **30.9° / 35-37.5 / 594 m / 1.24 / 1.92** | ≥ 25 / 30-40 / 400-650 / ≤ 1.3 / ≤ 2 | pass |
| **riverZero**, km (lines) | 0 / 2.9 / 2.0 | **0.2 / 2.2 / 0.0** (1 / 2 / 0) | not worse | seed 1 +0.2 km (below) |
| **steps > 50 m** | 12 / 17 / 64 | **38 / 13 / 43** | not worse | seed 1 worse (decision 5) |
| **steps > 100 m**; worst step | 0 / 1 / 2; 98 / 141 / 137 m | **0 / 0 / 1**; 66 / 82 / 110 m | not worse | pass |
| **lowland lakes** | 70 / 74 / 59 | **71 / 74 / 61** | ±15 % | pass |
| **homeCheck** (seeds 1, 2, 5, 7, 42, 1234, 99991, 777777) | ok | **ok**; circuit 69 → 61 m on seed 1234 and 100 → 92 m on seed 777777, the rest identical | ok | pass |
| **NaN; edge steps** | 0; 76.0 / 78.4 / 68.1 m | **0; 76.0 / 78.4 / 68.1 m** (same points) | not worse | pass |
| **seed 0; presentGuard** | | nothing new runs at seed 0; presentGuard passes, not re-pinned | | pass |
| **full suite** | 745 | SUITE_RESULT | all pass | SUITE_VERDICT |

**riverZero on seed 1.** One line, 0.2 km, 5.6-8.3 km from its mouth (rzMouth). This is the f2s residual class: an
estuary river beside 30-40 m coastal ground. No block or fault is near (blockAt: block weight 0, about 1 km inland).

**The gates' noise floor** (`abl/noise`: no structure, the start routing nudged by 5 m):
- steps > 50 m: 14 / 10 / 60;
- pits on the seed-42 box: 2.11;
- riverZero: 2.7 / 3.2 / 2.9 km.

Across the structure variants, seed 1's riverZero moved between 0 and 5 km, all on lines near mouths. Every variant
tried is in `abl.sh`, `abl-*.out` and `abl/`.

**Steps over 50 m by cause** (stepWhy, `abl/stepWhy-*.log`, classified by `out/f4s/cat.py`). These are the ablation
runs with a one-cell gorge and before the river fixes:

| variant | seed 1 | seed 42 | seed 777777 |
|---|---|---|---|
| structure off (= f4s) | 12: natural 9, channel 2 | 17: natural 10, channel 4 | 64: wall-big 29, natural 19 |
| block and faults, bands off | 20: natural 10, channel 7 | 28: natural 11, channel 11 | 57: natural 29, wall-big 21 |
| block, faults and strong bands | 38: natural 24, channel 10 | 33: natural 21 | 39: natural 24, wall-big 7 |

- **"Natural" steps** are on the threshold slopes' blend where a river's core tapers. The pass's V stands 150-180 m
  over the model's gentler valley, 100-300 m from the floor (`section` probe at seed 42, -68000,60375). The bands make
  more of them, because the model's valleys in the soft belts are gentler.
- **"Channel" steps** are a river's channel margin in a block gorge.
- **No new class appeared.**

**Report items** (not gates):

| | f4s | f3 |
|---|---|---|
| top-3 exits' share of the water crossing the front | 32 / 21 / 23 % | 31 / 23 / 23 % |
| ≥ 200 km² joins inside the ranges | 42 / 27 / 43 % | 61 / 47 / 57 % |
| Re, sea basins ≥ 100 km² p50 | 0.74 / 0.73 / 0.69 | 0.71 / 0.73 / 0.71 |
| Hack h: lattice; 20 m box | 0.55 / 0.57 / 0.55; 0.56 / 0.49 / 0.47 | 0.56 / 0.58 / 0.56; 0.50 / 0.50 / 0.47 |
| Flint θ (20 m box) | 0.53 / 0.47 / 0.39 | 0.63 / 0.45 / 0.50 |
| seed-42 box: relief over 5 km; elevation p50 / p99 | 1385 m; 1169 / 2234 m | 1405 m; 1163 / 2263 m |
| seed 1 box: p50 / 1 km relief / b / pits | 28.8° / 583 m / 1.33 / 3.08 | 29.4° / 576 m / 1.22 / 2.97 |
| seed 777777 box: same | 31.0° / 601 m / 1.19 / 1.69 | 30.3° / 591 m / 1.27 / 1.86 |
| rivers ≥ 500 km², 2 km gradient p50 at 200-400 m | 0.31 / 0.61 / 0.15 % | 0.23 / 0.70 / 0.18 % |
| same at 400-700 m (few samples: about 1000 / 150 / few) | 0.33 / 0.81 / 0.12 % | 1.21 / 1.20 / 0.02 % |
| all rivers, 2 km gradient p50, 200-400 m; 400-700 m | 0.95 / 1.68 / 0.73 %; 2.39 / 3.02 / 1.19 % | 1.00 / 1.57 / 0.82 %; 2.26 / 2.50 / 1.13 % |
| falls (of them fault falls) | 31 / 55 / 50 (29 / 52 / 46) ¹ | 25 / 61 / 34 (23 / 56 / 31); the rest are hanging valleys |
| water over ground > 10 m (overGround) | 55 / 10 / 23 | 4 / 69 / 35, all on meander loops > 200 m off the axis |
| river over a dry bank > 10 m; worst wall | 1888 / 1810 / 1548; 147 / 151 / 71 m | 1692 / 1824 / 1605; 124 / 68 / 112 m |
| streams; length; ending in a hollow | 705 / 704 / 734; 2020 / 1775 / 2147 km; 32 / 42 / 36 | 711 / 748 / 722; 1805 / 1831 / 1889 km; 22 / 40 / 37 |
| unfed river heads; dry heads with no feeder | 27 / 22 / 22; 14 / 15 / 12 | 19 / 20 / 15; 13 / 12 / 12 |
| trench check: lower bank over the water, p99; over 30 m | 3.4-3.7 m; 0 | 3.0-3.3 m; 0 |

¹ Counted with the structure off on this branch, so its river fixes are in both columns (`fallsCount`).

**Where the fault falls are** (`final-faultKnick.log`, `f3Views.log`). They are on mountain rivers and streams at the
fault traces, 10-14 m high, as flights of falls where the throw is over 15 m. The tallest on rivers:
- seed 42: line 9 at 9502,-43619, 13.8 m;
- seed 777777: line 115 at -43473,9760, 14.0 m;
- seed 1: line 197 at -4122,93169, 10.9 m.

## Load time, sample cost, cache

- **Structure build** (`structTime`, node, seed 42):
  - Building the structure (`structureFor` with `buildFaults`) takes 111 ms. It runs in every thread, because the
    model's cache key needs it.
  - The model takes 513 → 547 ms with the block phase.
- **World build in node** (phaseTimes, run alone): 3.38-3.45 s, against 3.02-3.16 s for f4s. Most of the rise is the
  structure and the bigger slopes pass.
- **Boot, seed 42 runway** (`boot.sh`, `boot.out`; f4s = `out/f3/base-src`, two rounds, port 5203). This machine was
  noisy: the same build varied by up to 4 s between rounds, so compare the model's own time. Round 2 is the clean
  round:

  | | 1x CPU | 4x CPU |
  |---|---|---|
  | f4s warm (cache) | 17019 ms (cache 21 ms) | 27521 ms (cache 81 ms) |
  | f3 warm | 12995 ms (cache 20 ms) | 28032 ms (cache 81 ms) |
  | f4s cold (model worker) | 14073 ms (worker 2100 ms) | 28808 ms (worker 2065 ms) |
  | f3 cold | 14867 ms (worker 2396 ms) | 30000 ms (worker 2486 ms) |

  A first visit costs about +0.3-0.4 s in the worker. Round 1 had the f3 worker at 3851 / 6755 ms against 2280 / 3445
  ms, on a busier machine. A cached load is unchanged.
- **Sample cost** (heightCost, costMountain, run alone):
  - `naturalHeight`: detail 2.25-2.28 µs (f4s 2.28-2.30), coarse 0.69-0.71 µs (f4s 0.68-0.69).
  - `sampleTerrain` in the four mountain windows: 2.76 / 2.74 / 2.71 / 3.24 µs, against f4s 2.99 / 2.63 / 2.77 / 3.14 µs.
    The windows lie on different ground now.
- **Cache size:** unchanged. The entry is T (0.4 MB) plus the slopes' dense fine-grid fields (about 10.4 MB). The
  structure is not cached; every thread rebuilds it from the inputs.

## Pictures

- **Files.** `out/f3/shots/<view>-f3.png`, each beside the shot it replaces where one exists:
  - f4s's `-f4s.png` for the valley views and the massif;
  - stage 4's `-f4.png` for stage 2's views, which stage 4 re-shot.
- **How they were made.** Rendered on port 5203; the server is stopped. Every view's query is in `out/f3/views.txt`.
- **Fly-to URLs.** `index.html?<query>&scenario=runway&tod=10&wx=clear`; add `&ui=0&cover=0&clock=0` for a clean frame.
- **Ignore** the dark hedge walls in some lowland shots: that is the old shelterbelt bug, fixed on main.

**New views (stage 3):**

- **s1-gorge6**: the 2203 km² river leaving the range through the front block. It runs across a farmed floor 2-3 km wide
  between forested ridges 400-500 m high, with the main range and its snow behind. A gap, not a slot (decision 2).
  `index.html?seed=1&camPos=64679,-148518,745&camLook=60251,-145014,295&scenario=runway&tod=10&wx=clear`
- **s1-gorge0**: seed 1's biggest river (3896 km²) where it crosses the block. An open valley: the walls are only about
  100 m high within 2 km.
  `index.html?seed=1&camPos=-49289,-119443,598&camLook=-43916,-113276,108&scenario=runway&tod=10&wx=clear`
- **s42-gorge14**: seed 42's one big river through the block (797 km², walls up to 510 m). A meandering river on
  farmland comes out between forested foothill ridges.
  `index.html?seed=42&camPos=-113859,73417,485&camLook=-121321,71822,35&scenario=runway&tod=10&wx=clear`
- **s777777-gorge0**: the 2931 km² river through the front block. A long straight valley between forested ridges up to
  700 m over the river, with a farmed floor; the river winds out of the gap.
  `index.html?seed=777777&camPos=22444,53441,593&camLook=14996,58872,143&scenario=runway&tod=10&wx=clear`
- **s777777-gorge5**: a second crossing on seed 777777 (2229 km²).
  `index.html?seed=777777&camPos=41737,19899,583&camLook=32957,17414,133&scenario=runway&tod=10&wx=clear`
- **s777777-strike40**: a stream running 17 km along the back of the block, growing from 49 to 369 km² on the way. It
  follows the foot of the block's forested face toward a held river's gap: the strike valley of the turned-aside
  streams.
  `index.html?seed=777777&camPos=-11336,62004,715&camLook=-14132,61714,265&scenario=runway&tod=10&wx=clear`
- **s1-strike3**: a 12 km stretch along the block's back on seed 1 (38 → 234 km²).
  `index.html?seed=1&camPos=67965,-97217,854&camLook=68141,-100103,404&scenario=runway&tod=10&wx=clear`
- **s42-fall9**: a fault's flight of falls (13.8 m) on a mountain river at its uplift step: white water in a narrow
  forested V.
  `index.html?seed=42&camPos=9941,-44132,1176&camLook=9502,-43619,726&scenario=runway&tod=10&wx=clear`
- **s777777-fall115**: a 14 m fault fall on seed 777777.
  `index.html?seed=777777&camPos=-44082,9371,710&camLook=-43473,9760,260&scenario=runway&tod=10&wx=clear`

**Re-shot views** (stage 2's `out/f2/views.txt` and stage 4's `out/f4/views4.txt`, as `-f3`). URLs are in those files
and in `out/f3/views.txt`.

- **The home fields, lowland lakes and coast views** (`s42-home`, `s777777-home`, `s1-lowlakes`, `s777777-lowlakes`,
  `s777777-lake`, `s777777-gorge`) look as they did. The block is kept clear of the home field and the lakes.
- **`s42-mtn`, `s777777-mtn`, `s42-snow`:** the same ranges and snow line.
- **`s42-massif`:** one long ridge runs across the view, with a farmed strike valley in front of it (the bands). There
  are fewer separate snow-tipped pyramids than in f4s.
- **`s42-valley1`:** the drainage changed here. The view now looks down a farmed valley where a tributary joins
  (a Y join) between V-walled forested slopes, where f4s saw a narrow forested V.
- **The other valley views** keep their character: V's between 36° walls.

## Left

- Decisions 1-5 above.
- A narrow incised gorge where a held river crosses the block (decision 2).
- Falls only at the up side's edge (decision 4), and a fall's height taken from the model's slope break rather than
  from the fault's throw.
- Seed 1's "natural" steps where the slopes pass meets a gentler model valley along a river's core. This is stage 4's
  class; the bands make more of it.
- Seed 42's water over ground > 10 m (69 points, all on meander loops more than 200 m off the axis: stage 4's open
  item).
- Stream length is down 10-12 % on seeds 1 and 777777, where foothill ranges replaced hill country that streams were
  traced over.

## Files

- **Code:**
  - `src/world/terrain/structure.ts` (new);
  - `erosion.ts`: `steadyLattice`'s structure and block phase, `SteadyRouter.route` hold, `lastBlock`, `MODEL_VERSION`,
    `modelKey`, the `setCourseTaper` probe hook;
  - `heightfield.ts`: the structure in `buildWater`, the block in `mountainSlopes`, `debugValley`;
  - `riverNetwork.ts`: `GORGE_CUT`, the belt clamp.
- **Probes** (`scripts/probes/`):
  - `structSweep`: the model on the lattice with any settings, tree gates by the world's drainage;
  - `faultKnick`: fault falls against the model's gradients, and the rivers through the block;
  - `f3Views` (gorge, strike-valley and fall views), `blockAt`, `fallsCount`, `structTime`;
  - `slopeSetup.ts` (`STRUCT_PARAMS`, `COURSE_TAPER`), `treeMetrics.ts` (`exitSum` per mouth).
- **Scripts** (`out/f3/`):
  - `gates.sh` (f4s's battery), `validate.sh`, `abl.sh` (one variant: steps, riverZero and the seed-42 box), `shots.sh`,
    `boot.sh`, `views.txt`;
  - `tools/`: stage 4's validate.py, gate.py, pits.py and the rest.
- **Logs** (untracked):
  - `final/` (the battery) and `final-faultKnick.log`;
  - variants: `abl/` and `abl-*.out`; proxy sweeps `sweep*.log`; world tree gates per variant `tm/`;
  - `data/validate/`, `suite*.log`, `boot.out`, `shots/`, `pics/`;
  - earlier full batteries: `after1/` (strong bands), `after2/` (bands off, two-cell gorge).
- **Source copy:** `out/f3/base-src` (`c6eafff`, for the boot comparison).
