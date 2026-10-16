# MD 500E flight model (T2)

The MD 500E (369E, Rolls-Royce 250-C20B, 5-blade articulated main rotor, 2-blade tail rotor) as flown by the
simulator's rotorcraft runtime: what each number is, where it comes from, how it was calibrated and what it gives
against the RFM. Sources: `docs/md500-sources.md` (tags P primary, D derived, M marketing, F family/OH-6A,
3V drawing, S secondary, ESTIMATE). The turboshaft stage (grip, N2 governor, freewheel, warnings) has its own
document, `docs/turboshaft-model.md`. Known gaps: `src/aircraft/md500/KNOWN_ISSUES.md`.

Numbers in the tables come from `tests/rotorcraft/md500Performance.test.ts` and `md500Systems.test.ts` (run with
`MD500_TRACE=<dir>` for the full report), SL ISA unless stated.

## 1. Files

| File | Holds |
| --- | --- |
| `dimensions.ts` | the geometry contract (stations, waterlines, hubs, skids, tail, cyclic rigging) |
| `facts.ts`, `reference.ts` | engine, drive, limits, grip and beep facts; RFM speeds, weights, autorotation law |
| `rotorcraft.ts` | the `RotorcraftDefinition`: rotors, hub, drive, turboshaft, surfaces, skids |
| `articulated.ts`, `coning.ts` | blade mass data (from the OH-6A flap inertia) |
| `powerplant.ts` | the 250-C20B running line, fuel, electrical |
| `mass.ts`, `limits.ts` | loadings, CG, inertia; the Fig 2-6 Vne placards |
| `input.ts`, `sim.ts`, `index.ts` | input profile, presets (grip FULL OPEN when running), assembly |

## 2. Rotor and hub

- Five blades, R 4.023 m (26.4 ft disc, RFM Fig 1-1), chord 0.1715 m and twist −8° (OH-6A, F), NACA 0015 as the
  analytic section (lift slope 5.7, Cl max 1.2, Cd0 0.0095; ESTIMATE).
- Articulated hub through the reduced harmonic solver (the S269's): flap and lag hinges at **0.165 m** (the 500C's
  0.458 ft, CR-166256 p5, F, plus the inch the 500D hub is wider, heli-archive, S; e/R 4.1 %). The inch matters: it
  brings the hover roll-acceleration per stick to the OH-6A's (section 7).
- Blade mass: no 369D21100 survey exists; a uniform blade from the aerofoil root (0.480 m) to the tip with the
  OH-6A's flap inertia (63.49 kg·m², Heffley p34, F) about the hinge weighs 11.5 kg (Lock number 4.9).
- **Rotor polar inertia 352 kg·m²** (five such blades; research ESTIMATE 330–350 with hub).
- Shaft tilt 3° forward (OH-6A, F; Fig 6-3 cant lines): `RotorcraftDefinition.shaftTilt` (new, optional) solves the
  main rotor's flow, flapping, forces and moments in the tilted shaft frame; untilted types are untouched.
- Collective: `minPitch` (0.75 R) **1.15°** is the free parameter of the RFM 4-25 autorotation law (section 6);
  `maxPitch` = min + 16.1° (TCDS p14 collective travel 14.25–18.0°).
- Cyclic: asymmetric TCDS rigging (forward 17.75°, aft 8.15°, left 8.15°, right 7.0°, mid values) through the new
  `cyclicLimits`: the stick's travel is linear from stop to stop, so its centre sits 4.8° forward and 0.6° left of the
  rigging neutral, which is a third of the travel from full aft (RFM 4-12). On the ground the reset places the cyclic
  at that neutral. Under load the blades reach 0.75 of the commanded cyclic (OH-6A control-system flexibility,
  Heffley Fig II-2, F; section 7).
- Tail rotor: 2 blades, R 0.6985 m (55 in, Fig 1-1), chord 0.12 m, twist −8° (OH-6A, F), pitch +27° (anti-torque,
  left pedal) to −14° (TCDS p14), 2933 rpm at 492 (ratio 5.96, S; the OH-6A's 6.447 would give 3172), on the left of
  the boom at STA 284, **WL 51.4**: the RFM's "lowest tip 2.0 ft above the ground" is measured in the 4.7° nose-up
  ground attitude, which lowers the tail 15.1 in below the level axes (D). Under load the blades reach 0.67 of the
  commanded pitch from the range's centre (+6.5°): +20.2° at full left pedal (Heffley Fig II-2, F; section 7). The
  inflow relaxes with the Pitt-Peters time constant (about 5 ms in the hover).

### Rotor energy

The decay rows of plan §6.6 follow from the rotor's stored energy. With I = 352 kg·m² (+ 0.35 × 5.96² = 12 kg·m² of
tail rotor) at 492 rpm (51.5 rad/s), E = ½ I Ω² ≈ **484 kJ**. At fixed collective the rotor's power demand goes
as Ω³; with the drive gone, I Ω dΩ/dt = −P0 (Ω/Ω0)³ integrates to

  Ω = Ω0 / (1 + t/τ),  τ = 2E/P0,

so at the 120 KIAS cruise (about 63 psi, 202 kW at the rotor) τ ≈ **4.8 s**: the 468 rpm horn comes at
τ(492/468 − 1) ≈ 0.25 s and 410 rpm at τ(492/410 − 1) ≈ 0.96 s. For comparison the simulator's R22 (146 kg·m²,
528 rpm, about 90 kW) has τ ≈ 5.0 s and its R44 (450 kg·m², 414 rpm, about 140 kW) τ ≈ 5.9 s: the 500E runs down a
little faster than either. Its reputation for a quick decay is about the reaction time the RFM demands at high power,
not a radically smaller inertia. A primary blade weight refits `BLADE_MASS` (articulated.ts) and nothing else.
Measured in the flight model (engine cut at 120 KIAS, 3000 lb, collective held): horn **0.27 s**, 410 rpm **1.08 s**,
the nose yawing **9.5° left** in the first 0.5 s (RFM 3-3; 9.1° before the polish pass).

## 3. Airframe

- Mass: the RFM 6-7 sample basic weight 1510 lb at STA 109.0 (P; the 2023 configuration is 1657 lb, M), CG height
  ESTIMATE WL 50; loadings typical (pilot, full fuel, 2102 lb at 103.9 in), forward, aft and maxGross (four equal
  occupants to 3000 lb, 100.4 in), all inside RFM 6-1's envelope (tested).
- Inertia ESTIMATE Ixx 550, Iyy 1500, Izz 1200, Ixz 150 kg·m² at 3000 lb (OH-6A ×1.18 for mass and +5 %, F).
- Drag: x 0.6 m² equivalent flat plate (calibrated to the MCP speed), y 3.6, z 3.2 m² (ESTIMATE); egg-cabin pitch and
  yaw moment slopes twice the R22's.
- Fins: the upper (0.38 m²) and lower (0.20 m²) fins from the 3V outlines, symmetric, no offset.
- Skids: four nitrogen-damper supports (RFM 1-9); see "Skid gear" below. The skid contacts are not parallel to the
  waterlines: the front contacts sit 0.061 m lower (new optional `skids.frontZ`), which gives the RFM's **4.7° nose-up
  ground attitude** with full fuel (measured 4.74°).

### Skid gear

No damper stroke, charge or orifice data was found (research-md500 gap 11), so the dampers are ESTIMATES sized to
what the gear must do. The first fit (the S269's oleo scaled to 3000 lb: 0.06 m stroke on a 0.08 m gas column) sat
at 0.05 m static stroke at 3000 lb and bottomed (`Hard skid impact`) 2-4 s after a 0.2 m/s touchdown as the
collective came down (pilot review 2026-10-17). Now: 0.14 m usable stroke, a 0.155 m gas column charged 1300 psi
front / 1400 psi rear (on the model's 2.5 cm² effective area), the orifice 3500 N/(m/s)², the relief valve at 11 kN.
The targets: the FAR 27.725 limit drop (13 in, about 2.55 m/s with rotor lift; the 369 was certificated to CAR 6,
assumed comparable) and type experience of 2-2.5 m/s touchdowns and 30 kt run-ons (ESTIMATE).

| Case, 3000 lb SL | Before (0.06 m stroke) | Now (0.14 m) |
| --- | --- | --- |
| Static strokes front / rear | 0.05 / 0.03 m | 0.05 / 0.04 m |
| 0.2 m/s touchdown, collective lowered at 0.15/s | crash 2.3-4.2 s after contact | no crash, 0.10 m peak |
| Drop, collective 0.75 × hover, 4 ft | (crash) | 2.08 m/s, 0.11 m, 5.5 g peak side load |
| Drop, 0.7 × hover, 5 ft / 6 ft | (crash) | 2.56 / 2.78 m/s, 0.13 m, no crash |
| Drop 8 ft, 0.65 × hover | (crash) | 3.52 m/s: crash (above the skids' 3.5 m/s `maxSink`) |
| Hovering autorotation 3 / 5 ft | crash at 1.61 / 1.85-2.14 m/s | no crash; 8 ft (2.80 m/s) crashes |
| Power-off run-on 30 / 40 kt, 0.8-1.0 m/s | crash | stops in 5.7-7.4 s |

The gas column is kept short on purpose: the CG stands about 1.3 m above the skids, so on the nose-up stance the
weight shifts aft onto the rear dampers and a soft gas spring lets the nose rise further. A 0.22 m column (static
stroke a third of 0.15 m) sat at 8.4° instead of 4.7° and rocked onto the tail-rotor guard during a landing; with
0.155 m the static pitch at 3000 lb is 3.9-4.1° and 4.7° with the pilot alone and full fuel. Tests: md500Systems
"skid gear touchdowns" (drops from 4 and 5 ft, a 30 kt run-on).

### Stabiliser sign

The T-stab's incidence is 8.92–9.42° to the mast normal (TCDS p14), which lies 3° nose-down of the body axis. The
369D/E entry prints no sign, but the same data sheet writes the 369FF's stab as "−1.9° nose down with respect to
waterline plane" (p21): where Hughes/MD mean nose down they sign it, so the 369D/E figure is leading edge **UP**,
+6.17° to the waterline (`STAB_INCIDENCE_TO_WL_DEG`, dimensions.ts). The other reading, leading edge down −12.17°,
would sit at about −16° to the airflow at the cruise attitude (−3…−4°) before any downwash: a stalled surface no
designer would rig. The RFM Fig 6-3 tail drawing shows the section edge-on but is schematic for the angle (its chord
looks parallel to the canted stations), and the D-HHRM / G-SSCL photographs are three-quarter views that show the
underside and leading edge, not a measurable chord line. heli-archive (S): the 500's stab is "set at +5° and produces
negative lift", which at leading edge up needs an inverted cambered section (zero-lift angle ESTIMATE +6°); with it the
surface carries a download at every forward speed. Until the polish pass the exterior drew the stab leading edge down;
it now draws the flight model's angle (no aerodynamic change). Sweep at 120 KIAS, 2700 lb, before the control
flexibility of section 7 (the model's surface is symmetric: incidence = geometric − zero-lift angle):

| Aerodynamic incidence | 120 KIAS pitch | Cyclic forward of hover (travel) | Stab load at 120 KIAS |
| --- | --- | --- | --- |
| −12.17° (leading edge down, symmetric) | +0.9° | 0.39 | strong download |
| −3° | −2.3° | 0.27 | download |
| **+0.17° (chosen: +6.17° geometric, inverted camber)** | **−3.4°** | **0.22** | download |
| +3° | −4.4° | 0.19 | slight download |
| +6.17° (leading edge up, symmetric) | −5.6° | 0.14 | upload below 120 KIAS |

Row (ESTIMATE): pitch −2…−6°, cyclic at most 0.3 of travel forward of the hover trim. With the control flexibility
the chosen row reads −3.4° and 0.30 (the cyclic is in stick travel, so 0.75 of the blade angle needs 1/0.75 of it).

## 4. Engine

The running line (`powerplant.ts`, corrected to SL ISA) was fitted, not read from a deck:

| Anchor | Source | Model |
| --- | --- | --- |
| 313 kW at the 810 °C TOT limit, SL ISA | EASA IM.E.052 p9, p13 (P) | 320 kW (N1 102.6 %) |
| 87.2 psi at Hp 1000 ft, 20 °C: specification TOT 790 °C | RFM 5-24 Fig 5-17 (P) | 770 °C |
| Hover ceilings at the take-off limit (TOT-limited above SL) | RFM Fig 5-4, Fig 8-1 (P) | section 5 |
| Ground idle 64–65 % N1; rotor N2 55–70 % | RFM 4-16 (P) / ESTIMATE | 64.4 % N1, N2 59 % |
| Snap deceleration ≥ 2.0 s to 65 % N1 | RFM 4-19, 4-28 (P) | 2.2 s |
| About 27 gal/h (184 lb/h) in cruise | spec p37 (M) | 193 lb/h at 120 KIAS, 3000 lb (62.8 psi, N1 93.1 %, TOT 614 °C) |

The gas producer's inertia (0.030 kg·m², 0.43 MJ at 100 % N1) and the deceleration schedule (minimum flow 0.62 of
steady) sit between two rows that pull opposite ways: the snap deceleration must not be faster than 2.0 s, and a 1 s
collective dump from 87 psi must not overspeed N2 past 106 %. Sweep (decel fraction / inertia → snap s / dump peak %):
0.86/0.022 → 2.9/110.3; 0.75/0.022 → 1.95/106.1; 0.65/0.028 → 2.10/105.2; **0.62/0.030 → 2.19/105.0**; 0.55/0.035 →
2.43/104.6. Start: starter-generator constants and the self-sustaining N1 (40 %) give light-off at 11 % N1, the rotor
turning at 23 % N1, START released at 58.5 % 26 s after the grip opened, a TOT peak of 772 °C (row 650–810) and idle
64.4 % N1. The unloaded power turbine and its 20 kW loss: `docs/turboshaft-model.md` section 5.

## 5. Performance against the RFM and the specification

| Row (plan §6.6) | Target (tag) | Model |
| --- | --- | --- |
| HIGE 3000 lb ISA | 8450 ft ±400 (P Fig 5-4) | 8271 ft (8428 before the fins' tail-rotor blockage) |
| HIGE 3000 lb ISA+20 | 5750 ft | 5557 ft |
| HIGE 2600 lb ISA | 12 300 ft | 12 158 ft |
| HOGE 2900 lb ISA | 6980 ft ±400 (P Fig 8-1) | 6768 ft |
| HOGE 2900 lb ISA+20 | 4200 ft | 3975 ft |
| HOGE 2600 lb ISA | 10 350 ft | 10 049 ft |
| Hover 3000 lb torque IGE / OGE | 62–72 / 72–82 psi (DERIVED) | 71.9 / 79.8 psi |
| Hover TOT | 620–720 °C (ESTIMATE) | 649 / 695 °C, N1 95.4 / 97.3 %, 211 / 227 lb/h |
| Hover IGE attitude | pitch +1…+5°, roll 1–3° left (ESTIMATE) | pitch +2.5°, roll **3.7° left** (KNOWN GAP; OH-6A trims at 3.05° left at 2550 lb, F); OGE +2.6°, 4.1° left |
| Hover IGE pedal | −0.20…−0.45 (ESTIMATE) | −0.42 (OGE −0.49; −0.28 / −0.33 before the control flexibility) |
| Vy (minimum power) | 62 ±8 KIAS (P Fig 5-3) | 64.9 KIAS |
| Max ROC at 87.2 psi, Vy | 1770 ft/min ±20 % (M) at the design gross weight | 1848 ft/min at 3000 lb (TOT 737 °C); 2355 at 2600 lb |
| Level speed at MCP 81.3 psi, 3000 lb | 130–135 KTAS ±5 % (M) | 139.3 KTAS (pitch −4.4°, TOT 703 °C, N1 97.6 %) |
| Cruise 120 KIAS, 2700 lb | pitch −2…−6°, cyclic ≤ 0.3 forward of hover | −3.4°, 0.30 (0.22 before the control flexibility) |
| Cruise fuel flow, 120 KIAS 3000 lb | 184 lb/h ±15 % (M) | 193 lb/h |

## 6. Autorotation

`minPitch` calibrates the RFM 4-25 law (collective full down, 60 KIAS): **484.7 rpm at 2250 lb SL** (485 ± 5);
−11.2 rpm per 100 lb less (−10 ± 3); +7.4 rpm per 1000 ft (+6.5 ± 2). Rate of descent at 60 KIAS, 3000 lb, Nr held
at 490 rpm with the collective: **1814 ft/min** (ESTIMATE 1600–2200). Engine off, Nr held at 480, 2700 lb: glide
ratio 3.4 at 60 KIAS (1763 ft/min) and 4.2 at 80 KIAS (1913 ft/min), 1.23 times (row ≥ 1.15). At 410 rpm (the RFM's minimum-sink and best-glide rotor speed) the
60 KIAS sink falls to about 1500 ft/min; at 80 KIAS and 410 rpm the modelled rotor sits at the retreating-blade stall
boundary, so that combination is reported, not asserted. With the grip at ground idle a low Nr lets the idling
engine join the needles and drive the rotor, which is the RFM 4-24 note on practice autorotations.

## 7. Control power against the OH-6A (Heffley CR-3144, F)

The OH-6A derivatives for case 4 (hover) and case 8 (60 kt) were digitised before calibrating (tests/rotorcraft/oh6a.ts,
read from the rendered pp 27-28, SI, per cm of control) and integrated as the full 8-state linear model for the
reference responses to a step of 0.1 of full travel, at the OH-6A's 2550 lb. "Before" is the T2 model (02f5953),
"now" the polish pass (below).

| Response, hover / 60 kt | OH-6A | Before | Now |
| --- | --- | --- | --- |
| Roll acceleration, °/s² | 84.3 / 82.7 | 82.3 / 82.8 | 61.7 / 62.1 (−27 / −25 %) |
| Roll rate at 0.5 s, °/s | 15.1 / 13.8 | 20.4 / 20.8 (+35 / +51 %) | **15.2 / 15.6** (+1 / +13 %) |
| Pitch acceleration, °/s² | 53.1 / 53.5 | 57.6 / 54.2 | 43.2 / 41.0 (−19 / −23 %) |
| Pitch rate at 0.5 s, °/s | 17.1 / 14.7 | 21.6 / 18.4 | 16.2 / 13.9 |
| Yaw acceleration (pedal), peak single step, °/s² | 53.9 / 56.0 | 148 / 151 | 80.6 / 76.2 (**+50 / +36 %**, KNOWN GAP) |
| Same, mean over the first 50 ms, °/s² | (initial) | 121 / 125 | 62.1 / 60.1 |
| Yaw rate at 1 s, °/s | 36.8 / 5.7 | 62.1 / 4.6 | **40.9** / 3.6 |
| Yaw rate at 2 s (hover), °/s | 54.5 | 98.2 | 60.8 |
| Subsidence (hover): a 0.5 s step released, time to half the rate at release, roll / pitch, s | 0.129 / 0.352 | 0.154 / 0.354 | 0.154 / 0.358 |
| Same, pedal (hover; reported, not a plan row), s | 0.91 | 1.11 | 0.98 |

**Control-system flexibility (Heffley Fig II-2, p22, F).** The OH-6A's block diagram puts a LINKAGE gain and then a
FLEX factor between each cockpit control and its blade angle: collective 0.155 °/% and 0.88, pitch 0.24 and 0.75, roll
0.135 and 0.75, yaw 0.39 and 0.67, with the note "Full scale wind tunnel tests have shown that flexibility in the
control system reduces commanded blade angles". The linkage gains are the 369A's TCDS ranges (24°, 13.5°, 39-41°), so
the factors come on top of the rigging, and every Heffley derivative carries them. The 500E model flew the TCDS
rigging rigidly. Now `controlFlex` (new, optional; no other type has it) scales the cyclic about the zero-cyclic
swashplate by 0.75 and the tail-rotor pitch about the centre of its range by 0.67. The pivots are an AGENT reading;
their cost in trim and margins is in KNOWN_ISSUES.md ("Control-system flexibility pivots"). The collective's 0.88 is
not applied (it would re-calibrate `minPitch` and the autorotation law).

With flexibility the roll and pitch rates match the OH-6A. The accelerations fall below it (still inside ±30 %): the
model's hub moment per degree of flapping is about 25 % below the OH-6A's, and the hinge offset is the 500C's plus the
inch of the 500D hub (S) either way, so it was not re-tuned. The steady roll rate per degree of cyclic is γΩ/16 for any
hinge offset (Lock number 4.9 at 51.5 rad/s: about 16 °/s per degree); the OH-6A's L_δA / L_p implies the same per
degree of blade angle once its 0.75 is applied.

**Yaw: why the steady pedal rate was twice the OH-6A's.** In the hover a blade-element tail rotor yaws at
r = Δθ · ΩR · (2/3) / l against its own damping: Δθ = 4.1° per 0.1 of pedal, ΩR 214 m/s, l 4.6 m give about 125 °/s
(the pass-2 review measured 147 °/s at 8 s); the OH-6A's N_δp / N_r give 62. Three physical terms were missing:

- The flexibility above: 0.67 of the commanded pitch.
- Main-rotor yaw damping: the governor holds the rotor speed relative to the fuselage, so a yaw rate changes the
  rotor's speed through the air, its torque and its thrust (the OH-6A's Z_r = 0.45 m/s² per rad/s is this term).
  `yawInRotorSpeed` (new, optional) gives the main rotor's blade elements Ω − rotation · r. Pedal-blip half-time 1.26 →
  0.95 s with it alone.
- Tail-rotor inflow: the tail rotor relaxed its inflow over a fixed 0.08 s (every type), about 15 times the
  Pitt-Peters time of a 0.70 m rotor at 2933 rpm (about 5 ms in the hover, `inflowTimeConstant`); for 80 ms after a
  pedal input the thrust ran without its inflow feedback, about twice the quasi-steady value. `tail.pittPetersInflow`
  (new, optional) uses the Pitt-Peters constant. Peak acceleration 148 → 125 °/s² with it alone; the rates barely move.

The remaining peak (80.6 °/s²) is the first 1/240 s step after an ideal step, before the inflow has answered; over the
first 50 ms the mean is 62 °/s², 15 % above the OH-6A, which is about what the 500E's larger, faster tail rotor (55 against
51 in) gives per degree. It stays an expected failure; the metric was not changed.

**Fins in the tail rotor's inflow (pilot review 2026-10-17).** The tail rotor turns 0.30 m to the left of the fins and
draws its inflow across them: its 0.70 m disc covers all of the lower fin and 60 % of the upper fin (the 3V outlines),
where the actuator-disc inflow 0.30 m upstream is about 0.6 of the disc's induced velocity. That part of each fin sees
the flow (`fins[].tailRotorFlow`): it costs anti-torque (0.4-0.5 psi; the ceilings 140-380 ft lower, all inside
±400 ft) and damps the yaw, because a yaw rate changes the flow across the fin (pedal-step half-time 1.40 → 1.11 s
before the polish pass).

**Not applied.** A lower tail-rotor lift slope (5.7 → 4.0) or a larger Izz (1500 kg·m²) lowers the acceleration but
slows the damping as much (half-times 2.07 / 1.98 s), and a hand-added yaw-rate damping term would be a hidden servo.
