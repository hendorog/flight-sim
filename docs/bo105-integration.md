# Bo 105 CB-4: stage-1 integration record

Branch `feat/rigid-rotor` in `/home/roger/github/fs-rigid/integ`, from the scaffold `0c3211f` (plan revision 2,
section 2.6). Stage 1 merges RC, TW, BO, AU, BX and PN in the plan's order (section 8.1). The Bo 105 stays
**`available: false`**: it is not in the chooser and flies only at `index.html?aircraft=bo105`. The owner decides
whether it ships. Nothing here was merged to main.

Every choice not in the owner notes is an AGENT choice. That covers the CB-4 variant, the hub set, the travels, the
mast-moment marks, the twin rigging, the sound and panel layouts, and the integration decisions below.

## 1. Merges

| Merge | Package head | What it brings | Integrator action at the merge |
|---|---|---|---|
| `abae59a` | RC `adb7b30` | Hingeless hub in the harmonic flap solver, hub-aware BEM, Pitt-Peters harmonic inflow, the AR-280 reference | none (clean) |
| `d71213e` | TW `2084248` | Joint freewheel, per-engine N2 governors, warning unit, OEI reset, the new rotorcraft inputs | none (clean); the tree equals BO's base `eb5919f` |
| `9a11980` | BO `599400d` | Bo 105 flight model, systems, performance, mass and CG, two tanks, power levers, fitted control travels | `649fee0`: twin rig and T6/T7b (section 3) |
| `e8d66cf` | AU `55dba14` | Two 250-C20B voices, warning unit tones; AH-56A sound | the audio parameter-layout pin (`tests/audio/mappingTypes.test.ts`, AU's patch: 15 parameters at indices 48-62, `PARAM_COUNT` 63) in the merge commit |
| `7feb633` | BX `b47e21e` | Exterior, hingeless head with root bending, right-seat cockpit | none (clean) |
| `a68dd53` | PN `4934ace` | Pedestal panel, UI, checklists, training, dev mock (Bo 105 and AH-56A) | PN's reference patch, AH-56A half only: `ah56/index.ts` takes `reference.vne` 195 from `AH56_REFERENCE`, so the GA ASI row stays green until AG merges. BO's `index.ts` already carried the full Bo 105 reference. |

Every package changed only files on its list in `package-files.json`. This was checked mechanically on each branch's
diff against its base.

## 2. Gate status

| Gate step (plan section 9) | Status |
|---|---|
| 1. Merge in order | Done: RC, TW, BO, AU, BX, PN. |
| 2. `definitionInconsistencies(bo105)` empty | **Empty.** GA `consistency.test.ts` passes for bo105 and ah56. It was red after BO alone: eye point 1.53/0.36/0.24 against the stub visual's MD 500E eye, and Vne 145 against the stub panel's 152. BX and PN cleared it, as BO said they would. |
| 3. KNOWN_ISSUES and `docs/known-issues.md` rows | Done. `src/aircraft/bo105/KNOWN_ISSUES.md` has BO's 21 items plus 23 rows handed over by TW, RC, AU, BX and PN. `docs/known-issues.md` has the Bo 105 and AH-56A table rows, the hingeless-core and multi-engine-resume entries, and the AH-56A rows that wait for the AG merge. |
| 4. This record | This file. |
| 5. Section 10 in-sim flights and section 11 shots | **Not run by the integrator.** See section 6. |
| 6. `npx tsc --noEmit` | Clean after every merge. |
| 7. `npm run build` and `check-build` | **Not run.** |
| 8. Codex review | **Not run.** |
| 9. Fable look and pilot gates | **Not run.** |
| 10. `available: false`; ask the owner | Bo 105 and AH-56A both `available: false`. |

## 3. Integration decisions (AGENT)

These change test files TW owns. Plan section 2.4 lets the integrator apply another package's contract request at
the merge, and BO asked for all three.

1. **The twin rig flies the definition's governor.** `tests/rotorcraft/twinRig.ts` used to spread TW's
   `BO105_TURBOSHAFT_INDICATION` over the definition's turboshaft control. That put back TW's governor rigging
   (datumNg 0.773, anticipation 0.39) over BO's refit (0.774, 0.469), which BO derived on the real rotor. The rig now
   keeps the definition's governor and still applies the indication: % torque, limits and engine-out.
2. **twinGovernor T6 holds attitude.** The row checks the governors. It is not a hover-stability test, and the
   hingeless hover diverges hands-off (BO KNOWN_ISSUES item 17). Cyclic attitude hold alone left N2 0.219 % from its
   set point (limit 0.2). With the definition's governor as well, N2 reads **101.93 % at the 102 % stop and 98.12 % at
   the 98 % stop**, beeping at 1.00 %/s. The bounds are unchanged.
3. **The T7b NR band is an `it.fails` KNOWN GAP row.** On the Bo 105 rotor NR reads **96.12 % 5 s after the
   failure**, against a band of 93-96 % (ESTIMATE / P5 FM 3-21). It sinks slowly to **95.81 % at 25 s** and never
   reaches 95 %, so the RPM light stays out. Every other T7b assertion is still plain: survivor **103.85 % torque**
   (≤ 105), **104.80 % N1** (≥ 104.5), **TOT 810.3 °C**, and recovery to 98.8 % NR in 1.8 s with collective down at
   2 %/s. T7c passes. TW's "BLOCKING" conflict (105 % torque against the 95 % light under the power-turbine law) does
   not arise on this rotor. The architect still owns the band itself: either restate it as 96 ± 0.5 % (ESTIMATE), or
   leave the gap row.

## 4. Measured on the integrated branch (2200 kg, mid CG, unless stated)

These numbers come from the BO trace re-run on the integrated tree
(`W/traces/bo105-integ/`, `BO105_TRACE`) and from the twin trace (`W/traces/twin-integ/`). They equal BO's
branch numbers, which is expected: AU, BX and PN change no physics.

**80 KCAS, 3000 ft (AR-280 envelope, P)**

| | Measured | Target (tag) |
|---|---|---|
| Lp | -10.67 1/s | -11.41..-5.95 (P AR-280) |
| Mq | -3.96 1/s | -5.84..-2.45 (P) |
| Nr | -1.24 1/s | -1.39..-0.60 (P) |
| Mw | +0.040 1/(s m) | +0.037..+0.125 (P), at the band edge |
| Zw | -0.683 1/s | -0.70 edge: **miss** (it.fails, rotor/inflow limit) |
| Lq/\|Lp\| | 0.194 | 0.25-0.50: **miss** (it.fails) |
| Mp/\|Mq\| | -0.13 | -0.1..-0.3 |
| Control M_lon / L_lat / N_ped / Z_col | 0.0933 / 0.186 / 0.049 / -0.352 per % | 0.093 / 0.185 / 0.049 / -0.349 (P; fitted, "%" = % of full travel ASSUMED) |
| Roll mode | 1/T 10.85 (τ 0.092 s) | 8.49 ± 30 % (edge 11.04) |
| Dutch roll | 2.70 rad/s, ζ 0.18 | 2.5 ± 30 %, ζ 0.05-0.30 |
| Phugoid | ζ -0.20 at 0.39 rad/s: 16.3 s period, doubles in 8.7 s | unstable (DLR ζ -0.15, 14 s to double) |
| Coupled roll/flap mode (78 KIAS) | 12.6 rad/s, ζ 0.63 | 13.7 ± 30 %, ζ 0.3-0.7 (P LS-178) |
| Hover Lp (IGE) | -12.1 1/s, τ 0.083 s | -6..-10 ESTIMATE: **gap** (no hover source obtained) |

**Performance and engines (SL ISA)**

| | Measured | Target (tag) |
|---|---|---|
| Hover torque per engine, 2500 kg OGE / IGE | 82.7 % / 72.0 % | 79-83 / 72-78 (F CB-5) |
| Hover torque per engine, 2200 kg OGE / IGE | 70.6 % / 61.8 % | 67-74 / 61-69 (F) |
| HOGE / HIGE at 2500 kg | 3,130 / 6,235 ft | 3,850 ± 1,500 / 6,200 (F, ESTIMATE offset) |
| Vy | 59.5 KIAS | 60 ± 8 (P5) |
| AEO climb, 2 × 86 %, 60 KIAS | 2,107 ft/min (2200 kg), 1,637 (2500 kg) | 1,575 ± 20 % (S) and 1,150-1,400: **gap** |
| OEI climb, 95 % | +315 ft/min (2200 kg), +31 (2500 kg) | +300..+650, -100..+250 |
| Max cruise | 129.9 KTAS at 86.0 % / 760 °C | 125-135 |
| Autorotation NR (engines off, 75 KIAS) | 107.5 / 85.4 / 114.7 % at 2200 / 1400 / 2500 kg | 104-110 / 83-88 / 111-117 |
| Autorotative descent at 100 % NR | 2,039 ft/min at 60 KIAS, 2,120 at 75 KIAS | 1,800-2,400 / 2,000-2,600 |

**Twin drivetrain on the Bo 105 rotor (twin rig, definition's governor)**

| | Measured | Target (tag) |
|---|---|---|
| T5 matched / mismatched split | 0.0 % / 3.6 % (69.8/73.4 %) | ≤ 1 % / 4 ± 2 % (AGENT/ESTIMATE) |
| T5 ENGINE TRIM left held | crosses zero at 1.83 %/s after 2.2 s, settles -0.7 % | 1.5-3 %/s, ≤ 1 % |
| T6 N2 at the beep stops | 101.93 / 98.12 % | within 0.2 % of 102 / 98 |
| T7a OEI from 2 × 45 % at 60 KIAS | NR min 97.5 %, survivor settles 88.1 % torque, N1 101.9 % max, TOT 764 °C, LEFT yaw 6.6 °/s first | NR ≥ 92, ≤ 95 %, ≤ 105 %, ≤ 10 °/s |
| T7b OEI from 2 × 55 % in the hover | NR 96.12 % at 5 s → 95.81 % at 25 s; torque 103.85 %; N1 104.80 %; TOT 810 °C | 93-96 % (**gap**), ≤ 105 %, 105-106 % (test ≥ 104.5), 810 °C |

## 5. Regression evidence

- **Existing helicopters are bit-identical.** `legacyDigest` with `s269Legacy` and `contactAirborne` gave 35/35 exact
  after the RC+TW merges, again after BO, and again in the final run. The MD 500E, R22, R44 and S269 tolerance pins (GR
  sets 2-4) are green, and the only failures in them are the recorded baseline exceptions.
- Per-merge guard outputs are in `W/guards/integ/<n>-<package>/`. `W/integ/merge-log.md` has the merge log.
- Final run: see section 7.

## 6. Not run, and why

- **Section 10 in-sim readouts** (`bo105-hover.png` and the `sim-record` hover) and **section 11 shots**. Neither was
  run on the integrated branch. BO ran the readout on its own branch (MD 500E stub exterior). Hands-off as written, the
  plan command ends in a rotor strike at about 20 s. With `&ap=1` (the app's own hover URL) it holds: NR 424.7 rpm,
  N1 99.6/99.6 %, torque 80.6/80.6 %, TOT 738 °C, mast moment 1.7 kN m, pitch +3.5°, roll 3.0° left. BX's shots were
  taken before BO raised the tail-rotor hub to 2.80 m, so `bo105-side` and `bo105-tail` need re-rendering before the
  owner looks at them.
- `npm run build` / `check-build`, the Codex review, and the Fable look and pilot gates.

## 7. Final test run on the integrated tree (`a68dd53`, all six merges)

- `npx vitest run tests/aircraft tests/propulsion tests/rotorcraft tests/input tests/audio tests/instruments
  --maxWorkers=6`: **148 files, 1916 passed, 29 expected-fail (`it.fails` known-gap rows), 0 failed.** This
  includes `legacyDigest`, `s269Legacy` and `contactAirborne`, the MD 500E pins, and every Bo 105, twin, rotor-core,
  audio and panel file. The two `md500Exterior` baseline exceptions passed in this run.
- `FS_GOLDEN_EXACT=1 npx vitest run tests/golden`: **51 passed, 2 failed.** The two failures are exactly the
  recorded baseline exceptions in `c172Sim.golden` ("runway: 40 s flown by the autoflight" and "cruise: 20 s ...
  restored through JSON"), which fail on unmodified `cd33d6c` as well. `c172Audio.golden` is exact.
- Raw output: `W/guards/integ/final/{dirs,golden}.txt`.

## 8. Open requests carried forward (not applied; each belongs to the named owner)

- **Plan amendments (architect)**, from RC. They are recorded here and not edited into the plan:
  - The harmonic Pitt-Peters rows R9/R10 cite NASA TM-88327. That report has only the uniform mode, and the harmonic
    rows come from TM-102219 (eqs 13b, 14, 17-18).
  - R23's 3-9 % band, and AH's H9 8-15 % band, assume first-harmonic periodic flap damping. The model gives about
    -2 % at mu 0.35 (-2.1 % lateral, -1.1 % longitudinal).
  - Section 4's "Lq/\|Lp\| = (nu^2-1)/(gamma/8) = 0.34" is superseded by (S - gamma/16)/(1 + S gamma/16).
  - The R11 wording should read "an extra left excursion of 0.5-3.0 deg somewhere in 10-30 KIAS".
  - The section 10 readout line needs `&ap=1`, its band (64-72 % at 2200 kg IGE) does not match the hover scenario
    (2500 kg, 16 m), and `sim-record ... 12 30` records about 6.8 s at 60 fps.
  - The T15 band ("NR 60 → 98 % in 10-20 s") does not match the measured 4.35 s, where NR follows the 5 s lever ramp.
  - Section 4 says the hover inflow gradient cuts roll damping. Measured, it raises it: Lp -8.8 with the inflow off
    and -12.1 with it on.
- **BX:** draw the skid tubes 1.25° nose-up through `SKID_FRONT_Z`; at present the drawn front toes float about 5 cm.
  Re-render the tail shots.
- **PN:** a menu toggle for the prop-schedule assist and the HUD PWR 1/2 / ENGINE TRIM readouts (TW request). The
  engine lamps should read the twin warning flags rather than the MD 500E RE-IGN / ENG OUT row (TW request; not
  checked on the integrated panel). Also confirm that the 32 kN m mast-moment fallback is unused now that BO
  publishes 15.5 kN m.
- **TW:** a sequential fuel-draw option (`FuelFeedDef.drawOrder`), so the 50:1 tank list can go. N1-split warning
  reset.
- **Integrator (later):** republish engine N1/TOT from the snapshot on restore (SimPhysics). This is a one-frame gauge
  glitch, recorded in `docs/known-issues.md`.
- **At the AG merge:** `ah56/index.ts` has the integrator's `reference.vne` line from PN's patch, and AG's full
  reference replaces it. Move the AH-56A rows in `docs/known-issues.md` into `src/aircraft/ah56/KNOWN_ISSUES.md`.
- **Commit trailers:** PN's commits carry `Co-Authored-By: Claude Sonnet 5.5`, because that model ran them. History
  was not rewritten. The integrator's commits carry the Opus trailer.
