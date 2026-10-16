# Turboshaft output stage (the MD 500E's 250-C20B)

How a free-turbine turboshaft drives a helicopter in this simulator: the twist grip, the power-turbine (N2)
governor, the freewheel and the warnings. Package T2 of the PC-12/MD 500 feature (plan §3.3). Code:
`src/physics/rotorcraft/turboshaft.ts` (the fuel control and governor, `TurboshaftControl`),
`src/physics/rotorcraft/rotorcraft.ts` (`driveFreewheel`), `src/physics/flightModel.ts` (the call in place of
`Rotorcraft.throttle()` and the steady-engine reset), data in `src/aircraft/md500/{rotorcraft,powerplant,facts}.ts`.
Every number below is from the MD 500E acceptance tests (`tests/rotorcraft/md500Systems.test.ts`,
`md500Performance.test.ts`), SL ISA unless stated.

## 1. The engine is the existing turbine core

The 250-C20B is an `EngineDef` of kind `'freeTurbine'` (`propulsion/turbineEngine.ts`, `gasGenerator.ts`, owned by
the turbine-core package) with one difference from the turboprops: its "crank" is the **engine output shaft**
(`gearRatio 1`, `ratedRpm` = N2 100 % = 6016 rpm), so

- `EngineState.torque` is the torquemeter torque: gauge psi = torque × `MD500_PSI_PER_NM` (318 ft·lbf = 87.2 psi,
  TCDS H3WE p12);
- the whole N2 → Nr reduction (12.594:1) is `RotorcraftDefinition.engineRatio`, and the existing comparisons of
  `engine.omega` with `rotor.omega × engineRatio` hold (they agree only with `gearRatio 1`, codemap §2.3 (f));
- the engine unit runs with `externalDrive` (no propeller loads; the R22's pattern), its compatibility propeller
  weighing nothing.

Nothing in the turbine core was changed. The gas producer's corrected running line (fuel, TOT, gas power against N1)
is fitted in `md500/powerplant.ts` (section 5 below).

## 2. Twist grip and fuel control

`ControlInputs.throttle` is the grip: CUTOFF below 0.05, the GROUND IDLE stop at 0.18, FULL OPEN at 1
(`MD500_TWIST_GRIP`; RFM 4-11, Fig 4-4; the fractions are an AGENT choice, the input profile's `twistGrip`
deep-equals them). Each physics step, `TurboshaftControl.stepTurboshaft(dt, c, engine, out, busVolts)` replaces
`Rotorcraft.throttle()` (which is unchanged) and writes the engine's levers:

| Output | Law |
| --- | --- |
| `out.mixture` (fuel shut-off) | 0 below CUTOFF, else 1 |
| PLA schedule | N1 = ground idle (64.5 %) up to the idle stop, then linear to 105 % (`fcu.maxNg`) at FULL OPEN |
| PTG demand | `datum + anticipation × collective + gain × (set − N2 − lead × dN2/dt) + integral` |
| N1 demand | `min(PLA, max(PTG, ground idle))`: the governor never asks for less than ground idle, the grip caps it |
| `out.throttle` | the PLA-equivalent lever: with `fcu.lowIdleNg = highIdleNg = plaNg.groundIdle` and `maxNg = plaNg.fullOpen`, `turbineEngine`'s lever law inverts exactly |
| `out.magnetos` | 3 (continuous ignition) while RE-IGN P RST is lit, else the pilot's switch |
| `out.engines` | a fresh `[{}]`: no per-engine override masks the scalars |

The fuel topping governor at 108 % N2 stays in the core (`powerTurbine.topping`). The PTG is hydromechanical (no bus
power needed); only the beep actuator (N2 GOV breaker) needs the bus.

## 3. The N2 governor

A proportional governor with **droop** and a collective **droop compensator**, stiffened by an integral that acts
only in transients:

- the integral drives `(set − N2)` toward `droop × (PTG − datum − anticipation × collective)`, so in the steady
  state **N2 = set − droop × (N1 − datum − anticipation × collective)**;
- `droop` 0.05 (5 % N2 per unit N1) and `anticipation` 0.65 N1 per unit collective; the datum `datumNg` 0.784 is the
  flat-pitch N1 on the ground at 103 % N2, so **the beep set point reads at flat pitch** (the RFM 4-18 run-up
  check works: high stop 104.5 %, low stop 97.6 % at flat pitch);
- the two constants are fixed by two rows that pull opposite ways. Unloaded in autorotation (N1 about 66 %,
  collective near flat pitch) the droop puts N2 above the set by `droop × (datum + anticipation × collective − N1)`,
  which must stay within 1 % (plan 6.6); at take-off power the compensator must over-compensate by ½–1 %. The first
  draft (droop 0.1, anticipation 0.535) gave 1.56 % in autorotation; 0.05 / 0.65 gives 0.8 % there and keeps the
  take-off row;
- over-compensation: from 103.0 % set at flat pitch, a climb at 87 psi holds **N2 103.68 %** (RFM 4-22: "N2
  should increase ½ to 1 percent on take-off"; row 103.5–104.0 %);
- gains 4 and 1.5 /s, lead 0.15 s, calibrated to the transient rows: hover → 90.7 psi in 2 s: N2 min 102.89 % (row ≥
  100.5 %); a 1 s snatch: 102.77 % (row ≥ 98.5 %), no ENG OUT, never more than 0.5 % from its settled value; then
  a 1 s collective dump peaks N2 at 104.9–105.0 % (row ≤ 106 %, Fig 2-2). The compensator is what makes the 500
  stiff: the droop on a collective snatch is under 0.3 %.
- Grip below FULL OPEN, or `ControlInputs.rotorGovernor === false` (the governor-failure case, RFM 3-14/3-15):
  `governorMode 'manual'`, the grip alone sets N1, the integral tracks for a bumpless return.
- The beep moves the set point at 1 %/s (`beepRate` 0.01) within 97.5–104.5 % (`MD500_N2_BEEP`; RFM 4-18: high 104–105,
  low 98 or less).
- A reset trims the governor quasi-steadily (section 6), choosing the set point a pilot would have beeped to hold
  103 % in that condition; a hover reset therefore reads about 102.25 % set with N2 at 103.0 % (a cruise reset at
  60 KIAS about 102.3 %).

## 4. Freewheel

`systems.drive 'freewheel'` (`Rotorcraft.driveFreewheel`): the belt path's one-way impulse coupling (the engine can
drive the rotor, never be driven by it), with no actuator (`clutchEngagement ≡ 1`, no CLUTCH light,
`clutchDisengaged` absent) and the transmission torque limit (twice the 97.6 psi transient, 965 N·m at the output
shaft; never binds) as the cap. The legacy belt path is byte-identical (the s269Legacy and contactAirborne digests
pass). On the 0.1 kg·m² output side against the rotor's 2.3 kg·m² reflected inertia the impulse coupling is stable
at 240 Hz and at the app's rate (plan §11 asked; the reset-to-hover holds N2 within 0.01 % for 10 s).

`needlesSplit` (RotorcraftState.turboshaft) is set when Nr × ratio is above N2 by more than 1 %: autorotation and
shutdown. Measured: grip FULL OPEN in autorotation at 3000 lb with Nr held at 510 rpm (106.7 %) by the collective,
N2 settles at 103.13 % against the beep set of 102.31 % (0.82 % above it: the droop of an unloaded governor, N1
65.9 %; row ±1 %; peak 103.6 %, never near 108 %), split; grip at idle in autorotation at 2250 lb, Nr 101.5 % and N2 95.7 % (split 5.8 %, row > 5 %);
powered flight, needles together; shutdowns from 103 % and from ground idle split within 0.05 s with the rotor
lagging.

## 5. Unloaded power turbine (why the loss is 20 kW, not 4–8 kW)

Two rows fix the engine at idle: on the ground with the grip at idle the rotor must turn at **N2 55–70 %** (below
the 75–88 % avoid band), and in autorotation with the grip FULL OPEN the unloaded power turbine must stay below the
governor's set point (so the governor holds it) and far below the 108 % topping. The turbine core's power-turbine
law is torque = (gas power / design speed) × (a − (a − 1) N2/N2d) with a fixed stall-torque ratio `a`: at idle gas
power the unloaded runaway speed is set only by the friction.

With the plan's 4–8 kW loss, the idle gas power that the loss absorbs at 98 % N2 is so small that, coupled to the
flat-pitch rotor (about 45 kW at 100 %), the ground-idle N2 would be about 30 %. A real free turbine's runaway speed
falls with its gas energy (at idle the jet velocity is low); the fixed-`a` law cannot make that. The MD 500's numbers
therefore use:

- `stallTorqueRatio` 3 (the top of the 2–3 range for helicopter power turbines);
- `friction [0.2 N·m, 4.8 N·m per 1000 rpm]` at the output shaft: **20 kW at 100 % N2**, of which about 4 kW is the
  gear train; the rest stands in for the low runaway speed at idle;
- ground-idle gas power 16 kW at 64.5 % N1.

Result: ground idle **N2 59 %** (row 55–70), unloaded idle in flight **95.7 %** (below 103 % and 108 %). The loss is
inside the brake torque (the gauge reads after it), so it costs fuel, not torque: the running line's fuel flow is
fitted with it included.

**Contract request (turbine-core package):** a power-dependent power-turbine characteristic in `TurbineDef.powerTurbine`
(a stall-torque ratio or runaway speed that varies with gas power). With it the MD 500's friction returns to the gear
train's 4–5 kW.

## 6. Reset (trim) with a gas turbine

`flightModel.resetRotorcraft` trims a turboshaft with the engine unit in **steady** mode: each of 40 bisection probes
evaluates the gas generator at the governed N1 with the TOT settled, instead of the piston path's 20 × 0.4 s stepped
probes that would catch the spool mid-acceleration. The governor's integral and set point are then solved for that
N1 at the reset N2 (`steadyIntegral`, `steadySetPct`). Measured: reset to hover at 3000 lb, Nr 492.0 rpm, N2
103.00 %, no transient (|ΔN2| < 0.01 % over 2 s). On the ground the cyclic is placed at its rigging neutral (RFM
4-12) and the skids give the 4.7° nose-up attitude.

## 7. Engine out, horn and auto-reignition

`TurboshaftControl.publish` (after the coupling):

- **ENGINE OUT** (light, `lowRpmLight` on this type): N1 < 55 % or Nr < 468 rpm, with bus power (RFM 3-3). The low-rotor
  half arms once Nr has reached 468 rpm and disarms below 70 % Nr **on the ground only** (skids loaded; ESTIMATE:
  RFM 4-16 has every warning out at ground idle, where Nr is about 59 %). In flight it never disarms: full collective
  with the grip at idle from a 3000 lb hover keeps the light and horn on down to Nr 131 rpm (27 %) with N1 at 64 %; so the light is on at battery ON, goes out at N1 55 % during the start, and comes on
  at N1 55 % at a shutdown from idle (or at Nr 468 on a shutdown from 103 %).
- **Horn**: the light with the generator switch ON (pre-generic and late-generic harness, RFM 3-25 note; the start is
  made with GEN OFF, so it is silent).
- **RE-IGN P RST**: latched when the warning comes on with the system armed (transmission oil pressure above 5 psi,
  ESTIMATE; RFM 1-13); it fires the igniter (`out.magnetos 3`) until the pilot presses the light (`lampTestId
  'reign'`) with N1 and Nr back (generic harness). A flame-out with the grip left open relights on its own.
- `overTorque` (> 87.2 psi), `overTemp` (> 810 °C), `avoidRange` (N2 75–88 %), the 5-minute take-off timer on psi above
  MCP (81.3, or 74.3 above 738 °C TOT) or TOT above 755 °C, and `powerLimitExceeded` from these and N1 > 105 %.

## 8. What the existing fields mean on a turboshaft

As declared in `definition.ts`: `clutchEngagement 1`, `clutchLight false`, `governorActive = governorMode ===
'governed'`, `lowRpmLight/lowRpmHorn = engineOutLight/engineOutHorn`, `governorThrottle` = the PTG output (the
PLA-equivalent lever), `powerLimitExceeded` from psi, TOT and N1. N1 and TOT are not duplicated: read
`EngineState.ng` and `EngineState.itt`.
