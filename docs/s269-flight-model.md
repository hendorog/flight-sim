# Schweizer 269C-1 / 300CB flight-model work

Shared-integration follow-up: [s269-integration.md](s269-integration.md) records the connected controls/sensors, corrected tail, RPM pilot fix, current ceiling residuals and rejected coupled-lag experiment. The worker-stage results below are historical where that record supersedes them.

This branch implements a **reduced articulated airborne hub**, not the complete three-blade multibody model requested for final acceptance. The aircraft remains hidden and `placeholder: true`. Offset-hinge moments, first-harmonic flap phase/rate response, a coning envelope, manual engine operation and a three-position clutch API are implemented. An isolated lead-lag/damper integrator is tested, but **it is not connected to the production rotor, fuselage or drivetrain**. Ground resonance, full transient blade/body angular-momentum conservation and complete blade-energy accounting remain unresolved. Passing the tests below does not remove these limitations.

The selected installation remains the carburetted HO-360-C1A, S/N 0106–0138, two seats/right PIC, one 33 US gal tank (32.5 usable), without STAR or a governor. No chooser, panel, exterior, reference or geometry contract was changed. No startup lesson or demo was enabled.

## Sources and installation data

The cached CSP-C1-1 RFM, FAA 4H12 revision 32 and theoretical references are indexed in [s269-sources.md](s269-sources.md). Both carburetted hover chart images were viewed: Figure 5-3, printed page 5-4, is **full rich**; Figure 5-4, printed 5-4.1, is **leaned**. Both specify 2700 engine RPM, full throttle, carb heat off, two-foot skid height, upstack exhaust and no main-blade abrasion tape. Neither is an OGE or doors-off chart.

An additional primary source was downloaded and inspected: [Lycoming operator's manual 60297-12](https://www.lycoming.com/sites/default/files/file/2025-11/60297-12%20-%20O-360%2C%20HO-360%2C%20IO-360%2C%20AIO-360%2C%20HIO-360%2C%20and%20TIO-360%20Series.pdf). Section 2-2 gives HO-360-A/C displacement 361 in³, compression 8.5:1 and 180 hp at 2700 RPM. Figure 3-39, printed 3-53, explicitly includes HO-360-C1A and shows approximately 14.8 US gal/h minimum allowable fuel flow at 100% rated power. The viewed figure is `work/s269-fm/lycoming-fuel.png`.

The engine uses the published minimum-flow boundary as its full-rich rating anchor, **not a measured carburettor flow curve**. This replaces the inherited enrichment that predicted 13.45 gal/h at rated power, below that source boundary. Generic combustion, intake/exhaust, carb heat/icing, primer/intake film, cooling fan, oil/CHT and altitude mixture behavior are still approximations. No separately measured cooling-fan shaft demand is available. WOT is calibrated to 180 hp at SL/15°C; this installation has no Robinson MAP derating or five-minute rating split.

Limits retain 1750 lb maximum, FS95–101 longitudinal CG, lateral −2.5/+4 inches, 442–471 powered rotor RPM and 390–504 unpowered RPM. The RFM engine minimum is 2530 RPM; FAA 4H12 says 2534. That conflict is not resolved. Existing Vne data and the panel's exported placard were left unchanged.

The sample empty aircraft remains 1105 lb at FS100.7/lateral +0.6 inch. This is one RFM example, not a factory guarantee. `s269Occupants` preserves separate point masses at the frozen seat arms. Maximum-gross loading is two 225 lb occupants and full usable fuel; solo is a 170 lb right-seat pilot. Empty inertia 300/750/650 kg·m², vertical mass locations and the point-mass approximation remain estimates. The maximum-gross and solo presets stay within the published CG rectangle through fuel burn.

## Articulated equations and limits of the reduction

`src/physics/rotorcraft/articulated.ts` is a separate mathematical path. Only `hubModel.kind === 'articulated'` selects it. The original teetering operations, inputs and their order remain unchanged. `RotorcraftState` has no new fields or changed meanings. `definition.ts` has a comment correction only.

Each blade is estimated as 15 kg distributed uniformly from 0.65 m to the frozen 4.088892 m tip. The polar inertia is the sum of these three blade integrals; it excludes a separately invented hub allowance. Flap/lag first moments and inertias are integrated about the **distinct** frozen 0.18/0.22 m pins. These offsets, blade mass, mass distribution and root cutout are unmeasured. Total polar inertia divided by blade count is not substituted for hinge inertia. The assumed distribution is stated both in the aircraft data and the generic moment estimator.

For flap angle beta positive upwards, azimuth psi increases CCW viewed from above, with radial direction `(cos psi, -sin psi, 0)` in FRD. The harmonic disc is

```
beta = beta0 + bc cos(psi) + bs sin(psi)
disc axis proportional to (-bc, +bs, -1)
K = Omega² (Ibeta + e Sbeta)
nu_beta/Omega = sqrt(1 + e Sbeta/Ibeta)
```

The Lock-number convention is gamma = rho a c R^4 / Ibeta, with the per-blade inertia about the flap pin. The code uses dimensional damping quadrature rather than replacing the cutout/offset integrals with an uncorrected R^4 term.

Normal-force quadrature uses the actual flap-pin moment arm and signed tangential relative speed. This avoids a division by advance ratio during startup. The hinge forcing remains an attached-flow approximation; stall/reverse-flow polars in the separate mean-load BEM do not supply a complete retreating-blade hinge-load model. Lift slope 5.7/rad, Cl cap 1.25, profile Cd 0.011, induced drag 0.01 and induced velocity factor 1.15 are engineering estimates for the NACA0015 rotor, not a measured section dataset. The mean-disc BEM still uses free-harmonic unloading, an explicit approximation when the hinge has finite offset. Mach/Reynolds effects and elasticity are absent.

Retaining first derivatives of the harmonic amplitudes while omitting their second derivatives gives, with rotation sign s:

```
[C,  2s Ibeta Omega] bDot + [K-Ibeta Omega²,  s C Omega] b = M
[-2s Ibeta Omega, C]        [-s C Omega, K-Ibeta Omega²]
```

The constant-coefficient matrix exponential advances the two existing flap scalars once at RK stage zero. Zero-dt force queries hold them. The off-diagonal terms produce phase detuning/precession. Body p/q forcing includes the integrated `2 omega_body × velocity_blade` term; body yaw transports the harmonic coordinates. The coning scalar retains the slow decay pole/envelope of the damped flap equation; its oscillatory mode is absent. The rationalized overdamped pole tends to K/C at low RPM, avoiding the unbounded M/K equilibrium that initially caused a false stopped-rotor strike. There is no attitude clamp, fixed RPM gate or blade-angle clamp in this path. Stopped-blade gravity, droop stops, hinge sequence and airframe clearance still need a full blade model and actual hardware data.

The leading offset-hinge moment is

```
(Mx, My) = (B/2) e Sbeta Omega² (bs, bc)
```

It survives unloading at finite RPM; it is not multiplied by rotor thrust. The teetering mast-bump trigger is not applied to this hub, and `teeterAngle` stays zero. Cyclic is currently a symmetric 7° equivalent pitch-link command with an estimated 90° mechanical linkage phase. The resulting **aerodynamic** flap phase is not fixed at 90°. RFM 1-10 gives forward 8.5–9.5°, aft/left 6.5–7.5° and right 4.5–6.5° (FAA forward upper 9.75°); these asymmetric stops and the exact pitch-link geometry are not represented; the 0.75R collective setting is 2.5° down plus 12° travel with an unverified fixture-to-section datum.

Hub/body work is exposed separately as `articulatedPower.hub`; its opposite shaft port enters rotor torque. It is a work transfer in a reduced model without a flap kinetic-energy store. The body integrator's rigid-disc `omega_body × H` subtraction is cancelled once, just as required when explicit hinged-hub reactions are supplied. Rate/phase response comes from the articulated equations rather than keeping that rigid-disc term as a second bending load. The existing total mechanical-energy audit closes with the hub work port included. **This does not establish conservation of the omitted blade kinetic energy or total angular momentum in a fully coupled rotor/body system.** Mean polar inertia and disc angular momentum remain simplified.

## Lead-lag and ground resonance: not production-ready

`stepLag` implements a small-angle single-blade research DOF:

```
Izeta zetaDDot + c a² zetaDot + (k a² + Omega² el Slag) zeta
  = Maero - (Izeta + el Slag) OmegaDot + 2 Izeta Omega beta betaDot
```

Its implicit-midpoint step has a discrete work balance including kinetic energy, positive elastic/centrifugal potential, forcing work and nonnegative damper dissipation. Tests cover coning-Coriolis and shaft-acceleration signs, zero RPM, undamped conservation and 240/480/960 Hz convergence. Estimated effective damper arm is 0.12 m, local stiffness 35,000 N/m and viscous coefficient 8,000 Ns/m. These are **not measurements of elastomeric PN269A1290-3**, and Kelvin–Voigt behavior does not reproduce its temperature/amplitude/frequency hysteresis. The function accepts separate supplied parameters; it is not a universal stabilizing clamp.

There are no persistent per-blade lag coordinates in production. Consequently no regressive/progressive in-plane rotor modes, rotor mass-centre displacement or lag reaction forces are exchanged with the airframe. The isolated oscillator must not be advertised as implemented helicopter lead-lag dynamics. Actual hinge sequence, blade inertia, damper geometry/law and a joint body/blade integration and save-state contract are prerequisites for wiring it in.

Ground contact continues to use the existing skid/tail solver with frozen contacts. It does not model the four gas/poppet oleos, gas energy, load/stroke laws, lift-off mode coupling or degraded-damper ground resonance. The published 350/725 psi charges and inspection lengths are insufficient to derive those laws. The additional primary-source search found FAA/NTSB references to load/stroke inspections, not the needed applicable HMI curves. No artificial shake, resonance RPM window or crash timer was added. Keep the aircraft incomplete for this hazard.

## Drivetrain and controls

The shared freewheel retains its one-way angular-momentum impulse. The governor gate remains false even if a stale switch/save requests it; no low-RPM light/horn is invented for the no-STAR aircraft. Transmission efficiency 0.94, clutch actuator time 45 s, belt capacity 520 Nm, correlator 0.3, engine rotating inertia 0.55 kg·m² plus carrier inertia, and pulley ratios from rounded RPM limits are estimates, not Schweizer measurements.

`Rotorcraft.drive` accepts an optional fifth argument `'engage' | 'hold' | 'release'`. HOLD preserves engagement while the engine/rotor continue to move. Bus loss stops actuator motion. Calls without that argument execute the existing boolean command path exactly. `clutchLight` remains actuator movement. The separate read-only `clutchDisengaged` getter is an estimated end-switch at engagement <0.999; presentation must combine it with bus power and must not rename the existing actuator light. The actual microswitch position is unmeasured.

The shared core control schema, bindings and panel are supervisor-owned and were not edited. Production still exposes its old two-position clutch control until the supervisor supplies this argument. The cold-start test supplies it through an explicit test bridge; that test is not evidence that the app has a usable HOLD switch. Spring trim is still metadata/input position, with no spring-force or trim-motor simulation. Tail pitch remains the RFM −12°/+26° midpoint limits with its published −8° twist. The single canted stabilizer remains the scaffold's projected surface approximation, without full lateral-force coupling.

## Reproduction and acceptance evidence

```
npx tsc --noEmit
S269_TRACE=1 npx vitest run tests/aircraft/s269Physics.test.ts tests/rotorcraft/s269*.test.ts --maxWorkers=4
S269_TRACE=1 npx vitest run --maxWorkers=4
npx vitest run --config work/s269-fm/vitest.config.ts work/s269-fm/legacy-regression.test.ts --maxWorkers=4
```

The ignored legacy directory contains original solver files copied before modification. Six direct R22/R44 comparisons cover governor/manual input, clutch release/bus loss, low RPM, angular rates, opposing cyclic commands and zero-dt stages. The tracked `s269Legacy.test.ts` also compares SHA-256 digests of every serialized output in 960 force evaluations per case against those original sources (5,760 evaluations total), preserving exact numeric bits as represented by round-trippable JSON. Existing R22/R44 tests are unchanged.

The 269 tests use ordinary pilot controls at 1/240 s, with no force assist, rotor-speed clamp or in-flight state reset. The test pilot moves the manual throttle using tach value/trend. Fixed-pose trim tests solve all six force/moment residuals; trim convergence demonstrates numerical authority, not measured handling. Whole-aircraft airborne energy/work error is checked against the same 10 W limit as the existing R22/R44 audit. Omitted blade/oleo energy is not in that budget.

Final counts and viewed browser captures are recorded below.

### Numerical observations (predictions unless a source target is identified)

At SL/15°C, 2700 RPM and a 300 W accessory load, WOT gives **179.598 hp**, 14.800 US gal/h and 28.599 inHg MAP. The corresponding pre-accessory rating is 180 hp. Fuel flow away from this anchor is not independently calibrated.

| SL/15°C OGE loading | Hover hp | 20 KIAS | 40 KIAS | 60 KIAS | 90 KIAS |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1750 lb | 163.0 | 123.8 | 96.4 | 99.9 | 144.7 |
| Solo / half fuel | 125.6 | 94.5 | 78.8 | 87.2 | 134.9 |

All 24 CG-corner trims converge at 1400/1750 lb and 0/41/90 KIAS. Maximum residual is 8.97e-05, and maximum absolute cyclic/pedal command 0.612. Virtual ballast places the CG exactly at each rectangle corner; these are not selectable passenger arrangements.

### Hover charts: acceptance gap remains

The table compares hand-read RFM IGE ceilings (approximately ±200 ft digitization) with numerical power-balance roots. Model OGE roots have **no retrieved CB chart validation**. The test records residuals and checks finite solutions/IGE benefit; it does not assert POH agreement or enlarge the digitization allowance to hide model error. Leaned cases maximize the model's mixture power over stated lever samples, not a documented Schweizer lever schedule.

| Weight lb | OAT °F | Mixture | IGE chart ft | IGE model ft | OGE model ft | Power error at chart |
| ---: | ---: | --- | ---: | ---: | ---: | ---: |
| 1750 | 0 | Full rich | 6300 | 5883 | 3633 | +2.21% |
| 1750 | 0 | Leaned | 6800 | 6445 | 3914 | +1.84% |
| 1750 | 40 | Full rich | 4100 | 4570 | 2320 | -2.40% |
| 1750 | 40 | Leaned | 4500 | 5180 | 2648 | -3.26% |
| 1750 | 80 | Full rich | 1900 | 3305 | 1055 | -7.12% |
| 1750 | 80 | Leaned | 2500 | 4055 | 1523 | -7.04% |
| 1600 | 0 | Full rich | 8000 | 7758 | 5602 | +1.43% |
| 1600 | 0 | Leaned | 8600 | 8555 | 6070 | +0.22% |
| 1600 | 40 | Full rich | 5800 | 6398 | 4242 | -3.33% |
| 1600 | 40 | Leaned | 6300 | 7336 | 4852 | -4.98% |
| 1600 | 80 | Full rich | 3500 | 5133 | 2977 | -8.65% |
| 1600 | 80 | Leaned | 4300 | 6258 | 3727 | -8.84% |

Worst absolute IGE ceiling error is 1958 ft; worst power residual at a chart point is 8.84%. The hot/high optimism remains a material performance failure. No induced-loss, inertia, pitch-stop or engine-altitude coefficient was fitted to remove it. Needed evidence includes installed cooling/fan demand, actual polars/wake and full-rich altitude behavior.

### Starts, approaches and autorotation

The cold integration starts with a small 0.05 grip opening, carburettor mixture full rich and the generic starter. It does not reproduce a manual primer. After setting 1500 RPM, it holds the grip fixed, pauses clutch motion for two seconds after each approximately 100 RPM drop, and resumes with a new drop reference. The RFM requires ENGAGE/HOLD staging; the two-second pause is the test pilot's timing, not an RFM value. The test explicitly supplies the new clutch argument because the production control bridge is absent.

Engine firing occurs 0.217 s after cranking begins; full belt engagement at 74.96 s after the test begins, with 5 HOLD pauses. Hover begins at 124.96 s. At 169 s: height 3.0004 m, ground speed 0.0022 kt, engine 2650.7 RPM, rotor 462.41 RPM, CHT 126.8°C, oil 62.7°C/80.0 psi. Governor and STAR horn stay false. Warm/flooded restarting and electrical spring trim were not accepted.

**Ground-geometry limitation:** the cold solo case registers a light `stinger-touch` before rotor engagement, retained in the latched report through hover. It does not crash. The estimated stinger/contact geometry and scalar gear compliance need supervisor review; this is not accepted as a demonstrated real parked-aircraft condition. Frozen geometry was not moved to make the test pass.

| Powered approach | Touchdown time s | Speed kt | Sink m/s | Pitch ° | Rotor RPM |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1750 lb | 118.01 | 0.068 | 0.059 | -0.82 | 465.5 |
| Solo | 117.66 | 0.057 | 0.047 | -0.15 | 463.0 |

Both powered approaches decelerate from 60 KIAS/90 m to a 3 m hover, land, lower collective and centre cyclic, and stop without damage or tail contact. Centring cyclic matters: the offset hub continues transmitting bending after unloading. Holding airborne hover cyclic after touchdown produced a light gross-case stinger touch in the earlier experiment. Manual throttle is controlled only by the test pilot; the aircraft has no governor.

The gross approach contains a brief powered overspeed: the 1 Hz trace reaches 2711.2 engine RPM / 472.95 rotor RPM, above the 2700/471 limits. The landing test passes its touchdown criteria but does not claim the entire approach stays inside every RFM limit. No RPM clamp hides this test-pilot excursion.

| Steady autorotation at RFM approximately 52 KIAS | Actual IAS kt | Rotor RPM | Sink ft/min | Collective |
| --- | ---: | ---: | ---: | ---: |
| 1750 lb | 53.31 | 450.0 | 1612 | 0.052 |
| Solo | 53.19 | 418.1 | 1576 | 0.000 |

Both have zero engine RPM and zero drive torque. The pilot aims for 450 rotor RPM; the solo case reaches its low-collective stop below that target while remaining inside the 390–504 band. There is no sourced CB universal sink-rate target, so the predicted sink rates are not advertised as RFM validation.

The two strict autorotation-landing tests are deliberately expected failures. They adapt the existing R22/R44 continuous flare policy to the RFM approximately 52-KIAS target and the CB RPM band, from 350 m. The controller's predictive flare and levelling heights remain test-policy choices, not exact RFM 50/10-ft procedural validation. Normal companion tests require a finite trajectory through contact or detected damage.

| Attempt | Result | Touchdown speed | Sink | Touchdown rotor | Peak rotor |
| --- | --- | ---: | ---: | ---: | ---: |
| 1750 lb | Contact, no crash, later stinger touch | 21.10 kt | 1.09 m/s | 432.5 RPM | 479.5 RPM |
| Solo | Tail stinger impact before skid touchdown | — | — | — | 462.2 RPM |

The gross attempt is much too fast at touchdown; the solo attempt strikes the stinger. These observations do not identify a single solver cause. The full-state rotor, unmeasured inertias/polars and the generic pilot policy remain candidates. No repair of the shared autorotation-flare limitation was attempted. Existing R22/R44 expected failures are untouched.

### Resolution and parameter sensitivity

Two seconds of continuous longitudinal/lateral cyclic excitation at 41 KIAS were integrated at 240, 480, 960 and 1920 Hz. The scalar errors combine attitude radians, RPM/471, height/100 m and speed/50 m/s; they are numerical diagnostics, not flight-test tolerances.

| Integration rate | Error relative to 1920 Hz |
| ---: | ---: |
| 240 Hz | 5.88187e-05 |
| 480 Hz | 2.52098e-05 |
| 960 Hz | 8.40355e-06 |

240 versus 1920 Hz differs by 0.00329° pitch and 0.000723 rotor RPM. Isolated flap integration reaches the analytic harmonic solution at all three requested rates, and the lag midpoint integrator closes work within 1e-9 J in the exercised fixed-RPM cases. This does not establish contact/ground-resonance convergence because that coupled system is absent.

| Assumed uniform blade mass | Hover coning | Hover hp | Elevator command |
| ---: | ---: | ---: | ---: |
| 12 kg | 2.501° | 163.013 | 0.1124 |
| 15 kg | 2.001° | 163.013 | 0.0984 |
| 18 kg | 1.667° | 163.012 | 0.0875 |

The nearly unchanged steady power does not validate inertia: coning and control trim change materially. For the isolated estimated damper, halving/doubling viscous coefficient halves/doubles the decay exponent while leaving its spring/centrifugal natural frequency unchanged. No healthy/degraded ground-resonance boundary is claimed from that sensitivity.

## Supervisor handoff and file ownership

| File(s) | Change |
| --- | --- |
| `src/physics/rotorcraft/articulated.ts` | Separate hinge integrals, harmonic forcing/phase, flap/coning envelopes, hub reactions and isolated lag midpoint kernel. |
| `src/physics/rotorcraft/rotorcraft.ts` | Articulated selection, work ports and optional stateless three-position clutch command/disengaged getter; preserves teetering arithmetic. |
| `src/physics/rotorcraft/definition.ts` | Comment only: describes the new reduced path. No state or parameter extension. |
| `src/aircraft/s269/articulated.ts` | Explicit uniform-blade/damper estimates. |
| `src/aircraft/s269/rotorcraft.ts` | Uses those blade integrals, stated analytic polar/drag estimates and symmetric cyclic approximation. |
| `src/aircraft/s269/powerplant.ts` | HO-360-C1A identity, displacement, rating and source-backed rated fuel anchor. |
| `src/aircraft/s269/mass.ts` | Independent occupant point masses and full-gross loading. |
| `src/aircraft/s269/limits.ts` | Absolute-RPM/CG helper exports; Vne placard unchanged, shared RPM values imported. |
| `src/aircraft/s269/index.ts` | Updates incompleteness disclosures; placeholder stays enabled. |
| `tests/aircraft/s269Physics.test.ts` | Installation, source-data, geometry and loading checks. |
| `tests/rotorcraft/s269Articulated.test.ts`, `s269Dynamics.test.ts` | Analytic cases, isolated lag work, low-RPM/zero-dt behavior, phase/yaw, low-g moment, time-step and mass sensitivity. |
| `tests/rotorcraft/s269Energy.test.ts` | Existing work audit adapted to the explicit hub work port. |
| `tests/rotorcraft/s269Flights.test.ts` | Cold-start bridge, clutch/bus/freewheel, auto descent, powered approaches and two expected flare failures. |
| `tests/rotorcraft/s269Legacy.test.ts` | Frozen-output R22/R44 regression digests. |
| `tests/rotorcraft/s269Performance.test.ts` | Engine/power/CG and transparent hover-chart residuals. |
| `docs/s269-flight-model.md` | Equations, source applicability, evidence and remaining gaps. |

All edits are within the flight worker's ownership, including the explicitly assigned shared rotorcraft folder. No frozen dimensions, `reference.ts`, presentation assembly, core state/control types, flight-model snapshot/trim bridges, registry, panel or exterior files were edited. All changes remain uncommitted.

Required follow-ups before acceptance:

1. Agree optional per-blade/modal state and hub-parameter contracts, including deep snapshot copies, restore validation, reset and trim initialization. Wire a truly coupled flap/lag/body/shaft model; the current lag kernel is not that implementation. Obtain hinge sequence, blade mass distribution and damper measurements first.
2. Supply the three-position clutch command from shared controls to the new `drive` argument, persist the **control command** in controls/resume, and expose the distinct disengaged switch with bus power to the panel. Do not change `clutchLight` or the no-STAR warning behavior.
3. Obtain HMI Appendix C oleo load/stroke/poppet/gas data and rotor damper data before attempting ground resonance. Review the cold parked stinger contact using actual geometry/compliance evidence; do not move the frozen points merely to remove a test observation.
4. Resolve hot/high hover power and validate CB OGE, rigging/phase, asymmetric stops, canted-stabilizer aerodynamics, manual throttle correlation, cooling and warm/flooded starts. Spring trim/control forces remain missing.
5. Continue the shared autorotation-flare investigation using these traces. The 269 expected failures remain alongside the unchanged four R22/R44 expected failures.

## Browser captures

Viewed `work/s269-fm/runway.png`, `r22-runway.png` and `c152-runway.png`, all 1280×800 in the same runway cockpit view, with `quality=low&scale=0.5&cover=0&cirrus=0`. The 269 image reports 2650 engine RPM, 462.30 rotor RPM, 0.02 m/s ground speed, on ground and undamaged; no demo runs. The rectangular 269 console sits on its existing face, but its inherited six-pack/percent tach and copied cockpit details remain visibly provisional. No panel/visual acceptance is claimed. R22 reports 2639/527.89 RPM and undamaged; the C152 comparison reports 624 RPM and undamaged.

The prescribed `scripts/shot.mjs` with the exact `index.html?aircraft=s269&scenario=runway&resume=0` URL loaded the simulation (2650/462.29 RPM, on ground, not crashed) but never reached `__ready` within 120 s, then timed out taking the screenshot on ANGLE/llvmpipe. The ignored `work/s269-fm/shot-software.mjs` changes only the render backend to SwiftShader and its root path. It produced the viewed 269/C152 low-quality captures; the R22 capture used the prescribed script. A second exact/default-quality attempt also timed out on readiness and was stopped while awaiting the renderer. **There is no successful exact/default-quality screenshot**, and no render performance claim. Logs retain both failed attempts. No application `pageerror` was reported.

Commands for the successful captures:

```
node work/s269-fm/shot-software.mjs 'index.html?aircraft=s269&scenario=runway&resume=0&quality=low&scale=0.5&cover=0&cirrus=0' work/s269-fm/runway.png --w 1280 --h 800 --wait 500 --timeout 60000 --eval '__sim.summary()'
node scripts/shot.mjs 'index.html?aircraft=r22&scenario=runway&resume=0&quality=low&scale=0.5&cover=0&cirrus=0' work/s269-fm/r22-runway.png --w 1280 --h 800 --wait 500 --timeout 120000 --eval '__sim.summary()'
node work/s269-fm/shot-software.mjs 'index.html?aircraft=c152&scenario=runway&resume=0&quality=low&scale=0.5&cover=0&cirrus=0' work/s269-fm/c152-runway.png --w 1280 --h 800 --wait 500 --timeout 60000 --eval '__sim.summary()'
```

## Final verification, 11 October 2026

- `npx tsc --noEmit`: clean, exit 0; `work/s269-fm/typecheck-final.log`.
- Final 269 subset: **7 files, 45 passed and 2 expected failures**, 33.94 s; `work/s269-fm/area-final.log`. `S269_TRACE=1` refreshed `performance.json`, `flights.json` and `dynamics.json` for the final implementation.
- Full suite, `npx vitest run --maxWorkers=4 --reporter=verbose`: **206 passed files / 4 skipped; 2815 passed tests, 6 expected failures, 221 skipped**, 553.33 s; `work/s269-fm/full-suite-final.log`. Exit 0, no unexpected failures. The six expected failures are the unchanged two R22/two R44 autorotation landings plus the two 269 attempts.
- The initial full-suite process ended with signal 143 without a result summary; its `work/s269-fm/full-suite.log` is inconclusive. The complete successful retry above supersedes it.
- Direct final frozen-source comparisons: **6 passed**, 2.87 s; `work/s269-fm/legacy-final.log`. Tracked digest comparisons also passed in the full suite and final subset.
- Additional warm stopped-engine bench, `npx vitest run --config work/s269-fm/vitest.config.ts work/s269-fm/warm-start.test.ts --maxWorkers=4`: **1 passed**, 1.63 s. Initial CHT/oil 150/80°C are explicitly constructed test conditions through the systems restore interface. Engine fired after 0.167 s of cranking; after 10 s it was at 1498.8 RPM, CHT 148.7°C and oil 80.3°C, clutch released, governor false, undamaged. This is a generic warm-start integration check, not validation of flooded/hot-start RFM procedures. Logs/data are `warm-start.log` and `warm-start.json` under `work/s269-fm/`.
- `git diff --check`: clean. No commits, pushes, branch changes, patch files or out-of-ownership edits.

The complete fully coupled articulated rotor, ground resonance and validated hot/high hover performance are **not delivered** by this stage. The placeholder and disclosures intentionally remain.
