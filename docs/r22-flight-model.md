# R22 Beta II flight model

Round 5 did **not** produce an acceptable 40 ft, collective-down autorotation landing. The rejected
pilots and measurements are recorded below; the application retains the round-4 pilot. Round 4 audited
energy, added tail-stinger/fin contacts, and levelled skids before touchdown. **Autorotative landing remains unvalidated:** both weights touch below 10 kt
without damage or tail contact, but rotor RPM is still below 90%. The two complete-landing expected
failures remain. The recorded early flare loses energy; no excess-energy source was found.
This is an experimental, reduced-order model, not a validated flight-training procedure.

Open `/?aircraft=r22&scenario=runway&resume=0` for a running helicopter, `scenario=cruise` for a trimmed airborne start, or `scenario=apron` for a cold start. Exterior and panel work are separate from this physics branch.

## Apron cold-start strike correction

The default apron wind exposed a stopped-rotor initialization error shared with the R44. `settle()`
seeded 5 m/s induced flow at zero RPM, and a floor on Lock number × rotor speed gave the free-flapping
equation a finite four-second time constant even when stopped. Applying rotating-rotor blowback at
that high advance ratio produced 56.12° teeter in the R22 and 68.35° in the R44 during reset. The
lowest main-rotor collision samples lay 3.63 m / 10.08 m below the apron. Both aircraft were otherwise
at their normal skid resting heights (0.892 m / 1.086 m AGL); all eight terrain samples were at
120.05 m MSL. The nearest building was 22.2 m from the mast. Neither parking nor dimensions changed.

The solver now seeds zero induced flow when stopped and uses the free-flapping time constant
16 / (Lock number × rotor speed), infinite at zero RPM, with finite body-axis transport at that limit.
The existing estimated 12° teeter limit bounds the hub pose at low RPM as well; rotating stop impacts
still latch damage before the pose is limited. Ground-strike checks remain active at all RPM. With
default weather, reset tip clearance is now 2.520 m (R22) / 3.133 m (R44).

[R22 POH 7-2](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r22_poh_full_book_b79e920713.pdf)
describes the droop-stop friction restraint during starting/stopping. The correction does **not**
validate that restraint's torque, blade sailing, elastic droop, or a stop-impact damage threshold:
those still need measured data and an azimuth-resolved model. Rendered stopped-blade droop and
physics coning remain separate approximations. `tests/sim/scenario-spawns.test.ts` exercises all
registered aircraft and all five scenarios at reset and after five seconds without pilot/autoflight
input; `tests/rotorcraft/stoppedRotor.test.ts` covers zero/low RPM and actual raised-surface strikes.

## Controls and starting

| Input | Function |
|---|---|
| Arrow keys / pitch and roll axes | Longitudinal and lateral cyclic |
| Z / X (also Q / E) / yaw axis | Anti-torque pedals |
| Hold F5 / F6 | Lower / raise collective continuously |
| Joystick throttle axis | Collective by default; an explicitly assigned collective axis takes precedence |
| F2 / F3 (also Page Down / Page Up) | Close / open the throttle twist grip, separately from collective |
| F1 / F4 | Fully close / open the twist grip; fully closed defeats the correlator and governor |
| Insert | Command clutch belt tensioner engagement / disengagement |
| Delete | Governor switch |
| 5 / Numpad 5 | Return cyclic/pedals to the scenario’s initial positions; this is not a hover command |

Keyboard cyclic and pedals stay where left. No attitude, yaw or hover stabilizer runs in the production
input path. Airplane rotation assistance, load-factor stops, ground steering, roll trim and autopilot are
bypassed. Numpad 5 returns to the positions captured at scenario initialization, which may be airborne trim
positions. It does not compute a new trim or hover. A gamepad rate-throttle input remains a twist-grip command;
its absolute throttle lever is collective.

Cyclic tap rate is now 0.06 travel/s, pedals 0.08/s, accelerating quadratically to the existing 0.45/s after
1.2 seconds held. A 100 ms tap moves cyclic about 0.0061 (0.066° swashplate) and pedals 0.0081 (0.119° blade
pitch); moving toward the captured neutral is 1.2 times faster. Collective remains 0.15 travel/s (6.67 s
end to end). Shorter taps are finer; long holds still give full authority. The original 0.12 cyclic / 0.20
pedal tap rates produced substantially more correction chatter in the scripted hover. These are position
controls, so anticipate drift and make a correcting movement before releasing the key.

For the simulator's cold-start sequence, lower collective, disengage clutch and switch the governor off. Select fuel ON, mixture rich (hold Shift+M), master on (W), and both magnetos (4). Open the twist grip slightly with F3 and hold S to start. The automated test uses a 10% grip position; exact grip angle and idle calibration are estimates. Release S when running. Engage clutch with Insert, watch engine RPM during belt take-up and wait for CLUTCH to extinguish (45 seconds in this model). Switch the governor on with Delete and slowly open the grip through the governor’s 80% engagement point, releasing the grip near 101%; the governor settles at 103.5%. Check both tachometers before raising collective. Apply left pedal as power increases and balance cyclic as the skids become light. The complete flight test uses a feedback pilot. The keyboard test enters rounded, learned cyclic/pedal positions with keys before a slow lift, then corrects visually observed attitude and drift.

The governor moves a rate-limited throttle servo with proportional/integral control and estimated RPM-rate feedback. Gains (10, 1/s), a 0.5 s rate-prediction horizon, 0.3/s servo rate and 0.3 collective/throttle correlation remain estimates. The lead term uses the shaft acceleration implied by engine/rotor torque and reflected inertia. Its target is 103.5%, inside the published 103–104% normal range. Collective changes mechanically add throttle; moving the grip overrides the servo for that input step. The stored grip demand and actual governor throttle are separate. Closing fully represents throttle overtravel, so collective cannot reopen it. Engine power failure opens the sprag automatically: do not disengage the belt clutch for autorotation. Lower collective promptly and use right pedal relative to the powered trim.

The shared presentation outputs are `clutchEngagement` (0–1 belt tension), `clutchLight` (actuator powered and moving), `governorActive` (switch, electrical power and engine speed above 80%), and `lowRpmHorn` (rotor below 97%, collective above its bottom 2%, battery on). `lowRpm` separately reports the raw tach threshold. The bottom-2% switch deadband is an estimate. Display/audio consumers must use the horn field for the collective-dependent warning.

## Published references and estimates

Primary sources are Robinson's [complete R22 POH](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r22_poh_full_book_b79e920713.pdf), [POH section 1](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r22_poh_1_f2700c9508.pdf), and [Maintenance Manual chapter 10](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r22_mm_10_c4df074bcc.pdf), obtained through the [manufacturer's publications](https://www.robinsonheli.com/publications). Page numbers below are printed handbook pages, not PDF page indices.

| Item | Implemented value and provenance |
|---|---|
| Tachometer reference | POH 1-6: 100% = **2550 engine / 510 rotor RPM**. Governed target 103.5% = 2639.25 / 527.85 RPM; chart condition 104% = 2652 / 530.4 RPM. |
| Rotor limits | POH 2-2: power-on 101–104%; power-off 90–110%. The whole power-off interval is not a green arc: the lower/upper extensions are yellow. Horn threshold 97%. |
| Engine | POH 1-5: O-360-J2A, 145 hp normal rating at 2700 RPM; helicopter limitations 124 hp continuous, 131 hp for five minutes. Robinson MM 6.002 distinguishes 180 hp engine capability from the derated ratings. Calibration is at the POH MAP/MCP point, not at WOT; exceedances are reported without automatically cutting power. |
| Main rotor | POH geometry: two blades, diameter 25 ft 2 in, −8° twist; constant 0.18923 m chord approximates the published taper. Hub/radius/skids come only from `dimensions.ts`. |
| Collective range | MM 10.122: pitch at 0.75 radius, 2 ±0.5° down / 14 ±0.5° up. Implemented 2.5° / 14°. The low stop is calibrated within that published tolerance against MM 10.250 figure 10-15, as the manual requires an autorotation rigging check. |
| Cyclic and teeter stops | Symmetric 10.75° cyclic and 12° teeter contact are estimates. MM 10.121 gives asymmetric cyclic stops; the current symmetric envelope does not reproduce them. The teeter damage threshold has no measured R22 validation. |
| Tail rotor | POH geometry: two blades, 42 in diameter, 4 in chord; gear ratio (47/11) × (3/2). MM 10.140 supports −10° nose-right to +19.25° nose-left pitch. |
| Empty mass and CG | POH 6-6 sample: 880 lb at longitudinal station 104.0 in, lateral −0.1 in; datum 100 in ahead of mast. This is a sample aircraft, not a universal empty weight. |
| Loading | 1370 lb = 621.4215 kg maximum gross. Solo is the right-seat 170 lb pilot at station 78, lateral +10.7 in. Two-seat payload centroid uses the sample's 170/160 lb crew. Vertical CG is estimated. |
| Fuel | Bladder installation: usable main 16.9 + auxiliary 9.4 US gal, 6 lb/gal. POH sample arms: main station 108.6, lateral −11 in; auxiliary 103.8, lateral +11.2 in. Tank height is estimated. |
| Rotor inertia | Main **146 kg m²**, tail 0.22 kg m²: estimates, not sourced inertia measurements. Two approximately 12 kg main blades distributed uniformly from 0.75 to 3.835 m give about 146 kg m². Real spanwise mass, hub and blade construction need verification. |
| Body inertia | 220 / 560 / 510 kg m² at the reference crew loading, estimated from approximately 0.60 / 0.95 / 0.91 m radii of gyration. The common mass model adjusts for fuel/payload; exact crew distributed inertia is not resolved. |
| Tail surfaces | Stabilizer 0.2401 m² from the merged exterior’s 0.98 m span and 0.22/0.27 m chords; upper/lower fins 0.25 / 0.17 m². Centres and lift slopes estimated from POH 1-3 three-view proportions. These are not dimensioned factory aerodynamic data. |
| Drivetrain | Five-to-one engine ratio is published. Efficiency 0.94, 45-second actuator travel and 520 Nm crank-side belt torque capacity are estimates. The POH specifies a moving actuator/light and blades beginning to turn within five seconds; it does not specify this fixed 45-second completion time. |

Section polars (main lift slope 5.7/rad, maximum Cl 1.25, profile Cd 0.009, quadratic drag coefficient 0.009), induced-velocity correction 1.15/0.9 = 1.2778, root cutout, fuselage drag/moments, tail-wake fractions, throttle/governor gains, engine induction/fuel/thermal/starter parameters and skid coefficients remain engineering estimates. They are exposed in aircraft data. Polar/low-stop calibration was checked against both powered performance and the maintenance autorotation chart, not just an RPM assertion.

No existing values in the shared `dimensions.ts` contract were changed. The stabilizer outline was added and both the exterior and physics now import it; the prior independent physics area was 58% larger. `PILOT_EYE` was already shared on the merged base; an identity/coordinate integration assertion now protects it. The current POH three-view and shared reference drawing differ slightly in overall dimensions; that discrepancy needs agreement across physics and exterior before changing the reference.

## Power and hover provenance

Robinson [MM 6.002](https://shop.robinsonheli.com/wp-content/uploads/2024/11/r22_mm_6.pdf) gives the O-360’s
180 hp capability. POH 2-11 gives 124 hp MCP at 2652 rpm and 22.45 inHg at sea-level ISA. The generic piston
model now supports calibration at a specified MAP/RPM; existing airplane calibrations follow their original
path. R22 rated-power metadata remains 145 hp. Its induction inlet scales with displacement. The prior
fuel-flow estimate accidentally made full rich lean of peak (phi about 0.89); full-rich phi is now an
explicit estimate of 1.15. This has not established the complete fuel-flow or Lycoming power chart.

The MAP table is transcribed from POH 2-11 at pressure altitudes 0–8000 ft and −20 to +40°C. Five-minute
MAP is MCP +0.9 inHg; blank hot/high cells mean full throttle. Interpolation into those cells uses the
last numeric altitude trend until the blank row. Above the table, its last row is retained; the separate
Vne placard flags operation outside its approved table. Engine/gearbox shaft limits remain 124/131 hp.
Both MAP and shaft power feed the five-minute exposure counter and exceedance output.

The induced correction uses kappa 1.15 and a 0.9R effective induced radius, and forward flat-plate area
uses 5.26 ft², following the engineering estimates in
[Pokhrel et al., AHS Sustainability 2015, p. 3](https://www.researchgate.net/publication/303753069_Modeling_and_Requirements_Definition_for_a_Hybrid-Electric_Powered_Helicopter).
These are model estimates, not measured R22 polars. The fuselage now sees rotor wash and its resulting
download. Area-mean inflow excludes the BEM loss multiplier; a developing actuator-disc wake at the drag
centre gives a wash multiplier `1 + z/sqrt(R²+z²)` (about 1.395). Coverage, vertical drag area and wake-skew
attenuation remain estimates. Previously the cabin/engine incurred no hover download at all.

Ground-effect inflow uses the constant-thrust exponent 3/2 and wake inclination from
[NASA NDARC theory, §12-4.1.2](https://ntrs.nasa.gov/api/citations/20160012474/downloads/20160012474.pdf):
`(1 - (R cos(wakeAngle)/(4h))²)^(3/2)`, with no image correction for an upward wake. The old square-root
factor understated the IGE benefit. Hub height comes from the shared geometry and current orientation.

## Loads, rotor dynamics and systems

`src/physics/rotorcraft` implements generic rotor, airframe and skid loads. `src/aircraft/r22` contains R22 dimensions, dynamic parameters, mass/loadings and limits. The existing atmosphere, rigid-body integration, mass/fuel, piston engine and electrical systems are reused.

- Main/tail blade elements use 12 radial × 16 azimuth stations, local advancing/retreating velocity, twist, signed lift/drag and shaft torque. First-harmonic equivalent feathering unloads the advancing side of the free-hinge main rotor. Reverse flow and section stall are bounded analytically; this is not an airfoil-table or free-wake solver.
- Longitudinal/lateral flapping follows averaged first-harmonic free-hinge equations. Response time is 16/(Lock number × rotor angular speed), with body pitch/roll/yaw rates, advance-ratio blowback and cyclic terms. Coning follows the blade aerodynamic bending moment balanced by centrifugal force. Coning and a skewed-inflow estimate add transverse-flow lateral flapping. Outer retreating-blade lift loss adds aft flapping at high advance ratio/loading.
- Main force acts at the shared hub relative to loaded CG. The centre teeter hinge supplies no artificial pitch/roll spring torque. Cyclic moment therefore falls with thrust. Rotor angular momentum is included along the tilted disc axis; for an ideal free hinge the aerodynamic reorientation term and body-frame momentum derivative cancel the rigid-disc Euler gyroscopic term. Adding only that Euler term would invent a rigid hub. Tail-rotor/engine gyroscopic moments, undersling dynamics, elasticity and lead-lag are not resolved.
- Teeter angle is the disc-to-mast angle. Exceeding the estimated stop while above 50% rotor RPM latches `mastBump` and a crash reason. Low-G tests show right roll from tail thrust above CG and reduced cyclic authority. The contact test imposes an already-developed body roll; it does not validate the complete real low-G accident sequence or its threshold.
- Uniform dynamic inflow produces translational lift and power reduction. An image-rotor term reduces inflow near ground. The vortex-ring region uses a smooth empirical inflow continuation; the former independent thrust multiplier was removed in round 4. It does not resolve wake recirculation, buffeting or recovery trajectories.
- Fixed stabilizer and upper/lower fin loads use their own local airspeed, including body rotation. Estimated rotor wash affects the stabilizer at low speed. Fuselage drag and destabilizing pitch/yaw derivatives combine with the tail surfaces to provide forward-flight static stability and damping. There is no hidden attitude feedback.
- Tail thrust acts right at the left-side shared tail hub, yawing the nose left against CCW main-rotor torque. Signed sideslip enters axial inflow; estimated main wake enters the tail disc's in-plane flow. Forward-flight fin unloading reduces pedal demand. Power loss removes drivetrain reaction torque, requiring right pedal. LTE/free-wake interference is not resolved.
- Rotor energy integrates aerodynamic torque against main plus geared tail polar inertia. Belt engagement ramps over actuator travel; a capacity-limited impulse couples the engine through a one-way sprag, dissipating slip energy and preventing rotor back-drive of a slower engine. The governor changes throttle, never rotor RPM directly.
- `takeoffPowerSeconds` accumulates time above 124 hp or the current MCP MAP (at operating RPM), resetting below both; `powerLimitExceeded` reports over 131 hp (1% numerical allowance), over the five-minute MAP (+0.05 inHg allowance), or more than 300 seconds above MCP. No detailed overstress damage or cumulative engine-life model exists. `vneKias` interpolates POH 2-11 pressure-altitude/temperature limits; `airspeedLimitExceeded` reports exceedance. Blank/outside-table cells conservatively return zero (outside approved envelope). Neither warning automatically reduces power or airspeed.
- Four compliant skid contacts have normal spring/damper forces, tangential static compliance and surface-dependent sliding friction. Resting pitch/roll account for spring compression and loaded CG. There is no wheel/brake force. Cabin, lower fin, main-disc rim (including flap/coning) and tail-disc rim contacts detect strikes; a compliant stinger distinguishes a light touch from a hard impact; sink/depth limits detect hard landings. Contact history advances only at RK stage zero; intermediate-stage updates previously swallowed the touchdown event. Contact geometry remains coarse. The [ground-contact extension](helicopter-ground-contact.md) adds reduced cross-tube plasticity/spreading, soil/edge catches, physical blade/airframe intersection and low-speed teeter friction/sailing. Coefficients and the rollover envelope remain unvalidated.

Airborne initialization numerically solves roll, pitch, collective, cyclic and pedal force/moment balance, then settles the engine and throttle. Its convergence reports **aerodynamic equilibrium**, not proof of enough engine power. At an excessive speed/altitude/loading the initial pose can converge while throttle saturates; subsequent flight then loses RPM or altitude. The inflow residual is continuous at zero disc incidence; each evaluation resets all slow rotor states. A failed direct solve retries by continuation from hover. Ground initialization instead solves the static skid resting pose.

The aircraft schema still requires unused C152 wing, wheel and compatibility-propeller data. Rotorcraft bypass fixed-wing aero/contact solvers, and `externalDrive` skips the compatibility propeller's load calculation. No sweeping airplane schema refactor was attempted. Diagnostic consumers should read `rotorcraft`, not the unused airplane aero/gear metadata.

Saved flights round-trip rotor speed, azimuth, flapping, coning, inflow, stop damage, clutch actuator, governor integral, previous grip/collective positions and power exposure. Restore recomputes instantaneous loads without advancing dynamic state. Missing/nonfinite fields, negative rotor speed, invalid clutch fraction and negative exposure are rejected. Older R22 snapshots lacking the new required fields are rejected rather than guessed. Time acceleration retains the normal helicopter physics timestep.

## Numerical acceptance and measured results

Tests use 1/240-second physics, zero wind and sea-level ISA unless stated. The atmosphere is held constant
through landing traces to isolate dynamics. Test pilots change only ordinary control inputs, never rotor
RPM, kinematics or forces during a flight. `R22_TRACE=1 npx vitest run tests/rotorcraft` writes optional
JSON diagnostics beneath `work/`. Test code and these diagnostic writes are not installed in the simulator.

The trim sweep has **225** equilibrium checks: the 154 kg payload / x = 0.15 regression and neighbours;
all four named loadings with 5%/100% fuel; and ten POH 2-5 longitudinal/lateral CG corners, including
920–1370 lb with equivalent ballast. Twelve speeds cover 0–102 KIAS, with dense sampling around ETL.
All converge below 0.0001 normalized residual. This proves numerical equilibrium at those sampled points,
not available engine power or every continuous point of the envelope.

| Sea-level OGE shaft demand, governed 103.5% | 621.42 kg max gross | 512.06 kg solo |
|---|---:|---:|
| Hover | 127.0 hp | 101.9 hp |
| 20 KIAS | 92.5 hp | 73.2 hp |
| 40 KIAS | 69.4 hp | 58.0 hp |
| 53 KIAS | 67.8 hp | 58.7 hp |
| 65 KIAS | 72.0 hp | 64.2 hp |
| 80 KIAS | 84.2 hp | 77.4 hp |
| 100 KIAS | 113.0 hp | 107.1 hp |

These replace the round-1 numbers. The stronger induced losses and added download significantly increase
OGE hover demand; the shared smaller stabilizer and sourced drag-area estimate reduce high-speed demand.
Gross OGE hover pitch/bank are −1.21°/−2.17°; solo +0.79°/−0.74°. The supervisor’s earlier +2° gross-hover
pitch was not reproduced with this branch’s published sample loading. This loading/attitude difference
needs reconciliation against a specific aircraft weight-and-balance sheet and measured mast/CG geometry.

### Hover ceilings

The ceiling test balances blade-element main/tail demand plus transmission loss against a warm, full-rich
engine, limited by WOT, current MAP and 131 hp. It uses 104% RPM to match POH 5-10; IGE skid clearance is
2 ft as in 5-6. Altitudes below are pressure feet, not density altitude. POH points are hand-read to about
200 ft. The older documentation’s 6500 ft ISA gross OGE reading was wrong; the dashed standard-day trace
is approximately 5300 ft. The normal 103.5% governor calculation gives about 4400 ft OGE / 9400 ft IGE ISA.

| Weight | OAT | POH OGE | Model OGE | POH IGE | Model IGE |
|---|---:|---:|---:|---:|---:|
| 1370 lb | −20°C | 7500 | 6828 | 10400 | 10421 |
| 1370 lb | 0°C | 5500 | 4807 | 9200 | 9166 |
| 1370 lb | +20°C | 3700 | 2903 | 8150 | 7984 |
| 1370 lb | +40°C | 2200 | 1101 | 7150 | 6862 |
| 1300 lb | −20°C | 9000 | 9546 | 11600 | 11482 |
| 1300 lb | 0°C | 7900 | 8310 | 10500 | 10238 |
| 1300 lb | +20°C | 6900 | 7057 | 9350 | 9064 |
| 1300 lb | +40°C | 6000 | 5497 | 8400 | 7953 |

The previous optimism is corrected, but these are still imperfect performance estimates: gross/hot OGE
is now about **1100 ft pessimistic**, while lighter/cold OGE is about 550 ft optimistic. The tests explicitly
permit 1500 ft OGE / 750 ft IGE errors; these bands prevent large regressions and do not establish POH
accuracy. The weight-dependent error points to the remaining blade polar, induced-loss and download
approximations. High-altitude fuel metering and cooling-fan power also need independent data. Applicable
operating altitude/Vne limits still take precedence over a calculated lift ceiling.

### Powered flight, landing and keyboard

A 60-KIAS powered approach decelerates to a 3 m hover, then descends vertically. First skid-contact sink
rates are **0.045 m/s at 0.055 kt** gross and **0.042 m/s at 0.051 kt** solo. Both retain landing cyclic/pedal balance during collective lowering, then centre after full-down
collective, and continue for at least five seconds on the skids without damage.

The full powered sequence starts cold on the flat runway surface, takes up the clutch, acquires the governor,
lifts, passes through ETL, climbs at 60 KIAS and about 490 fpm, cruises at 85 KIAS through a full 360° turn,
descends, approaches, hovers and lands. It lasts about 489 seconds. It tests flight phases and turns, not
runway-navigation accuracy or a rectangular traffic pattern. Peak engine power is **127.44 hp**; MAP
**23.023 inHg** stays below the 23.35 inHg five-minute placard without using its numerical allowance. Maximum rotor
speed including spool-up is **103.997%**; airborne range **103.125–103.748%**. No power/Vne warning or crash.
Landing is **0.043 m/s at 0.055 kt**. The test samples limits every physics step.

| Phase | Controls and response (normalized positions; aft/right positive) |
|---|---|
| Start/belts | Grip 0.10, mixture rich, both magnetos, master, starter for 8 s; engage clutch, wait for the 45 s take-up |
| Governor | Switch on at 65 s; grip opens 0.02/s through 80% and releases near 101%; final grip demand about 0.292 |
| Hover | Collective about 0.51, aft cyclic +0.12, left cyclic −0.11, left pedal −0.37 |
| ETL | Progressive forward cyclic, left cyclic and left pedal; power/collective reduce before climbing demand rises |
| 60 KIAS climb | Collective about 0.43, forward cyclic −0.20, left cyclic −0.15, pedal −0.02; about 92 hp |
| 85 KIAS cruise turn | Collective about 0.45, forward cyclic −0.33; about 9° bank and 91 hp |
| Approach | Collective reduces toward 0.18; aft cyclic about +0.10 while decelerating, pedal moves right relative to hover |
| Hover/land | Collective returns near 0.50, then about 0.46 near the ground; lower fully after contact |

A separate rotor-load test verifies the CCW rotor’s right-flapping tendency through transverse flow; the
flight pilot counters it with left cyclic. Left pedal in transition becomes less negative as torque demand
falls. These signs are checked rather than prescribing a constant pedal position through ETL.

The keyboard pilot uses the real `InputSystem` at 60 Hz, decisions and minimum key holds of 100 ms, and no
production assists. It enters rounded learned cyclic/pedal positions, raises collective slowly, and holds
hover for the last 30 seconds of a 150-second run. Gross hover stays at **2.87–3.15 m**, below **1.63 kt**;
solo **2.83–3.34 m**, below **1.42 kt**. Workload is about **137 / 124 combined key presses per minute**.
This demonstrates usable resolution/authority in calm air for a practiced pilot, not human usability
validation or a gust/crosswind guarantee. Starting with centred cyclic and pulling quickly was unsuccessful.

### Autorotation round 3: slow contact achieved, RPM acceptance still open

The same shared controller runs at maximum gross (621.42 kg) and right-seat solo with half fuel
(512.06 kg). It reads attitude, visual drift/height/sink and tachometers, and writes ordinary controls;
it receives no mass, forces, inflow or rotor-energy estimate. Rotor aerodynamics, inertia, geometry,
initial conditions and damage thresholds are unchanged. All results include the entire skid slide.

The owner's approximately 60 ft cue still starts the progressive flare, anticipating 0.6 seconds of
observed descent. The initial attitude demand is limited to 8°/s, longitudinal cyclic to 0.8/s and
collective to 0.5/s. The initial sink objective is `−0.4 − 7.6 × clamp((height_ft − 8)/52, 0, 1)^6` m/s.
These are engineering pilot settings, not published performance data. Unlike the previous 8 ft level
command, the controller continues to decelerate as it enters the cushion. Below 30 ft, renewed downward
acceleration is the cue for the transition (the legacy `level` phase name does not mean an achieved
level attitude). The subsequent demand combines ground-speed error and anticipated ground closure,
with a 12°/s attitude-command rate limit. A small collective pull supports excessive entry sink while
above 97%; tachometer feedback raises its target from 101.5% toward 105% during the flare. The cushion
uses visible sink and its trend. At contact a separate attitude loop continues cyclic/pedal corrections,
then lowers collective at 0.2/s once speed falls below 0.5 m/s. Completion also requires GS <0.1 m/s;
the previous completion rule could freeze a helicopter still sliding at more than 10 kt.

**This is still an unsuccessful combined landing solution.** It now satisfies <10 kt GS, <1.5 m/s
skid sink, no modelled damage and no climb at both weights in both environments. However, touchdown
NR is only **84.38 / 72.91%** at sea level, **85.05 / 72.70%** in the app. Maximum late pitch is
**30.4 / 31.6°**, still about **23.5° at 8 ft** and **9° at contact**. This does not achieve the requested
slightly nose-high level-off. Slowing down by prolonging the flare/cushion spends too much rotor energy;
faster final descents preserve RPM but miss speed or sink acceptance. The tests have not been promoted:
the speed threshold changes from 5 to the owner's requested **10 kt**, while the **1.5 m/s**, **90%**
touchdown NR and **110%** maximum NR requirements remain. Separate passing tests now prevent regressions
in speed, sink, stopping and damage from being hidden by the expected RPM failure.

The [R22 POH, sections 3-1/3-2 and 2-8](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r22_poh_full_book_b79e920713.pdf)
was checked again. It calls for approximately 65 KIAS, RPM control, a flare near 40 ft and level touchdown
following levelling near 8 ft. It also cautions against aft cyclic during touchdown/ground slide because
of possible blade/tailcone contact. The owner's 60 ft cue and friction-countering cyclic are the requested
simulator engineering experiment; they must not be represented as the manufacturer's procedure. The
model checks rotor/terrain contact, not blade/tailcone clearance, so absence of a modelled strike does
not resolve that caution.

At every airborne 240 Hz step from flare entry to first skid contact, VS remains negative and altitude
decreases in all four cases. These checks include levelling/cushioning, not just the initial flare.
The height tables are interpolated from full-rate traces. Heights use reference AGL minus the shared
level skid offset; first contact occurs at positive nominal height because the skids are tilted.
Touchdown IAS/pitch/VS are the pre-contact-step readings; the event's skid-normal sink and NR are
reported separately. IAS includes vertical motion and need not equal GS near a slow touchdown.

**Sea level, gross (621.42 kg)**

| Height, ft | Pitch, ° | IAS, kt | VS, fpm | Rotor, % |
|---|---:|---:|---:|---:|
| 60 | -2.5 | 64.6 | -1265 | 103.8 |
| 45 | +5.5 | 59.9 | -362 | 104.2 |
| 30 | +11.2 | 43.9 | -231 | 104.8 |
| 15 | +30.2 | 25.6 | -573 | 107.0 |
| 8 | +23.5 | 17.7 | -511 | 101.4 |
| 3 | +15.1 | 11.6 | -346 | 91.2 |
| Touchdown | +9.4 | 9.3 | -289 | 84.4 |

First contact: **8.83 kt GS, 1.24 m/s skid sink, 84.38% NR**. Slide path to rest: **7.26 m** on **runway**. Damage: **none**. Maximum airborne VS from flare entry: **-0.314 m/s**; largest altitude step **-0.001308 m**. Final GS **0.0026 kt**, collective **0**.

**Sea level, solo (512.06 kg)**

| Height, ft | Pitch, ° | IAS, kt | VS, fpm | Rotor, % |
|---|---:|---:|---:|---:|
| 60 | -1.6 | 64.6 | -1265 | 100.1 |
| 45 | +6.3 | 60.9 | -633 | 101.2 |
| 30 | +16.4 | 40.3 | -174 | 101.7 |
| 15 | +31.2 | 17.8 | -601 | 98.2 |
| 8 | +23.6 | 10.3 | -490 | 89.9 |
| 3 | +14.5 | 5.2 | -352 | 79.4 |
| Touchdown | +8.7 | 3.7 | -305 | 72.9 |

First contact: **2.17 kt GS, 1.27 m/s skid sink, 72.91% NR**. Slide path to rest: **0.58 m** on **runway**. Damage: **none**. Maximum airborne VS from flare entry: **-0.769 m/s**; largest altitude step **-0.003203 m**. Final GS **0.0004 kt**, collective **0**.

**App terrain/atmosphere, gross (621.42 kg)**

| Height, ft | Pitch, ° | IAS, kt | VS, fpm | Rotor, % |
|---|---:|---:|---:|---:|
| 60 | -2.4 | 64.1 | -1245 | 104.0 |
| 45 | +5.4 | 59.3 | -347 | 104.3 |
| 30 | +11.3 | 43.5 | -230 | 105.0 |
| 15 | +30.0 | 25.9 | -571 | 107.2 |
| 8 | +23.4 | 18.0 | -511 | 101.8 |
| 3 | +15.1 | 12.1 | -346 | 91.8 |
| Touchdown | +9.3 | 9.7 | -287 | 85.0 |

First contact: **9.35 kt GS, 1.23 m/s skid sink, 85.05% NR**. Slide path to rest: **10.49 m** on **grass**. Damage: **none**. Maximum airborne VS from flare entry: **-0.334 m/s**; largest altitude step **-0.001392 m**. Final GS **0.0028 kt**, collective **0**.

**App terrain/atmosphere, solo (512.06 kg)**

| Height, ft | Pitch, ° | IAS, kt | VS, fpm | Rotor, % |
|---|---:|---:|---:|---:|
| 60 | -1.5 | 64.2 | -1264 | 100.6 |
| 45 | +6.4 | 60.4 | -609 | 101.7 |
| 30 | +16.5 | 39.7 | -163 | 102.3 |
| 15 | +31.2 | 17.3 | -604 | 98.4 |
| 8 | +23.5 | 9.8 | -491 | 89.8 |
| 3 | +14.5 | 5.0 | -355 | 79.2 |
| Touchdown | +8.8 | 3.5 | -308 | 72.7 |

First contact: **1.81 kt GS, 1.28 m/s skid sink, 72.70% NR**. Slide path to rest: **0.61 m** on **grass**. Damage: **none**. Maximum airborne VS from flare entry: **-0.813 m/s**; largest altitude step **-0.003386 m**. Final GS **0.0002 kt**, collective **0**.

Full-rate traces, controls and forensic aerodynamic channels are `work/touchdown-r3/final-{gross,solo}.json`
and `app-final-{gross,solo}.json`; `summary.json`, `tables.md` and `flight-comparison.png` give the comparison.
These diagnostics are read-only and never fed back to the pilot. Rejected pilot trials are retained in the
same ignored directory. Examples: `quicker` preserves 89.9/87.5% NR but arrives at 11.6/10.3 kt with
1.96/1.70 m/s sink; `latelevel` ends in strikes; `entry` builds more initial RPM but balloons solo.
They establish failed alternatives, not proof that a satisfactory pilot-only solution is impossible.
The next review needs rotor-energy/transient handling evidence and pilot judgement. Rotor aerodynamic
coefficients and inertia are unchanged.

### Skid friction, moments and ground regressions

Each contact queries `Environment.surface()` at its own world location, as the airplane gear does,
but uses steel-shoe estimates from R22 data rather than the rubber tyre table. All spring, damping,
friction and terrain-normal forces still act at the actual contact arm relative to loaded CG. Forward
friction therefore produces its physical nose-down moment; no attitude lock, force relocation to the
CG, damping of body rates or strike suppression is applied.

| Surface | Static coefficient | Longitudinal sliding | Lateral sliding |
|---|---:|---:|---:|
| Grass, firm/mown | 0.65 | 0.20 | 0.65 |
| Dirt, firm | 0.65 | 0.25 | 0.65 |
| Runway/taxiway, dry paving | 0.60 | 0.30 | 0.30 |
| Rock | 0.60 | 0.40 | 0.50 |
| Snow | 0.20 | 0.08 | 0.20 |
| Water | 0 | 0 | 0 |

**These are justified engineering estimates, not sourced R22 measurements.** No measured steel-shoe
friction dataset was obtained. Longitudinal drag on firm vegetation is lower than the old isotropic
0.65 rubber-tyre-like assumption; dry paving is estimated higher. Broadside tubes on soil retain the
previous 0.65 resistance to represent ploughing, while smooth paving has equal fore/aft and lateral
sliding coefficients. Static grip is separate. Nominal fully weight-bearing deceleration is μg, about
0.20 g turf and 0.30 g paving; the longer measured landing slides also carry rotor lift. Rough, wet,
soft, snagging and uneven ground can behave differently. Rock/snow are unvalidated placeholders;
water still lacks buoyancy/sinking physics, and zero friction does not validate a water landing.

Tangential spring anchors allow a finite static force at zero velocity, instead of steady downhill
creep from a velocity-only law. Stiffness is half the normal spring stiffness, low-speed damping 0.3
of the normal damper, both estimates. A 0.25 m/s Stribeck speed scale reduces grip toward sliding;
sliding force follows a dissipative friction ellipse and opposes velocity. Plastic slip resets the
anchor at the force limit. Anchors reset on contact loss and advance only on the positive-dt RK stage.
These internal contact deflections are not added to `RotorcraftState` or the saved-flight schema;
a restored parked helicopter may re-settle slightly as static deflection rebuilds.

The FAA's [Helicopter Instructor's Handbook, 11-9](https://www.faa.gov/sites/faa.gov/files/regulations_policies/handbooks_manuals/aviation/FAA-H-8083-4.pdf)
supports smooth, aligned running landings and notes that hard surfaces reduce the chance of a skid
catch compared with grass. This supports retaining the broadside/rollover hazard, not the numerical
coefficients. The existing single-skid rollover fixture now explicitly uses turf: at 10° roll and
0.3 rad/s roll rate, sustained collective produces a rotor strike, while lowering collective recovers.
On smooth paving this particular departure slides out. A separate paired test lands with 10 m/s lateral
drift on turf and rolls past 40° into a rotor strike; the otherwise identical zero-drift case settles.

Power-off run-on fixtures start at 20/35 kt, 2° nose-up, 0.5 m/s descent and 25% collective. The same
shared slide controller supplies aft cyclic and keeps controlling through a full stop and collective
lowering. Normal airborne/rotor state integration is used throughout.

| Surface | Entry, kt | Actual contact GS, kt | Slide to rest, m | Damage |
|---|---:|---:|---:|---|
| Grass | 20 | 19.64 | 36.92 | None |
| Grass | 35 | 34.27 | 112.93 | None |
| Asphalt | 20 | 19.63 | 26.65 | None |
| Asphalt | 35 | 34.27 | 86.87 | None |

Across these four tests, post-contact absolute pitch remains below **2.18°** and roll below **3.26°**.
Aft cyclic peaks at **0.37–0.51** normalized input; hand rate is capped at **0.8/s**. A separate cold,
parked six-degree cross-slope test on each surface settles for 10 seconds, then moves less than
**0.01 mm** in the following 50 seconds, with speed below **0.001 mm/s**. Unit checks verify the expected
μN forces, dissipative work, nose-down friction moment about offset CG and read-only zero-dt evaluations.

### Cockpit height and field of view

The camera and physics share the same metre scale and terrain height. The visible tile was reconstructed
with the renderer's tile builder for a vertical ray check (uploaded tiles release their CPU vertex arrays).
The terrain tile under the eye at flare start is a flat **120.000 m MSL** tile with **zero geomorph height change**. The physics
terrain query also gives 120.000 m. At **59.95 ft** nominal skid height and **−3.32°** pitch, the camera is **19.7207 m above rendered ground**
(world height 139.7207 m MSL). It equals the aircraft reference position plus the orientation-rotated
`PILOT_EYE` exactly in the paused capture. The lowest skid contact point is **18.2139 m** above ground,
so the eye is **1.5069 m** above that point. The level eye-to-skid offset is **1.5 m**;
when pitched, use the rotated eye offset and the tilted skid points rather than simply adding 1.5 m to
the nominal skid-height readout. The cached AGL readout can differ from the current reference position by
millimetres within a physics step. No terrain or scale correction was warranted.

The R22 default vertical FOV remains **82°**; all six airplane cockpits use the **60°** camera default.
At the same viewport and pose, central features occupy `tan(30°)/tan(41°) = 0.664` as many pixels:
about **34% smaller**, with more ground visible. At 16:9, horizontal FOV is about **114.2° versus 91.5°**.
This can make the ground seem farther away/higher without moving the eye. R22's default view also looks
**28° down**, versus about 7–9° in the airplanes. FOV and view pitch were inspected only and remain unchanged.
Measured camera/terrain values and the inspected 1600×900 capture are in `camera.json` and
`camera-60ft.png` under `work/flare-progressive/`.

Main rotor inertia remains the 146 kg m² estimate. A newly located
[1995 FAA/Georgia Tech R22 investigation, pp. 23–25](https://repository.gatech.edu/bitstreams/799376b6-c3c8-4071-a1b2-e7daed5188cf/download)
contains measured blade/root segment data for its O-320-era model; applicability to the Beta II blade revision
needs confirmation. It does not support simply increasing inertia to obtain a successful cushion.

Other acceptance checks cover sprag energy loss/no engine back-drive, governor override, horn inhibition,
power/MAP timers, low-G control loss, teeter contact, tail/rotor strikes, skid overturn/recovery and save/restore.
The main rotor and systems state contract is unchanged.

### Final round-2 verification

`npx tsc --noEmit` is clean. The relevant subset reports **68 passed and two expected failures**; the final
full `npx vitest run` reports **2638 passed, two expected failures, 221 skipped and one failure** in 237.15 s.
The two expected failures are this branch's unresolved autorotative landings. The sole ordinary failure is
the presentation-owned R22 rated-power/audio mismatch (145 versus 131 hp) in `tests/aircraft/consistency.test.ts`;
it was left untouched as requested. Logs are `work/round2-area-final.log`, `work/round2-full-suite-final.log`
and `work/round2-typecheck.log`.

Viewed captures are `work/r22-round2-runway.png` (1440×900), `work/r22-round2-side.png` and
`work/c152-round2-side.png` (both 1600×900, same view). The runway capture was taken after the screenshot
script's readiness timeout; it rendered the cockpit but does not establish interactive flight acceptance.
Viewed diagnostic plots are `work/r22-round2-circuit-traces.png`, `work/r22-round2-hover-ceilings.png` and
`work/r22-round2-autorotation-traces.png`. All logs, JSON traces, plots and source downloads stay in ignored
`work/`; none are committed.

## Live scripted demonstrations

`index.html?aircraft=r22&demo=<id>` and Escape → Flight → R22 demonstrations start `startup`, `hover`,
`approach`, `autorotation` or `circuit`. `trace=1` opens the compact live graph (automatic for autorotation).
P pauses; Shift+[ / Shift+] change time scale; C changes camera. Enter, another non-view key, a flight control,
or the Take control button ends the script. Pause/menu/view/rate keys remain observation controls. Every
flight stops and pauses at its endpoint, with its outcome and the final readings visible.

The pilot is in `src/sim/rotorcraft/scriptedPilot.ts`; the schedules are in `flights.ts` beside it. The
observation adapter supplies only attitude, angular rates, signed visual fore/aft and lateral motion, IAS,
ground speed, skid height, vertical speed, tachometers and ground/crash indications. The pilot never receives
a flight-model instance, forces, inflow, blade states, a trim solver or mutable aircraft state. It writes only
ordinary `ControlInputs`. Normal cyclic travel is limited to 1/s, pedals to 0.7/s, and powered collective to
0.12/s; the initial autorotation flare uses 0.8/s longitudinal cyclic and 0.5/s collective, increasing to 1.2/s and 0.8/s for the final forward push and cushion. These are
engineering pilot hand-motion limits, not measured pilot-response data. Autorotation now uses the
60 ft entry and continued deceleration/cushion described above, followed by active slide control. Round 3 changed skid contacts and surface data; round 4 also corrects rotor inflow/work consistency and adds tail protection, as documented below.

Flight School's `DemoScript` was considered. Its AP/autoflight/raw/pulse segments have no collective,
clutch/governor switches or rotorcraft feedback-controller segment, so these flights use its `StepController`
interface and `SimPhysics.copilot` integration point instead. As in `InstructorPilot`, a private copy of
commanded controls survives idle input polling and is released in place. The input system's held keyboard
positions follow those controls. Existing calibrated-axis motion detection triggers hardware handover;
absolute axes then wait to match the current positions within 5%, following the school's throttle matching
rule. There is no force/attitude intervention during handover. A terminal step hold prevents `run=`, explicit
stepping or accelerated frames from flying past the endpoint without a pilot. R22 physics remains at 240 Hz
at every time scale.

The Flight School debrief graph has fixed airplane channels and a fixed recorded time domain. The live
rotorcraft graph reuses its scale/tick helpers with four rolling 60-second channels: rotor %, IAS, vertical
speed and skid height. Control positions are shown numerically alongside it; the existing 3D cyclic,
collectives, grips and pedals receive those same controls. No saved school trace schema changes.

`starts.ts` supplies the shared app/test placement and calm weather. Startup/circuit start cold on the apron,
hover starts 3 m above the runway, and approach/autorotation start inbound on runway heading at 90/350 m
above terrain. The loading is the type's existing maximum-gross preset, with full fuel. The app uses the
actual world terrain and altitude-dependent atmosphere; the original engineering regressions retain their
flat sea-level environment. Thus the **same pilot is checked in both environments**, rather than asserting
identical trajectories in different scenery. The app integration tests use exactly the app's initial
conditions, weather, `SimPhysics`, pilot and terminal hold. Normal airplane scenarios and input remain on
the existing path. Demonstrations suppress resume/save until a normal scenario is selected.

### Observed live outcomes

The four powered demonstrations complete without modelled damage. Gross and solo autorotation also
reach a stationary, undamaged terminal state, but **terminal completion is not landing acceptance**:
the RPM and late-attitude problems above remain visible. The caption names the RPM/attitude gap rather
than the old excessive-touchdown-speed gap. The full circuit is the original 360° cruise turn and field
landing, not a rectangular airport traffic circuit; there is no obstacle avoidance or landing-site search.

Current autorotation app results are the two app tables above. The prior gross contact was 34.51 kt and
ended in a main-rotor strike during the slide; it is now 9.35 kt with no modelled damage, but NR regresses
from 95.30% to 85.05%. Solo contact is 1.81 kt and 72.70% NR. Both weights have an explicit 240 Hz no-climb
regression and ordinary speed/sink/damage/stop checks alongside the retained complete-landing failures.

Headless app captures and per-phase state/3D-control poses are in ignored `work/live-sequence/`; see
`observations.json`, `takeover.json`, and the five `*-trace.json` files. Captures include cold start, clutch,
governor, hover, ETL, climb, cruise, approach, flare, level and parking; additional `scripts/shot.mjs` captures
sample cushion, the keyboard take-over and a C152 regression. At startup-to-hover the visible collective
rotation changed from 4.0° to 18.9°, grip twist from −11.7° to −34.3°, and pedal fore/aft positions split by
34 mm; cyclic changed from centred to the hover position. Key take-over preserved cyclic/pedals/collective/
grip exactly while paused; the subsequent held ArrowUp moved elevator from 0.11475 to 0.10740. Browser checks
also verified pause, time scale and starting a fresh flight from the Escape menu.

For inspection from the browser console:

```js
__sim.demo.state()     // id, phase, action, outcome and phase transitions
__sim.demo.trace()     // 4 Hz pilot readings and control positions
__sim.demo.start('approach')
__sim.demo.stop()      // normal input handover; no state reset
```

Reproduce a paused flare capture with:

```sh
node scripts/shot.mjs 'index.html?aircraft=r22&demo=autorotation&run=44.5&freeze=1&cam=chase&resume=0' work/flare.png --wait 1000 --eval '__sim.summary()'
npx vitest run tests/rotorcraft tests/input tests/sim
```

Previous demo milestone verification: `npx tsc --noEmit` passed. The relevant rotorcraft/input/sim run passed 273 tests
plus two expected failures; the final added app/handover checks passed 24 tests. The complete suite,
`npx vitest run --maxWorkers=4`, passed **2,671 tests**, with **two expected failures and 221 skipped**
(188 files passed, four skipped; 306.99 s). No ordinary failures. The earlier unrestricted suite process
ended with SIGTERM before reporting results. Logs: `work/demo-area.log`, `work/demo-final-tests.log`,
`work/full-suite.log`, `work/final-typecheck.log`. A C152 app check with `demo=autorotation` retained its normal
autopilot, showed no demo panel and reported no errors (`work/c152-regression.png` / `.log`). Resetting after
a completed R22 demo restored ordinary pause-key operation (`work/reset-pause.log`).

### Round 3 verification

`npx tsc --noEmit` passes. `R22_TRACE=1 npx vitest run tests/rotorcraft` reports **90 passed, two expected
failures** across 12 files (47.41 s). The expected failures are exclusively the known combined autorotation
acceptance checks; speed/sink/no-climb/no-damage/stop, run-ons, static slopes, rollover, powered flight,
systems, trim and keyboard tests pass. The full `npx vitest run --maxWorkers=4` reports **2,686 passed,
two expected failures and 221 skipped**, with **189 files passed / four skipped**, in **351.84 s**.
There are **no ordinary failures**, including the airplane regressions.

Artifacts are under ignored `work/touchdown-r3/`: `area-final.log`, `typecheck-final.log`, `full-suite.log`,
full-rate JSON traces, height tables and the inspected `flight-comparison.png`. Headless 1600×900 captures
include gross 60/15/8/3 ft, first contact and terminal stop, plus solo 15 ft/contact/stop. The side views
make the excessive late attitude reviewable; cockpit views show the RPM loss and updated caption.
`capture.log` and `captures.json` record the exact app states. The C152 runway capture with the R22
demo query still has `demo: null`, no crash and the normal airplane panel (`c152-regression.png` / `.log`).
No camera, FOV or geometry changes were made.

Files changed are the shared pilot/schedules, generic skid contacts, R22 skid coefficients, landing/demo
and skid tests, caption and this report. The only additional shared contract edit is the optional
`RotorcraftDefinition.skids.surfaces` data type in `definition.ts`; `RotorcraftState` and the dimensions
contract are unchanged. All work is **uncommitted** for the supervisor. Airplane gear, aircraft data,
controls and flight-model paths are untouched.

## Round 4: energy audit, tail contacts and levelling

**No airborne excess-energy source was found in the recorded flare. The landing is still not validated.**
Both weights now touch below 10 kt and 1.5 m/s, with roughly 2–3° nose-up attitude and no tail contact,
in both the engineering and app environments. However, rotor RPM is only 84/78% at sea level and
85/78% in the app. The two complete-landing expected failures remain. The earlier claim that there
must be excess lift is not established by this energy audit: conservation is necessary, but does not
validate the blade polar, inertia, inflow distribution or transient handling against a real R22.

### Audit before any dynamics changes

Full 240 Hz traces were recorded first with the round-3 physics and pilot, then with corrected physics
and the original pilot, then with the final pilot. Each set contains gross and solo landing flares,
35 seconds of autorotation entry/steady descent, and a constant-collective flare from trimmed 65 kt
level flight. The last case cuts the engine at flare entry and commands a progressive 16° pitch change;
it is deliberately different from the landing pilot's collective schedule. The source copies, harness,
JSON and plots are under ignored `work/energy-r4/`. `before-*`, `physics-*` and `after-*` identify the
three runs; `before-audit.png`, `after-audit.png` and `controlled-cases.png` were inspected.

The energy calculation uses **CG height and velocity**, actual loaded mass/inertia, main plus geared
tail rotor kinetic energy, and `0.5 ω·Iω` body rotational energy. The model reference point and CG are
not interchangeable during pitch changes. For every RK stage, diagnostics record main and tail
shaft power `-QΩ`, thrust work at the moving hub, H-force work, induced and profile losses, fuselage,
stabilizer, fins, fuselage moments, drivetrain reaction, and ground force/moment work. Drive diagnostics
separate the free aerodynamic rotor step, clutch energy, and quadratic Euler-work term. The harness
RK-weights the loads and compares them with measured energy changes. These channels never feed the pilot.

The following ranges are measured `dE/dt` in kW, excluding clutch-coupled intervals and all ground
contact stages. **Every included step is negative**, before and after the changes.

| Case | Before gross | After gross | Before solo | After solo |
|---|---:|---:|---:|---:|
| Landing, entry through contact | −102.05 to −35.96 | −119.91 to −35.27 | −82.94 to −34.93 | −86.71 to −34.63 |
| Autorotation entry/steady descent | −53.43 to −35.96 | −53.77 to −35.27 | −41.88 to −34.93 | −41.96 to −34.63 |
| Constant-collective flare | −50.47 to −33.18 | −50.60 to −33.43 | −45.01 to −25.90 | −45.13 to −26.09 |

The gross baseline 60→45 ft interval lasts 1.129 s: potential energy falls **27.84 kJ**, translational
kinetic energy falls **48.14 kJ**, rotor energy rises **2.15 kJ**, and total energy falls **73.83 kJ**.
The sink changes from −1264 to −362 fpm, pitch from −2.5° to +5.5°, and IAS from 64.55 to 59.84 kt.
This was **not a constant-collective flare**: collective is 21% at 60 ft, reaches approximately 28%,
and is still 20% at 45 ft. Mean thrust over that interval is **8.55 kN**, against **6.09 kN** weight.
The scripted pilot's early pull and rapid sink-arrest demand explain much of the apparent excess support.
The final pilot retains that explicit early support; removing it without redesigning the whole entry
caused excessive early descent or a later balloon in the rejected trials.

At 60 ft the baseline gross power balance is approximately +4.66 kW main shaft acceleration,
−51.69 kW main thrust work, −0.94 kW main H-force, −1.39 kW tail shaft, −10.73 kW fuselage,
−0.26 kW stabilizer and −0.14 kW fins. Main induced/profile losses are 21.00/26.98 kW.
The large lift is doing **negative** work: the aircraft is moving down and forward while the disc
is increasingly tilted aft. It does not create mechanical energy. Fin/stabilizer work is small;
ground-effect inflow reduction is below 0.001% throughout this early interval, and VRS is absent.

The truly airborne rigid-body RK4 work residual is below **0.00003 W**. The initial coarse report's
6–8 W maxima included RK stages that had already touched ground before the published ground flag changed.
The separate rotor Euler quadratic-work term peaks at **20.7 W before / 27.3 W after**. Comparing the
lagged rotor torque step with the current RK-weighted aerodynamic shaft work gives up to **232 W before /
324 W after** of operator-splitting discrepancy, not a tens-of-kW source. No shared integrator change or
energy clamp was introduced. Ground work is recorded through the slide; spring return can increase the
listed aircraft-only energy after contact, so the airborne monotonicity claim does not omit spring storage
and pretend to apply on the ground. Flap/coning kinetic energy and a resolved wake-energy state are not
represented by this reduced model.

### Physical corrections and what they do not establish

- The blade-element identity is `T Va − H U − QΩ = −T vi − Pprofile`, including signed torque,
  reverse-flow sections and stall. Thrust and H-force use the same instantaneous disc axis and hub
  airflow as the torque calculation. Disc tilting therefore does not introduce an extra work source;
  the cancelling free-hinge gyroscopic term does no work either.
- The old **thrust-only VRS multiplier** violated that identity by up to 3.18 kW gross / 3.69 kW solo
  in the late flare. Total work nevertheless remained negative. It is removed; the existing empirical
  VRS inflow continuation remains and still needs validation. There is no second independent force
  multiplier disconnected from shaft torque.
- Tail-rotor in-plane force was calculated by the blade elements but discarded. It is now applied at
  the tail hub, including its pitch/yaw moments; its main-wake work is separately recorded. The missing
  term was only of order 80 W around flare entry, not the proposed large lift source.
- The old inflow lag depended only on hover induced speed: **0.229 s** at gross 60 ft. The uniform
  apparent-mass linearization gives `tau = 64 R/(75 pi Veff)`, with
  `Veff = |V + vi| + vi (Va + vi)/|V + vi|`; it is **0.0322 s** at that forward-flight condition.
  This follows the uniform-mode equation in [NASA TM-88327, equations 4–5](https://ntrs.nasa.gov/api/citations/19870015049/downloads/19870015049.pdf).
  The positive floor in the non-momentum/VRS region and the 1.5 s stopped-rotor cap remain estimates.
  This is not a full three-state Pitt–Peters wake. A controlled rerun with the old pilot still produces
  8.74 kN mean thrust from 60→45 ft and 84/74% touchdown RPM: the lag correction **does not explain away
  the early lift or solve the landing**.
- Fixed-surface lift is now perpendicular to local flow in backward as well as forward flight. The old
  reverse-flow x-component could add work. This is a separate sign correction, not an initial-flare cause.

No rotor polar, inertia, collective stop, fuselage area or skid-friction coefficient was retuned.
The tests now independently exercise blade-element work closure, reverse-flow surface dissipation,
physical inflow time scales, and whole-aircraft energy/work closure in all three scenarios at both weights.

### Tail protection and pilot changes

The existing lower-fin outline and stinger centreline were moved verbatim from `visual.ts` into
`dimensions.ts`; physics and render use those same coordinates. **No existing dimension changed.**
They remain POH three-view/exterior estimates, not newly dimensioned factory data. The 16 mm tube radius
is also shared. Every contact queries local terrain. The lowest stinger point supplies a compliant
normal reaction and sliding friction at its real arm; it can pitch the nose down. Estimated spring/damper
values are 15 kN/m and 600 Ns/m. A light touch latches `tailContact = 'stinger-touch'` without stopping.
More than 1 m/s normal impact speed or 80 mm compression reports a hard stinger impact; fin and tail-disc
strikes have distinct reasons. Those damage thresholds need structural evidence. Fin outline samples,
the existing eight-point rotor rim and the rigid stinger approximation cannot resolve every terrain snag.

The new state field is serialized, validated and shown by the demo caption. Older schema-3 saves default
it to `none`. Existing systems fields keep their meanings. Tests cover nonfatal contact, force/moment work,
latched reporting, hard stinger impact, local fin/rotor terrain strikes, and save/restore compatibility.
A rejected pilot trial hit the stinger at **4.37 ft / 27.4° gross** and **5.05 ft / 30.7° solo**; it is
retained as `pilot4-*`, rather than suppressing strikes to obtain a landing.

The final pilot retains the progressive 60 ft flare, builds a modest RPM reserve, then uses forward
cyclic based on visible height/sink to level the skids before contact. Final-phase cyclic travel is limited
to 1.2/s and collective to 0.8/s (initial flare still 0.8/s and 0.5/s); these are estimated hand-motion
limits, not measured pilot-response data. The descending cushion avoids a prolonged near-level hover.
The peak flare is still approximately **34° gross / 33° solo** at 15 ft; it is not claimed to reproduce
real R22 handling. At touchdown it is approximately 3°/2°, with >0.66 m stinger clearance. Aft-cyclic
slide control remains active until stopped. The keyboard test pilot's visual speed/drift gains changed
from 0.02/0.03 to 0.025/0.04 to handle the faster inflow; no production input gains or test limits changed.

The height tables below use the existing nominal CG-based skid-height readout. Stinger clearance uses
the actual reference position, attitude, shared tube geometry and local terrain. IAS includes vertical
motion and differs from the horizontal ground speed used by touchdown acceptance.

**Sea-level ISA, gross, 621.42 kg**

| Skid height, ft | Pitch, ° | IAS, kt | VS, fpm | Rotor, % | Stinger clearance, m |
|---|---:|---:|---:|---:|---:|
| 60 | -2.8 | 64.6 | -1309 | 103.7 | 19.36 |
| 45 | +5.6 | 60.3 | -442 | 104.5 | 14.09 |
| 30 | +13.0 | 50.9 | -440 | 106.1 | 8.92 |
| 15 | +34.1 | 23.1 | -702 | 106.8 | 2.76 |
| 8 | +24.8 | 16.4 | -649 | 101.9 | 1.30 |
| 3 | +10.8 | 10.7 | -369 | 92.0 | 0.87 |
| Touchdown | +3.0 | 8.6 | -278 | 83.9 | 0.67 |

Contact **8.19 kt GS, 1.35 m/s skid sink, 83.94% NR**; pitch **3.00°**. Maximum flare VS **-0.066 m/s**. Minimum stinger clearance to contact **0.670 m**. Tail report `none`; no crash; terminal ground speed **0.0006 kt**.

**Sea-level ISA, solo, 512.06 kg**

| Skid height, ft | Pitch, ° | IAS, kt | VS, fpm | Rotor, % | Stinger clearance, m |
|---|---:|---:|---:|---:|---:|
| 60 | -1.7 | 64.7 | -1285 | 100.0 | 19.27 |
| 45 | +6.2 | 61.0 | -634 | 101.1 | 14.06 |
| 30 | +15.4 | 39.4 | -231 | 101.8 | 8.75 |
| 15 | +33.0 | 17.3 | -727 | 99.4 | 2.87 |
| 8 | +20.7 | 11.4 | -621 | 93.4 | 1.63 |
| 3 | +6.2 | 7.3 | -374 | 84.6 | 1.26 |
| Touchdown | +2.0 | 6.0 | -271 | 77.5 | 0.74 |

Contact **5.35 kt GS, 1.30 m/s skid sink, 77.55% NR**; pitch **2.00°**. Maximum flare VS **-0.357 m/s**. Minimum stinger clearance to contact **0.740 m**. Tail report `none`; no crash; terminal ground speed **0.0007 kt**.

**App terrain and atmosphere, gross, 621.42 kg**

| Skid height, ft | Pitch, ° | IAS, kt | VS, fpm | Rotor, % | Stinger clearance, m |
|---|---:|---:|---:|---:|---:|
| 60 | -2.6 | 64.2 | -1288 | 103.9 | 19.35 |
| 45 | +5.8 | 59.7 | -408 | 104.6 | 14.08 |
| 30 | +12.5 | 51.0 | -480 | 106.0 | 8.96 |
| 15 | +33.9 | 24.0 | -682 | 107.2 | 2.77 |
| 8 | +24.9 | 17.4 | -650 | 102.9 | 1.29 |
| 3 | +11.0 | 11.6 | -365 | 93.4 | 0.85 |
| Touchdown | +3.0 | 9.6 | -272 | 85.4 | 0.66 |

Contact **9.28 kt GS, 1.27 m/s skid sink, 85.44% NR**; pitch **3.03°**. Maximum flare VS **-0.075 m/s**. Minimum stinger clearance to contact **0.666 m**. Tail report `none`; no crash; terminal ground speed **0.0027 kt**.

**App terrain and atmosphere, solo, 512.06 kg**

| Skid height, ft | Pitch, ° | IAS, kt | VS, fpm | Rotor, % | Stinger clearance, m |
|---|---:|---:|---:|---:|---:|
| 60 | -1.7 | 64.2 | -1290 | 100.5 | 19.27 |
| 45 | +6.2 | 60.6 | -631 | 101.6 | 14.06 |
| 30 | +16.0 | 39.2 | -212 | 102.3 | 8.70 |
| 15 | +32.8 | 17.1 | -729 | 99.7 | 2.88 |
| 8 | +20.4 | 11.3 | -620 | 93.5 | 1.65 |
| 3 | +6.0 | 7.2 | -375 | 84.8 | 1.27 |
| Touchdown | +2.0 | 6.0 | -275 | 77.7 | 0.74 |

Contact **5.36 kt GS, 1.38 m/s skid sink, 77.71% NR**; pitch **2.00°**. Maximum flare VS **-0.574 m/s**. Minimum stinger clearance to contact **0.743 m**. Tail report `none`; no crash; terminal ground speed **0.0007 kt**.

### Round-4 regression evidence and scope

The final sea-level trim power curve (engine-equivalent shaft hp, including drivetrain loss) is:

| KIAS | Gross, hp | Solo, hp |
|---|---:|---:|
| 0 | 127.07 | 101.88 |
| 20 | 92.49 | 73.18 |
| 40 | 69.53 | 58.08 |
| 53 | 67.93 | 58.82 |
| 65 | 72.19 | 64.38 |
| 80 | 84.47 | 77.69 |
| 100 | 113.54 | 107.59 |

All 0–100 kt trims converge within the existing residual limit. Powered approach contact is
**0.057/0.053 kt**, **0.046/0.044 m/s** sink, **103.61/103.54% NR** gross/solo. The complete cold-start
circuit lands at **0.056 kt**, **0.047 m/s** sink and **103.61% NR**; airborne NR spans **103.13–103.75%**,
maximum shaft output is **127.02 hp**, and no power-limit exposure or damage is reported. The existing
hover-ceiling, maintenance autorotation, governor, low-G, teeter, trim, powered flight, run-on, cross-slope
and rollover checks are retained. Keyboard hover peak ground speed in the final 30 seconds is **1.80 kt
gross / 1.92 kt solo**, below the unchanged 2 kt limit.

Shared files outside the specified physics/R22/demo/test ownership were touched only where necessary:
`src/render/aircraft/airframe/types.ts` adds the stinger radius to visual data;
`src/render/aircraft/rotorcraft/airframe.ts` reads that radius instead of duplicating it;
`src/sim/resume.ts` validates the tail-contact enum and defaults older saves. `docs/r22-flight-model.md`
is the requested report. The explicitly permitted caption is `src/ui/rotorcraftDemo.ts`. Airplane
physics, aircraft coefficients, gear and controls are unchanged. All work remains **uncommitted**.

Final `npx tsc --noEmit` is clean. `npx vitest run --maxWorkers=4` reports **2,697 passed,
two expected failures and 221 skipped**, across **190 passed / four skipped files**, in **374.03 s**.
There are no ordinary failures, including the airplane regressions. The rotorcraft files account for
**101 passed / two expected failures**. The first area run's two contact-budget test failures and save
validator failure were implementation issues, corrected and checked by the 28-test energy/integration/
resume subset before the full suite. Logs are `typecheck-final.log`, `area-initial.log`,
`energy-resume.log` and `full-suite.log` under `work/energy-r4/`.

Inspected 1600×900 app captures include `gross-60-{cockpit,side}.png`, `gross-15-side.png`,
`gross-{8,3}-cockpit.png`, `gross-contact-{cockpit,side}.png`, `solo-15-side.png`,
`solo-3-cockpit.png`, `solo-contact-{cockpit,side}.png` and both terminal side views. The side views
show the forward push and stinger clearance; cockpit views leave the low RPM visible. Exact capture
states and clearances are in `captures.json`. The same-preset exterior comparison is `r22-side.png`
and `c152-side.png`. The first C152 app screenshot attempt timed out during capture (no image was
produced); its console evaluation did confirm `demo: null` and no crash. That failed image attempt is
not counted as visual verification. The successful C152 exterior capture and full suite are the
regression evidence. All screenshots, downloads, pilot trials, traces and plots remain ignored in `work/`.

## Round 5: 40 ft flare investigation — unresolved

**The requested flight has not been reproduced at both weights. No new pilot was installed and neither
expected-failure test was promoted.** A conservative 40 ft trial preserved RPM, kept descending, avoided
tail contact and cushioned touchdown, but touched at about **48–50 kt**. More aggressive trials reduced
speed at the cost of a balloon, excessive attitude, tail contact or a longer flare. This is not evidence
that a real R22 cannot perform the manoeuvre, or proof that this flight model makes it impossible.
The remaining cause has not been isolated sufficiently to justify a physical correction.

The production `src/sim/rotorcraft/` files, physics, shared geometry and all acceptance limits remain at
round 4. The caption now explicitly identifies that retained **60 ft** baseline and its failed touchdown
RPM criterion. The alternative pilots and review-only `rejected-40ft.patch` live in ignored `work/flare-r5/`; they are diagnostic attempts,
not a replacement demonstration. In particular, there is no new hidden early collective support or new
rotor inertia, drag, inflow or stability calibration in the application.

### Procedure, pilot attempts and evidence limits

The [complete Robinson POH](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r22_poh_full_book_b79e920713.pdf)
was obtained again. Printed section 3-2 specifies approximately 65 KIAS, RPM management, cyclic flare near
40 ft, forward cyclic near 8 ft, and collective just before touchdown. Sections 2-2/2-8 distinguish the
90–110% power-off limits from the green arc; being below 110% is not proof of remaining green. The supplied
section-1 URL contains general data, not the emergency procedure. All reported runs use calm air; the
reference video's wind and timing were not available, so no headwind was added to reduce touchdown GS.

The conservative comparison pilot (`candidate-flights.ts`) retains the old 8°/s initial pitch-command
rate and 0.8/s cyclic travel limit. Visual height/sink anticipation begins hand movement 0.6 s before the
40 ft cue. Forward cyclic anticipates 8 ft by 0.5 s of observed closure, with cyclic limited to 1.2/s.
Collective follows only observed RPM and its 0.3 s filtered trend until the final cushion, which anticipates
3 ft by 0.4 s of closure. Collective travel remains limited to 0.5/s during flare and 0.8/s thereafter.
There is **no sink-based collective floor**. The RPM guard targets 103.5%, but overshoots to 106.55% gross /
104.88% solo in the app: it also fails the requested all-green behaviour. Its hand limits, gains and
anticipation times are estimates. The pilot reads only the existing observations and changes controls;
no mass, force, rotor-energy estimate or state reset is used during flight.

The trials exposed a control interaction: aft cyclic accelerates the rotor; RPM-protection collective
then increases thrust and arrests sink, while the sink controller can command the nose back down.
When that collective is lowered again, support falls before aft attitude has rebuilt. Attempts to
coordinate the two hand movements, limit pitch reversals, anticipate decreasing speed and change the
forward-push timing did not remove the speed/balloon/tail-clearance tradeoff at both weights. Some trials
used faster cyclic and pitch rates; those are not claimed to match the owner's observed initial flare.

Representative rejected runs remain available, rather than being counted as successes:

- `down1-*`: original slow initial pitch response with a higher RPM guard; contact remained above 56 kt.
- `down2-*`: faster fixed pitch demand; gross peaked at 34.55°, developed +8.67 m/s climb, exceeded 114% NR
  and hit the stinger. Solo also ballooned and hit the stinger.
- `openloop-*`: no collective during flare; gross reached 122.13% NR and +0.13 m/s VS before an 18.46 kt
  contact. This isolates cyclic response but is not an acceptable landing or RPM-management policy.
- `monotone2-*`: smoother progressive nose rise; gross touched at 24.14 kt / 2.00 m/s skid sink; solo at
  19.18 kt and had +0.88 m/s airborne VS. Both fail the requested outcome.
- `margin2-*`: solo approached the speed target (10.80 kt, 90.24% NR), but touched at 10.45° and had a
  +0.33 m/s balloon; gross still touched at 51.99 kt. A favourable result at one weight is insufficient.

### Controlled rotor response and force audit

`response.test.ts` first establishes a 60 KIAS autorotation for 35 s at altitude, then commands a 16°
pitch increase over 2 s through the same rate-limited cyclic. One run holds the established low collective;
a paired run permits only the RPM guard. Both start from the same state. These are diagnostic response
runs, not landing tests; the aircraft remains free to accelerate, descend, climb and change rotor RPM.

| Held low collective | Gross: entry → 2 s | Solo: entry → 2 s |
|---|---:|---:|
| Body pitch, ° | −5.89 → +7.75 | −5.03 → +8.70 |
| Main thrust, kN | 5.98 → 7.91 | 4.89 → 6.56 |
| Rotor RPM, % | 103.16 → 108.90 | 99.43 → 104.52 |
| Ground speed, kt | 58.66 → 53.96 | 58.75 → 54.14 |
| Vertical speed, m/s | −7.81 → −4.44 | −7.98 → −4.31 |
| Collective, % | 6.31, held | 0, held |

Cyclic alone does increase thrust and reduce sink, but this initial attitude change removes only about
4.7 kt in the first 2 s. At 4 s the held-collective cases are still approximately 43 kt. The gross rotor
passes 110%. With the guard, gross thrust at 2 s is **8.79 kN**, collective **24.6%**, VS **−1.44 m/s**,
and GS **53.08 kt**; its maximum airborne VS later becomes positive. Solo guard values at 2 s are
**8.16 kN**, **18.4%**, **−2.86 m/s** and **53.70 kt**. Thus a pull justified by RPM protection can still
make a substantial contribution to sink arrest; labelling it a guard does not make that lift disappear.

At 2 s in the held-collective gross case, main thrust does **−77.31 kW** of work on the airframe and main
shaft power is **+22.83 kW** into the rotor. Main H-force work is only **−0.71 kW**, fuselage work **−6.42 kW**
and stabiliser work **−0.44 kW**. Corresponding solo values are −61.49, +19.50, −0.70, −6.50 and −0.47 kW.
The work signs and magnitudes do not identify a missing large H-force or stabiliser energy term. The
round-4 blade-element and whole-aircraft energy identities remain unchanged. These findings constrain
the diagnosis; they do **not** independently validate the estimated transient rotor aerodynamics,
body/rotor inertias or the pilot's handling. No coefficient change was supported by the evidence.

### Height tables and duration comparison

All tables below describe the **rejected conservative trial**, not the retained live demo. Samples are
at 240 Hz, using the first descending crossing of the requested nominal skid-height readout. Tail clearance
is the shared stinger geometry's clearance above local terrain; the fin/rotor contact checks remain active.
VS is body vertical speed; touchdown sink quoted below is the contact-point sink recorded by the skids.
IAS includes vertical motion; GS is horizontal speed. Collective is normalized control travel in percent.

**Sea-level ISA, gross, 621.42 kg — rejected**

| Height, ft | Pitch, ° | IAS, kt | GS, kt | VS, fpm | Rotor, % | Collective, % | Stinger, m |
|---|---:|---:|---:|---:|---:|---:|---:|
| 40 | -4.5 | 65.2 | 63.3 | -1580 | 104.0 | 9.5 | 13.40 |
| 30 | -0.5 | 64.0 | 62.7 | -1297 | 105.2 | 23.8 | 10.01 |
| 20 | +6.1 | 60.2 | 60.0 | -508 | 106.5 | 30.0 | 6.43 |
| 10 | +8.4 | 52.7 | 52.6 | -428 | 104.3 | 6.4 | 3.20 |
| 8 | +7.9 | 51.8 | 51.6 | -451 | 104.1 | 2.9 | 2.62 |
| 3 | +1.1 | 49.9 | 49.7 | -417 | 103.2 | 29.7 | 1.66 |
| Touchdown | +3.0 | 48.3 | 48.3 | -181 | 99.7 | 27.4 | 0.66 |

Contact: **48.31 kt GS**, **0.844 m/s** skid sink, **99.72% NR**. Maximum flare-through-contact VS **-0.815 m/s**; tail report `none`, no modelled damage, final GS **0.0682 kt**, collective **0**. This fast run-on fails the landing-speed requirement.

**Sea-level ISA, solo, 512.06 kg — rejected**

| Height, ft | Pitch, ° | IAS, kt | GS, kt | VS, fpm | Rotor, % | Collective, % | Stinger, m |
|---|---:|---:|---:|---:|---:|---:|---:|
| 40 | -3.3 | 65.2 | 63.4 | -1569 | 100.2 | 0.0 | 13.28 |
| 30 | -0.1 | 64.4 | 62.8 | -1435 | 101.2 | 0.0 | 9.99 |
| 20 | +3.7 | 62.5 | 61.4 | -1137 | 103.0 | 11.0 | 6.62 |
| 10 | +5.7 | 54.2 | 54.2 | -174 | 103.3 | 0.0 | 3.43 |
| 8 | +5.2 | 52.9 | 52.8 | -321 | 101.9 | 0.0 | 2.85 |
| 3 | +2.2 | 51.3 | 51.2 | -340 | 99.7 | 23.7 | 1.58 |
| Touchdown | +2.5 | 50.0 | 49.9 | -184 | 96.2 | 20.1 | 0.71 |

Contact: **49.92 kt GS**, **0.906 m/s** skid sink, **96.16% NR**. Maximum flare-through-contact VS **-0.556 m/s**; tail report `none`, no modelled damage, final GS **0.0849 kt**, collective **0**. This fast run-on fails the landing-speed requirement.

**App terrain and atmosphere, gross, 621.42 kg — rejected**

| Height, ft | Pitch, ° | IAS, kt | GS, kt | VS, fpm | Rotor, % | Collective, % | Stinger, m |
|---|---:|---:|---:|---:|---:|---:|---:|
| 40 | -4.3 | 64.7 | 63.3 | -1557 | 104.2 | 11.3 | 13.37 |
| 30 | -0.2 | 63.5 | 62.7 | -1265 | 105.4 | 24.7 | 10.00 |
| 20 | +6.5 | 59.6 | 59.8 | -457 | 106.5 | 29.3 | 6.40 |
| 10 | +8.9 | 52.0 | 52.1 | -409 | 104.4 | 8.2 | 3.16 |
| 8 | +8.0 | 51.0 | 51.1 | -430 | 104.2 | 3.5 | 2.61 |
| 3 | +0.7 | 49.2 | 49.3 | -426 | 103.2 | 30.0 | 1.70 |
| Touchdown | +3.3 | 47.7 | 47.9 | -179 | 99.7 | 29.1 | 0.64 |

Contact: **47.92 kt GS**, **0.823 m/s** skid sink, **99.66% NR**. Maximum flare-through-contact VS **-0.794 m/s**; tail report `none`, no modelled damage, final GS **0.0595 kt**, collective **0**. This fast run-on fails the landing-speed requirement.

**App terrain and atmosphere, solo, 512.06 kg — rejected**

| Height, ft | Pitch, ° | IAS, kt | GS, kt | VS, fpm | Rotor, % | Collective, % | Stinger, m |
|---|---:|---:|---:|---:|---:|---:|---:|
| 40 | -3.3 | 64.8 | 63.4 | -1571 | 100.7 | 0.0 | 13.28 |
| 30 | -0.1 | 64.0 | 62.8 | -1442 | 101.6 | 0.0 | 9.98 |
| 20 | +3.8 | 62.0 | 61.4 | -1101 | 103.5 | 15.2 | 6.62 |
| 10 | +5.2 | 53.7 | 54.0 | -222 | 103.1 | 0.0 | 3.47 |
| 8 | +5.9 | 52.6 | 52.8 | -345 | 102.0 | 0.0 | 2.80 |
| 3 | +2.3 | 50.9 | 51.1 | -339 | 100.0 | 23.2 | 1.57 |
| Touchdown | +2.5 | 49.7 | 50.0 | -188 | 96.8 | 20.7 | 0.71 |

Contact: **49.97 kt GS**, **0.959 m/s** skid sink, **96.75% NR**. Maximum flare-through-contact VS **-0.605 m/s**; tail report `none`, no modelled damage, final GS **0.0831 kt**, collective **0**. This fast run-on fails the landing-speed requirement.

For the duration comparison, **level means the first |pitch| ≤5° after the peak and after the forward-push
phase begins**. This is an operational measurement convention, not a claim that 5° is exactly level.
The separate forward-push heights are provided so the phase name is not mistaken for completed levelling.
Round-4 solo peak pitch was about 34.93°, rather than its lower 33° value sampled at 15 ft.

| Environment / weight | Peak pitch, round 4 → trial | 40 ft → level, s | Level → touchdown, s |
|---|---:|---:|---:|
| Sea level / gross | 34.13° → 8.67° | 6.150 → 3.533 | 0.237 → 0.996 |
| Sea level / solo | 34.93° → 10.17° | 7.121 → 2.917 | 0.458 → 1.404 |
| App / gross | 33.96° → 9.16° | 6.050 → 3.608 | 0.237 → 1.008 |
| App / solo | 34.91° → 9.90° | 7.079 → 3.087 | 0.462 → 1.204 |

At sea level the trial's forward-push phase starts at **11.57/9.62 ft**, gross/solo; pitch reaches the
≤5° criterion at **6.27/7.68 ft**. The corresponding round-4 phase began at 26.48/29.98 ft, even though
the aircraft was still increasing pitch later. The shorter trial therefore does not achieve the desired
shorter *successful* flare: it simply removes far less speed. `summary.json` contains both phase-based
and attitude-based durations, and `height-tables.md` includes the round-4 comparison rows.

### Verification, reproduction and remaining work

The production controller was restored before regression testing. The full suite validates that retained
round-4 behaviour and the airplanes; it must not be interpreted as validation of the rejected 40 ft trial.
All no-climb, tail-contact, speed, sink, attitude and RPM assertions remain unchanged.

`npx tsc --noEmit` is clean. `npx vitest run --maxWorkers=4` finished in **346.14 s** with
**2,697 passed, two expected failures and 221 skipped**, across **190 passed / four skipped files**.
There are no ordinary failures, including the rotorcraft energy, trim, hover, steady autorotation,
powered flights, circuit and airplane regressions. The two expected failures remain the existing gross
and solo touchdown-RPM gaps. Logs: `work/flare-r5/typecheck.log` and `work/flare-r5/full-suite.log`.
The C152 app capture completed with `demo: null`, `crashed: false` and its normal cockpit displayed.

The scratch response/app harness completed six diagnostic cases without setup/runtime failure. Those
are data-generating cases, not six successful autorotations. The requested flight remains unresolved.
The next useful evidence is the reference video's timing/wind and measured transient R22 pitch/thrust/RPM
response, followed by a pilot/rotor-response diagnosis that satisfies both weights. This investigation
has not justified retuning rotor inertia, polars, H-force, fuselage drag or stabiliser download.

Reproduction from this worktree (scratch files intentionally remain untracked):

```bash
AUDIT_TAG=candidate npx vitest run --config work/flare-r5/vitest.config.ts work/flare-r5/audit.test.ts work/flare-r5/appAudit.test.ts work/flare-r5/response.test.ts --maxWorkers=2
python3 work/flare-r5/summarize.py
MPLCONFIGDIR=/tmp/r22-matplotlib python3 work/flare-r5/plot.py
node work/flare-r5/capture.mjs
```

The captured trial is explicitly labelled **rejected** by the diagnostic harness. Production state and
controls are advanced normally; the harness changes only the diagnostic label and which scripted pilot
owns the controls. Force traces are `candidate-{landing,app}-{gross,solo}.json`, controlled responses are
`response-{held,rpm-guard}-{gross,solo}.json`, and inspected plots are `comparison.png` and `response.png`.
The 1600×900 captures include both weights at 40/20/8/3 ft, contact and stopped, in cockpit or side views;
exact states are in `captures.json`. `retained-demo-caption.png` verifies the actual updated caption on
the retained round-4 flight at 49.7 s, with the RPM deficit still visible. The C152 app check is
`c152-regression.png` and `c152-capture.log`.
All paths in this paragraph are beneath `work/flare-r5/`.

Only `docs/r22-flight-model.md` and the explicitly permitted caption `src/ui/rotorcraftDemo.ts` have tracked
changes in round 5. Both are outside the shared-pilot module but were requested by the brief. No shared
contract, airplane, physics, test threshold or production pilot changed. All changes remain **uncommitted**.

## Remaining work

1. Resolve both autorotative-landing expected failures with the requested 40 ft, collective-down flare: preserve ≥90% NR while touching below 10 kt,
   <1.5 m/s and with a near-level attitude. The round-4 touchdown meets speed/sink/no-climb/no-tail-contact and near-level attitude checks,
   but still spends too much RPM. The energy audit found no large artificial source. Obtain measured
   rotor inertia/polars and transient handling evidence before changing those estimates; also validate
   blade/tailcone clearance and structural stinger limits.
2. Reduce the remaining hover-chart errors using measured induction/fuel, cooling-fan, rotor-loss and fuselage
   download data. Validate maximum glide, Vy/climb curves and asymmetric cyclic stops.
3. Reconcile hover attitude/CG with a specific aircraft’s weight-and-balance sheet; confirm blade/body inertia,
   mast geometry and transient control response. Current teeter and skid damage thresholds are estimates.
4. Validate VRS recovery, retreating-blade stall, sideward/rearward flight and main/tail wake interference.
   Uniform inflow does not resolve elastic blades, dynamic stall hysteresis, LTE or ground resonance.
5. Obtain human keyboard/hardware pilot evaluation in the merged cockpit, including gusts and crosswind.
   Audio rating consistency remains presentation-owned and untouched in this branch.

An R44 needs its own parameters and validation. An articulated Schweizer 269 requires a different
flapping/lead-lag/ground-resonance model; changing blade count is insufficient.

## Ground-contact extension (heli/contact)

See [model, parameters, primary sources and evidence](helicopter-ground-contact.md). This supersedes the earlier missing-flexure/snag/collision/friction/sailing descriptions without claiming measured structural or pilot acceptance. The original stopped-rotor harmonic fix remains unchanged; sailing occupies separate physical contact state. All R22 airborne comparison cases against main are exact. Run-on friction and stinger-first flare geometry remain; the autorotation-landing RPM gap remains open.
