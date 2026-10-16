# Pilatus PC-12/47 flight model

The PC-12/47 (PT6A-67B, MSN 684–888) as `src/aircraft/pc12/`: what the flight model is, which numbers were moved to
calibrate it, and what it measures against its targets. Sources and readings: [pc12-sources.md](pc12-sources.md);
what is missing or estimated: [KNOWN_ISSUES.md](../src/aircraft/pc12/KNOWN_ISSUES.md); the turbine core it runs on
(beta, reverse, the torque limiter, the latching starter): [turbine-model.md](turbine-model.md). Owner decisions are
only those of the feature's owner notes (the PC-12/47 with the PT6A-67B; beta and reverse on the PC-12 and the C208).
Everything else here is an **AGENT** choice or calibration.

Tags: TCDS = EASA A.089 sect. C; ETCDS = EASA IM.E.008; 47E-PROXY = the PC-12/47E POH 02277 (same airframe, the
PT6A-67P); CHART-READ = read off a 47E chart; 3V = the POH three-view (measured by the exterior package); DERIVED =
arithmetic shown; ESTIMATE = judged, no source.

## Axes, mass and inertia

Body axes about the **reference point**: the MAC quarter-chord (ESTIMATE station 6.00, the middle of the TCDS CG range
at 4740 kg: 5.898–6.107 m) at the height of the nominal CG, **1.54 m** above the ground (DERIVED from a component
build-up on the 3V heights: empty aircraft 1.62 m, fuel in the wing 1.24 m, occupants 1.73 m). `x = 6.00 − station`,
`z = 1.54 − height`. The scaffold had 1.30 m, read from the three-view's fuselage-depth bracket as if it stood on the
ground; the exterior package measured the belly at 0.93 m, the roof at 2.73 m, the wing root chord plane at 1.05 m and
the eye at 2.33 m (station 4.20), which geometry.ts now carries (the drawing writes heights as `PC12_REST_HEIGHT − h`
and follows).

| Item | Value | Tag |
| --- | --- | --- |
| Empty | 2800 kg at station 5.85, 1.62 m up | 47E-PROXY 1-8 (typical) / ESTIMATE (CG) |
| Usable fuel | 1522 L = 1218 kg, two wing tanks at station 5.86, ±3.0 m, 1.24 m up | TCDS / 47E Fig 6-16 arm |
| Loadings | typical: pilot + full fuel (4103 kg); forward and aft: MTOW on the TCDS limits; maxGross: pilot + cabin to MTOW (station 5.97) | AGENT |
| Inertia (about the CG, maxGross) | Ixx 28 000, Iyy 30 000, Izz 55 000 kg m² | ESTIMATE (plan 5.2) |

## Aerodynamics (aero.ts)

Strips on a lifting line, as every type. Wing: straight taper 2.10 → 1.08 m on an unswept quarter-chord, 5° dihedral,
NASA LS(1)-0417 at the root blending to LS(1)-0313 at the tip, the flat wing to 7.88 m and a 0.45 m winglet canted 62°
up to the TCDS half span; incidence −0.5° at the root, −3.0° at the tip (CALIBRATED on the attitudes below). One carry-
over strip across the fuselage and 9 strips a side (the cost of a trim and reset: 1.10 × the C172S's).

**The stall is the pusher's.** The 47E's stall speeds are pusher speeds; the wing's own C_L,max is not published. The
pusher must trip at 0.90–0.93 of the wing's C_L,max (plan 5.2). Moved to get there:

- the wing sections' break 3.8° earlier than the clean LS(1)-0417 record (boots on the leading edge; the tip a further
  3.5°): C_L,max **1.37 clean**;
- the **Fowler flap**: chord fraction 0.30, the 0.30 chord extension complete by 20° (the tracks run it aft first),
  the slotted table's large-deflection effectiveness less 10 %, and a new per-flap `clMaxRatio` of **1.22**
  (physics/aero/airfoil.ts: the break moves out by 1.22 × the zero-lift shift; the generic slotted 0.8 put the
  flaps-40 C_L,max at 0.98 of the pusher's and the stall 9° of body angle below the clean one): C_L,max **1.98 / 2.51
  / 2.62** with flaps 15 / 30 / 40;
- the flap's profile drag twice the slotted fit's (new `dragFactor`): **13.3 psi on a 3° flaps-40 approach** at Vref
  (plan: 8–18) and a 6.8° flight-idle descent at 85 KIAS with flaps 40 and the gear down.

Resulting pusher trip at 0.91 / 0.92 / 0.91 / 0.94 of C_L,max (flaps 0 / 15 / 30 / 40). Without the pusher the flapped
wing drops a wing at the break (9–11° of bank), as the 47E warns.

Tail: a T-tail (no centre strip, the halves meeting at the fin tip) whose whole **stabiliser turns with the pitch
trim** (an all-moving link on `SurfaceState.elevatorTrim`, + = leading edge up = nose down), a 0.36-chord elevator on
it, rigged at −1.5°; the wing's wake loss at the tail 0.25. Fin and rudder from the 3V (base chord 1.95 m, tip 1.20).

Attitudes (forward / aft limit, MTOW, 3000 ft): flaps-40 approach at 85 KIAS on 3°: pitch −2.1 / −2.5°, alpha +0.9 /
+0.5°; 130 KIAS clean level 4.7°; 200 KIAS 0.8°; 236 KIAS 0.0°.

## Pitch trim, interconnect, shaker and pusher (systems.ts, physics/controlSystem.ts, physics/aero/stickPusher.ts)

- **Stabiliser trim** (`PitchTrimDef 'stabilizer'`, new in ControlLaw): −4° (nose up) … +2.5° (nose down) about the
  rigging, 0.5°/s, electric (above 20 V). Range and rate ESTIMATE; the travel covers a flaps-40 approach at the forward
  limit (−3.6°) and a 236 KIAS run at the aft limit (+1.1°). The trim solver's one pitch control is split 0.63 to the
  stabiliser (the elevator's effectiveness relative to the whole surface) and the rest to the yoke; the elevator does
  not float with the stabiliser or the tail's angle of attack (KNOWN_ISSUES).
- **Aileron–rudder interconnect** 0.15 of rudder travel per unit aileron (ESTIMATE, plan 5.2).
- **Stick shaker and pusher**: trip angles (body AOA) against flap, the shaker about 6 kt before the push, the push
  drives the column to 0.35 of the nose-down travel (`pushTo`, ramped in 0.3 s) whatever the yoke is held at, 5 s
  lift-off inhibit, 0.5 g switch, dead below 18 V, the PUSHER INTERRUPT held stops it; trip angles +0.03° per psi of
  torque (ESTIMATE). Pilot review 2026-10-17: the first fit subtracted 0.35 from the yoke and slipped a clutch at
  0.95, so a held yoke beat it: flaps 40 idle, yoke held 0.7 / 0.9 / 1.0 from the shaker: 87 / 80 / 81° of bank,
  632 / 951 / 855 ft lost, 33° AOA at 1.0; clean at take-off torque with 1.0 held: inverted, 1722 ft. With the
  column driven (AGENT: no clutch override for a position input; the real clutch slips at 85-90 lbf): 7.5 / 5.7 /
  6.6° of bank, 315 / 304 / 308 ft, AOA at most 14.8° (2-3 pushes as the held yoke pulls back after each reset);
  clean at take-off torque, 1.0 held: 15° of bank, no height lost, 5 pushes; clean idle 1.0 held: 200 ft. The
  aerodynamic stall check (conformance "stall recovery") holds the interrupt through the hold, as a stall flight
  test does.

## Powerplant (powerplant.ts)

**PT6A-67B** free turbine: power turbine 29 894 rpm at 1700 propeller rpm (gear 17.585), Ng 100 % = 37 468 rpm, limit
104 %. The running line (fuel, ITT and gas power against corrected Ng, sea level) is **fitted**, not a P&WC deck:

| Fit point | Model | Target |
| --- | --- | --- |
| Static, PCL full, SL ISA (the torque limiter) | 44.21 psi, Ng 94.4 %, ITT 771 °C, Np 1700 | 44.0–46.0 psi, 93–99 %, 680–780 °C, 1700 ± 30 (TCDS / ESTIMATE) |
| PCL full, 10 000 ft ISA, 150 KIAS | 41.60 psi, ITT 778 °C | 40.5–43.0 psi, ≤ 800 °C (47E 7-10 limiter law) |
| Hot and high static, 8000 ft, 26 °C, PCL at ITT 800 °C | 32.7 psi | 29–34 psi (47E example 34.1 psi at 850 °C) |
| Maximum cruise SL / 8000 / 12 000 ft ISA at 36.9 psi, 10 450 lb | 231.8 / 248.0 / 256.1 KTAS; 635 / 565 / 526 lb/h; ITT 755 °C at 12 000 ft | 229 / 247 / 256 KTAS ± 4 %; 634 / 564 / 541 lb/h ± 10 %; ≤ 760 °C (47E Fig 5-2-31; TCDS MCP ITT) |
| Ground idle (condition GROUND IDLE, on the gate) | Ng 54.9 %, ITT 534 °C, Np 1053 rpm | 50.7–61.4 %, ≤ 750 °C, about 1060 (47E 2-6, 7-11) |

Condition lever: GROUND IDLE = 55 % Ng (`lowIdleNg`), FLIGHT IDLE = 64.5 % (`highIdleNg`; 47E: at least 64 %). PCL →
Ng demand linear from the idle to 104 %; the **torque limiter** (47E-PROXY 7-10, `PC12_TORQUE_LIMITER`) holds 44.3 psi
at sea level, less 2.7 psi per 10 000 ft to 12 000 ft and 4.5 psi per 10 000 ft above, less 2.9 psi between 102 and
104 % Ng. Nf topping 1853 rpm; reversing cam to 86 % Ng with the topping reset to 1650 rpm (47E max reverse Np).
**Latching starter**: one press, cut-out at 50 % Ng or 80 s (47E 4.5); the starter-generator 3.5 × the C208's motor's
torque and the start's fuel schedule CALIBRATED: condition to GROUND IDLE at 13 % Ng, light-off, **peak ITT 750 °C**,
**50 % Ng at 29 s**, cut-out at 50.0 % Ng, idle 54.8 % Ng with Np about 1005 rpm right after the start (the generator
charging; 1055 rpm on the warm idle).

### Flight idle

Pilot review 2026-10-17: FLIGHT IDLE in flight read 4.9 psi (about 130 shp), the prop governing 1700 rpm with its
blade well above the stop and pulling +1.2 kN at 120 KIAS, so the idle descents were shallow (type experience
ESTIMATE -1000 to -1300 ft/min clean at 120-150 KIAS); on the ground FLIGHT IDLE gave 4.3 kN at a standstill. The gas
power at 60 / 65 % Ng came down from 110 / 165 to 90 / 130 shp (ESTIMATE). Steady idle descents, MTOW, autopilot
holding the speed, sink over the last 20 s of 70 s (180 and 200 KIAS not settled: report only):

| FLIGHT IDLE | Before (110 / 165 shp) | Now (90 / 130 shp) | Reviewer's 95 shp (not applied) |
| --- | --- | --- | --- |
| Torque in the descent | 4.2-4.8 psi | 3.6 psi | 2.5 psi |
| 120 KIAS clean | -600 ft/min, +955 N | -648 ft/min, +777 N | -737 ft/min, +451 N |
| 150 KIAS clean | -927 ft/min | -978 ft/min | -1066 ft/min |
| 85 KIAS flaps 40 gear down | -1234 ft/min (-7.1°) | -1282 ft/min (-7.4°) | -1380 ft/min (-8.0°) |
| On the gate, static: thrust / Np | 4345 N / 1656 rpm | 3656 N / 1526 rpm | 2894 N / 1364 rpm |

The reviewer's 95 shp breaks the ESTIMATE band for FLIGHT IDLE on the gate (Np 1500-1730, targets/pc12.ts `idleRpm`);
130 shp is the lowest inside it. The ESTIMATE descent band at 120 KIAS is out of reach of the power alone: with zero
propeller thrust the aircraft glides about as the feathered one (-889 ft/min at 119 KIAS); -1000 ft/min or more there
needs the propeller to DRAG, i.e. the engine giving less than the propeller's own profile power at 1700 rpm so that Np
falls below the governor. Whether a real PC-12 holds 1700 rpm in a 120 KIAS idle descent decides this (the owner's
call). Raising the flight-idle stop (the reviewer's 10-12°) was measured and NOT applied: 10° put the ground-idle Np on
the gate at 834 rpm (target 1060 ± 60), and with the ground idle raised to 58-60 % Ng to recover it (949 / 927 rpm)
the half-beta taxi ran 15-20 kt (target 8-12) while FLIGHT IDLE on the gate still pulled 3.0 kN; in flight the blade
governs well above any of these stops, so the stop does not change the descents.

With less idle thrust the generic flare (the PCL to idle 6 m up, the nose raised to 5°) touched 5 kt faster (78.8
against 73.5 KIAS) and rolled 428 m against the chart's 389 ± 30: the touchdown attitude of that technique is now 6°
(conformance targets; 72.3 KIAS, 376.7 m; 5.5-7.5° gives 72.8-70.4 KIAS and 380-363 m, below 5.5° it falls off a
cliff to 78-79 KIAS). The full-reverse roll is 284 m, ratio 0.75. The keyboard circuit in the 10 kt crosswind is
sensitive to the power map at 70 % Ng (an unchanged 255 shp there passes it: 76.0 KIAS at 1.74 m/s; 225 or 230 shp
crashed it on a bounced, nose-low round-out at 91 KIAS).

### Blade angles

The TCDS gives at the 42 in station (0.80 R): **"fine pitch 19° ±0.2; minimum on ground 17°; minimum in flight 6°;
reverse −17.5° ±0.5; feather 79.6° ±0.5"** (C.III.6.6, verbatim). A 6° blade at 0.80 R, 1700 rpm and 85 KIAS sits
about 7° negative to the flow (advance angle about 13°): heavy disking. So 6° and 19° cannot both be flight blade angles
at that station; the flight-idle low-pitch stop is the **calibrated unknown** (plan 5.1), started at 17° and moved on
two constraints:

1. on the gate at GROUND IDLE, static Np about 1060 rpm (47E 7-11): 17° gave 655 rpm, 8° 1043, **5.5° 1055 rpm**;
2. the flaps-40 approach must need 8–18 psi (the stop's flight-idle drag kept): **13.3 psi**.

The model's stop is **5.5°** (the TCDS "minimum in flight" 6° less half a degree). The PCL's "6° to 12°" forward of the
detent (47E sect. 1, 7-10) is read as a 6° rise of the stop to mid-travel (ESTIMATE). Ground fine −4.5° (about zero
static thrust: +216 N), full reverse −17.5°, feather 79.6°; the first 45 % of the aft travel moves the blades only.
PROP LOW P (the panel's) is "blade below the flight-idle stop while airborne".

Propeller: four blades, 2.67 m, 1.1 × the 172's chord (CALIBRATED on the take-off roll: 1.4 × gave 16.1 kN static and
a 399 m roll, 1.1 × gives 10.3 kN and 488 m), a 25° helix at 0.80 R, the T1a test-bed's reversing section.

## Gear (gear.ts)

Retractable, hydraulic (7 s either way, ESTIMATE; no up-locks, the accumulator holding the gear up with a dead bus;
free fall 15 s). Trailing-link mains on **vertical** legs (the link's 0.18 m aft travel is not modelled: KNOWN_ISSUES),
an oleo of 0.08 m static stroke and 75 kN limit; a stiff progressive nose strut (preloaded to the static load, 0.07 m
at a full-brake stop's 12.6 kN, never a hard stop) so that the propeller (0.30 m of clearance) clears a braked nose;
pedal steering ±12°, castoring to ±60°. Gear horn (47E 7-4): a leg not down and locked with the PCL at idle below
**130 KIAS** (`warning.kiasBelow`, new in physics/gear/retract.ts; the flight model's stepRetract passes the IAS) or with flaps 30
and more; the selector UP on the ground.

## Sim profile and input

Take-off with the PCL fully forward (the limiter holds 44.3 psi), flaps 15, rotate at 82 KIAS, take-off rudder trim
+0.3 (nose right, ESTIMATE); the scripted climb-out at 105 KIAS (half the C208's speed-hold gains: the hand-over from
the lift-off attitude to Vy, 35 kt faster, dived it into the runway) at 36.6 psi (PCL 0.63); roll-out in full reverse back to the gate below 40
KIAS. The input profile has the condition lever (mixture keys, a detent a press: `conditionDetents`), the PCL's reverse, the gear and the rudder trim; no
propeller lever (the governor holds 1700 rpm; feathering is the condition lever's).

## Results against plan 5.7

Measured on the conformance suite (FS_AIRCRAFT=pc12; `node scripts/aircraft-report.mjs pc12 --flown`).

| Item | Model | Target (tag) |
| --- | --- | --- |
| Pusher, flaps 0 / 40, forward CG, MTOW | 96.3 / 68.4 KCAS = 94.3 / 66.5 KIAS | 95 / 67 KIAS ± 3 (CHART-READ Fig 5-2-1) |
| Pusher, flaps 15 / 30, maxGross | 79.1 / 70.5 KCAS = 77.3 / 68.7 KIAS | 78 / 70 KIAS ± 3 |
| Shaker margin, flaps 0 / 40 | 6.4 / 6.9 kt | 5–10 kt (47E 7-21) |
| Push at 1 kt/s, flaps 40, yoke held at the trip 1.5 s, then neutral 1.5 s, then the recovery | the push alone takes 5.8° of AOA off; nose falls 17.9°, 146 ft lost, one push (relative push of the first fit: 3.9°, 17.2°, 144 ft; with no actuator: no AOA off, 83° nose down, 511 ft, three trips) | AOA ≥ 1.5° off (AGENT: the pusher reset); 8–20°, ≤ 300 ft, no second push (47E 5 p. 329) |
| Static, PCL full; 10 000 ft; hot and high | see the powerplant table | |
| Take-off ground roll, flaps 15, MTOW | 488 m | 518 m ± 15 % (CHART-READ 1700 ft) |
| Climb at MCP (36.95 psi), SL ISA, MTOW | 1525 ft/min at Vy 121 KIAS | 1650 ± 20 %, Vy 130 ± 10 (ESTIMATE / 47E 4.2) |
| Maximum cruise rows | see the powerplant table | |
| Glide, feathered | L/D 15.6 at 119 KIAS (best) | 15.8 ± 1.5, 119 ± 10 KIAS (DERIVED 47E) |
| Landing roll, MLW 4500 kg, flaps 40, chart technique (brakes 1280 N m a wheel: 0.4 of the original 3200 N m, 0.533 of the gate-0 2400 N m; ground idle after touchdown) | 385 m on the gate, 290 m in full reverse, ratio 0.75 (1600 N m: 322 m) | 389 m ± 30 (CHART-READ Fig 5-2-52); 280 ± 35; 0.72 ± 0.08 (DERIVED Fig 5-2-54) |
| (a) gate, ground idle | Np 1057 rpm, Ng 54.9 %, ITT 534 °C; 20.7 kt steady | 1060 ± 60, 50.7–61.4 %, ≤ 750 °C; 15–30 kt |
| (b) ground fine | +216 N static, 0 kt | \|T\| < 500 N, ≤ 5 kt |
| (c) half of the pitch-only travel | 8.2 kt steady | 8–12 kt |
| Approach, Vref 85, flaps 40, 3°, MLW | 13.5 psi | 8–18 psi (ESTIMATE) |
| Yaw: full power at 130 KIAS / 200 KIAS level, rudder trim 0 | 0.22 / 0.04 of the pedal | 0.15–0.45 / −0.02–0.12 (ESTIMATE) |
| Take-off roll heading, rudder trim 0 | within 3.2°, up to 0.50 of the pedal at 14 kt, 0.20 steady above 30 kt (swirl at the fin 0.5; at the first estimate 0.6: 4.2°, 0.67) | ≤ 5°, ≤ 0.6 (AGENT) |
| Start | GROUND IDLE at 13 % Ng, peak ITT 750 °C, 50 % Ng at 29 s, cut-out 50.0 %, Np ≥ 950 | plan 5.7 |
| Gear horn; overspeed | actuator logic as 47E 7-4; Vmo/Mmo crossover between 14 000 and 18 000 ft | 47E 7-4; TCDS |
| Hands-off cruise 200 KTAS, 60 s | 0.7 m, 1.5°, 7 ft/min, 0.04 m/s | contract 3.10 |
| Keyboard circuit (headless; brakeKias 80, flareM 8) | no crash in either weather; touchdown 77 KIAS at 1.0 / 1.7 m/s, 354 / 425 m past the threshold; stopped 0.7 / 0.2 m off the centreline (the light-turbulence roll 2.0 km, ending about 600 m past the runway end); min 0.55 / 0.53 g; roll-out still on the gate at FLIGHT IDLE and fragile to flareM (see KNOWN_ISSUES) | completes, touchdown ≤ 450 m, beta below 60 KIAS (AGENT; the input package's roll-out) |
| Keyboard circuit, real app (scripts/fly-keyboard.mjs) | completes: touchdown 74.7 KIAS at 0.16 m/s, 393 m past the threshold, the stop 2.78 km further on, on the gate | as above |
| Autoflight circuit, real app (scripts/fly-circuit.mjs; flown before the review fixes' fin swirl 0.6 -> 0.5, not re-flown) | completes: lift-off 95 KIAS, climb-out 105 KIAS at 1390 ft/min, touchdown 84 KIAS at 0.6 m/s, stop in 175 m (full reverse) | — |

## Changes outside the type directory (P1's shared files)

- `physics/controlSystem.ts`: the `'stabilizer'` pitch-trim law (STABILIZER_EQUIVALENCE 0.63) and the aileron-rudder
  interconnect; the stabiliser's actuator rate.
- `physics/aero/stickPusher.ts`: the shaker and pusher body (trip schedule, inhibits, ramp, interrupt, slip clutch).
- `physics/aero/airfoil.ts`: optional `FlapGeometry.clMaxRatio` and `dragFactor` (absent: the kind's, unchanged).
- `physics/aero/slipstream.ts`: a bound on the swirl the airframe sees at near-zero axial mass flow (a propeller on the
  ground passing through zero thrust into reverse made 14 000 rad/s of swirl and 1e8 N of side force); no thrusting case
  reaches it (every golden and the C208's quick and flown tiers are unchanged to the printed digit).
- `physics/trim.ts`: when Newton fails with the throttle on a plateau (the torque limiter: thrust no longer rises with
  the PCL) it is solved again with the throttle bounded below the plateau's start. No other type reaches it.
- `physics/gear/retract.ts`: `RetractInput.kias` and the horn's `kiasBelow`.
- `physics/flightModel.ts` (review fixes): stepRetract passes `kias`; the fixed-wing `restoreSystems` restores the gas
  generator (Ng, ITT, alight), the blade angle down to the reverse angle, and the latching starter through
  `EngineUnit.restoreSpoolAndPitch` (it left a resumed turbine at low idle, a reversed blade on the fine stop and a start
  without its latch, the C208's too); the stick pusher's state is in the snapshot (`SystemsSnapshot.stickPusher`).
