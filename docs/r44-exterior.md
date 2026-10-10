# R44 Raven II exterior and cockpit

This is the original exterior worker report. The later [shared integration report](r44-integration.md) records the production renderer connection, sourced stabiliser/guard correction, light wiring and merged cockpit checks.

This work is **not release acceptance**. The data-driven exterior is available on the ordinary R44 development/simulator pages. The detailed R44 assembly is implemented and tested in `exterior.ts`, but needs the supervisor-owned renderer connection described below. The frozen horizontal-stabiliser position also needs coordinated correction. The chooser and all aircraft/UI placeholder flags remain unchanged.

## Files and behaviour

| File under `src/aircraft/r44/` | Change |
| --- | --- |
| `visual.ts` | Fuller four-seat cabin and sloping aft cowling; separate windscreen, two windows and two closed doors per side; opaque roof/headliner; tailcone joined to the cabin; mast proportions; skid cross-tube attachment heights; exhaust and antenna; R44 rotor paint; corrected lamp locations; four cushions, floor and controls fitted within the shell. All reference geometry still imports `dimensions.ts`. |
| `exteriorPaint.ts` | Plain-data main/tail paint schemes from the R44 maintenance figures. Safe for the livery worker to import. |
| `exteriorGeometry.ts` | Small FRD geometry/material helpers and patches conforming to the curved cowling. |
| `exteriorDetails.ts` | Cowling seams, recessed-looking ventilation slots, camlocs, door seals/hinges, filler caps, curved skid fairings, tread/shoes, original procedural R44 badges, tail-light housing, fin hardware and stinger paint bands. |
| `cockpitDetails.ts` | Four separate upholstered cushions with bolsters/seams, baggage-box latches, belt reels/releases, inner handles/vents, centre tunnel, heel rests, overhead fittings and friction/switch fittings attached to the moving controls. Console-side fasteners leave the panel face unobstructed. |
| `exteriorRotor.ts` | R44-specific main and tail yokes, bolts, root fittings, boots, swashplate and pitch links. The lower swashplate/control rods remain outside the azimuth group. Blade cuffs follow the shared blade matrices through pitch, coning and the sharp-to-blur transition. |
| `exterior.ts` | `r44ExteriorVisualClass`, a factory for a subclass of the shared assembly, installs the R44 details without modifying shared code. Retains the existing texture, control, light, occupant and disposal interfaces. |

`tests/aircraft/r44Exterior.test.ts` adds eight acceptance checks covering cloneable data, glazing separation, usable cabin floor and seat clearance, outward overlay normals, rendered blade paint, both rotors' animated cuff attachment, frozen panel UV/position, control parenting, ground clearance and disposal. `audio.ts` was **not changed**: it is still the scaffold's uncalibrated synthetic six-cylinder profile, not an R44 recording.

The old floor at z=0.68 was below the cabin belly (about z=0.66): `cabinFloorGeometry` consequently collapsed to zero width. The floor is now z=0.52; cushion tops z=0.28, base bottoms z=0.49. These are visual estimates, not changes to the published occupant arms, CG, eye point or ground datum. Four seat locations retain the POH longitudinal/lateral ordering; only the right-front pilot is shown by default, matching the frozen setup contract. Occupants remain hidden from the cockpit camera. Loading-dependent passenger visibility is not implemented by the shared renderer.

## Sources and estimates

The existing cache and inventory are described in [r44-sources.md](r44-sources.md). The following figures were actually inspected, rather than inferred from R22 dimensions:

- [R44 II POH section 1](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44ii_poh_1_b4fce9d9be.pdf), 1-3 (26 January 2024) and 1-4: overall silhouette and published rotor dimensions. Frozen values remain 5.0292 m main radius, 0.7366 m tail radius, 1.2827 m cabin width, 2.1844 m skid track, −6° main twist and 1° tail precone.
- [Manufacturer left-side image](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/RAVEN_II_LEFT_v2_new1_06c267b7a0.png): closed cabin/cowling, door and window shapes, mast, tailcone, cross-tube fairings, hardware and guard paint. This photograph is used for proportions only; its livery/registration is not copied.
- [MM chapter 4](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44_mm_4_8117b796b6.pdf), Figs. 4-6 and 4-7, printed 4.22/4.24 (February 2024): stabiliser attachment and tail-light/fin installation. These reveal the stabiliser discrepancy below.
- [MM chapter 28](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44_mm_28_7c9d5c00bb.pdf), Figs. 28-5, 28-7/8 and 28-19: main yoke/bearings, underslung teeter/coning hardware and C016-7 paint. Figure 28-19, printed 28.42 (August 2025), has a 12 in yellow tip, then three 36 in bands (white/yellow/white) on top, with black below except the tip.
- [MM chapter 30](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44_mm_30_ffba390286.pdf), Figs. 30-1 and 30-6: tail hub and C029-3 paint. The selected C029-3 scheme is 4.1 in white at the tip, then alternating 3.8 in bands, with a black root. The alternate C029-1/-2 2.75 in scheme is not used.
- [MM chapter 23](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/R44_MM_Chapter_23_Standard_Practices_04386fdc68.pdf), §23-77, printed 23.39 (February 2024): code D is white and E yellow. Downloaded additionally to `work/r44-ext/r44_mm_23.pdf`; the initial legacy shop URL returned 404. Display RGB colours remain estimates, not measured paint reflectance.
- [MM chapter 26](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44_mm_26_6c39b291c6.pdf), 26.1–26.4 (February 2024): red tailcone anti-collision lamp, cabin/chin navigation lights, tail position light and paired nose landing lights. The optional additional white flashing lamp is omitted.
- [MM chapter 8](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/R44_MM_Chapter_8_Flight_Controls_75870dc7b8.pdf), Fig. 8-1A, and [POH section 7](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44ii_poh_7_e5154ae439.pdf), 7-6/7-7: hydraulic main cyclic/collective and mechanical pedals. The three servos/reservoir are enclosed, not modelled as external mast pistons.
- [Manufacturer console photograph](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/R44_Raven2_Clipper2_console1_13bba6cd21.jpg) and [MM furnishings](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/R44_MM_Chapter_15_Furnishings_c26aa4c969.pdf): centre pod, T-cyclic, controls and four-place upholstery.

Loft stations, cross sections, hardware dimensions, cowling recesses, furniture, control travel clearances, material response and paint shades are **ESTIMATES**. There is no manufacturer CAD or measured cockpit survey. No `dimensions.ts` estimate was corrected or duplicated. In particular no physics, rotor inertia, rigging, contact point, `RotorcraftState` meaning or aerodynamic parameter was changed.

## Supervisor integration and unresolved geometry

1. **Select the R44 detail class.** `src/render/aircraft/AircraftVisual.ts` currently always creates `new RotorcraftVisual(def, ctx, this.opts)` for helicopters. Import `r44ExteriorVisualClass` from `../../aircraft/r44/exterior`, construct `const R44ExteriorVisual = r44ExteriorVisualClass(RotorcraftVisual, FuselageShape, sectionHalfWidth)` once at module scope, then select it for `def.id === 'r44'`, retaining the existing class for R22. Import the latter two helpers from `./fuselageShape` and `./fuselage` respectively. This is the only required production connection for the new geometry. Do not import the class from `visual.ts` or add functions to `AirframeVisualDef`; the livery-worker data must remain cloneable. The subclass has the same constructor/update/disposal interfaces, and calls the shared implementation for normal behaviour. These three implementations are passed in because their shared modules still load legacy C172 defaults: importing them as values from an aircraft leaf violates the repository import-boundary rule. All three imports in the R44 module are type-only; no helper code is copied. A type-specific renderer factory would also work if the supervisor prefers that architecture.

   The reviewed preview copies the renderer/dev harness into ignored `work/r44-ext/` with exactly that selection. It does not modify production/shared files. Thus screenshots labelled **isolated renderer connection** are evidence for the implemented detail assembly, not proof that ordinary app pages already select it.

2. **Correct the stabiliser through the shared contract.** The frozen `HORIZONTAL_STABILIZER.z` is `TAIL_HUB.z + 0.60` (z=−0.30). MM Fig. 4-6 shows the F050-2 surface attached close beneath the tailcone on short F955 brackets; the side photograph agrees. At its current location the rendered surface is about 0.4 m below the underside of the cone, visibly disconnected. The lower fin/curved guard must not be mistaken for the stabiliser in the POH side view. Re-trace the horizontal surface from MM Fig. 16-1 and Fig. 4-6; roughly 0.15–0.25 m below the tail-hub centre is a **proposed visual range**, not a replacement published value. Coordinate the resulting shared z/attachment with the flight-model worker before applying it. This branch preserves the frozen coordinate and does not conceal it with an invented long support or a second visual surface.

3. **Lighting switch semantics remain shared work.** The red lens uses the shared `beacon` visual ID to obtain red illumination. POH/MM call its switch STROBE; the shared renderer ties that red ID to `controls.lights.beacon` and permits `circuit` remapping only for the nose spots. It also does not interlock the landing lamps with clutch-switch engagement. A type-specific light-circuit mapping/interlock is needed; no control state is rewritten here. Beam intensities/flash timing are inherited estimates.

4. **Keep the panel contract frozen.** The 1152×1872 canvas maps to 0.48×0.78 m at 2400 px/m, centre `(1.85, 0, 0.10)`, 15° rake and 0.15 m enclosure depth. The shared rounded housing/rim and pedestal are retained. The added screws sit on the enclosure sides, ahead of the face, and do not cover pixels. No geometrical face/UV mismatch was found. The actual panel is the scaffold canvas on this branch; its markings/click regions belong to the panel worker. The one-plane engine shelf/pedestal remains an approximation, and the optional right accessory console is omitted. The canvas is quite dark in the aircraft harness's daylight lighting; this is not cockpit-readability acceptance of the merged panel.

## Verification and captures

Commands run from this worktree:

```bash
npx tsc --noEmit
npx vitest run tests/aircraft/r44Exterior.test.ts tests/aircraft/r44Setup.test.ts tests/aircraft/r22Exterior.test.ts tests/aircraft/importOrder.test.ts --maxWorkers=3
npx vitest run --maxWorkers=4
```

Typecheck is clean; the scoped run passes **27/27 tests** in four files, including all import-order checks. Logs: `work/r44-ext/typecheck.log`, `area-tests.log`, `full-suite.log`. The first full run exposed five forbidden value-import paths into legacy C172 defaults in the new modules. The injected-helper factory fixes them without a shared edit. The second full run passes **2712 tests, 2 expected failures and 221 skipped** across **192 passed / 4 skipped files**, in **403.63 s**. The two expected failures are the unchanged R22 autorotation-landing cases. No unexpected failures remain. The final beacon-mount and stinger-paint fitting edits were made during that full run and covered by the subsequent 27-test scoped run (34.16 s) and final clean typecheck; there were no later code edits except removing an unused type import. The initial failing run is retained as `work/r44-ext/full-suite-initial.log`.

Captures use `node scripts/shot.mjs`, 1600×1000 unless noted, `freeze=1`, `--wait 200`; exterior comparisons use the identical `view=side&fov=40`. Images were opened and visually inspected. Chrome reports ANGLE/Vulkan **llvmpipe**, not a hardware GPU. ReadPixels performance warnings are present; they are not geometry exceptions.

| Capture under `work/r44-ext/` | What it establishes |
| --- | --- |
| `ordinary-side.png` | Current production dev harness: improved data-only body/paint/seat layout, before the supervisor connects the new detailed class. |
| `before-side.png` (1400×850) | Original scaffold: joined windscreen/door appearance, low furniture, bare thin skid tubes. |
| `final-side.png`, `final-tail.png`, `final-rotor.png`, `review-front.png` | Detailed assembly in the isolated connection. Distinct four-place doors/cabin, closed cowling, curved skids, R44 yokes/root fittings and paint. Tail views intentionally expose the unresolved frozen stabiliser location. |
| `review-cockpit.png` | Empty-face enclosure and pedal/column clearance at the frozen right-seat eye. |
| `review-cockpit-panel.png` | The actual current R44 panel canvas on the same enclosure; equal UV scale and no face obstruction. Uses the scratch harness's `realpanel=1`, not the generic stretched test pattern. |
| `powered-controls.png` | Render fixture at 406 rotor RPM, 11 kN thrust, collective 0.7 and displaced cyclic/pedals; rotor blur, cuffs and lamps. These are fixture inputs, not measured flight performance. |
| `four-seats.png` | Scratch `cockpitrear` camera at model `(0, 0.42, −1.75)`, looking at `(0, −0.02, −0.35)`, 90° FOV and ambient multiplier 2. Shows all four seat backs, upholstery, belts, headliner and cyclic switches. |
| `review-cabin.png` | Left look from the pilot eye: opaque headliner, overhead fittings, window posts, copilot grip and upholstery. |
| `r22-side.png`, `c152-side.png`, `da20-side.png` | Unmodified reference aircraft at the same side camera, FOV and output size. |
| `r22-cockpit.png`, `da20-cockpit.png`, `c152-cockpit.png` | Unmodified reference cockpit geometry at each type's own default eye/FOV. |

Example detailed capture (scratch preview retained for supervisor reproduction):

```bash
node scripts/shot.mjs 'work/r44-ext/preview.html?type=r44&view=side&freeze=1&fov=40' work/r44-ext/final-side.png --wait 200 --w 1600 --h 1000
node scripts/shot.mjs 'work/r44-ext/preview.html?type=r44&view=cockpit&freeze=1&realpanel=1' work/r44-ext/review-cockpit-panel.png --wait 200 --w 1600 --h 1000
```

## Remaining fidelity limits

- Doors are closed and non-operable. Vent slots are shallow surface detail, not an open engine bay. No removable cowl, fan/belt animation, exposed six-cylinder installation, movable door windows, or hidden hydraulic plumbing is claimed.
- The common rotor airfoil is a symmetric NACA stand-in. Its all-span metallic leading-edge strip/tip-cap appearance does not reproduce the C016-7 84 in ProtectaClear boundary or its 1.50/0.75 in chordwise paint limits. The documented spanwise colour bands are correct; exact erosion-strip paint needs additional generic rotor support or R44 blade geometry.
- Root fittings follow the blade matrices, but there is no elastic spindle/boot deformation or independently solved hardware linkage. Coning/droop remain the scaffold's visual estimates (2.5° at 11 kN, 5° cap, −2° stopped). They do not change the flight-model rotor.
- Hydraulic/governor/landing switches are visual fittings only; the panel/input owners retain system control. Rotor brake and overhead lamp are static. No hydraulic force feedback or failure state was added.
- The pilot remains the shared simplified seated figure; hands are not inverse-kinematically attached to controls. Four seats are modelled, but four occupants are not asserted for every loading.
- Audio remains synthetic and uncalibrated. Neither exterior geometry nor green test results validate R44 flight performance, startup or autorotation landings.

All work is left **uncommitted**. No shared, supervisor-owned or other worker-owned tracked file was edited. Scratch source copies, downloaded references, screenshots and logs are confined to ignored `work/`.
