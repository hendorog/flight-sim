# Schweizer 269C-1 / 300CB exterior and cockpit

This branch implements the **carburetted, two-seat 300CB, right PIC, single left main tank, no STAR**, selected in [s269-sources.md](s269-sources.md). It preserves the hidden/placeholder status. Geometry and a successful renderer fixture are not flight-model, startup or panel acceptance.

## Files and assembly

- `src/aircraft/s269/visual.ts`: independent bubble-cabin loft, oval door/window masks, floor pan, two seat positions, individual cyclic paths, pedals, collective positions, exterior lamps, paint and the frozen console specification. Only the unused fixed-wing compatibility fields still come from the R22 description; no R22 cabin, glazing, seats, lamps or livery are spread into the new data. The data remains structured-cloneable for the texture worker.
- `exterior.ts`: the `s269ExteriorVisualClass` factory, following the existing R44 integration pattern. It uses the shared fuselage, cockpit, light, occupant, panel and rotor builders, then replaces the generic Robinson engine/mast/skid fittings and their stale static shadow. The original hidden meshes remain attached for the shared disposer. Shared-default builders are injected to avoid value-import cycles through C172 data.
- `exteriorDetails.ts`: exposed tubular frame and boom braces; one rounded teardrop-section fuel tank with cap, bands and feed line; four opposed finned cylinders, rocker covers, baffles, ignition leads, crankcase/sump, cooling fan, six visual V-belts/pulleys/idler and upstack exhaust; internal-drive tail boom, gearbox, frozen fins/stinger; four static oleos with rod/seal/eyes and radius rods; straight skid contact rails with tangent upturned toes; fitted door seals, vents, lamp mounts, fictional `N269FS` registration and representative white/blue/red paint. The belt count, mechanical detail proportions and paint are estimates, not an IPC parts count or factory scheme.
- `exteriorGeometry.ts`: materials, surface-following trim/lettering, ellipsoids and moving-rod placement.
- `exteriorRotor.ts`: three separate flap/lag pivots, feathering sleeves/grips, pins/clevises, elastomeric lag damper bodies/end fittings, pitch links, swashplate races/scissors and tail grips. Uses the frozen hinge offsets. Transforms the shared NACA 0012 grid **in each untwisted section** to NACA 0015 thickness for the main and symmetric 0014 for the tail; the latter remains an approximation to the published *modified* 0014. Chord, twist, span, paint and root/tip caps are retained.
- `cockpitDetails.ts`: seat bolsters, seams, belts/reels/frame, door handles/sills, foot rests, console side fasteners, two individually pivoted cyclics with trim hats/buttons, collective friction fittings and ribbed twist grips. The shared right-seat figure is hidden in cockpit view. No hydraulic or governor fittings are added.
- `audio.ts`: annotation of the existing synthetic four-cylinder/three-blade profile; no acoustic calibration or recording is claimed.
- `tests/aircraft/s269Exterior.test.ts`: geometry/state/UV/disposal acceptance checks described below.

No shared or other worker-owned tracked file is edited. All changes remain uncommitted.

## References and scope of evidence

Primary dimensional/system source: [manufacturer CSP-C1-1, reissued 16 January 2019](https://cdn.shopify.com/s/files/1/1008/9286/8689/files/Flight-Manual-269C-1-300CB-CBi-CSP-C1-1.pdf?v=1772539456), especially printed pp 1-5–1-12 and Fig 4-2A. The cached copy and source conflicts are recorded in `docs/s269-sources.md`. In particular, pp 1-6/1-7 place the tail shaft/control rod **inside** the boom and describe separate main flap/lead-lag hinges, a belt/idler clutch and the tail tension-torsion strap. No external shaft/bearing train is modelled.

Photographic shape checks:

- Andrew Borrows, [300CB left side photograph](https://commons.wikimedia.org/wiki/File:Schweitzer_300CB_Side_View.jpg), public-domain release; cached as `work/s269-ext/side-photo.jpg`. Examined at full size for the oval door, tank, open engine, truss, tail braces, skids and fin/stinger. The photographed aircraft is N6144Q; the model does not claim to reproduce that individual serial/paint installation.
- Tim McAdams, *Rotor Rating*, AOPA Pilot April 1997, [period comparison and photographs](https://www.aeroresourcesinc.com/uploads/199704-1997%20Robinson%20Beta%20II%2CSchweizer%20300CB.pdf), printed p64 (PDF page 4). `work/s269-ext/aopa-four.png` shows the two seats/control grips, single left tank and rear engine/belt/mast installation. The article's early tank size is not substituted for the selected later 33-gallon installation. Photos were consulted, not embedded as shipped textures.
- Cached `C1B-040_6-30-15.pdf` upper-pulley illustration and `hmi-throttle-figure.png` support the belt-drive/manual-control arrangement. FAA 4H12 rev32 Note 9(b) identifies the CB elastomeric lag damper, PN269A1290-3. These sources do **not** establish head hinge dimensions, a complete assembly sequence or damper force characteristics.

No frozen estimate was corrected. Cabin stations, tank envelope, detailed engine/drive positions, fasteners, blade colour bands, seat posture, lights and control travel remain photographic/render estimates. The maximum cabin width, all hub/reference/contact geometry, hinge offsets, fin/stabilizer/stinger and panel coordinates continue to come from `dimensions.ts`.

## Supervisor integration required

The production `AircraftVisual` still selects the generic rotorcraft implementation for `s269`. The data-only new bubble/seat/lamp description is visible there, but the complete mechanical model is **not connected**. Add the aircraft-specific class exactly as the R44 is connected:

```ts
import { s269ExteriorVisualClass } from '../../aircraft/s269/exterior';
const S269ExteriorVisual = s269ExteriorVisualClass(RotorcraftVisual, FuselageShape, sectionHalfWidth);
// In the existing rotorcraft branch:
const Visual = def.id === 's269' ? S269ExteriorVisual
  : def.id === 'r44' ? R44ExteriorVisual : RotorcraftVisual;
```

This branch intentionally does not edit that supervisor-owned file. The isolated preview is `work/s269-ext/preview.html`; its ignored copy of `AircraftVisual` implements only that selection, and its copied aircraft dev harness adds real-panel drawing and two close cameras. Rebuild the copies with `python work/s269-ext/make-preview.py`. They are verification scratch files, not proposed production modules.

### Per-blade state bridge

The flight worker's new articulated state is not present on this branch. The fourth factory argument optionally accepts a `S269RotorPoseReader`: `(ctx) => ({ blades: [{ flap, lag, pitch? }, …] })`. This is an **aircraft-renderer adapter**, not a proposed change to `RotorcraftState`:

- Exactly three blade entries, ordered at `state.azimuth + b * 2π/3` in the shared renderer convention.
- Radians; `flap` is total angle including coning, positive tip up; `lag` is positive rotation about model +Y; `pitch` is feathering angle at 0.75R. The supervisor must confirm/adapt the final solver's phase and lag sign. Omitted pitch uses the aircraft's collective rigging.
- Actual blade transforms use the imported flap and lag offsets. Grips, pitch horns, damper drive arms, rods and the sharp/exposure blade copies remain attached to their own chains. The high-RPM disc uses the same three-blade mean coning/first-harmonic flap.
- With no adapter (or a missing/non-finite field), lag is neutral. Flap uses the existing disc slopes plus the explicitly estimated −2° stopped droop / 2.5° coning at 7785 N, capped at 5°, blended with rotor speed. This fallback is not claimed as articulated dynamics or ground resonance. It writes no physics state.

The exact hinge sequence/offsets and hardware proportions await dimensioned HMI/IPC data. Swash travel and control phasing are visual estimates; the scissors do not solve an independent kinematic constraint. Collective movement and both cyclic sticks follow actual controls. The trim hat is a visible fitting; no new click binding or force-feedback/trim simulation is invented. The four oleos remain at the shared compressed reference endpoints; no decorative bouncing or invented suspension-state field is used. A final suspension/airframe displacement contract is needed before stroke animation can be accurate.

### Frozen geometry conflicts to resolve centrally

1. **Vertical fin/stinger placement:** `VERTICAL_FIN_OUTLINE` is above the boom and adjacent to the gearbox. RFM Fig 1-1 side view and the Borrows photograph appear to show the triangular vertical fin *below* the boom and ahead of the gearbox; the upward surface at the aft end is the single right canted stabilizer. The current shared outline therefore produces a visibly incorrect twin-upward-surface silhouette. The frozen stinger also begins well forward of the gearbox and hangs lower than the photographed short swept tail skid. Re-trace these together, with the flight worker's contact/aerodynamic consumers, before exterior acceptance. This branch imports and renders the frozen shapes; it does not add a second corrective fin.
2. **Oleo mounts:** the frozen upper y=±0.44 m and lower y=±0.996396 m give strongly splayed struts. The period photographs show much more upright outboard oleos below the crossbeam ends. They also show a less crossed lower radius-rod arrangement. The reference endpoints are estimates, not measured geometry. This branch preserves every mount and does not disguise the difference with a separate visual suspension.
3. **Stabilizer incidence:** the shared polygon encodes 35° right dihedral, but its leading/trailing edges have identical z, while the separate scalar says 9.8° incidence. Rendering the shared outline faithfully leaves that incidence absent. Resolve the polygon and physical surface together; no renderer-only twist was added.
4. **Tail rotation:** the frozen estimated local spin sense is retained; no primary rotation-arrow/drive drawing was obtained.

### Panel contract

The face remains **0.48 × 0.60 m**, **1152 × 1440 px**, **2400 px/m**, **12° rake**, centre **FRD (1.12, 0, −0.08)** and enclosure depth **0.14 m**. The common `buildConsole` creates the shell/rim on that exact outline and support. New fasteners sit on the sides ahead of the face, never over a canvas pixel. Tests verify the actual geometry/UV basis and world-space centre, not just copied configuration values. No face/UV mismatch was found. The panel artwork on this branch is still the panel worker's starting scaffold; its dimness/layout/markings are not accepted by these exterior captures.

## Verification

All screenshots use `scripts/shot.mjs` at 1600×1000 unless stated otherwise. The isolated preview shows the new detail assembly; ordinary dev/sim captures show only the currently connected production implementation. The browser reports ANGLE Vulkan **llvmpipe** and ReadPixels performance warnings; it is software rendering.

- `npx tsc --noEmit`: clean, exit 0 (`work/s269-ext/typecheck.log`).
- `npx vitest run tests/aircraft/s269Exterior.test.ts tests/aircraft/s269Setup.test.ts tests/aircraft/r22Exterior.test.ts tests/aircraft/r44Exterior.test.ts --maxWorkers=4 --reporter=verbose`: **20 passed, 4 files, 5.32 s**, including all four new exterior cases (`work/s269-ext/area-tests-final.log`).
- `npx vitest run --maxWorkers=4 --reporter=verbose`: **2774 passed, 4 expected failures, 221 skipped; 200 passed files / 4 skipped; 445.15 s**, exit 0 (`work/s269-ext/full-suite-final.log`). The existing R22/R44 autorotation-landing expected failures remain unchanged. There are no unexpected failures.

An earlier overlapping check/render run hit the unchanged 5000 ms test timeout in the new assembly test, the existing R44 assembly test and the supervisor's 269 setup mesh test (`area-tests-loaded.log`). There were no geometry assertion failures in those cases; all pass in the final scoped run, at 2650/3742/2524 ms respectively. No timeout or tolerance was enlarged. Two quiet full-suite invocations exited with signal 143 without results. A streamed invocation was intentionally stopped for the final mount-reference cleanup; none of those interrupted runs is counted as acceptance.

The four new tests check cloneability, seat-pan fit at the published arms, 0015 thickness with unchanged chord/twist/span, independent blade states at 0/30/180/462 RPM and three azimuths, root and damper attachment, exposure-disc coning after generic-rotor updates, unchanged physics state, frozen panel UV/world mapping, fixed per-seat cyclic pivots, four reference oleo mounts, no geometry below the skid sole, truss clearance from both occupied seat volumes, occupant hiding and resource disposal.

Initial checks found real geometry defects: narrow lower-cabin sections intersected seat bases; oversized lower oleo eyes reached 17 mm below the ground datum; the skid Catmull spline then dipped about 4.2 mm below it. The cabin floor-pan sections, lower eye shape and straight-plus-tangent skid rail were corrected. Test tolerances were not widened to accept them.

Remaining approximations also include non-operable doors/vents, no fan/belt rotation, simplified nonmoving pilot hands, no detailed hidden engine plumbing or measured acoustic spectrum. Audio retains the four-cylinder C152 synthesis/filter estimates with 300CB power/rotor data: upper-limit firing/blade-passage rates are 90 Hz / 23.55 Hz, not recordings. No STAR horn is claimed; shared audio reads the flight model's `lowRpmHorn` signal.

Capture commands (run from the worktree):

```bash
node scripts/shot.mjs 'work/s269-ext/preview.html?type=s269&view=side&freeze=1&fov=40&rpm=0' work/s269-ext/review-side.png --wait 200 --w 1600 --h 1000
node scripts/shot.mjs 'work/s269-ext/preview.html?type=s269&view=rotor&freeze=1&fov=40&rpm=0&azimuth=25' work/s269-ext/final-rotor.png --wait 200 --w 1600 --h 1000
node scripts/shot.mjs 'work/s269-ext/preview.html?type=s269&view=cockpit&freeze=1&realpanel=1' work/s269-ext/final-cockpit.png --wait 200 --w 1600 --h 1000
node scripts/shot.mjs 'index.html?aircraft=s269&scenario=runway&resume=0' work/s269-ext/runway-final.png --wait 200 --timeout 180000 --w 1000 --h 625
node scripts/shot.mjs 'dev/instruments.html?type=s269' work/s269-ext/panel-production.png --wait 200 --w 1600 --h 1000
```

| Images in `work/s269-ext/` | Review evidence |
| --- | --- |
| `review-side.png`, `powered-controls.png` | Distinct 300CB silhouette, open engine/truss, single tank, stopped three blades and powered exposure disc. |
| `final-rotor.png` | Separate three flap/lag joints, grips, dampers and pitch links. Hardware dimensions/sequence remain estimates. |
| `review-engine.png` | Four cylinders, fins, baffles, open belt/fan installation, single tank and tail braces. |
| `final-cabin.png` | Rounded door/glazing, right occupant, bucket upholstery and belts, panel enclosure. The corrected truss leaves the occupied volume clear. |
| `final-cockpit.png` | Both individual cyclic grips/trim hats, pedals and frozen panel with the current real scaffold canvas. |
| `final-tail.png` | Left tail rotor, canted right stabilizer and deliberately visible frozen fin/stinger conflicts. |
| `r22-side.png`, `r44-side.png`, `c152-side.png`, `da20-side.png` | Unmodified reference aircraft at the identical `view=side&freeze=1&fov=40&rpm=0`, output size and lighting. |
| `r22-cockpit.png`, `r44-cockpit.png`, `c152-cockpit.png`, `da20-cockpit.png` | Reference cockpit geometry at each type's own eye/default FOV; ordinary harness without real-panel textures. |
| `panel-production.png` | Current production panel-worker starting scaffold, not final panel acceptance. |
| `runway-final.png` | Required exact production runway URL, 1000×625, loaded and inspected. Uses the generic renderer until supervisor wiring. |

The powered fixture uses **462 rotor RPM, 7785 N thrust, collective 0.65, disc slopes +3° forward / −2° right**, displaced cyclic/pedals and lights. It is a render fixture, not a flown hover. The final visible model measured **152 meshes / 144,452 triangles**, excluding hidden parts and shadow proxies, with a **1519.5 ms** build in that capture; these are one-run software-renderer figures, not a hardware performance claim. All listed images were opened and inspected. Earlier `detail-*`, `first-side.png` and `review-cockpit.png` are retained as iteration evidence, not final acceptance views.

The final exact-URL runway capture reported **ready=true, engine 2649.195651 RPM, rotor 462.137464 RPM, onGround=true, crashed=false**, with no application errors (`work/s269-ext/runway-final-small.log`). Earlier 1600×1000 attempts while other checks were running did not become ready and timed out taking a screenshot; those unsuccessful attempts are retained in `runway-production.log`/`runway-final.log`. The successful capture was run alone at 1000×625. It verifies loading of the production path, not the new detailed assembly or flight performance.
