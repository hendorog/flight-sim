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
| In the sim, 20 s hands off (`hover=1`), calm / 8 kt wind | gate 0: AMCS 1.4° L, −7.3°, 12 kt, heading 80° off / 0.8° R, 7 kt; ICS 6.9° R, 17 kt / 4.9° L, 10 kt | AMCS −5.5°, −2.3°, 3.1 kt / −1.6°, −3.5°, 10.8 kt; ICS −5.3°, +3.8°, 3.5 kt / −11.5°, +1.9°, 13.2 kt | (shots `W/shots/final/`) |
| Half droop 6 s after a 0.5° kick | 0.125° | 0.009° | < 0.1° (AGENT): **passes now** |
| G3 full ICS gust residue at 0.5 s (flown section) | 0.53 | 0.45 (clean auto-trim 0.029 at collective 0.26) | < 0.10 (P CR-114362 / D) |
| G5 AMCS pitch 0 / 100 / 150 KCAS; hover sensitivity | 5.78 / 4.93 / 4.57; 11.54 | 5.54 / 4.94 / 4.61; 10.82 | 4.2-7.8; 6.3-11.7 (P) |
| G7 ICS pitch τ63 hover / 150; roll τ63 | 0.79 / 0.30 s; 0.28 s | 0.65 / 0.31 s; 0.26 s | 1.5-3.5 / 0.8-2.0; 0.3-0.7 (D): gaps |
| G7a / C17 ICS full lateral 120 / 122 KCAS R / L | 39.7 / 35.2 °/s, trim 0.18 in left | 37.4 / 44.0 °/s, trim 0.34 in right | 40-65, ratio 1.5-1.9 (D); 77 R / 42 L (P): **C17 sense now KNOWN GAP** |
| G8 ICS p/q hover / 100 KCAS | +0.28 / −0.33 | +0.41 / −0.17 | ≤ 0.2 (AGENT): gap |
| C2 / C3 HOGE | 8,625 / 6,000 ft | 8,375 / 5,750 ft | 8,500 / 6,000 ± 1,000 (P) |
| C4 V_H (ICS collective 5°, 114 %) | 199.1 KTAS on the AMCS gyro mechanics | **201.1 KTAS on the ICS itself, 4.7-5.0 in fwd** | 194 ± 5 % (P) |
| C5 AMCS clean | 212.5 KTAS | 216.7 | 210-225 (P/S) |
| C6 rotor lift share 120 / 160 / 190 | 71 / 48 / 30 % | 71 / 49 / 29 % | 40-60 / 20-35 / 10-25 (ESTIMATE): gap |
| C8 pitch at 190 KTAS | −3.3° | −3.25° | −1…−5 (ESTIMATE) |
| C9 lateral 120 / 160 / 190 KCAS | 0.27 / 0.38 / 0.50 in left | 0.21 / 0.29 / 0.34 | ≤ 0.5 (P) |
| C10 0 → 188 KTAS | 78.5 s | 77.5 s | 107 s ± 20 % (P): gap (prop map not refitted: no HS datum) |
| C11 to the hover | not reached in 90 s | not reached | 33 s (P): gap |
| C12 autorotation | 2,508 ft/min | 2,509 | 2,200 ± 300 (P): gap |
| C18 pitch / roll at 180 KCAS | 4.26 / 15.6 °/s/in | 4.32 / 15.7 | 6 / 16 ± 30 % (P) |
| C19 pull-up from 180 KCAS | 2.43 g at 1.78 s | 2.43 g at 1.75 s | 2.43 g in about 2.1 s (P) |
| C23 ICS shift lateral / longitudinal / pedal | 0.89 R / 0.58 fwd / 2.34 R in | 1.31 R / −0.03 fwd / 2.34 R | 1.1 L / 0.7 fwd / 2.3 R (P): **lateral and longitudinal KNOWN GAP rows** |
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


## 12. Tuning round (2026-10-22, branch `tune/ah56`): the eight open items

Every choice here is an AGENT choice (the owner delegated items 3 and 6 with a recommendation); the numbers, probes and logs are in
KNOWN_ISSUES T1-T8 and `W/tune/ah56/` (probes in `probes/`, outputs in `probes/out/`, suite logs `logs-item*.txt`).

| Item | Measured before | Mechanism | Change | After (target, tag) |
|---|---|---|---|---|
| 1 unlocked taxi (must) | 1 in / 1 s pulse at 20 kt: 55.7 °/s, right wingtip; 10 kt hands off diverges | free castor behind mains 0.76 m ahead of the CG: s = (m x U − N_r) / (Izz + m x²), 0.9 /s at 20 kt (D) | none in gear.ts (friction / damper sweeps give a breakout deadband and stuck castors); two pilot-in-the-loop rows | a pilot 0.3 s late at 20 kt holds the heading within 0.7° on 2.2 in (P para 79 / APE-I 133: directional control "excellent"); hands-off row stays KNOWN GAP |
| 2 reverse decel (must) | 165-80 KTAS 0.22 g (AMCS, this tree) | the reverse prop in the propeller-brake state (T / qA 0.8-1.9), where the shared BEMT's momentum halves the blade-element thrust | prop section clMin −1.2, cdMax 2.0 (FITTED to para 15 / C11) | 0.25 g; 50 KTAS at 29.7 s (33.1); ICS to the hover 39.1 s with a tight height hold (P 33 s ± 20 %, 0.31 g); C11 row still KNOWN GAP |
| 3 ICS static stability (must) | 0.0735 / 0.0708 in/kt at 120 / 150 KCAS (P 0.015 / 0.012) | per kt at 150 KCAS: tail +0.49, wing −0.30, pusher +0.16 kN m, read at 0.19 in per kN m; the desensitizer × 1 / 0.64 below a 2.1 in trim | none flown; the fit (wing Cm −0.10, downwash × 0.25: 0.013 / 0.022) is staged in compound.ts | it costs H4 (154 KCAS onset out of the aft stick), C4 (204.6 KTAS), C19 (1.61 s): owner decision; KNOWN GAP 0.071 kept |
| 4 hover wander (should) | (reviews: 44° / 5.6 kt) | closed by the final fix round's vector in-plane force | regression row | 0.61 / 0.63° of heading, 0.41 / 0.31 kt in 20 s (AMCS / ICS) |
| 5 hover pedal (should) | 1 s key tap 0.35 in, 43 °/s peak; full pedal 163 °/s | damping = momentum theory (D, σ 0.297 P); the keyboard pedal stays put after a tap | keyboard pedal ramp 0.03 → 0.2 /s over 1.5 s (AGENT input) | 1 s tap 0.15 in: 17 °/s (5 with the assist); windmill-brake thrust at the stop: RC |
| 6 ICS autorotation (should) | (reviews: gyro to the stop, Nr 72 %) | gone since the flap-rate term; the moment break (FITTED at 0.4 c without it) made the stall a departure | break 0.4 c → 0.2 c (FITTED to H4) | autorotation at 0.5°: Nr 101-104 %, 4.8 in aft; H4 onsets 1.4 / 1.5 g (P), roll held in the stick, 190 KCAS 0.35° (row passes) |
| 7 63 KCAS failure (should) | AMCS 77.6 % (reviews) | the P point is the ICS: 80.7 % with a 0.3 s dump; P drivetrain inertia, 46.5 % torque | rows only | G11b 80.7 % against about 82 % (KNOWN GAP 82 ± 1 %); SoF autorotation collective vs C12: owner / AH |
| 8 keyboard beginner | 27-30 m drift, heading 72-180° in 60 s | the raw AMCS on keys | STAB ASSIST through AH56_INPUT (Bo 105 tuning, ON, labelled sim aid) | 1.9-2.8 m, 0.1° of heading (ah56Assist rows) |

Rows added: ah56Ground (two unlocked-taxi pilot rows, the hover heading / drift row), ah56Assist (seven rows), ah56Systems G11b
(a sense row and a KNOWN GAP row). Rows changed: ah56HighSpeed's flown-break bounds follow the refit (−0.2 to −0.3, was −0.4 to
−0.55); ah56MomentStall's 190 KCAS KNOWN GAP row is a passing row (0.35°). No band was loosened. Contract requests: TW (the
BEMT's high-induction correction), RC (the tail rotor's windmill-brake thrust at the pedal stop), PN (the tail-wheel lock cue), the
owner (T3's para 45 trade; T7's autorotation collective against C12).

## 13. Tuning round 2 (2026-10-22, branch `tune/ah56`): the pilot gate's beginner side

The Fable pilot gate reproduced section 12's numbers exactly and then flew the aircraft as the owner will (keyboard, no
helicopter experience): the hover held, nothing beyond it did (5/10). This round changes input choices, sim presets, cues and
rows only; the physics is untouched. Numbers, probes and logs: KNOWN_ISSUES T9 and the T1 / T7 addenda, `W/tune/ah56/r2/`.
The yardstick is a new watching keyboard beginner (`tests/rotorcraft/ah56KeyPilot.ts`), because the Bo 105 helper's short taps do
not move this aircraft's re-centring, rate-command keyboard cyclic; on round 1's profile it reproduces the gate's findings.

| Gate item | Round 1's profile | Cause | Change | Round 2 |
|---|---|---|---|---|
| transition (must) | pushes never reach 60 KIAS (46.9 max); the beginner 34-44 s to 40 KIAS, heading 50-95° off | the attitude-COMMAND datum returns to the captured hover attitude at every key release | STAB ASSIST katt 1.2 → 0.3, stickAttitude 1.3 → 0.6, band [30, 50] → [30, 60] KIAS | pushes 60 KIAS in 42 s; the beginner 40 KIAS in 22 / 24 s (heading 30 / 27°); back to the hover still KNOWN GAP (sideslip and the untrimmed anchor in 25-60 KIAS; contract requests) |
| lift-off (must) | the beginner crashed at 17 / 22 s, heading 110 / 97° off | the ground trim's cyclic 0.06 forward of the hover's; the datum captured at the ground attitude; the hover pedal 0.38 left | ground starts hold the cyclic at the IGE hover trim (D); heading hold authority 0.3 → 0.5, pedal follow-up 0.2 → 0.5 /s | F6 to the first unload, then 30 s at 3 m: 10.0 / 11.5 m, 21 / 9°, no crash; the Bo 105 tapper KNOWN GAP (85 m) |
| collective keys (should) | F5 1 s from 15 m: the ground at 1,057 fpm, crash | 0.12 /s is 2.5°/s on a 21° collective | 0.06 /s; Shift+F5 / Shift+F6 1.0 / 0.5 /s, the stop at 0.15 (98.6 % Nr at 90 KIAS) | 645 fpm, no crash; the 60 KIAS failure dump 0.3 s, Nr 83.1 % (F5: 5.7 s, 75.5 %) |
| cyclic keys (should) | held 1 / 2 / 3 s: 2.3 / 13.6 / 33.7° pitch, 3 s roll 51.7° | a squared ramp to 0.35 /s on a rate command | constant 0.1 /s | 1.3 / 4.6 / 9.7°, 3 s roll 14.6° |
| heading hunting (should) | 2 s pedal hold rings 14.3 °/s at 6 s; F6 tap 8.7 °/s | the rate term saturated at yawAuthority 0.13 | kr 0.5 within 0.25 (kpsi kept 1.0: 0.5 weakened the lift-off) | 4.2 °/s, 3.2° from the hold's datum; F6 tap 3.0 °/s |
| taxi (should) | locked 20 kt: the tapping pilot winds 3 in of pedal, wingtip | non-centring pedal keys | unlock toast and Taxi hint (sim advice); a locked pilot row | locked 20 kt, pilot 0.3 s late within 1 in: 0.35° |
| engine failure (should) | (the gate: 15 m hover unsurvivable; IGE "survivable" read at first contact) | P inertia; one-wheel touchdown in the 5° left-wing-low hover | G11c row; hint row; gear finding recorded (not changed) | IGE written 282 fpm, no damage; on keys hands off the left main collapses (KNOWN GAP); main leg 140 kN covers a one-wheel touchdown only to about 375 fpm |
| test gap (should) | the hover rows only | | 9 new ah56Assist rows (6 passing, 3 KNOWN GAP), G11c, the locked-taxi row | |

## 14. Tuning round 3 (2026-10-25, branch `tune2/ah56`): the gyro alone, and the keyboard beginner's whole flight

Owner input this round: the CL-475 / XH-51A films (a man on a 16 ft side boom, the XH-51A hover with him on the STARBOARD boom
hands-off), the expectation that the control gyro holds the hover by itself, and a preference for the attitude stability to come
from the gyro rather than from a pitch/roll STAB ASSIST. Probes, logs and notes: `W/tune2/ah56/` (notes.md). Details: KNOWN_ISSUES
T10 (A) and T11 (B-D); docs/control-gyro-model.md section 7b.

| Item | Before | Cause | Change | After |
|---|---|---|---|---|
| A gyro-alone hover (must) | trimmed hover 30 s held; a 625 N m step: 10.4° at 20 s; hands-off IGE 60 s 21.7°, 71 m; low-frequency rotor (gyro settled) speed- and dihedral-unstable | the AMCS net spring (ESTIMATE 1059 N m/rad, a third of K_R) leaves a 90°-turned residual flap; a NEW steady moment has no fixed-lean equilibrium (a rate command) | net spring 250 N m/rad (Hoh-74: partial compensation, zero pitch-roll coupling); input rotation 5 → 3° (G8) | the film's trimmed boom both sides 0.03°, 1.5-1.8 m, stick 1.9 %; 10 in CG 9.1 % stick; IGE 60 s 0.04°, 9.1 m; steps at 0.76-1.16 x K_R β / H; every sourced row passes (G5 / G6 / C18 / C19 within 2 %) |
| B attitude assist (must) | katt 0.3, an attitude command back to the captured hover attitude | — | katt 0.3 kept, the datum re-captured where the keyboard stick comes to rest (contract requests 2-3) | the hover needs none (tapper 3.7-5.0 m with it off); the whole flight 2/4 → 4/4 with it, the knock 168 / 114 m |
| C the one gate (must) | above 25 KIAS the pedal at the hover's; 15-40 kt of slip; no circuit | no pedal follow-up from sideslip | sideslipPedal (20-160 kt), centringPedals, the prop schedule aid ON (the P propeller technique; the rotor is speed-stable since A) | the whole flight lands at both row paces (4 of 4 in the probe); the 1.2 s pace's stop over 90 s (KNOWN GAP) |
| D collective presses (should) | F6 past the unload, F5 2 s: crashes; Shift+F6 to stop a sink: 200 m | keyboard collective with no hold | heightHold (the Bo 105 lane's law), Shift+F6 stop at 80 % with the engine running | no crash, 15-67 fpm; 13 m min; 20-21 m |
| D Shift+F5 in the hover (should) | 2,783 fpm | the autorotation entry | label and hint: never in the hover | 2,640 fpm, KNOWN GAP row on the record |
| D run-on roll-out (should) | 116-126° | the pedal at the approach trim as the torque goes | Landing hint | 140°, and a 547 fpm touchdown collapses a main at the slow pace (KNOWN GAP) |
| D main gear (should) | 140 kN, collapsed from about 375 fpm in the hover attitude | sized for a level drop | 180 kN (D: P 9.5 ft/s with FAR 27.483 / 27.725) | the one-wheel touchdown at the P sink holds (173 kN); G13 row |
| E XH-51A rig (nice) | — | — | not attempted (not cheap) | — |

Shared files (both lanes): every addition is an opt-in field, default off — StabilityAssistTuning.sideslipPedal /
recaptureOnCentre / captureAirborne, InputProfile.centringPedals, collectiveFastRate.upStop, propLever.schedule.default and the
propSchedule's engine-running gate; tests/rotorcraft/bo105*, tests/input, tests/ui and legacyDigest pass unchanged. No shared rotor
file was touched.

## 15. Tuning round 4 (2026-10-25, branch `tune2/ah56`): the pass-2 gate's fix round

The Fable pilot gate scored round 3 at 7 ("good enough to hand to the owner once the two text musts are applied"). Probes and logs:
`W/tune2/ah56/r4/` (notes.md, round 4); the gate's own rigs and traces in `W/tune2/ah56/gate1/`. Details: KNOWN_ISSUES T10 and T11.

| Gate issue | Before | Change | After |
|---|---|---|---|
| Engine-failure hint (must) | "Shift+F6 from about 1.5 m": its level-wings technique collapses a main at one lag of two | hint: about 2 m of wheel height, 6-7 ft on the HUD AGL (1.75-2.25 m) | the window, both lags: 361-406 / 309-323 / 315-335 fpm, 96 / 70 / 93 kN; three passing ah56Assist rows |
| Landing hint (must) | led with the run-on and a Z / X cue that does not work (127-145° roll-outs) | leads with the hover landing on a held F5; the run-on "not yet beginner-safe"; no Z / X cue | the hover landing 6 of 6 at both paces (the gate's p6) |
| Shift+F5 in the hover (should) | 2,640 fpm into the ground | `collectiveFastRate.downGate` (opt-in): as bare F5 with the engine running below 30 kt | 1 s 14.8 m min, 194 fpm; 2 s 12.7 m, 337 fpm; hand speed kept at 90 KIAS and with the engine out |
| The knock (should; owner decision) | a 1 s tap 200-440 m in 60 s; a 2 s tap climbs out to 44-273 m at 47-67 KIAS | none shipped: (ii) a prop-schedule arm and (i) the TRC flown for the owner | (ii) no climb-out but the deliberate transition worse at four paces; (i) 5-19 m but a pitch/roll aid; numbers in T11 |
| ICS disclosures (should) | T10 "29°"; no hint | T10: a ground contact from 3 m at 52 s; "ICS on keys" hint | — |
| Step-load disclosure (should) | stopped at 10 s | T10, control-gyro-model 7b, an informational A4 30 s row | bounded attitude (11.9° at 30 s), 17 / 46 kt at 15 / 30 s |
| Main leg 180 kN (should) | a strength change in a flyability round | put to the owner in the hand-over | — |
| Ground-roll heading (should) | the roll-out swings 105-150° | `StabilityAssistTuning.groundRollHeading` (opt-in): the touchdown heading on the keyboard pedals, tail wheel locked, 6-50 kt | brakes below 20 kt: 7 of 7 roll-outs intact (without: 1 of 7); two passing rows (16.6 / 32.3°); the 1.2 s touchdown still collapses a main |

Shared files (both lanes): every addition is opt-in and default off — `collectiveFastRate.downGate` (profile.ts / InputSystem.ts)
and `StabilityAssistTuning.groundRollHeading` (stabilityAssist.ts, its own block in the on-the-ground
branch, its snapshot fields only for a type that sets it). No shared rotor file was touched.

Suite command (vitest here hides the rows' console values unless `--silent=false` is passed):
`npx vitest run tests/rotorcraft/ah56 tests/aircraft/ah56 tests/gear/ah56 tests/rotorcraft/bo105 tests/rotorcraft/legacyDigest.test.ts tests/input tests/ui --maxWorkers=4 --silent=false`.

## 16. Tuning round 5 (2026-10-25, branch `tune3/ah56keys`): the keyboard feel

Owner reports on the AH-56A keys: "spring loaded and unresponsive", "feels like a 747, not a military helo", "the auto centre
action of the controls is also a big issue". Owner decisions: no auto-centring of the keyboard controls, a crisp military-helicopter
feel; the control laws and numbers are AGENT choices. Probes, logs and the per-key before/after table: `W/rigid/tune3/` (notes.md,
table_before_after.md). Details: KNOWN_ISSUES T12.

| Key (15 m hover, STAB ASSIST on) | Before (main) | After |
|---|---|---|
| Arrow left / right, 1 s | first 1 deg/s at 0.4 s; 3 deg/s; 1.3 deg at release, the stick springs back | 0.1 s; 30 deg/s; 19 deg at release, 22-24 deg held (the attitude command), bounded at 30 deg (8 deg near the ground) |
| Arrow up / down, 1 s | 0.75 s; 1.9 deg/s; 0.6 deg | 0.25 s; 15 deg/s; 7 deg at release, 12.5 deg held, bounded at 15 deg |
| Z / X, 1 s | 1.8 deg/s; 0.6 deg; re-centring pedal | 0.1 s; 34 deg/s (35-39 at most); the turn braked on release, the new heading held (2 s key: 0.1 deg/s, 1.1 deg 6 s later) |
| F6 / F5, 1 s | 0.5 s to 0.3 m/s; 1 m/s; height held | 0.3 / 0.45 s; 2.3 / 1.3 m/s (4.5 / 2.5 m/s held); height held; the climb-rate command at every speed |

What changed (input.ts; the shared law, `src/sim/rotorcraft/stabilityAssist.ts`, and `src/input/{profile,InputSystem}.ts` only as
new opt-in fields, default off): `StabilityAssistTuning.keyAttitude` (the keyboard stick as an attitude command flown by the assist
with its own zero-rate trim; the input module keeps the keyboard stick within its travel; the term handed to the spring-trim anchor
when it stops flying, so the cyclic does not jump on the wheels or at Shift+A), `keyAttitude.groundRoll` (the bank bound near the
ground), `StabilityAssistTuning.keyPedal` (the yaw-rate pedal keys, the brake, the hand-back to the keyboard pedal, the forward-flight
yaw damper `cruiseDamp`; the input module limits a pedal key's move and moves the keyboard pedal itself with the follow-up). Dropped
from the AH-56A: `centringCyclic`, `centringPedals`, `recaptureOnCentre`. Set: `pedalCrossfeed` -2, the sideslip pedal gain 0.5,
`heightHold.held` 4.5 / 2.5 m/s, lever 0.4 per s, `everySpeed`; the keys 0.45 / 0.5 / 0.5 per s (roll / pitch / pedal), collective
0.1. Physics and the stick- and pedal-to-blade gearings are untouched; the R22 / R44 / S269 / MD 500 digest, the Bo 105 rows, the
input and UI suites pass unchanged.

The watching beginner (`tests/rotorcraft/ah56KeyPilot.ts`) was written for a re-centring stick; it now flies a position-holding one:
presses sized to the error at the rate it has learnt a key moves the nose (22 deg/s roll, 12 pitch, 2 m/s climb per s), waits for
the nose to settle before pressing again, corrects a drift with half round 3's attitude, banks half a degree per degree of heading
error leading by 2 s of the turn. The whole flight's rows (ah56KeyMission): both paces still land without a crash; the 0.8 s pace's
stop within 90 s is now a KNOWN GAP (KNOWN_ISSUES T12 has the six-pace counts and the roll key rate that trades it).
