# Gas-turbine model

Groundwork for turbine-powered types. The first output stage is the **free power turbine** (the PT6A pattern:
Caravan, King Air, PC-12, TBM, Twin Otter). The gas generator is written so the same core can later drive other
output stages (turboshaft, jet nozzle, fan).

| File | What it holds |
| --- | --- |
| `src/physics/propulsion/gasGenerator.ts` | Ng spool, corrected-parameter running line, fuel control unit (FCU), light-off and flame-out, pooled fuel, ITT |
| `src/physics/propulsion/turbineEngine.ts` | `TurbineEngine` (`EngineCore`): the levers, the free power turbine's torque, the topping governor |
| `src/physics/propulsion/defs.ts` | `GasGeneratorDef`, `TurbineDef`; `EngineDef.kind 'freeTurbine'`, `metering 'turbineFcu'`, `ignition 'igniters'` |
| `tests/propulsion/testbed.ts` | `PT6_ENGINE`, `PT6_PROPELLER`, `TURBOPROP_POWERPLANT`: a PT6A-114A-like test-bed |
| `tests/propulsion/turbine.test.ts` | 19 tests: running line, corrected scaling, power turbine, FCU, starts, shutdown, relight, resume |

## How it fits the existing powerplant

A turbine is an `EngineUnit` like the piston and FADEC-diesel engines. It goes into a `PowerplantDef` with the same
fuel network, bus and constant-speed propeller/governor. For a `'freeTurbine'` engine the `EngineDef` fields mean:

- **"crank" = the power turbine.** `ratedRpm` is its design speed and `gearRatio` is PT rpm / prop rpm (PT6A-114A:
  33 000 / 1900). `rotatingInertia` covers the power turbine and gear train. `EngineState.rpm` / `torque` are
  power-turbine values. The torque gauge (prop shaft) reads `torque × gearRatio`.
- **Gas-generator shaft (`EngineUnit.driveRpm` / `driveOmega`).** The starter, the alternators (the
  starter-generator), the engine-driven fuel pump and the oil pump all hang on it. `runningRpm` and the
  alternator `cutInRpm`/`fullRpm` are Ng rpm. For piston engines `driveRpm` is the crank, with the same arithmetic
  as before.
- **Piston fields not read.** Only `induction.ramRecovery` and the oil part of `thermal` are used. Write the rest
  as 0 or copy them, as the diesel definitions already do.

New `EngineState` fields: `ng` (%), `itt` (°C; `egt` reads the same value) and `lit` (the flame is alight, from
light-off; `running` only from `runningRpm`). `EngineSnapshot.gasGenerator` holds Ng, ITT and whether it is lit,
for resume.

**Trims.** A piston engine fires whenever its shaft turns with the switches on; a gas turbine's flame is state.
`Powerplant.primeForTrim` therefore lights every turbine before a trim evaluation, and the trim's own controls put
it out again (condition lever at cut-off, fuel off): a trim with a failed engine is made with it unlit, every
other trim with it running, whatever the flight model's history.

**First user: the Cessna 208 Caravan 675** (`src/aircraft/c208/`), with its own PT6A-114A definition (the
test-bed's map rescaled for the flat rating: 675 shp at about 97 % Ng at sea level and still over 600 shp at
10 000 ft). The scripted pilot sets take-off power with the lever at its torque limit
(`AutoflightProfile.takeoff.throttle`, new and optional; absent means 1).

### Controls (no new control keys)

| Cockpit | Existing control |
| --- | --- |
| Power lever | `throttle`: Ng set point from idle to `fcu.maxNg` |
| Condition lever | `mixture`: below `CUTOFF_BELOW` (0.1) = fuel cut-off; 0.1 → 1 = LOW IDLE → HIGH IDLE |
| Propeller lever | `propeller`: the existing governor and feather |
| Starter switch | `starter`: turns the gas generator; the igniters spark while it is on |
| Ignition switch | `magnetos`: 0 = NORM (igniters spark while the starter runs); anything else = ON (continuous) |

## The physics

**Corrected running line.** The definition gives fuel flow, ITT and gas power against Ng, as measured at sea-level
ISA. The model reads that table at the corrected speed Ng/√θ and scales the results by δ√θ (flow, power) and θ
(ITT in kelvin). θ and δ are the inlet total temperature and pressure (ram included) divided by their sea-level
ISA values. So on a hot or high day the same Ng gives less power at a higher ITT. ITT, not Ng, then limits the
engine. Tested: on an ISA+30 day at 101.6 % Ng the ITT is near the 805 °C limit, with under 90 % of the ISA
power.

**Spool.** J ω dω/dt = η·LHV·Wf − P_compressor(N) − P_accessories + Q_starter·ω.

- Compressor power ∝ δ√θ·Nc³.
- η is solved from the map, so the steady fuel holds the steady speed.
- Below the map (the start region), η falls to zero at light-off. The shape is solved so that the acceleration
  schedule just holds the spool at `selfSustainingNg`. Below that the starter must help; above it the engine
  accelerates alone.

**Combustor and ITT.** The temperature rise follows the fuel-air ratio. The air flow is derived from the map's ITT
and falls with Ng below the map, so slow starts run hot. ITT has a 1 s thermocouple lag. Unlit, the probes cool
over about 20 s.

**Pooled fuel (wet start).** Fuel that reaches an unlit combustor collects there. It drains overboard, faster when
air is blown through by motoring. At light-off it burns off over about 2.5 s ("torching"): it heats the ITT but
does no work on the spool. So fuel introduced before the engine can light, then lit, gives a hot start
(> 1090 °C).
A dry motoring run (starter with the condition lever at CUT-OFF) clears it.

**FCU.** A proportional Ng governor around the steady flow. It is clamped between the acceleration schedule
(`fcu.accelFuel`: the start schedule below the map, then about 25 % over the running line) and a minimum-flow
stop (`decelFraction` of steady). Both scale with δ√θ, like a Wf/P3 schedule. Results: idle to 95 % Ng in 3–6 s;
a chop to idle never flames out (the minimum-flow stop sits above the lean blow-out).

**Free power turbine.** Torque = (gas power / design speed) × (a − (a−1)·Np/Np_design), where
a = `stallTorqueRatio` (about 2). This gives the most torque with the turbine stalled and the map power at its
design speed. The PT and gearbox friction is a constant plus a part per rpm.

**Topping governor.** Above `topping.np` × design speed it takes Ng off the set point. This is the backup for a
failed propeller governor.

**Flame-out and relight.** The flame goes out on fuel starvation or lean blow-out. There is no auto-relight: a
relight needs the igniters (starter on, or IGNITION ON) and Ng above light-off; Ng runs down to zero after a
flame-out, so an air start is starter-assisted.

**Oil.** The existing `EngineThermal` oil model, driven by Ng. The propeller governor takes its oil pressure from
it. So the prop (no feather latches) feathers once the engine has stopped, and unfeathers as oil pressure builds
during a start, as a PT6's does.

### What the test-bed does

| Case | Result |
| --- | --- |
| Start: fuel at 13 % Ng | Light-off; peak ITT about 720 °C; stable at 52 % low idle about 37 s after the starter (tested: 20–50 s) |
| Starter released at 30 % | Hung start: Ng decays |
| Starter released above 35 % | Reaches idle |
| Fuel in before the engine can light, then lit (late light-off) | Hot start, over 1090 °C |
| Full power, sea level, 150 kt | 101.6 % Ng, about 730 shp (over the 1865 ft-lb torque limit if the pilot lets it), ITT about 746 °C |

## Not modelled yet (next steps)

1. **Beta and reverse.** Today the power lever stops at flight idle. Beta and reverse need blade angles below
   the fine stop, reverse propeller maps, and the Np/Ng reset of the reversing cam. Without beta, ground idle
   gives strong static thrust (about 3.5 kN at high idle).
2. **Windmilling gas generator.** After an in-flight flame-out, Ng spools down to 0 instead of windmilling at
   10–15 %.
3. **Other output stages.** Turboshaft (feeding `rotorcraft`; the rotor governor would trim Ng), turbojet and
   turbofan (thrust from nozzle and fan, no propeller), and the single-shaft TPE331 (Np = Ng, with
   underspeed/fuel governing and negative-torque sensing).
4. **Engine controls.** FADEC/EEC limiters (torque, ITT, Ng) for newer engines; auto-ignition; bleed air and
   inertial separator (ITT and power penalties); engine anti-ice.
5. **Exceedance logging.** ITT, torque and Ng over-limits for the instructor and the debrief.
6. **Aircraft integration.** Turbine instruments (torque, ITT, Ng, Np, fuel flow), turbine audio (whine instead of
   combustion), `tests/aircraft/consistency.ts` rules for `kind 'freeTurbine'`, and the flight model's
   control defaults (it currently special-cases `fadec`).

The running line in the test-bed is a plausible PT6 shape, not a P&WC deck. A real type should calibrate the map
(fuel flow, ITT and power against Ng) against its POH cruise and climb tables.
