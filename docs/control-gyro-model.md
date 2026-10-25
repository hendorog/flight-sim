# The Lockheed control gyro (AH-56A, ICS 1972 and AMCS 1973)

Stage 2 of the AH-56A programme (package AG, plan revision 2 section 7.2). Code: `src/physics/rotorcraft/controlGyro.ts`; data:
`src/aircraft/ah56/gyro.ts` (both configurations) and `facts.ts`; tests: `tests/rotorcraft/ah56Gyro.test.ts`, `ah56GyroModes.test.ts`,
`ah56Handling.test.ts`. Every choice below that is not printed in a source is an **AGENT choice**, not an owner decision. The AMCS
default and the ICS runtime configuration are AGENT choices too (owner-notes lists them as such).

Tags as in `docs/ah56-sources.md`: P primary, D derived (arithmetic shown), INF inference from primary text, ESTIMATE judged.

## 1. What the gyro is

On every Lockheed rigid-rotor aircraft before the AMCS the cyclic swashplate **was** a gyroscope: a four-arm flywheel on the rotor head,
gimballed so it can tilt relative to the shaft, spinning with the rotor. The blades' pitch links run to it, so the blade cyclic is its tilt.
The pilot cannot position it. His stick strains a spring, the spring puts a **moment** on it, and it precesses. The blades feed their
feathering moments back to it through the pitch links: forward sweep makes the feathering moment about tan(sweep) × the blade's flap bending
moment (CR-114362). In equilibrium the stick commands **hub moment**, and in space the gyro holds its plane (P ASTA-72 App B–C; Hoh-74).

- **ICS (1972, 66-8834).** The 45 slug-ft², 9.7 ft gyro X on the head. Feathering-moment feedback, "corrupted" by the blade pitching moments and,
  through the 3°10′ droop, the in-plane moments (Hoh-74).
- **AMCS (1973, ship 7, 66-8832).** A 1.5 slug-ft², 26 in gyro below the transmission. Irreversible servos cut the feathering-moment path. The
  first-harmonic flapping comes back through separate linkage and springs (K_R), and the gyro is "a full authority attitude gyro positioned
  in space by the pitch or roll rate command of the pilot" (Hoh-74 sect. 6.1).

## 2. The equation

NASA CR-114362 (Watts, London & Snoddy, Lockheed 1971, NTRS 19710028118; downloaded to `work/rigid/sources/lockheed/ntrs-19710028118/`)
derives the rotor–gyroscope–body equations in Appendix A. Transcribed for the gyro (OCR of pp 211–231; the typography is reconstructed):

- In its own rotating axes each tilt axis of an unrestrained gyroscope is an uncoupled oscillator at its spin speed Ω_G.
- Transformed to stationary axes (the sine–cosine transform of App A p 221), the gyro terms are the diametral inertia, the antisymmetric
  gyroscopic coupling **2 Ω_G I_G**, and the transformed rotating terms.
- The **swashplate springs K_S and dampers C_S act in the stationary axes with equal diagonal elements and zero off-diagonal elements**
  (App A p 231).
- **Rotating damping C_R** ("terms involving rotating friction about the blade feathering axis", p 211) acts in the rotating axes. In the
  stationary axes it is C_R (φ̇ + Ω_G J φ).

Reduced to precession (the diametral inertia dropped: the nutation is at about 2 Ω_G, fast, and not modelled). With the tilt φ = (roll, pitch)
relative to the shaft, h = rotation × I_g × spinRatio × Ω the spin momentum along the shaft's up axis, and J(a, b) = (−b, a) the 90° turn:

    h J (φ' + ω) + C φ' + C_R (φ' + rotation Ω_g J φ) = M_pilot − K_net φ − M_feedback − M_extra

- ω = the body rates (p, q) in shaft axes. The gyro holds its plane in space (the stabiliser-bar effect), so a body rate demands a precession
  h J ω.
- A moment precesses the gyro **90° away from its own axis**. The linkages deliver the pilot's moment and the rotor's feedback turned by that
  90° (sgn(h) J) and then by the residual azimuth angles of section 4:
  - M_pilot = sgn(h) J R(input) m_stick
  - M_feedback = sgn(h) J R(feedback) F x

  With nothing else acting the stick is a **rate command**, φ' = R(input) m_stick / |h|. The feedback alone gives φ' = −R(feedback) F x / |h|:
  the **auto-trim**, in which the gyro precesses until the hub moment is gone.
- **The springs and dampers act in the physical axes.** A fixed spring therefore makes the gyro **precess** about M/K at the rate K/h. It does
  not lag first-order (CR-114362 App C: "when the swashplate is restrained by springs, the natural frequency … decrease[s]"). This is why
  G1 is read as in section 7.
- A damper on the rotating gimbal (C_R), seen from the shaft, adds C_R Ω_g J φ. That aligns the gyro with the shaft at the rate C_R / I_g,
  which is Hohenemser's "small 1/τ term [from] damping on the rotating gimbal axes". The sign is tested (`ah56Gyro.test.ts`, C_R alignment):
  5.4° decays to 1.452° in 4 s at C_R = 20, against 1.451° from e^(−C_R t / I_g).

**Coordinates.** The state `RotorcraftState.controlGyro` is `{mode, pitch, roll, pitchRate, rollRate}`. The tilt is labelled by the disc tilt
it commands: pitch + = disc aft, roll + = disc right, the `gyroBladeCyclic` convention the exteriors draw. `cyclic()` returns
`gyroBladeCyclic(state)` (RC's contract request), and `swashplateCyclic` agrees. The mode is read from state on every call, so a restore that
changes it takes effect.

**Neglected (one line each).**
- The gyro's gimbal and spring reactions on the airframe: at most K_s × 0.26 rad ≈ 1.4 kN m, against hub moments of 10–100 kN m. The gyro's
  spin momentum (1,572 kg m²/s, 0.5 % of the rotor's 341,000) is in the gyroscopic ω × H only (`Rotorcraft.angularMomentum`).
- The nutation.
- The blade feathering inertia (CR-114362's "single gyroscope" with the gyro).
- The lag degree of freedom and torsion: the 1P × 2P instability and the half-P hop are stage 5's scripted event.

## 3. Feedback

- **ICS** (`featheringMoment`): the per-blade feathering moment is

      tan(sweep) × flap root moment + droop × in-plane moment + pitchingMomentGain × pitching moment

  The flap part is tan 4° × the hub moment (`FlapSystem.hub`). The other two are the first harmonics RC returns
  (`GyroBladeMoments`: Cm0 now, the moment-stall section at stage 5), with pitchingMomentGain 1 (INF: "the entire blade feathering moments
  were transmitted", Hoh-74). Sweep 4°00′ and droop 3°10′ (P ASTA-72 p 49). `featheringMoment()` in controlGyro.ts composes it.

**The three signs, from the blade geometry** (blade frame: r outboard along the feathering axis, t the direction of motion, n = r × t up; a
positive moment about r lifts the leading edge, nose up). `ah56Gyro.test.ts` "feathering-moment signs" computes r × F for one element and
pins each:
- **Sweep (D, confirmed).** Forward sweep puts the lift ahead of the feathering axis: L n at a t gives a L about r, nose up, tan(sweep) per
  unit flap moment. The model's sign.
- **Pitching moment (confirmed).** The section moment about the quarter chord acts about the feathering axis directly, nose up + (Cm0
  −0.012, nose down, so the term is nose down).
- **Droop (INF direction; NOT the model's sign).** The sources give "droop 3°10′" without the direction; with the usual meaning (the blade
  below the feathering axis) the in-plane drag (opposing rotation) acts below the axis: (−d n) × (−D t) = −d D r, **nose down**. The model
  flies the opposite sense (`DROOP_SENSE = +1`). The derived sense at the P droop is a loop instability in this model: on a fixed shaft in
  the hover a 0.5° gyro kick grows to a limit cycle between the stops (15.4° of tilt after 6 s; 11.8° at 1/960 s steps against 14.1° at
  1/240 s, so it is the loop, not the step), while half the droop in the derived sense is stable (0.002° after 6 s). A model without the lag
  and feathering-inertia degrees of freedom cannot settle it; the earlier "the stable sign" probe ran with the feedback rotation in the sense
  the model no longer flies, so it is not the evidence. Open question for the plan (contract request): the droop sense the ICS really had.

**Which term causes which ICS miss** (probe `work/rigid/probes-ag2/signs.test.ts`, the droop and the pitching-moment gain each × {+1, 0, −1};
G3 = the gust hub moment left at 0.5 s, 100 KTAS, against 9.9 kN m locked):

| droop / Cm0 gain | G3 residual | G7 pitch hover: first peak, τ63 | G7 roll hover: peak, τ63 | G7b first-peak ratio 120 / 150 KCAS (rate at 1 s) |
|---|---|---|---|---|
| +1 / +1 (flown) | 6.83 kN m (69 %) | 5.68 °/s/in at 2.48 s, 0.84 s | 9.47 °/s/in, 0.295 s | 0.47 / 0.45 (0.65 / 0.60) |
| +1 / 0 | 7.05 kN m | 5.82 at 2.69 s, 0.86 s | 9.50, 0.297 s | 0.46 / 0.44 |
| +1 / −1 | 7.25 kN m | 6.00 at 3.08 s, 0.90 s | 9.53, 0.299 s | 0.44 / 0.51 |
| 0 / +1 | 0.40 kN m (4 %) | 15.8, still rising at 4 s, 2.28 s | 35.3, 1.84 s | 0.15 / 0.15 (0.46 / 0.41) |
| 0 / 0 | 0.40 kN m | 14.9, rising at 4 s, 2.18 s | 36.8, 2.09 s | 0.16 / 0.12 |
| −1 / any (the derived droop sense) | — | unstable: the gyro limit-cycles between its stops | | |

- **G3 (69 % residual): the droop term, entirely.** Without it the auto-trim leaves 4 %; the Cm0 gain moves it by ±0.2 kN m only.
- **G7 pitch (5.7 °/s/in, τ 0.84 s against 9–14 and 1.5–3.5 s): the droop term.** Without it τ63 is 2.28 s (inside the band) and the rate
  passes 14 °/s/in still rising at 4 s.
- **G7 roll: the droop term is what brings it into range.** Without it the roll rate is 35–38 °/s/in (band 11–16, above M/H = 16.7, an open
  question on the sweep-only model) with τ63 2.1 s (band 0.3–0.7).
- **G7b (0.47 / 0.45 X against 0.8–1.0 / 0.6–0.8): not the droop term.** Without it the ratios fall to 0.15 / 0.15: a model limit of the
  speed terms whatever the droop.
- **Cm0: second order on every row**; its sign is confirmed, no gap is attributed to it.
- **AMCS** (`flapping`): K_R × the first-harmonic flap through springs, FITTED (section 6).
- The 28 ft-lb **feather-bearing friction** (P) is flown as CR-114362's rotating damping. Its describing-function equivalent at a 5° cyclic
  amplitude is 4F / (π Ω A) = 4 × 38.0 / (π × 25.76 × 0.0873) = 21.5 N m s/rad (D). A Coulomb dead band made the trimmed tilt non-unique, and
  the ICS trim residuals noisy.

## 4. Senses and the residual rotations

"Advanced" means turned in the rotor's rotation direction. In the tilt plane that is a negative rotation for the counter-clockwise rotor, so
both senses are −1 (`INPUT_SENSE`, `FEEDBACK_SENSE` in controlGyro.ts). They were chosen on the fixed shaft, not assumed:

- **Feedback.** The P cant, 33° advanced, gives a stable auto-trim with its least-damped root at −3.11/s. The same 33° in the other sense puts
  a pair of roots in the right half plane (+3.38/s). The model's best-damped phase is 20° (−5.31/s), within the plan's ±15° of 33°. The ICS
  keeps the P 33°. The AMCS, whose angles are not published, flies the best-damped 20° (ESTIMATE).

  ICS hover, least-damped real part, 1/s (`ah56GyroModes.test.ts`):

  | Feedback rotation (advanced) | −33° | 0° | 10° | 15° | 20° | 25° | 30° | 33° | 40° | 50° |
  |---|---|---|---|---|---|---|---|---|---|---|
  | least-damped real part, 1/s | +3.38 | −1.93 | −3.62 | −4.46 | −5.31 | −4.46 | −3.62 | −3.11 | −1.94 | −0.28 |

- **Input (FITTED to G8).** The P 36° advanced gives about 1.6°/s of roll per °/s of pitch on a pure longitudinal stick in this model. The
  model lacks what the real ICS used against exactly that coupling: the swashplate feedback to the roll servo ("to reduce cross-coupling due to
  gyro pitch precession", ASTA-72 App C) and the feathering-inertia degree of freedom. Fitted values:
  - **ICS 13° advanced.** No single angle meets 20 % at both speeds: the hover needs 2.5–12°, 100 KCAS 14–22°. 13° gives +0.24 at the hover
    and −0.14 at 100 KCAS.
  - **AMCS 9° advanced:** +0.02 at the hover, +0.08 at 100 KCAS.

## 5. Integration

The ICS loop gain Λ K_hub / H is 31.9/s at 100 % Nr (`ah56GyroModes`: tan 4° × 716 kN m/rad / 1572 kg m²/s; the plan's 49/s assumed a
larger K_hub). That is 0.13 per step at 240 Hz and 1.6 per step at settle's 0.05 s, so the gyro tilt (2) and the flap harmonics (2) advance
as **one** constant-coefficient 4 × 4 system, exactly:

- RC's `FlapSystem` is in the matrix (dx/dt = a x + f + b (θ − θ0), θ = the cyclic from the tilt, hub moment = hub x).
- The constant forcing goes through the 5 × 5 augmented exponential (scaling and squaring of the Taylor series, `expm`).
- One step of 0.05 s equals ten of 0.005 s to 1e-7. The trims converge with residuals of 4e-6 to 1e-4.

The stops clamp the tilt after the step and the flap is re-stepped with the cyclic held at the stop. The tilt is the only state, so there is
no wind-up: a released stick leaves the stop on the next steps.

Settle's relaxation uses the same exact step, seeded by `seed(c)`: the static equilibrium with the flap following the cyclic. A second
settle agrees with the first to 1e-6.

**Air data.** The speed-scheduled augmentation (ICS pitch desensitizer, decoupler, roll compensator; AMCS trim augmentor and sideslip SAS)
needs the hub air velocity. `Rotorcraft.compute` does not pass it yet. The method takes an optional trailing `air` argument and
`setAirData()`, and without either the augmentation is **dormant**. **Contract request (RC / integrator)**: pass `{ hub: hubAir, density }`
as the last argument of the `this.gyro.advanceCoupled(...)` call in rotorcraft.ts (work/rigid/ag-integrator-requests.patch). The test
rig stands in for it: it sets the air data before the trim (`reset()` keeps it, so the trim's settle includes the augmentation) and once per
step from the flight state. With the patch applied (then reverted; AH56_AIRDATA=off forces the production path, and the rig retires the
stand-in by itself once `PRODUCTION_AIR_WIRED` sees the wiring) the sim agrees with the stand-in rig: pitch 4.78 / 4.26 against 4.79 / 4.27
°/s/in at 100 / 150 KCAS, roll within 0.09 °/s/in, the 150 KCAS roll sensitivity 65.8 against 65.1 °/s²/in (4.5 % under the 68.9 edge),
G8 AMCS p/q 0.09 against 0.08 at 100 KCAS, the keyboard tap 0.02° against 0.36°; every row passes or fails as before. The desensitizer is
checked at the block: 0.857 at 120 KCAS and 0.50 at 170 KCAS of the hover's tilt rate per inch.

An earlier rig set the air data only from the first step, after a trim without it. The augmentation then switched on with the stick step:
the AMCS trim schedule's −0.3 in at the hover and +0.2 in at 150 KCAS rode on the 1 in step and turned the measured responses into 0.7 and
1.2 in responses. The AMCS fit below was redone with the trim-inclusive air data; the ICS numbers in section 7 changed with it.

## 6. Derived response targets and the fitted AMCS numbers

**τ ≈ Λ I / H (the feedback-dominated regime, plan 7.2).**
- With Λ K_hub ≫ K_s the gyro balance H J ω = M_p − Λ R M_hub gives M_hub = (M_p − H ω) / Λ.
- In the hover, I ω' = M_hub. That is a first-order rate response with τ = Λ I / H and a steady rate of M_p / H.
- **XH-51A check** (P Lentine-68):
  - Λ = tan 1.4° = 0.0244.
  - H = 7.5 slug-ft² × 37.2 rad/s = 279 slug-ft²/s.
  - Ixx 1500 slug-ft² gives τ_roll = 0.0244 × 1500 / 279 = 0.13 s, against 0.15 s measured.
  - Iyy 3180 slug-ft² gives τ_pitch = 0.28 s, against 0.25 s measured.
- **AH-56 ICS** (H = 45 × 25.76 = 1,159 slug-ft²/s; Ixx 8,000, Iyy 42,000 slug-ft² ESTIMATE): τ_roll 0.48 s and τ_pitch 2.5 s in the hover.

**AMCS fit.** The plan fixes H at the ICS value (ESTIMATE: 2.03 kg m² geared to about 7,380 rpm) and fits only the stick moments and K_R.
Only M/H and M/K are observable. AMCS-73 paras 33–34 (P) define the responses for a held 1 in step: the maximum rate per inch ("control
response") and the maximum acceleration per inch ("sensitivity"), "approximately constant throughout the airspeed range", tested at 0, 60,
150 and 180 KCAS: 6 °/s/in pitch, 9 °/s²/in. Hohenemser (Hoh-74 §6.1) gives 9 °/s/in at the hover.

**The maximum rate is the first peak** (`ah56Rig.firstPeak`: the first sample no later one exceeds for 0.5 s; a row whose rate is still rising
when the window closes fails). After the first peak the attitude change carries the aircraft into another condition: the hover pitch rate
peaks at 6.07 °/s/in at 0.96 s, dips to 5.95, then creeps to 6.39 at 3 s and 7.5 at 7 s with the nose 30° up. The earlier fit read the
end of the 3 s window (6.39) as the maximum.

The grid (811 / 975 N m held, K_R varied; first-peak rates, °/s/in, and sensitivities, °/s²/in; `work/rigid/probes-ag2/fitgrid.test.ts`):

| K_R, kN m/rad | hover pitch (peak time) | 100 / 150 KCAS | sensitivity hover / 100 / 150 | sensitivity / hover rate | roll hover / 150, sensitivity 150 |
|---|---|---|---|---|---|
| 6 | 6.61 (0.91 s) | 5.35 / 4.83 | 12.6 / 12.1 / 12.6 | 1.91 /s | 14.6 / 15.7, 67.7 |
| 7 | 6.24 (0.94 s) | 4.96 / 4.44 | 11.9 / 11.4 / 11.8 | 1.91 /s | 14.3 / 15.2, 66.0 |
| 7.5 (flown) | 6.08 (0.96 s) | 4.79 / 4.27 | 11.6 / 11.1 / 11.5 | 1.91 /s | 14.3 / 15.0, 65.1 |
| 8 | no peak in 3 s | 4.62 / 4.10 | 11.3 / 10.8 / 11.2 | — | 14.3 / 14.7, 64.3 |
| 9 | no peak in 3 s | 4.32 / 3.81 | 10.7 / 10.2 / 10.6 | — | 14.4 / 14.2, 62.6 |
| 12 | no peak in 3 s | 3.62 / 3.11 | 9.3 / 8.9 / 9.1 | — | 14.5 / 12.9, 58.0 |

- The responses scale with the stick moment; the ratios do not. **The sensitivity per unit hover response is 1.91 /s at every K_R from 6 to
  7.5**, and from 8 up the hover rate has no first peak inside 3 s.
- Hoh-74's hover band (9 ± 30 %: ≥ 6.3) with the 9 °/s²/in sensitivity band (≤ 11.7) needs ≤ 11.7 / 6.3 = 1.86 /s. **No (M, K_R) meets
  both**: that row is an expected failure (`ah56Handling.test.ts` G5 KNOWN GAP), not a fitting miss. AMCS-73's own hover number (6, P) is met.
- K_R sets how much of the rate survives at speed (150 KCAS / hover 0.73 at 6, 0.71 at 7, 0.70 at 7.5) against the stabiliser.
- **Stage 2 kept 811 N m / K_R 7,500** (the grid above, on the helicopter without wing or pusher). The margins then: hover pitch 6.08,
  150 KCAS 4.27 (1.7 % above 4.2), sensitivity 11.57 (1.1 % under 11.7), roll sensitivity at 150 KCAS 65.1 (5.5 % under 68.9). The model's
  sensitivity per unit response (1.9 /s) is above AMCS-73's (9 / 6 = 1.5 /s), which is what leaves no margin.

**The flown AMCS numbers (gyro.ts).** The fitting condition is the whole aircraft: the wing, the pusher on the shared shaft, the stores and
the stage-5 blade section. Only K_R and the longitudinal stick moment were refitted after stage 2 (the wing, the pusher and the unloaded
rotor took the 150 KCAS pitch response from 4.27 to 3.81 °/s/in with 7,500 / 811):
- stage 4 (AC, docs/ah56-compound.md section 5): K_R 3,000 N m/rad, longitudinal 590 N m;
- stage 5 (AH, docs/ah56-high-speed.md section 5.1; the Prandtl-Glauert lift slope raises the hub moment per cyclic about 6 % at the hover
  tip): **K_R 3,200 N m/rad, longitudinal 566 N m**, with the lateral moment 975 → 907 N m and the input rotation 9 → 5°.
Until the final fix round these two lived in compound.ts as an override of the stage-2 pair (`AH56_COMPOUND_GYRO`); they are now
`AMCS_FLAP_FEEDBACK` and `AMCS_LONGITUDINAL_STICK_MOMENT` in gyro.ts, so the no-compound rig (G10) flies them too. The flown aircraft is
unchanged by the move (a whole-flight-model digest of both configurations is identical before and after).

What they give on the flown aircraft (18,300 lb, SL ISA, stores on; first peaks of a held 1 in step). The left column is the
aircraft as merged (`9d70cad`, docs/ah56-integration.md section 4); the right column after the final fix round (the rotor's in-plane
force as a vector, the pusher's gyroscopic reaction, the trim's speed of sound, the wing section Cm and the DATCOM downwash;
docs/ah56-integration.md section 11). The gyro numbers did not move.

| Row | As merged | Final fix round | Target (tag) |
|---|---|---|---|
| G5 pitch, 0 / 100 / 150 KCAS | 5.78 / 4.93 / 4.57 °/s/in | 5.54 / 4.94 / 4.61 | 6 ± 30 % = 4.2-7.8 (P AMCS-73 para 33) |
| G5 pitch sensitivity, hover | 11.54 °/s²/in (1.4 % under the edge) | 10.82 (7.5 % under) | 9 ± 30 % = 6.3-11.7 (P) |
| G5 roll, 0 / 100 / 150 KCAS | 14.6 / 15.6 / 15.6 °/s/in | 14.7 / 15.7 / 15.7 | 13-16 ± 30 % (P) |
| G5 roll sensitivity, hover / 150 KCAS | 63.5 / 67.6 °/s²/in | 63.6 / 67.3 | 60 / 53 ± 30 % (P) |
| C18 pitch / roll at 180 KCAS | 4.26 / 15.6 °/s/in; roll sensitivity 66.6 | 4.32 / 15.7; 66.3 | 6 / 16 ± 30 %; 53 ± 30 % (P) |
| C19 pull-up from 180 KCAS | 2.43 g at 1.78 s | 2.43 g at 1.75 s | 2.43 g in about 2.1 s (P AMCS-73 para 39) |

| Fitted (AMCS, ESTIMATE) | Flown value | What fixed it |
|---|---|---|
| Stick moment at full longitudinal stick (4.95 in) | 566 N m (114 N m/in); stage 2: 811 | G5 pitch response and hover sensitivity, C18 at 180 KCAS, on the compound |
| Stick moment at full lateral stick (2.9 in) | 907 N m (313 N m/in); stage 2: 975 | G5 roll response and sensitivity, C9 lateral trim |
| K_R | 3,200 N m/rad; stage 2: 7,500 | the 150 KCAS / hover pitch ratio against the hover sensitivity, on the compound |
| Input rotation | 3° advanced (tune round 3; stage 5: 5°; stage 2: 9°) | G8 |
| Feedback rotation | 20° advanced | the best-damped auto-trim |
| Spring / negative spring / C_R | 5559 / 5309 N m/rad (net 250; tune round 3, was 4500, net 1059) / 0.4 N m s/rad | ESTIMATE (net spring small against K_R: Hohenemser's negative spring; section 7b) |
| SSL gain G | 1 | the stops read as cyclic (G5a) |

## 7. Results (stage 2; targets from plan 7.2)

Measured on the stage-2 aircraft (18,300 lb at FS 298, SL ISA, no wing and no pusher). `[ah56]` lines in the test logs;
`AH56_TRACE=<dir>` writes them.

| Row | Target (tag) | Measured | |
|---|---|---|---|
| G1 ICS block, feedback off, rotor locked | initial precession 13.7 / 16.7 °/s/in ±5 %; H/K 0.283 s; steady tilt 3.9 / 4.7 °/in; clamp ±15° (D ASTA-72 App C) | 13.74 / 16.65 °/s/in; precession rate 3.58 rad/s (K/H 3.54, i.e. **H/K = 0.283 s is the precession time scale**); circle centre 3.89 / 4.71 °/in; clamps at 15.00° and leaves the stop at once | pass, read as a precession (section 2) |
| G2 (ii) every mode stable ≥ 83 % Nr (P) | Re < 0 | 70 %: −1.75, −5.73; 83 %: −2.18, −6.47; 100 %: −2.75…−3.11, −7.48; 110 %: −3.08, −8.08 /s (ICS hover) | pass |
| G2 (i) the loop gain (D; the plan row's "∝ Ω" assumed a purely centrifugal hub) | tan(sweep)(B/2)(e M_β Ω² + K_β)/H at 70 / 100 / 110 % Nr, ±1 % | 30.40 / 31.88 / 32.94 /s, equal to the formula; loop/Ω 1.69 / 1.24 / 1.16 (the spring is 52 / 35 / 31 % of K_hub) | pass (plan amendment requested) |
| G3 auto-trim, 3 m/s gust at 100 KTAS | < 10 % of the locked value within 0.5 s (P CR-114362 / D) | the feathering-moment auto-trim: 4.7 % at 0.2 s, 4.1 % at 0.5 s. The full ICS: 69 % at 0.5 s, all of it the droop × in-plane term (section 3) | clean pass; full ICS **KNOWN GAP** (the "corrupted" feedback, Hoh-74) |
| G4 steady hub moment per inch, ICS hover | 5.39 / 6.54 kN m/in ±20 %; flap-frozen ≥ 5× (D) | 4.53 / 5.50 kN m/in; flap-frozen 49.8 / 60.3 kN m/in (11×) | pass |
| G5 AMCS response / sensitivity | pitch 6 °/s/in hover–150 KCAS ±30 % (P AMCS-73), 9 at the hover (Hoh-74); 9 °/s²/in; roll 13–16 °/s/in; 60 °/s²/in hover, 53 at 180 KCAS | first peaks: pitch 6.08 (0.96 s) / 4.79 (0.75 s) / 4.27 (0.64 s) °/s/in at 0 / 100 / 150 KCAS; 11.57 / 11.09 °/s²/in; roll 14.3 / 14.8 / 15.0 °/s/in (0.94 / 0.40 / 0.40 s); 58.8 (hover) / 65.1 (150) °/s²/in | AMCS-73 pass (fitted; 1.7 % above the 4.2 edge at 150 KCAS, 1.1 % under the 11.7 sensitivity edge); Hoh-74's hover 9 (≥ 6.3) **KNOWN GAP** (section 6: no (M, K_R) meets it with the sensitivity) |
| G5a cyclic authority | ≥ ±8° (D) | stops 10.11 aft / 18.05 fwd / 12.27 R / 18.08 L at G = 1; full stick on a fixed shaft settles at 5.8° of tilt with 6.0° of flap (72.6 kN m), inside the stops; the 150 KCAS trims inside the stops | pass |
| G6 AMCS attitude retention, no SAS | bank within 2° for 10 s after a 10° disturbance at 80 KCAS (P Hoh-74) | 11.8° bank held within 1.23° (SAS off, as "no SAS was used"); with the sideslip SAS on, the uncoordinated turn rolls level (≈ 7° in 10 s) | pass |
| G6 keyboard tap | ≤ 3° over 10 s (ESTIMATE) | 0.36° (0.02° with the production air wiring) | pass |
| G6 variant: a steady 625 N m roll moment (AG, no plan band) | what the AMCS holds | the bank precesses: 0.16 °/s at 2–3 s at the hover (K_R β / H = 7500 × (625 / 693 kN m/rad) / 1572 predicts 0.25 °/s), +2.1° at 10 s, +16.6° at 20 s; at 80 KCAS 0.14 °/s, then the weathercock and the sideslip SAS hold it to +2.1° at 20 s | recorded: **attitude retention holds only with no residual moment** (below). Tune round 3 (K_net 1059 → 250, section 7b): +0.90° at 10 s, +5.1° at 20 s, the rate at 20 s −0.01 °/s (was 0.91): the rate command, no longer the divergence |
| G7 ICS roll | τ 0.3–0.7 s; ≈ 34 °/s²/in ±40 %; 11–16 °/s/in (D) | τ63 0.295 s (interpolated between samples; it read 0.30 quantised); 30.9 °/s²/in; first peak 9.5 (hover, roll compensator on) / 10.2 °/s/in (150 KCAS) | acceleration pass; τ **KNOWN GAP** (1.7 % under the edge) |
| G7 ICS pitch | τ 1.5–3.5 s hover, 0.8–2.0 s at 150 KCAS; ≈ 5.4 °/s²/in ±40 %; 9–14 °/s/in (D) | τ63 0.84 s (hover) / 0.32 s (150 KCAS); 6.38 °/s²/in; first peak 5.7 (2.48 s) / 2.6 °/s/in | acceleration pass; τ and the steady rates **KNOWN GAP** (the droop term, section 3) |
| G7a ICS full lateral stick, 120 KCAS | 40–65 °/s; right/left 1.5–1.9 (D / P ASTA-72 para 60) | 50.0 R / 31.1 L °/s, ratio 1.61 (trim stick 0.76 in left); asserted: the right rate in 40–65 (25 % / 23 % margins) and the ratio in 1.5–1.9 (7 % / 15 %) | pass |
| G7b ICS desensitizer | 0.8–1.0 X at 120 KCAS, 0.6–0.8 X at 150; τ63 grows with speed (ESTIMATE) | first-peak ratios 0.47 (120) / 0.45 (150) (4 s window); the plan's rate at 1 s 0.65 / 0.60; τ63 falls 0.84 → 0.32 s | **KNOWN GAP** (not the droop term: without it 0.15 / 0.15); the plan's G7 (τ falls with Mq) and G7b (τ grows) disagree |
| G7b AMCS | 6 °/s/in ±30 % hover to 150 KCAS (P AMCS-73 para 33) | first peaks 6.08 (0.96 s) / 4.79 (0.75 s) / 4.27 (0.64 s), each asserted to peak inside the 4 s window | pass, 1.6 % above the 4.2 edge at 150 KCAS |
| G8 off-axis, pure longitudinal stick | roll ≤ 20 % of pitch (hover, 100 KCAS); angles within ±15° of 36° / 33° (P angles / AGENT) | AMCS +0.02 / +0.08. ICS +0.24 / −0.14 with the input at 13° (P 36°) and the feedback at 33° (P) | AMCS pass; ICS **KNOWN GAP** (section 4) |
| G9 hover attitude IGE | roll 2–7° left; pitch −1…+4° (P APE-I / ESTIMATE) | AMCS 4.58° left, +0.08°; ICS 4.51° left, +0.08° | pass |

**Why the ICS reads short of the derived steady rates.** The derivation assumes the rate approaches M/H. In the model:
- the ICS's physical spring (4100 ft-lb/rad net, no negative spring) precesses the gyro sideways;
- the hover attitude change (the pitch rate reaches 6°/s within 2.5 s) carries the aircraft away from the hover condition.

So the maximum rate comes early and lower: the hover pitch maximum is 5.7 °/s/in against the 13.7 the moment alone would give. The initial
accelerations (M/(Λ I)) agree with the derivation. Plan G7's "steady rate ≈ (M_stick − K_s θ_rel)/H" acknowledges the spring term. The term
sweep in section 3 shows the droop × in-plane term is what slows and lowers it: without it the hover pitch τ63 is 2.28 s.

**What the AMCS attitude retention holds and what it does not.** The AMCS feedback is K_R × the first-harmonic flap, which nulls the **hub
moment**, not the attitude error. G6's disturbance is a stick-induced bank that leaves no residual moment, so the bank holds (1.23°). A
**steady external moment** M needs a steady hub moment −M, i.e. a flap β = M / K_hub, and K_R β precesses the gyro, and the aircraft
following it, at K_R β / H: about 0.26 °/s per kN m at the hover (G6 variant above). So attitude retention holds only with zero residual
moment; a trim change, a CG shift or the hover in-plane force step (KNOWN_ISSUES #2) becomes a slow steady rate the pilot trims out.

## 7b. Tune round 3: the hover with the gyro alone (the CL-475 / XH-51A films)

The owner's films (owner-notes 2026-10-22): the CL-475 and the XH-51A (no pusher) hovered with a man on a ~16 ft side boom, the
XH-51A one hands-off over about 15 s; a man lifted hanging from a nose handle with the pitch near level. Rows:
`tests/rotorcraft/ah56GyroHover.test.ts`, on the stage-2 helicopter (no wing, no pusher), aids off, stick held where the trim put
it; probes and logs in `W/tune2/ah56` (notes.md).

**What a gyro can hold and what it cannot.** With the stick held, rates and velocity zero (φ' = 0, ω = 0), the gyro's balance

    K_net φ + C_R Ω_g J φ + sgn(h) J R(fb) F x = sgn(h) J R(in) m_stick

has a unique tilt for the stick moment, so the flap and the hub moment are pinned to the stick. A body that leans does not change
the thrust's moment about the CG (it turns with the body). A NEW steady moment M therefore has no fixed-lean equilibrium at zero
velocity, whatever K_net: it becomes a steady rate, the precession K_R (M / K_hub) / H (AMCS) or tan(sweep) M / H (ICS), or a drift.
This is Hoh-74's rate command (eq 6.1-6.2): "the gyro ... is positioned by the pilot with the help of an attitude rate command", and
"trim ... depends only on τ and the body trim moments". The film's boom hover was TRIMMED (the man on the boom from the lift-off),
and a trimmed offset holds: A2 / A3. The nose-handle step was the pilot's to take out (a 2.2 kN m step is about 0.34 in of ICS stick).

**The defect: the AMCS net spring.** The springs act in the physical axes and the feedback arrives turned 90° (section 2), so at
equilibrium the spring's torque K_net φ is balanced by a residual flap of K_net / K_R times the gyro tilt, turned 90° (+20°). At
the stage-2 ESTIMATE (5559 − 4500 = 1059 N m/rad, a third of K_R 3200) the low-frequency rotor kept cross-axis hub moments; with the
gyro and the flap settled (`Rotorcraft.settle`), per m/s at the hover:

| K_net, N m/rad | u: roll, pitch (N m) | v: roll, pitch (N m) | hands-off 60 s IGE | 625 N m step, bank at 20 s |
|---|---|---|---|---|
| 1059 (was) | +559, **−265** (speed-unstable) | **+178** (dihedral-unstable), +774 | 21.7°, 71 m, heading 179° | 10.4° |
| 250 (flown) | −124, +161 | −212, +75 | 0.04°, 9.1 m, heading 3.7° | 5.1° |

Hohenemser (Hoh-74 sect. 6.1): the negative springs "partially compensate the positive springs through which the pilot inputs are
transferred to the swashplate. Without these negative springs, the gyro lag τ would be undesirable"; "the pitch-roll cross coupling
is zero"; "the rotor has no influence on stability". A net spring small against K_R is that reading (INF): 250 N m/rad (K_net / K_R
0.08) is the flown ESTIMATE. The sweep (`W/tune2/ah56 out/a9_grid_rot*.log`, `a10_*.log`): 400 restores the signs weakly (the cross
term 193 against the direct 116), 150 and below make G8 fail; the feedback rotation (20° ESTIMATE) was left. G5, G6, C18 and C19 moved
under 2 %; G8 rose (0.166 / 0.198 at 5° of input rotation), so the input rotation (FITTED to G8) went 5° → 3° (0.130 / 0.155), with
C9's 190 KCAS lateral trim now 0.18 in (was 0.34; Hoh-74: "trim values ... less than 1 inch").

**Measured on the flown values** (ah56GyroHover; bands ESTIMATE from the film, read as changes from the trimmed hover, which is
5° left wing low, P APE-I para 96):

| Row | Target | AMCS | ICS |
|---|---|---|---|
| A1 hands-off 30 s, OGE / IGE | roll, pitch ≤ 5°; disc ≤ 2°; drift < 5 m, < 1 kt | 0.17° / 0.04°; 3.1 m, 0.65 kt / 1.7 m | 0.65° / 0.51°; 0.8 m / 0.6 m |
| A1b 60 s IGE hands-off; OGE heading held | the same, < 15 / 30 m | 0.04°, 9.1 m; 0.36°, 22.8 m (pedals free: 2.9°, 51 m, heading 29°) | OGE 29° (KNOWN GAP: P spring, cant, sweep) |
| A2 90 kg at 16 ft, starboard / port, trimmed, 30 s | the bands; stick ≤ ~15 % | 0.03°, 1.5-1.8 m; stick 1.9 % | 0.5°, 0.6 m; stick 17.1 % (KNOWN GAP, P gearing) |
| A3 10 in lateral CG (20.7 kN m) | the same | 0.1°, 2.2-2.5 m; stick 9.1 % | stick 82 % (KNOWN GAP) |
| A4 2.2 kN m nose / tail step, 4.33 kN m boom step | 0.4-1.6 x the derived rate | 0.98 / 1.16 / 0.76 x (0.37 / 0.37 / 0.73 °/s) | Λ M / H = 5.6 °/s: the pilot's |
| A5 derivatives (gyro settled) | speed- and dihedral-stable, cross < direct | as the table above | — |

What remains is not the gyro's: a lateral drift starts the tail rotor's weathercock (the tail follows the drift, r = v / l), the
yaw about the body axis carries the space-held hover tilt round (an Euler pitch rate −r sin φ at the 5° hover roll), and with the
hub-moment derivatives emasculated nothing pulls the tilt back; with the heading held on the pedals the lateral kick decays in about
25 s (`out/a11_vkick.log`).

## 8. Contract requests from this model

- **RC / integrator, rotorcraft.ts:** pass `{ hub: hubAir, density }` to `gyro.advanceCoupled` (section 5); until then the augmentation is
  dormant in the sim. The rig's stand-in then retires itself.
- **RC, rotorcraft.ts:** fade the hingeless rotor's in-plane force in over the first 0.3 m/s (`work/rigid/ag-rc-inplane-fade.patch`;
  legacy digests unchanged). With it, from the 15 m hover spawn at 18,300 lb, 20 s hands-off: AMCS −5.1 → −6.2°, 3.1 kt; ICS −5.0 →
  −7.2°, 3.1 kt (without it: −1.3° / −1.4°, 11 / 7 kt). What is left is the steady-moment precession above.
- **Plan (integrator):**
  - G1 assumes a first-order lag. The physical gyro precesses (CR-114362 App C), so the measured G1 numbers are the precession rate and the
    circle centre.
  - G2 (i) assumes K_hub ∝ Ω², which a hingeless spring breaks: amend to "loop gain = tan(sweep)(B/2)(e M_β Ω² + K_β)/H, checked at
    70 / 100 / 110 %" (the test asserts that now).
  - G5's hover pitch: AMCS-73 (P) gives 6 °/s/in about constant from the hover; Hoh-74 gives 9 at the hover. The model meets the first
    (6.08) and cannot meet the second with the 9 °/s²/in sensitivity (section 6).
  - The ICS droop sense (section 3): the derived nose-down sense is unflyable at the P droop in this model.
  - G7 and G7b give opposite trends for the ICS pitch time constant.
