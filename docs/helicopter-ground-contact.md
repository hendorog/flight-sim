# Helicopter ground-contact extension

Branch `heli/contact`, based on `main` **ff242fb1b63f62d1c4c7b6922de1feb63b1a4d87**. This is a reduced contact/physical-blade model with explicit engineering estimates, not structural or handling certification. Flight loads away from the ground are unchanged. Instruments, rendering, reference dimensions and the six autorotation-landing expected failures are untouched.

## Sources and parameter status

Primary references checked for this work:

- [R22 MM, Chapter 5, §5.002, printed 5.1, August 2026](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r22_mm_5_5c4f1b36d2.pdf): ordinary impacts flex the cross tubes; severe impacts yield them and move the struts upward/outward. It gives inspection/replacement criteria, **not** a force–deflection curve or yield load.
- [R44 MM, Chapter 5, §5.002, printed 5.1](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44_mm_5_a1682e91bc.pdf): aluminum cross tubes, steel skid shoes and compliant mounting arrangement. This supports the mechanism, not the coefficients.
- [R22 POH §7, Rotor Systems, printed 7-3](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r22_poh_7_6581e57af0.pdf) and [R44 POH §7, printed 7-2](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44ii_poh_7_e5154ae439.pdf): droop stops provide a friction restraint against teetering during start/stop. No measured restraint torque was obtained. Both were obtained through the current manufacturer [Publications](https://www.robinsonheli.com/publications) index.
- [FAA Helicopter Flying Handbook, printed 10-6/10-7 and 11-12–11-14](https://www.faa.gov/sites/faa.gov/files/helicopter_flying_handbook.pdf): skid alignment and rotor/tailboom clearance on running landings; rollover about a ground pivot; the recovery boundary depends on thrust, loading and roll rate. Its approximate 5–8° discussion is **not** implemented as an angle-triggered failure.
- [Schweizer CSP-C1-1, reissued 16 January 2019, §7-11, printed 7-13](https://cdn.shopify.com/s/files/1/1008/9286/8689/files/Flight-Manual-269C-1-300CB-CBi-CSP-C1-1.pdf?v=1772539456): four nitrogen/hydraulic poppet dampers. [FAA 4H12 rev32, printed p14](https://hub.easa.europa.eu/crt/docs/viewcrdattachment/cid_147701/aid_3224/fmd_d77d76be8ddb66b64737b8fcbd491bdf) specifies 350 psi front and 725 psi aft, as already recorded in [269 sources](s269-sources.md). Charge pressure alone does not identify a dynamic force law.

All new stiffness/yield/friction/soil/oleo geometric and damping coefficients below are **estimates**. No parameter was fitted to an acceptance-test outcome. Existing normal-contact stiffness, linear damping, longitudinal sliding coefficients, main-rotor aerodynamics and aircraft mass/inertia were retained. The oleo implementation was revised during development to retain real precharge against an extension stop, rather than subtracting a fictitious constant preload.

## Cross-tube flexure and plastic work

`skidSuspension.ts` condenses each cross-tube end into a vertical elastic spring/damper and compression plasticity. For total stroke `q`, permanent set `p`, elastic stiffness `K`, yield force `Fy`, and hardening `H`:

```
p_new = max(p_old, (K q - Fy)/(K + H))
F_elastic = K max(0, q - p_new)
F_normal = max(0, F_elastic + C qdot)
E_stored = 0.5 K max(0,q-p)^2 + 0.5 H p^2
Delta E_yield = Fy (p_new - p_old)
```

The yield work is irreversible; the hardening term remains stored energy. Damping work uses the actual unilateral force, so contact never pulls the aircraft into the ground. Plastic collapse raises and spreads the actual contact point, with its world position, velocity and reaction arm using the same geometry. Elastic spreading is a diagnostic condensed into vertical stiffness; a lateral flexible-body mode is not claimed. Reset clears deformation/history. As with the existing tangential anchors, gear plastic/heat history is local to `SkidGear` and is not serialized in flight snapshots; persistent damaged-gear save/resume remains future work. Ordinary elastic rest geometry remains unchanged. At zero CG offset and each type’s gross mass, audited Robinson resting height/pitch are exactly unchanged. The 269 gas-supported rest is 3.9 mm lower and 0.47° less nose-up than its former linear surrogate; no reference dimension was moved to compensate.

| Per contact | R22 | R44 |
| --- | ---: | ---: |
| Existing elastic stiffness, N/m | 65,000 | 110,000 |
| Existing linear damping, Ns/m | 2,200 | 3,600 |
| Estimated yield force, N | 4,500 | 8,500 |
| Estimated hardening modulus, N/m | 6,500 | 11,000 |
| Estimated maximum total stroke, m | 0.25 | 0.25 |
| Estimated outward spread / stroke | 0.5 | 0.5 |

The yield loads correspond approximately to three times each aircraft's gross static quarter-load. The existing sink-rate inspection/crash threshold remains 3.5 m/s; crossing it does not suppress the computed contact force or plastic work in that evaluation. At gross mass, the existing four-contact heave stiffness corresponds roughly to 3.3 Hz on the R22 and 3.1 Hz on the R44. Those are consequences of the retained estimates, not measured landing-gear modes.

The load/unload test independently integrates force over displacement and compares the work with plastic dissipation plus hardening energy. A gravity/drop fixture checks diminishing energy residual when its timestep is halved. `dt=0` force probes do not commit plastic history or heat.

## Soil, toes, edges and rollover

Existing anisotropic friction and static anchors remain. Forward sliding coefficients are still **0.20 grass / 0.30 pavement**. Broadside soil bearing adds `passiveStress × embedDepth × contactSegmentLength` to lateral capacity, with `embedDepth = min(tubeRadius, normalLoad/bearingStiffness)`. The existing anchor return map represents sticking at a pivot until the friction/ploughing capacity is exceeded. There is no separate roll assist or attitude clamp.

| Surface estimate | Bearing stiffness per contact, N/m | Passive lateral stress, Pa |
| --- | ---: | ---: |
| Grass | 500,000 | 60,000 |
| Dirt | 800,000 | 90,000 |
| Snow | 100,000 | 10,000 |

Paved surfaces acquire no synthetic soil ploughing. Both tube edges and the upturned toe/heel query actual terrain. A tangent-plane subtraction distinguishes a smooth slope from a ledge; a bisection locates the obstacle face. Horizontal penetration into that face produces a unilateral **80,000 N/m, 1,800 Ns/m** spring/damper reaction at the toe/edge. Tube radius is 30 mm for the Robinson estimates and the existing 28 mm for the 269; toe rise is estimated at 100 mm. Contact can remain against a ledge after the foot has lifted off the floor, and ends when it clears the obstacle.

A constrained one-skid slope fixture checks the critical angle from the actual moments of weight and thrust with full opposite cyclic. Production gear forces have zero moment about that same skid pivot. Integrating the pivot equation above the computed boundary grows the roll; reducing thrust recovers. This is a mechanism test, **not a measured critical-angle validation**. Existing full-flight lateral-drift/benign-landing, six-degree parking and grass/pavement run-on tests remain the broader dynamic checks.

The inherited lateral coefficient is still an estimate; its historical soil contribution was not independently measured, so the partition between base friction and explicit ploughing requires validation.

Remaining terrain limits: finite probe spacing; no stones/vegetation unless represented by the terrain height field; no changing ruts, soil failure history, buried obstacles or measured soil constitutive law. Contact compliance is a reduced four-station system, not a flexible finite-element skid assembly.

## Blade sailing, friction and airframe contact

`groundRotor.ts` adds an optional `contactRotor` state for the two-bladed teetering hubs. It is deep-copied in snapshots and cleared by rotor reset. The existing `flapForward`, `flapRight`, `coning`, aerodynamic loads and shaft work retain their original arithmetic. `SkidGear` advances the new state once per real step in the ground envelope (reference height below skid height plus one rotor radius); intermediate RK queries only read it. On leaving the envelope the optional state is removed.

The slow teeter coordinate obeys a second-order oscillator with centrifugal stiffness `I Omega²`. Twelve radial sections per blade sample the actual azimuth and signed tangential wind velocity, including reversed flow. Aerodynamic damping comes from the same section slope. There is no singular advance-ratio denominator in this calculation. Two opposed blade moments drive teetering; the sum of loaded droop-stop moments supplies a Coulomb torque limit with an **estimated effective friction/leverage ratio 0.16**. Loaded stops stick below breakaway torque and release as lift/centrifugal loading unloads them. Implicit midpoint integration includes an event for coming to rest, and inelastic teeter-stop projection removes energy. The retained stop angle is 12°.

The physical blade path combines:

1. Existing harmonic flap (which already includes cyclic response).
2. The separate low-speed teeter pose, blending into the existing harmonic pose over 30–50% reference RPM. This is a model handover, not a physical instability boundary.
3. Shared blade-coning/droop/sag parameters, including normal support acceleration during an impact.
4. Azimuth-resolved collective/cyclic pitch and twist at both chord edges; cyclic is not counted again as an extra disc tilt.

The Robinson coning parameter modules were made independent of the rotorcraft definition to avoid a circular import. Their numbers are unchanged: R22 12 kg/blade, EI 3,600 Nm², −1° droop; R44 21 kg/blade, EI 12,000 Nm², −1° droop. The 269 retains its rigid 15 kg/blade, −2° estimate and has no added elastic sag.

A tapered tailcone and cabin ellipsoid use the existing three-view/visual estimates, without modifying rendering or reference geometry. Intersections report **`Main rotor / tailcone strike`** or **`Main rotor / cabin strike`**. A mast-bump flag alone never creates a geometric strike. The running path uses 64 azimuths, 33 radial stations and three chord locations; the slow teeter path uses the actual blade azimuths. A conservative height bound avoids expensive sampling when the whole path is clear. The existing eight-point terrain rotor-rim check and stinger-first flare geometry remain.

Calm startup/shutdown and normal-RPM circular full-cyclic sweeps are checked on all three types, plus six-degree relative-disc slope poses. A stopped R22 exposed to an 18 m/s lateral wind with aft cyclic reaches the estimated tailcone envelope through the sailing equation without an injected flap angle. This is an intentionally adverse test, not a published wind limit. Other bad-case tests exercise geometric excessive aft flap and show that a damage flag alone does not produce a strike.

Limitations: sailing/stop reactions are a **physical contact pose**, not a new closed rotor/body/shaft energy model; no elastic transient blade modes, mast failure geometry, damage propagation or sail rendering is added. The ground-only collision extension does not change airborne failures. The existing running teeter-stop/mast-bump classification is unchanged (including its estimated stop angle); the full-cyclic tests isolate false *airframe intersections*, not a revalidation of that older failure rule. Finite collision envelopes/sampling and undimensioned cabin/tail geometry still need survey and validation. Cold-wind harmonic tests remain valid because physical sailing does not replace aerodynamic disc coordinates.

## 269 oleos and lag boundary

Four effective vertical supports use absolute nitrogen pressure `P = P0 (L/(L-s))^1.3`, force `A(P-Patm)`, and the analytic gas-energy integral. A **400,000 N/m** foot/cross-member spring acts in series. Before the foot force reaches precharge, the strut remains on its extension stop; above breakaway, the massless support solves equality of gas and foot forces. Thus preload is retained without a discontinuous force at touchdown. `restingPose` uses the inverse force law so a normal loaded spawn starts at its gas-supported attitude.

Published front/aft gauge pressures are 350/725 psi. **Estimated effective** area is 0.00025 m², gas length `V0/A` is 0.08 m and usable gas stroke is 0.06 m. These include mount leverage; they are not actual bore or HMI stroke dimensions. A linear bump stop avoids a gas-volume singularity. The prior linear damping remains; hydraulic metering adds `c v |v|`, with compression/rebound coefficients **1,800/3,000 N s²/m²**. The estimated poppet relief opens at **4,500 N**, then adds **400 Ns/m** of post-opening resistance. Every damping branch dissipates work; rebound cannot make the ground pull down. The maximum-contact-depth crash threshold is a conservative estimate, not a certified oleo bottoming load.

Gas force/energy differentiation, inverse stroke, progression, rebound, relief and ordinary scenario spawns are checked. Healthy/degraded HMI force–stroke–velocity curves, seal friction, temperature, fluid aeration, true mount leverage and strut stroke animation remain unvalidated/unimplemented.

**Production lag remains zero and ground resonance remains undone.** The [round-2 audit](s269-round2.md#lead-lag-why-the-rejected-experiment-is-still-unsuitable) demonstrates both missing body-rotation work terms and an unstable assumed rotor/support combination in the rejected experiment. New gas springs do not close those equations or identify healthy damper coefficients. The isolated, work-balanced `stepLag` stays a research helper. No RPM cutoff, arbitrary stabilizing damping, shake effect or resonance timer was introduced.

## Verification and reproduction

`tests/rotorcraft/groundContact.test.ts` contains the new mechanism and safety checks. `tests/rotorcraft/contactAirborne.test.ts` captures 12 exact baseline cases: all three helicopters at cold/hover/forward/undriven shaft conditions, 1,920 evaluations each. Independent original `main` sources and definitions were extracted into ignored `work/contact/main/` with `git archive`; results match exactly for **23,040** load/rotor/power/drive/gear evaluations. Six additional integrated airborne traces (three aircraft, hover and 30 m/s, 480 steps each) match complete flight-state JSON exactly for **2,880 steps**. The original six Robinson digest tests are unchanged.

Scratch evidence is under `work/contact/`: independent baseline harness/config, JSON hashes, flight comparison, adverse-case probes, source PDFs/text and logs. These files are deliberately uncommitted/ignored. The new tracked hash regression can run without that scratch directory. Verification commands and completed evidence:

- `npx tsc --noEmit`: clean (`work/contact/typecheck-complete.log`).
- `git diff --check`: clean.
- New mechanism + original contact/stopped-rotor focused run: **43 passing**; new mechanism + contact + airborne hash run: **44 passing**. The new files contain 22 mechanism tests and 12 airborne digest tests.
- Additional scratch audit: RK queries leave all suspension/heat diagnostics unchanged; reset clears history; 240/480/960 Hz gust histories converge (R22 angle 0.0104150 / 0.0103375 / 0.0102991 rad; R44 −0.0084837 / −0.0085299 / −0.0085526 rad at 2 s). See `audit.json`.
- Full `npx vitest run --maxWorkers=4`: **224 passing files, 4 skipped; 3,094 passing tests, 6 expected failures, 221 skipped** in **414.27 s**, with no timeouts (`work/contact/full-suite-final.log`). **Final rerun after the last edge-velocity/envelope corrections:** the same **224 passing files / 3,094 passing tests / 6 expected failures / 221 skipped**, in **437.35 s** (`work/contact/full-suite-complete.log`). There were no timeouts and no files required timeout reruns.

The first full run began before the teeter sticking-event correction and ended with that new test failing (3,081 passing, six expected failures, 469.99 s). The corrected focused runs and subsequent full run pass. No acceptance tolerance or existing expected-failure declaration was changed. The new explicit zero-velocity event removes the small alternating rate rather than relaxing the test.

## Changed files

- `src/physics/rotorcraft/skids.ts`: support, soil/edge reactions, ground blade state and collision integration.
- `src/physics/rotorcraft/skidSuspension.ts` and `groundRotor.ts`: new constitutive/physical-pose helpers.
- `src/physics/rotorcraft/definition.ts`: optional parameters/state and deep cloning; `rotorcraft.ts`: reset of the optional state only.
- `src/aircraft/{r22,r44,s269}/rotorcraft.ts`: contact/oleo/blade-envelope estimates; `src/aircraft/{r22,r44}/coning.ts`: import-cycle removal with identical numbers.
- `tests/rotorcraft/{groundContact,contactAirborne}.test.ts`: new mechanism and exact baseline checks. Existing tests/expected failures were not edited.
- `docs/{known-issues,r22-flight-model,r44-flight-model,s269-flight-model,helicopter-ground-contact}.md` and the three aircraft `KNOWN_ISSUES.md` files: status, parameter provenance and remaining limits.

All changes are left **uncommitted**. No instrument, compass, rendering, main aerodynamic calculation, or shared reference-dimension file was edited.
