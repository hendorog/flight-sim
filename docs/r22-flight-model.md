# R22 Beta II flight model

Round 2 validates airborne trim across the mass/CG envelope, powered approaches and landings, a cold-start
flight sequence including a 360° cruise turn, and keyboard hover. **A satisfactory autorotative landing
within the power-off RPM arc remains unvalidated.** Two explicitly named expected-failure tests preserve
that acceptance gap and its complete flight trace. This is an experimental, reduced-order model.

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
- Four compliant skid contacts have normal spring/damper forces and regularized Coulomb sliding friction. Resting pitch/roll account for spring compression and loaded CG. There is no wheel/brake force. Cabin, main-disc rim (including flap/coning) and tail-disc rim contacts detect strikes; sink/depth limits detect hard landings. Contact history advances only at RK stage zero; intermediate-stage updates previously swallowed the touchdown event. Contact geometry is coarse and contains no skid elasticity, terrain snag model or certified rollover envelope.

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

### Autorotation: descent validated, complete landing acceptance still open

At gross weight, a 65-KIAS engine failure with collective held reaches the 97% horn in **0.642 s**. Full-down
collective and a speed/attitude pilot settle at **109.5%, 1697 fpm** gross and **99.3%, 1622 fpm** light solo,
near 64.5 KIAS. POH 3-2 specifies 65 KIAS and 97–110%, with a light-weight warning that 97% may be unattainable.
MM 10.250 figure 10-15 also shows higher full-down RPM at heavier weight. POH 3-3’s approximately 4:1 glide
is the separate **75 KIAS / 90%** configuration, still unvalidated.

The complete scripted attempts start at 350 m / 65 KIAS, cut the engine, lower collective, establish the
descent, flare, level and pull collective. Aft cyclic raises rotor RPM and arrests descent while slowing.
The retained gross/solo traces reach **109.88% / 108.23%** in the flare. First contact is **0.70 m/s at 4.44 kt**
gross and **0.39 m/s at 1.50 kt** solo, without a modelled crash through subsequent settling. However, rotor
speed is only **68.2% / 59.8%** at touchdown. These are **not accepted R22 autorotation landings**.

The scripted flare balloons, then the cushion starts around 4.5 m instead of a few feet, using too much
stored rotor energy. Trials with later pulls often hit hard or strike the tail. Rotor energy is integrated
from signed aerodynamic torque, and no speed clamp, inertia increase, special landing lift or reduced
impact threshold was added. Inflow lag, the uniform windmill/VRS transition and low-RPM section polars
remain insufficiently validated to distinguish all pilot-scheduling error from model error. The existing
skid damage threshold permitting a touchdown is therefore insufficient evidence of a realistic landing.
`flights.test.ts` marks both strict landing cases `it.fails` and retains their desired RPM/sink/speed/damage
criteria. They must become ordinary passing tests before the landing is claimed complete.

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

## Remaining work

1. Resolve the two explicit autorotative-landing expected failures, with a level-off and cushion at a few feet
   and realistic rotor RPM; validate the low-RPM stall/ground-contact envelope and pilot timing.
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
