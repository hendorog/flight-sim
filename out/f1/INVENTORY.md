# Stage 1 inventory: who reads the erosion field, and who assumes it only lowers the ground

Branch `exp/foundation` from `exp/drainage-tree` cea3349. Written before any code change. "cut" below = today's
`erosionCutAt` result, <= 0 by construction.

## Direct readers of the erosion field (`erosion.ts` ErosionField)

| Where | What it reads | What it assumes | Stage 1 change |
|---|---|---|---|
| `erosion.ts` `erodeLattice` | the noise lattice | lowering only (`h <- (h + F h_r)/(1+F)`, `floor`, `spread` keeps `min(0, ...)`) | replaced by the steady-state iteration (`steadyLattice`); lattice T may stand above the noise |
| `erosion.ts` `buildErosion` | T, noise lattice | `change = min(0, h - h0)` (the clamp), `lowered <= 0` | `change = T - h0`, signed; the clamp goes |
| `erosion.ts` `erosionWeight` / `REPLACE` | `lowered` | the ground is *replaced* by T where the cut is deep (15-60 m), *lowered* where shallow; a structural use of "cut <= 0" | goes. By linearity of the B-spline, `noise + Bspline(T - noise_lattice)` = `Bspline(T) + residual` (PLAN's `T + residual`), so one signed field does both. The residual's fade on valley floors (what REPLACE did implicitly) moves to the floor mask |
| `erosion.ts` `erosionCutAt`, `roundMin0`, `CUT_ROUND` | sample | the cut is rounded to <= 0 (C1 at 0) | goes: macro offset = signed B-spline delta + carve (<= 0, the valley drawn along the channel course) |
| `erosion.ts` `erosionCutGrad` | sample + gradients | the `roundMin0` fade and `dw/dd` terms | simplified to the gradient of the signed delta + carve |
| `erosion.ts` `erosionGullies` | `floor`, `w` | gullies give way on a valley floor only where `w > 0` (deep cut) | keyed on the floor mask and the valley depth instead of `w` |
| `erosion.ts` carve / `surface` | eroded cells | carves T's fine grid down to the channel floor (a lowering *of T*, not of the noise) | kept as is: it is how T is drawn, not a cut of the noise. Becomes its own field `carve` (<= 0) |
| `erosion.ts` `drainByHome` | eroded lattice, `hard` | lowers a course out of a hollow by the field | kept (the home hold can leave a hollow) |
| `heightfield.ts` `applyCut` | cut | `if (cut >= 0) return h`; sea cushion for cuts reaching sea level | becomes `applyMacro`: `h + cut` above 0, the sea cushion kept for negative offsets only (the one place "lowering" is special) |
| `heightfield.ts` `seededNaturalHeight` | `sampleErosion(Grad)`, `erosionCutAt`, `erosionCutGrad`, `erosionGullies`, `applyCut` | the gullies' fall line = coarse gradient + cut gradient; lake reach `hc = applyCut(coarse, cut)` | same calls on the signed interface; nothing clamps |
| `heightfield.ts` `buildWater` | `eroded.lattice`, `eroded.delta` | `lat = applyCut(lat - delta, delta)` (cushion), `delta` as `valleyCut` | lattice = T with the cushion; riverNetwork gets a valley-depth field |
| `heightfield.ts` `setLayoutGround` comment | - | "the site stays valid (the pass only lowers the ground)" | no longer true: the site is chosen on the noise ground, held during the model (`hard`), and re-checked once on the final ground (`homeRecheck`) |
| `riverNetwork.ts` `free()` / `PIN_CUT` [20, 80] m | `valleyCut[c]` (<= 0) | "the erosion cut deep here = the river's own valley, keep the course on its cells" | takes `valleyDepth[c]` (>= 0): how far the cell lies below its surroundings on T (local mean minus T), mapped to the same PIN_CUT scale |
| `riverNetwork.ts` ~l.1115 meander belt comment | (reads the ground, not the field) | describes the erosion valley the axis runs above | no code change |
| probes `treeMeasure`, `overGround`, `cutCheck`, `cutSource`, `erosion`, `macroSink` ... | `buildErosion`, `naturalHeightRaw`, `erosionCut` | today's interface | treeMeasure's "before" row keeps using `naturalHeightRaw` + `buildDrainage`; old probes that import removed names are left (they are not run by the suite) |

## Indirect readers (they read the final ground or the hydrology, so they follow)

- `drainage.ts` buildDrainage: routes the lattice it is given (T). Lindsay breach/fill, `settlePonds`, lake flooding:
  no code change. T drains by construction except where the home hold or the era volcano leaves a hollow, so breach
  and fill become a near no-op and **lattice lakes mostly disappear** (owner accepts). `LakeMask`/`ShoreSmooth`:
  unchanged code, far fewer lakes; check they cope with an empty list.
- `drainage.ts` TARN_SPILL tarns: one-cell lattice hollows above 1200 m. T has none, so tarns go too (until ice).
- `streams.ts` traceStreams / `refineSteep` / breach cuts: traced on the 250 m raster over `naturalHeightSmooth`
  (T + residual + gullies). Their own channel cuts (water below ground) are the channel's carve, not the erosion's;
  no change. Sub-km hollows from the residual remain (A1b), not this stage.
- `heightfield.ts` carveNetwork / channel and breach profiles: carve the channel below the final ground. Unchanged.
- `falls.ts`, `faults.ts`: read `macroAt` (uplift) and the hydrology lines. Unchanged; the falls are re-found on T.
- `rills.ts`: traced on the detail ground. Unchanged.
- `homeSiting.ts` / `seededLayout.ts` chooseLayout: the 400-candidate search runs on `naturalHeightRaw` (no model).
  Unchanged; the model holds the site (`HOME_KEEP`/`HOME_FULL`, `PAD_KEEP`, routing mound), then one re-check of
  pad, approach, far end and circuit on the final ground (owner's decision 2026-11-07).
- `airfieldSiting.ts`, career sites, roads, villages: built from the final ground and hydrology afterwards. Follow.
  Seed 0's career board stays byte-equal (no seed-0 path changes); seed 7's will likely re-bake.

## Seed 0 and the shader twins

- Seed 0 never calls `buildErosion` (`buildWater` takes the `SEEDED` branch only for seed != 0). Every new path
  sits behind that branch. `presentGuard` is not touched.
- Checked: no shader recomputes the macro ground. `grep mountainShape|hillShape|macroAt|uplift` over
  `terrainMaterial.ts`, `water.ts`, `glsl.ts`, `rillShader.ts`, `channelStones.ts` finds nothing; the tiles carry
  CPU heights. `macroAt` is read on the CPU only (`faults.ts`, `riverNetwork.ts` hanging lips, `seededLayout.ts`).

## Load path (for the worker + cache step)

- Every thread builds the world synchronously on `setWorldSeed` (heightfield.ts `onWorldSeed(buildWater)`): the main
  thread in the `Simulator` constructor, each terrain worker on its `setup` message (`TerrainSystem` broadcast).
- Stage 1 adds: the lattice T (321 x 321 float32, 412 KB) can be *provided* for a seed before `setWorldSeed`; the
  main thread gets it from IndexedDB or one dedicated worker before constructing the Simulator, and the terrain
  workers receive it in their `setup` message. With nothing provided (node tests, dev pages) the thread computes it
  synchronously, with the same code.
