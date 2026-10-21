# Lockheed AH-56A Cheyenne: known issues

Owner: AG (stage-2 flight model package). Ordered by pilot impact, with the test that shows each. Other packages hand their entries over
in PR text; the integrator adds them. Stage 2 is the pure helicopter: the wing and the pusher (stages 3-4) and the high-advance-ratio
aerodynamics with the half-P hop (stage 5) are not in this build, so neither is anything that depends on them.

1. **The gyro's speed-scheduled augmentation is dormant in the sim.** The ICS pitch desensitizer, pitch/roll decoupler and roll compensator,
   and the AMCS trim augmentor and sideslip SAS, need the hub air velocity, which `Rotorcraft.compute` does not pass to
   `ControlGyro.advanceCoupled` yet. A one-line contract request to RC / the integrator is in docs/control-gyro-model.md section 5. The
   tests set the same air data from the flight state (ah56Rig.ts). Evidence: ah56Gyro.test.ts "augmentation tables" (the desensitizer at
   0.857 X at 120 KCAS and 0.50 X at 170, dormant without air data).
2. **ICS pitch/roll cross-coupling.** A pure longitudinal stick gives a roll rate of +0.24 (hover) and −0.14 (100 KCAS) times the pitch rate.
   This is with the input rotation fitted to 13° advanced (P: 36°, which gives about 1.6 times in this model); G8 asks 0.2 with the angle
   within 15° of 36°. The model lacks the ICS's swashplate feedback to the roll servo and the feathering inertia. The AMCS is decoupled
   (−0.005 / +0.07), as AMCS-73 para 35 reports. Evidence: ah56Handling.test.ts G8.
3. **ICS response slower and lower than the derived bands.** Pitch τ63 is 0.84 s at the hover against 1.5–3.5 s, and 0.33 s at 150 KCAS
   against 0.8–2.0 s. The maximum pitch rate is 5.7 °/s/in against 9–14; the maximum roll rate 9.5–10.3 °/s/in against 11–16. The
   desensitizer ratios at speed are 0.66 / 0.81 X against 0.8–1.0 / 0.6–0.8. The accelerations agree (6.4 pitch, 30.9 roll °/s²/in). The
   physical gyro spring precesses the gyro sideways, and the hover attitude change cuts the rise. The plan's G7 and G7b give opposite trends
   for the ICS time constant. Evidence: ah56Handling.test.ts G7 / G7b (it.fails rows).
4. **ICS gust alleviation is weak.** A 3 m/s vertical gust at 100 KTAS leaves 69 % of the locked-gyro hub moment. The droop × in-plane and Cm0
   feathering-moment paths move the gyro's equilibrium; the clean feathering-moment auto-trim removes 96 % within 0.5 s. Hohenemser calls the
   ICS feedback "corrupted" by exactly these terms, but its size here is the model's. Evidence: ah56Gyro.test.ts G3.
5. **Engine failure rolls the aircraft left, not slightly right** (P ASTA-72 para 68 gives "left yaw ... slight right roll" without its
   condition). The left yaw is there: 79°/s within 2 s, collective held. Evidence: ah56Systems.test.ts G11.
6. **No gear-overspeed flag.** `flightModel.checkOverspeed` does not run for a rotorcraft, so extending or flying the gear above 130 KCAS
   (P) raises nothing. Contract request to TW: run its gear rule for a rotorcraft. Evidence: ah56Ground.test.ts G13 (it.fails).
7. **The AMCS pitch sensitivity grows with speed:** 8.3 °/s²/in at the hover, 11.7 at 100 KCAS, 14.1 at 150, where AMCS-73 measured about 9
   throughout. The pitch response falls 7.5 → 4.3 °/s/in where AMCS-73 has 6 throughout (inside ±30 %). Evidence: ah56Handling.test.ts G5 /
   G7b.
8. **The auto-trim loop gain does not scale with rotor speed** (G2 (i)): half of the hingeless hub moment per rad of flap is the spring,
   which does not grow with Ω. Every mode stays stable from 70 % Nr up. Evidence: ah56GyroModes.test.ts.
9. **On the ground, rotor running and the pedals centred, it leans about 3° onto the right main.** The tail rotor's side force acts against a
   62 in track under a CG about 77 in up (a model consequence of ESTIMATE gear numbers; real Cheyenne ground handling data not found).
   Evidence: ah56Ground.test.ts G13 rest.
10. **Estimates** (docs/ah56-flight-model.md): the airframe inertias; ν_β 1.12 and the 10 % equivalent hinge; the blade set (88 % of the polar
    inertia); the T64 running line, losses, start and the gas-generator speed (18,000 rpm); the gear stations (3V), struts, tyres and brakes;
    the fuel capacity (2,500 lb); the V_NE placard (195 KCAS) and the power-off limit; the AMCS gyro momentum, springs, rotating damping
    and the feedback rotation (20°).
11. **Not modelled:**
    - The gyro's nutation, its gimbal reactions on the airframe and the 30 ft-lb non-rotating friction. The 28 ft-lb feather-bearing
      friction is flown as rotating damping.
    - The blade feathering inertia, the lag and torsion degrees of freedom (the in-plane modes behind the half-P hop and the 1P × 2P
      instability; stage 5's scripted event).
    - The tail rotor's δ3; the APU (the start is the generic starter on an APU-backed bus).
    - The ground-rotor droop-stop strike on wheels.
    - The alternate Nf switch, the directional trim switch and the weapons.
12. **Latent, not this type's:** `LandingGear.restingPose` (fixed-wing ground resets) takes the pitch from atan2 of the nose and main contacts.
    A tail wheel in the "nose" slot would get a pitch near 180°. No fixed-wing tail-dragger exists; the AH-56 uses `wheelRestingPose`. Left
    unchanged because the exact fixed-wing goldens read it.
13. **Until the other packages merge** (integrator): AU's audio, AX's visual and PN's panel in this worktree are their scaffold stubs. Their
    copies of the T64's rated power, the pilot's eye and the red line disagree with the stage-2 definition
    (`definitionInconsistencies(ah56)`, GA).
