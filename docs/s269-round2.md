# Schweizer 269 round 2 — merge, cockpit and model audits

The in-progress merge from `main` is resolved **in file contents**, without staging, committing or restarting it. The cockpit's crossing white/grey band is corrected. The IGE ceiling error and production lead-lag coupling remain **unresolved**; neither was hidden by fitting coefficients or changing acceptance tolerances. No reference dimension or `RotorcraftState` contract changed.

## Merge and Robinson equivalence

`src/physics/rotorcraft/rotorcraft.ts` retains the articulated forcing, harmonic advance, offset-hinge moments, per-blade publication and the `if (!articulated)` coning/stall path. Main's stopped-rotor change supplies zero initial inflow, an infinite aerodynamic flap time constant at zero speed, the finite body-transport limit, and the low-speed mechanical teeter stop. The articulated solver already holds its stopped harmonic pose; it does not acquire a fictitious teeter hinge/stop.

The entire `compute()` and `settle()` implementations were reread against both parents. There is one flap branch, one mean-load/inflow block and one load assembly; no duplicated blocks or conflict markers remain.

An independent copy of `main` (`8cac779`, including stopped-rotor fix `7157794`) was extracted with `git show` into ignored `work/r2/main-rotorcraft.ts`, with only its relative import paths rewritten. Running the original six-case capture against that implementation produced exactly the same digests as the resolved solver. Each case hashes **960 force evaluations**, including rotor state, loads, power, angular momentum, drive and engine output: **5,760 evaluations total**.

Only cold case 0 changes from the old `0d19506` baseline:

| Case | Main / resolved SHA-256 |
| --- | --- |
| R22 cold | `5dbf5f6ad3dd4c42aabb6d8abfeffab12bf718ad9a967179914b4cf9b40a2ad3` |
| R44 cold | `8b62003fe094689b1a623e30db2c4a1b316a991701d7fdf5979446f59cdd5ac8` |

The four running-case digests are unchanged. `tests/rotorcraft/s269Legacy.test.ts` updates only these two cold baselines, with provenance. `stoppedRotor.test.ts` now also exercises the 269 in both crosswinds and both raised-surface blade-contact cases. Signed zero from the articulated cosine convention is treated as numerical zero. Mechanical teeter-stop tests still apply only to teetering hubs. The merged `scenario-spawns.test.ts` enumerates `AIRCRAFT_IDS × SCENARIO_IDS`, including **all five 269 scenarios** without autoflight.

## Cockpit defect

The diagonal obstruction reproduced in both the simulator and aircraft preview. It came from incompatible glazing boundaries: a straight windscreen A-post cutout crossed the oval door surround, while the door window was much smaller than that surround. The cabin lining and skin therefore left a broad tapered opaque wedge beside a separate painted tube. That exterior tube was also centred **8 mm inside** the bubble, exposing its white surface inside the cabin. The adjacent oval is the intended circular ventilation ring seen obliquely.

The door tube itself was finite and continuous: minimum sampled side coordinate 0.414 m, maximum triangle edge 37.61 mm, and no off-surface path points. Hiding skin/lining and then the painted detail mesh independently isolated the components (`cockpit-no-shell.png`, `cockpit-isolate.png`). This was not a corrupt vertex/index buffer.

The 269-only changes are:

- `visual.ts`: bring the clear windscreen and door panels together beneath the physical frame; reduce the oversized opaque door-window border.
- `exteriorDetails.ts`: move the painted surround centre from −8 mm to +6 mm relative to the exterior skin.
- `cockpitDetails.ts`: add a continuous dark inner seal on the lining surface.
- `s269Exterior.test.ts`: check that the formerly opaque junction is clear on both sides.

The arrangement follows the cabin photograph on **AOPA Pilot, April 1997, p64**, [original flight-test article](https://www.aeroresourcesinc.com/uploads/199704-1997%20Robinson%20Beta%20II%2CSchweizer%20300CB.pdf). The photograph is cached and viewed at `work/r2/aopa-cabin-64.png`. Frame placement/width remains a photographic estimate. No `dimensions.ts` value changed. The curved frame, seal and ventilation ring remain visible; the crossing wedge is gone. Left/right, floor/controls/seats, roof and night views were inspected.

## Hover ceiling: isolated power mismatch, no justified coefficient fix

The cached manufacturer **CSP-C1-1, reissued 16 January 2019**, Figures 5-3 and 5-4 (printed 5-4 and 5-4.1), were viewed again. They are the carburetted HO-360-C1A **IGE** charts, respectively full rich and leaned: 2700 RPM, full throttle, carb heat off, two-foot skid height, upstack exhaust, no blade abrasion tape. The [manufacturer-hosted manual](https://cdn.shopify.com/s/files/1/1008/9286/8689/files/Flight-Manual-269C-1-300CB-CBi-CSP-C1-1.pdf?v=1772539456) and cached `rfm-2019.pdf` are the same file in the existing source manifest.

**There is no carburetted OGE hover chart in this RFM's performance section.** Figure 5-4A is an injected-engine IGE chart, not OGE. The OGE numbers below are model predictions, not RFM validations.

The performance test now records main induced/profile work, tail induced/profile/wake work, transmission loss, thrust, inflow, ground-effect factor, density, and engine pressure/temperature/airflow/mixture/losses. It checks the steady-hover shaft-work identity independently. No force, power, geometry or efficiency parameter changed. `S269_TRACE=1 npx vitest run tests/rotorcraft/s269Performance.test.ts` writes the extended audit to `work/s269-fm/performance.json`; the original capture is `work/r2/performance-before.json`.

Before and after IGE predictions are identical (pressure altitude, ft; 46.875-ft root bins, chart readings approximately ±200 ft):

| Weight lb | OAT °F | Mixture | RFM IGE | Before = after | Error |
| --- | --- | --- | ---: | ---: | ---: |
| 1750 | 0 | rich | 6300 | 5929.7 | −370.3 |
| 1750 | 0 | leaned | 6800 | 6445.3 | −354.7 |
| 1750 | 40 | rich | 4100 | 4570.3 | +470.3 |
| 1750 | 40 | leaned | 4500 | 5226.6 | +726.6 |
| 1750 | 80 | rich | 1900 | 3304.7 | +1404.7 |
| 1750 | 80 | leaned | 2500 | 4101.6 | +1601.6 |
| 1600 | 0 | rich | 8000 | 7757.8 | −242.2 |
| 1600 | 0 | leaned | 8600 | 8601.6 | +1.6 |
| 1600 | 40 | rich | 5800 | 6445.3 | +645.3 |
| 1600 | 40 | leaned | 6300 | 7382.8 | +1082.8 |
| 1600 | 80 | rich | 3500 | 5132.8 | +1632.8 |
| 1600 | 80 | leaned | 4300 | 6304.7 | **+2004.7** |

At the **1750-lb, full-rich chart points**, in shaft horsepower:

| OAT °F / chart PA ft | Density kg/m³ | Main induced | Main profile | Tail induced | Tail profile | Transmission loss | Engine demand | Available |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 / 6300 | 1.0953 | 86.12 | 42.95 | 7.30 | 3.68 | 8.94 | 148.97 | 145.95 |
| 40 / 4100 | 1.0942 | 86.16 | 42.92 | 7.30 | 3.67 | 8.94 | 148.99 | 152.86 |
| 80 / 1900 | 1.0987 | 85.99 | 43.03 | 7.28 | 3.68 | 8.93 | 148.91 | 160.54 |

Tail-wake exchange is subtracted in the exact identity; rounding hides its small value in this table. Airframe download is already included in trimmed rotor thrust and must not be added to induced power a second time.

Findings:

- The chart lines at fixed weight/mixture are approximately constant-density contours: the above points correspond to roughly **3,671–3,809 ft density altitude**. Aerodynamic demand is therefore almost unchanged. The model's ground-effect factor is **0.85177** at all three points; its OGE demand there is **167.76–167.89 hp**, an IGE benefit around **18.9 hp** at the crank.
- Transmission efficiency is the inherited **0.94 estimate**. Both published continuous and takeoff ratings are **180 hp**, with no Robinson MAP placard or timed derating. All audited chart-point demands/available powers are below 180 hp; a rating cap cannot remove this discrepancy. There is no separately measured installed fan-power curve.
- Full-rich equivalence ratio is **1.336–1.339** at these points, so the carburettor's density-based enrichment barely changes. Leaned cases optimize the existing model's mixture grid; they retain the temperature error. Carb heat and icing are absent in these dry/cold-intake evaluations. The 300 W accessory allowance is explicit.
- The chief temperature dependence is in available engine power, including the generic induction temperature correction. However, [Lycoming 60297-12 Figure 3-42, printed 3-56](https://www.lycoming.com/sites/default/files/file/2025-11/60297-12%20-%20O-360%2C%20HO-360%2C%20IO-360%2C%20AIO-360%2C%20HIO-360%2C%20and%20TIO-360%20Series.pdf) explicitly covers **HO-360-C1A** and specifies a square-root absolute-inlet-temperature correction at fixed MAP/RPM/altitude. Its page was downloaded and viewed (`work/r2/lycoming-power.png`). Simply deleting this correction to follow a constant-density helicopter chart is not justified.
- A constant missing accessory loss would need to be **−3.02, +3.87 and +11.63 hp** at the three above points. A constant fan loss cannot fix all three. A fan at fixed RPM and almost identical density would not naturally produce this temperature pattern either. Changing a single induced/profile coefficient or transmission efficiency has the same problem: it moves the cold points the wrong way.

Still needed: installed HO-360-C1A/HA-6 full-rich and leaned WOT power/fuel-flow/MAP versus actual carburettor inlet temperature and pressure; cooling-fan and drivetrain torque-loss maps; blade section polars versus Reynolds number; independent IGE/OGE installed hover-power data and the RFM chart reduction assumptions. The generic 14.8-gph full-rich calibration is a minimum-flow boundary, not a measured carburettor map; the Lycoming performance figure is for maximum-power mixture. That calibration distinction also needs validation. No unmeasured correction is presented as a fix.

## Lead-lag: why the rejected experiment is still unsuitable

The saved `work/integ/rejected-lag/` notes, `lagBody.ts`, integration hook, tests and flight trace were read. The old startup fails near **191.146 rotor RPM**, with modal lag amplitude **0.534 rad (30.6°)**: already outside the small-angle reduction. The approach traces show repeated skid departures during rundown. The old 835–1255 W whole-aircraft residual excluded added lag/cross energy and cannot alone establish energy creation.

### Damper sign, magnitude and speed dependence

For the unchanged estimated blade/damper data:

```
I_lag = 84.084244 kg m²
k = 35000 × 0.12² = 504 N m/rad
c = 8000 × 0.12² = 115.2 N m s/rad
e S = 7.093172 kg m²
I zetaDDot + c zetaDot + (k + e S Omega²) zeta = F
D = c zetaDot² >= 0
```

The sign is dissipative in both the existing isolated solver and rejected coupled solver. It is not a negative-damper bug. Positive coefficients do **not** establish that these are the measured healthy 269A1290-3 coefficients.

| Rotor RPM | Rotating lag frequency Hz | Damping ratio | Samples/cycle at 240 Hz | Regressive frequency Hz |
| --- | ---: | ---: | ---: | ---: |
| 0 | 0.38965 | 0.27980 | 615.93 | 0.38965 |
| 10 | 0.39265 | 0.27767 | 611.23 | 0.22598 |
| 100 | 0.62142 | 0.17545 | 386.22 | 1.04525 |
| 200 | 1.04362 | 0.10447 | 229.97 | 2.28971 |
| 300 | 1.50359 | 0.07251 | 159.62 | 3.49641 |
| 471 | 2.31304 | 0.04714 | 103.76 | 5.53696 |

Low RPM is **less** numerically demanding here. The viscous free-amplitude decay rate is `c/(2I) = 0.68503 s⁻¹`; centrifugal stiffness raises frequency and lowers damping ratio as RPM rises. Neither an RPM cutoff nor a damping clamp is justified.

The production-independent `stepLag` test now audits a smooth 60-s spin-up, 5-s hold, 60-s rundown and 15-s stopped decay at **240/480/960 Hz**, including shaft-acceleration forcing. For variable RPM the effective rotating-frame energy requires the extra work port `0.5 Kdot zeta²`; omitting it mislabels spin-up work as numerical creation. At 240 Hz the discrete work residual is **−1.45e−14 J**, dissipated heat **0.629168 J**, and final angle **2.36e−8 rad**. The test also compares the state at a fixed physical time across steps. This proves the isolated damper/ramp calculation, **not** fuselage coupling.

### Two distinct problems with the coupled reduction

1. **Body rotation is not closed.** The saved energy includes `v_hub · V_lag`, but the derivative uses a locally frozen planar blade geometry. An instantaneous directional-derivative audit of its own energy, with no external forces and positive damper heat, tends to zero for stationary body axes. With a 0.2-rad/s roll, pitch or yaw it tends instead to **−0.7147, +0.2430, +2.5085 W**, respectively (same small lag/velocity state). Shrinking the audit increment from `1e-4` through `1e-6 s` does not remove these residuals. Full blade velocities must include body rotation of the displaced blade mass and the complete attitude/flap/lag inertia terms; a symmetric acceleration matrix alone does not supply the missing transport terms. This audit is not a numerical reconstruction of the whole-flight 1255 W error.
2. **The assumed support/damper combination is unstable even in its valid planar limit.** A supported, translation-only free-shaft test uses the inherited small-slip four-skid coefficients: `Kxy = 130000 N/m`, `Cxy = 2640 Ns/m`, mass 622.5 kg. Its uncoupled support frequency is **2.29997 Hz**, damping ratio **0.14673**, close to the regressive lag frequency near 200 RPM. A 10-micrometre initial hub displacement grows at 191 RPM to **69.241 micrometres**, with lag amplitude **0.000348418 rad**, after 8 seconds. At 240/480/960 Hz the amplitudes agree to **1.2e−10 rad**, and mechanical energy plus damper/support heat closes within **3.3e−10 J**. Growth draws energy from shaft rotation; positive dissipation does not prohibit this rotor/support instability. The same experiment decays at 0, 100, 150, 300, 400 and 471 RPM, and grows at 230 RPM. This is consistent with the rejected startup's failure region, not a validated real-aircraft resonance boundary.

Evidence and reproducible scratch rigs: `work/r2/lag-audit.test.ts`, `lag-audit.json`, `lag-support.test.ts`, `lag-support.json`, `lag-ramp.test.ts`, `lag-ramp-*.json`. The copied rejected solver remains ignored at `work/r2/rejected-lagBody.ts`.

A sound continuation needs a full body/blade kinetic model, consistent drive/clutch and aero work ports at the same integration stages, all lag modes including collective lag, flap/lag interactions and stops, and measured oleo/airframe support modes plus damper force/displacement/velocity/temperature data. The current scalar contact model's `suspension: 'oleo'` label does not add an oleo mechanism. Doubling damping until startup passes would not establish those data. **No coupled lag or ground-resonance implementation was promoted.** Production still publishes zero lag, with the original limitation intact.

## Verification and rendered evidence

All requested views were rendered and opened as images. They are 1280×800 under `work/r2/`:

- `cockpit-runway-before.png`, `cockpit-runway-after.png`.
- `cockpit-left-before.png`, `cockpit-left-after.png` (preview); `cockpit-left-runway-after.png`, `cockpit-right-after.png` (simulator, about ±55° yaw).
- `cockpit-night-after.png` (full panel light); `cockpit-night-dimmed.png` (35%, landing light off).
- `exterior-side-close.png`; matching `c152-side.png` and `da20-side.png` at the same preset/FOV.
- `r22-apron.png`, `r44-apron.png` (cold, stopped rotor, orbit camera).

**Rendering limitation:** `/dev/dri` is absent. Chrome reports `ANGLE (Mesa, Vulkan ... llvmpipe (LLVM 22.1.8 ...))`, so these are software Vulkan renders. The original default-high simulator attempt failed readiness; successful simulator images use `quality=low` (default 0.75 render scale). Preview images use their standard lighting. The defect reproduced and its correction was inspected here, but **hardware-GPU/default-high acceptance remains for the supervisor**. No claim of real-GPU verification is made.

`npx tsc --noEmit` and `git diff --check` are clean. The stopped-rotor and scenario tests exercise the same production physics used by the browser; the independent Robinson capture matches all six cases exactly.

The first full run completed in 355.03 seconds: 211 passing files and one failure in the newly added lag convergence test (2,902 passed tests, 6 existing expected failures, 221 skipped). The test had compared sampled peak amplitudes across different time grids. It now compares angle/rate at the same physical time; all 12 articulated tests pass in isolation. No solver coefficient or acceptance tolerance was changed for that correction.

The final `npx vitest run --maxWorkers=4` completed successfully in **344.82 seconds**: **212 passing files, 4 skipped files; 2,903 passing tests, 6 existing expected failures, 221 skipped tests**. There were **no unexpected failures or timeouts**, so no timed-out file required a separate rerun. This includes the 269 tests, both Robinson exact comparisons, all 11 stopped-rotor tests and all 45 aircraft/scenario combinations. The expected autorotation-landing failures remain unchanged. Logs: `work/r2/full-suite-final.log`, `work/r2/typecheck-final.log`; initial run: `work/r2/full-suite.log`.

## File ownership

Round-2 edits: `src/physics/rotorcraft/rotorcraft.ts`; `src/aircraft/s269/{visual,cockpitDetails,exteriorDetails}.ts`; `tests/aircraft/s269Exterior.test.ts`; `tests/rotorcraft/{s269Legacy,s269Articulated,s269Performance,stoppedRotor}.test.ts`; this report. The shared solver/test changes are explicitly permitted by the brief. No R22, R44 or airplane source definition was edited, and no reference geometry contract changed.

Already cleanly merged from main: `docs/r22-flight-model.md`, new `tests/rotorcraft/stoppedRotor.test.ts` and `tests/sim/scenario-spawns.test.ts` (the stopped test was then extended as above). All source edits remain uncommitted; the conflicted index entry remains for the supervisor to stage. Scratch source, PDFs, images and traces remain under ignored `work/` only.
