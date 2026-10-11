# PA-38 stall and runway warning investigation

Measured on `pa38/stall`, 11 October 2026. Changes are uncommitted. The reported runway horn was reproducible; an excessively high aerodynamic stall speed was not. The horn was warning much too early with flap down. No lift, drag, pitching moment, mass, trim, gear, airspeed calibration, stall-strip or T-tail wake parameter has been changed.

The [Piper PA-38-112 POH, report 2126](https://www.aeroclubvitoria.net/utilidades/ECFRE%20POH-2012.pdf) distinguishes aircraft with outboard flow strips alone from aircraft with both pairs. This model represents **both pairs**. Section 2.5 gives green/white arc lower limits of **52/49 KIAS**, consistent with §4.35 and figure 5-3. The corresponding figure 5-1a readings are approximately **54.3/52.0 KCAS**. Green is 52–110 KIAS, white 49–89, yellow 110–138, red line 138. The flap detents are **0°, 21°, 34°** (§7.9); 21° is the first notch, and 10° is an intermediate measurement, not a detent. The POH supplies clean/full-flap stall curves, not 10°/21° stall tables. The often-quoted 53 KIAS is the normal rotation/lift-off speed, not this configuration's clean stall marking.

## Stall measurements

Power idle, initially trimmed in an idle glide at 75 KTAS and 3000 ft above the test field, wings held level. A pilot controller commands a 1 KIAS/s ramp using longitudinal force balance for pitch feed-forward and speed feedback. It changes control inputs only. Achieved deceleration over the final five seconds to maximum lift was **0.962–0.979 kt/s**, with less than 0.1° bank at the peak. The regression requires 1 ±0.1 kt/s and less than 1° bank throughout the entry.

The principal comparison uses the repository's maximum-lift **1-g stall speed**, `sqrt(2W / (rho0 S CLmax))`, and converts that CAS through the existing position-error calibration at the measured CLmax. Also recorded below are the actual IAS/CAS at maximum lift: these are lower because the descending aircraft has unloaded slightly. This distinction matters when comparing a horn onset with a stall.

Light loading is **1450 lb**, comprising the modeled 1169 lb sample empty aircraft, 20 US gal usable fuel and a 161 lb pilot at the normal seat station. Maximum gross is 1670 lb with full fuel and the definition's normal seat loading. This is not an arbitrary mass override; the fuel, payload and CG calculations run normally. Small fuel consumption is included in the flight.

All speed pairs below are **KIAS / KCAS**, rounded to 0.1 knot. Before and after use the same controlled entry. Reinstating the original warning definitions reproduces identical flight trajectories and CLmax; maximum measured stall-speed change was exactly zero.

| Weight | Flap | Before | After | POH / comparison |
|---|---:|---:|---:|---|
| 1670 lb | 0° | 51.4 / 53.8 | 51.4 / 53.8 | 52 / ≈54.3 |
| 1670 lb | 10° | 50.8 / 53.4 | 50.8 / 53.4 | Not published |
| 1670 lb | 21° | 50.3 / 53.0 | 50.3 / 53.0 | Not published |
| 1670 lb | 34° | 49.8 / 52.7 | 49.8 / 52.7 | 49 / ≈52.0 |
| 1450 lb | 0° | 48.3 / 50.5 | 48.3 / 50.5 | ≈48.5 / 50.6, weight-scaled estimate |
| 1450 lb | 10° | 47.8 / 50.1 | 47.8 / 50.1 | Not published |
| 1450 lb | 21° | 47.3 / 49.8 | 47.3 / 49.8 | Not published |
| 1450 lb | 34° | 46.8 / 49.5 | 46.8 / 49.5 | ≈45.7 / 48.5, weight-scaled estimate |

The light-weight comparisons scale the gross-weight speeds by `sqrt(1450/1670)`; they are **not POH figures**, and assume unchanged CLmax. The simulated lower Reynolds number and changed loading need not obey that approximation exactly.

| Weight | Flap | Net CLmax, including tail loads | Actual speed at lift peak | Horn before → after, KIAS |
|---|---:|---:|---:|---:|
| 1670 lb | 0° | 1.368 | 50.1 / 52.4 | 60.6 → 60.2 |
| 1670 lb | 10° | 1.389 | 49.6 / 52.1 | 71.4 → 58.6 |
| 1670 lb | 21° | 1.408 | 49.1 / 51.8 | 70.5 → 57.3 |
| 1670 lb | 34° | 1.425 | 48.7 / 51.5 | 64.4 → 55.9 |
| 1450 lb | 0° | 1.347 | 47.1 / 49.2 | 57.5 → 56.7 |
| 1450 lb | 10° | 1.367 | 46.7 / 48.9 | 70.8 → 55.0 |
| 1450 lb | 21° | 1.386 | 46.2 / 48.6 | 64.6 → 53.6 |
| 1450 lb | 34° | 1.403 | 45.8 / 48.3 | 61.1 → 52.3 |

Some old flap-down warnings were already active at entry, so those before values are lower bounds on onset speed. The new horn leads the 1-g IAS stall by **5.5–8.9 knots** in these controlled runs. The wing area is the existing 11.59 m² (124.7 ft²); the existing calibration reproduces the handbook's difference between IAS and CAS. The data do not support increasing CLmax or altering tail download/trim to lower the stall speed. The four stall strips, washout, post-stall section behavior, and T-tail's changing immersion in the wing wake remain intact. The unchanged flight goldens corroborate that the force model has not moved.

## Reproduction and cause

The old horn compared the section's lagged angle against `alpha0 + stallPos(Re, flap) - margin`. Three effects made that unsuitable for a mechanical lift detector:

1. The wing's Reynolds-dependent stall break decreases at taxi speed, moving the apparent vane threshold down with it. The vane installation does not move with Reynolds number.
2. The PA-38's margin jumped from 10° to 14° around 10° flap, in addition to the section's existing flap corrections. It has one detector, unlike the PA-34's two-detector arrangement. The overlapping 10° boundary could also change branch with actuator rounding.
3. `alphaLag` is the aerodynamic pressure/separation state, not the vane's current local airflow. It can retain a low-speed flow transient after the actual flow has changed.

Representative **before** samples, full aft yoke, all wheels still on the runway:

| Condition | Flap | TAS, m/s | Sensor alpha | Trip threshold | Reserve (threshold − alpha) | Configured margin |
|---|---:|---:|---:|---:|---:|---:|
| Calm taxi, first warning | 0° | 5.02 | 1.54° | 0.66° | −0.87° | 10° |
| Calm taxi, first warning | 10° | 5.02 | 1.00° | −4.52° | −5.52° | 14° |
| Calm taxi, first warning | 21° | 5.02 | 0.48° | −5.46° | −5.94° | 14° |
| Calm taxi, first warning | 34° | 5.02 | −0.15° | −6.44° | −6.29° | 14° |
| Early take-off roll | 21° | 5.84 | −0.05° | −4.96° | −4.91° | 14° |
| Stationary, steady 15 kt headwind, flaps settled | 34° | 7.72 | −0.56° | −5.02° | −4.46° | 14° |

The calm taxi samples had approximately −0.3° fuselage pitch. Aft yoke had not raised the nose: the negative trip thresholds caused the warnings. Flap-induced changes of local flow are present, but tail/elevator angle is not accidentally being read as wing sensor angle.

In still air at rest, the horn stays off below the existing 5 m/s gate. The solver can report a numerically large angle (about 104° in this run) in vanishing flow; that angle has no useful physical interpretation. The gate remains unchanged.

## Fix and scope

[Safe Flight describes its lift detector as sensing the leading-edge stagnation point](https://www.safeflight.com/products/aoa-stall-warning/lift-detector/). A sensor can now specify a fixed reference Reynolds number for its clean installation angle. It uses the current local wing flow and a flap-induced leading-edge loading correction, rather than the flap's maximum-lift increment. The correction follows the `A0` term of [thin-airfoil theory, MIT F3 notes, pp. 1–3](https://ocw.mit.edu/courses/16-01-unified-engineering-i-ii-iii-iv-fall-2005-spring-2006/d721171c42af48a056aaccec784a6d10_f03_0304.pdf): the hinge geometry determines the fraction of the existing effective flap deflection that changes leading-edge loading.

The PA-38 now has one vane with an **estimated**, flight-calibrated clean trip incidence of 6.8° (9.5° below its reference break at Re = 2.1 million). This is a model installation estimate, not a published Piper rigging angle. It meets the POH's warning interval without changing the aerodynamic polar. The PA-34 uses the same shared mechanism, retaining its real two-detector changeover, documented on p. 2-29 of the [Piper Seneca manual](https://manualzz.com/doc/6394922/piper-seneca-pa-34-200-airplane-pilot-s-operating-manual). Its calibration reference is a fixed sea-level 70 KCAS condition; margins are 8°/9°. Its existing 5–10 mph warning target is retained; the fetched Seneca handbook confirms the detector arrangement and stall speeds but does not independently establish that numerical warning interval.

The new diagnostics expose the selected strip, sensor alpha, threshold, angular reserve and airspeed. There is no weight-on-wheels inhibit and no increased speed gate. A 5 m/s upward gust during a 20 m/s roll still trips the PA-38 warning in the regression.

After correction, the PA-38 is quiet while parked, lowering flaps, taxiing at approximately 10 kt, and accelerating with full aft yoke, for 0°/10°/21°/34° and zero/15 kt steady headwind. At 34° in the headwind, the parked sensor is −0.56° against a +2.64° threshold; during settled taxi it is approximately −0.01° against +2.65°. Full aft yoke starts rotation at approximately 38–40 KIAS: the tests end when the nosewheel lifts. Holding the yoke aft from brake release is not the handbook's normal 53-KIAS rotation technique, and a warning during a subsequently over-rotated/high-alpha roll must remain possible.

Cross-type findings:

- **PA-34:** reproduced the same sustained low-Re flap-down warning; fixed through shared code. A separate **33 ms** clean-wing chirp remains during an abrupt half-throttle taxi acceleration: 5.02 m/s, local alpha 9.60°, threshold 9.45°, pitch 1.73°. The geometric section angle is only 3.51°, so this is a transient in the modeled induced flow, not proof of a real stall. It is recorded rather than suppressed with a speed/ground gate. No sustained warning remains in the measured normal roll.
- **C152:** no warning in the fixed level-attitude grid. With full aft yoke and the aggressive taxi power application, its nosewheel lifts and pitch reaches roughly 15°; the ensuing warning is a different, actual high-alpha simulation condition. The early rotation behavior itself was not altered here.
- **C172S and DA20:** no steady taxi/roll warning with the tested still air or uniform headwind. The weather model adds mechanical turbulence even with its turbulence slider at zero; initial runs using it could produce brief gust-related crossings. The regression deliberately distinguishes uniform wind from a vertical gust.

The leading-edge model is an approximation, not a resolved vane/airfoil CFD solution. It reuses the wing's viscous flap effectiveness. Pressure-port sensors retain their existing behavior; this change explicitly applies the new vane model to the two affected Piper types.

## Files and verification

- `src/physics/aero/definition.ts`: optional vane calibration reference.
- `src/physics/aero/aeroModel.ts`: vane flow/threshold computation, validation and diagnostics.
- `src/aircraft/pa38/aero.ts`: single-vane definition and sourced calibration notes.
- `src/aircraft/pa34/aero.ts`: apply shared correction while retaining detector selection.
- `tests/fdm/measure.ts`: IAS/CAS and achieved-rate measurements; optional controlled idle deceleration; light fuel loading.
- `tests/conformance/targets/pa38.ts`: raise entry TAS to 75 so the throttle-chop transient settles before warning measurement. **No acceptance tolerances changed.** The previous 64 KTAS full-flap entry measured the warning during the initial unloading; it reported a 3.85-knot margin versus 6.29 from an established slow entry before final vane calibration.
- `tests/fdm/pa38Stall.test.ts`: stall/flap/weight matrix and eight full-aft runway runs.
- `tests/aero/stallWarning.test.ts`: five-type level-attitude grid, fixed vane reference, continuous flap response, and positive gust test.
- `docs/pa38-stall.md`: this report.

Passed: `npm run typecheck`; PA-38/aero/golden selection (154 passed, one skipped); new tests (17 passed); and `FS_AIRCRAFT=pa38,pa34 npx vitest run tests/conformance/pa38.test.ts tests/conformance/pa34.test.ts --maxWorkers=2` (**223 passed**, including the flown tier).

PA-38 conformance evidence: take-off ground roll **241.92 m** (250 ±30); best climb **689.37 ft/min** (705 ±70.5); 75% cruise at 7000 ft **102.46 KTAS** (105.5 ±5.28); glide at 70 KIAS **8.37:1** (7.8 ±0.8); stall recovery **0.63 s** (<4). Forward-CG clean/full stall speeds **54.15/53.10 KCAS** remain within the original bands. Final PA-34 warning margins are **6.31/7.89 kt**, within its existing 4–9 kt bands.

**Full suite passed:** `npx vitest run --maxWorkers=4`: **210 files passed, 2958 tests passed, four expected failures, 221 skipped tests** (373 s). The four expected failures are the existing R22/R44 autorotation-landing limitations. No files timed out. An earlier run encountered mixed versions of the newly edited test/helper; its missing-field failure passed alone and the complete fresh run passed with stable sources.

Scratch sources, scripts, JSON traces and logs are in `work/`. Useful records: `rate-stalls-before.json` / `rate-stalls-tracked.json`, `ground-steady-before.json` / `ground-final.json`, `ground-pa34-duration.json`, `new-tests-final.log`, `conformance-all-final.log`, and `full-suite-final.log`. The legacy-warning harness reconstructs the original sensor definitions on the unchanged force model, including the original Reynolds-dependent/lagged path.
