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

The second pilot-only flare revision replaces the fixed large pitch demand with a height-indexed sink
schedule. The owner's **about 60 ft skid-height** cue takes precedence for this demonstration. The shared
pilot starts moving its hands when current height plus 0.6 seconds of observed descent reaches 60 ft;
this compensates for hand and attitude response, rather than waiting until 60 ft to start responding.
The command therefore starts at **75.8 / 76.4 ft** gross/solo; the nose has risen one degree by
**66.4 / 63.9 ft**. At 60 ft it is already rising and is **−3.4 / −3.8°**, rather than the old −6.4 / −5.7°.
The observation still uses reference-point AGL minus the level skid offset, not the lowest tilted skid.

The engineering target is `VS = −1 − 7 × clamp((height_ft − 8) / 52, 0, 1)²` in m/s:

| Nominal skid height | 60 ft | 45 ft | 30 ft | 15 ft | 8 ft |
|---|---:|---:|---:|---:|---:|
| Target descent, ft/min | 1575 | 895 | 444 | 222 | 197 |

The quadratic reduces sink in the upper flare and progressively eases the arrest near the ground; the
nonzero 1 m/s endpoint avoids commanding a hover. This is an estimated pilot objective, **not a POH
performance curve** or a fully tracked/validated trajectory. In particular the solo case lags it between
60 and 30 ft. Cyclic follows sink error and the 0.3-second-smoothed sink trend, with height-schedule trend
anticipation. The attitude demand changes at at most **6°/s** during flare; the **18°** cap is a stop,
not an attitude target. Maximum measured body pitch rates are **7.27 / 8.88°/s** in the sea-level flare,
with maximum attitudes through level entry only about **13°**. The observed attitude can lag or overshoot
the rate-limited demand. Longitudinal cyclic stays within **0.8 units/s**, collective within **0.5 travel/s**,
and pedals within the existing **0.7/s**. Powered flights retain their original controller settings.

At **8 ft**, the pilot commands level attitude with a **12°/s** demand limit and increased pitch damping.
When the observed vertical acceleration falls below −0.2 m/s² during levelling, it starts a progressive
collective pull to follow −0.8 m/s sink. This happens at **7.37 / 7.97 ft** in the sea-level cases, and
**6.87 / 7.95 ft** in the app; there is no fixed 2 ft trigger. Collective before this point responds only
to rotor RPM and its observed trend. The proportional tachometer feedback aims within the green arc;
it has no mass, thrust, inflow, rotor-energy calculation, trim solver or mutable aircraft-state access.
No physics, initial loading, aircraft data, terrain, FOV or damage thresholds changed.

[POH 3-2 and 2-8](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r22_poh_full_book_b79e920713.pdf)
give approximately 65 KIAS, 97–110% power-off procedure RPM, a flare around 40 ft, levelling around 8 ft,
and collective before touchdown. Beta II's green arc is **101–104%**; the **90–110%** power-off limits
include yellow extensions. The gross sea-level flare stays at **102.51–103.74%**. Solo starts at **99.59%**
with collective fully down and peaks at **102.76%**; it cannot be described as green throughout. The entry
still starts with an instantaneous engine cut and collective already down, as in the existing fixtures.

**Both strict landing tests remain expected failures.** The balloon is removed, first contact is level
and cushioned, and RPM is within the power-off limits at contact. However, **ground speed is much too high**.
The gross case then pitches forward into a main-rotor strike during the skid slide. The solo case's
terminal “complete” means the demonstration ended, not that landing acceptance passed. The unchanged
acceptance requires a landing without damage, <5 kt ground speed, <1.5 m/s skid sink, touchdown NR ≥90%,
and maximum NR ≤110%. The generic reproduction assertions now check the direction of speed/sink response
instead of the old balloon's RPM rise, near-zero VS and 20 kt flare deceleration; they do not replace these
strict limits. The gentler solo flare sheds less than 20 kt before levelling.

At every airborne **240 Hz step**, from anticipatory flare entry through levelling and cushioning to first
contact, vertical speed remains **negative** and altitude decreases in all four cases below. Both test
fixtures now assert this at full rate; the 4 Hz graph is not the acceptance measurement. Small sink-rate
ripples remain, especially solo, so a mathematically monotonic reduction in sink is **not** established.
Levelling is commanded at 8 ft, but attitude is still **12.6 / 10.8°** there in sea-level gross/solo;
**an achieved level attitude at 8 ft is also still missing**. Neither gap is hidden by a state reset.

The following height crossings are interpolated from full-rate traces. Positive pitch is nose-up; negative
VS is descent. “Touchdown” is the state immediately before first skid contact (within one 1/240 s step);
the event's skid-normal sink is reported separately. Gross is 621.42 kg; solo is 512.06 kg with half fuel.

**Sea level, gross (621.42 kg)**

| Height, ft | Pitch, ° | IAS, kt | VS, fpm | Rotor, % |
|---|---:|---:|---:|---:|
| 60 | -3.4 | 64.8 | -1317 | 103.6 |
| 45 | -0.2 | 63.0 | -933 | 103.7 |
| 30 | +3.6 | 59.1 | -539 | 103.3 |
| 15 | +9.0 | 49.3 | -288 | 102.7 |
| 8 | +12.6 | 41.4 | -284 | 102.5 |
| 3 | +5.3 | 35.9 | -232 | 99.5 |
| Touchdown | +1.3 | 34.4 | -231 | 94.8 |

First skid contact: **1.08 m/s**, **34.27 kt GS**, **94.85% NR**. Final damage: **Main rotor strike**. Maximum airborne VS from flare entry through first contact: **-1.130 m/s**; maximum 240 Hz altitude increment **-0.004707 m**.

**App, gross (621.42 kg)**

| Height, ft | Pitch, ° | IAS, kt | VS, fpm | Rotor, % |
|---|---:|---:|---:|---:|
| 60 | -3.3 | 64.3 | -1300 | 103.7 |
| 45 | -0.4 | 62.6 | -949 | 103.8 |
| 30 | +3.5 | 58.7 | -520 | 103.4 |
| 15 | +8.5 | 48.9 | -288 | 102.7 |
| 8 | +13.1 | 41.2 | -261 | 102.7 |
| 3 | +5.7 | 35.9 | -234 | 100.0 |
| Touchdown | +1.3 | 34.4 | -234 | 95.3 |

First skid contact: **1.15 m/s**, **34.51 kt GS**, **95.30% NR**. Final damage: **Main rotor strike**. Maximum airborne VS from flare entry through first contact: **-1.184 m/s**; maximum 240 Hz altitude increment **-0.004933 m**.

**Sea level, solo (512.06 kg)**

| Height, ft | Pitch, ° | IAS, kt | VS, fpm | Rotor, % |
|---|---:|---:|---:|---:|
| 60 | -3.8 | 65.3 | -1582 | 100.1 |
| 45 | -0.2 | 64.1 | -1347 | 101.5 |
| 30 | +4.4 | 59.6 | -515 | 102.3 |
| 15 | +10.6 | 52.5 | -275 | 102.1 |
| 8 | +10.8 | 44.9 | -305 | 100.7 |
| 3 | +3.7 | 40.1 | -232 | 97.9 |
| Touchdown | +1.5 | 39.0 | -217 | 94.0 |

First skid contact: **1.08 m/s**, **38.93 kt GS**, **93.95% NR**. Final damage: **none**. Maximum airborne VS from flare entry through first contact: **-1.011 m/s**; maximum 240 Hz altitude increment **-0.004213 m**.

**App, solo (512.06 kg)**

| Height, ft | Pitch, ° | IAS, kt | VS, fpm | Rotor, % |
|---|---:|---:|---:|---:|
| 60 | -3.8 | 64.9 | -1583 | 100.6 |
| 45 | +0.2 | 63.5 | -1279 | 102.1 |
| 30 | +3.5 | 59.1 | -540 | 102.2 |
| 15 | +10.5 | 51.7 | -225 | 102.1 |
| 8 | +11.5 | 45.0 | -318 | 101.0 |
| 3 | +4.5 | 39.9 | -239 | 98.6 |
| Touchdown | +1.6 | 38.7 | -222 | 94.8 |

First skid contact: **1.10 m/s**, **38.84 kt GS**, **94.84% NR**. Final damage: **none**. Maximum airborne VS from flare entry through first contact: **-1.060 m/s**; maximum 240 Hz altitude increment **-0.004416 m**.


### What still limits the landing

The smooth sink schedule spends less forward kinetic energy than the previous ballooning pull. At 8 ft
there is still **41.4 / 44.9 KIAS** at sea level. This pilot does not shed that speed during
levelling in the remaining height/time. First-contact ground speed is **34.27 / 38.93 kt**, a regression from the old
hard impacts at 20.78 / 19.60 kt even though sink improves from roughly 5.6 / 5.3 to **1.08 / 1.08 m/s**.
This is not an acceptable run-on landing; the gross skid slide ends in damage about 1.25 seconds later.

Diagnostic alternative traces in `work/flare-progressive/` preserve the rejected attempts. A shallower
80 fpm terminal schedule with a longer high-pitch flare (`trial6`) reduced gross contact speed to 16.6 kt,
but spent RPM down to 86.7% and still damaged the aircraft. Earlier levelling intended to be level by 8 ft
(`trial14`) achieved about 1.5–1.8° at that height, but the longer cushion ended at **77.4 / 81.4% NR** and
29.2 / 36.7 kt. Raising attitude-loop gains (`trial4`) produced unacceptable pitch oscillations; allowing
30° demand (`trial3`) produced tail strikes. These alternatives were rejected, not hidden or promoted.

The observations show a pilot energy/timing tradeoff in this model; they do **not** prove the physics
makes a successful R22 autorotation impossible. This revision has not solved the simultaneous speed,
sink and levelling objectives. It makes the requested gentler, non-ballooning flare reviewable without
changing inertia, inflow, polar, forces, RPM, position or contact thresholds. Model validation and further
pilot technique work remain necessary. Full-rate traces are `final-{gross,solo}.json` and
`app-final-{gross,solo}.json`, with height tables/summary in `tables.md` / `summary.json` and the inspected
comparison plot `before-after.png`, all under ignored `work/flare-progressive/`.

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
60 ft sink schedule, 8 ft level command and sink-triggered cushion described above; landing acceptance, physics and aircraft data are unchanged.

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

The four powered demonstrations complete without a modelled crash. The revised autorotation makes first contact softly but far too fast, then stops at a rotor strike
during the skid slide. It remains explicitly labelled as a known landing gap. The full circuit retains the original sequence
of phases and 360° cruise turn; it is not a rectangular airport circuit or a navigation demonstration, and
lands in a field beyond the airport. The scripts contain neither obstacle avoidance nor a landing-site
selection controller. They reproduce engineering flights, not complete operating/checklist procedures.

| Flight | Completion | Observed result in the app |
|---|---:|---|
| Startup | 115.00 s | 2.90 m skid height, 0.3 KIAS, 103.4% NR |
| Hover → cruise | 145.00 s | 60.1 KIAS / 488 ft/min during climb; 84.3 KIAS at completion |
| Approach | 123.15 s | First contact 0.045 m/s, 0.055 kt, 103.62% NR |
| Autorotation | 50.46 s, damaged | First contact: **1.15 m/s skid sink, 34.51 kt, 95.30% NR**; subsequent main-rotor strike |
| Circuit | 488.70 s | First landing contact 0.049 m/s, 0.054 kt, 103.62% NR |

The current autorotation caption describes the height-indexed flare, 8 ft level command and sink-triggered
cushion, and explicitly retains the excessive-ground-speed landing gap. Both strict landing tests remain
`it.fails`. App integration now also covers solo loading and checks the absence of altitude gain at 240 Hz.
The gross app flight still stops damaged; a terminal hold is not landing acceptance. Inspected captures
for this revision are under `work/flare-progressive/` (60, 30, 8 and 3 ft cockpit views and terminal state).
Earlier captures below are retained as historical diagnostics, not the current flare result.

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

### Progressive flare verification (current uncommitted revision)

`npx tsc --noEmit` passed. `R22_TRACE=1 npx vitest run tests/rotorcraft/flights.test.ts
tests/rotorcraft/demo.test.ts` passed **15 tests plus two expected failures** in **50.58 s**, including
both weights, both atmospheres/scenery fixtures, 240 Hz no-altitude-gain checks, visible nose rise near
60 ft, hand-rate bounds, powered-flight regressions and app terminal hold. Strict landing acceptance
remains unchanged and fails at both weights.

The full `npx vitest run --maxWorkers=4` passed **2,676 tests**, with **two expected failures and 221
skipped** (188 files passed, four skipped; **322.40 s**). There were **no ordinary failures**. Logs are
`work/flare-progressive/area-final.log`, `typecheck-final.log` and `full-suite.log`.

Headless Chrome captures were generated and inspected at **1600×900**: `camera-60ft.png`,
`cockpit-30.png`, `cockpit-8.png`, `cockpit-3.png` and `cockpit-terminal.png`, all under
`work/flare-progressive/`. `camera.json` contains the terrain/eye measurements; `captures.json` contains
per-capture app state. The before/after diagnostic plot was also inspected. Rendering uses the existing
headless Vulkan/Mesa llvmpipe path and paused, exact physics stepping. These captures establish the shown
states and captions; the owner's judgement of live handling remains outstanding.

Only `src/sim/rotorcraft/flights.ts`, `src/sim/rotorcraft/scriptedPilot.ts`, the requested caption in
`src/ui/rotorcraftDemo.ts`, `tests/rotorcraft/flights.test.ts`, `tests/rotorcraft/demo.test.ts`, and this
report changed. The latter four files are outside the shared pilot directory but are within the requested
caption/tests/documentation scope. All scratch artifacts stay in ignored `work/`. Changes are left
**uncommitted**, as requested; physics, aircraft geometry/data, state contracts and camera defaults are untouched.

### Previous autorotation flare verification (d6a7bda)

`npx tsc --noEmit` passed. `R22_TRACE=1 npx vitest run tests/rotorcraft/flights.test.ts
tests/rotorcraft/demo.test.ts` passed **12 tests plus two expected failures** (52.31 s), including powered
flight regressions, both 60/8/2 ft phase schedules, measured cyclic/collective rate limits, app execution
and terminal hold. `npx vitest run --maxWorkers=4` passed **2,673 tests**, with **two expected failures and
221 skipped** (188 files passed, four skipped; 328.03 s). There were no ordinary failures. The two expected
failures are the unchanged strict autorotation landing acceptance; the new hard impacts remain failures.
Logs: `work/flare-rework/tests.log`, `full-suite.log`, and `typecheck-final.log` in the same directory.
`comparison.json` contains the before/after summary; both rendered screenshots and the plot were inspected.
All changes are left uncommitted for the supervisor as requested. No physics, aircraft data, shared geometry,
or system-state contracts changed; no files outside the pilot/caption/tests/documentation task scope changed.

## Remaining work

1. Resolve both autorotative-landing expected failures: shed forward speed without a balloon, achieve level
   attitude near 8 ft and preserve enough rotor energy for a soft, slow touchdown. The progressive sink
   schedule passes no-climb checks but does not meet the combined landing objectives.
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
