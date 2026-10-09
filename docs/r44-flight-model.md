# R44 Raven II flight model

This is an experimental Raven II configuration of the shared teetering-rotor solver. It replaces the R22-derived flight-model data but **does not qualify the R44 for release**. Hot/gross OGE hover ceilings are optimistic, the fixture-to-section pitch offset remains unverified, and autorotation landings leave the permitted rotor-RPM arc. The placeholder flag and chooser gate remain in place. No shared solver, geometry, panel, exterior or demonstration code is changed here.

## Evidence and parameter provenance

The manufacturer's cached PDFs are listed in [r44-sources.md](r44-sources.md). Page numbers below are printed manual pages, not PDF page indices. Source copies, chart images, diagnostic scripts and traces are in ignored `work/r44-sources/` and `work/r44-fm/`.

| Source | Data used |
| --- | --- |
| [Raven II POH §1](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44ii_poh_1_b4fce9d9be.pdf), pp 1-4–1-6 | Rotor dimensions/twist, six-cylinder 541.5 in³ IO-540-AE1A5, fuel, tach references and gearing. Geometry is imported from the frozen `dimensions.ts`. |
| [POH §2](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44ii_poh_2_4c17ab4577.pdf), pp 2-1–2-6, 2-9 | 205 hp continuous / 245 hp five-minute, 101–102% powered and 90–108% power-off RPM, weight/CG envelope, seat/baggage limits, MAP/Vne placards and configuration corrections. |
| [POH §3](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44ii_poh_3_d503a5c639.pdf), p 3-3 | Minimum descent approximately 1350 ft/min at 55 KIAS / 90% NR; maximum glide 4.7:1 at 90 KIAS / 90% NR. Increase NR to at least 97% below 500 ft AGL. |
| [POH §4](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44ii_poh_4_13dccff3ed.pdf), pp 4-4–4-7 | Priming, mixture-cutoff crank followed by rich, clutch engagement at 50–60%, rotor motion within five seconds, warm-up and 75% magneto check. |
| [POH §5](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44ii_poh_5_51ab31a1ff.pdf), pp 5-4–5-5, 5-7 | IGE/OGE takeoff-power hover charts, two-foot skid height for IGE, later-aircraft noise-test Vh of 108 KTAS at MCP. Vh is one reference point, not a published full power curve. |
| [POH §6](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44ii_poh_6_1082c5edde.pdf), pp 6-4, 6-6 | Loading arms; the example 1510 lb empty aircraft at FS106.5 and lateral +0.2 in. This empty weight/CG is a sample aircraft, not a fleet-wide specification. |
| [POH §7](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44ii_poh_7_e5154ae439.pdf), pp 7-6–7-13, 7-25 | Hydraulic main controls/mechanical pedals, governor acquisition above 80%, collective-dependent 97% warning, fuel-pump operation and 28 V electrical system. |
| [R44 MM chapter 10](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/R44_MM_Chapter_10_Rigging_Track_and_Balance_f4bf5cacf1.pdf), §§10.120–10.140, Figure 10-17 | Main/tail rigging and light-weight autorotation RPM acceptance. Collective table p 10.11 is July 2008; Figure 10-17 p 10.49 is April 2026. |
| [R44 MM chapter 6](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44_mm_6_4d61be8443.pdf), §6.002 | Engine can produce 300 hp, though normally rated 260 hp at 2800 RPM; installation limits are pilot-observed MAP/power limits. |
| [Lycoming PC-IO-540-AE1A5](https://www.lycoming.com/sites/default/files/file/2025-10/PC-IO-540-AE1A5.pdf), October 2025, 72-30 p 23 | AE1A5 piston 14D23908 has **8.70:1** compression. Do not carry over another IO-540 variant's 8.50:1 value. |

### Rigging conversion

MM 10.120 measures the blade with the MT525-1 fixture 49.5 inches inboard of the tip: exactly 0.75R for the 33 ft rotor. The shared blade-element pitch is also specified at 0.75R, so no radial twist correction is needed between these stations. The spanwise twist remains the published −6°.

The full-down table averages the two readings by **division by two**. OCR renders this as `+2`; it is not a two-degree pitch offset. Full down is 1–2° on the fixture; full-up travel is 12.5–13.5° **above full down**, not an absolute full-up pitch of 13°. The model uses an effective section setting of 1.75° down / 14.75° up, with 13° travel. This is an assumed zero fixture-to-section/zero-lift offset, checked against the maintenance autorotation chart; no independent fixture offset or measured section polar was found. Therefore the conversion is not fully established. A measured fixture datum and airfoil polar are needed before claiming correct physical blade incidence.

Longitudinal cyclic travel is represented by a 13.875° symmetric disc command, the midpoint of the MM 13.5–14.25° longitudinal limits. The shared solver cannot represent the separate 7.5–8.5° left and 6–7° right blade-pitch stops or the full swashplate linkage. Tail pitch is −16° to +18.75°, the midpoints of the MM's opposing pedal limits. Mechanical stop readings are not a measured in-flight disc-tilt calibration.

### Engine, transmission and systems

`powerplant.ts` uses the generic Lycoming combustion/friction implementation through the IO-360 data carrier, with six cylinders, 541.5 in³, 8.70:1 compression, RSA-style fuel injection, an electric/mechanical injector feed, cold port film and no carburettor or carb heat. SL/15°C MCP at 2718 RPM and 22.75 inHg is the single power calibration point. Independent checks use the POH's additional 2.8 inHg for TOP and altitude/OAT cells. Wide-open throttle is not artificially clipped to 245 hp; exceeding an installation limit must remain possible.

The tach references are 2665 engine / 400 main-rotor RPM at 100%, with a governed target of 101.5% (2705 / 406 RPM). Main gearing follows that ratio; tail/main gearing is `(57/11) × (31/27)`. The shared clutch, freewheel and governor remain dynamic. The configuration supplies 80% acquisition, 97% low-RPM warning, the 205/245 hp limits and the 300 s timer. `clutchEngagement`, `clutchLight`, `governorActive` and `lowRpmHorn` retain their shared meanings.

The following are **estimates**, not POH measurements: transmission efficiency 0.94, main inertia 450 kg·m², tail inertia 0.65 kg·m², engine inertia 0.8 kg·m², clutch 45 s, belt capacity 1000 N·m, correlator/governor gains, 24 V starter constants, induction losses, injector pressures/volumes, 7.5 GPH priming flow, port-film coefficients, thermal scaling and electrical loads. Main inertia corresponds to two assumed 21 kg uniform blades from 1.0 m to the tip plus a small hub allowance; blade masses have not been verified.

Full-rich equivalence ratio 1.15 is an estimate. Altitude/rich-mixture errors remain in the MAP-to-power mapping; tests allow 8% at finite MAP cells and identify WOT-limited cases separately. Fuel-flow figures are predictions, not a validated R44 fuel-consumption curve. The shared external-drive path disables the carrier propeller's aerodynamic load; its 0.05 kg·m² compatibility inertia is still included with the engine.

At 2718 RPM, 15°C and a 300 W accessory load, the bench gives 204.60 hp at 22.75 inHg and 243.53 hp at 25.55 inHg at sea level. WOT gives 286.98 hp at 28.66 inHg. At 4000 ft / 15°C it gives 199.62/238.60 hp at the MCP/TOP placard; at 8000 ft / 15°C MCP gives 192.83 hp and TOP is WOT-limited to 200.92 hp. SL fuel-flow predictions are 15.85/18.02 US GPH at MCP/TOP. These are recorded in `work/r44-fm/bench-final.json`; temperature is held at 15°C at each altitude, not the ISA lapse temperature.

### Aerodynamics and loading

Rotor hubs, radii, chords, skids, stinger, fins and stabilizer all come from `dimensions.ts`; no geometry was corrected or duplicated. Main-rotor induced factor 1.20 is an aggregate finite-blade/nonuniform-wake calibration against both hover charts. Lift slopes, stall caps, profile/induced drag polars, root cutouts, teeter limit, fin/stabilizer aerodynamics and wake immersion remain estimates. Longitudinal flat-plate area 0.65 m² gives an approximate MCP/Vh check; lateral/vertical areas 3.0/3.6 m² and fuselage moment derivatives are estimates. Hover and forward-flight residuals below remain visible instead of using special force/RPM/energy corrections.

`r44Occupants` constructs four separate point masses at the frozen seat arms, including asymmetric single-seat loading. It accepts kilograms in front-left, front-right, rear-left, rear-right order. Fuel is 29.5 + 17 usable US gal at 6 lb/gal, at main FS106 / lateral −13.5 in and auxiliary FS102 / +13 in. Default loading is a 170 lb right-seat pilot; full-gross loading is four 177.75 lb occupants with full usable fuel, totaling 2500 lb. All representative presets are inside the POH envelope at both full and empty fuel, without moving seat positions to reach a target CG.

The body inertia tensor (500/1700/1500 kg·m², Ixz zero at four 170 lb occupants/full fuel), vertical CG locations and point-mass occupant approximation are estimates. Under-seat baggage has distinct arms and is not represented by the occupant helper. The CG helper encodes the 1600–2500 lb envelope, the forward boundary's change above 2300 lb, the aft boundary's change above 2100 lb and lateral taper aft of FS100. These are data checks, not a new loading UI or automatic operational enforcement.

`r44Vne` provides the ≤2200 lb base grid, −10 KIAS for heavier **takeoff** weight, −30 KIAS from the base grid for autorotation, and the separate 100 KIAS high-power/doors-off caps. The autorotation reduction supersedes the weight reduction. `r44Map` treats all-null full-throttle cells as unbounded while retaining the shared interpolation at mixed cells. Existing exported placard structures are unchanged.

## Reproducible verification

Run from the worktree root:

```sh
npx tsc --noEmit
R44_TRACE=1 npx vitest run tests/aircraft/r44Physics.test.ts tests/aircraft/r44Setup.test.ts tests/rotorcraft/r44Performance.test.ts tests/rotorcraft/r44Flights.test.ts tests/rotorcraft/r44Energy.test.ts --maxWorkers=4
npx vitest run --maxWorkers=4
```

`R44_TRACE=1` writes ignored `work/r44-fm/performance.json` and `flights.json`. No application demo is enabled. Tests use the real solver at 1/240 s, with test-only pilots moving controls. No force assist, rotor-RPM clamp, in-flight state reset or artificial flare energy is used. Atmosphere is held at the stated pressure altitude/OAT for chart comparisons. The CG trim sweep uses explicitly identified virtual ballast to test the envelope; it is not a selectable passenger loading.

Final verification on 9 October 2026:

- Typecheck clean; `work/r44-fm/typecheck.log` (empty, exit 0).
- R44 subset including existing setup contracts: 5 files, 34 passed and 2 expected failures, 50.97 s; `work/r44-fm/area-tests.log`.
- Full suite: 195 passed files / 4 skipped; 2732 passed tests, 4 expected failures, 221 skipped, 405.51 s; `work/r44-fm/full-suite.log`. The expected failures are the two unchanged R22 autorotation landings and two new R44 landings. No unexpected failures.
- `git diff --check` clean. Changes left uncommitted; no out-of-ownership edits.
- Viewed `work/r44-fm/acceptance.png`, generated from the final traces by the ignored `plot.py`: power curves, chart/model ceiling comparison, measured touchdown/peak autorotation RPM and cold-start tach trace.

### Performance observations

The complete power curve is a model result: the available published reference is the later-aircraft noise-test Vh, not a full flight-test power survey. Likewise, converged trim demonstrates control authority in this solver, not real handling qualities.

| SL/15°C, OGE | Hover | 20 KIAS | 40 KIAS | 60 KIAS | 90 KIAS | 108 KIAS |
| --- | --- | --- | --- | --- | --- | --- |
| 2500 lb shaft demand, hp | 226.0 | 167.8 | 125.7 | 121.9 | 156.7 | 200.4 |
| Solo / half fuel shaft demand, hp | 159.5 | 116.5 | 94.8 | 99.4 | 139.4 | 184.6 |

These include the modeled transmission loss, but no separately modeled fan shaft load. All 24 longitudinal/lateral CG-corner cases (2100/2500 lb, forward/aft, both lateral edges, hover/60/100 KIAS) converge; maximum normalized residual is 8.74×10⁻⁵ and maximum absolute cyclic/pedal input is 0.562.

The hover comparison uses 102% NR, TOP, still air and two-foot skid height for IGE. The scanned curves were hand-read to approximately ±200 ft. The regression check's 10% power-balance allowance is **model error**, not chart-reading uncertainty or a claim of POH compliance. Root ceilings can differ by more than 1000 ft near the gross/hot TOP knee. The model retains that disagreement; it does not satisfy the full hover-ceiling target yet.

| Weight | OAT | OGE chart / model, ft PA | IGE chart / model, ft PA |
| --- | --- | --- | --- |
| 2500 lb | −20°C | 6600 / 6800 | 10000 / 9300 |
| 2500 lb | 0°C | 5000 / 5500 | 8800 / 8100 |
| 2500 lb | 20°C | 3000 / 4400 | 7500 / 6900 |
| 2500 lb | 40°C | 1000 / 2700 | 6300 / 5800 |
| 2300 lb | −20°C | 8750 / 8600 | 12000 / 11000 |
| 2300 lb | 0°C | 7400 / 7400 | 10700 / 9800 |
| 2300 lb | 20°C | 6200 / 6200 | 9400 / 8600 |
| 2300 lb | 40°C | 5000 / 5200 | 8150 / 7500 |

Rounded model values are for the final data, not aircraft performance for flight planning. Changing a single induced-loss coefficient cannot remove both the gross/hot OGE optimism and the IGE pessimism. Shared ground-effect/wake behavior, installation fan losses and engine altitude power need independent evidence before further calibration.

The worst ceiling error here is +1693 ft (2500 lb, 40°C OGE); maximum absolute power-balance error at the chart points is 6.32% (2300 lb, −20°C IGE). The former is significant despite the relatively modest power mismatch.

At the MM Figure 10-17 condition (2000 ft, 20°C, full-down collective, approximately 50 KIAS), 260/300/360 lb onboard produce approximately 99.85/100.88/102.86% NR. The chart's FS100 reference, weight-line interpolation and +0.75 percentage point per inch forward-CG correction give 98.74/100.75/102.99%. The test allowance is ±3 points; the actual factory rigging tolerance is ±1 point. The lightest case misses that tighter tolerance slightly. This is partial low-stop validation, not a substitute for establishing the fixture datum.

At gross weight with collective controlling 90% NR, 55 KIAS gives approximately 1265 ft/min versus the POH's approximately 1350. At 90 KIAS, sink is approximately 1690 ft/min and glide 5.30:1 versus 4.7:1; glide is optimistic by roughly 13%. RPM and speed settle within 1 percentage point / 2 KIAS. The tests explicitly check freewheeling with zero engine drive torque. Full-down collective at gross weight need not settle at 90% NR: pilot collective control is required. The MM full-down rigging procedure is a light-weight check below 1900 lb.

### Start, approach and landing

The cold sequence primes for four seconds, cranks with mixture at cutoff, enriches when firing, engages the clutch at 55%, warms at 65%, and settles at 75% for a two-second magneto check. Governor is switched off during manual run-up to prevent an overshoot acquiring 101.5%; it is restored for acceleration above 80%. Oil/CHT are allowed to warm before a 3 m hover.

At 15°C the model fires 0.325 s after cranking begins. Rotor motion begins 2.675 s after clutch engagement, and clutch light is out after the estimated 45 s actuator period. The settled magneto check drops 3.12 percentage points, below the POH's seven-point maximum. Governor acquisition occurs at approximately 108 s in this scripted sequence; warm-up allows hover at approximately 239 s. After 40 s hovering: 3.000 m height, 0.017 kt ground speed, 101.51% NR, approximately 123°C CHT, 73°C oil and 85 psi oil pressure. These temperatures/times are model predictions with estimated heat paths.

Two procedural mismatches remain: the reduced engine model needs a small 0.05 grip opening where the real POH says closed, and the existing manual pump switch substitutes for the real prime-key and clutch/oil-pressure automatic pump circuitry. Consequently this is a physics integration test, not complete POH startup training. Exact closed-throttle starting, hot starts, fuel-pressure warning behavior and automatic pump switching are not accepted.

Powered gross and solo approaches begin at 60 KIAS / 90 m, decelerate into a 3 m hover, then lower to the ground. Touchdown occurs at approximately 117 s, with 0.04–0.05 kt ground speed, 0.043–0.046 m/s sink and 101.5–101.7% NR. Pitch is −3.76° gross / +0.95° solo. Both stop without damage or tail contact. Separate tests detect a hard skid impact and tail-disc ground strike using the frozen geometry; compliance and damage thresholds remain estimates.

### Autorotation landing remains open

The R44 repeats the R22 acceptance scenario: 65 KIAS / 350 m, engine cutoff, RPM-controlled descent, then a continuous flare/level/cushion policy. Both runs reach contact without damage or tail strike and remain below a climb, but neither retains the 90–108% rotor arc through touchdown. The strict tests are deliberately `it.fails`, alongside normal checks that the attempted landing actually runs to contact or detected damage with finite results. Existing R22 expected failures are untouched.

| Loading | Touchdown speed | Sink | Pitch | Touchdown NR | Peak NR |
| --- | --- | --- | --- | --- | --- |
| 2500 lb | 8.17 kt | 1.30 m/s | 2.28° | **87.17%** | **109.42%** |
| Solo / half fuel | 5.40 kt | 1.17 m/s | 1.31° | **79.06%** | 101.46% |

This is an observed failure of the configuration with the existing flare policy/shared physics, not proof that a particular solver term is the sole cause. Estimated rotor inertia and polars also matter. No solver repair is attempted in this branch.

Energy checks repeat the R22 work audit for both loadings: blade lift work closes, profile drag is dissipative, fixed surfaces dissipate without wash, and whole-aircraft mechanical-energy change agrees with measured force/shaft work within 10 W during steady autorotation and a cyclic flare. Energy closure is necessary, but does not establish that the aerodynamic loads or flare trajectory are realistic.

### Browser captures

Viewed `work/r44-fm/runway.png` and `cruise.png`, and the same runway view for `r22-runway.png` and `c152-runway.png`. All are 1280×800 with `quality=low&scale=0.5&cover=0&cirrus=0`, `--wait 500 --timeout 120000 --eval '__sim.summary()'`. Chrome reports ANGLE/llvmpipe; this is a render/readiness check, not a timing or handling measurement.

The R44 runway capture reports zero ground speed, 2705 engine RPM / 406.04 rotor RPM, on ground and undamaged. Cruise reports 99.9 KIAS, 2705 / 405.98 RPM, −3.18° pitch / −1.09° roll and no damage. Both have `demo: null`. The central R44 pod and instruments are still provisional and dark at this low render scale, as are the comparison dials; no panel-face mismatch was apparent from these cockpit views. These captures do not accept the exterior/panel work or establish final instrument readability.

## Coordinated follow-up required

1. Wire configuration-aware Vne into the shared flight/HUD path, retaining takeoff weight rather than substituting fuel-burned mass. The helper exists, but the current shared path still uses the base grid. Coordinate the all-null MAP-cell treatment too.
2. Add prime-key and clutch/oil-pressure automatic electric pump logic, corresponding pressure state/warnings and interconnected tank flow. The current feed splits demand across selected tanks; it does not reproduce the R44 interconnection or real tank-depletion order.
3. Resolve exact closed-throttle injection starting and install a speed-dependent engine cooling-fan model with shaft power. Shared external-drive cooling currently uses a fixed 12 m/s contribution plus forward flow. Heat capacities/pressures are estimated, and a clutch-off running engine should not have a stationary cooling fan.
4. Obtain fixture datum/airfoil data, blade mass/inertia and installed power/hover measurements; reconcile the hot/gross OGE and IGE residuals before calling the performance validated. POH ASI position-error calibration is not transcribed; the model uses an empty correction table.
5. Extend the shared control representation if separate cyclic stops, swashplate kinematics, hydraulic failures or hand forces are required. Hydraulic metadata alone does not simulate those systems.
6. Continue shared autorotation-flare investigation with these R44 traces. Do not remove either R44 expected failure until it meets the strict landing envelope without artificial energy or state intervention.

All six edited aircraft modules, four new acceptance-test files and this document are within flight-model ownership. No frozen or supervisor-owned file was edited. Rendering remains the parallel exterior/panel workers' responsibility.
