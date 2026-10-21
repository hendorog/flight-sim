# MBB Bo 105 CB-4 panel, UI, checklists, training (package PN)

Sources: BO 105 CB-5/CBS-5 Flight Manual used for the CB-4 (P5; Sections 2-4 and 7: Fig 2-2, 2-18..2-21, 3-1..3-45, 4-8..4-18,
Fig 7-2..7-5), EASA TCDS R.011 Issue 3 pp 9-11 (P), BO 105 Training Manual (P TM; 00-24..00-50), research-bo105.md sections 3-6, 11-13.
Tags: P primary, P5 CB-5 FM used for the CB-4, D derived, ESTIMATE no source. The FM text was paraphrased, never copied.
Everything not in the owner notes is an AGENT choice (the CB-4 variant, an analogue VFR panel with an AGENT attitude indicator and DG,
the arrangement of the switches on the pedestal canvas).

## What is on the face (`src/aircraft/bo105/panel.ts`, `panelGauges.ts`, `panelMarkings.ts`)

The face is the frozen 0.34 x 0.62 m pedestal (816 x 1488 px, `BO105_PANEL_FACE/CANVAS/OUTLINE` unchanged; instruments on
`BO105_COLS` / `BO105_ROWS`). The 3-1/8 in instruments are drawn at 1.06 times the native art so seven rows fit the 200 px pitch.

| Row | Left | Centre | Right | Tag |
| --- | --- | --- | --- | --- |
| 1 | F 1 fire lens (press = fire test), attitude indicator (AGENT, 2-1/4 in) | caution segment block, two lenses a row | DG (AGENT), F 2 fire lens | P5 FM Fig 7-3, 4-9; AGENT |
| 2 | ASI 10-150 kt | (block continues) | altimeter | P5 FM 2-18, P TM 00-32 |
| 3 | PWR 1 and PWR 2 levers (FLIGHT / IDLE / OFF) | clock / OAT | VSI +/-6000 ft/min | P5 FM 7-12 (lever stops); ESTIMATE (dial map) |
| 4 | mast-moment indicator | dual torque % (needles 1, 2) | triple tach (N2 1, N2 2, NR) | P5 FM 2-17, 2-19, 2-21 |
| 5 | triple oil temperature (1, 2, R) | TOT 1 | TOT 2 | P5 FM 2-18, 2-20 |
| 6 | IGNITION 1/2 and STARTER 1/2 group, MM TEST | N1 1 | N1 2 | P5 FM 7-4 |
| 7 | triple oil pressure (1, 2, R) | fuel quantity S / M | fuel pressure 1 / 2 | P5 FM 2-20, 2-21 |
| strip | BAT, GEN 1, GEN 2, PUMP 1, PUMP 2, guarded VALVE 1, VALVE 2, ANTI-COLL, POS LT, LDG LT; INSTR and CONSOLE dimmers | | | P5 FM Fig 7-4, 7-5; order ESTIMATE |

Markings (all band boundaries are published limits; the spacing of the numbers is artwork ESTIMATE):

| Gauge | Bands | Source |
| --- | --- | --- |
| ASI | yellow 10-45, green 45-145, red radial 145, **blue radial 100** (power-off Vne) | P5 FM 2-18 |
| Dual torque | green 0-86 %, red radials 86 and 95; 100 % = 298 kW at 6016 rpm = 473.0 N m (257 kW = 86 %, 283 kW = 95 %) | P TCDS p9; D |
| Triple tach | N2: red dot 95, radial 98, green 98-102, radial 102, dot 105. NR power off: radial 85, green 85-110, radial 110 | P5 FM 2-19, TCDS p10 |
| TOT | green 0-779, yellow 779-810, red radial 810, red dots 843 and 927 (drawn as thin arcs) | P5 FM 2-19, TCDS p9 |
| N1 | green 59-105, red radial 105 | P5 FM 2-18 |
| Oil temperature | engines green 30-107, radial 107; transmission (R) green 30-105, radial 105 | P5 FM 2-20 |
| Oil pressure, kp/cm2 | engines radial 3.5, yellow 3.5-6.3, green 6.3-9.1, radial 9.1; transmission radial 0.5, yellow 0.5-0.8, green 0.8-2.0 | P5 FM 2-20, 2-10 |
| Fuel pressure | yellow 0-0.6, green 0.6-1.7, radial 1.7 kp/cm2 | P5 FM 2-21 |
| Fuel S / M | S 0-100 kg with the red LOW FUEL dot at 60 kg, M 0-400 kg (usable 74 + 382 kg) | P TCDS p9; P5 FM 3-13 |
| Mast moment | green / yellow / red, LIMIT lamp, CAL, TEST. **No numbers are published**: LIMIT = hub `mastMomentLimit`, yellow from `mastMomentYellow`; the fallback until BO sets them is 32 kN m with yellow at 50 % (ESTIMATE: 16.5 deg of TPP-to-shaft tilt x the UNVERIFIED K_beta 113,000 N m/rad) | P5 FM 2-16, 7-13; ESTIMATE |

Torque is `EngineState.torque x 100 / 473.0` per engine (`engines[i].torqueNm`); N2 % is `engines[i].rpm / 6016` (the tach lag of 0.15 s
applies); NR is `rotorRpmPct` (`RotorcraftState.rotorRpm / 424.5`); TOT and N1 are `engines[i].ittC / ngPct`; the third pointers of the
triple oil gauges read `rotorcraft.transmission`; the mast moment reads `rotorcraft.mastMoment` as a percent of the LIMIT through the new
`InstrumentSystemsDef.extra` (see Seams).

### Lenses (`BO105_INSTRUMENT_SYSTEMS.lamps`; all need bus power > 18 V, P5 FM 4-9 lamp test)

| Lens | Rule | Source |
| --- | --- | --- |
| RPM (flashes at 2 Hz) | the twin warning unit's flags `twinTurboshaft.n1SplitLight / nrLowLight / nrHighLight` (N1 split 12 %, NR 95 % or less, NR 103 % or more) | P5 FM 3-16, P TM 00-44 |
| GEN 1 / GEN 2 | that engine's generator switch off, or the engine not running | P5 FM 3-7 |
| T OIL | transmission oil under 0.5 kp/cm2 or over 105 C (or no transmission state) | P5 FM 3-17 |
| LOW FUEL | supply tank (`fuel.left`) under 60 kg | P5 FM 3-13 |
| OIL COOL | NR under 20 % (the fan stops with the rotor) | P5 FM 3-9 shutdown |
| F 1 / F 2, HY BLOCK, FILT, HYD, MAG PLUG, BAT 60 / 70 | test only: no flight-model state | |
| LAMP TEST | lights every lens except F 1/2, LOW FUEL and MM LIMIT (each has its own test: press the lens, hold MM TEST, the LOW FUEL lens) | P5 FM 4-9 |

All segments are red (research-bo105 section 12: "red warning segments").

## Fixed 2-D view

Upper: the basic flight instruments (ASI, AI, altimeter, VSI, DG, clock), the tach, mast moment, torque and both TOTs, and the lenses in a
column; Lower: the rest of the engine monitoring (N1, oil, fuel), the PWR levers, MM TEST, the ignition and starter group and the switch
strip. Every hotspot is reachable at the five window sizes of `tests/instruments/fixedPanel.test.ts`. The power levers are `positionSwitch`
controls on `ControlInputs.engines[i].throttle` with the FM stops (OFF below 0.05, IDLE 0.25, FLIGHT 1; `BO105_POWER_LEVER`).

## Compromises (KNOWN_ISSUES rows for the integrator)

1. **The overhead power levers and the console / overhead switches are painted on the pedestal canvas** (one texture, as the MD 500E's lower
   console is) because the 3D cockpit has one panel face. BX's overhead console, centre console and hanging levers are geometry; clicks reach
   the controls through this canvas only.
2. **Dots are thin arcs** (TOT 843 / 927, fuel LOW mark): the shared dial renderer has no dot primitive.
3. **Dial spacing is artwork** (no scale drawing was found). The triple dials draw both engines' pointers on the outer scale and R on an inner scale.
4. **Mast-moment numbers are not published**: LIMIT and yellow come from the hub definition (BO); the fallback is flagged above.
5. **Fuel S / M assumes `fuel.left` = supply tank (74 kg usable) and `fuel.right` = main tank (382 kg)**: BO builds them so.
6. **Only the generators, supply-tank pumps, guarded emergency valves and lights are switches.** The overhead main-tank pumps, GEN TRIP / GEN RES,
   HYDR TEST, LOW FUEL TEST switch, anti-icing, pitot heat, the voltmeter / ammeter and the circuit breakers are not drawn: the sim has no state for them.
7. **The two INSTR / CONSOLE dimmers set one panel-light level** (`lights.panel`).
8. **The ignition group draws one IGNITION switch per engine and a STARTER rocker whose halves crank engine 1 / 2** (the shared `toggles` group); the real STARTER/GENERATOR switch is three-position (START - OFF - GEN ON) and the generator is a separate switch here.
9. **HY BLOCK, FILT, HYD, MAG PLUG, BAT 60 / 70 never light** except on the lamp test: nothing models them.
10. **The HUD readout block of 11 rows is partly hidden by the flight-cue panel at 900 px high** (the same as the PA-34's 14 rows; `ui/hud.ts` CSS).

## Contract requests

* BO: set `reference` in `index.ts` from `BO105_REFERENCE` (the consistency test reads `reference.vne` 145 against the ASI red radial; it fails at 152 until then);
  publish `rotorcraft.transmission` (`oilPressurePsi`, `oilTemperatureC`); put the supply tank in `fuel.left` and the main tank in `fuel.right`; set
  `hubModel.mastMomentLimit` / `mastMomentYellow`; per-engine `oilPressure`, `oilTemp`, `fuelPressure` on `state.engines[i]`.
* TW: `state.engines[1].rpm` is the N2 shaft speed in rpm, `torque` the output-shaft N m (100 % = 473.0 N m), `running` true while the generator can be on line;
  the `twinTurboshaft` warning flags are what the RPM lens flashes on.
* BX: the pedestal canvas carries the working power-lever twins and switch strip; the hanging levers and consoles may stay visual only.

## UI (`ui.ts`), checklists (`checklists.ts`), training (`training.ts`), dev mock (`devMock.ts`)

HUD levers: COLL, PWR 1, PWR 2 (OFF / IDLE / FLIGHT), N2 SET (marker over the 98-102 % beep range), SPLIT (ENGINE TRIM left / right, centred bar);
readouts TQ 1/2 %, TOT 1/2, N1 1/2, N2/NR % (flags N1 SPLIT, NR LOW, NR HIGH, OEI), MAST MOM % (LIMIT), VNE. `starterAdvice`: "STARTER/GEN to
START; at 12-15 % N1 lever to IDLE; rotor turning by 25 %; starter off at 58 %" after BAT, valve and collective checks. The start-up card and
nine hints cover the lamp test, the start, ENGINE TRIM, the warnings, the mast moment and the limits.

Checklists paraphrased from FM Sections 3-4 with `live` checks per engine: before start, engine start (each engine), system checks, pre-take-off
(N2 trim 98 %, torque synchronise = manual), hover check, take-off and climb, cruise (82 % torque / 738 C), after landing, shutdown (2 min IDLE,
levers OFF, battery on until the rotor stops), deceleration check; emergencies: single engine failure, double engine failure and autorotation (75 KIAS),
RPM warning, governor failure (over / under speed, driveshaft, droop), in-flight restart, tail-rotor drive failure, hydraulic, engine fire, generator
and battery, LOW FUEL and T OIL.

Training: `classRating null`, `school false`, Vne 145, Vy 60, Vdescent 75 (recommended autorotation), Vglide 100 (maximum range at 85 % NR); the
60 KIAS minimum-descent speed is in the checklist text (the V-speed table has one descent slot). Run-up N2 98 %.

`devMock` (dev page `dev/instruments.html?type=bo105&freeze=1&t=60`; `?split=1` autorotation): dead panel, two staggered starts, flight with a split of
about 4 % torque, a mast-moment spike into LIMIT at 150-156 s, then engine 2 fails at 200 s.

## Seams added to the shared instrument code (all additive; absent = the old behaviour)

`InstrumentSystemsDef.extra` / `InstrumentReadings.extra` (bespoke readings from the state), `GaugeDef 'customRect'`, `twinNeedle.letters`,
`gearLights.noseLegend`, `ignition.sides`, `annunciator.clipGlow`, `PanelDef.fixed.lower`, three checklist-frame signals (`checklist.tailWheelLock`,
`propLever`, `propBeta`, `gyroIcs`). The other types do not use them; their tests are unchanged.

## Tests

`tests/aircraft/bo105Setup.test.ts` (face, rows, levers, switches, fixed view, dev mock, UI, training, checklists per engine) and
`tests/instruments/bo105Panel.test.ts` (markings, gauges, readings, lenses). Known failing guard until BO lands: `consistency.test.ts` "bo105:
airspeed red line: reference 152, panel 145".
