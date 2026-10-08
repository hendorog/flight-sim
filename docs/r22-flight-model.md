# R22 Beta II flight model

This is an experimental, reduced-order helicopter model, not a flight-test-validated R22. The rework adds tail surfaces, free-hinge flapping, rotor energy and time-dependent helicopter systems to the existing rigid-body solver. The numerical checks below establish specific behavior; they do not establish complete R22 handling fidelity. In particular, a satisfactory slow autorotative touchdown has not yet been demonstrated.

Open `/?aircraft=r22&scenario=runway&resume=0` for a running helicopter, `scenario=cruise` for a trimmed airborne start, or `scenario=apron` for a cold start. Exterior and panel work are separate from this physics branch.

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
| 5 / Numpad 5 | Centre cyclic and pedals; this is not a hover command |

Keyboard cyclic and pedals stay where left. Make small changes; there is no attitude, yaw or hover stabilizer. Airplane rotation assistance, load-factor stops, steering assists, brakes, trim and autopilot do not act on the helicopter. A gamepad rate-throttle input remains a twist-grip command; its absolute throttle lever is collective.

For the simulator's cold-start sequence, lower collective, disengage clutch and switch the governor off. Select fuel ON, mixture rich (hold Shift+M), master on (W), and both magnetos (4). Open the twist grip slightly with F3 and hold S to start. The automated test uses a 10% grip position; exact grip angle and idle calibration are estimates. Release S when running. Engage clutch with Insert, watch engine RPM during belt take-up and wait for CLUTCH to extinguish (45 seconds in this model). Switch the governor on with Delete and slowly open the grip until engine RPM exceeds 80%; the governor then brings it toward 104%. Check both tachometers before raising collective. Apply left pedal as power increases and balance cyclic as the skids become light. The lift-off test uses an independently calculated hover cyclic/pedal position, not an attitude assist in the simulator.

The governor moves a rate-limited throttle servo. Collective changes mechanically add throttle; moving the grip overrides the servo for that input step. The stored grip demand and actual governor throttle are separate. Closing fully represents throttle overtravel, so collective cannot reopen it. Engine power failure opens the sprag automatically: do not disengage the belt clutch for autorotation. Lower collective promptly and use right pedal relative to the powered trim.

The shared presentation outputs are `clutchEngagement` (0–1 belt tension), `clutchLight` (actuator powered and moving), `governorActive` (switch, electrical power and engine speed above 80%), and `lowRpmHorn` (rotor below 97%, collective above its bottom 2%, battery on). `lowRpm` separately reports the raw tach threshold. The bottom-2% switch deadband is an estimate. Display/audio consumers must use the horn field for the collective-dependent warning.

## Published references and estimates

Primary sources are Robinson's [complete R22 POH](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r22_poh_full_book_b79e920713.pdf), [POH section 1](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r22_poh_1_f2700c9508.pdf), and [Maintenance Manual chapter 10](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r22_mm_10_c4df074bcc.pdf), obtained through the [manufacturer's publications](https://www.robinsonheli.com/publications). Page numbers below are printed handbook pages, not PDF page indices.

| Item | Implemented value and provenance |
|---|---|
| Tachometer reference | POH 1-6: 100% = **2550 engine / 510 rotor RPM**. Governed 104% = 2652 / 530.4 RPM. |
| Rotor limits | POH 2-2: power-on 101–104%; power-off 90–110%. The whole power-off interval is not a green arc: the lower/upper extensions are yellow. Horn threshold 97%. |
| Engine | POH 1-5: O-360-J2A, 145 hp normal rating at 2700 RPM; helicopter limitations 124 hp continuous, 131 hp for five minutes. The engine model uses the former; state reports exceeding the latter, without an invented automatic power cut. |
| Main rotor | POH geometry: two blades, diameter 25 ft 2 in, −8° twist; constant 0.18923 m chord approximates the published taper. Hub/radius/skids come only from `dimensions.ts`. |
| Collective range | MM 10.122: pitch at 0.75 radius, 2 ±0.5° down / 14 ±0.5° up. Implemented 2.5° / 14°. The low stop is calibrated within that published tolerance against MM 10.250 figure 10-15, as the manual requires an autorotation rigging check. |
| Cyclic and teeter stops | Symmetric 10.75° cyclic and 12° teeter contact are estimates. MM 10.121 gives asymmetric cyclic stops; the current symmetric envelope does not reproduce them. The teeter damage threshold has no measured R22 validation. |
| Tail rotor | POH geometry: two blades, 42 in diameter, 4 in chord; gear ratio (47/11) × (3/2). MM 10.140 supports −10° nose-right to +19.25° nose-left pitch. |
| Empty mass and CG | POH 6-6 sample: 880 lb at longitudinal station 104.0 in, lateral −0.1 in; datum 100 in ahead of mast. This is a sample aircraft, not a universal empty weight. |
| Loading | 1370 lb = 621.4215 kg maximum gross. Solo is the right-seat 170 lb pilot at station 78, lateral +10.7 in. Two-seat payload centroid uses the sample's 170/160 lb crew. Vertical CG is estimated. |
| Fuel | Bladder installation: usable main 16.9 + auxiliary 9.4 US gal, 6 lb/gal. POH sample arms: main station 108.6, lateral −11 in; auxiliary 103.8, lateral +11.2 in. Tank height is estimated. |
| Rotor inertia | Main **146 kg m²**, tail 0.22 kg m²: estimates, not sourced inertia measurements. Two approximately 12 kg main blades distributed uniformly from 0.75 to 3.835 m give about 146 kg m². Real spanwise mass, hub and blade construction need verification. |
| Body inertia | 220 / 560 / 510 kg m² at the reference crew loading, estimated from approximately 0.60 / 0.95 / 0.91 m radii of gyration. The common mass model adjusts for fuel/payload; exact crew distributed inertia is not resolved. |
| Tail surfaces | Stabilizer 0.38 m², upper/lower fins 0.25 / 0.17 m², centres and lift slopes estimated from POH 1-3 three-view proportions. These are not dimensioned factory aerodynamic data. |
| Drivetrain | Five-to-one engine ratio is published. Efficiency 0.94, 45-second actuator travel and 520 Nm crank-side belt torque capacity are estimates. The POH specifies a moving actuator/light and blades beginning to turn within five seconds; it does not specify this fixed 45-second completion time. |

Section polars (main lift slope 5.7/rad, maximum Cl 1.25, profile Cd 0.009, quadratic drag coefficient 0.009), induced-velocity correction 1.08, root cutout, fuselage drag/moments, tail-wake fractions, throttle/governor gains, engine induction/fuel/thermal/starter parameters and skid coefficients remain engineering estimates. They are exposed in aircraft data. Polar/low-stop calibration was checked against both powered performance and the maintenance autorotation chart, not just an RPM assertion.

No values in the shared `dimensions.ts` contract were changed. The current POH three-view and shared reference drawing differ slightly in overall dimensions; that discrepancy needs agreement across physics and exterior before changing the reference.

## Loads, rotor dynamics and systems

`src/physics/rotorcraft` implements generic rotor, airframe and skid loads. `src/aircraft/r22` contains R22 dimensions, dynamic parameters, mass/loadings and limits. The existing atmosphere, rigid-body integration, mass/fuel, piston engine and electrical systems are reused.

- Main/tail blade elements use 12 radial × 16 azimuth stations, local advancing/retreating velocity, twist, signed lift/drag and shaft torque. First-harmonic equivalent feathering unloads the advancing side of the free-hinge main rotor. Reverse flow and section stall are bounded analytically; this is not an airfoil-table or free-wake solver.
- Longitudinal/lateral flapping follows averaged first-harmonic free-hinge equations. Response time is 16/(Lock number × rotor angular speed), with body pitch/roll/yaw rates, advance-ratio blowback and cyclic terms. Coning follows the blade aerodynamic bending moment balanced by centrifugal force. Coning and a skewed-inflow estimate add transverse-flow lateral flapping. Outer retreating-blade lift loss adds aft flapping at high advance ratio/loading.
- Main force acts at the shared hub relative to loaded CG. The centre teeter hinge supplies no artificial pitch/roll spring torque. Cyclic moment therefore falls with thrust. Rotor angular momentum is included along the tilted disc axis; for an ideal free hinge the aerodynamic reorientation term and body-frame momentum derivative cancel the rigid-disc Euler gyroscopic term. Adding only that Euler term would invent a rigid hub. Tail-rotor/engine gyroscopic moments, undersling dynamics, elasticity and lead-lag are not resolved.
- Teeter angle is the disc-to-mast angle. Exceeding the estimated stop while above 50% rotor RPM latches `mastBump` and a crash reason. Low-G tests show right roll from tail thrust above CG and reduced cyclic authority. The contact test imposes an already-developed body roll; it does not validate the complete real low-G accident sequence or its threshold.
- Uniform dynamic inflow produces translational lift and power reduction. An image-rotor term reduces inflow near ground. The vortex-ring region uses a smooth empirical inflow continuation and thrust loss; it does not resolve wake recirculation, buffeting or recovery trajectories.
- Fixed stabilizer and upper/lower fin loads use their own local airspeed, including body rotation. Estimated rotor wash affects the stabilizer at low speed. Fuselage drag and destabilizing pitch/yaw derivatives combine with the tail surfaces to provide forward-flight static stability and damping. There is no hidden attitude feedback.
- Tail thrust acts right at the left-side shared tail hub, yawing the nose left against CCW main-rotor torque. Signed sideslip enters axial inflow; estimated main wake enters the tail disc's in-plane flow. Forward-flight fin unloading reduces pedal demand. Power loss removes drivetrain reaction torque, requiring right pedal. LTE/free-wake interference is not resolved.
- Rotor energy integrates aerodynamic torque against main plus geared tail polar inertia. Belt engagement ramps over actuator travel; a capacity-limited impulse couples the engine through a one-way sprag, dissipating slip energy and preventing rotor back-drive of a slower engine. The governor changes throttle, never rotor RPM directly.
- `takeoffPowerSeconds` accumulates continuous time above 124 hp, resetting below it; `powerLimitExceeded` reports over 131 hp (1% numerical allowance) or more than 300 seconds above MCP. No detailed overstress damage or cumulative engine-life model exists. `vneKias` interpolates POH 2-11 pressure-altitude/temperature limits; `airspeedLimitExceeded` reports exceedance. Blank/outside-table cells conservatively return zero (outside approved envelope). Neither warning automatically reduces power or airspeed.
- Four compliant skid contacts have normal spring/damper forces and regularized Coulomb sliding friction. Resting pitch/roll account for spring compression and loaded CG. There is no wheel/brake force. Cabin, main-disc rim (including flap/coning) and tail-disc rim contacts detect strikes; sink/depth limits detect hard landings. Contact geometry is coarse and contains no skid elasticity, terrain snag model or certified rollover envelope.

Airborne initialization numerically solves roll, pitch, collective, cyclic and pedal force/moment balance, then settles the engine and throttle. Its convergence reports **aerodynamic equilibrium**, not proof of enough engine power. At an excessive speed/altitude/loading the initial pose can converge while throttle saturates; subsequent flight then loses RPM or altitude. Ground initialization instead solves the static skid resting pose.

The aircraft schema still requires unused C152 wing, wheel and compatibility-propeller data. Rotorcraft bypass fixed-wing aero/contact solvers, and `externalDrive` skips the compatibility propeller's load calculation. No sweeping airplane schema refactor was attempted. Diagnostic consumers should read `rotorcraft`, not the unused airplane aero/gear metadata.

Saved flights round-trip rotor speed, azimuth, flapping, coning, inflow, stop damage, clutch actuator, governor integral, previous grip/collective positions and power exposure. Restore recomputes instantaneous loads without advancing dynamic state. Missing/nonfinite fields, negative rotor speed, invalid clutch fraction and negative exposure are rejected. Older R22 snapshots lacking the new required fields are rejected rather than guessed. Time acceleration retains the normal helicopter physics timestep.

## Numerical acceptance and measured results

Tests use a 1/240-second physics step, zero wind and sea-level ISA unless stated otherwise. The autorotation/stability helper holds atmosphere constant while height changes to isolate aircraft response. Its attitude/speed pilot changes only cyclic and pedals, never kinematics, forces or rotor RPM. It is test code, not a flight assist.

The trim sweep covers 0, 10, 20, 40, 53, 65, 80 and 100 KIAS at maximum gross and a light solo loading (170 lb right-seat pilot, half usable fuel: 512.06 kg). Every solution converges below 0.001 normalized residual. Full-fuel solo mass is 547.85 kg.

| Sea-level OGE shaft demand | 621.42 kg max gross | 512.06 kg solo |
|---|---:|---:|
| Hover | 110.2 hp | 89.5 hp |
| 40 KIAS | 66.5 hp | 56.6 hp |
| 53 KIAS | 67.8 hp | 59.8 hp |
| 65 KIAS | 75.2 hp | 68.3 hp |
| 80 KIAS | 92.7 hp | 86.7 hp |
| 100 KIAS | 132.1 hp | 126.7 hp |

Power/collective fall through ETL, then rise with speed; cyclic moves forward, fuselage pitch lowers and the fin reduces left-pedal demand. Gross hover is approximately −1.29° nose pitch / −1.86° bank (left skid low); solo is +0.71° / −0.46°. The right-seat CG reduces the required left bank. A small held cyclic change excites a slow hover oscillation/divergence; the test checks the first seven seconds, not a measured real-aircraft eigenmode. At 60 KIAS a 2° pitch disturbance and a 3° heading/sideslip disturbance return within 0.7° of trim/zero sideslip after five seconds with fixed controls.

At gross weight, a 65-KIAS engine failure with collective held reaches the 97% horn in **0.67 s**. The test's 0.3–1.3 s interval is an engineering requirement from the brief, not a POH stopwatch specification. With collective immediately full down and the simple pilot holding approximately 65 KIAS, a 60-second descent settles near **109.0% rotor RPM, 1736 fpm** at gross and **99.0%, 1698 fpm** at light solo. The test accepts gross 97–110%, 62–68 KIAS and 1100–1900 fpm. The 1500±400 fpm target is approximate; the POH does not publish a 65-knot sink-rate figure in the examined text.

POH 3-2 specifies 65 KIAS and 97–110% for the emergency procedure, and explicitly warns that light weight may prevent attaining 97%. MM 10.250 figure 10-15 similarly shows **higher**, not lower, full-down RPM at heavier weight. The original brief's light-weight overspeed expectation is inconsistent with these sources. A 50-KIAS maintenance-condition cross-check gives approximately 109% at gross and 99% light, consistent with that chart's direction and approximate sea-level readings.

POH 3-3's approximately 4:1 maximum glide applies at **75 KIAS and 90% rotor RPM**, not the 65-KIAS / high-RPM descent above. That distinct maximum-glide configuration has not been validated here. Likewise, Vy = 53 KIAS is retained as the published reference, but a complete climb-rate sweep establishing its optimum has not been completed. About 80 KIAS requires 75% MCP (93 hp) at gross in this sea-level model.

POH 5-6 / 5-10 chart readings are approximately 9400 ft ISA IGE (2 ft skid clearance) and 6500 ft OGE at max gross, zero wind. Tests bracket them within a deliberately broad ±2000 ft. Model estimates are roughly 9000–9200 ft IGE and 7900–8000 ft OGE: OGE ceiling remains optimistic. This tolerance exposes incomplete engine/wake calibration; it is not POH accuracy. Gross 100-KIAS demand is also about 1 hp above the 131-hp takeoff limit. Manifold-pressure limits/fuel consumption and high/hot performance still need quantitative calibration.

Other checks cover sprag energy loss, no engine back-drive, governor threshold/manual override, correlator, horn inhibition, takeoff-power timer, coning/transverse-flow/stall signs, low-G roll/authority, teeter-stop crash, hard impacts, tail strike, single-skid overturn/recovery, cold start through clutch/governor/lift-off, hardware/keyboard control separation and saved-flight restoration. Existing quadrature, ground-effect, translational-lift and density checks remain.

## Remaining acceptance work

1. Validate a full flare, level-off and cushioned slow touchdown from a 65-knot autorotation. Experimental pilot scripts can arrest descent/decelerate, but also balloon, overspeed or arrive too fast/hard; no satisfactory complete landing is claimed. Resolve whether remaining problems are pilot scheduling, wake/inflow dynamics or rotor-energy calibration using measured traces.
2. Validate maximum glide at 75 KIAS / 90%, Vy/climb curves, power/MAP/fuel-flow charts, hover ceilings across weight/temperature, and control travel including asymmetric cyclic stops. An aerodynamic trim is not an available-power guarantee.
3. Obtain measured blade/airframe inertia, tail surface data and transient control-response data. Validate low-G mast contact and ground rollover against a physically justified envelope, including a snagged skid. A test beginning at 10° bank with 0.3 rad/s roll remains in skid contact for over a second and overturns under thrust; full-down collective permits recovery. That checks the mechanism, not a measured critical angle or a snagged-skid accident sequence.
4. Validate VRS and high-speed retreating-blade stall onset/recovery, main/tail wake interactions and sideward/rearward flight. Current first-harmonic/uniform-inflow approximations cannot resolve blade elasticity, wake geometry, LTE or dynamic stall hysteresis.
5. Check the merged exterior/panel against physics axes, disc/hub/CG locations, tach percentages and the four shared systems fields. Add pilot evaluation and recorded R22 sound. Flight School/autoflight remain unsupported.

An R44 may reuse much of this machinery after supplying its own parameters and validation. An articulated three-blade Schweizer 269 needs a distinct flapping/lead-lag/ground-resonance model; changing the blade count is insufficient.
