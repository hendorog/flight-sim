# Schweizer 269C-1 / 300CB panel handoff

Shared-integration follow-up: [s269-integration.md](s269-integration.md) records the now-connected concentric tach, guarded clutch, spring trim and independent warning circuits. The unavailable-feature statements below describe the original worker handoff, not the integrated build.

This is an **incomplete panel integration**, left behind the existing development/chooser restrictions. The canvas and supported controls run on the current base. A source-based concentric absolute-RPM tachometer is implemented and tested in `panelTach.ts`, but the supervisor-owned instrument factory cannot select it yet. The production panel therefore shows two separate absolute-RPM dials. Clutch HOLD, spring trim and several warning sensors remain unavailable; no guided cold-start or flight-training acceptance is claimed.

## Installation and sources

Selected installation: **carburetted 300CB, S/N 0106–0138, HO-360-C1A, two seats, right PIC, one 33 US gal tank / 32.5 usable, no STAR**. The layout follows the alternate carburetted **Figure 4-2A, page 4-10.1**, of CSP-C1-1, reissued 16 January 2019. It does not use the fuel-injected 300CBi panel. Optional VSI and COM/NAV/transponder artwork occupies vacant space in the figure; those particular avionics and the added VSI location are simulator installation choices, not a documented individual aircraft fit. No attitude/heading gyros are fitted to this selected canvas.

Primary reference: [manufacturer RFM CSP-C1-1](https://cdn.shopify.com/s/files/1/1008/9286/8689/files/Flight-Manual-269C-1-300CB-CBi-CSP-C1-1.pdf?v=1772539456), cached with extracted text in `work/s269-sources/`. See [the common source record](s269-sources.md) for hashes, source conflicts and serial-number applicability. The cached RFM was read and its panel and instrument figures viewed. This is a simulator implementation from the recorded revision, not a current operational publication set.

The face remains the frozen `PANEL_CANVAS` / `PANEL_OUTLINE` from `dimensions.ts`: **1152 × 1440 px, 2400 px/m, 0.48 × 0.60 m, 12° rake**. No dimensions were copied or corrected. Round instruments are scaled to 3⅛-inch and 2¼-inch nominal case diameters; layout positions, panel colour, fonts, dial angular spacing and illumination response are estimates. The shared bezel/needle artwork matches the airplane/R22 instrument system.

## Markings

`panelMarkings.ts` supplies the aircraft's own scales. There are no R22 panel imports, Robinson MAP placards, governor controls, hydraulic controls, auxiliary tank gauge, injected-engine fuel-pressure gauge or STAR low-RPM warning.

| Instrument | Published markings / reference |
|---|---|
| ASI | Red radial 94 KIAS; RFM Figure 2-3 sheet 3, p2-10. No invented airplane flap arc or Robinson coloured speed bands. KIAS only; the figure's secondary MPH scale is omitted. |
| Engine tach | Green 1200–1600 and 2530–2700 RPM; red flight boundaries 2530/2700. Red triangle at 1600 for rotors disengaged. Figure 2-3 sheet 4, p2-11. |
| Rotor tach | Green 390–504 RPM, red boundaries 390/504. Powered 442–471 RPM identified separately; the full green dial range is not the powered operating range. |
| MAP | 5–35 inHg artwork from Figure 4-2A; no unsupported MAP power-limit bands. |
| Fuel | 0, 10, 20, 32.5 usable US gal, single standard tank. Figure 2-3 sheet 2, p2-9. |
| CHT | Green 230–450°F, yellow 450–500°F, red 500°F. |
| Oil pressure | Lower red line 55 psi, green 55–95, upper red line 115. The 25-psi startup minimum on p4-14 is **not** the dial's lower red line. |
| Oil temperature | Green 100–245°F, red 245°F. |
| Ammeter | Centre-zero −70/+70 A, visible in Figure 2-3 sheet 1, p2-8. Reads shared battery current. |
| Carburettor temperature | Yellow −15 to +5°C; signed numbers. Figure 2-3 sheet 3, p2-10. |

FAA 4H12 lists 2534 RPM as engine minimum whereas the selected RFM explicitly prints 2530 on the tachometer. This panel uses the RFM marking and preserves the unresolved source conflict. `reference.ts`'s 2700/471 values only convert the shared percent transport back to absolute shaft speeds; neither is presented as a Schweizer percent indication or governor reference.

`panelPlacards.ts` reads `S269_VNE` from flight-owned `limits.ts`, retains all **42 original table cells** and original pressure-altitude columns 0/4/6/8/10/12 thousand feet, and omits the solver's interpolated 2000-ft column. Rows remain 0–120°F in 20°F steps; zero/no-flight cells print as dashes. The 90-KIAS doors-off cap, powered RPM range, disengaged 1600-RPM maximum, 600-lb cabin limit, right-seat solo, VFR and RFM operating-limit placards are also present. A dynamic VNE HUD value reads the shared solver's result, including NO FLIGHT/exceeded; the panel does not implement its own flight-limit calculation.

## Systems and control bindings

All electrical indications use the shared 28-V aircraft bus. **18 V** for a dead bus and **24.5 V** for LOW VOLTAGE are estimated thresholds, with no hysteresis. No Robinson clutch-switch battery bypass is assumed for the Schweizer tach. Separate engine/rotor signals retain the existing 0.12-second electrical-tach lag; bus loss sends both to zero. MAP and pitot/static instruments remain direct-reading.

| Lens | Colour and implemented behaviour |
|---|---|
| LOW VOLTAGE | Amber; live bus below estimated 24.5 V. |
| FUEL LOW | Amber; approximately one usable gallon in the single main tank (RFM 3-3), using undamped fuel quantity rather than the lagging needle. |
| M/R XMSN TEMP/PRESS | Red; **test-only**. RFM thresholds are below 2½ psi or above 235°F, but main transmission sensor state is absent. Engine oil is not a substitute. |
| T/R XMSN CHIPS | Amber; **test-only**. No chip-detector state exists. |
| CLUTCH DISENGAGED | Red; **test-only**. Needs its own limit-switch signal. Existing `clutchLight` means actuator moving, not clutch disengaged. It is deliberately not rebound. |

Colours/order are from RFM Figure 3-1, p3-5.1. The optional M/R chip detector is not installed. The simulator LAMP TEST button lights all five lenses only with bus power; the RFM instead specifies individual press-to-test fuel/chip lenses. The shared renderer's small lenses/legends need zoom for reading. An unlit test-only warning is **not evidence of a healthy system**, especially in a cold-start scenario.

Carb temperature is an explicit approximation: OAT −20°C plus up to 45°C heat rise while running. It is not a simulated probe or calibration, and it rests below the scale with a dead bus. Fuel, oil and CHT retain shared electrical needle dynamics. The hourmeter currently records engine-running time; the selected real standard hourmeter instead operates from main-transmission oil pressure (RFM 7-17). The shared COM/NAV and transponder displays work, but radio frequency/code tuning is not exposed by this panel's hotspot contract.

Battery and alternator switches operate independently. Position, beacon, landing and radio switches use their existing controls. Panel lighting toggles the existing dimmer value; the two generic PANEL/RADIO knobs both bind that one dimmer, so they are not independent circuits. Mixture and carb-heat knobs are proportional. Fuel shutoff is two-position: a single pull-direction detent selects OFF, a push detent selects ON, and further movement at an endpoint leaves it there. The ignition uses the shared OFF/R/L/BOTH/held-START artwork and existing starter action; exact Schweizer key/starter hardware still needs a component extension. No injected-engine PRIME is added.

The real lateral TRIM location is marked **INOP**, without silently changing airplane trim or cyclic. The real longitudinal trim lives on the cyclic. CLUTCH* remains an explicitly labelled ENGAGE/RELEASE simulator stand-in; it has no HOLD or functioning physical guard. Its toast reports command position, and the HUD BELT bar reports actual `clutchEngagement` and actuator movement separately. `ui.ts` is independent of R22 UI, including `starterAdvice`; the startup card gives supported-control references and the limitation, not a purported starting sequence. `training.ts` preserves empty checklists, disabled syllabus and placeholder identity, and removes the unsupported 52-KIAS approach-speed claim (52 is the autorotation reference).

## Required supervisor integrations

No shared or other worker-owned files were edited.

1. **Absolute dual tach.** Add a generic independent-absolute-RPM dual tach kind/factory to `GaugeDef`, `buildGauge`, `gaugeRecess` and `panelParts` (or an explicit component factory hook). `panelTach.ts` exports `S269AbsoluteTach`, a standard `RoundGauge` with cached artwork, independent needle latches and a normal dial light mask. Construct at native 172-px bezel / 74-px aperture, then use existing `ScaledGauge` with `S269_PANEL.instrumentScale.large`. Replace the two fallback `single` entries with one instrument at **[180, 495]**. The local component includes concentric RPM ×100 scales, independent arcs/red lines and the 1600-RPM triangle; needles superimpose at matched shaft speed and split when freewheeling. Production fallbacks lack the triangle (text placard supplies the numerical limit). The local class is exercised in tests and a clearly labelled standalone preview, **not installed by hidden prototype mutation or a side effect**.
2. **Three-position clutch and true warning.** Agree an ENGAGE/HOLD/RELEASE input plus guard, add shared input/hotspot/render support and carry it through solver, presets, snapshots and reset. Preserve boolean `rotorClutch` compatibility and the existing meanings of `clutchEngagement`/`clutchLight`. Add a separate agreed clutch-disengaged indication. Only then replace CLUTCH* and validate the RFM 4-15/4-16 engagement sequence with the flight worker.
3. **Electric spring trim.** Agree longitudinal/lateral trim commands and powered actuator/force state. Add a momentary left/right switch for the console and the cyclic control with the exterior worker. An inactive bushing cannot stand in for a functional trim system.
4. **Transmission sensors / lamp tests / hourmeter.** Add independent main-transmission oil pressure/temperature and tail-chip states, individual press-to-test lens controls, and an hourmeter trigger. No failure is inferred from engine oil or RPM. The current all-lens test remains a stated simulator convenience.
5. **Remaining instrument/control artwork.** A three-sector engine-gauge case would put oil pressure/temperature/amps together as in the RFM; today the ammeter has a separate round case. Rectangular engine-gauge typography, carb-heat slider, guarded clutch lever, trim switch, individual post lights and switch/circuit-breaker hardware require improved components. Circuit breakers and hot mic are omitted rather than given fabricated control/sensor effects. A surveyed layout and part-level instrument/electrical data would improve the present estimates.

These gaps prevent a claim of exact panel reproduction or cold-start/cockpit acceptance. Do not enable the chooser or remove placeholder flags based on this branch.

## Verification

Recorded commands, outcomes and screenshot review are in the final handoff section below. All scratch pages, source renders, logs and PNGs are under ignored `work/`; none should be committed.

The focused checks passed: `npx tsc --noEmit` (empty error log, `work/s269-panel-typecheck.log`), 11 new cases in `npx vitest run tests/instruments/s269Panel.test.ts --maxWorkers=4` (`work/s269-panel-tests.log`), and the four existing `s269Setup` cases. Coverage includes the frozen face/physical dial scale, complete Vne table, placard/redraw separation, absolute RPM and freewheel needle split, bus loss, main-tank warning, independent controls and the disabled training/startup contract. `git diff --check` is clean.

Viewed evidence includes `work/s269-sources/panel-4-10.png`, `panel-4-10-1.png`, all four `work/s269-markings-054.png` through `057.png`, and:

- `work/s269-panel-first.png` and `work/s269-panel-final.png`: production canvas at 0.8×, 1100×1180 capture. The final layout reports **zero warnings**. The first screenshot revealed dial-title/tick crowding; fallback dial sweeps were adjusted to put titles in the clear lower area. A test also caught a clutch placard inside the switch redraw rectangle, which was moved clear. The frozen panel update measured approximately **0.0091 ms**, not an in-flight performance benchmark.
- `work/s269-tach-prototype.png`: standalone, explicitly unintegrated coaxial component. Coupled **2650 / 462.3 RPM**, freewheel split **1500 / 450 RPM**, and unpowered **0 / 0 RPM**. This is not a production-panel screenshot.
- `work/s269-compare-r22-panel.png`, `work/s269-compare-c152-panel.png`, `work/s269-compare-da20-panel.png`: existing native components and panel finish compared visually; airplane canvases are wider and captured at 0.75×, R22 at 0.7× to fit its taller face.
- `work/s269-panel-cockpit.png`: initial dev cockpit, **not instrument evidence**, because this page normally has an untextured face. `work/s269-panel-cockpit-mapped.png` applies the actual panel through scratch-only `work/s269-cockpit-eval.js`; `work/s269-compare-r22-cockpit.png` uses the same method/view at 1600×900. Flight-dial sizes are comparable, the panel lies within the console and the visible 3D pull controls agree with the canvas. Fine warning/switch labels and placards are not reliably readable at the default seated view; zoom is needed. The dim dev harness is not a real night-lighting test.
- `work/s269-compare-c152-cockpit-focused.png` and `work/s269-compare-da20-cockpit-focused.png`: viewed 1600×900 cockpit comparisons with the actual aircraft panel textures applied, both captures exit 0 and report zero layout warnings. The dev harness remains dim and the C152 forward view crops the lower panel, so these establish placement/relative dial size only; the native-panel captures above provide the clearer artwork comparison. The earlier uncorrected C152/DA20 cockpit captures are superseded by these.
- `work/s269-panel-runway.png`: exact `index.html?aircraft=s269&scenario=runway&resume=0`, 1600×900. Sampled **2649.96 engine / 462.27 rotor RPM**, `onGround=true`, `crashed=false`. The page rendered the real panel, but did **not** meet the script's default readiness timeout; this attempt is not a clean smoke-test pass. The detected renderer is ANGLE/Mesa **llvmpipe**, with ReadPixels performance warnings.

The first full-suite attempt (`work/s269-panel-full-suite.log`) was terminated with exit **143**, before any test summary or assertion failure was reported. The completed retry, `npx vitest run --maxWorkers=4`, took **850.97 s** (`work/s269-panel-full-suite-retry.log`): **2780 passed, 1 failed, 4 expected failures, 221 skipped**, across **199 passed / 1 failed / 4 skipped files**. The sole failure was the existing R22 six-degree grass-slope parking case in `tests/rotorcraft/skids.test.ts:109`, which exceeded its **5000-ms timeout**; no numerical assertion failure was reported. No physics or R22 files were changed. Software-rendered screenshot work overlapped this run, so resource contention is plausible, not proven.

With that workload finished, `npx vitest run tests/rotorcraft/skids.test.ts tests/instruments/s269Panel.test.ts tests/aircraft/s269Setup.test.ts --maxWorkers=4` passed **25/25 tests in 9.91 s**, including the R22 timeout case, at the unchanged default timeout (`work/s269-panel-final-focused.log`). The full run is still reported as having one timeout, not as clean. A final `npx tsc --noEmit` also passed. Expected autorotation failures and placeholder restrictions were left intact.

The lower-resolution runway retry also failed its automation timing: after the readiness wait expired, its evaluation observed `ready=true`, **2649.44 / 462.18 RPM**, `onGround=true`, `crashed=false` and **no captured application errors**, but the subsequent screenshot exceeded **30 s** and produced no retry PNG (`work/s269-panel-runway-retry.log`). The original runway PNG supplies visual evidence; neither attempt establishes a clean timed smoke-test pass on this llvmpipe environment.

`work/s269-panel-emissive.png` is the raw emissive/alpha-tag diagnostic with `lamps=1`, not a photograph of a night cockpit. It shows all five source-coloured lenses and the separate dial/display illumination areas. The checker unit tests, rather than this forced-on fixture, establish bus loss and sensor-binding behaviour.
