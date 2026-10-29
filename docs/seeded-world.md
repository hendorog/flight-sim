# Seeded world: design

Goal (owner, 2026-10-29): a world generated from a seed, with the usual features (airfields, towns, roads, forests,
trees, shelterbelts, rivers, hills, mountains), and the same for the Cretaceous era and its dinosaurs.

## Ground rules

- **Seed 0 is today's hand-tuned world, byte for byte.** `tests/era/presentGuard.test.ts` pins it; a guard failure
  while working on seeds is a seed-0 regression to fix, not a fixture to re-pin.
- **Everything new is a pure function of (seed, place)**, so it can run at load or when streamed in, in any thread,
  and give the same answer. No hand-placed constants and no committed bakes for seeds other than 0.
- **CPU and GPU twins stay in step.** The ground shader recomputes fields, plantations and roads; whatever the
  workers compute from a seed, the shader must compute the same way (`hashGlsl()` is the pattern).

## Step 2: seed plumbing (done, `5df9cdc`)

`?seed=n` → `src/world/worldSeed.ts`, set by the Simulator right after the era, by the dev harness and in the
terrain workers' setup message.

| Seeded now | How |
|---|---|
| Hills, coast, mountain range, woods, moisture, plantation estates | gradient-noise permutation table reseeded (`noise.ts`) |
| Field pattern, plantation compartments, tree placement | salt on the integer hash, CPU (`hash2i`) and GPU (`hashGlsl()`) |
| Lakes and rivers | rebuilt against the new terrain (`heightfield.ts`, `onWorldSeed`) |
| Town and villages' random streams | `seeded(n)` on the `rng` seeds |

| Still fixed for every seed | Why |
|---|---|
| The large-scale layout: coast about 21 km south, range to the north, the valley along the runway | the coast/range/valley profile in `naturalHeight` is hand-shaped around the airfield |
| The river's course and the four lakes' positions | hand-placed axis; the meanders are a seed-0 bake |
| The airfield | hand-built, and its layout is used by the physics, ATC and the lessons |
| Roads, villages, bridges | a seed-0 bake; switched off for other seeds until step 4 |

## Measured costs (node, one thread)

- Meander growth for one 60 km river: about 6 s.
- Road planning for the 35 km around the field (5 villages): about 4 s. The planner already runs unchanged for other
  seeds.

Neither can run on the main thread at load. Both go in workers, with results cached per seed (IndexedDB) so a
seed's second load is instant.

## Step 3: regions and generated rivers

**Two scales of region.**

- **Provinces, 64 km.** Drainage, coast and ranges. Each province has a coarse height lattice (1 km) from the same
  `naturalHeight`, and its river network is traced on that lattice: flow accumulation, rivers where the catchment
  passes a threshold, each running downhill to the sea or out of the province.
- **Districts, 16 km.** Settlements, roads and airfields, generated when the aircraft comes within about 30 km.

**Rivers across province edges.** Each province is traced over a 3 × 3 window of provinces (its own plus its
neighbours), so a river leaving one province arrives in the next at the same point. Both sides trace the same window
contents, so this holds without passing messages between them. Rivers are then meandered per reach in a worker (the
existing `meander.ts`, seeded by the reach), coarse first and refined in the background. The ground carving
(`heightfield.ts` valley/channel profile) already works from any polyline.

**Seed 0 keeps today's river.** The generated network applies only to other seeds, at first. Later, seed 0 could
gain tributaries that join the hand-placed river, if wanted.

## Step 4: settlements and roads per district

- Sites per district: one town for every few districts, villages, farmsteads. The existing rules (flat, dry, off
  the floodplain, out of the woods and estates, clear of airfields) are already written as pure functions.
- Roads: the existing planner (cost grid, tree from the largest settlement, gravel loops) per district, plus **edge
  portals**: points on each shared district edge, chosen by hash and the terrain, where a road crosses into the next
  district. Each side routes to the same portal, so roads join across edges without seams.
- Bridges and villages as today. The ground shader's road tables grow to a streamed set (one table per loaded
  district).

## Step 5: generated airfields

A kit of three: a grass strip (600–900 m), a small sealed aerodrome (900–1,400 m, a few hangars), and a regional
field (1,600–2,000 m, a terminal, lights).

- **Siting:** flat ground along the prevailing wind, clear approach corridors, away from towns.
- **Terrain:** the flattening and approach protection (`airportBlend`, `approach`) generalised from one airfield to
  a list.
- **Scope:** the home airfield stays the hand-built one at the origin. Making the generated fields work with the
  navaids, ATC and lessons is a separate later step; to begin with they are scenery you can land at.

## Step 6: the Cretaceous on top

Same seed and same macro terrain. The era's river network follows from step 3's tracing (its scenery is already
placed along "the river's earlier course"). Herds and the volcano are placed by district, like the settlements.

## Questions for the owner

1. Region sizes (64 km provinces, 16 km districts): fine, or should districts be larger (fewer, bigger towns)?
2. Should the home airfield always be at the origin of every seed's world, or could a seed start you at a
   generated field?
3. Seed in the UI: a field in the menu with a "random" button, and the seed shown on the map?
4. Should seed 0 stay exactly as it is forever, or may it gain generated features beyond today's area (more
   villages and roads past 15 km)?
