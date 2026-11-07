# A real drainage tree for the seeded worlds: measurements, spike, plan

Branch `exp/drainage-tree` (from `exp/streams3` a5f90e4), 2026-11-07. Measurement and probe-only spike; nothing here is
wired into the game. All numbers are in `out/tree/table.md` (generated from the probe outputs), pictures in
`out/tree/png/`, `out/tree/ss/png/`, `out/tree/block/png/`, `out/tree/nz/`.

## In short

1. **The owner is right, and it is the terrain, not the river placement.** On seeds 1, 42 and 777777, a river that
   reaches the sea with 500 km² or more from the ranges gets only 7-12 % of its catchment through its largest range
   exit (median; Canterbury at the same 1 km spacing: 52 %, and 77-82 % for the Rakaia, Waimakariri and Rangitata).
   Of the confluences where both branches drain 200 km² or more, 60-78 % lie on plain ground and only 5-10 % inside
   the ranges. The drawn rivers are the drainage lattice's lines one for one (385/385, 401/401 and 400/400 lines match
   by index and parent), so they inherit this. The 20-step erosion pass changes 27-32 % of the lattice's receivers
   but none of these numbers.
2. **The cause is the layout: the ranges are narrow ridged-noise belts in wide hill country.** Mountain cells lie at
   most 11-19 km from the range front (p99, field classes), so the ranges are 20-40 km across, with hill country between them. Rivers
   leave such a belt every 8-12 km (≥ 45 km² exits) with a median of 70-80 km² each, and the big rivers gather in the hill country
   and on the plains. NZ has this type too: the Manawatu box (narrow Ruahine/Tararua ranges in hill country) scores
   like the seeded worlds (largest exit / mouth 0.17, 4 % of ≥ 45 km² joins inside the ranges). Canterbury is the
   other type: one wide mountain mass.
3. **A long uplift + stream-power run does not reorganise the tree by itself.** On the 1 km lattice, 800 implicit
   steps with uplift and rerouting every step (and a fast steady-state iteration that reaches the same state) leave
   every tree measure where it was when the uplift follows today's ranges (largest exit / mouth 0.07-0.13 before and
   after, in every variant). With a **wider orogen** the result moves about halfway to Canterbury (relief classes:
   0.19-0.39 against 0.09-0.20 now, NZ 0.52). But the control shows the noise ground already scores that well when
   measured against the wider front. So the width of the mountain mass decides where the big joins fall and how
   few the exits are. The process makes the ground consistent with that (trunk valleys inside the massif,
   no closed hollows, relief from uplift) but does not, at 1 km and on this time scale, move rivers across divides.
4. **Cost: the steady-state iteration is cheap enough for load.** 30 iterations of route + steady-state heights take
   18-19 ms each at 1 km (321² cells, node, one thread): about 0.55 s per world, against 12-20 s for time stepping
   (22-26 ms x 500-800 steps). That fits one worker at load plus an IndexedDB cache.
5. **Plan:** widen the orogen in `seededLayout.ts` as an uplift-rate field (the lever for few, large exits and joins
   inside the ranges), and replace the 20 lowering steps of `erosion.ts` with the steady-state iteration over that
   uplift field, started from today's noise ground so each seed keeps most of its drainage. The result becomes the
   macro ground that the gullies and detail ride on. Threshold hillslopes at 250 m, ice in the trunks and deposition
   on the plains follow in that order. Staging and gates are below.

## 1. Measurements on the seeded worlds (task 1)

### How
Probe `scripts/probes/treeMeasure.test.ts` (shared code in `scripts/probes/treeMetrics.ts`):
- **Lattice before erosion:** `buildDrainage` over `naturalHeightRaw(n, e, false)` on the 1 km lattice (the noise
  ground the erosion pass starts from, with the drainage's own breach and fill).
- **Lattice after erosion:** the world's own drainage. I added one export to `heightfield.ts`, `seededDrainage`, a
  module variable set in `buildWater` (null at seed 0). It changes no hash; `tests/era/presentGuard.test.ts` passes.
- **Drawn network:** `hydrology.rivers` (kind 0 rivers, and kind 0 + 1 with the streams), each sample classed by the
  lattice cell under it, branch areas from the lattice lines (rivers) or 1.5 km above the junction (streams).

**Classes**, two definitions, reported side by side:
- *Field classes* (the generator's own fields, `macroAt`): **mountain** where `uplift >= 0.25` (the mountain noise's
  amplitude 3100 x uplift is at least 775 m), in connected ranges of at least 100 km² (smaller blobs count as hill);
  **hill** where the hill amplitude seededNaturalHeight uses, `(90 + 260 smooth(-1000, 7000, inland) + 480 foothill)
  x hilly`, is at least 300 m; **plain** otherwise; sea where the lattice is at or below 0 m. These classes do not
  move when the ground changes, which suits before/after comparisons.
- *Relief classes* (max - min of the ground within 2 cells, a 5 km window): **mountain** ≥ 500 m, **hill** ≥ 150 m,
  **plain** below. The same rule runs on NZ, so these classes are the ones to compare with NZ.

**Measures:**
- *Confluence*: a cell with two donors that each drain at least T km² (T = 10, 45, 200). It is classed by the junction
  cell. It is **inside the ranges** if it is on mountain ground, or if its water crosses mountain ground again on the
  way out (an intermontane basin).
- *Range exit*: a mountain cell whose receiver is not mountain and whose water never meets mountain ground again.
  Exits that drain straight into the sea or off the domain edge are not counted. Spacing is the nearest-neighbour
  distance between exits (I did not project onto the wiggly front).
- *Largest exit / mouth*: for every river reaching the sea with at least 500 km² and fed from the ranges, its largest
  exit's catchment over its mouth's.
- *Hack h*: log of the longest upstream path against log area, over land cells with A ≥ 10 km². *Re*: Schumm's
  elongation 2√(A/π)/Lmax of basins ≥ 100 km².

Classes look sane: field classes give 22-27 % mountain, 36-42 % hill and 35-37 % plain; relief classes give 32-38 %
mountain, 48-53 % hill and 12-15 % plain, with 63-71 % agreement.

### Results (lattice after erosion = the world as built; full rows in table.md)

| | s1 | s42 | s777777 | NZ Canterbury (1 km) |
|---|---|---|---|---|
| ≥ 200 km² joins: n; on plain / inside ranges (field) | 63; 60 % / 10 % | 42; 64 % / 10 % | 64; 78 % / 5 % | - |
| same, relief classes | 22 % / 38 % | 17 % / 29 % | 28 % / 36 % | 15; 53 % / 47 % |
| ≥ 45 km² joins inside ranges (field / relief) | 10 / 38 % | 12 / 32 % | 7 / 32 % | - / 49 % |
| exits ≥ 10 km² (field): n, NN spacing p25/p50/p75 | 228, 1/4/7 km | 235, 1/3/7 km | 223, 2/4/6 km | 65, 3/4/6 km (relief) |
| exits ≥ 45 km² (field): n, spacing, area p50/max | 63, 5/8/14 km, 81/2990 km² | 79, 6/9/14 km, 80/1912 | 63, 7/11/17 km, 70/1800 | 26, 4/12/15 km, 141/2185 (relief) |
| exits ≥ 200 km² (field) | 6 | 11 | 2 | 10 (relief) |
| top 3 exits' share of the water crossing the front (field / relief) | 26 / 44 % | 19 / 22 % | 23 / 42 % | - / 50 % |
| largest exit / mouth, p50 (field / relief) | 0.07 / 0.09 | 0.12 / 0.20 | 0.08 / 0.16 | - / 0.52 |
| Hack h (A ≥ 10 km², 1 km) | 0.53 | 0.54 | 0.53 | 0.48 |
| Re, sea basins ≥ 100 km² (p50) | 0.73 | 0.72 | 0.70 | 0.44 |
| mountain distance to front p90/p99 (relief) | 7/11 km | 9/15 km | 8/12 km | 16/23 km |

- **Lattice before and after erosion are alike.** Every measure moves by a few points at most. For example, ≥ 200 km²
  joins inside the ranges (field) go 8 → 10 %, 11 → 10 % and 21 → 5 %. The erosion pass deepens the valleys the
  noise had; it does not change which way water goes at the scale of rivers.
- **The drawn network equals the lattice.** Its lines are the lattice lines one for one. Kind 0 rivers, field classes:
  ≥ 200 km² joins on plain 62/64/78 % (inside the ranges 9/10/5 %); largest exit / mouth 0.08/0.13/0.08. Adding
  the streams changes nothing above 45 km². So **the terrain causes it, not the river placement.**
- **Hack h does not discriminate at 1 km.** Seeded worlds give 0.53-0.56 and Canterbury 0.48 (0.58 on its mountain
  cells), Manawatu 0.57. The value also depends on the router: the same noise ground gives 0.55 with `buildDrainage`
  and 0.43-0.54 with steepest descent, because of routing over flats. The 0.41 in validation.md comes from the 20 m
  export and includes the sub-km gully noise, so it cannot be compared with any 1 km figure. Measure Hack only with
  validate.py on 20 m exports, never on the lattice.
- **Basins are rounder than Canterbury's** (Re 0.70-0.73 against 0.44), but Canterbury's sea basins include the long,
  parallel rivers on the plains' fans. Range-exit basins are alike (0.77-0.80 against 0.81).
- **The seeded plains are not plains.** Relief classes call 48-53 % of seeded land hill, against 21 % in Canterbury,
  because the seeded "plains" carry 150-500 m of relief within 5 km. Real plains here are built by deposition.
  This is why mountain-or-not and the topological "inside the ranges" are the robust splits, not plain against hill.

### NZ at the same spacing (`scripts/probes/nzTreeFetch.py`, `treeNz.test.ts`)
The LINZ national 8 m DEM was read at 1 km (CC BY 4.0, "Sourced from LINZ"; learning only, nothing NZ goes into the
sim) through the landform tools, reading only from them, with their item cache copied to `out/tree/nz/cache`. It was
measured with the same TypeScript code, steepest-descent router and relief classes. This was cheap: about 10 s per box.
- **Canterbury** (-44.25..-42.85, 170.55..172.85): the Rakaia, Waimakariri, Rangitata and Ashburton with their ranges
  and plains. Picture `out/tree/nz/canterbury_1000.png`: one exit each through the front for the big rivers.
  Largest exit / mouth p50 0.52 (top rivers 82/77/77 %); ≥ 45 km² joins inside the ranges 49 %; top-3 exits 50 %.
  Caveats: only 15 joins ≥ 200 km²; one "river" of 2532 km² with a 36 km² top exit is the flat Lake Ellesmere fill
  on the plains, not a range river.
- **Manawatu** (-40.75..-39.45, 175.0..176.6): narrow ranges in hill country, mountain only 7 % of land. Largest exit
  / mouth 0.17; 4 % of ≥ 45 km² joins inside the ranges. This is the seeded worlds' type.

## 2. Spike: uplift + stream power on the lattice (task 2)

### Model (`scripts/probes/treeSpike.test.ts`)
The same seeded inputs (macro fields and noise lattice) on the 1 km lattice over ±160 km. The sea and the domain edge
are fixed base level. Each step:
- Route: priority flood, then steepest descent on the filled surface; cells in a hollow drain toward its spill.
- Uplift.
- The implicit FastScape solve of `erosion.ts` (n = 1, m = 0.45, downstream first).
- A floor at a minimum graded slope, 0.06 A^-0.45 per km. This stands in for deposition where uplift is about 0,
  so the plains keep a gravel-river gradient instead of being planed to the sea.
- A threshold slope Sc = 0.6 (it only touches ridge cells at 1 km).

Hillslope diffusion is left out: at real rates (~0.01 m²/yr) it is negligible at 1 km. Units: 5 m of uplift per step
at the peak rate. K is set so a 1 km² cell drops 450 m per km at steady state.

Uplift: `U = Upeak (rangeU + 0.2 x hillAmp / 830) x smooth(0, 15 km, inland)`, where rangeU depends on the variant:
- **low** and **knoise**: rangeU is the generator's `uplift / 1.15`.
- **broad**: rangeU adds half the foothill belt.
- **wide** and **widefull**: rangeU is the belts or a Gaussian blur of them (σ 12 km, scaled so broad crests saturate),
  whichever is higher. This gives an orogen 40-80 km across.
- **block**: wide for the first half, then a front range 3-12 km outside the orogen rises at 0.6 Upeak.

Start surfaces and erodibility:
- **full** and **widefull** start from today's noise ground.
- The others start from the coast profile plus 0.1 of the noise relief.
- **knoise** takes K from the noise: K ÷ 4 to K × 4 where the noise stands high or low.

There are two solvers:
- **Time stepping**: 800 steps.
- **Steady-state iteration** (`SPIKE_MODE=ss`, Cordonnier et al. 2016): route, then set every cell to its receiver's
  height plus `U L / (K A^m)`, downstream first, 30 times. Captures happen between iterations as the heights change.

Each result is measured against three sets of classes:
- the generator's field classes;
- the variant's own uplift classes (mountain where U ≥ 0.3 of peak), with the **noise ground measured against the
  same classes as a control**;
- relief classes on the result.

### Results (full rows in table.md)
Largest exit / mouth p50 and ≥ 45 km² joins inside the ranges, by seed (s1 / s42 / s777777):

| | field classes | variant's uplift classes | control: noise ground, same classes | relief classes on the result |
|---|---|---|---|---|
| world as built (lattice after erosion) | 0.07 / 0.12 / 0.08; 10 / 12 / 7 % | - | - | 0.09 / 0.20 / 0.16; 38 / 32 / 32 % |
| low (800 steps) | 0.07 / 0.09 / 0.07; 11 / 13 / 16 % | - | - | 0.07 / 0.09 / 0.06; 10 / 10 / 7 % |
| full (800 steps) | 0.08 / 0.13 / 0.07 | - | - | 0.09 / 0.10 / 0.07 |
| knoise (800 steps) | 0.08 / 0.12 / 0.08 | - | - | 0.08 / 0.11 / 0.08 |
| broad (800 steps) | 0.08 / 0.11 / 0.07 | 0.23 / 0.40 / 0.20; 46 / 46 / 35 % | 0.22 / 0.59 / 0.35; 61 / 57 / 49 % | 0.22 / 0.29 / 0.11; 40 / 35 / 18 % |
| wide (800 steps) | 0.09 / 0.12 / 0.07 | 0.19 / 0.40 / 0.33; 54 / 56 / 70 % | 0.28 / 0.46 / 0.44; 71 / 52 / 66 % | 0.19 / 0.32 / 0.24; 43 / 38 / 40 % |
| wide (ss, 30 it.) | 0.13 / 0.12 / 0.11 | 0.26 / 0.40 / 0.46; 55 / 54 / 69 % | as above | 0.27 / 0.39 / 0.35; 46 / 40 / 41 % |
| widefull (ss, from today's ground) | 0.13 / 0.12 / 0.11 | 0.41 / 0.46 / 0.35; 58 / 55 / 67 % | as above | 0.26 / 0.37 / 0.26; 49 / 42 / 52 % |
| block (800 steps) | 0.08 / 0.12 / 0.07 | 0.43 / 0.50 / 0.46; 70 / 58 / 77 % | 0.85 / 0.71 / 0.70; 82 / 67 / 80 % | 0.34 / 0.37 / 0.46; 63 / 42 / 65 % |
| NZ Canterbury | | | | 0.52; 49 % |

What this says:
- **With today's ranges** (low, full, knoise), steady-state uplift and erosion with captures change no tree measure.
  Field-class exit / mouth stays at 0.07-0.13, and joins inside the ranges stay at 7-16 %. Most drainage
  reorganisation happens early (500-1200 receiver changes of channel cells per 100 steps around step 300, 1-150 by step 800),
  but it moves divides by a few cells, not whole rivers across ranges.
- **A wider orogen gives Canterbury-like statistics, but the noise ground already has them against the same front.**
  The control scores as well as the evolved result (0.28-0.46 against 0.19-0.46, and better still for block). The
  big rivers already gather in the hill country between the belts. What a wide orogen changes is that this hill
  country becomes mountains, so those joins fall **inside** the ranges and one exit carries them out.
- **Relief classes**, the fair comparison with NZ because the evolved wide ground is 47-54 % mountain against
  Canterbury's 43 %: exit / mouth 0.19-0.39 (now 0.09-0.20, NZ 0.52); joins inside the ranges 38-52 % (now 32-38 %,
  NZ 49 %); top-3 share 16-30 % (now 22-44 %, NZ 50 %). So the wide orogen gets **about halfway** on exit / mouth
  and reaches NZ on joins inside. What is still missing:
  - a continuous mass with longitudinal valleys that turn small rivers along strike into the big ones;
  - one dominant gorge per big river (the top-3 share stays low).
  The block variant (a late front range) gets closest (0.34-0.46, 42-65 %), but its own control is better still. It
  shows the idea; it is not proof that antecedence works in this model.
- **Hack h** rises to 0.57-0.59 after every run (from 0.43-0.56), but see above: it is not a usable target at 1 km.
  Re of sea basins falls slightly (0.70-0.73 → 0.63-0.69).
- **Pictures** (channels ≥ 10 km² coloured by catchment, pale cyan to violet; range front white; exits ≥ 45 km² red
  squares; joins ≥ 45/45 km² yellow dots). In `out/tree/png/s777777-lattice-after.png` the ranges are small blobs and
  the big trunks run long straight lattice diagonals through the lowland. In `out/tree/png/s777777-spike-wide.png` and
  `out/tree/ss/png/s42-spike-widefull-ss.png` one massif holds dendritic trunk valleys that leave through a few
  exits. On the plains the spike draws many parallel channels down the coast ramp: the grade floor, no fans yet.
- **The ground rises.** The wide variants stand above today's noise ground on 36-56 % of land, by 320-650 m on
  average there. Today's variants do so on 2-9 %. Peaks reach 3500-4600 m in the wide runs and 2200-3700 m in the
  others, where the median mountain ground falls from ~1300 m to ~750-850 m (the U/K scalar is not calibrated). With n = 1 the relief scales linearly with U/K and the drainage pattern does not, so heights are one
  scalar to calibrate after the layout is fixed. The mountain ground's 1 km slope rises from p50 10.6° to 16-17° in
  the wide runs (the 33-40° threshold slopes are sub-km and need the 250 m stage).

### Timing (node, one thread, this machine; 321² = 103k cells)
- **Time stepping**: route 13-16 ms + solve 8-10 ms per step. The mean rise is within ±4 % of the uplift by step
  500-800 for every variant that starts from low relief. The full variants are still lowering their initial relief
  at step 800 (-6 to -9 %). So 500-800 steps take **12-20 s**.
- **Steady-state iteration**: route 13-14 ms + heights 4.6-5.3 ms per iteration. Receivers settle within 20-30
  iterations (0-4 changes at iteration 30). So 30 iterations take **~0.55 s**, with results of the same character as time stepping (similar, not identical numbers)
  (table rows above).
- **Finer grids**, estimated: routing is O(N log N), heights O(N).
  - 500 m (4× cells): ~80 ms per iteration, ~2.5 s.
  - 250 m (16×): ~330 ms per iteration, ~10 s, or 15 s if it needs half as many iterations again.
  - Time stepping at 250 m: ~4-6 min.
  - An O(N) router (steepest descent plus a basin graph for the few pits, Cordonnier et al. 2019) should cut routing
    to ~4 ms at 1 km, about 0.3 s per world.
  - The full domain at 250 m is not a load-time option. The 250 m work should be local post-passes (slope limiter,
    valley shapes), not a second landscape-evolution run.

## 3. Proposal

### 3.1 Two levers, in this order
1. **Layout: a wide orogen as an uplift-rate field** (`seededLayout.ts`). Keep today's ridged-noise belts as the
   highest crests. Add a broad envelope 40-80 km across (a blurred or warped wider threshold of the same ridge noise),
   so the hill country between belts becomes mountain and intermontane valleys. Per seed, choose between a
   "Canterbury" type (one wide mass) and a "Manawatu" type (narrow ranges in hill country): variety, both real.
   This is the lever for few, large exits and big joins inside the ranges (spike: the control).
2. **Process: steady-state stream power over that uplift field** (replacing `erosion.ts`'s 20 lowering steps). Use
   the steady-state iteration on the 1 km lattice, started from today's noise ground (`widefull`), so each seed keeps
   most of its drainage tree. The ground becomes consistent with its rivers: trunk valleys inside the massif, no
   closed hollows, relief and Flint profiles from uplift, local captures. Erodibility from the noise (`knoise`) and
   fault-bounded blocks give structure. A late front block (`block`) may give antecedent gorges.

### 3.2 How it fits the round-3 direction
- **Uplift field**: the layout change above *is* the uplift field: an uplift rate, no longer a noise amplitude. Faults
  from `faults.ts` become block edges, steps in U. Their knickpoints then come out of the model.
- **Steady-state erosion with threshold hillslopes**:
  - steady state at 1 km by iteration;
  - threshold slopes as a post-pass on the 250 m raster in the ranges: a slope-limiter sweep at 33-37° in
    downstream order, O(N), ~410k cells, estimated 50-100 ms. The 1 km lattice cannot show them (spike: 1 km slope
    p50 16-17° at most).
  - The V-shape and slope targets of validation.md belong to that stage.
- **Ice widening only the trunks**: after the steady state, ice flux accumulated down the tree above a seeded ELA.
  U troughs are drawn along ice lines with the carve machinery (`erosion.ts` carveSegment, as valleys are now). This
  gives overdeepenings, which are the only closed basins left, so the lakes and tarns come from it. A wide orogen
  makes long trunk glaciers possible; today's narrow belts would only hold short ones.
- **Erosion with deposition (Yuan et al. 2019)**: the same implicit solver with the deposition term G. It replaces
  the spike's grade floor on the plains and gives fans at the front, gravel floors in the intermontane valleys and
  river-built plains. Seeded plains with 150-500 m of relief within 5 km would then become real plains. The
  probe's control says it will not change the tree in the ranges; it changes the plains, where the Canterbury
  rivers run parallel down their fans (Re 0.44).

### 3.3 What the consumers take
The macro ground becomes **T**: the steady-state surface on the lattice, interpolated (C1 B-spline, as `erosion.ts`
`upsample` does now). It stands above today's noise on much of the land, so **the "cut ≤ 0" interface goes**:
`applyCut`, `REPLACE`/`erosionWeight` and the cushion all assume a lowering. `seededNaturalHeight` becomes
`coarse = T + residual`. The residual is the noise relief finer than the lattice: the noise minus its own 1 km
B-spline. It is kept so the ground has texture below 1 km, faded on channel floors as `erosionGullies` does now.
The consumers then take it as follows:
- **heightfield.ts gullies and detail**: unchanged in design: they follow the fall line of the eroded ground, now T.
  Their amplitude (`amplitude = hillAmp + 3100 uplift`) should come from T's local relief, not the noise amplitude.
  GULLY_FALL, SPUR_* and the knob and ledge caps need re-checking, as the source-to-sea brief expects.
- **drainage.ts**: routes T. Breach and fill become a near no-op check: T drains by construction. Lakes from lattice
  hollows mostly disappear (today 400-500 a world), and so do tarns (one-cell hollows) until the ice stage. Decide
  with the owner whether to keep a stand-in, such as seeded overdeepenings on trunk valleys above the ELA.
- **riverNetwork.ts**: lines from the lattice as now. `free()` reads `valleyCut` (the erosion's lowering) to pin a
  river to its valley. Give it a valley-depth field instead (T minus a blurred T, or the carve depth). Water levels
  (running minimum, lakes) are unchanged. The meander rules (≥ 250 km², gradient < 0.004) work off catchment and
  slope, so they follow.
- **streams.ts**: traced on the 250 m raster over `naturalHeightSmooth`. The macro ground drains by construction, but
  the sub-km noise octaves still make hollows (A1b: 16-45 % of rill heads end in them). The 1 km model does not fix
  that; the 250 m pass or damping those octaves does.
- **lakes / LakeMask, ShoreSmooth**: unchanged code, far fewer lakes until the ice stage.
- **falls / faults**: falls today come from fault crossings and from searches for hanging lips and outlets. Later
  they are read from the model: knickpoints at block edges, hanging lips from the ice stage. Until then the current
  rules run on T.
- **Rills**: they follow the detail ground. Unchanged.
- **Career sites, airfields, roads, villages**: built from the hydrology and ground afterwards, so they follow. The
  seed-7 golden board will need a re-bake (allowed; seed 0's entry must stay byte-equal).
- **Home-field siting**: the 400-candidate layout search cannot run the model per candidate. Keep the present
  pattern:
  - search on the proxy ground (the noise with the new envelope);
  - run the model once with the home site held, using today's `HOME_KEEP`/`hard`, the routing mound, and uplift
    faded to 0 over 3-8 km;
  - re-validate the runway and approach once on T;
  - on failure, take the next candidate, which costs one more model run (cached). Measure how often that happens.

### 3.4 Load time
The world build (~2-3 s here) runs in every terrain worker and the main thread in parallel. Adding 0.55 s to each is
far over the +100 ms budget, so **both a worker build and an IndexedDB cache**:
- **First visit to a seed**: one worker runs the steady-state iteration and posts T (103k floats, 400 KB) to the main
  thread and the other workers. They sample the macro fields and coast meanwhile, and wait for T before drainage.
  Expected +0.6 s on this machine, about +2.4 s at 4× CPU throttle (the laptop stand-in). An O(N) router roughly
  halves that.
- **Cache**: IndexedDB keyed by seed plus a generator-version hash. Later loads read and decode 400 KB (~10-30 ms).
  The water build already planned the same cache. If the cache is missing (private window), fall back to the worker
  build.
- The 250 m post-passes (threshold slopes, valley shapes) are local and cheap, or done per tile at sample time.
  Keep them inside the +100 ms budget.
- Agree the first-load and cached-load times with the owner before stage 2. They are the budget this changes.

### 3.5 Seed 0 and the CPU/GLSL twins
- **Seed 0** never calls `seededLayout.ts`, `erosion.ts` or `drainage.ts` (seed 0 uses `buildLakes` and
  `buildHydrology`). Every new path sits behind `SEEDED`, as now. `presentGuard` (sampleTerrain, hydrology, tiles,
  tree cells, shader text) stays byte-identical. The probe's one `src` change, the `seededDrainage` export, was
  checked with `tests/era/presentGuard.test.ts`, which passes.
- **No shader recomputes the macro ground.** Tiles carry the CPU heights. The GLSL twins read CPU-built data, so
  they follow automatically:
  - `channelStones`: its hash lattice along river lines;
  - `bedrock` ROCK_EDGE: `vFlow` from the tile builder;
  - rills: a CPU-traced texture;
  - fields, roads and plantations: uniform tables.
  None of them needs to change.
- What does change for the shader: the only height constant in it is the snow line (`snowLineBase()` = 2500 m plus
  the era offset, compiled into the text). With wider, higher ranges, more ground lies above it. That is a re-tune
  (the CPU snow line in `biome.ts` must keep matching), not a twin to rewrite.
- Steeper threshold slopes (stage 4) shift the rock and scree weights through the slope inputs both twins already
  share.

### 3.6 Staging, least risk first
0. **Done here: the gates.** treeMeasure, treeNz and treeSpike are probes, with NZ numbers. The acceptance targets
   for a Canterbury-type seed, from Canterbury at 1 km with relief classes:
   - largest exit / mouth p50 ≥ 0.4 (now 0.09-0.20, NZ 0.52);
   - ≥ 45 km² joins inside the ranges ≥ 40 % (now 32-38 %, NZ 49 %);
   - mountain distance to front p90 ≥ 15 km (now 7-9, NZ 16);
   - Re of sea basins ≤ 0.65 (now 0.70-0.73, NZ 0.44; fans included).

   The top-3 share is reported but not gated: it is noisy. Hack h is measured only with validate.py on 20 m
   exports.
1. **Plumbing, without changing the look.** Replace the 20 lowering steps with the steady-state iteration over
   today's uplift (`full`). Do it in one worker with the IndexedDB cache, and make T the macro ground with the
   residual detail on top: drop the "cut ≤ 0" interface and give `free()` its valley-depth field. Calibrate U/K so
   the relief matches today's. The spike says the tree barely moves, so career sites, home field and lakes stay
   nearly where they are. This is the risky refactor, done while the world still looks the same. Gate: presentGuard,
   the full test set, the budgets, the treeMeasure numbers unchanged, and the validate.py slope/relief numbers no
   worse.
2. **The wide orogen.** Change the layout to an uplift-rate envelope, gated per seed type, and run the `widefull`
   iteration. This re-rolls the mountains of every seeded world. Gate: the targets above on seeds 1, 42 and 777777,
   home siting succeeding, coast and plains still present, and the owner looking at the pictures and from the
   cockpit.
3. **Structure.**
   - Erodibility bands along strike (`knoise`), fault blocks as uplift steps, a late front block for antecedent
     gorges.
   - Front blocks need time dependence. A steady-state-compatible version: compute the tree with the orogen, then
     add the block's uplift with the receivers of rivers ≥ A_crit frozen (they hold gorges) and the rest rerouted.
   - Gate: the top-3 share and exit / mouth toward NZ, and falls at knickpoints.
4. **Threshold hillslopes at 250 m** in the ranges, toward the validation.md slope and relief targets (slope peak
   33-40°, 1 km relief 400-650 m, V's with b about 1.0-1.1).
5. **Ice** in the trunks (U troughs, hanging valleys, overdeepened lakes, tarns), above a seeded ELA.
6. **Deposition** (Yuan et al. 2019): plains, fans, gravel floors, braided belts from the river rules in validation.md.

## Files
- `scripts/probes/treeMetrics.ts`: the measures, classes, steepest-descent router and picture.
- `scripts/probes/treeMeasure.test.ts`: task 1 on the worlds as built (`TREE_SEEDS=1,42,777777`).
- `scripts/probes/treeSpike.test.ts`: task 2 (`SPIKE_SEEDS`, `SPIKE_VARIANTS=low,full,knoise,broad,wide,widefull,block`,
  `SPIKE_MODE=ss`, `SPIKE_STEPS`, `SPIKE_U`, `SPIKE_RIDGE`, `SPIKE_DUMP=1` to save the lattices).
- `scripts/probes/nzTreeFetch.py` + `treeNz.test.ts`: NZ boxes at 1 km.
- `scripts/probes/treeTable.py`: `out/tree/table.md` from the probe outputs.
- `src/world/terrain/heightfield.ts`: `export let seededDrainage` (probe hook only; set in `buildWater`, null at seed 0).
- Outputs:
  - `out/tree/measure-{1,42,777777}.txt`, `out/tree/spike.txt`, `out/tree/ss/spike.txt`, `out/tree/block/spike.txt`,
    `out/tree/nz/measure.txt`, `out/tree/table.md`;
  - pictures `out/tree/png/s<seed>-{lattice-before,lattice-after,drawn,spike-before,spike-<variant>}.png`,
    `out/tree/ss/png/s<seed>-spike-<variant>-ss.png`, `out/tree/block/png/s<seed>-spike-block.png`,
    `out/tree/nz/{canterbury,manawatu}_1000.png`.
