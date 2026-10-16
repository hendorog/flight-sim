# Gas-turbine model

Groundwork for turbine-powered types. The first output stage is the **free power turbine** (the PT6A pattern:
Caravan, King Air, PC-12, TBM, Twin Otter). The gas generator is written so the same core can later drive other
output stages (turboshaft, jet nozzle, fan).

| File | What it holds |
| --- | --- |
| `src/physics/propulsion/gasGenerator.ts` | Ng spool, corrected-parameter running line, fuel control unit (FCU), light-off and flame-out, pooled fuel, ITT |
| `src/physics/propulsion/turbineEngine.ts` | `TurbineEngine` (`EngineCore`): the levers, the free power turbine's torque, the topping governor, the reversing cam and its topping reset, the torque limiter |
| `src/physics/propulsion/governor.ts` | the propeller hub: governor, feather, latches; the beta valve, the scheduled low-pitch stop, the overspeed governor |
| `src/physics/propulsion/engineUnit.ts` | `ControlInputs.reverse` to the hub and the engine, the condition-lever propeller, the latching start switch |
| `src/physics/propulsion/powerplant.ts` | `settle()` in beta (blades at the command, the shaft speed bisected); the latched starters to the bus |
| `src/physics/propulsion/defs.ts` | `GasGeneratorDef`, `TurbineDef` (`reversingCam`, `torqueLimiter`); `BetaDef`, `PitchControlDef.selectedBy`, `GovernorDef.overspeedRpm`, `EngineDef.starterLatch`; `EngineDef.kind 'freeTurbine'`, `metering 'turbineFcu'`, `ignition 'igniters'` |
| `tests/propulsion/testbed.ts` | `PT6_ENGINE`, `PT6_PROPELLER`, `TURBOPROP_POWERPLANT` (PT6A-114A-like); `BETA_TURBOPROP_POWERPLANT` (the same with beta and reverse); `PT6A67_POWERPLANT` (PT6A-67-like with the PC-12's extras) |
| `tests/propulsion/turbine.test.ts` | 19 tests: running line, corrected scaling, power turbine, FCU, starts, shutdown, relight, resume |
| `tests/propulsion/beta.test.ts` | 20 tests: the T1a acceptance 1-9 (static reverse, the beta valve, Np in reverse, back to the gate, no NaN, settle, latching starter, torque limiter, overspeed governor), the condition-lever propeller, the scheduled stop, state and resume |
| `tests/propulsion/conformancePlumbing.test.ts` | idle taxi, landing roll with reverse, the roll-out lever, the plan's blocks, on the C208 with the test-bed's beta range grafted on |
| `tests/propulsion/turbineConsistency.test.ts` | the consistency rules of the turbine extras fire on broken data |

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

### Controls

| Cockpit | Control |
| --- | --- |
| Power lever, forward of the gate | `throttle`: Ng set point from idle to `fcu.maxNg` |
| Power lever, aft of the gate (beta, reverse) | `reverse` (0..1, per engine; types with `PitchControlDef.beta`): 0 the gate, `pitchOnlyTravel` ground fine, 1 full reverse. The input system never makes it and `throttle` both non-zero |
| Condition lever | `mixture`: below `CUTOFF_BELOW` (0.1) = fuel cut-off; 0.1 → 1 = LOW (GROUND) IDLE → HIGH (FLIGHT) IDLE. With `selectedBy: 'conditionLever'` (PC-12) it also feathers at CUT-OFF/FEATHER |
| Propeller lever | `propeller`: the existing governor and feather (none on a `'conditionLever'` type: governed at `maxRpm`) |
| Starter switch | `starter`: turns the gas generator; the igniters spark while it is engaged. With `EngineDef.starterLatch` (PC-12) one press latches it (below) |
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

## Beta, reverse and the PT6 extras (turbine core, package T1a)

Every piece is optional data; a type without it is unchanged: the c172/pa34/c152/da20/pa38 flight goldens are
identical under `FS_GOLDEN_EXACT=1`, and every conformance item of the pa34, c152, c172s, da20 and pa38 quick tiers
and of the C208's quick and flown tiers measures the same number to the last bit. The C208's and the PC-12's own data
are their packages' (T1b, P1); the numbers below are the test-beds' (`tests/propulsion/testbed.ts`).

**The beta valve** (`governor.ts`). The power lever aft of the gate (`ControlInputs.reverse`, r) commands a blade
angle: the flight low-pitch stop at r = 0, `beta.groundFine` at r = `pitchOnlyTravel`, `beta.reverse` at r = 1
(linear in between). The blades' lower limit is then the command, not the stop. Aft of the gate the valve has the
authority: it drives the blades to its command at `beta.rate`, finer at that rate x the oil authority (the
governor's 25 psi law) and coarser at that rate (on a feathering hub the springs and counterweights, no oil needed),
and the primary governor's coarse signal is not acted on; only the overspeed governor and feather still
take them coarse. Letting the primary governor coarsen them trapped the blades: entering reverse at 80 kt they pass
through zero thrust, where this blade windmills, Np reached the 1700 rpm set speed and the governor parked the
blades near -5 deg with 0.9 kN of reverse thrust instead of 8.5 kN. Back on the gate the governor has them again,
above the stop. A stop that rises under the blades (the lever coming forward, or a scheduled stop) takes them up at
`beta.rate`, never in one step. `PropellerState.beta` (present only on a hub with beta) is true while the lever is
aft of the gate or the blades are still finer than the stop. Test-bed: the blades reach every commanded angle within
0.5 deg in 1.5 s at full oil (beta.rate 30 deg/s); with no oil a feathered hub stays feathered whatever the lever.

**Scheduled low-pitch stop** (`beta.lowPitchSchedule`; the PC-12 stop rises with the PCL, plan 5.1): the flight
stop rises with the power lever forward of the gate; `settle()` starts its blade-angle search there.

**Reversing cam and topping reset** (`TurbineDef.reversingCam`, `turbineEngine.ts`). Aft of the gate the fuel topping
governor's set point is reset to `reverseNp`, below the propeller governor's (which is then in underspeed: a
consistency rule). Beyond the pitch-only travel the cam raises the Ng set point linearly from the idle to
`maxReverseNg` at r = 1. In the reverse reset the topping gain is raised so that the cam's Ng span maps onto 1 % of
Np (AGENT choice): with the forward gain (C208: 5 Ng per unit overspeed) the droop at full reverse was 3 %, up to the
propeller governor's own set speed. On the PT6A-67 test-bed (reset 1650 rpm) static full reverse holds Np at
1658 rpm with Ng 73 %, and 1654-1658 rpm at 0-80 kt and 75-100 % of the travel.

**Minimum-flow floor.** The topping governor and the torque limiter cut the Ng set point down to the running line's
first point (`map.ng[0]` x sqrt(theta)) and no further: they bleed the governor's air, they do not shut the fuel
off. Before this a cut could run the spool down to nothing (the 80 kt reverse entry above flamed out at 3 % Ng). It
applies to every free turbine; nothing in the existing types' conformance or goldens reaches it.

**Torque limiter** (`TurbineDef.torqueLimiter`, PC-12). A cap on the Ng set point in the topping path, SOLVED each
step rather than integrated: the Ng at which the steady running line, at the present inlet conditions and
power-turbine speed, gives the limit torque on the propeller shaft, net of the power-turbine friction. The limit
is `psi` x lapse(pressure altitude) / lapse(0) less `taperPsi` spread over `ngTaper`. It is deterministic in
`settle()` and in the time loop alike; in transients the gas power follows the fuel (up to 1.5x), so the torque
overshoots briefly. With the PC-12's law (`PC12_TORQUE_LIMITER`, 47E-PROXY sect. 7-10) the test-bed with the power
lever slammed full gives 44.23 psi at sea level static (limit 44.30), 41.54 psi at 10 000 ft and 150 KIAS (41.60) and
37.36 psi at 20 000 ft and 150 KIAS (37.46); Ng 90.7 / 95.6 / 100.9 %, never above 104 %. At 28 000 ft ISA+25 Ng
stops at 103.7 % with 28.3 psi (the tapered limit there is 31.3 psi).

**Overspeed governor** (`GovernorDef.overspeedRpm`, PC-12 1802 rpm, TCDS). A second flyweight valve about a higher
set speed that dumps the governor oil: the blades go coarse, at the hub's full coarse rate by 0.5 % above it (AGENT
choice). With the primary governor failed (set to 2600 rpm) in a full-power dive to 260 kt the test-bed peaks at
1807 rpm (acceptance: 1802 + 2 % = 1838); without it the 1853 rpm topping governor alone lets Np reach 2015 rpm.

**Condition-lever propeller** (`selectedBy: 'conditionLever'`, the PC-12's quadrant: no propeller lever). Governed at
`governor.maxRpm` (= `minRpm`, a consistency rule) whatever `ControlInputs.propeller` says; feathered with the
condition lever below `CUTOFF_BELOW` (CUT-OFF/FEATHER).

**Latching start switch** (`EngineDef.starterLatch`, PC-12). One press of `starter` (a rising edge) latches the
starter until Ng reaches `cutoutNg`, `cutoutSeconds` pass, or the switch is pressed again (the interrupt: there is
no STARTER INTERRUPT control yet). `EngineUnit.starterEngaged` reports it; the bus and the igniters use it. Without
`starterLatch` the starter is hold-to-run as before (the C208). Test-bed (cut-out 50 % / 80 s, `PC12_START`): one
press, condition lever to GROUND IDLE at 13 % Ng: light-off, peak ITT 733 C, cut-out at 50.03 % Ng after 42 s,
idle at 54.9 % Ng; a second press at 20 % Ng drops it out (the start hangs); a dry motoring run times out at 80 s.

**Propeller maps.** `PROP_MAX_SLICES` is 20 (the C208's 15 slices plus up to 5 in beta); slices below the fine stop
(to the reverse angle) are ordinary slices. The slice grid's floor (advance angle -20 deg) is unchanged. The maps
give finite loads from -20 to 90 deg blade angle at 0-150 kt, turning or stopped, in line or inclined.

**settle() in beta.** The blades sit at the valve's command and the shaft speed is bisected on the unit's own net
torque (engine with Ng from the cam and the topping reset, less losses, less propeller), evaluated in steady mode.
Stepping the shaft instead rang: with the gas generator at its set point at once, the stiff reverse topping gain and
the 1/30 s step oscillated (settle returned Ng 50 % and 0.35 psi). The solution holds within 0.01 % of Np over the
next 3 s of the time loop.

**Reverse thrust of the test-bed blade.** A reversing blade works on the negative side of its section. The Clark Y
section of the light-aircraft blades (zero lift -4.5 deg to the face, negative stall at cl -0.75) gave only 35 % of
the static take-off thrust at -17.5 deg. The PT6A-67 test-bed uses a thin, lightly cambered section (zero lift
-2 deg, cl -1.0) and 1.4 x the 172's chord (activity factor 127 per blade): 16.1 kN static at the torque limit,
-6.7 kN in full reverse (41.7 %; acceptance band 40-70 %, ESTIMATE), zero static thrust at -4.5 deg. The real
PC-12 absorbs 900 shp in maximum reverse (47E, 34.25 psi); this blade absorbs about 500 shp there, so the PC-12's
calibration (P1) will want its blade's negative side checked against that row.

### Conformance plumbing

- `tests/fdm/measure.ts`: `LandingOptions.rollReverse` (the lever aft of the gate from touchdown) and
  `rollReverseCancel {kias, to}` (the lever forward below a speed); `StallRun.shakerCas`, `pusherCas`, `pusherKias`
  (first `AircraftState.stickShaker` / `stickPusher`); `idleTaxi(rig, {reverse, condition, brakes?})`: static
  thrust, Np, Ng and ITT on the parking brake after 10 s, then the steady unbraked speed (signed) and Np.
- `tests/conformance/targets.ts`, `plan.ts`: `stall.trip 'pusher'` (stall speed = the first push; margin = the
  shaker's, else the stall warning's, above it); `landing.reverse`, `landing.reverseCancel`, `landing.withReverse
  {reverse, groundRollM, ratio?}` (a second roll); `ground.idleTaxi` cases (`label, reverse, condition,
  idleTaxiKt?, idleNp?, staticThrustN?, idleNgPct?, idleIttC?`) as the flown-tier block 'idle taxi'.
- `src/sim/autoflight.ts`: `AutoflightProfile.rollout.reverse {lever, cancelKias}`: the lever aft after touchdown,
  back to the gate below `cancelKias` and when stopped, and on the gate on the take-off roll and in the flare; a
  profile without it never writes the control.

### Hand-overs and known issues (T1a)

1. **No STARTER INTERRUPT control.** A second press of `starter` is the interrupt. `ControlInputs.starterInterrupt`
   (held, per engine) would be the overhead switch: requested from the integrator, bound by T1b.
2. **The latched starter is not in `EngineState`.** Panels, lamps, audio and the UI read `controls.starter`, which
   on a latching type is only the press. `EngineState.starterEngaged?` (written by the unit only when
   `starterLatch` is defined) is requested from the integrator; until then `EngineUnit.starterEngaged`. The latch is
   not in the resume snapshot either (`interfaces.ts`): a restore disengages it.
3. **Reverse held into the stop with full brakes.** On the C208 with the test-bed's beta range grafted on, full
   reverse held to the stop with full brakes sat the aircraft back at walking pace (pitch 19 deg, nose and left
   wheels off) and collapsed the right main leg (70 kN). Out of reverse to ground fine below 40 KIAS it stops in
   209 m (ground fine throughout 221 m, on the gate 292 m; flaps 30, 80 KTAS approach, full braking). For the gear
   owner (P1) and T1b; the conformance roll has `reverseCancel` meanwhile.
4. **C208 idle on the gate as built** (no beta yet): at LOW IDLE 670 N static with Np 500 rpm, and it does not break
   away; at HIGH IDLE 3.5 kN, Np 1124 rpm, and unbraked it runs to 69 kt without settling. T1b's lever positions
   (a)-(c) calibrate this.
5. **Windmilling in the beta range at speed.** Between about -6 and +6 deg at 80 kt the test-bed blade drives the
   shaft; the valve takes the blades through it in about 0.4 s and the topping reset holds Np.
6. **Torque limiter dynamics.** The cap is the steady solution (no pneumatic lag); transients overshoot only by the
   gas generator's fuel ratio. The MOR and the limiter's failure modes are not modelled.

## Not modelled yet (next steps)

1. **Windmilling gas generator.** After an in-flight flame-out, Ng spools down to 0 instead of windmilling at
   10–15 %.
2. **Other output stages.** Turboshaft (feeding `rotorcraft`; the rotor governor would trim Ng), turbojet and
   turbofan (thrust from nozzle and fan, no propeller), and the single-shaft TPE331 (Np = Ng, with
   underspeed/fuel governing and negative-torque sensing).
3. **Engine controls.** FADEC/EEC limiters (torque, ITT, Ng) for newer engines; auto-ignition; bleed air and
   inertial separator (ITT and power penalties); engine anti-ice.
4. **Exceedance logging.** ITT, torque and Ng over-limits for the instructor and the debrief.
5. **Aircraft integration.** Turbine instruments (torque, ITT, Ng, Np, fuel flow), turbine audio (whine instead of
   combustion), `tests/aircraft/consistency.ts` rules for `kind 'freeTurbine'`, and the flight model's
   control defaults (it currently special-cases `fadec`).

The running line in the test-bed is a plausible PT6 shape, not a P&WC deck. A real type should calibrate the map
(fuel flow, ITT and power against Ng) against its POH cruise and climb tables.
