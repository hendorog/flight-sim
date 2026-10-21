# Lockheed AH-56A Cheyenne: stages 2-5 integration record

Branch `feat/rigid-rotor` in `/home/roger/github/fs-rigid/integ`, after the Bo 105 stage-1 record
([bo105-integration.md](bo105-integration.md)). Stages 2-5 merge AG, AX, AC and AH in the plan's order (plan section 8:
RC → TW → BO → AU → BX → PN → **AG → AX → AC → AH**). The AH-56A stays **`available: false`**: it is not in the chooser
and flies only at `index.html?aircraft=ah56` (`&config=ics` for the 1972 ICS aircraft). The owner decides whether it
ships. Nothing here was merged to main.

Every choice not in the owner notes is an AGENT choice: AMCS as the default with the ICS selectable, the fitted gyro
numbers, the collective reading, the stores-on default, the section fit, the half-P thresholds and the integration
decisions below. None is an owner decision.

## 1. Merges

| Merge | Package head | What it brings | Integrator action at the merge |
|---|---|---|---|
| `66d9025` | AG `eecfa01` | The control gyro (AMCS default, ICS), the T64-GE-716, the wheel gear, the stage-2 aircraft data | `index.ts`: the auto-merge kept integ's PN-era `reference:` line beside AG's (TS1117); AG's kept. AG's two requests applied (gyro air data in `Rotorcraft.compute`; the gear-overspeed rule for a retractable rotorcraft); the G13 overspeed `it.fails` row is a passing row. The audio test's S0-stub rows (skids) and PN's collective gauge tests follow AG's definition; PN's dev mock sets its levers on the definition's range. |
| `9b80ffc` | AX `8f5f97e` | Exterior: AMCS head, ICS gyro X, wheels, sponsons, pusher, weapons, both cockpits | AX was cut from the scaffold: the main-gear trunnion moved with AG's axles (FS 281 → 264; AG moved the axles FS 285 → 268); the head draws a non-finite gyro cyclic as zero (AG's definition routes the dev page's tilt into the swashplate). |
| `7af2f73` | AC `ba630ff` | The wing panels, the pusher on the shared shaft, the compound calibration, the AMCS refit | AC's request (a): `flightModel.ts` passes the configuration to `pusherTrimLever`; the C7 `it.fails` row is a passing row. The audio test's pusher row checks against `def.pusher`. |
| `ace8c98` | AH `38b6d3d` | The blade section (Prandtl-Glauert, drag rise, stall, moment stall), the scripted half-P hop, finer grid, periodic flap damping on | AH's handover patch (the AMCS refit for Prandtl-Glauert and seven test diffs), except one bound widening (section 3). The dispositions of section 3. H3's trim bracket. After the merge (AC's request (f)): `index.ts` `notModelled` no longer says the wing, pusher and stage 5 are absent or the gyro augmentation dormant. |

Every package changed only files on its list in `package-files.json`, checked mechanically on each branch's own commits
(AG 31 files, AX 11, AC 7, AH 7; none outside its list). The integrator's edits in other owners' files are the ones
listed here and in the merge commits.

## 2. Gate status (plan section 9)

| Gate step | Status |
|---|---|
| 1. Merge in order | Done: AG, AX, AC, AH. |
| 2. `definitionInconsistencies(ah56)` empty | **Empty** since the AX merge (GA `consistency.test.ts` 250/250). After AG alone one row was red: the pilot's eye, 3.302 / 0 / −0.889 m in the definition against the stub visual's 0.7531 / −0.3302 / −0.53218; AX's visual reads `PILOT_EYE`. AU's rated power and PN's red line already read the facts. |
| 3. KNOWN_ISSUES and `docs/known-issues.md` rows | Done. `src/aircraft/ah56/KNOWN_ISSUES.md`: AG's 15 numbered items (1 and 7 resolved at the merge, 14 and 15 updated / added by the integrator), the TW, AU, PN and AX hand-overs, AC's stages 3-4 entries, AH's stage-5 entries and the integration dispositions. `docs/known-issues.md`: the AH-56A table row; the "waiting for its flight model" block moved into the type's file. |
| 4. This record | This file. |
| 5. Section 10 in-sim readouts and section 11 shots | **Run at the AH-56 verifier gate 0** on `03ec6e1` (section 9): every readout and shot taken and looked at against the reference photos. The AMCS readout misses G9's roll (KNOWN_ISSUES 2); no exterior defect found. |
| 6. `npx tsc --noEmit` | Clean after every merge. |
| 7. `npm run build` and `check-build` | **Run at gate 0**: the build succeeds; `check-build` ah56 on the runway (AMCS and `config=ics`) loads with `errors: []`. |
| 8. Codex review | **Not run.** |
| 9. Fable look and pilot gates | **Not run.** |
| 10. `available: false`; ask the owner | `available: false` (registry). `docs/aircraft.md` has the `ah56` row. |

## 3. Integration decisions (AGENT)

Plan section 2.4 lets the integrator apply a package's contract request in a file the package does not own, at the
merge. Each item names the requester.

1. **The gyro's air data is wired** (AG; `rotorcraft.ts`, RC's file): `advanceCoupled(..., { hub: hubAir, density })`.
   The ICS desensitizer, decoupler and roll compensator and the AMCS trim and sideslip augmentation are live in the
   sim. The test rig's stand-in retired itself (`PRODUCTION_AIR_WIRED`). Two consequences found on the integrated tree:
   - AC reported the G6 variant red at stage 4; with the air data wired it passes at the AC slot and after.
   - AH's H3 trims the Mach-off variant at 200 KTAS between 32 and 40° of prop blade angle. With the air data wired the
     40° trim no longer converges (collective at its stop), so the secant kept the 32° end and reported a false +17.8 %
     (14° of collective). The bracket is now 32-39° (the roots are at 38.0-38.4°): −1.6 % total, +9.8 % profile, AH's
     numbers. Shown by removing the wiring for one run (the rows return to AH's numbers), then restoring it.
2. **Gear overspeed for a rotorcraft** (AG; `flightModel.ts`, TW's file): `checkStructure` runs the gear rule when the
   type is retractable and `gearOverspeed.consequence === 'warn'`. Fixed-wing goldens are unchanged (GF).
3. **The ICS trims on its own prop schedule** (AC; `flightModel.ts`): `pusherTrimLever(d, ic.airspeed,
   ic.rotorcraftConfig)`. An ICS reset of the default definition went 5.33 / 5.17 / 4.84° indicated at 120 / 140 /
   160 KCAS to 5.97 / 5.95 / 5.98° at the AC slot and 5.56 / 5.51 / 5.50° at stage 5 (P 5-7°).
4. **AH's handover patch** (`W/guards/AH/r2/handover.patch`, `git apply --check` clean on AH's head): the AMCS refit for
   Prandtl-Glauert (compound.ts K_R 3,000 → 3,200 N m/rad, longitudinal stick moment 590 → 566 N m; gyro.ts lateral 975
   → 907 N m, input rotation 9 → 5°), G3 and G5a on a no-stall section with the stalling numbers reported beside them,
   C11's scripted pilot capped at 114 % torque, C12's bisection rejecting non-converged trims, C20's timeout, C23's
   frozen-controls window (the first 3 s after 30 KCAS; over the whole 30-70 KCAS band the bank passes 20°), and two
   `it.fails` → `it` flips (C23 right roll, C18 pitch at 180 KCAS). AG and AC should read the G3, G5a, C11, C12 and C23
   diffs as proposals for their files.
   **Not applied:** the patch widened the droop-sense "half the droop is stable" bound from 0.1 to 0.25°. The bound is
   kept and the stage-5 value (0.125° 6 s after the kick, still decaying: 0.074° at 9 s, 0.044° at 12 s) is its own
   `it.fails` KNOWN GAP row.
5. **Rows the compound and stage 5 left red** (AC's request (2); AH's (b)). AC asked not to merge with them red:
   - **G10** flies the AH-56A without the compound patch (`AH56_BASE` + gyro + stage-5 rotor; new rig option
     `definition`), so "no wing, no pusher" keeps its meaning: **11,410 ft**, band 9,000-11,500 (ESTIMATE). On the
     compound it read 8,594 ft; C2 is the compound's row (8,625 ft, P 8,500 ± 1,000).
   - **G7a** ICS full lateral stick at 120 KCAS → `it.fails` KNOWN GAP: 39.7 R / 35.2 L °/s, ratio 1.13 (band 40-65,
     1.5-1.9). The ICS stick moments are P-pinned by G4; C17 is the compound's P row.
   - **G8 ICS** at the 0.3 bound → `it.fails` KNOWN GAP: p/q +0.28 hover, −0.33 at 100 KCAS.
   - **C12** split: the converged zero-torque trim inside the collective travel is a passing row; the 2,200 ± 300 ft/min
     band is an `it.fails` KNOWN GAP at **2,508 ft/min** (8 ft/min outside; the owner's options are in section 8).
   No band was widened; each `it.fails` row carries its numbers.
6. **PN's collective gauge** reads AG's physical range (−2.5…18.5° + 7° AMCS): 4.5-25.5° indicated, mid lever 15°, ICS
   8°. PN's tests had pinned the S0 stub's mapping of the published AMCS range 4.5-21.5°. KNOWN_ISSUES 15 records the
   difference; a per-configuration collective top needs the same definition seam as the floor.
7. **The zero-airspeed in-plane force (AG's request to RC) is NOT applied.** Measured, gated on the control gyro so the
   Bo 105 and the legacy rotors keep the verbatim expression (legacy digests 35/35 with it):

   | Row | Without the fade (as merged) | With the fade |
   |---|---|---|
   | Hands-off hover, AMCS, 20 s calm | −5.4 → −1.9° roll, +10.7° pitch, 14.3 kt | −5.4 → −5.4° roll, +2.2° pitch, 2.1 kt |
   | Hands-off hover, ICS, 20 s calm | −5.3 → −10.5° roll, −2.4° pitch, 6.6 kt | −5.3 → −8.0° roll, +3.1° pitch, 4.1 kt |
   | G7 ICS roll τ63 (hover step) | 0.277 s (KNOWN GAP, band 0.3-0.7) | 0.31 s (the `it.fails` row would pass) |
   | G5 AMCS hover pitch / roll sensitivity | 11.54 / 63.5 °/s²/in | 11.30 / 69.6 |
   | C1, C2, C3, C22, G9, G13 rest | unchanged | unchanged |

   It fixes the AMCS hands-off hover, but it also changes the hover step responses the gyro was fitted on (the in-plane
   force is real below 0.3 m/s too), and the ICS hover still leaves the G9 band. That is a rotor-physics choice for RC
   (carry the in-plane side component instead of a fade) or the owner, not an integration fix. The hover-readout row
   stays `it.fails`. **Final fix round (section 11): RC's alternative was taken (the in-plane force as a vector), the
   fade was not; the hover-readout row passes.**

## 4. Measured on the integrated branch (`ace8c98`)

From the AG, AC and AH lists on the integrated tree (`W/guards/integ/10-ah/`). 18,300 lb, SL ISA, stores on, unless
stated. "P" = primary, "D" = derived, "ESTIMATE" as in the plan.

**Gyro and handling, AMCS (default)**

| Row | Measured | Target (tag) |
|---|---|---|
| G5 pitch, 0 / 100 / 150 KCAS | 5.78 / 4.93 / 4.57 °/s/in | 6 ± 30 % = 4.2-7.8 (P AMCS-73 para 33) |
| G5 pitch sensitivity, hover | 11.54 °/s²/in (1.4 % under the edge) | 9 ± 30 % = 6.3-11.7 (P) |
| G5 roll, 0 / 100 / 150 KCAS | 14.6 / 15.6 / 15.6 °/s/in | 13-16 ± 30 % (P) |
| G5 roll sensitivity, hover / 150 KCAS | 63.5 / 67.6 °/s²/in | 60 / 53 ± 30 % (P) |
| C18 pitch / roll at 180 KCAS | 4.26 / 15.6 °/s/in; roll sensitivity 66.6 | 6 / 16 ± 30 %; 53 ± 30 % (P) |
| C19 pull-up from 180 KCAS | 2.43 g at 1.78 s, 1.84 g at 1 s, 4.89 in of stick | 2.43 g in about 2.1 s, 1.75 g at 1 s (P) |
| C19 push-over from 165 KCAS | 0.28 g at 1.90 s | 0.28 g in 2.5 s (P) |
| G6 bank hold at 80 KCAS, no SAS | 0.44° over 10 s; keyboard tap 0.02° | ≤ 2° (P Hoh-74) / ≤ 3° (ESTIMATE) |
| G8 p/q, hover / 100 KCAS | 0.09 / 0.19 | ≤ 0.2 (AGENT) |
| G5a stops (up / down / left / right) | 10.11 / 18.05 / 18.08 / 12.27°; 150 KCAS trim −4.3° pitch | ≥ 8°; trims inside (D / P) |
| H6 steady turn, full aft stick | 2.29 g at 155 KCAS, 2.47 g at 180 KCAS; 4.1-5.0 in/g | to 2.5 g, positive and linear (P AMCS-73 para 37) |
| C9 lateral trim 120 / 160 / 190 KCAS | 0.27 / 0.38 / 0.50 in left | ≤ 0.5 in (P) |

**Gyro and handling, ICS (`config=ics`)**

| Row | Measured | Target (tag) |
|---|---|---|
| G1 initial precession, lon / lat | 13.74 / 16.65 °/s/in | 13.74 / 16.66 ± 5 % (D ASTA-72 App C) |
| G4 hub moment per inch, lon / lat | 4.55 / 5.51 kN m/in | 5.39 / 6.54 ± 20 % (D) |
| G7 roll τ63 / acceleration / maximum rate | 0.28 s / 31.4 °/s²/in / 9.1 °/s/in | 0.3-0.7 / 20-48 / 11-16 (D): τ and rate gaps |
| G7 pitch τ63 hover / 150 KCAS; maximum rate | 0.79 / 0.30 s; 5.6 / 2.1 °/s/in | 1.5-3.5 / 0.8-2.0; 9-14 (D): gaps |
| G7a / C17 full lateral stick, 120 / 152 KCAS | 39.7 R / 35.2 L, 39.8 R / 35.2 L °/s | 40-65, ratio 1.5-1.9 (D) / 77 R, 42-49 L (P ASTA-72 para 60): gaps |
| G8 p/q, hover / 100 KCAS | +0.28 / −0.33 | ≤ 0.2 (AGENT): gap |
| H4 moment stall, onset at 154 / 122 KCAS | 1.6 g / 1.5 g, right roll and pitch-up | 1.5 ± 0.2 / 1.4 ± 0.2 g (P ASTA-72 paras 63-65) |
| H4 at 190 KCAS, 1.43 g | 0.11° right roll, +0.001 g | none (P) |
| H5 stick per g above 1.3 g, 122 KCAS | 5.95 in/g | ≤ 0.1 in/g (P): gap |
| H7 half-P | 2.05 Hz; cue ±3.0° roll, ±0.21 g; strike 6.0 s after onset; halves 2.5 s after the hands go still; no trigger from one stir, AMCS, 135 KCAS or 60 s of mouse corrections; lateral reversals 4.16 s | 2.05 Hz ± 2 % (P); ±3°, ±0.15 g (ESTIMATE); 4-10 s; ≤ 3 s |

**Hover, ground and systems**

| Row | Measured | Target (tag) |
|---|---|---|
| G9 hover attitude IGE, AMCS / ICS | 4.7° / 4.7° left, +0.6° pitch | 2-7° left, −1…+4° (P APE-I / ESTIMATE) |
| C1 hover (18,300 lb) | 86.1 % torque at 18.2° indicated; wing download 4.9 % | 4-8 % (ESTIMATE) |
| C2 HOGE 18,750 lb | 8,625 ft (Ng 101.4 %, TIT 768 °C) | 8,500 ± 1,000 (P ASTA-72 para 12) |
| C3 20,500 lb OGE / IGE | 6,000 / 8,875 ft | 6,000 / 9,300 ± 1,000 (P) |
| G10 HOGE 18,750 lb, no compound | 11,410 ft | 9,000-11,500 (ESTIMATE) |
| G11 engine failure in the hover (ICS) | Nr 100 → 90 % in 0.54 s; 87 °/s left yaw; 4.7° LEFT roll at 1 s | 0.4-1.0 s (ESTIMATE); left yaw, slight right roll (P): roll gap |
| G12 T64 | idle Ng 64.95 %; TIT 711 °C at 114 % torque; idle at 29.0 s, TIT peak 561 °C | 58-72 %; ≤ 740 °C (P ASTA-72 para 78) |
| G13 ground rest, rotor running | 2.6° lean onto the right main (6.6 / 27.8 / 55.3 kN tail / left / right) | three wheels (ESTIMATE) |
| G13 run-on stop from 60 KCAS | 252 m (stage 2: 158 m) | ≤ 300 m (ESTIMATE) |
| G13 gear cycle; vertical take-off | 6.3 s each way; 6.3 m up, 0.67 m/s touchdown | 3-8 s |
| Hands-off hover from the 15 m spawn, 20 s calm | AMCS −5.4 → −1.9° roll, +10.7° pitch, 14.3 kt; ICS −5.3 → −10.5°, −2.4°, 6.6 kt; Nr 239.9 / 246.0 rpm | roll 2-7° left (G9): **gap** (`it.fails`) |

**Compound and high speed**

| Row | Measured | Target (tag) |
|---|---|---|
| C4 / H2 V_H (ICS collective 5°, 18,750 lb, 114 %) | 199.1 KTAS | 194 ± 5 % (P ASTA-72 para 14) |
| C5 / H2 AMCS clean, 114 % | 212.3-212.5 KTAS (with stores 199.6) | 210-225 (P Hoh-74; S 215) |
| C6 rotor lift share 120 / 160 / 190 KCAS | 71 / 48 / 30 % | 40-60 / 20-35 / 10-25 % (ESTIMATE): gap |
| C7 collective on the schedule, AMCS / ICS | 12.5-12.6° / 5.5-5.6° indicated | 13 ± 2 / 5-7° (P) |
| C8 fuselage pitch at 190 KTAS | −3.3° | −1…−5° (ESTIMATE) |
| C10 acceleration | 0 → 165 KTAS 59.6 s, 0 → 188 KTAS 78.5 s | 53 s ± 20 % pass; 107 s ± 20 % gap (P Table 3) |
| C11 deceleration | 196 → 165 KTAS 5.9 s, height −1.8 ft; hover not reached in 90 s | 5.4 s ± 20 % pass; 33 s gap (P) |
| C12 autorotation, 19,700 lb, 2,700 ft, 95 KCAS, prop +8° | 2,508 ft/min at 100 % Nr | 2,200 ± 300 (P para 69): **gap by 8 ft/min** |
| C13 delta-beta | 25 → 18° in 0.48 s; stop at 24°: Nr 73.3 % at 5 s | ≤ 1.5 s; 60-75 % (P paras 66-67) |
| C20 prop share 60 / 120 / 188 KCAS; Nr at 3 s (188 KCAS) | 26 / 37 / 76 %; prop action 82.9 % vs collective 62.1 % | prop critical at 188 (P para 68) |
| C22 +4° prop re-trimmed over the spot | 2.6° nose UP (T/W predicts 2.8°) | plan: 3-6° nose down (sign conflict, section 8) |
| C26 lateral trim at 190 KTAS: as built / symmetric wing | 0.50 / 0.59 in left | 0 ± 0.5 / 0.8-1.5 (D): symmetric gap |
| H1 advancing tip at 194 KTAS, 246 rpm | M 0.884 | 0.885 ± 0.01 (D) |
| H3 power rise at 200 KTAS, Mach law on / off | total −1.6 %; profile +9.8 % | ≥ 10 % (D): gap |
| H9 periodic flap damping at μ 0.5 | +1.6 % hub moment per cyclic | 8-15 % (D): gap |
| H10 cost per step | 288 µs vs MD 500E 150 µs (1.92 ×), 12 × 18 grid | ≤ 2 × (AGENT) |

## 5. Regression evidence

- **Existing helicopters are bit-identical.** `legacyDigest` with `s269Legacy` and `contactAirborne` gave 35/35 exact
  after every merge (AG, AX, AC, AH) and in the final run. GR sets 2-4 (R22/R44/S269/MD 500E pins) are green.
- **The Bo 105** (not in the digest) was re-run after the AG merge, which changed `rotorcraft.ts` and `flightModel.ts`,
  and after the AH merge: BO, twin and OEI lists 113 passed, 13 expected fail, 0 failed, the same as stage 1.
- **Fixed-wing** goldens under `FS_GOLDEN_EXACT=1`: only the two recorded `c172Sim` baseline exceptions; GF2 and the
  gear/test-bed lists green after each `flightModel.ts` change.
- Per-merge guard outputs: `W/guards/integ/6-ag`, `7-ax`, `8-ac`, `9-ah-pre`, `10-ah`; the fade experiment `11-fade`;
  the final run `12-final`. The guard runner is `W/guards/integ/run.sh`.

## 6. Not run, and why

At the integration (`ace8c98`) the section 10 readouts, the section 11 shots, the build check, heliHold and the
`AH56_TRACE` re-runs were not run. The AH-56 verifier gate 0 ran all of them on `03ec6e1` (section 9). Still not run:
the Codex review and the Fable look and pilot gates.

## 7. Final test run on the integrated tree

On `ace8c98` (all four merges; the in-plane fade reverted):
- `npx vitest run tests/aircraft tests/propulsion tests/rotorcraft tests/input tests/audio tests/instruments
  --maxWorkers=6`: **161 files, 2084 passed, 60 expected-fail (`it.fails` known-gap rows), 0 failed.** This includes
  `legacyDigest`, `s269Legacy` and `contactAirborne`, the MD 500E pins, every Bo 105, twin and rotor-core file, and every
  AH-56A file (gyro, handling, systems, ground, compound, pusher, high speed, moment stall, half-P, exterior, setup,
  panel, audio). The `md500Exterior` and R22 slope baseline exceptions passed in this run.
- `FS_GOLDEN_EXACT=1 npx vitest run tests/golden`: **51 passed, 2 failed**, exactly the recorded `c172Sim.golden`
  baseline exceptions ("runway: 40 s flown by the autoflight", "cruise: 20 s ... restored through JSON").
- Raw output: `W/guards/integ/12-final/{suite,golden}.txt`.

## 8. For the owner and the package owners (not applied)

**Owner questions** (AGENT findings; none decided):
- **C12** (2,508 ft/min against 2,200 ± 300): fit the section's post-stall drag to Report 530 (AH; it reads 10-23 %
  high past Cl max), re-fit the autorotation drag (AC), or keep the KNOWN GAP row.
- **The AMCS refit margins** are 0.4-1.9 % on four rows (hover pitch sensitivity, 150 KCAS roll sensitivity, C18 pitch
  at 180 KCAS, C9 at 190 KCAS). Accept, or hold Prandtl-Glauert until AG models the sensitivity per unit response
  (1.9 /s against AMCS-73's 1.5 /s).
- **Plan C22's sign**: +4° of prop re-trimmed over the spot is nose UP by about T/W (2.6°), not 3-6° nose down.
- **Half-P hold rule**: the amplitude holds while the stick moves without stirring; the alternative (decay whenever
  stirring stops) is one line.
- **Moment-stall violence**: past the H4 onset the scripted pilot's pitch-up runs to 2.1-2.4 g with 17-27 °/s of right
  roll.
- **Stores on by default** (AC): clean AMCS reaches 213 KTAS, with stores about 199.

**Package owners:**
- **RC:** the hingeless rotor's in-plane force at zero airspeed (section 3 item 7); the fine grid above μ 0.3 (H10).
- **AG:** the ICS rows (G7, G7a, G8, H5) and the AMCS steady-turn stick per g (H6) need the gyro's steady state fitted,
  not only the first peak; a per-configuration collective floor/top and `maxTakeoff` (AMCS 19,200 / ICS 20,500 lb) need
  definition seams; G11's roll sense; review the G3/G5a no-stall diffs; the gyro.ts AMCS numbers point at the
  compound.ts override.
- **AC:** C6, C9/C26, C10, C11, C16, C17, C22 sizes, C23 (KNOWN_ISSUES); review the C11/C12/C23 test diffs.
- **AU:** the half-P thump clamps at amplitude 2 while the event grows to 3.33 at the strike (AH's request (i)).
- **TW (propulsion):** the BEMT prop's 0.753 efficiency at the V_H loading against about 0.80 (ESTIMATE); the fuselage
  flat plate (1.0 m²) is fitted to it.
- **Plan amendments (architect):** G1 as a precession (K/H, M/K circle centre), G2 (i) for a hingeless spring
  (tan(sweep)(B/2)(e M_β Ω² + K_β)/H), G5's two AMCS hover rates (AMCS-73 6 vs Hoh-74 9 °/s/in), G7/G7b's opposite ICS
  τ trends, H3's 10 % (rested on the M_dd 0.78 ESTIMATE; P gives 0.83), H9's 8-15 %.

## 9. Verifier gate 0 (`03ec6e1`)

Run by the AH-56 gate-0 verifier; full tables in `work/rigid/flight-numbers.md` ("AH-56A Cheyenne: verifier gate 0"),
raw logs in `work/rigid/guards/integ/ah56-gate0/` and `work/rigid/gate-ah56/`, shots in `work/rigid/shots/ah56-gate-0/`.
Every choice here is an AGENT choice.

- **Guards:** G0 clean; GR 35/35 exact digests and the R22/R44/S269/MD 500E pins green; GA 250/250; GS 98/98; GF only the
  two recorded `c172Sim` baseline exceptions; AG 71 + 13 expected-fail; AC 50 + 13; AH 31 + 5; exteriors 166/166;
  panels 342/342; audio 228/228 and the `c172Audio` golden exact; `ah56TailWheel` 6/6. No unexpected failure. Every
  measured number equals section 4's at `ace8c98`, except H10, which is load-dependent (1.88 x alone, 2.05 x during the
  guard run; the test asserts 2.2 x).
- **Traces and probes:** `AH56_TRACE` re-runs (handling, compound performance) and heliHold `AC=ah56` written; the hold
  keeps the calm hover within 0.12 m and the windy one within 11.7 m, Nr 96.9-98.0 %.
- **In-sim readouts:** no crash; Nr 239.86 rpm AMCS / 246.04 ICS; gyro inside its stops; beta at −2.2°. After 20 s hands
  off in the default 8 kt wind the AMCS sits at 0.8° right roll (G9: 2-7° left) and the ICS at +9.4° pitch, which is
  the KNOWN_ISSUES 2 gap; in calm air the drift direction differs between the sim and headless runs (the in-plane force
  switches on along whatever the first velocity is), so no separate integration defect.
- **Shots:** every section 11 shot, compared with the Rucker, Fort Campbell and Ames photos. No exterior defect found:
  3-blade pusher and 4-blade TR on the left as defined; the ICS X on its post; gear transit and gear up correct. Recorded
  for AX: the nose and canopy are slimmer than Rucker front; the mast and main-gear group sits at 37 % of the length from
  the nose against 41-45 % in the photos (the gear-to-mast spacing matches); `shot-aircraft.mjs` passes no `--params`
  to the panel tile, so the ICS sheet shows the AMCS placard (the ICS panel was shot separately).
- **Build:** `npm run build` succeeds; `check-build` ah56 (AMCS and ICS) on the runway, `errors: []`.
- **Not run:** the Codex review and the Fable look and pilot gates.

## 10. Pilot-review round (2026-10-22): measured, decomposed and routed

Seven items from the AH-56 pilot review (three "must", four "should") were measured on this branch with probes in
`work/rigid/probes/tune-ah/` (outputs in `out/`); the numbers and the routing are KNOWN_ISSUES R1-R7 and
`work/rigid/flight-numbers.md` ("AH-56A Cheyenne: pilot-review round"). **No flight-model number changed**: for each item the
knob the review proposed either does not move the defect or would need a value no source supports. Every choice here is an
AGENT choice.

| Item | What decides it (measured) | Why not changed | Route |
|---|---|---|---|
| R1 unlocked taxi ground loop | mains 30 in ahead of the CG (P/3V); the tail rotor at about 1 kN at the taxi trim, yaw damping about 12-16 kN m s against m a V = 68 kN m s at 20 kt | tyre stiffness and relaxation do not move it; castor damping or friction give stick-slip and stall walking-pace turns | owner / AG; HUD cue to PN |
| R2 reverse deceleration | 165-80 KTAS at 0.20 g (P 0.31 g): the −12° prop gives 8-11 kN, the rotor holds the weight at a near-level attitude | the prop section values that would add thrust are outside thin-section data and move C13 / C20 | AC (C6 lift share) |
| R3 ICS trim and static stability | para 44 gradient 0.10 in/kt (P 0.015 / 0.012); the hub moment the airframe needs, mostly the wing's downwash on the stabiliser, read through G4 | a wing / tail refit against para 44 moves C6, C8, C9, C23, H4 / H5 and the AMCS schedule | AC (TAIL_DOWNWASH, wing Cm), AG (stabiliser, ICS fit) |
| R4 hover wander | the zero-airspeed in-plane force (item 2) | RC / owner choice (section 3 item 7) | RC / owner |
| R5 hover pedal | tail-rotor damping as momentum theory gives it; persistence from the space-held disc tilt and the weathercock | physical for this control system | AG / RC (tail rotor in its own descent at full pedal) |
| R6 ICS autorotation | the sweep × hub term (+22 kN m nose up at 6 s), then moment stall at the 15° gyro stop | same root as R3 | AG, AC; training text to PN |
| R7 63 KCAS failure | total power 46 % torque; the prop's share does not change the Nr minimum (77.0-77.6 % against P 82 %) | the 60 KTAS prop schedule is the AGENT nose-up fit; no P power-required row | AC / AH (C12) |

Test rows added (no row loosened): ah56Ground "tail wheel LOCKED, prop taxi at 20 kt … under 10 deg/s" (passes: 4.6 °/s,
3.8° of heading) and its `it.fails` unlocked twin (53.4 °/s, right wingtip); ah56Handling "ICS collective-fixed static
longitudinal stability" `it.fails` (0.101 in/kt at 150 KCAS; no 190 KCAS trim). Guards for the round: `W/guards/integ/13-pilot/`.

## 11. Final fix round (2026-10-22): the final assessment's 17 accepted findings

Commits after `9d70cad`, each with its numbers in the message; every choice here is an AGENT choice, not an owner decision.
Guards: `W/guards/integ/14-fix` (the rotor fixes), `15-p1` (the wing balance), `16-final` (the full plan section 10 set:
G0, GR, GA, GS, GF, RC, TW, AG, AC, AH, BO, check-keys). Probes: `W/probes/fix-final/` (digest, in-plane, side-force sign,
ICS static stability, C4 on the ICS, C23 split). Plan amendments A1-A11: plan section 15.

| Commit | Finding | What |
|---|---|---|
| `d71a47a` | allocation (2 findings) | twin freewheel impulse and the extended rotor path stop allocating per step; Bo 105 / AH-56A digests identical |
| `934c820` | H10 bound | the plan's 2.0 x asserted on the best of seven samples, skipped under load (1.82 x idle) |
| `9032eb1` | AMCS numbers in two places | K_R 3,200 / 566 N m moved into gyro.ts; compound.ts no longer overrides the gyro; flown aircraft unchanged |
| `9ff2722` | settle sound speed | trims and ground settles use the atmosphere's speed of sound (9,000 ft trim was 540 N off) |
| `e335537` | pusher gyroscopic reaction | the prop's h acts on the airframe (its h after the free rotor's w x H compensation) |
| `9ba4532` | half-P resume | `HalfPHopState.age`: a mid-onset save restores the same forcing (−25.9 kN m both; was 0) |
| `e977509` | hover in-plane force | the hingeless BEM's in-plane force applied as a vector (side component included) |
| `168e071` | hubForcing flap rate | the ICS gyro's blade moments see arm x beta-dot; formed only for the feathering-moment gyro |
| `57d3b7f` | G3/G5a, G6 keyboard | asserted on the flown section / on a real key tap; two KNOWN GAP rows now pass |
| `b0f2d60` | Bo 105 hover | cherry-pick of `rigid/bofly` `a1a31ba` (hover rows on ERF 1995 VII-7, P) |
| `9fd5541`, `3c4ca71` | ICS pitch trim (P1) | hint; wing section Cm (D) and DATCOM downwash (D); C4 on the ICS itself; rows moved recorded |
| `165ce64` | plan bands | T7b amended row (A4); H9 amended bound (A2) in `3c4ca71` |

**Before (`13-pilot`, 9d70cad physics) and after (`15-p1` / `16-final`)**, 18,300 lb SL ISA stores unless stated:

| Row | Before | After | Target (tag) |
|---|---|---|---|
| Hands-off hover 20 s calm, AMCS / ICS | −5.4 → −1.9° roll, +10.7° pitch, 14.3 kt / −5.3 → −10.5°, 6.6 kt | −5.35 → −5.49°, +0.76°, 0.41 kt / −5.25 → −5.13°, +0.53°, 0.31 kt | G9 2-7° left (P / ESTIMATE): **passes now** |
| Half droop 6 s after a 0.5° kick | 0.125° | 0.009° | < 0.1° (AGENT): **passes now** |
| G3 full ICS gust residue at 0.5 s (flown section) | 0.53 | 0.45 (clean auto-trim 0.029 at collective 0.26) | < 0.10 (P CR-114362 / D) |
| G5 AMCS pitch 0 / 100 / 150 KCAS; hover sensitivity | 5.78 / 4.93 / 4.57; 11.54 | 5.54 / 4.94 / 4.61; 10.82 | 4.2-7.8; 6.3-11.7 (P) |
| G7 ICS pitch τ63 hover / 150; roll τ63 | 0.79 / 0.30 s; 0.28 s | 0.65 / 0.31 s; 0.26 s | 1.5-3.5 / 0.8-2.0; 0.3-0.7 (D): gaps |
| G7a / C17 ICS full lateral 120 / 122 KCAS R / L | 39.7 / 35.2 °/s, trim 0.18 in left | 37.4 / 44.0 °/s, trim 0.34 in right | 40-65, ratio 1.5-1.9 (D); 77 R / 42 L (P): **C17 sense now KNOWN GAP** |
| G8 ICS p/q hover / 100 KCAS | +0.28 / −0.33 | +0.41 / −0.17 | ≤ 0.2 (AGENT): gap |
| C2 / C3 HOGE | 8,625 / 6,000 ft | 8,375 / 5,750 ft | 8,500 / 6,000 ± 1,000 (P) |
| C4 V_H (ICS collective 5°, 114 %) | 199.1 KTAS on the AMCS gyro mechanics | **201.2 KTAS on the ICS itself, 5.1 in fwd** | 194 ± 5 % (P) |
| C5 AMCS clean | 212.5 KTAS | 216.7 | 210-225 (P/S) |
| C6 rotor lift share 120 / 160 / 190 | 71 / 48 / 30 % | 71 / 49 / 29 % | 40-60 / 20-35 / 10-25 (ESTIMATE): gap |
| C8 pitch at 190 KTAS | −3.3° | −3.25° | −1…−5 (ESTIMATE) |
| C9 lateral 120 / 160 / 190 KCAS | 0.27 / 0.38 / 0.50 in left | 0.21 / 0.29 / 0.34 | ≤ 0.5 (P) |
| C10 0 → 188 KTAS | 78.5 s | 77.5 s | 107 s ± 20 % (P): gap (prop map not refitted: no HS datum) |
| C11 to the hover | not reached in 90 s | not reached | 33 s (P): gap |
| C12 autorotation | 2,508 ft/min | 2,509 | 2,200 ± 300 (P): gap |
| C18 pitch / roll at 180 KCAS | 4.26 / 15.6 °/s/in | 4.32 / 15.7 | 6 / 16 ± 30 % (P) |
| C19 pull-up from 180 KCAS | 2.43 g at 1.78 s | 2.43 g at 1.75 s | 2.43 g in about 2.1 s (P) |
| C23 ICS shift lateral / longitudinal / pedal | 0.89 R / 0.58 fwd / 2.34 R in | 1.31 R / −0.03 fwd / 2.34 R | 1.1 L / 0.7 fwd / 2.3 R (P): **longitudinal now KNOWN GAP** |
| C23 frozen-controls roll, 30-70 KCAS | +1.41 °/s (right) | −1.61 °/s | right (P): **KNOWN GAP** |
| ICS para 44-45 gradient 120 / 150; 190 KCAS trim | 0.106 / 0.098 in/kt; none | 0.073 / 0.071; 4.50 in fwd | 0.015 / 0.012 (P): gap; trim exists |
| H4 onset 122 / 154 KCAS | 1.5 / 1.6 g | 1.3 / 1.4 g | 1.4 / 1.5 ± 0.2 (P) |
| H4 at 1.4 g / 122 KCAS, held | 0.7° roll, 1.41 g | 134° roll, 1.84 g | (departure: owner item) |
| H4 190 KCAS / 1.43 g roll | 0.11° | 0.69° | none (P; row 0.5°): **KNOWN GAP** |
| H5 stick per g above 1.3 g, 122 KCAS | 5.95 in/g | −18 (a departure) | ≤ 0.1 (P): gap |
| H6 hands-fixed full-aft pull 155 / 180 KCAS | (no row) | −14.0 / −14.4° roll in 3 s | ≤ 5° (ESTIMATE): KNOWN GAP |
| H9 periodic damping, μ 0.5 | +1.6 % | +1.6 % | ≤ 5 % (amended A2) |
| H10 cost AMCS / ICS | 1.92 x (asserted 2.2) | 1.82 x / 2.15 x (ICS reported) | ≤ 2.0 (AGENT) |
| Bo 105 hover phugoid (2200 kg IGE) | σ +0.31, ω_d 0.51: 2.3 s doubling | σ +0.28, ω_d 0.50: 2.5 s | ERF 1995 band σ +0.05..0.45, ω_d 0.3..0.8 (P) |
| Bo 105 80 kt Lp / hover IGE roll | −10.67 / 2.97° left | −9.96 / 3.01° left | AR-280 envelope / 1-3° (ESTIMATE): roll KNOWN GAP |

**For the owner** (decisions, not made here):
1. **The ICS moment stall is now a departure** (the flap-rate incidence in the gyro's blade moments): held at 1.4 g / 122 KCAS
   the turn rolls 134° right and reaches 1.84 g (was 0.7°, 1.41 g); the onset g still matches ASTA-72. Keep, refit AH's moment
   break, or revert that one term as a documented approximation.
2. **ICS pitch trim against the transition shift**: the wing section Cm and the DATCOM downwash bring the para 44 trims inside the
   stick (190 KCAS now trims) and the gradient from 0.10 to 0.07 in/kt, and cost C23's longitudinal shift (0.69 → −0.03 in, P 0.7).
   No physical downwash reaches para 45's 0.015 in/kt.
3. **The ICS lateral trim** moved further right (0.34 in right at 120 KCAS against P's 1 in left at 100) with the rotor's side force
   (verified) and the wing balance; C17's right/left ratio and C23's frozen-controls roll turned.
4. **The AMCS hands-fixed pull rolls left 14° in 3 s**: the rotor's pitch-rate coupling, which AMCS-73 para 37 does not report.
5. **The Bo 105 STAB ASSIST** and the rest of `rigid/bofly` are not on this branch; only its hover-row commit was cherry-picked.

