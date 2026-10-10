# R44 shared integration

Integration on `r44/integ`, 9 October 2026. Changes are uncommitted for supervisor review. The chooser, placeholder flags, unavailable lessons and unaccepted autorotation landings remain in place. Earlier worker reports describe their pre-integration branches; this report supersedes their shared-work lists.

## Result and sources

The detailed exterior now runs through the ordinary simulator and development viewer. The horizontal stabiliser moved up **0.38 m**, from FRD z=−0.30 to −0.68, and the forward stinger attachment now starts on its underside. Physics and rendering still import the one geometry contract. The replacement offset, tail-hub z + 0.22 m, is an **estimate traced from a drawing**, not a newly published dimension: [MM chapter 16](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44_mm_16_98b54d8fd7.pdf), Fig. 16-1, printed 16.3 (February 2024), has about 19 pixels between the hub and surface in the cached 1237-pixel image, scaled by a 796-pixel / 353-inch fuselage envelope. [MM chapter 4](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44_mm_4_8117b796b6.pdf), Fig. 4-6, printed 4.22, establishes the short F955 stabiliser brackets and guard mounting. The [POH three-view](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44ii_poh_1_b4fce9d9be.pdf), 1-3, provides the silhouette cross-check. No other frozen dimension or aerodynamic coefficient was tuned.

The R44 ASI has a crossed diagonal marking at 100 KIAS; the engine tachometer has separate 101/102% red radials; the overlapping green/yellow MAP ranges have distinct radii. R22 markings were checked against [R22 POH section 2](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r22_poh_2_a730a7b2f8.pdf), 2-8/2-9. Its ASI has a solid 102-knot radial and its engine tach has red arcs, so those existing markings remain unchanged.

Both helicopters now publish a separate `lowRpmLight`. Collective-down muting affects only the existing `lowRpmHorn`; battery/panel power gating is retained. R44 lighting maps the red flashing lamp to STROBE, both nose lamps to LAND plus clutch ENGAGE, and dial lighting to NAV. These follow [R44 POH section 7](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44ii_poh_7_e5154ae439.pdf), 7-17 and 7-25/26. The R44 panel has a zero-capable dimmer with independent warning-lamp brightness; its 2.2 response exponent and inherited 200 cd/m² full-scale level are rendering estimates. Emissive alpha tags independent/dimmed circuits; a shader uniform applies dimming after rejecting black dial paint. Keeping the small dimmer value out of the premultiplied 8-bit canvas avoids colour loss at low brightness.

The shared Vne path now retains departure mass through fuel burn and save/resume, and applies weight, power-off, above-MCP and doors-off corrections. Old saves without departure mass use current mass as the best available estimate. All contributing full-throttle MAP cells, including interior cells, report no numerical MAP restriction; mixed finite/FT corners retain the existing extrapolated finite trend. The R44 HUD shows VNE and MCP, including NO FLIGHT, FULL THROTTLE and exceeded limits. These implement the configuration rules in [R44 POH section 2](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44ii_poh_2_4c17ab4577.pdf), 2-1/2-9, without enforcing a flight envelope automatically. `rotorDoorsOff` is a configuration input for reporting; there is no door-removal UI or animation.

The R44 electric pump runs while PRIME is held, or with clutch ENGAGE and engine oil pressure, per POH 7-10. J and the key's spring hold select PRIME; S operates the separate starter. PRIME passes through BOTH, while S leaves ignition selection alone. The electric pump has its own output-pressure state, so mechanical fuel pressure cannot extinguish AUX FUEL PUMP. Pump pressure (25 psi), minimum voltage (18 V), oil-switch threshold (5 psi), warning threshold (5 psi), priming flow and intake-port film remain estimates; there is no calibrated switch hysteresis or pump-failure injection. PRIME is released on key release, focus loss, reset and resume.

**Interconnected tanks are deferred.** POH 7-11 states that the higher auxiliary tank empties before the main. The shared system still divides withdrawal across selected tanks. Implementing transfer needs usable fuel height/volume curves, connecting-line geometry and flow/head behaviour; an invented fixed aux-first draw would hide the missing hydraulic model. This is a larger fuel-system task, and is still disclosed in the aircraft metadata and UI.

## Changed files

Paths below are relative to the repository root. Shared modules and R44 geometry were explicitly delegated by this brief. Necessary R44 leaf, R22 indication, test and documentation edits are listed too; no airplane leaf was edited.

| File(s) | Change |
| --- | --- |
| `src/render/aircraft/AircraftVisual.ts` | Select the injected R44 exterior subclass in the production assembly. |
| `src/aircraft/r44/dimensions.ts` | Sourced stabiliser z correction and guard attachment; estimate/source comments. |
| `src/aircraft/r44/exteriorDetails.ts` | Remove the now-obsolete disconnected-stabiliser comment. |
| `src/render/aircraft/RotorcraftVisual.ts` | Forward the instrument-panel lighting profile to the cockpit material. |
| `src/render/aircraft/rotorcraft/cockpit.ts` | Follow the panel polygon with locally rounded rim corners; dim circuits after RGB filtering; optional constant luminance. |
| `src/render/aircraft/airframe/types.ts` | General lamp circuit/clutch wiring and optional panel luminance. |
| `src/render/aircraft/lights.ts` | Apply per-lamp switch/interlock to lens, glow and light output. |
| `src/aircraft/r44/visual.ts` | R44 light circuits/interlocks and constant panel luminance. |
| `src/instruments/panelDef.ts` | Cross-hatched ASI marking, engine tach radials, PRIME key and panel-light options. |
| `src/instruments/render/pitotStaticGauges.ts` | Clipped diagonal cross-hatch artwork. |
| `src/instruments/render/rotorTach.ts` | Independent engine radials, keeping the narrow green sector visible. |
| `src/instruments/render/engineGauges.ts` | Honour inner arcs in single-dial gauges. |
| `src/aircraft/r44/panelMarkings.ts` | Use the real cross-hatch and radial contracts instead of short arc substitutes. |
| `src/instruments/panel.ts` | Per-circuit emission/interlock and alpha tags; preserve legacy defaults. |
| `src/aircraft/r44/panel.ts` | LOW RPM light, auxiliary pressure caution, PRIME key, NAV/dimmer profile. |
| `src/instruments/hotspots.ts`, `src/instruments/render/controls.ts` | PRIME spring action, labels and displayed key position. |
| `src/aircraft/r22/panel.ts`, `src/aircraft/r22/ui.ts` | Read the independent LOW RPM light. |
| `src/dev/instruments.ts` | Correct light and R44 auxiliary-pressure fixtures. |
| `src/core/types.ts` | Optional PRIME, doors-off configuration and auxiliary output-pressure fields. |
| `src/physics/rotorcraft/definition.ts` | Add light/departure-mass state and optional plain-data Vne corrections. |
| `src/physics/rotorcraft/rotorcraft.ts` | Publish separate light and collective-muted horn. |
| `src/physics/rotorcraft/limits.ts` | Generic configured Vne and interior full-throttle MAP interpolation. |
| `src/aircraft/r44/limits.ts`, `src/aircraft/r44/rotorcraft.ts` | Connect shared helpers/correction data. |
| `src/physics/flightModel.ts` | Capture/restore departure mass; publish configured Vne/exceedance. |
| `src/physics/propulsion/defs.ts` | Optional pump automation and installation lighting interlocks. |
| `src/physics/propulsion/powerplant.ts` | Resolve automatic pump command before electrical/fuel steps; publish output pressure. |
| `src/physics/propulsion/electrical.ts` | Automatic-pump load and lighting interlocks; preserve default load summation order. |
| `src/physics/propulsion/fuelSystem.ts` | Separate auxiliary and combined feed pressure outputs. |
| `src/aircraft/r44/powerplant.ts` | Enable pump automation and lighting interlocks; eliminate unused beacon/taxi loads. |
| `src/input/profile.ts`, `src/input/bindings.ts`, `src/input/InputSystem.ts` | Installation-specific momentary PRIME and independent starter. |
| `src/aircraft/r44/input.ts` | R44 PRIME-key profile and J guidance. |
| `src/sim/resume.ts`, `src/sim/SimPhysics.ts` | Additive save migration/validation and release PRIME on reset/restore. |
| `src/aircraft/r44/ui.ts` | Configured limits readouts and accurate remaining system/control limitations. |
| `src/aircraft/r44/index.ts`, `src/aircraft/r44/training.ts` | Remove obsolete unfinished-pump/limit claims; retain placeholder and unavailable training. |
| `tests/rotorcraft/r44Integration.test.ts` | Eight integration cases for both low-RPM outputs, configured limits, pump/PRIME, wiring and migration. |
| `tests/rotorcraft/r44Flights.test.ts` | Exercise actual PRIME/automatic pump in the existing start sequence; no acceptance thresholds changed. |
| `tests/instruments/r44Panel.test.ts` | Markings, PRIME, independent light and pump-pressure fixtures/assertions. |
| `tests/instruments/r22.test.ts` | Explicit light-on/horn-muted fixture, retaining existing gauge/system expectations. |
| `tests/aircraft/r44Setup.test.ts` | Assert detailed production renderer; correct obsolete finite-MAP expectation in an all-FT region and test mixed interpolation. |
| `docs/r44-flight-model.md`, `docs/r44-exterior.md`, `docs/r44-panel.md` | Mark original reports as pre-integration and link this follow-up. |
| `docs/r44-integration.md` | This integration/verification report. |

R22 receives two intended shared fixes: independent LOW RPM light/HUD indication, and a console rim which follows its outline without spline overshoot. Its horn, gauge markings, physics parameters, input and dimmer behaviour are retained. The shared MAP fix preserves R22's existing full-throttle top-row semantics; that grid has no interior FT region. Airplane defaults retain their manual pumps, ignition behaviour, lighting circuits and material dimming. The new auxiliary-pressure output is additive.

## Numerical comparison

The baseline was captured before integration with the unchanged R44 acceptance tests. The final run uses the corrected common geometry and real pump command in the startup script. It is therefore a combined integration comparison, not an isolated attribution of every delta to the stabiliser. No dynamics coefficient, controller gain or pass threshold was adjusted.

| Measurement | Before | After |
| --- | ---: | ---: |
| Gross OGE hover shaft demand, SL/ISA | 226.047916 hp | 226.047916 hp |
| Gross 60 KIAS shaft demand | 121.912782 hp | 121.913052 hp |
| Gross 108 KIAS shaft demand | 200.406904 hp | 200.409716 hp |
| Gross 108 KIAS pitch | −5.684990° | −5.689622° |
| Solo 60 KIAS shaft demand | 99.410802 hp | 99.410431 hp |
| Low-stop NR, 260/300/360 lb aboard | 99.8453 / 100.8831 / 102.8559% | 99.8471 / 100.8847 / 102.8574% |
| 55 KIAS autorotation sink at 90% NR | 1265.2551 ft/min | 1265.2570 ft/min |
| 90 KIAS autorotation sink at 90% NR | 1689.9012 ft/min | 1689.8902 ft/min |
| Firing after cranking starts | 0.3250 s | 0.3208 s |
| Rotor motion after clutch ENGAGE | 2.675 s | 2.675 s |
| Governor acquisition, script time | 108.1125 s | 108.1125 s |
| Hover reached, script time | 239.400 s | 239.725 s |
| Magneto drop | 3.12498 percentage points | 3.12159 percentage points |
| Gross powered touchdown speed / sink / NR | 0.054292 kt / 0.043189 m/s / 101.664880% | 0.054301 kt / 0.043194 m/s / 101.665046% |
| Solo powered touchdown speed / sink / NR | 0.044189 kt / 0.045930 m/s / 101.538391% | 0.044198 kt / 0.045929 m/s / 101.538413% |
| Gross attempted autorotation landing: NR / speed / sink | 87.1651% / 8.1703 kt / 1.3008 m/s | 87.1473% / 8.1525 kt / 1.3003 m/s |
| Solo attempted autorotation landing: NR / speed / sink | 79.0567% / 5.4012 kt / 1.1720 m/s | 79.0826% / 5.3947 kt / 1.2277 m/s |

All 24 CG-corner trims still converge; maximum residual 8.755e−5. All 16 reported hover-ceiling samples are numerically unchanged. This includes the existing hot/gross optimism: 2500 lb / 40°C OGE is about 2693 ft against the traced 1000 ft chart point. The strict gross/solo autorotation landing expected failures remain: touchdown NR is below 90%, and gross peak NR is 109.4238%. These are not accepted landings merely because the damage model does not trigger.

## Verification and captures

Final checks:

- `npx tsc --noEmit`: clean, exit 0; `work/r44-integ/typecheck-last.log`.
- Focused instrument/input/shared-integration/R44 setup run: **21 files, 311 tests passed**, 47.10 s; `work/r44-integ/integration-tests-third.log`. The final full run below includes the subsequent lighting changes.
- `R44_TRACE=1 npx vitest run --maxWorkers=4`: **198 passed / 4 skipped files; 2762 passed, 4 expected failures, 221 skipped tests; 351.99 s**, exit 0; `work/r44-integ/full-suite-last.log`. This includes R44, R22, all instrument/aircraft/input/propulsion/resume suites and all airplanes. No unexpected failures. The four expected failures are the two existing R22 and two merged R44 autorotation landings; their thresholds/expected-failure status were not changed.
- `git diff --check`: clean. All 50 changed paths are enumerated above. No commit, push, branch change, chooser enablement or placeholder removal.

Baseline/final comparison JSON is under ignored `work/r44-integ/`; final acceptance traces are `work/r44-fm/performance.json` and `work/r44-fm/flights.json`. Maximum change across both sampled power curves is **0.002812 hp**.

All the following PNGs were opened and visually inspected. Exterior captures use the production development viewer, with `freeze=1`, FOV 40° (tail 35°). Simulator captures use the production app, `resume=0`, low quality, render scale 1, clear weather. They run in headless Chrome/ANGLE llvmpipe; GPU readback performance warnings are expected, and no application errors were reported.

| Capture under `work/r44-integ/` | Size | Finding |
| --- | --- | --- |
| `side.png` | 1600×1000 | Detailed R44 body, doors, rotor hardware and skid fairings selected by the normal viewer. |
| `rear.png` | 1600×1000 | Stabiliser/fin/tailcone relationship and tail assembly. |
| `tail-first.png` | 1600×1000 | Corrected surface attached below the cone; guard starts at the stabiliser. |
| `runway-checked-final.png` | 1600×1000 | Final enclosure/rim and pointer checks; 2705 engine RPM, 406.036 rotor RPM, ground speed 0, no damage. |
| `cruise-checked-final.png` | 1600×1000 | Panel/enclosure alignment in flight; 99.9 KIAS, 2705 engine RPM, 405.991 rotor RPM, no damage. |
| `night-colour-final.png` | 1600×1000 | 22:00, NAV on, LAND off, panel dimmer 0.10, normal cockpit glance/zoom. 2705/406.045 engine/rotor RPM. Dial colours survive dimming; face/placards remain unlit. |
| `panel-final.png` | 1200×1950 | Full 1152×1872 R44 canvas, markings, labels, controls and placards. |
| `r22-panel.png` | 900×1500 | Existing R22 solid ASI radial, tach arcs/radials and instrument layout retained. |
| `r22-cockpit-final.png` | 1600×1000 | Shared rim correction on the R22, with its existing panel and controls. |
| `c152-side.png` | 1600×1000 | Unmodified airplane comparison at the same side preset/FOV as R44. |

`runway-check-final.log` records the final pointer/UV/circuit checks. `cruise-check-final.log` also records the in-flight pointer check (before the final dimmer shader precision fix). `night-colour-final.log` records the final night renderer smoke check. Earlier `night*.png` files are diagnostic iterations, not the accepted night capture.

The real camera/raycast check covers 17 hotspot centres. Worst UV round-trip error is 0.000751 canvas pixels. Initially the NAV centre was obscured by the Catmull-Rom enclosure rim; the local-corner construction eliminates that obstruction. Actual pointer clicks changed all seven switches tested (NAV, STROBE, LAND, AVIONICS, ALT, BAT, CLUTCH) and restored them; key hold/release enabled and released PRIME without cranking. NAV-off extinguishes dial emission while preserving warning-lamp and radio emission. The dimmer-zero check independently verifies that dials/displays extinguish while warning lamps remain live.

The 1152×1872 canvas still maps to the frozen 0.48×0.78 m enclosure, at the original eye/face/rake. Full-view instruments are small on a 1600×1000 display; normal cockpit zoom is needed for the small placard tables. No geometry was enlarged to conceal that limitation. The single-plane shelf/pedestal, coupled PANEL/RADIO dimmer control, unlit placards/no flood-light model and approximate light photometry remain limitations.

Other existing gaps remain as documented in the flight-model report: exact closed-throttle/hot starting, cooling-fan shaft power, hydraulic failures/forces, ASI position-error calibration, measured inertias and aerodynamic/hover validation. Several annunciators remain lamp-test-only. No performance/release acceptance is claimed by this integration.
