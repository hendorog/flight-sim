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
- Skids: four nitrogen-damper supports (RFM 1-9), the S269's oleo law scaled to the 500E's weight (ESTIMATE). The
  skid contacts are not parallel to the waterlines: the front contacts sit 0.087 m lower (new optional
  `skids.frontZ`), which gives the RFM's **4.7° nose-up ground attitude** with full fuel (measured 4.70°).

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
| About 27 gal/h (184 lb/h) in cruise | spec p37 (M) | 180 lb/h at 120 KIAS, 3000 lb |

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
| HIGE 3000 lb ISA | 8450 ft ±400 (P Fig 5-4) | 8457 ft |
| HIGE 3000 lb ISA+20 | 5750 ft | 5762 ft |
| HIGE 2600 lb ISA | 12 300 ft | 12 285 ft |
| HOGE 2900 lb ISA | 6980 ft ±400 (P Fig 8-1) | 6934 ft |
| HOGE 2900 lb ISA+20 | 4200 ft | 4160 ft |
| HOGE 2600 lb ISA | 10 350 ft | 10 215 ft |
| Hover 3000 lb torque IGE / OGE | 62–72 / 72–82 psi (DERIVED) | 71.5 / 79.3 psi |
| Hover TOT | 620–720 °C (ESTIMATE) | 647 / 692 °C, N1 95.3 / 97.2 % |
| Hover IGE attitude | pitch +1…+5°, roll 1–3° left (ESTIMATE) | pitch +2.4°, roll **3.6° left** (KNOWN GAP; OH-6A trims at 3.05° left at 2550 lb, F) |
| Hover IGE pedal | −0.20…−0.45 (ESTIMATE) | −0.26 |
| Vy (minimum power) | 62 ±8 KIAS (P Fig 5-3) | see the trace (`vy`) |
| Max ROC at 87.2 psi, Vy | 1770 ft/min ±20 % (M) at 2600 lb | see the trace (`climb`) |
| Level speed at MCP 81.3 psi, 3000 lb | 130–135 KTAS ±5 % (M) | see the trace (`mcpSpeed`) |
| Cruise 120 KIAS, 2700 lb | pitch −2…−6°, cyclic ≤ 0.3 forward of hover | −3.4°, 0.22 |
| Cruise fuel flow, 120 KIAS 3000 lb | 184 lb/h ±15 % (M) | see the trace (`cruiseFuel`) |

## 6. Autorotation

`minPitch` calibrates the RFM 4-25 law (collective full down, 60 KIAS): **484.7 rpm at 2250 lb SL** (485 ± 5);
−11.2 rpm per 100 lb less (−10 ± 3); +7.4 rpm per 1000 ft (+6.5 ± 2). Rate of descent at 60 KIAS, 3000 lb, Nr held
at 490 rpm with the collective: **1808 ft/min** (ESTIMATE 1600–2200). Engine off, Nr held at 480: the 80 KIAS glide
ratio is 1.4 times the 60 KIAS one (row ≥ 1.15). At 410 rpm (the RFM's minimum-sink and best-glide rotor speed) the
60 KIAS sink falls to about 1500 ft/min; at 80 KIAS and 410 rpm the modelled rotor sits at the retreating-blade stall
boundary, so that combination is reported, not asserted. With the grip at ground idle a low Nr lets the idling
engine join the needles and drive the rotor, which is the RFM 4-24 note on practice autorotations.

## 7. Control power against the OH-6A (Heffley CR-3144, F)

The OH-6A derivatives for case 4 (hover) and case 8 (60 kt) were digitised before calibrating (tests/rotorcraft/oh6a.ts,
read from the rendered pp 27-28, SI, per cm of control) and integrated as the full 8-state linear model for the
reference responses to a step of 0.1 of full travel, at the OH-6A's 2550 lb:

| Response | OH-6A hover / 60 kt | MD 500E model hover / 60 kt |
| --- | --- | --- |
| Roll acceleration, °/s² | 84.3 / 82.7 | 82 / 83 |
| Roll rate at 0.5 s, °/s | 15.1 / 13.8 | 20.4 / 20.8 (**+35 / +51 %**, KNOWN GAP) |
| Pitch acceleration, °/s² | 53.1 / 53.5 | 57 / 53 |
| Pitch rate at 0.5 s, °/s | 17.1 / 14.7 | 21.5 / 17.6 |
| Yaw acceleration (pedal), °/s² | 53.9 / 56.0 | 148 / 152 (initial; **+170 %**, KNOWN GAP) |
| Yaw rate at 1 s, °/s | 36.8 / 5.7 | 65.7 / 4.1 |
| Roll / pitch subsidence t½ (hover), s | 0.14 / 0.35 | within twice the OH-6A's |

The 500E differs from the OH-6A where these rows miss: a five-blade hub with a wider hinge, and the D/E's larger
(55 in) tail rotor on a +27/−14° pitch range. Heffley's derivatives also fold in the OH-6A's control-system
flexibility ("constant control-attenuation coefficients"), which a rigging range does not have. Not tuned away: see
KNOWN_ISSUES.md.
