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
  at that neutral.
- Tail rotor: 2 blades, R 0.6985 m (55 in, Fig 1-1), chord 0.12 m, twist −8° (OH-6A, F), pitch +27° (anti-torque,
  left pedal) to −14° (TCDS p14), 2933 rpm at 492 (ratio 5.96, S; the OH-6A's 6.447 would give 3172), on the left of
  the boom at STA 284, **WL 51.4**: the RFM's "lowest tip 2.0 ft above the ground" is measured in the 4.7° nose-up
  ground attitude, which lowers the tail 15.1 in below the level axes (D).

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
the nose yawing **8.9° left** in the first 0.5 s (RFM 3-3).

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

The T-stab's incidence is 8.92–9.42° to the mast normal (TCDS p14), which lies 3° nose-down of the body axis; the sign
is not printed. heli-archive (S) says the 500's stab is "set at +5° and produces negative lift". Read as leading edge
UP (+6.17° to the body axis) with an inverted cambered section (zero-lift angle ESTIMATE +6°), the surface carries a
download at every forward speed. The other reading cannot fly the cruise row. Sweep at 120 KIAS, 2700 lb (the model's
surface is symmetric: incidence = geometric − zero-lift angle):

| Aerodynamic incidence | 120 KIAS pitch | Cyclic forward of hover (travel) | Stab load at 120 KIAS |
| --- | --- | --- | --- |
| −12.17° (leading edge down, symmetric) | +0.9° | 0.39 | strong download |
| −3° | −2.3° | 0.27 | download |
| **+0.17° (chosen: +6.17° geometric, inverted camber)** | **−3.4°** | **0.22** | download |
| +3° | −4.4° | 0.19 | slight download |
| +6.17° (leading edge up, symmetric) | −5.6° | 0.14 | upload below 120 KIAS |

Row (ESTIMATE): pitch −2…−6°, cyclic at most 0.3 of travel forward of the hover trim.

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
| Hover IGE pedal | −0.20…−0.45 (ESTIMATE) | −0.28 (OGE −0.33) |
| Vy (minimum power) | 62 ±8 KIAS (P Fig 5-3) | 64.9 KIAS |
| Max ROC at 87.2 psi, Vy | 1770 ft/min ±20 % (M) at the design gross weight | 1848 ft/min at 3000 lb (TOT 737 °C); 2355 at 2600 lb |
| Level speed at MCP 81.3 psi, 3000 lb | 130–135 KTAS ±5 % (M) | 139.3 KTAS (pitch −4.4°, TOT 703 °C, N1 97.6 %) |
| Cruise 120 KIAS, 2700 lb | pitch −2…−6°, cyclic ≤ 0.3 forward of hover | −3.4°, 0.22 |
| Cruise fuel flow, 120 KIAS 3000 lb | 184 lb/h ±15 % (M) | 193 lb/h |

## 6. Autorotation

`minPitch` calibrates the RFM 4-25 law (collective full down, 60 KIAS): **484.7 rpm at 2250 lb SL** (485 ± 5);
−11.2 rpm per 100 lb less (−10 ± 3); +7.4 rpm per 1000 ft (+6.5 ± 2). Rate of descent at 60 KIAS, 3000 lb, Nr held
at 490 rpm with the collective: **1808 ft/min** (ESTIMATE 1600–2200). Engine off, Nr held at 480, 2700 lb: glide
ratio 3.4 at 60 KIAS (1763 ft/min) and 4.4 at 80 KIAS (1839 ft/min), 1.28 times (row ≥ 1.15). At 410 rpm (the RFM's minimum-sink and best-glide rotor speed) the
60 KIAS sink falls to about 1500 ft/min; at 80 KIAS and 410 rpm the modelled rotor sits at the retreating-blade stall
boundary, so that combination is reported, not asserted. With the grip at ground idle a low Nr lets the idling
engine join the needles and drive the rotor, which is the RFM 4-24 note on practice autorotations.

## 7. Control power against the OH-6A (Heffley CR-3144, F)

The OH-6A derivatives for case 4 (hover) and case 8 (60 kt) were digitised before calibrating (tests/rotorcraft/oh6a.ts,
read from the rendered pp 27-28, SI, per cm of control) and integrated as the full 8-state linear model for the
reference responses to a step of 0.1 of full travel, at the OH-6A's 2550 lb:

| Response | OH-6A hover / 60 kt | MD 500E model hover / 60 kt |
| --- | --- | --- |
| Roll acceleration, °/s² | 84.3 / 82.7 | 82.3 / 82.8 |
| Roll rate at 0.5 s, °/s | 15.1 / 13.8 | 20.4 / 20.8 (**+35 / +51 %**, KNOWN GAP) |
| Pitch acceleration, °/s² | 53.1 / 53.5 | 57.6 / 54.2 |
| Pitch rate at 0.5 s, °/s | 17.1 / 14.7 | 21.6 / 18.4 |
| Yaw acceleration (pedal), °/s² | 53.9 / 56.0 | 148 / 151 (initial; **+174 %**, KNOWN GAP) |
| Yaw rate at 1 s, °/s | 36.8 / 5.7 | 62.1 / 4.6 (65.3 / 3.8 before the fins' tail-rotor flow) |
| Subsidence (hover): a 0.5 s step released, time to half the rate at release, roll / pitch, s | 0.129 / 0.352 | 0.154 / 0.354 (+19 / +1 %) |
| Same, pedal (hover; reported, not a plan row), s | 0.91 | 1.11 (+22 %; 1.40 before the fins' tail-rotor flow) |

**Fins in the tail rotor's inflow (pilot review 2026-10-17).** The tail rotor turns 0.30 m to the left of the fins and
draws its inflow across them: its 0.70 m disc covers all of the lower fin and 60 % of the upper fin (the 3V outlines),
where the actuator-disc inflow 0.30 m upstream is about 0.6 of the disc's induced velocity. That part of each fin now
sees the flow (`fins[].tailRotorFlow`, new and optional; no other type has it): it costs anti-torque (hover pedal
−0.26 → −0.28; 0.4-0.5 psi; the ceilings 140-380 ft lower, all inside ±400 ft) and damps the yaw, because a yaw rate
changes the flow across the fin. Pedal-step half-time 1.40 → 1.11 s (OH-6A 0.91 s), yaw rate 1 s after a 0.1 step
65.3 → 62.1 °/s, the initial acceleration unchanged at 148 °/s². A 0.5 s blip of 0.1 travel: 36.9 °/s at release (38.8
before), 80° net heading (91°). Collective +0.1 in 1 s with the pedals frozen: 23.2 °/s at 1 s (24), 119° in 3 s (124).

What was tried and not applied: the tail rotor's lift slope 5.7 → 4.0 cuts the acceleration to 105 °/s² and the 1 s
rate to 55 °/s but cuts the rotor's own damping as much (half-time 2.07 s); Izz 1200 → 1500 kg·m² gives 116 °/s², 55 °/s
and 1.98 s. The model's ratio of yaw damping to pedal power is about 2.7 times smaller than the OH-6A derivatives' (N_r
−0.86 /s against N_δp 0.94 rad/s² per 0.1 of travel); with the TCDS tail-rotor range (41° over the pedal travel) and a
blade-element tail rotor no sourced knob closes that: it needs either a smaller blade angle per pedal than the TCDS
range implies (nonlinear rigging, control-system stretch) or damping from a source the model lacks. Neither is
sourced; a yaw-rate damping derivative added by hand was not used (no hidden servo in the airframe).

The 500E differs from the OH-6A where these rows miss: a five-blade hub with a wider hinge, and the D/E's larger
(55 in) tail rotor on a +27/−14° pitch range. Heffley's derivatives also fold in the OH-6A's control-system
flexibility ("constant control-attenuation coefficients"), which a rigging range does not have. Not tuned away: see
KNOWN_ISSUES.md. Each KNOWN GAP row is its own expected failure (md500Performance), so closing one turns it red; the
60 kt yaw rate at 1 s passes (3.8 against 5.7 °/s, inside the 3 °/s floor the row uses where the reference is under
10 °/s).
