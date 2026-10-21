# Lockheed AH-56A Cheyenne rear-seat panel, UI, checklists, training (package PN)

**The panel is an AGENT reconstruction and UNVERIFIED.** No photograph or drawing of the rear (pilot) panel is in the sources
(research-ah56.md section 12, gap section 16). The panel says so on its face. What the reports state is used: rectangular vertical-tape
gauges for torque, TIT, Ng, Nf and Nr that the Army found small and hard to read (ASTA-72 para 73e); the collective blade angle and the prop
blade angle read out in degrees (SoF; ASTA-72 App H p 87); an accelerometer recommended (APE-I para 134f); MASTER CAUTION in both cockpits
with a small caution panel (APE-I para 134j); triple hydraulics (1, 1A, 2); the gear handle, the tail-wheel lock lever and the ICS "roll
compensator" and "pitch desensitizer" push buttons (ASTA-72 paras 71-72).

Sources: ASTA-72 = USAASTA 72-08 (ICS aircraft 66-8834; SoF App E pp 64-74, paras 66-81), AMCS-73 = USAASTA 72-44 (AMCS ship 7 66-8832; SoF
pp 36-39), APE-I = USAASTA 70-02/71-17 (SoF 1.1 para 4). Tags: P primary, D derived, S secondary, INF inference, ESTIMATE no source.

## What is on the face (`src/aircraft/ah56/panel.ts`, `panelGauges.ts`, `panelMarkings.ts`)

Canvas 1488 x 960 (frozen `AH56_PANEL_*`; the tape stack of the frozen `AH56_TAPE_STACK` x 620 - 868 holds four tapes).

| Zone | Content | Tag |
| --- | --- | --- |
| Left, top | basic T: ASI (green 40-195 ESTIMATE, red radial at the INF Vne 195, mark at the 130 gear limit) | ASI marks ESTIMATE |
| | ADI (with slip ball), altimeter; HSI under the ADI, clock, VSI under the arms | AGENT |
| Left, middle | collective blade-angle indicator (digital + scale, AMCS 4.5-21.5, cruise 13) and prop blade-angle indicator (scale -20..45, marks REV -12, HOVER -2.2, AUTO +8, green -17.2..+40.8) | P AMCS-73 SoF 2b; P ASTA-72 paras 66-67 |
| | g-meter (green 0.25-2.5), fuel quantity lb x100 (red 0-390 lb), engine oil T / P (T green 0-107, yellow to 150; P green 10-83), transmission oil T / P (T green 0-113, yellow to 140; P green 70-110) | P AMCS-73 paras 38-41; P APE-I / ASTA-72 SoF |
| | triple hydraulic bars 1, 1A, 2 (normal 2800-3400 psi) | P APE-I SoF 1.1 |
| Centre top | MASTER CAUTION and seven lenses: LOW FUEL, XMSN OIL PRESS, ENG OIL PRESS, TIT HIGH, NR LOW, GEAR UNSAFE, TORQUE HIGH, LAMP TEST | AGENT legends |
| Centre | four tapes: **torque** (green 0-114 %, red above; 100 % = 3435 shp = 1799 N m at 13,600 rpm), **TIT** (green 300-740, yellow 740-780, red from 785, radial 740, blue 720 "record time above"), **Ng** (radial 58, green 63-100, yellow to 101.5, red above), **Nf / Nr** (two bars: Nf yellow 95-98, green 98-105; Nr radials 85, 95, 105, 110) | P ASTA-72 SoF para 5; AMCS-73; APE-I SoF 1.1 |
| Centre bottom | control-system placard: AMCS (default) or ICS from `controlGyro.mode`; in the ICS the two augmentation buttons ROLL COMP and PITCH DESENS are drawn engaged and "STIRS > 0.5 Hz PROHIBITED" is placarded; in the AMCS "STICK RELEASED = ATTITUDE HELD" | P ASTA-72 paras 71-72, SoF 4h(2); AGENT |
| Right | gear handle with its lights (the tail wheel in the first lamp, legend TAIL), tail-wheel lock lever (LOCKED / UNLOCKED on `tailWheelLock`), ignition + START group, switches BAT, GEN, BOOST PUMP, ANTI-COLL, POS LT, LDG LT, PNL LT | P APE-I 134a; order ESTIMATE |

Readings: torque `EngineState.torque / 1799 x 100` through `InstrumentSystemsDef.extra` (so the engine's `torque` must be the power-turbine shaft torque in N m);
TIT `ittC`, Ng `ngPct`; Nf `engines[0].rpm / 13,600` (the power turbine, 13,600 rpm = 100 %, S); Nr `rotorRpmPct` (of 246 rpm: the AMCS aircraft shows 97.5 %).
Collective as the cockpit indicator reads it (`ah56CollectiveIndicatedDeg`): with the control gyro in the definition, the blade collective plus the configuration's
`collectiveIndicatedOffset` (AMCS +7 deg, ICS 0, D from "13 deg AMCS = 6 deg ICS"); until AG lands the gyro, the AMCS indicated range 4.5-21.5 deg mapped on the lever,
less 7 deg for the ICS. Prop beta: `rotorcraft.pusher.beta` in degrees; blank ("--.-") until the pusher exists.

### Lenses (all need bus power; LAMP TEST lights them all; MASTER CAUTION follows the others, it is not latched)

LOW FUEL at 390 lb (P); XMSN OIL PRESS under 70 psi with the rotor turning (ESTIMATE threshold; the 1972 minimum is the marking, P); ENG OIL PRESS under 10 psi while running (P minimum);
TIT HIGH over 740 C (P); NR LOW under 95 % with Ng over 90 % (the power-on minimum, P; the Ng gate is ESTIMATE); GEAR UNSAFE while the gear is in transit; TORQUE HIGH over 114 % (P).

## Fixed 2-D view

Upper: the basic T, the clock, the two blade-angle indicators, the whole tape stack as one crop, the g-meter, fuel and the two oil gauges, and the lenses in a column.
Lower: gear handle and lights, tail-wheel lever, hydraulics, the control-system placard, the starter group and the switches. Every hotspot is reachable at the five window sizes.

## Compromises (KNOWN_ISSUES rows for the integrator)

1. **The whole arrangement is a reconstruction** (UNVERIFIED): positions, sizes, the digital readouts, the lens list and legends are AGENT choices.
2. **ASI markings are ESTIMATE**: the sources give no ASI marking; Vne 195 KCAS is INF.
3. **No hydraulic model**: the three bars indicate 3000 psi while the rotor turns and zero when it is stopped (ESTIMATE).
4. **The ICS buttons are drawn engaged and are not switches**: the sim has no `ControlInputs` field for the roll compensator or the pitch desensitizer (they run whenever the ICS flies). Contract request below.
5. **The APU, the abort-stop button, the rotor brake, the directional trim switch and the Nf ALTERNATE switch are not drawn** (no controls modelled).
6. **Transmission oil temperature / pressure and engine oil** read the shared `transmission` block and the engine's oil model; until AG publishes them the gauges and the lenses read what the scaffold gives.
7. **The tail wheel is gear lamp 1** (the shared `GearState` keeps the "nose" slot): the lamp is lettered TAIL.
8. **Dots / marks** are radials and thin bands; the shared renderers have no dot primitive.
9. **`training.vspeeds.Vy` is 80** only because the generic rotorcraft check needs a positive value: it is the collective-schedule break speed, not a best-climb speed (no lesson reads it).
10. **The emergency lists for the prop system control failure, the stick-centring malfunction and the engine control failure are AGENT condensations** (the sources name them, they give no steps) and say UNVERIFIED.

## Contract requests

* AG: `index.ts` must set `reference` from `AH56_REFERENCE` (the consistency test reads `reference.vne` 195 against the ASI red radial; it fails at 152 until then);
  `EngineState.torque` = power-turbine shaft N m (100 % = 1799 N m), `ng`, `itt`; `transmission` state; `gear.retractable` with the tail wheel in slot 0; a default
  for `tailWheelLock`; `controlGyro` default and `collectiveIndicatedOffset` as in `controlGyro.ts`; the blade pitch range `main.minPitch / maxPitch` as the ICS-referenced collective angle.
* AC: `rotorcraft.pusher.beta` (rad, at 0.7 R) and `deltaBeta`.
* Integrator: if the ICS roll compensator and pitch desensitizer should be switchable, add `ControlInputs` fields; the panel buttons then bind to them.

## UI (`ui.ts`), checklists (`checklists.ts`), training (`training.ts`), dev mock (`devMock.ts`)

HUD levers: COLL (indicated degrees), PROP BETA (degrees), GRIP (OFF / IDLE / RUN), Nf SET, GEAR, TAIL WHL; readouts TQ %, TIT, Ng, Nf/Nr, CONTROL (AMCS / ICS), G, VNE.
Hints: prop snap keys (hover detent -2.2, autorotation +8, reverse -12), "Cyclic stirs above 0.5 Hz prohibited (ICS)", "stick released = attitude held (AMCS)", the condition grip keys, landing and
autorotation rules. Checklists from the SoF releases and ASTA-72: normal (before start with the Nf beep DECR for 5 s, start with the condition grip to IDLE at 20 % Ng,
after start, run-up, before take-off with the tail wheel locked and the prop at the detent, take-off and climb, cruise, descent and landing with reverse prop and brakes,
after landing, shutdown with the rotor brake below 40 % Nr, engine off and TIT under 320 C); emergencies (engine failure, prop system control failure, stick-centring malfunction, engine control failure,
blade moment stall (ICS), half-P hop (ICS)).

`devMock` (`dev/instruments.html?type=ah56&freeze=1&t=90`, `&config=ics`): start, hover at -2.2 deg, acceleration with beta 8 to 22 deg and collective 13 deg, an engine failure with the delta-beta cut at 200 s.

## Tests

`tests/aircraft/ah56Setup.test.ts` and `tests/instruments/ah56Panel.test.ts`. Known failing guard until AG lands: `consistency.test.ts` "ah56: airspeed red line: reference 152, panel 195".
