# R22 Beta II flight model

Round 3 adds surface-dependent skid sliding and static grip, and keeps the demonstration pilot active
through touchdown and the ground slide. Both weights now touch below 10 kt without modelled damage,
but **a satisfactory autorotation remains unvalidated**: the slow touchdown spends rotor RPM below the
90% power-off limit and uses excessive late pitch. The two complete-landing expected failures remain.
This is an experimental, reduced-order model, not a validated flight-training procedure.

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
- Uniform dynamic inflow produces translational lift and power reduction. An image-rotor term reduces inflow near ground. The vortex-ring region uses a smooth empirical inflow continuation and thrust loss; it does not resolve wake recirculation, buffeting or recovery trajectories.
- Fixed stabilizer and upper/lower fin loads use their own local airspeed, including body rotation. Estimated rotor wash affects the stabilizer at low speed. Fuselage drag and destabilizing pitch/yaw derivatives combine with the tail surfaces to provide forward-flight static stability and damping. There is no hidden attitude feedback.
- Tail thrust acts right at the left-side shared tail hub, yawing the nose left against CCW main-rotor torque. Signed sideslip enters axial inflow; estimated main wake enters the tail disc's in-plane flow. Forward-flight fin unloading reduces pedal demand. Power loss removes drivetrain reaction torque, requiring right pedal. LTE/free-wake interference is not resolved.
- Rotor energy integrates aerodynamic torque against main plus geared tail polar inertia. Belt engagement ramps over actuator travel; a capacity-limited impulse couples the engine through a one-way sprag, dissipating slip energy and preventing rotor back-drive of a slower engine. The governor changes throttle, never rotor RPM directly.
- `takeoffPowerSeconds` accumulates time above 124 hp or the current MCP MAP (at operating RPM), resetting below both; `powerLimitExceeded` reports over 131 hp (1% numerical allowance), over the five-minute MAP (+0.05 inHg allowance), or more than 300 seconds above MCP. No detailed overstress damage or cumulative engine-life model exists. `vneKias` interpolates POH 2-11 pressure-altitude/temperature limits; `airspeedLimitExceeded` reports exceedance. Blank/outside-table cells conservatively return zero (outside approved envelope). Neither warning automatically reduces power or airspeed.
- Four compliant skid contacts have normal spring/damper forces, tangential static compliance and surface-dependent sliding friction. Resting pitch/roll account for spring compression and loaded CG. There is no wheel/brake force. Cabin, main-disc rim (including flap/coning) and tail-disc rim contacts detect strikes; sink/depth limits detect hard landings. Contact history advances only at RK stage zero; intermediate-stage updates previously swallowed the touchdown event. Contact geometry is coarse and contains no structural skid flexure, terrain snag model, blade/tailcone collision test or certified rollover envelope.

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
0.12/s; the revised autorotation flare uses 0.8/s longitudinal cyclic and 0.5/s collective. These are
engineering pilot hand-motion limits, not measured pilot-response data. Autorotation now uses the
60 ft entry and continued deceleration/cushion described above, followed by active slide control. Only the rotorcraft skid contact model and its surface data change in the physics path.

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

## Remaining work

1. Resolve both autorotative-landing expected failures: preserve ≥90% NR while touching below 10 kt,
   <1.5 m/s and with a near-level attitude. The current slow touchdown meets speed/sink/no-climb/damage
   checks but spends too much RPM and still uses excessive late pitch. Reconcile the shared pilot and
   rotor/transient model against handling evidence; also validate blade/tailcone clearance.
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
