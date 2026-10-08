# R22 rotorcraft development baseline

The R22 Beta II is an **experimental helicopter implementation**, not a validated high-fidelity R22 simulation. It is intentionally absent from the aircraft chooser until performance and handling acceptance data are available. Open `/?aircraft=r22&scenario=runway&resume=0` to try it, or use `scenario=cruise` for forward flight and `scenario=apron` for a cold start.

## Controls

| Input | Function |
|---|---|
| Arrow keys / pitch and roll axes | Longitudinal and lateral cyclic |
| Z / X / yaw axis | Anti-torque pedals |
| Hold F5 / F6 / assigned collective axis | Lower / raise collective |
| F1–F4 / throttle axis | Engine throttle; with governor on, limits throttle opening |
| Insert | Engage / disengage simplified clutch |
| Delete | Enable / disable RPM governor |

Use the on-screen startup instructions for the simplified cold-start sequence. Rotor RPM is the HUD's **NR** reading; engine RPM is separate. With clutch and governor engaged, allow NR to approach 530 before raising collective gradually. There is no helicopter attitude stabilizer. The airplane autopilot, steering assists, load-factor stops, brakes and trim are not helicopter flight controls. Flight School is unsupported.

The exterior is a procedural engineering model. The inherited generic panel is not an R22 instrument installation; use the HUD's NR and LOW annunciation. The electric warning sound reports low rotor RPM. Audio is synthesized, not an R22 recording.

## Architecture and physics

`src/physics/rotorcraft` supplies rotor loads, shaft coupling and skid contacts. `src/aircraft/r22` supplies the initial aircraft data, input and presentation profiles. The existing rigid-body integrator, atmosphere, wind, mass/fuel, piston engine, electrical system and saved-flight machinery are reused. Fixed-wing aircraft keep their existing solver path.

* Main and tail rotors use 12 radial by 16 azimuth samples per blade, with local tangential velocity, axial velocity, linear twist and analytic section lift/drag. Signed aerodynamic torque permits driving regions in descent. In-plane rotor drag is included.
* Uniform momentum inflow relaxes over time rather than changing instantly. Ground effect uses an image-rotor correction; forward velocity reduces induced losses. The vortex-ring region uses a bounded empirical continuation and thrust reduction.
* Cyclic commands a first-order disc tilt with an estimated teetering lag, body-rate response and aerodynamic blowback. Forces act at the rotor hubs relative to the loaded CG. Tail-rotor force and transmission reaction produce yaw torque.
* Rotor kinetic energy changes through aerodynamic load and engine torque. The engine advances its own shaft; a one-way clutch couples it through the transmission ratio and efficiency. A slow or stopped engine is not driven by the rotor. A rate-limited governor adjusts throttle, never directly sets rotor speed.
* Four spring/damper skid contacts provide terrain-normal loads and regularized sliding friction. Cabin, tail hub and sampled main-disc contacts detect strikes. These are coarse collision envelopes.
* Airborne initialization numerically solves force/moment equilibrium for roll, pitch, collective, cyclic and pedals, then settles engine induction and governor throttle. This is an aerodynamic trim, not proof that available engine power suffices at every altitude/loading.
* Saved flights include rotor speed, azimuth, inflow, flapping and governor state. Missing or malformed R22 rotor snapshots are rejected. Time acceleration retains the normal physics step instead of switching to the airplane coarse step.

The current aircraft contract still requires wing, wheel and propeller fields. The R22 retains inactive C152 compatibility data for those APIs; those fields do **not** supply helicopter aerodynamic or contact forces. Its engine's compatibility propeller loads and slipstream are disabled. Diagnostic consumers of `aero()` or `gear()` must use `rotorcraft` instead. The training schema also retains unused airplane fields; no helicopter checklists or lessons are published.

## Data provenance

Primary reference: Robinson's [R22 Pilot's Operating Handbook, General](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r22_poh_1_f2700c9508.pdf), available through the [manufacturer's publications](https://www.robinsonheli.com/publications). Operating restrictions must be checked against the applicable aircraft's current handbook; the simulator does not implement the full operating envelope.

| Parameter | Implemented value | Basis |
|---|---|---|
| Main rotor | Two blades, 25 ft 2 in diameter, −8° twist | Published geometry |
| Main chord | 0.18923 m constant | Mean of published 7.2–7.7 in taper |
| Tail rotor | Two blades, 42 in diameter, 4 in chord, zero twist | Published geometry |
| Governed speed | Approximately 530 rotor / 2652 engine RPM | 104% operating reference; rounded rotor RPM |
| Tail/main ratio | (47/11) × (3/2) | Published transmission ratios |
| Engine | O-360-J2A, 131 hp modeled rating | Takeoff rating; continuous limit/timer not enforced |
| Maximum mass | 622.56 kg (1370 lb) | Nominal Beta II maximum gross mass |
| Fuel | 19.2 + 7.2 US gal usable | Standard/auxiliary baseline; installation-specific |

Everything beyond the published geometry and nominal ratings needs calibration. In particular, rotor inertias (105 and 0.22 kg·m²), section polars, root cutouts, pitch limits, cyclic authority, flapping time constant, hub/CG positions, airframe inertia, empty mass, drag areas, transmission loss, engine intake/thermal/starter parameters and skid coefficients are **engineering estimates**. These are exposed as data, not claimed as measured R22 values.

## Fidelity boundaries and next acceptance work

The current tests establish numerical and integration behavior: hover and forward-flight trims, control signs, vertical liftoff, ten-second trimmed hover, collective-induced RPM droop, freewheel behavior, cold start/spin-up, ground effect, translational lift, density effects, rotor quadrature refinement, impacts, control separation and snapshot restoration. They do not establish agreement with a real helicopter.

Before calling this model ultra-realistic:

1. Calibrate power required, fuel flow and manifold pressure against handbook hover ceilings, climb and cruise performance across mass, density altitude and temperature. Enforce continuous/takeoff power and altitude-dependent speed limits.
2. Replace estimated polars and inertias with traceable blade/airframe data, including Reynolds/Mach effects, dynamic stall, advancing/retreating asymmetry and coning. Add measured response and control-coupling acceptance traces.
3. Replace commanded disc tilt with blade flapping dynamics and consistent angular-momentum exchange. A rigid-disc gyroscopic term is deliberately omitted because adding it without flapping angular-momentum derivatives would double-count body coupling.
4. Validate complete autorotative descents, flare and landing against measured performance. Signed section torque and freewheeling alone do not validate autorotation handling. Validate vortex-ring behavior and tail-rotor effectiveness; the empirical model does not resolve wake interactions or LTE.
5. Add teeter-stop/mast-bumping and low-G behavior, blade elasticity, detailed clutch engagement, rotor brake, dynamic rollover damage and helicopter-specific structural limits. Airplane structural-failure rules are bypassed, not reused as helicopter limits.
6. Build the R22 cockpit, dual tachometer, accurate systems/annunciators, visual geometry and sound, then conduct pilot evaluation.

An R44 can reuse the interfaces and much of the teetering-rotor machinery after supplying its own geometry, inertia, engine/drivetrain, hydraulic/control and acceptance data. A Schweizer 269's three-bladed articulated rotor needs a distinct hub/flapping/lead-lag model and ground-resonance treatment; changing blade count in the R22 profile is insufficient. Neither aircraft is registered as flyable yet.
