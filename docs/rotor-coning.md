# Rotor coning and stopped-blade droop

The renderer now solves a per-blade hinge moment balance, with gravitational sag of the flexible span.
Flight-model forces, inflow, governor, inertia and the aerodynamic `RotorcraftState.coning` state are
unchanged. The latter enters the lateral-flapping equation, so replacing it with a gravity/stop model
would change handling. It is a reasonable aerodynamic operating-speed approximation, but cannot supply
the stopped/low-speed pose: it omits blade weight, hinge offset, stops and bending, and its lag freezes
at zero speed.

## Diagnosis

Collective down is **not zero pitch or zero thrust**. The R22's effective lower pitch stop is 2.5° at
75% radius; the R44's is 1.75°. Both also have twist. The previous visual formula was a thrust-scaled
angle blended from −2° by squared nominal-RPM fraction. It omitted weight and centrifugal moment
balance; its droop persisted too far into spool-up, while its full-speed cone ignored gravity.

Sea-level ISA, calm, collective zero, normal governor, ground spawn, after 20 seconds at 240 Hz in the
complete flight model (`work/report-coning.ts`):

| Aircraft | Actual RPM | `r.thrust`, N | `r.coning`, degrees | Previous visual, degrees | New hinge angle, degrees |
| --- | ---: | ---: | ---: | ---: | ---: |
| R22 | 527.796 | 1402.373 | 0.400862 | 0.583796 | 0.451323 |
| R44 | 406.010 | 1646.905 | 0.320489 | 0.374297 | 0.351893 |

Both remained on the ground and undamaged. Small differences from the following held-pose values
come from the actual skid pose and RPM. An unloaded full-speed rotor is almost horizontal, but this
collective-down state still has some aerodynamic loading; it should retain a small positive cone.

The dev aircraft page is a **mock state**, not a flight simulation. Without `thrust=`, above 300 RPM it
assigns 5500 N to the R22 and gross-weight thrust to the R44, independently of `collective=0`. That
produces about 2.29° / 2.53° with the old visual model. All evidence here supplies explicit measured
thrust, so this hover-load fixture cannot masquerade as an unloaded rotor.

## Sources and limits of the evidence

- [Robinson, Turnour and Riedl, *Low-G Mast Bumping Research*, 26 October 2022](https://shop.robinsonheli.com/wp-content/uploads/2023/09/MastBumpingResearch_26Oct2022.pdf),
  sections 5–6: the coning hinges let the blades find their aerodynamic/centrifugal equilibrium with
  reduced root bending. Fixed precone describes teetering rotors **without** these free hinges.
  The manufacturer describes normal coning travel as a few degrees from the droop stop and gives
  over 25,000 lbf centrifugal force per R44 blade at normal RPM. This is an order-of-magnitude check,
  not a measured R22 hover-coning curve.
- [R22 POH](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r22_poh_full_book_b79e920713.pdf),
  1-4 and 7-2: main rotor free to teeter and cone; coning bearings and droop stops. The often-quoted
  **1°11′ precone belongs to the tail rotor**, not the main rotor.
- [R44 II POH section 1](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44ii_poh_1_b4fce9d9be.pdf),
  1-4: main rotor free to teeter and cone; **1° precone is also a tail-rotor value**.
- [R22 flight-model notes](r22-flight-model.md) and [R44 flight-model notes](r44-flight-model.md),
  with the corresponding `rotorcraft.ts` definitions, supply the existing estimated blade mass
  distributions and polar inertias. These have not been replaced with unverified new inertia data.

No measured R22/R44 main fixed-precone, numerical droop-stop angle, flapwise EI, or certified upper
coning-stop angle was established from these sources. The main hinges therefore use **zero spring
stiffness and zero fixed precone**, rather than importing the tail values. The −1° droop stop, hinge
offsets and EI values below are explicit engineering estimates. Gross-hover predictions fall in the
requested 2–4° R22 envelope and are consistent with the manufacturer's qualitative description;
they are **not flight-test validation of a precise hover angle**.

## Shared balance and parameters

`src/physics/rotorcraft/coning.ts` exports `bladeConing(def, omega, thrust, normalGravity?, aerodynamicMoment?)`.
It is pure, independent of three.js and blade count, with SI units throughout. Thrust is signed and
**per blade**. Angles are radians. The renderer divides total thrust by the number of blades and
projects gravity onto the actual disc normal.

For shaft radius `r`, coning hinge offset `e`, blade mass `m`, shaft-referenced CG `rcg` and per-blade
shaft polar inertia `Ishaft`, the small-angle moment equation is

```text
Ma − m gNormal (rcg − e) = Ω² [Ishaft − m e rcg] β + K (β − β0)
Ma = Tblade (rThrust − e)                 [unless a resolved hinge moment is supplied]
Icf = Ihinge + m e (rcg − e) = Ishaft − m e rcg
β = clamp((Ma − m gNormal (rcg − e) + K β0) / (Icf Ω² + K), lowerStop, upperStop)
```

Thus centrifugal stiffness acts about a horizontal plane for a free hinge. A precone is the unstrained
angle of an actual spring; adding it unconditionally to a free-hinge balance would invent a restoring
torque. With zero speed and no spring, a loaded blade rests on the appropriate stop. The exactly
unloaded, zero-speed free hinge is indeterminate; the function chooses neutral without dividing 0/0.
There is no RPM switch or nominal-speed interpolation. Stop contact is continuous in position, with
a derivative change when the blade leaves the hard stop.

| Per-blade parameter | R22 | R44 | Basis |
| --- | ---: | ---: | --- |
| Mass, kg | 12 | 21 | Existing flight-model estimates |
| CG shaft radius, m | 2.2927 | 3.0146 | Uniform mass from aerodynamic cutout to tip |
| Shaft inertia, kg m² | 73 | 225 | Existing rotor polar inertia / 2; includes small root/hub allowance |
| Coning hinge radius, m | 0.120 | 0.151 | Estimated hub geometry; matches rendered coning pins |
| Thrust radius, m | 2.87655 | 3.7719 | Estimated 0.75R; appropriate to approximately r² loading |
| Precone / spring, rad / Nm per rad | 0 / 0 | 0 / 0 | Free hinges; no verified fixed main precone |
| Droop stop, degrees | −1 | −1 | Estimate, not a maintenance dimension |
| Upper mechanical stop | unspecified | unspecified | No claimed stop; 90° geometric limit bounds extreme input |
| Flexible-span root / tip, m | 0.75 / 3.8354 | 1 / 5.0292 | Existing aerodynamic cutout / published radius |
| Flapwise rigidity EI, N m² | 3600 | 12000 | Estimates giving 12 / 14 cm static tip sag |

As a scale check, the R44 parameters give `m Ω² rcg ≈ 114.4 kN` (25,700 lbf) per blade at 406 RPM,
consistent with Robinson's over-25,000-lbf statement. This does not independently establish EI or stop angles.

The 0.75R resultant is an approximation: the flight model's blade-element moment changes its effective
arm with pitch, inflow, twist and forward speed. In gross hover this visual balance gives 2.249° for
R22 and 2.948° for R44, versus the aerodynamic state's 2.298° and 3.063°. At low pitch the arm error
is proportionally larger. A later per-blade solver should supply its actual hinge moment via the
optional argument. Do not infer actual helicopter blade properties from these estimates.

The function is a quasi-static small-angle presentation model. It does not resolve flap transients,
hinge friction, pitch–flap coupling, blade sailing, large-angle rotor failure or manoeuvre-induced
elastic loads. An unspecified upper stop falls back to the 90° geometric limit, which is a numerical
bound, **not a claimed Robinson mechanical stop or valid small-angle prediction**.

## Static bending

In addition to hinge rotation, a uniform cantilever approximates the stopped blade's downward curvature.
Its normalized shape is `f(s) = s²(6 − 4s + s²)/3`, with zero displacement/slope at the flexible root and
unit displacement at the tip. This is the Euler–Bernoulli uniform-load shape. A single Rayleigh–Ritz
coordinate gives, for flexible length `L` and shaft radius `a` at its root:

```text
elastic stiffness = 16 EI / (5 L³)
centrifugal stiffness = m Ω² [122/405 + 2a/(5L)]
tipBend = −(2/5) m gNormal cos(β) / (elastic stiffness + centrifugal stiffness)
```

These coefficients follow from integrating `EI f''²`, tension times `f'²`, and weight times `f` along
the uniform beam; the stopped limit is `−m gNormal L³ cos(β)/(8EI)`. The tension term makes bending
disappear progressively without a low-RPM cutoff. This is only gravitational sag, not a full
aeroelastic beam solution. Hinge angle and curved displacement are distinct; a −1° hinge stop does
not forbid the outboard blade from bending below it.

`TeeteringRotor` rotates about the coning pin, bends the real geometry (and therefore its shadow), and
counter-rotates that displacement through feathering so sag stays in the flap plane. The trail shader
and blur disc use the same hinge, curve and projected radius, including their normals. R44 cuff
fittings follow the shared blade matrices. Tail precone and propeller behaviour remain as before.

## Numerical and visual evidence

The frozen screenshots use measured RPM/thrust, a side camera, azimuth 90° and 30° field of view.
Low-speed measurements are settled level at sea level and zero collective. Light/heavy hover
loads come from converged airborne trims: R22 512.06 / 621.42 kg, R44 825.31 / 1133.98 kg, with nominal
RPM 527.85 / 406.00. The images retain the dev page's preset attitude (including its 2° airborne pitch).
These are rendered load fixtures, not screenshots of a dynamically flown hover.

| Aircraft / state | Thrust, N | Physics cone, ° | Old visual, ° | New hinge, ° | New curved tip sag, cm |
| --- | ---: | ---: | ---: | ---: | ---: |
| R22 stopped | 0 | 0 | −2.000 | −1.000 | −12.00 |
| R22 30 RPM | 4.52 | 0.400 | −1.994 | −1.000 | −10.71 |
| R22 60 RPM | 18.08 | 0.400 | −1.974 | −1.000 | −8.10 |
| R22 120 RPM | 72.32 | 0.400 | −1.895 | −0.812 | −4.10 |
| R22 55% tach / 280.5 RPM | 395.14 | 0.400 | −1.389 | 0.275 | −1.04 |
| R22 full RPM, collective down | 1399.27 | 0.400 | 0.583 | 0.450 | −0.31 |
| R22 light hover | 5156.69 | 1.878 | 2.149 | 1.843 | −0.31 |
| R22 gross hover | 6249.25 | 2.298 | 2.604 | 2.249 | −0.31 |
| R44 stopped | 0 | 0 | −2.000 | −1.000 | −14.03 |
| R44 30 RPM | 8.97 | 0.319 | −1.989 | −1.000 | −12.29 |
| R44 60 RPM | 35.88 | 0.319 | −1.956 | −1.000 | −8.96 |
| R44 120 RPM | 143.50 | 0.319 | −1.822 | −0.556 | −4.30 |
| R44 55% tach / 220 RPM | 482.33 | 0.319 | −1.381 | 0.142 | −1.63 |
| R44 full RPM, collective down | 1642.66 | 0.319 | 0.373 | 0.351 | −0.52 |
| R44 light hover | 8298.02 | 2.209 | 1.886 | 2.124 | −0.52 |
| R44 gross hover | 11392.31 | 3.063 | 2.589 | 2.948 | −0.52 |

At zero thrust and nominal RPM the hinge is slightly below horizontal (R22 −0.069°, R44 −0.087°).
Combined hinge droop and curvature put the stopped tips 18.5 / 22.5 cm below the hinge plane. The
progressive recovery at 30, 60 and 120 RPM is visible in the before/after sheets, and the loaded
disc cones more than the collective-down disc. All seven rows for both aircraft were inspected,
including separate enlarged rotor sheets.

Evidence is in the ignored `work/` directory:

- `work/coning/s269-runway-before-after.png`: default runway and the closed-throttle rundown,
  at 20, 120 and 180 seconds; individual simulator screenshots were also inspected.
- `work/coning/r22-before-after.png`, `r44-before-after.png`: seven side views, before and after.
- `work/coning/r22-rotor-detail.png`, `r44-rotor-detail.png`: the same comparison focused on the rotor.
- `work/coning/before.json`, `report.json`, `report.txt`: measurements, including complete-model ground runs.
- `work/capture-coning.mjs`: captures the original HEAD through a Vite transform for `before`, so it does
  not need to overwrite or revert the working tree; `after` uses current source. Both use identical inputs.
- `work/report-coning.mjs`, `work/measure-coning.ts`, `work/report-coning.ts`, `work/contact-coning.py`:
  reproduction and contact-sheet assembly. Run from the repository root.

## Schweizer 269 integration

### Diagnosis: two distinct issues

This integration starts from `fd86c5f` and preserves the coning merge from `main` at `490d15c`
(implementation commit `962cd20`, “Rotor blades cone from a hinge moment balance…”).

At the exact preview load `dev/aircraft.html?type=s269&view=side&rpm=120&thrust=50&collective=0`,
the pre-change renderer has **−1.864° flap on all three hinges**. The dev harness creates
`emptyRotorcraftState()` with no `articulated` blades; its old visual fallback therefore supplies
this angle. It does not run the flight model. The explicit 50 N overrides the default thrust, and
both flap harmonics default to zero. The blade mesh has no built-in positive cone, and the flap
pin's positive-Z rotation correctly raises the local +X span. The measured mesh-tip centroids
are all 12.74 cm below their pins before the change (7.34 cm below with the new balance).

The apparent upward blade in this screenshot is **perspective**: `view=side` is a low, oblique
camera at model `[-13, 0.2, -0.9]`, below the main hinge plane at Y=1.697856 m. A blade extending
away from that camera can appear to climb on screen even while its tip is below the pin. The
new optional `view=rotorside` puts the camera at the main hinge height. The generic side preset
is unchanged. Before/after screenshots of both views and numerical mesh-tip measurements are
in `work/coning/{before,after}/diagnosis.json` and `s269-120rpm-50N-*.png`.

There is also a real low-speed error in the **published physics pose**. The old `publishBlades`
used the aerodynamic-only harmonic solver's `coning` as total blade flap, omitting blade weight
and mechanical support. At a held, level, collective-down 120 RPM it published +0.462° with
159.178 N total thrust; the weight-aware pose is −0.800°. At zero RPM the aerodynamic coordinate
could retain its previous value. This is a pose error, not a reason to retune operating flight loads.

### Integration and limits

`S269_BLADE_CONING` supplies the 269's own mass integrals, pin offset, zero flap spring and
estimated −2° stop. The full parameter/source table is in [s269-sources.md](s269-sources.md#physical-coning-and-droop-stop-pose-s269coning).
No Robinson mass, inertia, droop-stop setting or EI is copied. The 269 span is rigid in this change;
elastic sag awaits its own EI estimate.

`articulatedBladeConing` calls the shared `bladeConing` **for each blade**. It adds the equivalent
moment of that blade's dynamic harmonic flap to the mean aerodynamic hinge moment before solving
weight, centrifugal and spring balance and applying stops. Away from a stop, individual harmonic
differences are preserved. At zero speed a free hinge rests on its stop even if the airborne
harmonic state is stale. The cone of the rendered rotor is the mean of these physical blade angles.

The simulation supplies `(BEM shaft coning moment − e × total thrust) / 3`, using the existing
resolved radial loading. The preview fallback has only total thrust, so uses the documented 0.75R
arm. Both project gravity into the airframe's shaft-normal direction. Published physical poses
advance on positive-dt physics steps; RK force queries and snapshot restoration preserve them.
Reset also initializes stopped blades on their stops. The renderer consumes supplied flap directly,
with no second coning term, and retains individual lag and pitch transforms. The mean exposure disc
and trail use the same hinge and projected radial extent as the rigid blades.

The aerodynamic `RotorcraftState.coning`, first-harmonic integration, thrust, torque, hub reaction,
inflow and energy budget are untouched. This is a physical pose adapter around the reduced
flight model, not a newly coupled stop-impact or elastic-flapping simulation. In particular, stop
reactions do not feed back into the body/shaft equations. Existing dynamic lag remains zero in
physics, as documented by the earlier rejected lag experiment; the renderer still accepts separate
nonzero lag/pitch per blade.

### Numerical and visual evidence

The seven rows below use the same inputs before and after, with the camera at hinge height,
azimuth 90° and 25° field of view. Low-speed loads come from a held level, sea-level ISA,
collective-down rotor; hover loads/collectives come from the existing converged light/gross trims.
They are frozen **load fixtures**, not screenshots of a dynamically flown hover. The preview
has no per-blade physics state; hence its 0.75R estimate differs slightly from the BEM pose.

| 269 fixture | RPM | Total thrust, N | Old preview mean, ° | New preview mean, ° | New physical BEM mean, ° |
| --- | ---: | ---: | ---: | ---: | ---: |
| Stopped | 0 | 0 | −2.000 | −2.000 | −2.000 |
| Slow | 30 | 9.908 | −1.992 | −2.000 | −2.000 |
| Slow | 60 | 39.790 | −1.966 | −2.000 | −2.000 |
| Slow | 120 | 159.178 | −1.862 | −0.661 | −0.800 |
| Collective down | 462.278 | 2362.255 | 0.759 | 0.515 | 0.377 |
| Light hover | 462.278 | 6246.683 | 2.006 | 1.502 | 1.464 |
| Heavy hover | 462.278 | 7958.278 | 2.556 | 1.937 | 1.917 |

At nominal RPM and **zero** thrust, the new hinge angle is −0.085°: nearly horizontal. At the
reported 120 RPM / 50 N input it is −1.073° (gravity projected through the fixture's 2° pitch).
The stops hold the rigid blades at −2° at rest and very low speeds; leaving the stops is continuous.

The full simulator was also run from `index.html?aircraft=s269&scenario=runway&resume=0`, in calm
weather, with before/after runs at identical times. Its runway spawn uses a quarter-open throttle
and approximately **full rotor RPM**, not a 120-RPM idle. At 20 s it has 462.098 RPM, 1767.508 N,
collective zero and a physical mean of +0.241° (old published mean +0.327°). That small positive
cone is supported by actual aerodynamic loading. After closing the throttle grip at 60 s, it slows
to 218.727 RPM at 80 s, 106.658 RPM at 120 s and 73.991 RPM at 180 s; the new physical means are
−0.056°, −1.273° and −2.000°. It remains on the skids. Screenshots and complete states/controls are
in `work/coning/{before,after}/runway.json` and `s269-runway-*s.png`. The recorded runway
states, controls and summaries are identical before/after when only the physical blade poses
are excluded.

Evidence, all uncommitted in `work/`:

- `work/coning/s269-before-after.png` and `s269-rotor-detail.png`: all seven rows visually inspected.
- `work/coning/r22-before-after.png` and `r22-rotor-detail.png`: merged renderer versus `main`, all
  seven rows visually inspected and **pixel-identical**, using the R22 loads recorded above.
- `work/coning/{before,after}-measure.json`: held-pose and hover measurements.
- `work/coning/{before,after}-dynamics.json`: complete flight-state samples at 0, 41 and 90 kt,
  two seconds each at 240 Hz with cyclic perturbations, omitting only the intentionally changed
  `articulated` blade poses. Files are byte-identical, SHA-256
  `0837674eb3ac83d8606e3e9bdce49a50be106ae2833b3091891b41246a2733d7`.
- Reproduction scripts: `work/measure-coning.ts`, `work/report-coning.mjs`,
  `work/capture-coning.mjs`, `work/contact-coning.py`, `work/runway-coning.mjs`,
  `work/diagnose-coning.mjs`. `work/before` is an archive of pre-change HEAD and `work/main` an
  archive of merged main; captures never overwrite the working source.

### 269 changes and merge resolution

- `src/aircraft/s269/{coning,rotorcraft,visual}.ts`: one shared 269 definition; remove lerp data.
- `src/physics/rotorcraft/{coning,definition,rotorcraft}.ts`: per-blade pose balance, optional typed
  hub parameters, BEM moment transfer, gravity and reset/step publication.
- `src/aircraft/s269/exteriorRotor.ts`: shared fallback, independent poses, matching disc/trail hinge.
- `src/dev/aircraft.ts`: optional camera for unambiguous side-on coning inspection.
- `tests/rotorcraft/s269Coning.test.ts`, `tests/aircraft/s269Exterior.test.ts`: low-speed support,
  continuity, signed load, mass integrals, independent flap, pose/mesh agreement and exposure geometry.
- `docs/s269-sources.md`, this document: sources, estimates, diagnosis and evidence.
- Merge conflicts in `RotorcraftVisual.ts`, `airframe/types.ts` and `rotorcraft/rotor.ts` were resolved
  in their contents, retaining main's coning/bending and the branch's blade count, hub type, tail twist
  and rotation conventions. The merge is left uncommitted and its index unmerged for the supervisor
  to stage. The other incoming Robinson changes are retained.

### 269 verification

- `npm run typecheck`: passed.
- `npx vitest run tests/aircraft/s269*.test.ts tests/rotorcraft/s269*.test.ts tests/rotorcraft/coning.test.ts tests/instruments/s269Panel.test.ts tests/render --maxWorkers=4`:
  **16 files passed, 110 tests passed, two expected autorotation failures**.
- `npx vitest run --maxWorkers=4`: **220 files passed, four skipped; 3043 tests passed,
  six expected autorotation failures, 221 skipped**, in 372.00 seconds. No files timed out.
- Full operating-flight sample files and the runway states/controls (apart from physical blade poses)
  are identical before/after. Snapshot restoration, 269 dynamics, energy and performance tests pass.
- All seven 269 and R22 contact-sheet rows, enlarged rotor sheets, original oblique 120-RPM view,
  hinge-height 120-RPM view, and runway screenshots were opened and inspected. All seven R22
  images are pixel-identical to `main`.
- `git diff --check`: passed. No conflict markers remain in file contents. No commits or staging.

Logs: `work/coning/typecheck.log`, `targeted-final.log`, `full-suite.log`, `measure.log`,
`capture-{before,after,main}.log`, `runway-{before,after}.log`, `diagnosis.log` (same directory).

## Original Robinson changes (main)

| File | Change |
| --- | --- |
| `src/physics/rotorcraft/coning.ts` | Shared per-blade balance, optional springs/stops, gravitational bending and beam shape |
| `src/aircraft/r22/coning.ts`, `src/aircraft/r44/coning.ts` | Explicit physical/estimated parameters using each flight model's inertia |
| `src/aircraft/r22/visual.ts`, `src/aircraft/r44/visual.ts` | Connect the new data and remove the old visual scale |
| `src/render/aircraft/airframe/types.ts` | Typed, structured-cloneable per-blade data contract |
| `src/render/aircraft/RotorcraftVisual.ts` | Use live thrust, shaft RPM and disc-normal gravity |
| `src/render/aircraft/rotorcraft/rotor.ts` | Hinge pivot and bending shared by solid blades, shadows, blur and link attachment |
| `src/render/aircraft/bladeTrail.ts` | Matching trail curve, radius and normals; existing propeller calls remain compatible |
| `tests/rotorcraft/coning.test.ts` | Load response, monotonic droop, near-flat unloaded rotor, continuity and articulated inputs |
| `tests/render/bladeRendering.test.ts` | Blade/disc/trail/pin alignment through spool-up and shutdown |
| `tests/aircraft/r22.test.ts` | Assert the preserved rigid span about the coning pin, rather than the shaft centre |
| `docs/rotor-coning.md` | This report |

## Original Robinson verification (main)

- `npm run typecheck`: passed.
- `npx vitest run tests/rotorcraft tests/aircraft/r22Exterior.test.ts tests/aircraft/r44Exterior.test.ts tests/render/bladeRendering.test.ts tests/render/bladeBlur.test.ts --maxWorkers=4`:
  24 files passed; 182 tests passed and four expected failures.
- After updating the legacy shaft-centred length assertion to the physical coning-pin pivot,
  `tests/aircraft/r22.test.ts`, `tests/rotorcraft/coning.test.ts` and `tests/render/bladeRendering.test.ts`:
  35 tests passed across three files.
- Final `npx vitest run --maxWorkers=4`: **208 files passed, four skipped; 2941 tests passed,
  four expected failures, 221 skipped**, in 329.06 seconds. No timeouts needed individual reruns.
  The four expected failures are the existing R22/R44 autorotation-landing gaps.
- All 16 held-pose/hover measurement records retain identical physics and trim values after the change.
- Both seven-state before/after contact sheets and enlarged rotor sheets were opened and visually
  inspected. An additional R22 180-RPM capture exercised the new trail shader with no browser/shader
  errors (`work/coning/r22-trail-smoke.png`, `work/coning-trail-smoke.log`).
- `git diff --check`: passed. Work remains uncommitted on `render/coning`.

Logs: `work/coning-typecheck.log`, `work/coning-rotorcraft.log`, `work/coning-final-targeted.log`,
`work/coning-full-suite.log`. The first full run caught the obsolete shaft-centre assertion; its log
is retained as `work/coning-full-suite-initial.log`.
