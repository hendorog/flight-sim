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

## Owner's answers and the order now (2026-10-30)

- Long term: a whole planet generated from the seed as you fly, with the variety of real landscapes. Not now.
- Now: flying between airports, with ATC and other traffic to follow, so the world has to be big enough for real
  legs between fields.
- Yes to a seed box with a "random" button in the menu. Yes to seed 0 growing villages and roads past today's 15 km
  (the present guard re-pins as it grows, each re-pin its own commit).
- Not answered, so taking the defaults: every seed starts at the home field at the origin, and districts are 16 km.

Order: the seed box (small); generated airfields (step 5, brought forward: a registry whose first entry is today's
field, sited by the seed 15-40 km out, terrain flattening and approach protection per field, drawn on the map);
then growing seed 0's villages and roads out to the new fields (step 4). Generated rivers and provinces (step 3)
and the Cretaceous on top (step 6) wait.

## Where it stands (2026-10-30)

Done on this branch: the seed box, eight generated airfields per seed, seed 0 grown to 41 villages and roads to
every field, starting at a generated field, GPS direct-to and night lighting at the sealed fields.

Owner's choice: roads and villages stay at seed 0 only for now. Other seeds get their airfields but no roads or
villages. Running the road planner for any seed (about 12 s, in a worker while the world loads, cached per seed) is
parked; ATC and other traffic come first.

## Seeded terrain and drainage (2026-11-04, `feat/seeded-terrain`)

The owner saw that every seed shared the same river and hills (true: the river was byte-identical across seeds, the
four lakes fixed, and the coast, range and valley hand-shaped around the runway). Asked how far to go, the owner
chose the full drainage generator. What any seed but 0 now gets:

| Part | How | Where |
|---|---|---|
| Land and sea, mountain ranges, plains and hill country | broad seeded noise fields (continent 170 km, ridge-line ranges 75 km, country 38 km), turned and shifted per seed; the first of up to 160 candidate layouts that puts the field on dry lowland with a coast and a high range 15-80 km away wins | `seededLayout.ts` |
| Terrain | the same coastal profile, hills, mountains, gullies and small relief as seed 0, laid out by those fields; a level plain at field elevation round the home field, longer along the runway | `heightfield.ts` `seededNaturalHeight` |
| Drainage | 1 km lattice over +-160 km, priority flood from the sea and the edge, flow accumulation; channels from 45 km² of catchment; lines traced from each mouth, the biggest branch continuing | `drainage.ts` |
| Lakes | filled hollows 8 m deep or more and 2-80 km², as warped ellipses fitted to the hollow (bigger hollows are drained: their river cuts a gorge through the rim) | `drainage.ts`, `riverNetwork.ts` `networkLakes` |
| Rivers | courses wandered off the lattice and smoothed; width from catchment; sine-generated meanders (Kinoshita skew, wavelength ~18 widths) on big lowland rivers, a wiggle on streams; some of the widest loops cut off as oxbows; levels falling from the source, level through lakes, meeting the parent at the confluence; kept 2.5 km clear of the home runway | `riverNetwork.ts` |
| Carving and water | every valley, channel and oxbow near a point carved as seed 0's one river is; the river ribbon drawn for the whole network in 10 km chunks, broken where a river crosses a lake | `heightfield.ts` `carveNetwork`, `water.ts` |
| Cretaceous | the same network as the present day (the era's own river course is seed 0's) | `heightfield.ts` |

Seed 0 is untouched (present guard passes). `tests/terrain/seededWorld.test.ts` sweeps five seeds.

Cost: about 0.6-1.0 s per thread at load (drainage ~0.3 s, the river network the rest), in the main thread and
every terrain worker in parallel; a terrain sample costs the same as at seed 0. Page ready with the CPU throttled
4x (a slow laptop): seed 0 about 20 s, seed 42 about 24-26 s. The follow-up is to build the water once in a worker
and cache it per seed (IndexedDB), so the main thread and the other workers only load it.

Lakes: 36-39 per seed, each centred on its hollow and shrunk until its water stands at least 3 m over the natural
ground at its middle (a bigger ellipse reached over the rim and left the water in a pit).

Still open:

- **The drainage domain is bounded** (+-160 km): beyond it the terrain goes on but has no rivers, and catchments
  near its edge are short of their outer parts. The streamed provinces (step 3 above) remove the edge.
- **Meanders differ from seed 0's**, which were grown by the migration model and baked; seeded rivers use the
  sine-generated curve so nothing has to run for seconds at load.
- **The Flight School's route** (`training/content/syllabus/route.ts`) names seed 0's lakes and town at fixed
  places, which a seeded world does not have. Owner to decide: lessons always in seed 0, or a route per seed.
- Roads and villages remain seed 0 only (owner's choice); the town is still sited by `findTownSite`.
- The career's seed-7 golden boards change with the world (re-baked; seed 0's boards are unchanged).
