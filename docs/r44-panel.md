# R44 Raven II instrument panel

This is the original panel worker report. The later [shared integration report](r44-integration.md) supersedes its renderer/LOW RPM/PRIME/pump gaps and records merged cockpit verification; remaining equipment approximations still apply.

Panel branch acceptance work, 9 October 2026. The aircraft remains a **placeholder**. This change provides an R44-specific analog console, instrument bindings and simulator control guidance; it does not validate the flight model or publish a cold-start checklist.

## Installation and geometry

The chosen installation is the eight-hole analog VFR console with individual warning lenses, optional electric attitude and directional gyros in the second column, and one blank optional hole at lower left. It follows the arrangement in POH 7-21, not the ten-hole IFR trainer or the Garmin/Aspen panels. The ASI uses a KIAS-only scale without the secondary km/h ring. The gyros use the generic simulator faces and dynamics; no particular manufacturer's instrument response is claimed. The manufacturer eight-hole photograph shows the same basic pod/pedestal but a different optional-equipment fit and segmented annunciator. HYD/EMU segments belong to that latter installation and are not fitted here.

All geometry comes from `dimensions.ts`: 1152 × 1872 pixels, 2400 px/m, 0.48 × 0.78 m, the existing outline and 15° face rake. No geometry value was changed. Complete large/small gauge cases retain 3⅛ / 2¼ inch nominal diameters. Layout positions are estimates from the drawings and photographs, not surveyed panel coordinates.

| Area | Arrangement |
| --- | --- |
| Upper row | VSI, optional electric attitude, ASI, dual engine/rotor tachometer |
| Lower row | Blank, optional electric heading, altimeter, MAP |
| Brow/right edge | Fourteen warning lenses; FULL THROTTLE and BRAKE on right edge |
| Lower pod | Clock/OAT at left; RPM/speed/operating placards; clutch switch and ignition at right |
| Engine shelf | AMPS/OIL PSI, AUX GAL/OIL °F, MAIN GAL/CHT °F; dimmers and light test at left |
| Pedestal | NAV, STROBE, LAND, AVIONICS, ALT, BAT; guarded mixture; NAV/COM and transponder; limit tables; cabin heat/hourmeter |

The real engine shelf changes rake. The frozen single-face UV contract flattens that shelf into the pedestal. The optional pilot-side accessory console is absent. Cabin heat and the simulator hourmeter occupy the pedestal foot to make the complete POH limit tables accessible. The generic clock supplies OAT; the separate Davtron OAT/voltmeter is omitted, with bus voltage available on the HUD. The clock's LCD, switch rockers, rectangular engine gauges and radio faces are simulator artwork rather than exact part reproductions.

## Published markings and placards

Markings are in `panelMarkings.ts`; limits-table artwork is in `panelPlacards.ts`. Values are from the Raven II POH, not the R22. `reference.ts` supplies RPM and fuel references; the tables import `R44_MAP` and `R44_VNE` directly from flight-model-owned `limits.ts`.

| Instrument | Markings/reference |
| --- | --- |
| ASI | Green 0–110 KIAS, yellow 110–130, power-off cross-hatch location 100, red line 130 |
| Engine tach | Green 101–102%; red boundaries at 101 and 102; 100% = 2665 RPM |
| Rotor tach | Green 90–108%; red boundaries 90 and 108; 100% = 400 RPM; adjacent placard identifies powered 101–102% |
| MAP | Green 15–23.3 inHg, yellow 19.1–26.1, red line 26.1; altitude/OAT maximum-continuous table, takeoff +2.8 inHg for 5 minutes |
| Oil pressure | Red 25/115 psi; yellow 25–55/95–115; green 55–95 |
| Oil temperature | Green 75–245°F; red 245°F |
| CHT | Green 200–500°F; red 500°F |
| Fuel | Main 29.5 / auxiliary 17.0 US gallons usable, bladder installation; independently read and labelled |

The Vne table shows the ≤2200 lb takeoff-weight grid, full altitude/OAT columns, no-flight cells, and the POH instructions to subtract 10 KIAS over 2200 lb TOGW and 30 KIAS for autorotation. Additional placards give 100 KIAS maximum above maximum continuous power or with any door removed; the 110 KIAS smooth-air caution; powered/unpowered RPM; day/night VFR, right-seat solo and no low-G pushovers. These are printed limitations, not proof that the placeholder flight model enforces every correction. No dynamic Vne readout is added while that shared limit calculation remains incomplete.

The placard columns have individual positions because the shared font is proportional. `FT` means full throttle; `NF` means no flight. Test coverage checks the printed table values, units, exceptions and all placard rectangles against the outline and moving components.

Three visual limitations require supervisor-owned renderer work:

1. `AirspeedGauge` has no cross-hatched radial. The 100 KIAS location uses three staggered red inner/outer arc fragments; this is an approximation, **not a faithful diagonal cross-hatch**. Extend `AsiMarkings`/its renderer with a dedicated cross-hatched marking.
2. `RotorTachGauge` exposes rotor radials only. Short red bands immediately outside 101–102% approximate the engine's red boundary strokes. Their 0.8% width is artwork, not a permitted range. Add independent engine red-line support; the native tach scale also cannot resolve the narrow green sector especially well.
3. `SingleGauge` ignores `ArcDef.inner`. Both published MAP ranges are retained in data, but the yellow arc paints over green from 19.1 to 23.3. Honour `inner` in the common single-dial renderer so both bands remain visible. The numerical MAP placard remains correct.

Dial angular spacing, ammeter full scale (±60 A), intermediate ticks and generic engine-gauge case proportions remain artwork estimates. Published colour-band boundaries have not been adjusted to make a test pass.

## Systems and controls

The individual-lens colours come from IPC 95.65, items B198-1/B198-2: ENGINE FIRE and OIL red; the other fourteen amber, including MR TEMP and BRAKE. A simulator LIGHT TEST button illuminates all sixteen lenses with a live bus. This convenience does not reproduce an original individual-lamp test circuit or the later segmented-annunciator timing.

| Indication | Binding and limitation |
| --- | --- |
| CLUTCH | `RotorcraftState.clutchLight`, actuator operation; never inferred from partial belt engagement |
| LOW RPM | `lowRpmHorn`, the frozen shared collective-dependent warning contract |
| GOV OFF | Governor switch position; an armed but inactive governor does not light it |
| STARTER ON | Starter control; no separate stuck-contactor feedback state |
| ALT / OIL | Bus below 24.5 V / undamped engine oil pressure below 25 psi; estimated switch thresholds, no hysteresis |
| LOW FUEL | Approximately 3 US gal in the main tank; undamped quantity, independent of the auxiliary gauge |
| FULL THROTTLE | Actual governor/linkage opening constrained by pilot throttle; 98% microswitch threshold estimate |
| MR TEMP, MR CHIP, TR CHIP, CO, BRAKE, ENGINE FIRE, FUEL FILTER, AUX FUEL PUMP | Test-only: the model has no independent sensor/actuator states |

Bus supply threshold is the existing estimated 18 V. Both percent tachometers retain the POH battery bypass when clutch ENGAGE is selected and battery charge remains, even with BAT/ALT off. Their needles split independently with engine/rotor speed. Fuel senders keep the shared electrical lag. The optional gyros use electric drive with no vacuum system; erection/coast-down behaviour is the generic gyro model, not measured R44 electric-gyro performance.

POH 7-25/7-26 describes the low-RPM light separately from collective muting of the horn. The frozen state contract combines them, so the light is also suppressed at collective full down. Separating the light and horn is a supervisor change. The later annunciator's two-second LOW FUEL and ten-second EMU self-test delays are not represented.

The real ignition key has PRIME and the starter is operated separately. The shared key component renders OFF/R/L/BOTH/START and cranks at spring-held START; that is explicitly a simulator substitute. No dummy PRIME, HYD or auxiliary-pump switch was introduced. The governor remains on the collective (Delete), not on the instrument face. Clutch operation uses Insert or the panel switch. BAT and ALT are independently clickable. The mixture guard blocks panel adjustment until lifted; keyboard M/Shift+M retains the existing guard bypass. Cabin heat stores control position without a thermal model. The generic hourmeter counts engine-running time; the real POH 7-18 unit is collective-activated. Both panel/radio dimmers currently operate the same shared lighting value.

The radio stack is powered/dimmed display artwork with generic NAV/COM frequencies and transponder data. The shared renderer fixes each unit at 320 pixels wide and has no tuning/button hotspots; panel bounds and rack were corrected to that actual width. Avionics power is clickable; radio frequency tuning is not. Physical radio width therefore remains an approximation at this face's pixel density. No GPS, intercom, ELT, pitot-heat control, friction mechanism, circuit-breaker simulation or high-RPM audio test is added.

## Startup, HUD and training

`ui.ts` describes supported controls and distinguishes governor OFF / ARMED / ACTIVE and clutch switch selection from actual belt travel/actuator movement. HUD values use 2665/400 RPM references, manifold pressure in inHg, bus volts and OAT °C; missing rotorcraft state falls back safely.

Cold-start validation is explicitly outstanding. The branch's engine/pump code does not implement the Raven II PRIME position and clutch-switched auxiliary-pump sequence. The startup card identifies the real sequence's missing capability, explains available control mappings, and directs inspection to the running runway start. It does not instruct users to substitute a carburetted start or claim that a rich-mixture generic start validates the POH. Flight-model agreement and acceptance are needed before replacing this card with executable startup steps.

`training.ts` retains placeholder identity, empty checklists and disabled Flight School. Its 90 KIAS maximum-glide and 60 KIAS initial-approach references are documented; inherited Vy 60 is explicitly unvalidated scaffold metadata. No flight lessons, chooser enablement, autorotation-landing tests or shared contract changes are included.

## Verification

- `npx tsc --noEmit`: clean; `work/r44-panel/typecheck.log`.
- `npx vitest run tests/instruments/r44Panel.test.ts --maxWorkers=4`: 14 passed; `work/r44-panel/tests-r44.log`.
- `npx vitest run tests/instruments tests/aircraft/r44Setup.test.ts --maxWorkers=4`: 138 passed in 12 files, 2.31 s; `work/r44-panel/tests-area.log`.
- `npx vitest run --maxWorkers=4`: **2718 passed, 2 expected failures, 221 skipped**, across 192 passed / 4 skipped files, **460.91 s**; `work/r44-panel/full-suite.log`. The expected failures are the unchanged R22 autorotation landings. No ordinary failures or new regressions.
- `git diff --check`: clean. The final placeholder-placard change also passed all 14 R44 tests and typecheck.

The R44 tests cover polygon containment (including the notch and pedestal), all hotspot centres, placard/component overlap, rendered bounds, published markings and chart cells, separate fuel tanks, powered/freewheel/battery-bypass tach readings, all lamp states/test power, actual linkage opening, electric gyro spin/coast, mixture guard/master/clutch/key actions, distributed redraw preservation, HUD units and disabled training. Initial acceptance found and fixed the radio's declared/rendered width mismatch. Fuel tests allow the existing 2.5-second sender lag to settle; no dynamics were altered.

All captures below are under `work/r44-panel/`, were opened and visually inspected, and use `scripts/shot.mjs`. Chrome reports ANGLE Vulkan llvmpipe software rendering.

| Capture | Check |
| --- | --- |
| `overview.png` (900×1440, 0.75× canvas) | Whole face, all controls inside outline; radio rack centered; no layout warnings |
| `compare-r22.png`, `compare-c152.png`, `compare-da20.png` (same 0.75× canvas scale) | Same shared case/needle/lettering quality; R44 retains its four-column layout and distinct engine limits |
| `lamps.png` (1152×750, 1×) | All sixteen lamps under test; FIRE/OIL red and fourteen amber; right-edge lights contained |
| `autorotation-dials.png` (1000×900, 2×) | Mock engine stopped, rotor 100%, 90 KIAS, MAP 12 inHg; independent tach needles, engine needle on lower stop (40%) |
| `placards.png` (960×780, 1.8×) | Complete altitude/OAT grids, FT/NF cells, weight/autorotation corrections and high-power/doors-off limit |
| `emissive.png` (1152×750) | Dial/lamp mask; warning lenses lit, face and placards unlit |
| `cold.png` (900×1440) | Zero bus, no lit warning lenses even with test requested; radios dark and gyros unerected |
| `cockpit.png` (1600×1000, low graphics, render scale 0.5) | Frozen face maps into existing 3D enclosure without visible clipping; default view's fine labels are too small/soft to read |
| `cockpit-zoom.png` (1600×1000, low graphics, render scale 1) | Closer pilot-eye view with panel lights: main dials legible, chart values still small; upper brow cropped at this zoom |
| `hud.png` (1600×1000, chase camera) | Ten compact rows fit; GOV ACTIVE, clutch 100%, both tachs 101.5%, MAP 12.6 inHg, bus 28.4 V and OAT 14°C |

Panel fixtures are instrument-input tests, not a simulated successful autorotation. The runway capture reports 2705 engine RPM, 406.043 rotor RPM (101.51%), ground speed 0, on ground and undamaged. The 3D exterior is still the other worker's base placeholder, so merged cockpit lighting/rake/readability needs supervisor review. No face-size or alignment correction was made to conceal that limitation.

## Sources

Cached editions and retrieval metadata: [R44 source inventory](r44-sources.md), ignored `work/r44-sources/manifest.json`. Page numbers below are printed handbook/catalogue numbers, not PDF indices.

- [R44 II POH section 2](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44ii_poh_2_4c17ab4577.pdf): 2-1/2-2 operating limits (21 February 2014); 2-7/2-8 instrument markings (21 October 2016); 2-9 MAP/Vne tables (3 October 2002); 2-10/2-11 fuel/operating placards.
- [POH section 3](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44ii_poh_3_d503a5c639.pdf): 3-3 maximum glide; 3-9 approximately three-gallon low-fuel indication.
- [POH section 4](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44ii_poh_4_13dccff3ed.pdf): 4-6/4-7 pre-start/priming/start/run-up (4-7 revised 11 May 2020); 4-10 full-rich flight; 4-13 approach.
- [POH section 7](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44ii_poh_7_e5154ae439.pdf): 7-6 governor, 7-8 ignition, 7-11 auxiliary pump, 7-21 layout (5 March 2015), 7-18 collective-activated hourmeter, 7-24 tach bypass (21 October 2016), 7-25/7-26 warning systems (11 May 2020).
- [IPC chapter 95](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44_ipc_95_1f11c46dc0.pdf), February 2020: figures 95-65 and 95-73, pages 95.64/95.65 (eight-hole case and lamp colours), 95.72/95.73 (engine-instrument shelf). Rendered inspection copies are `work/r44-panel/ipc-95-64.png` and `ipc-95-72.png`.
- [Manufacturer eight-hole photograph](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/OE_Eight_Hole_Instrument_Panel_9a88860f3d.jpg): central console proportions/equipment positions; the installation options differ as described above.

Changed files:

- `src/aircraft/r44/panel.ts`: console layout, controls, complete warning-lens set and instrument-system bindings.
- `src/aircraft/r44/panelMarkings.ts`: R44 dial/engine-gauge scales and documented renderer approximations.
- `src/aircraft/r44/panelPlacards.ts`: formatted MAP/Vne tables from shared limits data.
- `src/aircraft/r44/ui.ts`: supported control guidance, startup limitations, switch announcements and HUD.
- `src/aircraft/r44/training.ts`: source/estimate notes and explicit unavailable-checklist reason; placeholder and disabled school retained.
- `tests/instruments/r44Panel.test.ts`: fourteen acceptance tests.
- `docs/r44-panel.md`: installation, sources, evidence and remaining shared work.

No files outside ownership were changed. Shared geometry, reference data, renderer, physics and chooser remain untouched. Changes remain uncommitted for the supervisor.
