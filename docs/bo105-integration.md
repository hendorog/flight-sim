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
| 5. Section 10 in-sim flights and section 11 shots | **Run at verifier gate 0 (section 9).** The hands-off readout crashes at about 19 s (KNOWN_ISSUES 17); with `&ap=1` every readout row passes. All 13 section 11 shot commands ran and were compared with the reference photos. |
| 6. `npx tsc --noEmit` | Clean after every merge. |
| 7. `npm run build` and `check-build` | **Done at gate 0:** the build succeeds; `check-build` loads bo105 and ah56 on the runway with no console errors. |
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
  sets 2-4) are green with no failures. The plan's two R22 six-degree slope baseline exceptions (`skids.test.ts`)
  were 5 s **timeouts under full-directory load** in the baseline output (`W/baseline/vitest-arp.txt`,
  `s0b-final-arp.txt`: "Test timed out in 5000ms"), not creep failures. The same file passes 10/10 alone on the
  scaffold `0c3211f` (a temporary detached worktree, since removed), so their passing here is not a legacy change.
- Per-merge guard outputs are in `W/guards/integ/<n>-<package>/`. `W/integ/merge-log.md` has the merge log.
- Final run: see section 7.

## 6. In-sim readout on the integrated branch

`node scripts/shot.mjs 'index.html?aircraft=bo105&hover=1&ap=1&cam=chase&resume=0&run=20&freeze=1&quality=low' ...`
(plan section 10 readout with `&ap=1`; `W/shots/integ/bo105-hover-ap.png`). After 20 s: NR 424.7 rpm (100.0 %),
N1 99.6 / 99.6 %, N2 100.0 / 100.0 %, torque 80.6 / 80.6 %, TOT 738 / 738 °C, mast moment 1.70 kN m, pitch +3.5°,
roll 3.0° left, no crash. This matches BO's branch readout to the digit. In this first browser run with all six
packages together, BX's exterior, PN's HUD block (PWR 1/2 FLIGHT, N2 SET 100.1 %, SPLIT -1.3 %, TQ, TOT, N1, N2/NR)
and the twin drivetrain all show. The chase view looks from behind at about 25 m. At that distance the stabiliser
endplates, the fin and the skids read correctly against the reference photos (`ext-flyingbulls-cb-01.jpg`), but it
cannot judge detail. The flight-cue box shows the fixed-wing cue "Yoke held back: trim nose up (End)" during the
hover hold. That was observed and not investigated, and it was not checked whether the MD 500E
shows the same cue under the hold.

## 6a. Not run, and why (at the integration; section 9 closes the readout, recording, shots and build)

- **Section 10 hands-off readout** (`bo105-hover.png`, without `&ap=1`), the `sim-record` hover and the **section 11
  shots** were not run on the integrated branch. BO ran the readout on its own branch (MD 500E stub exterior). Hands-off as written, the
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

## 9. Verifier gate 0 (2026-10-21, on `3fc70dc`)

Every Bo 105 row of the plan-final `flights` array was run, along with plan section 10 and every Bo 105 shot of section 11.
No code was changed. The measured-against-target table is `W/flight-numbers.md` (Bo 105 gate 0). The guard logs are in
`W/guards/gate0/run1/`, the shots and contact sheets in `W/shots/bo105-gate-0/`, and the recordings in
`W/rec/bo105-gate0/`.

- **Guards.**
  - G0 is clean, GR has 35/35 exact digests, GA 250/250 and GS 98/98.
  - GF has the two c172Sim baseline exceptions only.
  - RC, TW (with check-keys), BO, AU, exteriors and panels all pass, apart from their recorded `it.fails` rows.
  - The BO trace is byte-identical to the integration trace.
- **Hover readout as written (hands off).** The aircraft crashes at about 19 s with a main rotor strike, at 53.5 deg of
  roll (NR 424.7 rpm, N1 101.2/101.2 %, torque 84.2/84.2 %). It drifts downwind at 4.6 m/s from the start: the scenario
  trims at airspeed 0 in the default 8 kt wind. This is KNOWN_ISSUES 17.
- **With `&ap=1`.**
  - NR is 424.67 rpm, N1 99.6/99.6 %, N2 100.04/100.04 %, torque 80.65/80.65 %, TOT 738/738 C and mast moment
    1.70 kN m. No crash.
  - A 31 s recording (`60 30`) stays 5.4 m from the start position. The initial drift is caught by 6 s, and from 11 s
    on the hover holds within 2 m.
  - The plan's `12 30` recording covers only 6.9 s.
- **Build.** `npm run build` succeeds. `check-build` passes for bo105 and ah56 on the runway with no errors.
- **Shots.** No obvious Bo 105 defect against the reference photos. Two plan views are framed too wide or too short to
  judge, and zoomed extras were taken:
  - `rotorside` is 18 m from the head;
  - `panel-day` at 1000 px height cuts off the lower rows.
- **Recorded, not fixed.**
  - The fixed-wing "Yoke held back: trim nose up (End)" cue shows on the Bo 105 while the hold flies (both runs at
    20 s), and not on the MD 500E. It comes from two legacy `src/ui/status.ts` rules:
    - an engaged autopilot is not counted among `othersFlying`;
    - the cue's direction reads the absolute elevator.
    The hold leaves the Bo 105 stick 0.126 forward of its spring-trim anchor (0.333 against 0.459, wind trim), yet the
    cue says "back". The MD 500E sits 0.025 from its anchor, under the 0.04 threshold. See KNOWN_ISSUES.
    Fixed at look gate 1 (KNOWN_ISSUES "Fixed-wing trim cue under the hold").
  - `engines[1].propRpm` reads engine 2's output-shaft rpm (6156). Its only readers are the muted engine-2 prop voice
    and the propeller visual, which the Bo 105 does not have.
- **Not run at gate 0:**
  - the Codex review and the Fable look and pilot gates (plan section 9 steps 8-9);
  - the AH-56A flights and shots (AG has not merged).

## 10. Flyability pass (2026-10-22, branch `rigid/bofly` from `03ec6e1`)

The second-pass pilot gate's findings, handled per the judge's plan (W/bofly/fix-plan.md; report W/bofly/fix-report.md).
The owner has no helicopter experience and flies a laptop. Realism first: the hover rows were re-sourced to the
flight-identified Bo 105 hover (Kaletka & Gimonet, ERF 1995 VII-7, P), which shows the 2.3 s hover divergence is the real
aircraft's (its Fig 13 phugoid doubles in about 1.7-7 s; the sim sits on the fast side), so no physics changed; the
hover yaw damping (Nr -0.54 against -0.97 / -1.10) has no per-definition fix (a one-probe sweep, KNOWN_ISSUES 20); the
120 KIAS stick row was re-sourced to NASA CR-3144's rig (F). Flyability went into the control path, Bo 105 only: the
STAB ASSIST sim aid (default ON, Shift+A), Shift+F5 / Shift+F6 hand-rate collective, 5-key centring at 1 travel per second
and Shift+5 keyboard trim here, and the helicopter control box. Shared files touched (owners TW, sim, UI): `src/input/
{profile,bindings,InputSystem,virtualYoke}.ts`, `src/sim/{SimPhysics,Simulator,params}.ts`, `src/aircraft/types.ts`,
`src/ui/{status,styles,uiSystem}.ts`; every new field is optional and absent on the other types (legacy digests 35/35).
KNOWN_ISSUES "Flyability pass" lists the details and the owner decisions.
