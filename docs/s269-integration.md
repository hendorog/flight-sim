# 300CB shared integration — s269/integ

This is a **partial integration, not flight-model acceptance**. The hidden chooser/placeholder flags remain. The detailed exterior, concentric tach, guarded clutch, spring trim and warning circuits are connected. Production lead-lag/body coupling and the optimistic warm-weather hover ceiling remain unresolved. This record supersedes the pending shared-integration requests in the three worker reports; their source limitations still apply.

## Connected behavior

- `AircraftVisual.ts` selects the detailed 269 assembly. `RotorcraftState.articulated.blades` supplies flap, lag and pitch in blade order, with blade zero body-right at zero azimuth. Flap and pitch derive from the production harmonic solver and cyclic command. **Lag is zero**, not an independent animation. Blur tilt and individual blades now use the same sign convention. The preview fallback has the same harmonic convention but retains its estimated droop/coning presentation.
- `panelDef.ts`, `panel.ts` and `panelParts.ts` provide a custom round-component factory so the worker's `S269AbsoluteTach` occupies one normal recessed instrument. The engine and rotor remain independent absolute-RPM indications. The optional distributed-switch repaint region prevents switches from erasing the mixture, warning lenses or clutch controls.
- The guarded three-position clutch writes `rotorClutchCommand` to the flight model's existing ENGAGE/HOLD/RELEASE API. HOLD retains partial belt tension. With the guard open, Insert cycles positions; direct panel clicks select them. Closing the guard selects/retains ENGAGE (RFM 4-16). Clutch movement uses actual bus voltage; the legacy boolean/master-battery path is unchanged. `clutchLight` still means actuator movement. `clutchDisengaged` is a separate estimated engagement-limit switch.
- Electric spring trim moves normalized pitch/roll spring anchors; forces act on the stick, never as an aerodynamic trim moment. Keyboard neutral follows the moving anchors. Home/End command pitch; 6/7 or the panel buttons command roll. Momentary panel actions use the existing input hold/release path. Absolute-position mouse/hardware commands still hold their position; there is no physical force feedback. Motor rate 0.04/s and full-deflection spring force 40 N are **estimates**. The two panel buttons approximate the real lateral rocker.
- Separate main-transmission pressure/temperature and tail-chip signals feed the lamps. The transmission pump follows rotor RPM, including engine-out rotation. Thresholds are RFM 3-3/7-17: 2.5 psi and 235°F. Pump map, thermal capacity/cooling and voltage thresholds are **estimates**; the thermal model deposits estimated drivetrain loss into a lumped oil temperature. The chip detector is a persistent sensor bit, with no automatic wear/failure generator. The hourmeter follows powered transmission oil pressure. Each lens has its own powered test; the simulator all-lamp test remains.
- Snapshot capture deep-copies blades, transmission and spring trim. Resume validates the optional state, migrates old 269 boolean clutch saves, and releases momentary trim/lamp-test commands. No existing Robinson system field was reinterpreted.

## Tail geometry and contact

RFM CSP-C1-1 1-9/1-10 and Fig 1-1 (printed 1-12), cross-checked against Andrew Borrows' [300CB side photograph](https://commons.wikimedia.org/wiki/File:Schweitzer_300CB_Side_View.jpg), show the small fin **below** the boom and the guard immediately below the tail disc. The former scaffold placed the fin above the boom and extended the guard nearly to the ground.

`dimensions.ts` now supplies a shorter guard, the below-boom fin, and the right-hand stabilizer polygon with 35° dihedral and 9.8° incidence. Published radii, chords, spans and aft envelope are retained. Guard bend/radius/attachment, fin sweep/attachment, and the positive sign/surface-plane interpretation of incidence remain explicit **estimates**; the RFM gives the incidence magnitude without its sign/axis convention. The optional canted-surface path resolves both vertical and lateral force at the same quarter-chord/half-span centre used by the render geometry. Legacy horizontal stabilizers retain their original arithmetic.

Cold solo, half fuel, level ground, 240 Hz, five seconds, changing **only the guard geometry**:

| Quantity | Original guard | Corrected guard |
| --- | ---: | ---: |
| Initial clearance | 2.838 mm | 594.412 mm |
| Minimum clearance | −0.202 mm | 590.874 mm |
| Final clearance | 0.314 mm | 591.884 mm |
| Final pitch | 0.772804° | 0.772808° |
| Latched tail contact | stinger-touch | none |

Thus this was a guard-geometry problem, not evidence requiring a new parked attitude or stiffer gear. The separate production cold-start test now also requires no tail contact and uses the actual command field instead of monkey-patching `drive()`.

## Powered approach RPM

The scripted pilot held its 2650-RPM target while lowering collective after touchdown. Its slow feedback briefly overshot when rotor load fell. It now rolls the throttle toward the 1500-RPM ground target after touchdown while lowering collective. Production engine, correlator, rotor inertia, limits and manual-throttle behavior were not changed to suppress overspeed.

| Gross-weight approach | Engine peak | Rotor peak |
| --- | ---: | ---: |
| Original merged baseline (1 Hz trace) | 2711.179 RPM | 472.950 RPM |
| Old pilot, corrected geometry (every 240 Hz step) | 2711.598 RPM | 473.023 RPM |
| Corrected pilot, corrected geometry (every step) | 2688.731 RPM | 469.034 RPM |
| Published powered upper limit | 2700 RPM | 471 RPM |

The corrected gross touchdown is at 117.996 s, 0.06799 kt and 0.05867 m/s sink. Solo peaks are 2657.431/463.574 RPM, with touchdown at 117.642 s, 0.05680 kt and 0.04704 m/s sink. Both remain uncrashed through shutdown. Assertions now cover every physics-step peak, not just the 1 Hz report. These are scripted scenarios, not a validation of all manual approaches.

## Hover ceiling remains unacceptable

The RFM full-rich and leaned charts use 2700 RPM, full throttle, carb heat off and two-foot skid height. Chart readings retain approximately ±200 ft digitization uncertainty. The test finds a shaft-power-balance root in 46.875-ft altitude bins; it does **not** assert chart agreement.

| Weight | OAT | Mixture | RFM IGE ft | Before ft | After ft |
| --- | --- | --- | ---: | ---: | ---: |
| 1750 lb | 0°F | rich | 6300 | 5883 | 5930 |
| 1750 lb | 0°F | leaned | 6800 | 6445 | 6445 |
| 1750 lb | 40°F | rich | 4100 | 4570 | 4570 |
| 1750 lb | 40°F | leaned | 4500 | 5180 | 5227 |
| 1750 lb | 80°F | rich | 1900 | 3305 | 3305 |
| 1750 lb | 80°F | leaned | 2500 | 4055 | 4102 |
| 1600 lb | 0°F | rich | 8000 | 7758 | 7758 |
| 1600 lb | 0°F | leaned | 8600 | 8555 | 8602 |
| 1600 lb | 40°F | rich | 5800 | 6398 | 6445 |
| 1600 lb | 40°F | leaned | 6300 | 7336 | 7383 |
| 1600 lb | 80°F | rich | 3500 | 5133 | 5133 |
| 1600 lb | 80°F | leaned | 4300 | 6258 | 6305 |

Worst optimism is **+1957.8 ft before, +2004.7 ft after**. The small change follows the corrected tail forces; it is not a ceiling fix. At the full-rich 1750-lb chart points, modeled demand is approximately 149 hp at all three temperatures, while available power rises from 145.95 to 152.86 to 160.54 hp. This isolates a strong temperature/density-contour mismatch, but does not prove which installed-model term is wrong. The generic induction model's square-root temperature dependence is supported by the actual HO-360-C1A [Lycoming 60297-12 Fig 3-42, printed 3-56](https://www.lycoming.com/sites/default/files/file/2025-11/60297-12%20-%20O-360%2C%20HO-360%2C%20IO-360%2C%20AIO-360%2C%20HIO-360%2C%20and%20TIO-360%20Series.pdf), which specifies a square-root absolute-temperature correction at fixed manifold pressure. Removing that dependence solely to fit the helicopter chart is unjustified.

Installed fan/cooling demand, intake conditions, full-rich altitude metering and actual rotor polars/wake still need evidence. No engine-temperature multiplier, induced-loss coefficient or chart-error allowance was fitted. OGE predictions remain unvalidated.

## Rejected lag/body experiment

A reduced cyclic-lag experiment solved the six body, shaft and two cyclic-lag accelerations together through a symmetric mass matrix at each RK stage. It included reciprocal hub/shaft work and positive damper dissipation, rather than feeding a decorative oscillator into the airframe. Planar free-hub energy/momentum and 240/480/960-Hz convergence tests passed; all six exact R22/R44 digest tests also passed.

In the assembled aircraft, however, healthy startup and shutdown developed growing ground oscillations with the inherited scalar skid model. The existing whole-aircraft energy audit failed by approximately **835–1255 W**, against its unchanged 10 W allowance. That audit does not include the proposed extra lag/cross-energy store, so this residual is a failure to demonstrate acceptance closure, not a measurement of entirely created energy. A complete extended audit was not achieved. Free-hub success was insufficient: the planar reduction omitted full attitude-dependent blade inertia/flap-lag interactions, and no measured 300CB oleo/damper map is available. The experiment was removed from production, not stabilized by arbitrary damping. Its code, tests and failing traces remain only in ignored `work/integ/rejected-lag/` for review.

**No production lead-lag/body coupling or ground resonance is claimed.** The existing standalone lag unit remains as it was; rendered lag is explicitly zero. A sound continuation needs a consistent full body/blade kinetic model and a ground-support model checked in healthy/degraded startup, shutdown and one-skid impacts. Missing degraded-damper/oleo measurements prevent a validated real resonance boundary.

## Verification and ownership

Logs, source images, numeric traces and screenshots live in ignored `work/integ/`. Final verification:

- `npx tsc --noEmit`: clean (`typecheck-final.log`). `git diff --check`: clean.
- Aircraft/instruments/input/rotorcraft area run: 68 files, 804 passes, six existing expected failures, three input-binding failures. Those failures caught an introduced Numpad view-key collision; it was removed without changing the existing key map or old tests. The subsequent input/systems rerun passed all 170 tests in nine files (`area-tests.log`, `input-final.log`).
- `npx vitest run --maxWorkers=4`: 393.93 s, **208 files passed / one failed / four skipped; 2835 tests passed / one failed / six expected failures / 221 skipped** (`full-suite.log`). The sole failure was the fixed-wing CPU-cost ratio: taxi/calm 2.507 against 2.4. No functional failure or timeout occurred.
- `npx vitest run tests/fdm/robustness.test.ts --maxWorkers=1`: **16/16 passed**, 22.20 s (`robustness-alone.log`). The timing failure did not reproduce in isolation; no performance threshold or aircraft expectation was changed.
- The six existing expected failures are the paired R22, R44 and 269 autorotation-landing gaps; none was removed or newly marked expected-failing here.

The exact legacy check passes in the full run: R22 and R44 at three operating conditions each, 960 evaluations per case (5760 total), hashing loads, published rotor state, angular momentum and power diagnostics without loosening expectations. No R22/R44 or airplane definition/test was edited. The corrected production cold-start sequence fires at 2.217 s, reaches full clutch engagement at 74.958 s after five HOLD intervals, and starts its hover phase at 124.962 s with no tail contact.

File map for review (paths relative to the repository):

| Files | Change |
| --- | --- |
| `src/render/aircraft/AircraftVisual.ts`; `src/aircraft/s269/exteriorRotor.ts` | Detailed assembly, published blade pose, consistent exposure-disc/fallback sign |
| `src/aircraft/s269/dimensions.ts`, `rotorcraft.ts`; `src/physics/rotorcraft/airframe.ts` | Shared corrected tail geometry and optional canted surface forces; estimated 269 systems parameters |
| `src/core/types.ts`; `src/physics/rotorcraft/definition.ts`, `rotorcraft.ts`; `src/physics/flightModel.ts` | Optional controls/state, blade publication, powered actuators, independent sensors and deep snapshot capture |
| `src/input/rotorcraftControls.ts`, `InputSystem.ts`, `bindings.ts`, `profile.ts`; `src/aircraft/s269/input.ts` | Guard semantics, installation-gated controls, spring-centred keyboard, hold/release actions; existing key map preserved |
| `src/instruments/panelDef.ts`, `panel.ts`, `panelParts.ts`, `hotspots.ts`; `render/panelControls.ts`, `render/controls.ts`; `dynamics/instrumentSet.ts`; `src/aircraft/s269/panel.ts` | Tach factory, clutch control, trim buttons, lens tests, hourmeter, redraw isolation |
| `src/sim/SimPhysics.ts`, `resume.ts` | Initial commands, legacy saves, nested-state validation and momentary release |
| `src/aircraft/s269/index.ts`, `ui.ts` | Current controls and limitations; chooser/placeholder restrictions retained |
| `tests/aircraft/s269Exterior.test.ts`, `s269Setup.test.ts`; `tests/instruments/s269Panel.test.ts`; `tests/rotorcraft/s269Systems.test.ts`, `s269Flights.test.ts` | Pose alignment, assembly, repaint/control/system/resume checks and per-step RPM peaks with corrected pilot |
| `docs/s269-integration.md`, `s269-flight-model.md`, `s269-exterior.md`, `s269-panel.md` | Integration evidence and links distinguishing original worker handoffs from current behavior |

Viewed screenshots: `side.png`, `rear.png`, `rotor.png`, `tail.png` (1280×800); `panel.png` (1000×1180, zero layout warnings); `cockpit-runway-low.png`, `cockpit-cruise.png`, `cockpit-night.png`, `cockpit-night-dimmed.png` (1000×625), plus matching `c152-side.png` and `da20-side.png` comparisons. All are under `work/integ/`. Night checks include full light output and 35% panel dimmer with landing light off. Main-scene screenshots used low quality on software Vulkan; the first default-high runway attempt timed out before producing a capture. This is not a claim of high-quality GPU validation.

Additional 269 files beyond the specifically named geometry/reference/presentation ownership were necessary to connect the workers' interfaces: `exteriorRotor.ts` (pose convention), `panel.ts` (components/controls/signals), `rotorcraft.ts` (canted tail and optional systems data), `input.ts` (installation capabilities), and `ui.ts`/`index.ts` (remove stale claims that integrated controls are absent, retaining placeholder/limitations). Tests and this repository documentation were also updated. No chooser registration or placeholder flag changed; all changes are left uncommitted.
