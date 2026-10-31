# Career

Design note for the post-licence flying career: a small air operator the player runs from the home field after
the skill test, flying passengers, freight, mail and scenic flights between the home field and the eight generated
airfields (docs/seeded-world.md) in the sim's real types. It sits beside the Flight School (docs/flight-school.md)
and reuses its telemetry, landing detection and grading without changing any of it. The typed contract every
package shares is `src/career/types.ts`; this document explains the numbers in it and how the pieces fit.

Revision 2 (2026-10-31) takes in the integration and gameplay reviews: the boot table, the resume block without a
payload copy, modal pages, completion only after flying, the fuel plan, station limits, fit-based eligibility, the
pay floor, game-scaled buying, precautionary stops, shorter progression, wind and a summer season.

## Decisions (lead, 2026-10-31)

- **Where it lives:** code in `src/career/` (pure core), `src/career/runtime/` (the job runtime, node-safe),
  `src/career/ui/` (DOM pages). It is not `src/training/career/`, which is the Flight School's pilot record. The
  save is its own key, `fs.career.v1`, behind the `KeyValueStore` interface; `cstore=mem` keeps it in memory (as
  `tstore=mem` does for the school), `cstore=session` in sessionStorage. Nothing writes to `fs.training.v1`.
- **Present day only.** The Career exists where the Flight School does (`era().world.school`); the menu hides it in
  the Cretaceous like the school row.
- **One world per career.** The save records the world seed. Another seed shows a seed page: switch the world back
  (`commands.setSeed`) or start a new career here. The board is refused until then.
- **Unlock:** the school's `ppl` endorsement (the L21 skill test passed: `save.endorsements.some(e => e.id === 'ppl')`),
  or "I already hold a licence" on the first open (the owner is a real pilot), or `unlock=1` (the school's existing
  parameter, not stored).
- **The Career is the truth for where aircraft are.** Each fleet aircraft has a field code. A job starts the player
  parked, cold, at its aircraft's field; after the job the aircraft stays where it stopped and the next board is
  from there.
- **Default paths are bit-identical.** Every hook is an optional field, argument or link that is absent outside
  the Career: goldens (1e-9), the present-day guard, the training store schema, `STANDARDS`, the trace format,
  `SCENARIO_IDS`, `SNAPSHOT_SCHEMA` and `src/sim/autoflight.ts` do not change. R22, R44, S269 and MD 500 handling
  must not regress (no physics is touched; Career loadings put the pilot where each type's own solo loading does).
- **Refinement of the vision (flagged):** a shutdown at a field that is not the destination is a *stop*, not at
  once a failed diversion. The job is held; the player can refuel and continue (the deadline keeps running) or give
  up. It becomes a failed diversion on Give up or at the end of the day. A crash still fails the job.

## What the player sees

**First open.** The Escape menu's Flight tab has a **Career** button beside **Open Flight School**. Without a
licence it opens a locked page: "Pass the skill test (lesson 21) to start a career", with **I already hold a
licence** under it. With one, a short form: pilot name (from the school profile when there is one), company name,
radio callsign word (default the first word of the company name), and the first aircraft: a leased **Cessna 152**
or a leased **Cessna 172S** (the 172S costs more an hour but carries three passengers). The career starts on day 1
at 08:00 at the home field with $5,000 and reputation 20.

**Hub.** A left card in the school's home-card style: company and pilot, rank, cash, reputation bar, the career
clock ("Day 3 · 10:40"), the selected aircraft ("G-CBKE · Cessna 152 at Elmley Aerodrome, 41 kg fuel"), then
Job board, Reposition, Fleet, Pilot, Logbook, Rest until tomorrow, and Free flight (Esc). A small right card shows
the job in progress or the last debrief. A job waiting for another type shows **Switch to <type>**. Opening any
Career page holds the sim and makes the UI modal (as school screens do: the radio keys, the checklist key, the HUD
and the flight cues stand down).

**Free flight** closes the Career pages. With a job active the job carries on (the strip stays; the menu's
Career button reopens the hub). With no job it leaves Career mode: the player's own weather comes back and the
start field becomes the aircraft's field (`setStartField(code)`, `null` at home), so Shift+R, the crash dialog's
Restart and a later reload start where the aircraft is.

**Job board.** The offers at the selected aircraft's field for today: a list and a map (north-up, the nine fields
as dots with codes, the route of the highlighted offer, scenic turning points). Each row: kind, title, client,
from and to, distance (NM), passengers or kg, pay, time allowed, least class, weather and wind, reputation needed.
Offers the player cannot take are greyed with the reason ("Needs reputation 25", "Needs a twin", "Too heavy for the
C152"). Taken offers disappear for the day. The first three offers of every board are trainer, trainer and tourer
jobs (or the cheapest class able to use that field), so a new player always has work. Selecting one opens dispatch.

**Dispatch.** Choose an aircraft from the fleet that stands here (others listed but disabled with where they are),
choose fuel (a slider in kg and litres from 0 to the most the load allows, with Required and Full buttons; below
what is aboard it defuels, credited at half price). The load sheet shows empty mass, pilot, each payload item and
its station, zero-fuel mass, fuel, take-off mass against MTOW, landing mass against MLW, the take-off CG against the
type's limits, trip, climb, taxi and reserve fuel, fuel to buy or drain and its cost or credit, the wind
components, estimated flight time and block hours, endurance, the deadline margin, the estimated landing fee,
aircraft hours cost and **estimated net**, and warnings (blocking ones disable Accept). **Accept** places the player
at the field's stand, cold and dark (the type's own `presets.cold`), with the payload in the mass model, the fuel in
the tanks, the GPS direct-to set to the destination, the COM the MIC is on set to the origin's frequency (active)
and the destination's (standby), and the job's weather, wind and time of day. If the chosen aircraft is another type
than the one loaded, the page reloads into that type first (the job waits in the save) and the placement happens
after the reload.

**Reposition** (hub): pick a field; an unpaid positioning job of the selected aircraft to it (fuel, fees and hours
at the company's cost). It is how a player gets an aircraft home or out of a field with no suitable work.

**In flight.** A job strip (top centre, where the lesson strip sits; lessons and jobs never run together):
destination (or the next scenic turning point, "2 of 3"), distance and bearing, ETA against time left, endurance and
the projected reserve at arrival, the wind, a comfort meter on passenger jobs, a distance-to-spot line for
helicopters near the stand, and one line of what to do next. The radio, ATC, traffic, instruments and the rest of
the sim behave as in free flight.

**Finishing.** Land at the destination, taxi clear of the runway, stop and shut the engine(s) down. With the
parking brake set the job completes after 3 s; without it, after 12 s ("chocks in"; after 5 s the strip says "Set
the parking brake (or wait) to finish"). Helicopters: land at the field or site and shut down (no brake). Parking on
the grass or a taxiway is fine; where exactly is a logbook remark only. Stopping on the runway is penalised but
still completes. Nothing completes before the aircraft has flown: a shutdown at the origin before take-off (a
magneto drop at the run-up) does nothing; restart, or Abandon. The debrief card then opens: outcome, the money lines
(base pay, on-time or late, landing, comfort, penalties, fuel, landing fee, aircraft hours, repairs), net,
reputation change with reasons, rank change, the landing and comfort scores, and the logbook line. Buttons: Job
board (from here), Hub.

**Stops.** Landing and shutting down at another field holds the job: the stop page offers **Refuel** (re-placed at
the stand, cold, with the fuel added; a fuel truck where the grade is not sold), **Continue** (carry on from here)
and **Give up** (a failed diversion: no pay, -4 reputation, the aircraft stays there). Rest until tomorrow with a
job still stopped gives it up.

**When it goes wrong.** Shutting down away from any field is an outlanding (recovery cost; the aircraft is moved to
the nearest field). A crash fails the job with the insurance excess and the aircraft out of service for two days at
the nearest field; the crash dialog offers Debrief and Career hub instead of Restart. Abandon is on the job strip
while on the ground at a field; airborne, the only way out is to land somewhere. Anything that would end a job from
outside the Career (Shift+R, a menu scenario, the aircraft chooser, the era or seed switch, a lesson) first asks
"Abandon the job?", as the menu does for a lesson; yes abandons it, no cancels.

**Bankruptcy.** Below the overdraft (-$5,000) the bankruptcy page offers "The bank sells your owned aircraft"
(each at its sale value; leases are kept) or "Start a new career". If no owned aircraft would lift the cash above
the overdraft, only the restart is offered.

## Data model (`src/career/types.ts`)

- `CareerSave` (key `fs.career.v1`, `format: 'fs-career'`, `schema: 1`): seed, pilot (name, licence source), company
  (name, callsign word), cash, reputation, `clockMin`, ratings, fleet, `selectedUid`, `inCareer`, `taken` offer ids,
  `active: ActiveJob | null`, `lastSettlement`, `logbook: CareerLogEntry[]`, `flightNo`, `ownNo`, settings.
  Validation rebuilds the save field by field (as the school's `validateTrainingSave`): an invalid entity is
  dropped, an invalid top level rejects the file and falls back to `.prev`.
- `FleetAircraft`: uid, type, tenure (owned or leased), registration, field code, fuel kg, hours, groundedUntilDay.
  Registrations are per airframe, `registrationFor(uid, authority)` in `src/career/registration.ts`: EASA `G-` and
  four letters, FAA `N` three digits and two letters, from a hash of the uid. Authority from the school's settings,
  default EASA. The radio uses the same registration from wave 3 on (see Integration).
- `JobOffer`: a pure function of (world seed, career day, origin field). Its payload is `OfferItem`s with no
  station; the dispatch assigns stations for the chosen type (`assignStations`, below), so a bigger type takes the
  same offer with its own seating. `refType` is the smallest type of `minClass` the load fits.
- `ActiveJob`: the offer, aircraft uid and type, fuel, the placed `LoadingRequest` (null until placed; the only
  copy of the payload), items with stations, phase, `placed`, accepted time, `elapsedBaseS` and `elapsedS`, last
  known position (kept every 5 s, the fallback if no snapshot resumes), `everAirborne`, `stoppedAt`,
  `playerWeather` (restored on Free flight with no job, or at the job's end, also after a reload), `pendingReport`
  (a crash or outlanding waiting for the player's Debrief or Hub choice).
- `LoadSheet`, `JobFlightReport` (what the runtime hands over), `Settlement` (the debrief model),
  `CareerLogEntry` (hours by class are derived from it, never stored).
- `CareerResumeBlock`: `{ v, jobId, aircraftUid, monitor }`, no payload.
- `CareerBootPlan`, `CareerBootAction`: the boot table below.
- `CareerCommand`, `CareerPage`, `JobStripModel`, `CareerMenuLink`, `CareerModalLink`: the UI contract.
- `CareerPerf`: one row per type in `src/career/perf.ts`.

### Types and the performance table (`src/career/perf.ts`)

perf.ts holds literal numbers and imports no aircraft module (each type is a lazy chunk, registry.ts; the Career
reaches the main bundle through Simulator, so an import here would pull every type in). `tests/career/perf.test.ts`
loads each definition and proves the mass, fuel, station and CG columns equal it. Cruise TAS and fuel flow are
planning figures at a 2,000 ft planning height, calibrated against the sim by `tests/career/perfCalibration.test.ts`
(slow): each type flown at cruise power at 2,500 ft for 3 min must burn `fuelFlowKgH` and reach `cruiseTasKt` within
10 %. The helicopters' TAS is the definition's `vcruise` plus 2 % per 1,000 ft at 2,000 ft. Every planning TAS is
below Vno at the planning height (tested). Money is game data. Passenger seats exclude the pilot.

| type | class | ICAO | pax | empty kg | MTOW | usable fuel kg | fuel | TAS kt | kg/h | demo xwind kt | min rwy m | grass | list $ | buy-in $ | owned $/h | lease $/h | lease rep |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| c152 | trainer | C152 | 1 | 515 | 757 | 66.7 | avgas | 100 | 17 | 12 | 450 | yes | 45,000 | 3,000 | 55 | 120 | 0 |
| pa38 | trainer | PA38 | 1 | 530 | 757 | 81.6 | avgas | 100 | 18 | 15 | 450 | yes | 42,000 | 2,500 | 55 | 115 | 0 |
| da20 | trainer | DV20 | 1 | 535 | 800 | 65.4 | avgas | 110 | 16 | 20 | 450 | yes | 95,000 | 3,500 | 60 | 135 | 5 |
| c172s | tourer | C172 | 3 | 754 | 1157 | 144 | avgas | 120 | 27 | 15 | 500 | yes | 220,000 | 4,500 | 85 | 190 | 0 |
| pa34 | twin | PA34 | 5 | 1293 | 1905 | 253 | avgas | 165 | 60 | 17 | 900 | no | 260,000 | 9,500 | 210 | 420 | 30 |
| c208 | turbine | C208 | 9 | 2087 | 3629 | 1009 | jetA1 | 160 | 165 | 20 | 650 | yes | 2,000,000 | 28,500 | 520 | 1,150 | 50 |
| pc12 | turbine | PC12 | 9 | 2800 | 4740 | 1218 | jetA1 | 230 | 280 | 25 | 800 | yes | 4,200,000 | 45,000 | 700 | 1,700 | 60 |
| r22 | heli | R22 | 1 | 399 | 621 | 71.6 | avgas | 83 | 26 | - | 0 | yes | 330,000 | 6,500 | 160 | 300 | 0 |
| s269 | heli | H269 | 1 | 501 | 794 | 88.5 | avgas | 73 | 30 | - | 0 | yes | 300,000 | 6,000 | 160 | 290 | 0 |
| r44 | heli | R44 | 3 | 685 | 1134 | 126.6 | avgas | 104 | 42 | - | 0 | yes | 520,000 | 11,000 | 240 | 480 | 20 |
| md500 | heliTurbine | H500 | 4 | 685 | 1361 | 191.4 | jetA1 | 125 | 95 | - | 0 | yes | 1,300,000 | 19,500 | 420 | 850 | 40 |
| bo105 | heliTurbine | B105 | 4 | 1276 | 2500 | 456 | jetA1 | 104 | 185 | - | 0 | yes | 1,700,000 | 29,500 | 650 | 1,300 | 50 |

The ICAO codes and MLW are the definitions' (perf.test); `deliveryFuelKg` is half the usable fuel (the
definitions' loadings carry no fuel figure). The flows and the C208/PC-12 speeds are
provisional until the calibration test pins them (low-level turboprop flow is far above the FL250 book figure; the
C208 plans at 160 kt TAS, about 153 KIAS at 2,000 ft against Vmo 175; the PC-12 at 230 kt TAS, about 221 KIAS
against Vmo 236).

**Buying is game-scaled.** Real prices against real hourly savings would take 700 to 3,000 h to pay back. The
market shows the list price; buying costs the **buy-in** (a deposit on finance, about 45 h of the lease-minus-owned
saving), and `ownedHourly` includes the finance. Selling returns 75 % of the buy-in. A lease costs a sign-on fee of
5 h and at least 1 h of lease a day (charged at the day change, less the hours it flew that day), so a fleet of idle
leases costs something and owning pays back in 30 to 50 block hours.

**Station limits** (`stationMaxKg`, each cited from the POH in perf.ts; provisional values here, 1a confirms them):

| type | front (beside pilot) | rear | cabin | baggage | cargo |
|---|---|---|---|---|---|
| c152 | 110 | - | - | 54 (120 lb, areas 1 + 2) | - |
| pa38 | 110 | - | - | 45 (100 lb) | - |
| da20 | 110 | - | - | 20 (44 lb) | - |
| c172s | 110 | 220 | - | 54 (120 lb combined A + B) | - |
| pa34 | 110 | - | 440 | 90 (fwd + aft, 100 lb each) | - |
| c208 | 110 | - | 990 | - | 450 (pod) |
| pc12 | 110 | - | 990 | - | 180 (aft area) |
| r22 | 109 (240 lb seat) | - | - | 23 (under-seat) | - |
| s269 | 110 | - | - | 45 | - |
| r44 | 136 (300 lb seat) | 272 | - | 45 (under-seat) | - |
| md500 | 110 | - | 300 | 45 | - |
| bo105 | 110 | - | 330 | - | 250 (clamshell) |

**Stations and positions** (`src/career/stations.ts`, 1a): `CAREER_STATIONS: Record<CareerAircraftId, { pilot: Vec3;
stations: Partial<Record<Station, Vec3>> }>`, literal body-axis positions, proved equal in `stations.test.ts` to the
type's own data: the pilot at the position of the type's solo or inertia loading (`R22_SOLO`, `R44_SOLO` (seat 1, the
right seat), `S269_SOLO` (`PILOT_SEAT`), `MD500_SOLO`, the Bo 105's `bo105Payload` seat 1, the aeroplanes' left front
seat from systems.ts), each other station from the type's seat helpers or systems.ts. `assignStations(items, type)`:
passengers front, then rear, then cabin; bags baggage, then cargo, then a free seat; freight and mail baggage, then
cargo, then free seats; each up to `stationMaxKg`; returns the items with stations or the first item that does not
fit (`seats` / `stationLimit`). `cgOf(type, items, fuelKg)`: take-off CG from `cg.emptyX`, the stations and the tanks'
fuel position; `cg.fwdX`/`aftX` are the CGs of the type's own `forward`/`aft` loadings (proved in perf.test).

### Loading (`src/career/loading.ts`)

`loadingFor(type, items): LoadingRequest` builds the payload the flight model takes (`fm.setLoading`): the pilot
(77 kg, `OCCUPANT_KG`) at `CAREER_STATIONS[type].pilot` plus every item at its station's position, with a
`payloadDistribution` of one point per item (fractions sum to one, weighted offsets zero, as `PayloadDistribution`
requires). It reads only `CAREER_STATIONS` (no aircraft import). It is built for the booted type at placement, after
any type-switch reload, and stored in `active.loading`. `tests/career/loading.test.ts` proves a pilot-only loading
equals `R22_SOLO`, `R44_SOLO`, `S269_SOLO` and `MD500_SOLO` (mass and position, 1e-9), and for every type and a
light, typical and full load, the mass sums and the CG lies between the type's own `forward` and `aft` loadings
(2 cm tolerance) or the load sheet reports `cg`. The C208's empty mass excludes its crew (c208/systems.ts carries
`CREW = 154` as payload), so one pilot is added, not two.

Fuel at the start is `ic.fuelFraction = fuelKg / usableFuelKg`, the same fraction in every tank (per-tank fuel is a
later stage).

## The career clock

No epoch exists in the sim and `physics.time` restarts at 0 on every start, so the Career keeps its own clock,
`clockMin` (minutes since day 0 00:00; day = floor(clockMin / 1440)). A new career starts on day 1 at 08:00. A job
advances the clock by its elapsed sim minutes plus 30 min turnaround. Departures only between 07:00 and 18:00; after
18:00 the board says "Rest until tomorrow", which sets the clock to 07:30 the next day (also a hub button at any
time; it settles a stopped job as diverted and charges idle leases). A job's flight takes place at the career
clock's time of day on day of year `152 + (day mod 90)`: the season is held to June to August, so an 18:00
departure still lands in daylight at the world's latitude (grass strips are unlit).

**Job time** is `elapsedBaseS + (physics.time - t0)`, t0 the `physics.time` at the job's latest placement (0 after
`startFrom`'s `resetTo`; `restore` brings `physics.time` back on a resumed reload). It does not move while held or
paused, and it is exact under time acceleration and `run=` fast-forward, so it never cheats the deadline. The job
monitor's detectors take the frame's simulated time (the shell's `frameSimDt()`: `physics.lastAdvance` normally,
the whole `simulated` sum under `run=`), not `subsystemDt`, which `run=` clamps to 0.1 s.

## Job generation (`src/career/jobs.ts`)

`boardFor(seed, day, origin, fields): JobOffer[]`, deterministic: a `mulberry32` stream (src/physics/weather/random.ts
idiom, `src/career/rng.ts`) seeded with FNV-1a of `${seed}|${day}|${origin}`, its own stream (never airfieldSiting's,
never `Math.random`). Generation does not depend on the player (reputation, fleet): an offer the player cannot take
is shown locked. Wave-4 kinds (medevac, utility, landmark scenics) come from a second stream salted `|w4` and are
appended after the base offers with ids `${day}-${origin}-w${i}`, so adding them never changes a base offer or the
meaning of an id in `taken`.

- **Count:** 6 + floor(r x 4) offers. Slots 0, 1 and 2 have fixed least classes (trainer, trainer, tourer; where the
  field cannot take that class, the cheapest class that can); the rest are drawn.
- **Kind** by weight: charter 0.30, freight 0.25, mail 0.15, scenic 0.15, positioning 0.15. At most one mail run
  per board.
- **Least class** (drawn slots) by weight (trainer 0.32, tourer 0.30, twin 0.12, turbine 0.10, heli 0.10,
  heliTurbine 0.06), renormalised over the classes that some type of the class can use at both ends (runway length
  >= `minRunwayM`, grass only if `grassOk`; at seed 0 the twin cannot use the grass strips). Scenic flights are never
  twin.
- **Premium:** 20 % of the drawn slots are a regular client's job: reputation 60 (or 80) needed, pay x 1.15 (x 1.3).
  This is what reputation above about 40 buys.
- **Destination:** any other field (home and the eight generated), uniformly; positioning prefers fields 25 NM or
  more away. Scenic flights are round trips through 2 or 3 turning points making a 15 to 35 NM loop, each point at
  least 2 NM from every field (clear of the ATZs and the AI circuits), captured within 1,500 m below 2,500 ft AGL,
  named by bearing and distance from the origin ("Point B, 7 NM north-east"); wave 4 adds landmark scenics on the
  `|w4` stream.
- **Payload by kind and class** (kg; passengers 77 kg each, each with a bag of 5 to 15 kg, trainers 0 to 10 kg):

  | kind | trainer | tourer | twin | turbine | heli | heliTurbine |
  |---|---|---|---|---|---|---|
  | charter pax | 1 | 1-3 | 2-5 | 4-9 | 1-3 | 2-4 |
  | freight kg | 20-70 | 60-200 | 150-400 | 300-900 | 30-90 | 80-300 |
  | mail kg | 15-45 | 30-90 | 60-180 | 100-300 | 15-45 | 30-120 |
  | scenic pax | 1 | 1-3 | - | 4-9 | 1-2 | 2-4 |
  | positioning | none | none | none | none | none | none |

  Trainer freight sits in the baggage bay and on the right seat; tourer freight over the baggage limit goes on the
  rear seats; helicopter freight in the R22 and S269 goes on the free seat. `refType` is the smallest type of the
  class the offer fits (seats, station limits, MTOW with required fuel, runways at both ends); a heli charter of 2-3
  passengers has `refType` r44, so the R44 has work the R22 cannot take. `tests/career/jobs.test.ts` proves, for
  every offer on 200 boards at seeds 0 and 7, that it fits its `refType` and that every type of its class either
  takes it with an ok load sheet at required fuel or is refused only by `seats`, `stationLimit`, `overMtow`,
  `runwayShort` or `grass`. Fit is one function, `fitOffer` in `src/career/fit.ts` (1a), which jobs.ts and
  loadsheet.ts both call.
- **Eligibility** is by fit: an aircraft may take an offer when its class is `minClass` or later in the same order
  (fixed wing or rotorcraft) and the load sheet has no blocking code. `minClass` sets the pay and the reputation.
- **Pay:** round to $5 of max(formula, floor x `floorPremium`). Formula: (base + perNm x d + perPax x pax + perKg x
  cargo kg) x class mult x weather mult x premium mult, with `PAY_RULES` (charter 90 + 8/NM + 30/pax; freight 70 +
  6/NM + 0.8/kg; mail 80 + 7/NM + 1.5/kg; scenic 120 + 6/NM + 45/pax; positioning 50 + 4/NM), class mult (trainer
  1.0, tourer 1.3, twin 2.0, turbine 3.2, heli 2.0, heliTurbine 3.0) and weather mult (clear and fair 1.0, overcast
  1.1, drizzle 1.15, gusty and rain 1.25). Floor: 1.3 x (`refType`'s estimated block hours x its lease rate + its trip,
  climb and taxi fuel cost), with `floorPremium` charter 1.15, freight 1.1, mail 1.1, scenic 1.2, positioning 1.0. So
  every offer pays its reference type's costs with a margin; short turbine and twin hops are no longer loss makers.
  Trip length dominates trainer pay (the $8/NM term); passenger count adds little ($30 each). That is intended: the
  bigger classes earn through the class multiplier and the floor.
  Example: a trainer charter, 1 passenger, 20 NM, clear: 90 + 160 + 30 = $280 (floor: 1.3 x (0.78 h x $120 + $25) x
  1.15 = $178).
- **Deadline:** round up to 5 min of (taxiMin + 60 d / gs x slack + 5). `taxiMin` by class (pistons and helicopters
  25, turbines 30). gs = refTas (trainer 95, tourer 110, twin 150, turbine 155, heli 72, heliTurbine 100 kt) less the
  headwind component of the job's wind along the route (a loop: less half the wind speed), at least half refTas.
  Slack by kind (charter 1.5, freight 1.8, mail 1.25, scenic 1.6, positioning 2.5). Example: the 20 NM trainer charter
  in calm air allows 25 + 18.9 + 5 -> 50 min.
- **Weather and wind:** a preset id by weight (clear 0.30, fair 0.30, overcast 0.15, gusty 0.10, drizzle 0.08, rain
  0.07), then a wind direction (0-359) and speed from the preset's range (clear 0-6, fair 4-12, overcast 6-16, gusty
  12-20, drizzle 5-14, rain 8-18 kt), which override the preset's wind when the job is flown. Low IFR, fog, snow and
  thunderstorm are not offered until an instrument rating exists.
- **Reputation needed:** the class's (trainer 0, tourer 5, twin 25, turbine 40, heli 15, heliTurbine 35) plus the
  kind's (scenic 5, medevac 10), or the premium figure.
- **Client and title:** from small word lists in jobs.ts ("Holthurst Joinery", "2 passengers to Holthurst").

## Dispatch and the load sheet (`src/career/loadsheet.ts`, costs in `src/career/costs.ts`)

`loadSheet(offer, aircraft, fuelKg, save, fields): LoadSheet`, pure. Trip fuel = d / gs x flow (gs: cruise TAS less
the headwind); climb = 5 min of flow; taxi = 6 min of flow; reserve = 30 min of flow (helicopters 20); required =
1.1 x trip + climb + taxi + reserve. Flight time = d / gs + 10 min; block hours = flight time + the class's taxi
allowance. Landing mass = take-off less trip, climb and taxi fuel. Uplift = fuel wanted less fuel in the tanks (not
below 0); defuel = the reverse, credited at 50 % of its price. Fuel cost = uplift kg / density x price per litre
(avgas $2.60/L, Jet A-1 $1.95/L; grass strips avgas only, +10 %; a grade the field does not sell comes by fuel truck,
+50 %). Estimates: landing fee at the destination, hours cost (block hours x owned or lease rate), net = pay - fuel
cost + defuel credit - fee - hours cost.

Blocking: `notHere`, `grounded`, `rating`, `class` (type's class below the least class, or helicopter for an
aeroplane job and the reverse: `heliOnly`, `fixedWingOnly`), `reputation`, `seats`, `stationLimit`,
`overMtow`, `fuelShort` (below required), `fuelOverCapacity`, `runwayShort` or `grass` at either end, `lateInDay`
(after 18:00), `cash` (cannot pay for the fuel beyond the overdraft). Warnings: `cg` (take-off CG outside the forward/aft figures: those are the definition's own example loadings, not
the POH envelope, so it warns rather than blocks until an envelope is cited), `overMlw` (landing mass above MLW),
`deadlineTight` (margin under 5 min), `weather` (gusty or rain in a trainer), `crosswind` (the crosswind component at
either end above the type's demonstrated figure), `fuelTruck` (the surcharge applies), `losesMoney` (estimated net
below 0, possible only with a bigger type than `refType`).

## Placement (`src/career/placement.ts`)

`jobScenario(job, def, env): Scenario`: `setStartField(origin)` (null for the home field), then
`buildScenario('apron', env, def)`: the same stand the menu's "Parked" uses (home: `PARKING`; sealed field:
`(apronAlong, w + 43)`; grass: `(apronAlong + 30, w + 16)`, facing the runway), cold and dark with the type's
`presets.cold`. Then `{ ...sc, title: 'Elmley Aerodrome (KELM), job 3-KELM-2', loading, ic: { ...sc.ic,
fuelFraction } }`. The scenario id stays `'apron'`, so snapshots validate and `snap.field` restores the field.
Helicopters use the same stands (as the free-flight apron start does today); the stand is the helicopter's spot.
The Career runs it through `commands.startFrom(sc, { lessonId: 'career:<jobId>', label: 'Loading job' })` (curtain,
`resetTo`, a 'reset' event carrying that lessonId; no listener reads lessonId). A refuel at a stop is the same at
the stop field, with `elapsedBaseS` carried.

After the curtain: `setGpsTarget(destination)`; `setCom(mic, [origin MHz, destination MHz])` (home origin: the ground
frequency; home destination: the tower); the job's weather by the Flight School's pattern (`active.playerWeather` is
kept in the save; `restoreWeather(weather, preset settings)`, the offer's wind, then `timeOfDay`/`dayOfYear` from the
clock, emit `weatherChanged`); the player's weather comes back on Free flight with no job or at the job's end, also
after a reload. After a resumed reload the snapshot brings back the weather and the radios, but not the GPS target
(module state, never persisted), so the CareerSystem sets it again. When a job ends or the player leaves Career
mode, `setStartField` is set to the aircraft's field (null at home).

## The job runtime (`src/career/runtime/`)

Node-safe, three.js-free, tested headless. `JobMonitor` is built on job start and disposed on job end:

```ts
const tel = new Telemetry([createCoreProvider(), createFieldGeoProvider(() => dest), createPowerplantProvider()]);
const bus = new TrainingBus();
const det = new DerivedEventDetector(bus);
const land = new LandingDetector(bus);
const timer = new FlightTimer(false);
events.on('touchdown', (e) => land.onTouchdown(fieldTouchdownData(fm.state, e.wheel, e.sinkRate / FPM, dest, def), simT));
events.on('crash', (e) => end('crashed', e.reason));   // records active.pendingReport; settlement waits for the player
events.on('reset', (e) => { if (!e.lessonId?.startsWith('career:')) end('abandoned'); });
// per frame, dt = shell.frameSimDt() (0 while held): sample, detectors, timer, comfort, completion
```

- **Field geometry** (`fieldGeo.ts`): `createFieldGeoProvider(getField)` emits the same signal ids as the school's
  geo provider (`rwyAlongM`, `rwyAcrossM`, `distAimFt`, `gpDevFt`, `onRunway`, `onPaved`, ...) relative to the
  destination field and the landing end (chosen from heading against `f.heading`), with the aim point at
  min(150 m, 0.15 x length). The school's provider is HOME 07 only and is not touched; providers cannot be
  overridden, so the monitor builds its Telemetry from this list instead of the defaults.
  `fieldTouchdownData(state, wheel, sinkFpm, field, def)` replaces `touchdownData` (which assumes the C172's main gear
  and runway 07) using the type's own main-gear offset (`def.geometry.gear`). Then `LandingDetector`,
  `gradeLanding` and the school's scoring work unchanged.
- **Landing score** (`landingScore.ts`, `LANDING_SCORE_RULES`), 0..100, the last full-stop landing before
  completion: aeroplanes: 25 centreline (0 at 10 m) + 35 sink (full to 300 fpm, 0 at 700) + 20 zone + 10 drift (0 at
  10 deg) + 10 bounce (0 if any bounce above 1 ft); 0 if crashed, off the runway or nose first. Zone: sealed and 900 m
  or longer, full from the aim point to +400 ft, 0 at 200 ft outside; grass or shorter than 900 m (no aim markings,
  short-field technique), full from threshold + 15 m to the end of the first third, 0 at the threshold and at half
  length. Helicopters (skids report one 'left' touchdown; `kiasAt50Ft` means nothing): 50 sink (full to 200 fpm, 0
  at 500) + 15 bank at contact (0 at 10 deg) + 15 ground speed at contact (full to 2 kt, 0 at 10 kt) + 20 distance
  from the spot (the stand, or the site; full within 15 m, 0 at 100 m). The stand has no painted H yet, so the strip
  shows the distance to the spot near the destination. The `gradeLanding` rows with `standard: 'commercial'` are
  kept for the debrief's detail text (fixed wing only).
- **Comfort** (`comfort.ts`, `COMFORT_RULES`), counted airborne or above 30 kt on the ground: nz = -specificForce.z and
  ny = specificForce.y low-passed at 1 s. Points per second: |nz - 1| above 0.25 g 1.5, above 0.5 g 5, divided by
  (1 + 2 x weather.turbulence) so a rough day is not all the pilot's fault; |ny| above 0.12 g 1, above 0.25 g 3;
  bank above 30 deg 0.5, above 45 deg 3; pitch above +15 or below -10 deg 1; descent above 1,000 fpm held 5 s 0.3
  (unpressurised types); stall warning 3, only above 50 ft AGL and outside the landing flare (a well-flared trainer
  landing sounds the horn; that costs nothing). Helicopters: the low rotor RPM horn where the type has one, else no
  stall deduction. Landing: (sink - 360 fpm) / 15 points, and 5 per bounce. Score = 100 less the sum, clamped; the
  meter on the strip shows the running score.
- **Penalty accumulators:** seconds above `def.reference.vne`; max and min `gLoad` airborne; stall warning seconds
  (same gate as comfort).
- **Completion** (`completion.ts`, `COMPLETION_RULES`). Nothing is decided until `everAirborne` and the phase is
  `landed`; a shutdown before take-off does nothing. Inside a field means |along| <= length/2 + 200 m and |across|
  <= 250 m in that field's frame. Done when on the ground, ground speed under 0.5 m/s, every engine stopped, and
  either (aeroplanes) the parking brake set for 3 s, or no brake for 12 s (helicopters: 3 s, no brake): at the
  destination -> completed; at another field -> the job stops (phase `stopped`, `stoppedAt`); at no field for 10 s
  -> outlanded. Helicopters at a site (wave 4): within 60 m of the spot, on the ground 30 s (load or unload, idle
  allowed) to complete that leg. `onApron` (a logbook remark only): sealed `|along - apronAlong| <= 40` and across in
  `[w + 20, w + 65]`; grass within 60 m of the stand; home inside `APRON_RECT` or within 40 m of a `PARKING_SPOTS`
  stand (the home field's `apronAlong` is a dummy 0). The helicopter spot at home is `PARKING`. Stopped on the runway:
  penalised, still completed.
- **Phases:** dispatched -> ground (an engine started) -> airborne (the detector's liftoff, or 3 s with no wheel on
  the ground above 15 ft AGL: the liftoff detector needs throttle >= 0.5, which helicopters do not use) -> landed ->
  done, or landed -> stopped -> (Continue) ground -> airborne.
- `exportState()` / `restoreState(unknown)`: the accumulators, phase, timer, t0, the current landing; goes in the
  resume block; malformed -> a fresh monitor with the store's `elapsedS`.
- `report(): JobFlightReport`, `strip(): JobStripModel` parts (`projectedReserveMin` = (fuel now - burn to the
  destination at the present flow and ETA) / cruise flow).

## Settlement (`src/career/economy.ts`)

`settleJob(save, job, report, fields): { save, settlement }`, pure. Base = offer pay x (1 + rank pay bonus).

Completed:
- Scenic: base x done / total turning points (the 'route' line), -1 reputation per point missed; none overflown
  settles as `routeMissed` (failed: no pay, -4).
- On time (elapsed <= deadline): +10 % of base; within 80 % of the deadline: a further +5 %. Late: -2 % per minute,
  at most -60 %.
- Landing: +10 % x (score - 60) / 40 from 60 up. A hard landing (sink above 600 fpm, helicopters 400) costs
  reputation (-2) and the landing and comfort points, but no pay line; a heavy landing (above 900, helicopters 600)
  also costs an inspection of $500 x class mult.
- Comfort (charter weight 0.15, scenic 0.30, medevac 0.10; others none): above 70 a bonus of weight x (score - 70) / 30
  of base; below 70 a penalty of weight x (70 - score) / 70.
- Overspeed: $40 per second above Vne x class mult, at most $2,000. High g (above 3.0 on passenger jobs, 3.5
  otherwise, or below 0): inspection $300 x class mult.
- Fuel at shutdown below the planning reserve less 10 min (aeroplanes 20 min, helicopters 10 min of cruise flow):
  -10 %, -2 reputation; below a third of the reserve (10 / 7 min): -25 %, -5.
- Stopped on the runway: -5 %.
- Costs on every outcome: fuel bought at dispatch and at stops, less defuel credit, the destination's (or stop's)
  landing fee (home $20 + $8/t MTOW; sealed $12 + $5/t; grass $5), aircraft hours (block hours x owned or lease
  rate).

Failed:
- Diverted (given up at a stop, or still stopped at the day's end): no pay; fees and hours still due; the aircraft is
  at the stop field.
- Outlanded: no pay; recovery $1,500 x class mult; the aircraft moves to the nearest field.
- Crashed: no pay; the insurance excess, owned or leased: 5 % of list price, at least $2,000, at most $25,000; out
  of service 2 days at the nearest field.
- Abandoned: on the ground, fuel already bought is not refunded (it stays in the tanks); after take-off (only via a
  confirmed foreign reset) as lost.
- Lost (no snapshot resumes a flight that had left the ground): recovery $300 x class mult; nearest field to the last
  known position.

Reputation (`REP_RULES`, summed then clamped 0..100): completed +2 (positioning +1, medevac +4); late -1, more than
10 min late -3 (one rule for every kind; mail's tighter slack is its strictness); landing score 85 or more +1; hard
landing -2; comfort 90 or more +1, under 50 -2; overspeed -3; high g -3; reserve low -2, critical -5; runway stop -1;
turning point missed -1, route missed -4; diverted -4; outlanded -8; crashed -20; abandoned on the ground -2, after
take-off -5; lost -5.

Every money line is rounded to whole dollars. Worked example (pinned in tests/career/economy.test.ts): the $280 C152
charter (50 min allowed) to a sealed field by a junior pilot, completed in 38 min with 0.6 block hours, landing score
72, comfort 84, 12 kg of avgas bought at dispatch, 22 kg left at shutdown (78 min of flow): base 280; on time +28;
early +14 (38 min is within 80 % of 50); landing 280 x 0.10 x 12/40 = +8; comfort 280 x 0.15 x 14/30 = +20; fuel 12 /
0.719 L x $2.60 = -43; landing fee 12 + 5 x 0.757 t = -16; lease 0.6 h x $120 = -72. Net $219, reputation +2.

Cash may go negative to -$5,000 (fuel and fees are still paid); below 0 nothing can be bought or leased; below
-$5,000 the bankruptcy page opens. The settled job adds a logbook line, moves the aircraft, updates its fuel and
hours, advances the clock, sets the start field, and clears `active`.

**Ordering at a crash.** The UI's `crashActions` chain (registered at `ui.init`, Career first, then the school's)
runs before the monitor's `end('crashed')`; the Career's link answers from `active` (still set) and offers Debrief
and Career hub. `end('crashed')` only records `active.pendingReport` and saves; settlement happens when the player
picks Debrief or Hub (`settlePending`), or at the next boot, so two modals never open together and nothing depends
on listener order beyond "Career's crashActions before school's".

## Progression (`src/career/progression.ts`)

A job is about 0.6 block hours and 35-45 min of real time (cold start included), about 1.5 jobs an hour of play.
The gates aim at a first new type in session 2-3 and a twin or helicopter by session 5-8.

- **Ranks** (`RANKS`, career **block** hours and reputation both): Junior pilot (0 h, 0); Line pilot (2 h, 30, +3 %
  pay); Senior pilot (8 h, 45, +6 %); Captain (20 h, 60, +10 %); Chief pilot (40 h, 75, +15 %).
- **Ratings** (`RATINGS`), bought as training on the Pilot page, effective at once with a logbook line:
  single-engine piston (held), multi-engine $4,500 (3 h, rep 20), turbine and high performance $12,000 (8 h, rep 35),
  helicopter $9,000 (2 h, rep 15). (A check ride per rating is a later stage.)
- **Fleet:** at most 6 aircraft. Lease: the type's ratings held, reputation >= its lease rep, a sign-on fee of 5 hours'
  lease, the daily idle charge; delivered to the home field with `deliveryFuelKg` (half tanks). Buy: the buy-in in cash; delivered
  to the home field with `deliveryFuelKg`. Sell (owned): 75 % of the buy-in, wherever it stands. Return a lease: free,
  anywhere. Defuel any aircraft not on a job (50 % credit). An aircraft with an active job cannot be sold, returned or
  defuelled. The selected aircraft decides "here".
- **Hours by class** for the Pilot page come from the logbook: block and airborne per `AircraftClass`, plus totals,
  landings day and night, and jobs done and failed by kind.

## Persistence, boot and reloads

**Store** (`src/career/store.ts`): `CareerStore` modelled on `TrainingStore`: guarded KV (every access in
try/catch), verified write (copy to `.prev`, write, read back), `kind: CareerStoreKind`, `status: 'ok' | 'memoryOnly'
| 'readOnly'`, `load()` (parse, migrate with a backup, validate, fall back to `.prev`), `create(...)`, `save` (sync),
`saveSoon` (500 ms), `flush`, `reset`, export and import JSON (`format: 'fs-career'`). `cstore=mem` uses the school's
`memoryStore()`; `cstore=session` uses `sessionStorage` (guarded like `browserStore()`), for browser checks that
switch type. Loading is cheap and synchronous, so the Simulator loads the store before `decideBoot`.

**Saves that cannot wait.** Accept, abandon, give up, stop, settle and `settlePending` call `store.save()` at once
and then the shell's `persist()` (the snapshot without a block or with the new one). `setAircraft`, `setSeed`,
`setEra` and the pagehide/beforeunload handlers flush the career store as well as the snapshot.

**Snapshot block.** `FlightSnapshot` gets an optional opaque `career?: unknown` beside `training`, written in
`Simulator.persist()` from `career.resumeBlock()`, which returns null unless the store kind is `'local'`, `active` is
`placed`, and the job's type is the booted type (so `setAircraft`'s `persist()` before a type switch never writes
the block into the old type's snapshot). Absent otherwise: present snapshots stay byte-identical. `validateSnapshot`
deletes a null block (as for training). `decideBoot` gets one line after the training one: `if (snap.career !==
undefined) return { kind: 'resume', snapshot: snap, ageMs }` (only reached when the block survived the plan below).
On resume the shell calls `physics.restore(snap, store.active.loading)`: restore's new optional argument stages
`fm.setLoading(loading)` before its `fm.reset` (restore never applies a loading today). The CareerSystem then restores
the monitor and re-applies the GPS target.

**Snapshots while a job is placed.** `saving` is also true while a placed job is active (unless `resume=0`), so the
resume preference being off never loses a job; without a Career, `saving` is unchanged.

**Boot plan** (`src/career/boot.ts` `careerBootPlan(save, snap, bootType, url, storeKind): CareerBootPlan`, pure).
X = an explicit start in the URL: `scenario=`, `lesson=`, `demo=`, `hover=` on a helicopter, or `career=0`. The
Simulator applies the plan before `decideBoot`, then passes `param` (`resumeParam ?? p.resume`) and, to
`training.afterBoot`, `explicitScenario: p.explicitScenario || trainingExplicit`.

| career store | snapshot block | URL | deleteBlock | resumeParam | trainingExplicit | action |
|---|---|---|---|---|---|---|
| none, or Career unavailable (era) | any | any | yes if present | null | no | none (default path) |
| any, store kind not 'local' | any | any | yes | (per rows below) | (per rows) | (per rows) |
| any | any | X | yes | null | no | none; a placed job not resumed is handled at the next Career open (never airborne: back to unplaced; airborne: lost) |
| placed job, booted type | matches `active.offer.id` | no X | no | true (null if `resume=0`) | yes | resume; if nothing resumed: never airborne -> re-place, airborne -> lost |
| placed job, booted type | missing or other id | no X | yes | false | yes | resume fallback at once (re-place or lost) |
| placed job, other type | any | no X | yes | null | if `career=1` | hub if `career=1`; if airborne, settled lost at this boot; else shown waiting ("Switch to <type>") |
| unplaced job, booted type | any | no X | yes | false (ignore this type's stale snapshot and its lesson) | yes | place (after `training.afterBoot`) |
| unplaced job, other type | any | no X | yes | null | if `career=1` | hub if `career=1`, else none |
| in Career, no job, selected type booted | any | no X | yes | null | yes | placeSelected (nothing if the boot resumed) |
| in Career, no job, other type; or not in Career | any | no X | yes | null | if `career=1` | hub if `career=1`, else none |

`tests/career/boot.test.ts` pins every row, including: a `cstore=mem` run never resumes a job from the local
snapshot; a reload within 1 s of a settlement does not resume the finished job; "Start a new career" and an import
do not resume the old job; an unplaced job for this type is not overrun by this type's stale lesson snapshot.

**Type switch.** On Accept with another type the store holds `active` with `placed: false` and `loading: null` and is
saved, then `commands.setAircraft(type, { open: 'career' })` reloads with `career=1`. `aircraftSwitchUrl`: `'career'`
joins `AIRCRAFT_SWITCH_DROPS`; `open: 'career'` adds `career=1` and deletes `school`; `open: 'school'` adds
`school=1` and deletes `career`; no `open` is unchanged. After the reload, row "unplaced job, booted type" places it.
With `cstore=mem` a type switch is refused (the memory store does not survive a reload; the dispatch page says so);
`cstore=session` allows it.

**Seed mismatch:** `worldSeed() !== save.seed` -> the seed page, board refused, buttons "Switch the world to seed N"
(`commands.setSeed`, a reload) and "Start a new career in this world" (confirm; the old save is exported to a file
first if the player wants).

## Integration (exact hooks)

Every row is behind the Career's presence: with no CareerSystem (Cretaceous, or nothing constructed) nothing runs and
the default path is unchanged.

| where | change | default path |
|---|---|---|
| `src/sim/scenarios.ts` `Scenario` | `loading?: LoadingRequest` (career addition) | absent everywhere but Career scenarios |
| `src/sim/SimPhysics.ts` `resetTo` | `sc.loading ? this.fm.setLoading(sc.loading) : this.applyLoading(sc.payload ?? 'typical')` | `applyLoading` and its three strings untouched (golden `start.forward`) |
| `src/sim/SimPhysics.ts` `restore(snap, loading?)` | `if (loading) this.fm.setLoading(loading)` first | no argument: identical |
| `src/sim/resume.ts` | `career?: unknown` in `FlightSnapshot`; null-delete in `validateSnapshot`; the `decideBoot` line | absent: identical |
| `src/sim/params.ts` | `career: { open: boolean \| null; store: CareerStoreKind }` from `career=0\|1`, `cstore=`; header table | defaults null / 'local' |
| `src/sim/aircraftChoice.ts` | `'career'` in `AIRCRAFT_SWITCH_DROPS`; `aircraftSwitchUrl(href, { open?: 'school' \| 'career' })` | 'school' adds school=1 as now (and drops a career=1); none unchanged |
| `src/core/context.ts` | `setAircraft?(id, opts?: { open?: 'school' \| 'career' })`; SimEvents `career: { kind: 'start' \| 'end'; jobId }` | type-only |
| `src/sim/Simulator.ts` (2a) | `setAircraft(id, opts: { open?: 'school' \| 'career' } = {})`: the signature only, so 2a compiles | identical body |
| `src/sim/Simulator.ts` (3b) | load the career store before `decideBoot` and apply `careerBootPlan`; construct `CareerSystem` after RadioSystem when `era().world.school`; `career.init(ctx)`; `run('career', career, subsystemDt)` after radio, before ui, with `frameSimDt()` from the shell; `career.afterBoot({ resumed, plan })` after `training.afterBoot`; `persist()` writes `snap.career`; `saving` true while a placed job is active (not `resume=0`); boot passes `store.active.loading` to `restore`; `setAircraft`/`setSeed`/`setEra`/pagehide/beforeunload flush the career store; a separate `careerHold` ORed into `held`, and `run=` fast-forward pauses while it is set; Shift+R routed through `career.confirmReset()` while a job is active ("Abandon the job?"); chain `ui.crashActions` after `training.init` (`const prev = ui.crashActions; ui.crashActions = (r) => career.crashActions(r) ?? prev?.(r) ?? null`); `ui.attachCareer(career.modalLink)`; `TrafficDeps.player` and `RadioDeps.identity` = `() => career.radioIdentity() ?? training.radioIdentity()`, `RadioDeps.destination` = `() => career.destination()`; `CareerShell.persist`, `addToScene`, `frameSimDt`; `__sim.career`; header comment | no career: nothing runs, `saving` and `held` unchanged |
| `src/ui/uiSystem.ts` | `attachCareer(link: CareerModalLink)`; `modalOpen` and the `schoolModal` term in `update` OR in `link.screenOpen()` | no link: identical |
| `src/ui/menu.ts` | a **Career** button in the Flight tab's school chips row, via an optional `MenuHost.career?: CareerMenuLink`, hidden by the same gate; the scenario rows, aircraft chooser, era, seed and lesson starts use the lesson confirm when `career.jobActive()` ("Abandon the job?") and call `career.abandon()` on yes | absent link: no button, no confirm |
| `src/atc/RadioSystem.ts` (3b) | optional `RadioDeps.identity?: () => { registration: string; icaoType: string; callsign: string \| null } \| null`, consulted first where `training.radioIdentity()` is read today (registration and type only); optional `RadioDeps.destination?: () => Airfield \| null`, stored for wave 4 | absent or null: every phrase unchanged (tests/atc pin wording) |
| `src/atc/RadioSystem.ts`, `calls.ts`, `phrases.ts` (4c) | the callsign ("Fable 12") when `identity().callsign` is set; `RadioSituation.destination?` used by the 'leaving' and 'inbound' phrases | null: unchanged |

The CareerSystem takes its dependencies as closures (`CareerShell`, the TrafficDeps/RadioDeps idiom): physics,
weather, ui layer, `startFrom`, `setAircraft`, `setSeed`, `setHold`, `persist`, `addToScene`, `frameSimDt`,
`hasPpl: () => training?.profile()?...`, `authority`, `readings`, toast, the store. It tolerates `radio`/`traffic`
being null. `radioIdentity()` returns `{ registration (the airframe's), icaoType (CareerPerf.icaoType), callsign
(company word + flight number when `settings.companyCallsign`, else null) }` while in Career mode, null otherwise;
`destination()` returns the active job's destination field or null. It never runs during a lesson: the hub refuses
with "Finish or end the lesson first" while `training.inLesson`; at boot the plan's X gate (not `inLesson`, which an
async lesson start has not set yet) keeps it out of the way.

**Parking stands at generated fields:** the Career uses the one stand each field already has (the 'apron' scenario
spot). Only the player's aircraft is ever placed, so one stand per field is enough; more stands (for showing the
fleet on the ground) are a later stage and would be added as a pure `standsFor(field)` in src/career, never in the
siting code (the present-day guard and every generated field depend on it).

## UI pages (`src/career/ui/`)

Mounted in `ui.schoolLayer` (as the radio menu is), with its own `<style id="fsui-career-style">` (`CAREER_CSS`,
rules under `#fsui .cr-*`, the school's tokens), its root classes given `pointer-events: auto`. Reuses
`src/ui/school/widgets.ts` (`button`, `header`, `section`, `badge`) and `src/ui/dom.ts` (`el`) read-only; no school
file changes. `CareerUi.open(page)` / `close()`, `screenOpen()` (the modal link), a capture key listener while open
(Escape back, Enter primary, buttons `tabIndex -1`), `onCommand(cmd: CareerCommand)`, `onScreenChange(open)` -> the
shell's `careerHold`.

| file | page |
|---|---|
| `careerUi.ts` | the class, page switch, keys, strip and debrief mounting |
| `locked.ts`, `create.ts`, `seed.ts`, `bankrupt.ts` | locked, new career form, seed mismatch, bankruptcy |
| `hub.ts` | hub card, the right mini card, Switch to and Reposition |
| `board.ts`, `boardMap.ts` | offers list and the canvas map (bounds fit to the nine fields, north up, scale bar in NM) |
| `dispatch.ts` | aircraft choice, fuel slider (defuel below what is aboard), load sheet with CG and estimated net, warnings, Accept |
| `stop.ts` | the stop page: Refuel, Continue, Give up |
| `fleet.ts` | fleet (defuel) and market (list price, buy-in, lease) |
| `pilot.ts` | rank ladder, hours by class, ratings shop, company settings, export and import |
| `logbook.ts` | pages of 10 career lines |
| `strip.ts` | the in-flight job strip (`JobStripModel`) |
| `debrief.ts` | the settlement card |
| `format.ts`, `styles.ts` | money ("$1,240"), clock ("Day 3 · 10:40"), CSS |

`dev/career.html` + `src/dev/career.ts` render every page from fixtures (`screen=hub|board|dispatch|...`), for
screenshots with `scripts/shot.mjs` at 1280x720 and 1600x900.

## Automation (`window.__sim.career`)

```ts
career: {
  state(): CareerSave | null;                 // structuredClone of the save
  board(): JobOffer[];                         // today's board here
  loadSheet(offerId, uid, fuelKg): LoadSheet;
  accept(offerId, opts?: { uid?: string; fuelKg?: number }): Promise<'placed' | 'reloading' | string>; // string = refusal text
  active(): { job: ActiveJob; strip: JobStripModel; monitor: unknown } | null;
  abandon(): void;
  settlement(): Settlement | null;            // the last debrief
  command(cmd: CareerCommand): void;
  open(page?: CareerPage): void; close(): void;
  create(opts?: Partial<{ pilotName; companyName; start: 'c152' | 'c172s' }>): void;   // declares a licence
  testArrive(): Promise<void>;                 // cstore=mem or session only: marks the job airborne and landed, places the aircraft cold, brake set, at the destination stand; the job completes as a test
  store; system;
}
```

`__sim.step()` bypasses the frame loop, so browser checks drive frames (or `run=`, which the job time and monitor
follow exactly), not `step`.

## URL parameters

| parameter | meaning |
|---|---|
| `career=1` | open the Career hub at boot (also what a Career type switch adds); `career=0` never auto-opens it and counts as an explicit start |
| `cstore=mem` | keep the Career save in memory only (unit tests; a type switch is refused; no resume block is written) |
| `cstore=session` | keep it in sessionStorage (e2e: survives the same-tab reload of a type switch, gone with the tab; no resume block) |
| `unlock=1` | (existing school parameter) also unlocks the Career for this session |

## Build plan

Every package: British spelling, a `//` header comment on every file, JSDoc with units on every export, tests in
`tests/career/` (except where named), `npx tsc --noEmit` and `npm run test:fast` clean, and the goldens
(`npx vitest run tests/golden`, plus `FS_GOLDEN_EXACT=1`) and `tests/era/presentGuard.test.ts` unchanged when the
package touches anything outside `src/career/`. World tests set `setEra('present'); setWorldSeed(0);`, `import
'../../src/world/terrain/heightfield'`, look fields up by kind or index (never by code), and reset `setStartField(null)`,
`setGpsTarget(null)`, `setWorldSeed(0)` in `afterAll`. A test flying 40 s of CPU or more goes in
`tests/slow-tests.txt` with a header note (only 1a and 2b add entries, in different waves). `src/career/types.ts` is
the lead's: a package needing a new type adds it as an optional "(contract addition)" and says so in its report.
Packages in one wave never edit the same file; the owned lists below are exhaustive (a package needing another file
asks the lead).

### Wave 1: pure core (1a first, then 1b to 1e in parallel, each depending on 1a only)

- **1a perf, stations, costs, registrations.** Owns `src/career/perf.ts`, `src/career/stations.ts`,
  `src/career/costs.ts`, `src/career/fit.ts`, `src/career/registration.ts`, `tests/career/perf.test.ts`,
  `tests/career/stations.test.ts`, `tests/career/costs.test.ts`, `tests/career/fit.test.ts`, `tests/career/perfCalibration.test.ts`, `tests/slow-tests.txt` (one entry).
  - perf.ts: `CAREER_PERF` (the tables above), literal numbers, no aircraft import.
  - stations.ts: `CAREER_STATIONS`, `assignStations`, `cgOf`.
  - costs.ts: fuel price per kg by grade and field (grass, truck), landing fee by field, hourly rate by tenure,
    trip/climb/taxi/reserve/required fuel, ground speed from wind, flight time and block hours, pay floor, defuel
    credit, insurance excess.
  - fit.ts: `fitOffer(offer, type, fields): 'seats' | 'stationLimit' | 'overMtow' | 'runwayShort' | 'grass' | null`
    (stations, MTOW at required fuel, runways at both ends): the single fit rule for jobs.ts (refType, eligibility)
    and loadsheet.ts.
  - registration.ts: `registrationFor(uid, authority)`.
  - Accept: perf.test, for every `CAREER_AIRCRAFT_IDS` type (loaded with `loadAircraft`): empty, MTOW, MLW,
    `icaoType` equal the definition; usable fuel equals the tank sum within 0.1 kg; fuel grade matches; `cls` heli iff
    `def.rotorcraft`; twin iff two piston engines; `deliveryFuelKg` is half usable;
    `cg.fwdX`/`aftX` equal the CGs of `forward`/`aft` within 1 mm; `cruiseTasKt` converted to IAS at 2,000 ft ISA is
    below `def.reference.vno`; helicopter TAS = round(vcruise x 1.04); da42 and ah56 absent; a grep proves perf.ts,
    stations.ts and costs.ts import nothing under `src/aircraft/`. stations.test: every literal position equals the
    definition's (1e-9); `assignStations` fills in the documented order and reports `seats`/`stationLimit` exactly at
    the limit + 0.1 kg. costs.test: each formula on hand-worked numbers (the doc's pay and floor examples to the
    dollar). perfCalibration (slow): each type at cruise power, 2,500 ft, 3 min, burn and TAS within 10 % of the table.
    fit.test: each refusal code exactly at its limit, and null just inside it. `registrationFor`: deterministic, EASA `^G-[A-Z]{4}$`, FAA `^N[1-9][0-9]{2}[A-Z]{2}$`, 1,000 uids distinct.
- **1b jobs.** Owns `src/career/geo.ts` (field lookup by code, NM distance and bearing, nearest field,
  `fieldArea(f, n, e)` -> inside / apron / runway, home via `APRON_RECT`/`PARKING_SPOTS`), `src/career/rng.ts`
  (FNV-1a + mulberry32 stream), `src/career/jobs.ts`, `tests/career/geo.test.ts`, `tests/career/jobs.test.ts`, `tests/career/boards.golden.json`.
  Accept: same inputs deep-equal; another day or field differs; 200 boards at seed 0 and 200 at seed 7: counts 6..9,
  unique ids, slots 0-2 of the fixed classes (or the documented fallback), destination never the origin, every offer
  fits its `refType` and every type of its class is ok or refused only by a fit code (1a's `fitOffer`), pay = max(formula, floor) and deadline
  as documented (recomputed), at most one mail run, scenic loops 15-35 NM with every point >= 3,704 m from every
  field, weather ids and wind ranges valid, premium share within 10-30 % over the 400 boards; no `Math.random` (grep);
  geo: home `fieldArea` says apron at `PARKING` and not at the dummy `apronAlong`. Golden: base boards for seeds 0
  and 7, days 1-3, every field, deep-equal `boards.golden.json` (pins the base stream against wave 4).
- **1c economy and progression.** Owns `src/career/economy.ts` (`settleJob`), `src/career/progression.ts` (rank,
  ratings, market actions with buy-in and sale, idle lease charge, bankruptcy options, clock: rest, day, departure
  window, season day of year, hours by class), `tests/career/economy.test.ts`, `tests/career/progression.test.ts`.
  Accept: the worked example to the dollar ($219, +2); each outcome's money and reputation lines from the tables
  (including `routeMissed`, scenic partial route, low and critical reserve for an aeroplane and a helicopter, heavy
  landing inspection, no hard-landing pay line); clamps (reputation 0..100, late cap, overspeed cap, excess
  2,000..25,000); aircraft moved and fuel updated; crash grounding; rank thresholds both ways at 2/8/20/40 h; rating
  prerequisites and cash; lease/buy/sell/return/defuel rules incl. the overdraft and the active-job lock; idle charge
  (1 h less hours flown, never negative); bankruptcy offers sellOwned only when it lifts cash above -5,000; rest
  settles a stopped job as diverted; day of year = 152 + (day mod 90).
- **1d load sheet and loading.** Owns `src/career/loadsheet.ts`, `src/career/loading.ts`,
  `tests/career/loadsheet.test.ts`, `tests/career/loading.test.ts`. Accept: every blocking and warning code reachable
  and correct on hand-built cases; the PA-38 with one passenger, a bag and full fuel is `overMtow`, and ok after
  defuelling to the sheet's `maxFuelKg` (with the defuel credit shown); the C152 with one passenger and a bag at full
  fuel is ok; a PC-12 with nine passengers and full fuel is `overMtow` and ok at `maxFuelKg`; a Jet A-1 type at a
  grass strip gets `fuelTruck` (warn), never a block; estimated net equals pay - costs on a worked case; loading:
  pilot-only equals `R22_SOLO`, `R44_SOLO`, `S269_SOLO`, `MD500_SOLO` to 1e-9; masses sum to pilot + items;
  distributions valid; CG between the type's forward and aft loadings for typical loads of every type.
- **1e store.** Owns `src/career/store.ts`, `src/career/validate.ts`, `src/career/block.ts`
  (`validateCareerBlock`), `src/career/create.ts` (new save from the form, first leased aircraft at the home field,
  its registration from 1a), `tests/career/store.test.ts`, `tests/career/create.test.ts`. Accept: round trip;
  `.prev` recovery; quota and throwing stores -> `memoryOnly` without throwing; unknown fields dropped, a bad fleet
  entry dropped not the save; an `active` with `placed: true` and `loading: null` rejected (dropped to null); schema
  guard; export/import; `cstore=session` KV chosen and guarded; `kind` reported; block validation drops unknown
  fields (an old block's `loading` included), rejects a missing or empty `jobId` or `aircraftUid` and `v !== 1`; the key is
  `fs.career.v1` and nothing touches `fs.training.v1`.

### Wave 2 (parallel)

- **2a sim hooks.** Owns `src/sim/scenarios.ts`, `src/sim/SimPhysics.ts`, `src/sim/resume.ts`, `src/sim/params.ts`,
  `src/sim/aircraftChoice.ts`, `src/core/context.ts`, `src/sim/Simulator.ts` (the `setAircraft` signature line only),
  `src/career/placement.ts`, `tests/sim/resume.test.ts` and `tests/sim/aircraft.test.ts` (added cases only, beside the
  switch-URL cases), `tests/career/simHooks.test.ts` (params, loading, restore), `tests/career/placement.test.ts`.
  2a only parses `cstore=`; choosing the KV for it is 1e's. Accept: goldens bit-identical incl. `FS_GOLDEN_EXACT=1`;
  `tests/sim` fast set green; a scenario with `loading` gives `state.mass` = empty + pilot + items + fuel within
  0.01 kg for c152, c172s, pc12, r44, bo105 at the home field, a sealed and a grass field; the position equals the
  'apron' scenario's; `restore(snap, loading)` restores the same mass; without the argument restore is unchanged
  (golden `restore.cruise`); `decideBoot` resumes a parked snapshot with a career block and still restarts one
  without; a null career block is deleted; `aircraftSwitchUrl(u, { open: 'career' })` has `career=1` and no `school`,
  `{ open: 'school' }` has `school=1` and no `career`, no `open` drops `career` and keeps `school` as today; params
  parsed and defaulted.
- **2b job runtime.** Owns `src/career/runtime/{monitor,fieldGeo,comfort,landingScore,completion,strip}.ts`,
  `tests/career/{fieldGeo,comfort,landingScore,completion,monitor}.test.ts`, `tests/career/headlessJob.ts`,
  `tests/career/headlessJob.test.ts` (in `tests/slow-tests.txt` if over 40 s; 2b then owns that file in wave 2).
  Depends wave 1 (the headless host builds the placement itself until 2a lands and must not edit 2a's files).
  Accept: field geo ids agree with the school's provider at the home field to 1e-6 (same field, same end); synthetic
  streams give the documented comfort deductions (a flared trainer landing with 2 s of stall horn below 50 ft costs
  0) and landing scores (a touchdown 20 m past the threshold of a 650 m grass strip gets full zone points); cold at
  the origin with brake set and engines off for 60 s: no outcome; completion with brake (3 s) and without (12 s, hint
  at 5 s); a stop at another field gives phase `stopped`, then Continue and a completion at the destination; home
  destination: `onApron` true at `PARKING`; outlanding, crash and foreign reset each detected; helicopter liftoff and
  completion without throttle; export/restore round trip continues identically; the monitor fed one 0.25 s step and
  the same time as 0.0125 s steps gives the same phase and elapsed time; headless: a real `SimPhysics` C172S placed
  cold at a generated field, started, flown once round the field and shut down with the brake set completes; a C172S
  on the 'final' scenario at a generated field with throttle closed lands or crashes and the report agrees with the
  touchdown events; an R44 placed cold, lifted to a hover and set down and shut down completes with no brake.
- **2c UI.** Owns `src/career/ui/*`, `dev/career.html`, `src/dev/career.ts`, `scripts/career-shots.mjs`,
  `tests/career/ui.test.ts`. Accept: every page (including stop, bankrupt, dispatch with defuel and a `losesMoney`
  warning) renders from fixtures under `installFakeDom()` with the expected text and disabled states; every button
  sends its command; Escape/Enter behaviour; the strip formats late and early, the waypoint "2 of 3", the projected
  reserve and the helicopter spot line; `scripts/career-shots.mjs` opens `dev/career.html?screen=<each>` at 1280x720
  and 1600x900, day and night, writes the screenshots, and exits non-zero if any page error is logged or any element
  under `.cr-root` has `scrollWidth > clientWidth + 1`.

### Wave 3 (sequential): wiring

- **3a CareerSystem.** Owns `src/career/CareerSystem.ts`, `src/career/boot.ts`, `src/career/index.ts`,
  `tests/career/system.test.ts` (a fake shell: memory store, recording startFrom and persist, a real SimPhysics),
  `tests/career/boot.test.ts`. Depends wave 2. The orchestrator: store, board, dispatch, placement via the shell,
  monitor lifecycle, stops, settlement (with `pendingReport`), UI model refresh, resume block, boot plan and
  `afterBoot`, crash actions, weather keep/restore, start field, `radioIdentity()` and `destination()` (complete, not
  stubs), `modalLink`, `menuLink` (`available`, `open`, `jobActive`, `abandon`), `confirmReset()`. Accept: boot.test
  pins every row of the boot table and the four named regressions; system.test: accept -> placed -> fly (headless)
  -> settle -> board from the destination, start field at the destination; a shutdown at the origin before take-off
  does nothing; a stop, refuel (elapsed carried) and completion; type switch (store saved before `setAircraft` is
  called with 'career'; `resumeBlock()` null before placement and for another booted type; placement after a new
  system boots on the same store); `resumeBlock()` null for a 'mem' or 'session' store; settle, abandon and accept
  call `store.save` and `persist` synchronously; seed mismatch refuses; lesson running refuses; foreign reset
  abandons; crash -> pending -> settlePending; `radioIdentity()` gives the airframe's registration and, with
  `companyCallsign`, "Fable 12"; null outside Career mode; 200 boards at seeds 0 and 7, every class-eligible
  fleet type through the real `loadSheet` at required fuel: ok or blocked only by a fit code (1b and 1d agree).
- **3b Simulator, UI, menu, radio identity, automation.** Owns `src/sim/Simulator.ts`, `src/ui/menu.ts`,
  `src/ui/uiSystem.ts`, `src/atc/RadioSystem.ts` (the two optional deps only; no phrase change),
  `scripts/fly-job.mjs`, `tests/career/wiring.test.ts` (source-order and default-path checks),
  `tests/atc/identityHook.test.ts`. Depends 3a. Accept: everything in the integration table; `tests/era/bootOrder`,
  the Simulator source-order tests and every `tests/atc` file green; identityHook: with no hook the transcript of a
  scripted circuit is byte-identical, with one the registration is the hook's; uiSystem: `modalOpen` true while a
  Career page is open and the radio keys do nothing; browser (`scripts/fly-job.mjs`, fresh profile, exits non-zero on
  any failed assertion, page error or non-empty `__sim.errors`):
  1. `index.html?cstore=session&unlock=1&career=1&voice=0&mute=1`: create a career; accept the first C152 offer;
     assert position within 5 m of the stand, `state.mass` within 0.1 kg of the load sheet's take-off mass, fuel
     fraction, GPS target = destination, active COM = origin frequency, `modalOpen` false after close;
     `testArrive`; assert the settlement's outcome 'completed' and the aircraft's field = destination.
  2. Same URL: accept a job with a C172S lease while a C152 is loaded: the page reloads into the C172S with
     `career=1` and no `school`; assert placed at the origin with the job's mass.
  3. `index.html?unlock=1&career=1&voice=0&mute=1` (real localStorage): accept, start, `run=60`, reload: assert the
     job resumed (same `jobId`, elapsed >= 60 s); with the resume preference off, the same; Shift+R asks and "no"
     keeps the job; then `abandon()`, reload within 1 s: assert no job resumes.

### Wave 4 (4b first, then 4a; 4c in parallel with both)

- **4b landmarks.** Owns `src/career/landmarks.ts` (towns, lakes, summits, river bends from the world's existing
  pure queries; never the siting code), `src/career/ui/strip.ts` (landmark name on the waypoint line),
  `tests/career/landmarks.test.ts`. Accept: deterministic per seed; every landmark >= 2 NM from every field;
  presentGuard unchanged.
- **4a helicopter sites and landmark scenics.** Owns `src/career/sites.ts` (off-field sites near villages and roads:
  slope under 5 deg from the terrain sampler, dry, at least 300 m from fields, 40 m clear of trees by the vegetation
  query), `src/career/jobs.ts` (medevac, utility and landmark scenics on the `|w4` stream), `src/career/CareerSystem.ts`
  (site placement and the smoke marker via `shell.addToScene`), `src/career/render/smokeMarker.ts`,
  `tests/career/sites.test.ts`, `tests/career/jobsW4.test.ts`. Depends 4b. Accept: sites valid on 3 seeds; for 200
  boards at seeds 0 and 7 1b's `tests/career/boards.golden.json` test still passes unchanged (4a does not edit it) and the
  wave-4 offers follow the base offers with `-w` ids; medevac offers helicopters only; a headless R44 completes a site leg; smoke drawn only during a
  site job.
- **4c ATC phrasing.** Owns `src/atc/RadioSystem.ts`, `src/atc/calls.ts`, `src/atc/phrases.ts`,
  `tests/atc/careerHooks.test.ts`. Accept: every existing tests/atc file green with no wording change; with the hooks
  the callsign is "Fable 12" and 'leaving'/'inbound' name the destination. (Simulator already passes both closures
  from 3b; 4c edits no sim file.)

### Wave 5: documentation and review

Owns `docs/career.md` (this file: "Where it stands"), `docs/simulator.md` (URL table), `docs/flight-school.md` (a
pointer), `README.md` (Documentation row), `docs/known-issues.md`. Full suite including slow files, the conformance
suite opt-in, a code review of the whole branch, and the owner's flight of three jobs (C152, C172S, R44).

## Later

Multi-leg mail runs; ATC flight-plan phrasing ("VFR to Holthurst"); per-tank fuel; a check ride per rating; more
stands and the fleet visible on the ground; a painted H at the helicopter stands; passengers drawn in the cabin
(exterior hashes would move: owner decision); an instrument rating with the IFR presets; sunset-based last
departures if the season is ever unheld; AI pilots flying owned aircraft; the AH-56 display flight.
