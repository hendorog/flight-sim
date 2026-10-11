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

- `work/coning/r22-before-after.png`, `r44-before-after.png`: seven side views, before and after.
- `work/coning/r22-rotor-detail.png`, `r44-rotor-detail.png`: the same comparison focused on the rotor.
- `work/coning/before.json`, `report.json`, `report.txt`: measurements, including complete-model ground runs.
- `work/capture-coning.mjs`: captures the original HEAD through a Vite transform for `before`, so it does
  not need to overwrite or revert the working tree; `after` uses current source. Both use identical inputs.
- `work/report-coning.mjs`, `work/measure-coning.ts`, `work/report-coning.ts`, `work/contact-coning.py`:
  reproduction and contact-sheet assembly. Run from the repository root.

## Schweizer 269 follow-up

Call `bladeConing` for each articulated blade with its own signed thrust or, preferably, integrated
aerodynamic moment **about that blade's flap hinge**. Supply the 269's blade mass/CG/inertia, radial
hinge offset, spring stiffness/rest angle if applicable, actual droop/coning stops and flexible-span
EI. Do not copy the Robinson mass or stop estimates, and do not divide rotor inertia by two: use the
269's actual blade count and remove hub inertia if measured per-blade inertia is available. To convert
a measured hinge inertia to the API's shaft inertia, add `2 m e (rcg − e) + m e²`.

The shared equilibrium is not a three-blade dynamics integrator. Its renderer still needs separate
flap transforms and sag per blade, plus phase-resolved pitch/lead–lag as provided by that aircraft's
model. Preserve dynamic flap harmonics around the equilibrium without adding mean coning twice.
The current `TeeteringRotor` is deliberately still a two-blade renderer; its common trail/disc
describes symmetric coning, so individual articulated-blade poses need the 269's rendering path.

## Changed files

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

## Verification

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
