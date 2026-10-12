# Wet magnetic compass

All nine aircraft use `InstrumentSet.compass`. The panel publishes its live `CompassReading` object to the
3D aircraft visual; both fixed-panel sections read that same object. The directional gyro's alignment knob
now copies the compass indication, including any dip/acceleration/deviation error. The gyro remains a
separate inertial instrument. Standalone aircraft previews run the same pure compass module locally.

## Field and mechanical model

`src/instruments/dynamics/magneticCompass.ts` is deterministic and independent of the DOM/three.js. Its
inputs are aircraft identity, true heading, roll/pitch, body angular velocity, and body specific force in g.
No changes to flight dynamics are required. Aircraft turbulence already produces forces and rates; those
excite the instrument rather than a random animation or a weather-slider sine wave.

There is **no magnetic variation model** in this simulator. Its navigation/training/runway datum deliberately
uses true heading. Default variation therefore remains **0 degrees**, and all existing navigation retains
that datum. The model accepts an east-positive variation when a future scenario field model becomes available.

The fictional Fable Regional scenario supplies latitude **46.5 degrees north**, but no longitude or measured
magnetic field. Inclination uses the centred-dipole approximation `I = atan(2 tan(latitude))`, giving
**64.6165 degrees down** here. Geographic latitude stands in for magnetic latitude: this is an explicit
approximation, not WMM/IGRF data for a real KFBL. An inclination override and signed latitude support other
areas and the Southern Hemisphere without changing the equations. Magnetic dip disappears at the equator.

The float has two pendulous tilt degrees of freedom. Apparent up is the measured specific-force vector;
its equilibrium relative to the case is derived with `atan2`. Inertial float angular rates are integrated,
subtracting aircraft roll/pitch rates to obtain relative tilt. Thus a rolling case initially moves around
the float, which subsequently follows apparent gravity through the liquid. In a coordinated steady turn
the float is approximately parallel to the banked case; it need not hang horizontally in world space.

A unit Earth field is transformed through heading and aircraft attitude into body FRD, then projected into
the **actual tilted float plane**. `-atan2(fieldY, fieldX)` supplies the magnetic equilibrium indication.
This projection generates northerly lag, southerly lead and ANDS without cardinal-heading conditionals or
separate imposed error curves. For example, acceleration tips the aft edge upward and makes east/west
indications move toward north. An unaccelerated pitched attitude settles without a false acceleration error.

Azimuth follows a damped magnetic pendulum:

```
error'' = wn² sin(equilibriumError - error) - 2 zeta wn (error' + headingRate)
indication = wrap(trueHeading - variation + error)
```

The last term is liquid drag against the rotating bowl. The float can overshoot and settle; heading changes
are not fed through a simple display lag. Integration uses semi-implicit steps no longer than 1/120 s,
including long caller steps. A reset clears swing and initializes the new aircraft's deviation. A zero step
holds all float state, including when the simulator is paused.

| Parameter | Value | Basis |
| --- | --- | --- |
| Azimuth natural frequency | 1.8 rad/s | Simulation estimate; damped period about 3.77 s |
| Azimuth damping ratio | 0.38 | Simulation estimate; envelope time constant 1.46 s, allows visible overshoot |
| Tilt natural frequency | 5 rad/s at 1 g | Simulation estimate; scales with apparent load, capped at 3 g |
| Tilt velocity damping | 5 /s | Simulation estimate; ratio 0.5 at 1 g |
| Tilt stop | 18-degree combined cone | Brief's representative wet-compass limit; applies to relative tilt, not aircraft bank |
| Stop contact | Inelastic outward tilt velocity removal | Retains tangential swing |
| Stop azimuth drag / stiction | 6 /s; 0.18 rad/s² torque threshold | Simulation estimates for rubbing/sticking, released off the stop |
| Deviation | `A + B sin(H) + C cos(H) + D sin(2H)` | Synthetic residual swings per aircraft; under 4 degrees in tests |

The coefficients for each aircraft are in `COMPASS_DEVIATION`. These are **not measured tail-number
calibrations**. The 12-heading FOR/STEER placards use exactly the same function, rounded to whole degrees:
FOR is the desired magnetic datum heading, STEER is the corresponding compass indication. Electrical-load
changes, temperature-dependent viscosity, bubble/slosh fluid dynamics, and damaged pivots are not modelled.
The reduced tilt equations and Euler-rate conversion are intended for ordinary light-aircraft attitudes;
the model bounds rates near the Euler pitch singularity but is not an aerobatic instrument model.

## Sources

- [FAA Pilot's Handbook of Aeronautical Knowledge, chapter 8](https://www.faa.gov/sites/faa.gov/files/10_phak_ch8.pdf),
  pp. 8-22–8-27: float/pivot construction, dip, deviation, turning errors, acceleration errors, oscillation,
  compensation and the nearby correction card. Text extracted into `work/faa-phak-instruments.txt` for review.
- [FAA Instrument Flying Handbook, FAA-H-8083-15B](https://www.faa.gov/sites/faa.gov/files/pilots/FAA-H-8083-15B.pdf),
  chapter 5: compass errors and corrections. Latitude-based rollout mnemonics are approximations, not an exact
  error at every bank/speed/heading. PHAK's alternative rule is 15 degrees plus half latitude.
- [MIT 12.201, The Magnetic Field of the Earth](https://ocw.mit.edu/courses/12-201-essentials-of-geophysics-fall-2004/f45383d9b61f24c2c5fa474288d7158d_ch3pdf.pdf),
  p. 94, equation 3.32: the centred-dipole inclination/latitude relation. Using scenario geographic latitude
  as magnetic latitude is this simulator's approximation.
- [Airpath compensation instructions](https://www.airpathcompass.com/general-5-1): N–S and E–W compensator
  screws, representative flight/electrical configuration, residual errors recorded at 30-degree headings.
- [Airpath C-2400-L4](https://www.airpathcompass.com/product-page/c-2400-l4): reference for the illuminated
  wet-compass housing/compensator style. Mesh dimensions, spherical float, tint and material finish are
  representative artwork; this is not a dimensionally certified C2400 reproduction.
- [Robinson R44 Maintenance Manual, chapter 13](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44_mm_13_7c751909f4.pdf),
  §13-26, p. 13.11: wet compass on the centre windshield bow above the panel; 30-degree compass swing.

Mechanical frequencies, damping, contact friction, dip approximation and deviation coefficients are disclosed
simulation choices. The manuals establish behaviour and installation, not those numerical coefficients.

## Rendering and placement

`src/render/aircraft/compass.ts` replaces both former cylinder/tape builders with one 96×48 spherical float.
A static high-resolution texture wraps its actual curved surface: cardinal letters, numbers every 30 degrees,
and ticks every 5 degrees. Tilt precedes azimuth rotation in 3D. A curved transparent lens, opaque bowl
interior, lubber line, metal bezel, two slotted compensator screws, mounting bracket and correction card form
the stationary housing. The markings use scene lighting and powered panel backlighting.

The compass definition's FRD position now consistently means the **float pivot**. Existing airplane pivot
locations were retained when replacing the old builder's hidden positional offsets. PA-34 and PA-38 roof
clearance tests were updated to check the new bracket's actual extent. Existing photographic/POH placement
references remain in each aircraft's visual definition.

| Aircraft | Installation |
| --- | --- |
| C172S / C152 | Centre windscreen header/post |
| PA-38 | Centre front roof strip / windscreen header |
| PA-34 | Centre windscreen strip above glareshield |
| DA20 | Centre glareshield, lower pedestal bracket |
| R22 / 269 | Existing centre windscreen-post locations |
| R44 | Added missing compass on centre windshield bow; position is an estimate |
| DA42 | Inherits the existing C172 placeholder cockpit; no claim of an authentic DA42 panel |

The fixed view adds a compact spherical projection in a separate column to **both Upper and Lower**, with
its own FOR/STEER card. It uses the same heading and tilt, has no independent physics, and redraws when the
compass moves even if the other panel instruments did not change. It does not draw another compass on the
3D panel texture or take over a control hotspot.

## Verification

`tests/instruments/magneticCompass.test.ts` checks both turn directions, latitude scaling/hemisphere reversal,
ANDS on east/west, absence of acceleration error on north/south, combined steady pitch/bank, overshoot and
settling, the combined tilt limit and recovery, deterministic gust response, variation/wrap/reset/pause,
frame-step equivalence, all nine deviation cards and DG alignment without a subsequent snap-back.

A one-second roll-in to 18 degrees at 3 degrees/s yields peak errors of about **-45.4 degrees from north**
and **+38.3 degrees from south** (right turn; signs reverse in a left turn), of the expected order of the
46.5-degree latitude. Sustained 0.15 g acceleration on east/west gives about **17.2 degrees toward north**;
braking reverses it. This validates approximate training behaviour, not flight-test calibration.

Renderer integration verifies that the R22's spherical card follows the shared indication and both tilt axes
rather than true heading. Fixed-panel layout checks cover all nine aircraft. C172 geometry regression
records were regenerated for this deliberate geometry change; only the cockpit, posed cockpit, whole visual,
texture-name list and posed visual records changed.

Screenshots and command logs are kept under `work/`. The dev harness uses fixed exposure and is darker than
the simulator's adapted exposure; `c172s-live-compass.png` checks the actual runtime lighting and readout.

### Checks performed (2026-10-12)

- `npm run typecheck`: passed (`work/typecheck-final.log`).
- `npx vitest run --maxWorkers=4`: 227 files; **3,080 passed, six expected failures, 221 skipped**.
  Three failures in that first complete run were investigated (`work/full-suite.log`):
  - PA-34's old bracket-offset assertion was updated for the new pivot convention; passed on rerun.
  - The C172 instrument golden changed only three post-alignment `headingDeg` numbers (t=8, 9, 10 s).
    The pilot aligns during a manoeuvre, so the DG now inherits the wet compass's error. Those three
    intentional values were regenerated and the golden rechecked; all other numbers were unchanged.
  - `tests/rotorcraft/skids.test.ts` had a 5 s timeout under concurrent load. Rerun alone with one worker:
    **all ten passed**, without editing that file or the skid physics (`work/skids-rerun.log`).
- Final affected-area run: **19 files / 269 tests passed** (`work/final-compass-checks.log`). This includes
  all instrument tests, R22 shared-renderer integration, PA-34/PA-38 clearance, geometry regressions and
  the instrument golden. The unchanged six autorotation-landing cases remain expected failures.
- After the final placement/layout review, the three R44 presentation files passed **24 tests** and the
  fixed-panel file passed **58 tests**, including compass bounds and overlap checks for both sections of
  all aircraft (`work/r44-final-checks.log`, `work/fixed-layout-final.log`). Typecheck was repeated and passed.
- `git diff --check`: passed. Work is uncommitted on `inst/compass`.

### Screenshots inspected

The following images were opened and visually checked, not just generated:

| Image | Evidence |
| --- | --- |
| [C172S, live simulator](../work/c172s-live-compass.png) | Curved ball/window, lubber line, screws, placard and adapted daylight lighting |
| [C172S, normal cockpit view](../work/c172s-cockpit.png) | Compass visible and readable at the usual pilot-eye distance |
| [C172S, preview](../work/c172s-compass.png) | Header mounting, curved lettering, complete correction card |
| [PA-38](../work/pa38-compass.png) | Header/roof placement, lettering and placard from the pilot eye |
| [R22](../work/r22-compass.png) | Right-seat view of post mounting, enclosed bowl and correction card |
| [269](../work/s269-close.png) | Centre-post bowl, curved glass, graduations and correction card |
| [R44](../work/r44-compass.png) | Added centre-bow compass, seen obliquely from the right seat |
| [Turn in progress](../work/compass-turn.png) | Actual C172 physics: -21.16° bank, 61.54° heading, 83.31° compass; float pitch -4.89° |
| [Fixed Upper panel](../work/fixed-panel.png) | Compact compass beside the gauges with room for its FOR/STEER card |

The first close-ups exposed a see-through bowl back, corrected with an opaque double-sided interior before
these final views. Turn capture uses `work/compass-turn.js` to step the actual flight model and panel
instruments at 60 Hz, then freezes the result. It reported no simulator subsystem errors. On the loaded
software-rendered host that capture exceeded the screenshot script's 60 s initial readiness wait; its later
state sampling and screenshot completed successfully (see `work/turn-shot.log`).

### Changed files

- New model: `src/instruments/dynamics/magneticCompass.ts`.
- Shared readings and DG alignment: `src/instruments/dynamics/instrumentSet.ts`, `gyroInstruments.ts`,
  `src/core/types.ts` (control comment).
- New renderers: `src/render/aircraft/compass.ts`, `src/instruments/render/magneticCompass.ts`.
- Cockpit/render plumbing: `src/render/aircraft/AircraftVisual.ts`, `RotorcraftVisual.ts`, `cockpit.ts`,
  `rotorcraft/cockpit.ts`, `rotorcraft/fittings.ts`, `airframe/types.ts`, `src/sim/Simulator.ts`.
- Mount definitions: `src/aircraft/{c172s,c152,pa38,pa34,da20,r44}/visual.ts`.
- Fixed panel: `src/instruments/fixedPanel.ts`, `src/ui/fixedPanel.ts`.
- Preview aircraft identity: `src/dev/aircraft.ts` (so its deviation matches its placard).
- Tests: `tests/instruments/magneticCompass.test.ts`, `fixedPanel.test.ts`,
  `tests/aircraft/{r22,pa34,pa38}.test.ts`, `tests/aircraft/geometry.regression.json`,
  `tests/golden/data/c172Instruments.json`.
- Documentation: this file and the cross-aircraft entry in `docs/known-issues.md`.

No ground-contact physics or skid test files were changed.
