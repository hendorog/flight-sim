# Lockheed AH-56A Cheyenne: the stage-2 flight model

Package AG, plan revision 2 section 7.2. This is the pure helicopter: the hingeless main rotor flown through the **control gyro**, the
T64-GE-716, the tail rotor, the airframe and the retractable tail-wheel gear. The wing and the shared-shaft pusher (stages 3–4, AC,
`compound.ts`) and the high-advance-ratio aerodynamics with the scripted half-P hop (stage 5, AH, `highSpeed.ts`) follow through the
frozen assembly `src/aircraft/ah56/rotorcraft.ts`. The pusher is drawn stopped and feathered.

The gyro has its own document, `docs/control-gyro-model.md`; the sources are `docs/ah56-sources.md`. Tags: P primary, D derived, S
secondary, 3V photos, INF inference, ESTIMATE. **AGENT choices** are not owner decisions:
- AMCS (1973, ship 7) as the default and ICS (1972) as the `config=ics` runtime configuration;
- the ids;
- `available: false` until the owner approves;
- every ESTIMATE below.

Files: `base.ts` (the RotorcraftDefinition), `gyro.ts`, `coning.ts` (the hub constants and the blade pose), `powerplant.ts`
(T64), `mass.ts`, `limits.ts`, `gear.ts`, `input.ts`, `sim.ts`, `index.ts`, and the contracts `dimensions.ts`, `facts.ts` and
`reference.ts`. Tests: `tests/rotorcraft/ah56*.test.ts`, `tests/aircraft/ah56Physics.test.ts`, `tests/gear/ah56TailWheel.test.ts`; rig
`tests/rotorcraft/ah56Rig.ts` (`AH56_TRACE=<dir>` writes the reports).

## 1. Main rotor and hub

| Item | Value | Tag |
|---|---|---|
| Blades, radius, chord | 4; 7.808 m (25.617 ft); 0.711 m (σ 0.1159) | P ASTA-72 p 48 |
| Twist, precone, shaft incidence | −5°; 2°; 0 | P |
| Collective (at 0.75 R) | −2.5° to 18.5° (ICS 0.5–18.5 and AMCS indicated 4.5–21.5 less its +7°) | AGENT (plan 7.1) |
| Section | lift slope 5.73 /rad, Cl max 1.3, Cd0 0.0085, Cm0 −0.012 (the (4.6)3012 / (0.6)3006 mods) | ESTIMATE |
| Rotor polar inertia | 13,217 kg m² (9748 slug-ft²) | P |
| Blade set (HingelessHub.blade) | uniform from the 1.30 m root to the tip, 2,898 kg m² per blade (88 % of the rotor's per-blade 3,304; the hubs are the rest), 119 kg | D: the P Lock number 6.4 about the shaft with the 5.73 lift slope |
| Hub | hingeless: equivalent hinge 10 % R, ν_β 1.12/rev, the spring derived from ν (`hingelessSpring`), δ3 0, no control phase (the gyro's rotations are the phase) | ESTIMATE (research-ah56 sect. 5: Lockheed's 1.125–1.15, Langley's 10 % offset); δ3 P |
| Rotor-core options | harmonic Pitt–Peters inflow, radial flow, TPP-relative blade-element cyclic | AGENT: RC's validated set |
| Blade pose | droop stop −2°, flapwise EI 300 kN m² (the parked tip sags about 0.15 m) | ESTIMATE / 3V |
| Rotor speed | 246 rpm = 100 % (ICS); AMCS 97.5 % = 239.85 rpm through the configuration (`governedRpm`) | P |
| Rotation | counter-clockwise from above | INF (left yaw on an engine failure, P) |

The hub moment per rad of first-harmonic flap is (B/2)(e M_β Ω² + K_β) = 716 kN m/rad at 246 rpm. Half of it is the spring, which does
not grow with rotor speed: that is G2 (i)'s known gap (control-gyro-model.md).

## 2. Tail rotor and airframe

| Item | Value | Tag |
|---|---|---|
| Tail rotor | 4 blades, teetering, R 1.524 m, chord 0.356 m, twist 0, pitch −7.4…+24.2°, 12.6 slug-ft², hub FS 658.5 WL 114.5 BL 72 LEFT, thrust to the right; ratio 5.033; δ3 37.5° not modelled (a blade-element disc) | P ASTA-72 p 50 |
| Horizontal stabiliser | 31.83 ft² at FS 637.18, +2°; lift slope 3.5 (AR 3.68); downwash fraction 0.5 | P / ESTIMATE |
| Ventral fin | 24.6 ft² at FS 620.3 WL 79.4; lift slope 2.4 (AR 1.67); no upper fin | P / ESTIMATE |
| Fuselage | destabilising moments pitch 2.3, yaw 1.4 N m/(Pa rad) (the MD 500E's scaled by about 9× the hull volume); flat plates x 2.0, y 12, z 14 m² | ESTIMATE (plan 7.2: 2.0 m²; AC recalibrates with the compound) |
| Transmission | efficiency 0.977 (the Army's 90 shp loss at 3925 shp); oil 95 psi from a rotor-driven pump | D / P band 70–110 psi |

## 3. T64-GE-716

The EngineDef's "crank" is the output shaft: gearRatio 1, ratedRpm = Nf 100 % = 13,600 rpm (S, the T64-GE-6). The whole Nf → Nr reduction
is engineRatio 55.28 (D), and the torque gauge reads % of 3435 shp at 100 % Nf (P), so 114 % = 3925 shp, the transmission limit (P).

- **Rating.** 4330 shp maximum (P ASTA-72; 4275 quoted for the AMCS ship); ESTIMATE ladder 4330 / 4090 / 3810 shp, SFC about 0.47–0.49.
- **Running line** (not an engine deck; none found). A T64-sized version of the 250-series shape, anchored to:
  - 4330 shp at 100 % Ng and about 760 °C;
  - 3925 shp below 740 °C;
  - ground idle at 65 % Ng (P band 58–72 %);
  - about 330 lb/h at idle (P band 103–350).
- **Power-turbine losses:** 5 + 6 N m per 1000 rpm, 87 N m (4 % of the rated torque) at 100 % Nf.

  > The first scaling of the 250's coefficients by the power ratio forgot the T64's 2.3× faster output shaft and lost about 930 kW in
  > friction (stage-2 probe). It is corrected here.
- **Start** (P ASTA-72 para 78: the APU, the start button, the condition grip to IDLE at 20 % Ng, automatic thereafter). The APU's air-turbine
  starter is represented as the generic series starter on a low-resistance (APU-backed) bus. A 24 V battery alone cannot turn a 14-stage
  compressor that absorbs about 35 kW at 20 % Ng. Light-off is at 12 % Ng and self-sustaining speed at 28 %; the start schedule follows the
  250-C20B's proportions. ESTIMATES.
- **Controls.** The condition grip OFF / IDLE / RUN is the twist-grip axis (`AH56_CONDITION_GRIP`). The Nf governor is the MD 500E's
  hydromechanical law (droop 5 %, compensator anticipation 0.3 from datum Ng 0.72; ESTIMATE). The beep is 95–105 % at 1 %/s.
- **Limits.**
  - Torque 114 %.
  - TIT 740 / 770 / 780 / 785 °C, start 649 °C.
  - Ng 100 / 101.5 %.
  - Nr 95 % (the FLAWS "ROTOR RPM").

  All P.

## 4. Mass, CG, inertia

- **Weights.** 18,300 lb at FS 298 (P, the AMCS test); empty 12,874 lb (P); maximum 20,500 lb (P, the ICS release; AMCS 19,200).
- **Fuel.** 2,500 lb (ESTIMATE; capacity not found) at FS 300 in the sponsons.
- **Payload.** 2,926 lb at FS 250 (ESTIMATE), which puts the empty CG at FS 308.5 (D).
- **Loadings:**
  - typical: 18,300 lb at FS 298;
  - forward: 18,750 lb (the TOW mission, P) at FS 294.1;
  - aft: 18,300 lb at FS 299.8 (the P aft limit);
  - maximum gross: 20,500 lb at FS 292.8.
- **Inertias** (ESTIMATE, plan section 0 item 9): Ixx 10,850, Iyy 56,900, Izz 50,200, Ixz 2,700 kg m².

## 5. Wheels (landingGear 'wheels')

- **Layout.** The tail wheel sits in the three-wheel LandingGear's "nose" slot, aft of the CG; its crash wording is "Tail" (`WheelConfig.label`).
- **Stations.** Mains at FS 268 with a 62 in track; tail wheel at FS 640.
  - The mains were moved from the scaffold's FS 285 after measuring the Fort Campbell and Rucker side photos (3V). At FS 285 they were only
    13 in ahead of the CG, and braking above 0.17 g would have tipped the aircraft onto its nose. At FS 268 that is 0.39 g.
- **Design point.** At 18,300 lb the tail wheel carries 6.6 kN (8 %) and each main 37.4 kN.
- **Struts and tyres.** Short-column oleos with 0.034 m of static stroke on the mains; tyres 11 in (3V) and a 5.00×4 tail tyre (6.75 in,
  P size).
  - The extended contacts are the rest contacts plus the static deflections, so `wheelRestingPose` is exact at the design loading.
  - `skids.z` is that rest contact (the consistency rule's 1 cm).
- **The tail wheel castors** full-swivelling (±175°). The **lock pin** (`SteeringParams.lock`, read from `controls.tailWheelLock` inside
  `src/physics/gear`) drops in once the wheel swings within 2° of centre and then holds it straight. Without the lock field the gear code is
  unchanged.
- **Brakes and retraction.** Toe brakes and the parking brake on the mains (3000 N m each, about 0.26 g). Hydraulic retraction, 6 s each way,
  squat switch, up-locks.
- **Airframe points.** The belly turret (FS 190, 21 in up, P), the sponsons, the chin turret, the ventral fin tip, the wing and stabiliser tips,
  the canopy and the engine fairing; the pusher disc.
- **RotorClearance** runs the skids' cabin / fin / tail-rotor / main-rotor-tip checks, extracted unchanged from `skids.ts`
  (`clearanceContacts` / `clearanceStrike`; the legacy digests are equal), over level ground at the reference point's height.
- **On the ground with the rotor running and the pedals centred** the aircraft leans about 3° toward the right main. The tail rotor's side force
  is reacted at the tyres about 2 m below the CG, and the gravity overturning term (W h ≈ 160 kN m/rad) is a large part of the narrow gear's
  roll stiffness.

## 6. Results (stage 2, measured)

**Trims** (18,300 lb, SL ISA; residual < 1e-4 in every case):

| | AMCS: torque / Ng / TIT | pitch / roll | ICS: torque / Ng / TIT | pitch / roll |
|---|---|---|---|---|
| Hover OGE | 73.2 % / 90.1 % / 561 °C | +0.2° / 5.2° left | 71.9 % / 90.6 % / 569 °C | +0.2° / 5.1° left |
| 60 KTAS | 38.8 % / 81.8 % / 494 °C | −1.3° / 2.7° left | 38.4 % / 82.3 % / 498 °C | −1.3° / 2.7° left |
| 120 KTAS | 41.2 % / 82.5 % / 499 °C | −3.6° / 2.9° left | 41.0 % / 83.1 % / 503 °C | −3.6° / 2.9° left |

Nr holds 239.85 rpm (AMCS) and 246.0 rpm (ICS).

**Plan rows G9–G15** (the gyro rows G1–G8 are in control-gyro-model.md):

| Row | Target (tag) | Measured | |
|---|---|---|---|
| G9 hover attitude IGE | roll 2–7° left, pitch −1…+4° (P APE-I / ESTIMATE) | 4.58° / 4.51° left; +0.08° | pass |
| G10 HOGE 18,750 lb std, no wing, no pusher | 9,000–11,500 ft (ESTIMATE) | 11,410 ft: engine-limited (Ng 101.1 % at 85.8 % torque, 757 °C; above it Ng meets 101.5 %) | pass |
| G11 engine failure, hover, collective held | Nr 100 → 90 % in 0.4–1.0 s (ESTIMATE); left yaw, slight right roll (P sense) | 0.59 s; peak yaw 79°/s left in 2 s; roll 3.5° LEFT at 1 s | Nr and yaw pass; roll **KNOWN GAP** |
| G12 T64 | idle Ng 58–72 %; TIT ≤ 740 °C at 114 %; the start (P) | idle 64.95 %; 709.8 °C at 113.9 % (Ng 98.6 %, climbing 2,200 ft/min at 20,500 lb); grip to IDLE at 6.0 s, idle at 29.0 s, TIT peak 561 °C | pass |
| G13 wheels | three-wheel reset; taxi turns ≤ 10 m unlocked; locked ±2° over 200 m; vertical take-off and landing; gear cycle 3–8 s; overspeed flag above 130 KCAS; run-on stop ≤ 300 m from 60 KCAS; parking brake at ground idle (P limits / ESTIMATE) | rests level (3.2° lean, pedals centred); turn radius 1.1 m unlocked (189 m locked); locked 0.30° after a brake tap at 15 kt (unlocked 28.6°); up to 6.1 m and down at 0.9 m/s; gear 6.3 s each way; run-on stop 164 m (brakes alone; the −12° reverse pitch is stage 4); parking brake drift 0.05 m | pass, except the overspeed flag: **KNOWN GAP** (flightModel's overspeed check does not run for a rotorcraft; contract request to TW) |
| G14 configuration | Nr 246 / 239.85 rpm; persisted through reset and resume; trims 0/60/120 both (AGENT) | 246.0 / 239.9 rpm after 10 s; ICS kept through `SimPhysics.reset` and a JSON snapshot restored without the URL config | pass |
| G15 spawns | every scenario survives 5 s in both configurations | runway, apron, final, cruise, downwind × AMCS / ICS | pass |

**The helicopter hold** (`scripts/probes/heliHold.test.ts`, AC=ah56, informational) flies the AH-56 on the generic scripted-pilot gains
without a disconnect:
- calm hover: position RMS 0.06 m (maximum 0.17 m);
- windy hover (8 kt, gusts 3 kt): 2.4 m RMS (maximum 11 m), against the MD 500E's 2.2 m RMS (maximum 10.4 m) in the same probe;
- the speed / heading / altitude sequence: altitude RMS 2.0 m.

The rate command needs no per-definition gain scaling at stage 2 (AGENT); `scriptedPilot.ts` is unchanged, and the R22 demos are untouched.

## 7. For the next stages

- **AC (compound.ts).**
  - The wing and the pusher. The fuselage x flat plate (2.0 m²) is AC's to recalibrate.
  - `governor.propAnticipation` and the pusher's inertia join the drivetrain: G11's 0.59 s uses the stage-2 drivetrain without the pusher,
    13,650 kg m², against the P 14,564.
- **AH (highSpeed.ts).** The ICS pitching-moment path is live: `pitchingMomentGain` 1 times the section's Cm harmonics reaches the gyro.
- **Integrator.**
  - The gyro's air data (control-gyro-model.md section 5).
  - The gear-overspeed rule for a rotorcraft.
  - The other packages' copies of the AH-56A facts (AU's audio rated power, AX's pilot eye, PN's red line), which disagree with the
    stage-2 definition until they merge (the consistency check).
