# Lockheed AH-56A Cheyenne: known issues

Owner: AG (stage-2 flight model package). Ordered by pilot impact, with the test that shows each. Other packages hand their entries over
in PR text; the integrator adds them. Stage 2 is the pure helicopter: the wing and the pusher (stages 3-4) and the high-advance-ratio
aerodynamics with the half-P hop (stage 5) are not in this build, so neither is anything that depends on them.

1. **The gyro's speed-scheduled augmentation is dormant in the sim.** The ICS pitch desensitizer, pitch/roll decoupler and roll compensator,
   and the AMCS trim augmentor and sideslip SAS, need the hub air velocity, which `Rotorcraft.compute` does not pass to
   `ControlGyro.advanceCoupled` yet. A one-line contract request to RC / the integrator is in docs/control-gyro-model.md section 5. The
   tests set the same air data before the trim and from the flight state on every step (ah56Rig.ts), so the G5/G7b/G8 rows are certified
   through that stand-in. With the requested call applied (work/rigid/ag-integrator-requests.patch, applied and reverted) the sim agrees
   with the rig: AMCS pitch 4.78 / 4.26 against 4.79 / 4.27 °/s/in at 100 / 150 KCAS, roll within 0.09 °/s/in, the 150 KCAS roll
   sensitivity 65.8 against 65.1 °/s²/in, G8 p/q 0.09 against 0.08; every row passes or fails as before. The rig retires the stand-in by
   itself once the wiring is in (PRODUCTION_AIR_WIRED). Must land before the stage-2 pilot review. Evidence: ah56Gyro.test.ts
   "augmentation tables" (the desensitizer at 0.857 X at 120 KCAS and 0.50 X at 170, dormant without air data).
2. **The hands-off hover drifts away from the spawn.** From the 15 m hover spawn (18,300 lb, the test loading) in calm air the AMCS rolls
   from 5.1° to 1.3° left in 20 s with the nose 6.4° down and 11 kt of drift; the ICS from 5.0° to 1.4° left, nose 10.3° up, 7 kt. The trim
   balances the rotor at exactly zero airspeed, where `Rotorcraft.compute` applies no main-rotor in-plane force; the first step's 1e-7 m/s
   switches on the hingeless rotor's hover in-plane force (about 330 N) along an arbitrary direction, a 625 N m rolling moment the trim
   never saw, and the AMCS turns a steady moment into a steady rate (about 0.26 °/s per kN m: it nulls the hub moment, not the attitude
   error; ah56Handling.test.ts "G6 variant"). Contract request to RC: work/rigid/ag-rc-inplane-fade.patch fades the force in over the
   first 0.3 m/s (legacy digests unchanged); with it AMCS −5.1 → −6.2° and ICS −5.0 → −7.2° (0.2° past the G9 band), 3.1 kt each, in 20 s.
   Evidence: ah56Ground.test.ts "hover readout" (it.fails), docs/ah56-flight-model.md section 6.
3. **ICS pitch/roll cross-coupling.** A pure longitudinal stick gives a roll rate of +0.24 (hover) and −0.14 (100 KCAS) times the pitch rate.
   This is with the input rotation fitted to 13° advanced (P: 36°, which gives about 1.6 times in this model); G8 asks 0.2 with the angle
   within 15° of 36°. The model lacks the ICS's swashplate feedback to the roll servo and the feathering inertia. The AMCS is decoupled
   (+0.02 / +0.08 with the input at 9° advanced), as AMCS-73 para 35 reports. Evidence: ah56Handling.test.ts G8.
4. **ICS response slower and lower than the derived bands.** Pitch τ63 is 0.84 s at the hover against 1.5–3.5 s, and 0.32 s at 150 KCAS
   against 0.8–2.0 s; roll τ63 0.295 s against 0.3–0.7 (interpolated; 1.7 % under the edge). The maximum (first-peak) pitch rate is 5.7
   °/s/in at the hover (2.6 at 150 KCAS) against 9–14; the maximum roll rate 9.5–10.2 °/s/in against 11–16. The desensitizer ratios at
   speed are 0.47 / 0.45 X on the maximum rate (0.65 / 0.60 on the plan's rate at 1 s) against 0.8–1.0 / 0.6–0.8. The accelerations agree
   (6.4 pitch, 30.9 roll °/s²/in). The pitch and roll misses are the droop × in-plane feedback term (without it pitch τ63 is 2.28 s, but roll
   runs to 35 °/s/in); the G7b ratios are not (0.15 / 0.15 without it). The model flies that term in the sense opposite to the blade
   geometry's, because the derived sense is unstable at the P droop (#5). The plan's G7 and G7b give opposite trends for the ICS time
   constant. Evidence: ah56Handling.test.ts G7 / G7b (it.fails rows), docs/control-gyro-model.md section 3.
5. **ICS gust alleviation is weak, and the droop term's sign is the model's, not the geometry's.** A 3 m/s vertical gust at 100 KTAS leaves
   69 % of the locked-gyro hub moment; all of it is the droop × in-plane path (without it 4 %; Cm0 moves it ±0.2 kN m). The sweep and Cm0
   signs follow the blade geometry; the droop sign does not: drag below a drooped feathering axis twists the blade nose down, the model
   flies nose up (DROOP_SENSE +1) because the derived sense at the P 3°10′ droop is a limit cycle between the gyro stops in the hover
   (15.4° of tilt 6 s after a 0.5° kick; stable at half the droop). The droop direction itself is INF (the sources give no direction).
   Hohenemser calls the ICS feedback "corrupted" by these terms; its size and sign here are the model's. Evidence: ah56Gyro.test.ts G3 and
   "feathering-moment signs", docs/control-gyro-model.md section 3.
6. **Engine failure rolls the aircraft left, not slightly right** (P ASTA-72 para 68 gives "left yaw ... slight right roll" without its
   condition). The left yaw is there: 79°/s within 2 s, collective held. Evidence: ah56Systems.test.ts G11.
7. **No gear-overspeed flag.** `flightModel.checkOverspeed` does not run for a rotorcraft, so extending or flying the gear above 130 KCAS
   (P) raises nothing. Contract request to TW: run its gear rule for a rotorcraft. Evidence: ah56Ground.test.ts G13 (it.fails).
8. **The AMCS pitch fit has no margin, and Hohenemser's hover number is out of reach.** With H fixed at the ICS value only the stick moment
   and K_R are free. Read at the first peak of the held step, the pitch response falls with speed (6.08 °/s/in at the hover, 4.79 at 100
   KCAS, 4.27 at 150) where AMCS-73 para 33 measured about 6 throughout; its sensitivity runs high (11.6 °/s²/in at the hover against 9).
   Margins: the 150 KCAS rate 1.7 % above the 4.2 edge, the sensitivity 1.1 % under 11.7, the 150 KCAS roll sensitivity 5.5 % under 68.9.
   Hoh-74's 9 °/s/in at the hover (≥ 6.3) cannot be met with the 9 °/s²/in sensitivity by any (M, K_R): the sensitivity per unit response
   is 1.91 /s at every K_R 6–7.5 kN m/rad (the bands need 1.86), and from 8 up the hover rate has no first peak inside 3 s (G5 it.fails).
   **The stage-4 refit is mandatory**: the pusher and the drag recalibration change the pitch damping and stability
   (docs/control-gyro-model.md section 6, the grid). Evidence: ah56Handling.test.ts G5 / G7b.
9. **The auto-trim loop gain does not scale with rotor speed, and that is right** (G2 (i)): 35 % of the hingeless hub moment per rad of flap
   at 100 % is the spring (52 % at 70 %), which does not grow with Ω, so loop/Ω falls 1.69 → 1.16 from 70 to 110 % Nr. The plan row assumed
   a purely centrifugal hub; the test asserts tan(sweep)(B/2)(e M_β Ω² + K_β)/H instead (plan amendment requested). Every mode stays stable
   from 70 % Nr up. Evidence: ah56GyroModes.test.ts.
10. **On the ground it leans onto the right main, and full left pedal with the brakes off trips it over.** Rotor running, pedals centred:
   2.3° after 5 s (1.9° at 10 s), loads tail 6.8 / left 30.6 / right 51.9 kN; the tail rotor gives 3.6 kN of side force at the centred
   pedal (8.4° of pitch, the middle of −7.4…24.2°), the main rotor at the bottom of the collective (−2.5°, shared by both configurations;
   the ICS's P floor is 0.5°) presses the gear with −8.1 kN, against a 62 in track under a CG about 77 in up (the gravity overturning term
   W h ≈ 160 kN m/rad). The main oleos were stiffened (gas column 0.22 → 0.16 m, ESTIMATE; 3.0° before). Full pedal at ground idle with the
   parking brake: roll ≤ 2.8°, the aircraft pivots about the mains at up to 86 °/s (left pedal). **Brakes off, full left pedal at ground
   idle** spins it to 108 °/s and trips it over the left main onto the wingtip in under 4 s (it.fails). Real Cheyenne ground-handling data
   not found; the tyre friction, gear and CG height are ESTIMATES. A per-configuration collective floor needs a definition seam (contract
   request). Evidence: ah56Ground.test.ts G13 rest and tip-over margin.
11. **Estimates** (docs/ah56-flight-model.md): the airframe inertias; ν_β 1.12 and the 10 % equivalent hinge; the blade set (88 % of the polar
    inertia); the T64 running line, losses, start and the gas-generator speed (18,000 rpm); the gear stations (3V), struts, tyres and brakes;
    the fuel capacity (2,500 lb); the V_NE placard (195 KCAS) and the power-off limit; the AMCS gyro momentum, springs, rotating damping
    and the feedback rotation (20°).
12. **Not modelled:**
    - The gyro's nutation, its gimbal reactions on the airframe and the 30 ft-lb non-rotating friction. The 28 ft-lb feather-bearing
      friction is flown as rotating damping.
    - The blade feathering inertia, the lag and torsion degrees of freedom (the in-plane modes behind the half-P hop and the 1P × 2P
      instability; stage 5's scripted event).
    - The tail rotor's δ3; the APU (the start is the generic starter on an APU-backed bus).
    - The ground-rotor droop-stop strike on wheels.
    - The alternate Nf switch, the directional trim switch and the weapons.
13. **Latent, not this type's:** `LandingGear.restingPose` (fixed-wing ground resets) takes the pitch from atan2 of the nose and main contacts.
    A tail wheel in the "nose" slot would get a pitch near 180°. No fixed-wing tail-dragger exists; the AH-56 uses `wheelRestingPose`. Left
    unchanged because the exact fixed-wing goldens read it.
14. **Until the other packages merge** (integrator): AU's audio, AX's visual and PN's panel in this worktree are their scaffold stubs. Their
    copies of the T64's rated power, the pilot's eye and the red line disagree with the stage-2 definition
    (`definitionInconsistencies(ah56)`, GA: 5 rows). The merge order lands AU and PN before AG, so the integrator reconciles them at the AG
    merge: AU, PN and AX read `AH56_ENGINE_RATED_W` (facts.ts, 3.229 MW), `AH56_REFERENCE.vne` (reference.ts, 195 KCAS) and
    `PILOT_EYE` (dimensions.ts) instead of copies; the list must be empty on integ (plan gate step 2).
