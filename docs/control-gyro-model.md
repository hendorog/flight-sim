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
  were transmitted", Hoh-74). Sweep 4°00′ and droop 3°10′ (P ASTA-72 p 49). The droop term's sign is the one that is stable: the opposite
  sign diverges in the hover (probe, `work/rigid/probes-ag/inplane.test.ts`).
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
  - **AMCS 15° advanced:** −0.005 at the hover, +0.07 at 100 KCAS.

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
as the last argument of the `this.gyro.advanceCoupled(...)` call in rotorcraft.ts. The test rig sets the same data once per step from the
flight state. The desensitizer is checked at the block: 0.857 at 120 KCAS and 0.50 at 170 KCAS of the hover's tilt rate per inch.

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
Only M/H and M/K are observable. The fit was a grid on K_R (12, 16, 17.5, 18, 18.5 kN m/rad) with the moments rescaled each time, to
AMCS-73's maxima and Hohenemser's hover pitch:
- K_R sets the pitch rise (τ ≈ K_R Iyy / (H K_hub) = 1.2 s at 18 kN m/rad; AMCS-73's 6 °/s/in with 9 °/s²/in implies about 1 s), and through
  it the pitch sensitivity.
- A lower K_R raised the 100 KCAS pitch sensitivity above its band (12.7–14.2 °/s²/in at 12–16 kN m/rad).

| Fitted (AMCS, ESTIMATE) | Value | What fixed it |
|---|---|---|
| Stick moment at full longitudinal stick (4.95 in) | 1290 N m (261 N m/in) | pitch response 7.5 °/s/in at the hover, 4.3 at 150 KCAS |
| Stick moment at full lateral stick (2.9 in) | 1080 N m (372 N m/in) | roll response 17.7 / 13.7 / 13.6 °/s/in |
| K_R | 18,000 N m/rad | pitch sensitivity 8.3 (hover) / 11.7 (100 KCAS) °/s²/in |
| Input rotation | 15° advanced | G8 |
| Feedback rotation | 20° advanced | the best-damped auto-trim |
| Spring / negative spring / C_R | 5559 / 4500 N m/rad / 0.4 N m s/rad | ESTIMATE (net spring small: Hohenemser's negative spring) |
| SSL gain G | 1 | the stops read as cyclic (G5a) |

## 7. Results (stage 2; targets from plan 7.2)

Measured on the stage-2 aircraft (18,300 lb at FS 298, SL ISA, no wing and no pusher). `[ah56]` lines in the test logs;
`AH56_TRACE=<dir>` writes them.

| Row | Target (tag) | Measured | |
|---|---|---|---|
| G1 ICS block, feedback off, rotor locked | initial precession 13.7 / 16.7 °/s/in ±5 %; H/K 0.283 s; steady tilt 3.9 / 4.7 °/in; clamp ±15° (D ASTA-72 App C) | 13.74 / 16.65 °/s/in; precession rate 3.58 rad/s (K/H 3.54, i.e. **H/K = 0.283 s is the precession time scale**); circle centre 3.89 / 4.71 °/in; clamps at 15.00° and leaves the stop at once | pass, read as a precession (section 2) |
| G2 (ii) every mode stable ≥ 83 % Nr (P) | Re < 0 | 70 %: −1.75, −5.73; 83 %: −2.18, −6.47; 100 %: −2.75…−3.11, −7.48; 110 %: −3.08, −8.08 /s (ICS hover) | pass |
| G2 (i) the loop gain ∝ Ω, ±10 % (P/D) | Λ K_hub / H ∝ Ω | loop/Ω falls from 1.69 (70 %) to 1.16 (110 %): nearly flat, because half of K_hub is the hingeless spring, which does not grow with Ω | **KNOWN GAP** (`it.fails`) |
| G3 auto-trim, 3 m/s gust at 100 KTAS | < 10 % of the locked value within 0.5 s (P CR-114362 / D) | the feathering-moment auto-trim: 4.7 % at 0.2 s, 4.1 % at 0.5 s. The full ICS (with the droop × in-plane and Cm0 terms): 69 % at 0.5 s | clean pass; full ICS **KNOWN GAP** (the "corrupted" feedback, Hoh-74) |
| G4 steady hub moment per inch, ICS hover | 5.39 / 6.54 kN m/in ±20 %; flap-frozen ≥ 5× (D) | 4.53 / 5.50 kN m/in; flap-frozen 49.8 / 60.3 kN m/in (11×) | pass |
| G5 AMCS response / sensitivity | pitch 9 → 6 °/s/in, ±30 % (Hoh-74, AMCS-73); 9 °/s²/in; roll 13–16 °/s/in; 60 °/s²/in hover, 53 at 180 KCAS | pitch 7.48 (hover) / 4.66 (100) / 4.26 (150) °/s/in; 8.27 / 11.69 °/s²/in; roll 17.7 / 13.7 / 13.6 °/s/in; 55.1 (hover) / 57.0 (150) °/s²/in | pass (fitted) |
| G5a cyclic authority | ≥ ±8° (D) | stops 10.11 aft / 18.05 fwd / 12.27 R / 18.08 L at G = 1; full stick commands 3.8° of flap (46 kN m), inside the stops; the 150 KCAS trims inside the stops | pass |
| G6 AMCS attitude retention, no SAS | bank within 2° for 10 s after a 10° disturbance at 80 KCAS (P Hoh-74) | 13.0° bank held within 1.16° (SAS off, as "no SAS was used"); with the sideslip SAS on, the uncoordinated turn rolls level (≈ 7° in 10 s) | pass |
| G6 keyboard tap | ≤ 3° over 10 s (ESTIMATE) | 0.49° | pass |
| G7 ICS roll | τ 0.3–0.7 s; ≈ 34 °/s²/in ±40 %; 11–16 °/s/in (D) | τ63 0.30 s; 30.9 °/s²/in; maximum 9.5 (hover, roll compensator on) / 10.3 °/s/in (150 KCAS) | τ, acceleration pass |
| G7 ICS pitch | τ 1.5–3.5 s hover, 0.8–2.0 s at 150 KCAS; ≈ 5.4 °/s²/in ±40 %; 9–14 °/s/in (D) | τ63 0.84 s (hover) / 0.33 s (150 KCAS); 6.38 °/s²/in; maximum 5.7 / 4.6 °/s/in | acceleration pass; τ and the steady rates **KNOWN GAP** |
| G7a ICS full lateral stick, 120 KCAS | 40–65 °/s; right/left 1.5–1.9 (D / P ASTA-72 para 60) | 49.4 R / 30.9 L °/s, ratio 1.60 (trim stick 0.76 in left) | pass |
| G7b ICS desensitizer | 0.8–1.0 X at 120 KCAS, 0.6–0.8 X at 150; τ63 grows with speed (ESTIMATE) | maximum-rate ratios 0.66 (120) / 0.81 (150); τ63 falls 0.84 → 0.33 s | **KNOWN GAP**; the plan's G7 (τ falls with Mq) and G7b (τ grows) disagree |
| G7b AMCS | 6 °/s/in ±30 % hover to 150 KCAS | 7.17 / 4.66 / 4.26 | pass |
| G8 off-axis, pure longitudinal stick | roll ≤ 20 % of pitch (hover, 100 KCAS); angles within ±15° of 36° / 33° (P angles / AGENT) | AMCS −0.005 / +0.07. ICS +0.24 / −0.14 with the input at 13° (P 36°) and the feedback at 33° (P) | AMCS pass; ICS **KNOWN GAP** (section 4) |
| G9 hover attitude IGE | roll 2–7° left; pitch −1…+4° (P APE-I / ESTIMATE) | AMCS 4.58° left, +0.08°; ICS 4.51° left, +0.08° | pass |

**Why the ICS reads short of the derived steady rates.** The derivation assumes the rate approaches M/H. In the model:
- the ICS's physical spring (4100 ft-lb/rad net, no negative spring) precesses the gyro sideways;
- the hover attitude change (the pitch rate reaches 6°/s within 2.5 s) carries the aircraft away from the hover condition.

So the maximum rate comes early and lower: the hover pitch maximum is 5.7 °/s/in against the 13.7 the moment alone would give. The initial
accelerations (M/(Λ I)) agree with the derivation. Plan G7's "steady rate ≈ (M_stick − K_s θ_rel)/H" acknowledges the spring term.

## 8. Contract requests from this model

- **RC / integrator, rotorcraft.ts:** pass `{ hub: hubAir, density }` to `gyro.advanceCoupled` (section 5); until then the augmentation is
  dormant in the sim.
- **Plan (integrator):**
  - G1 assumes a first-order lag. The physical gyro precesses (CR-114362 App C), so the measured G1 numbers are the precession rate and the
    circle centre.
  - G2 (i) assumes K_hub ∝ Ω², which a hingeless spring breaks.
  - G7 and G7b give opposite trends for the ICS pitch time constant.
