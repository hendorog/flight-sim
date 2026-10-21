# Lockheed AH-56A Cheyenne: known issues

Owner: AG (stage-2 flight model package). Ordered by pilot impact, with the test that shows each. Other packages hand their entries over
in PR text; the integrator adds them. Stage 2 is the pure helicopter: the wing and the pusher (stages 3-4) and the high-advance-ratio
aerodynamics with the half-P hop (stage 5) are not in this build, so neither is anything that depends on them.

1. **Resolved at the AG merge (integrator): the gyro's speed-scheduled augmentation is live in the sim.** `Rotorcraft.compute` now
   passes `{ hub: hubAir, density }` to `ControlGyro.advanceCoupled` (AG's request, work/rigid/ag-integrator-requests.patch, applied in
   the merge commit). The rig's stand-in retired itself (PRODUCTION_AIR_WIRED); the AG list on the merged tree: 73 passed, 10 expected
   fail, 0 failed. Kept here so the numbers in item 8 and docs/control-gyro-model.md section 5 read in context.
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
7. **Resolved at the AG merge (integrator): the gear-overspeed flag.** `flightModel.checkStructure` runs `checkOverspeed`'s gear rule for a
   retractable rotorcraft (TW's file; AG's request applied in the merge commit). ah56Ground.test.ts G13 is a passing row (it was it.fails).
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
14. **Other packages' copies of the facts** (integrator, at the AG merge): AU's audio reads the T64 rated power from the powerplant and
    PN's ASI the red line from `AH56_REFERENCE.vne` (`definitionInconsistencies(ah56)` has no audio or ASI row on integ). The pilot's-eye
    row cleared at the AX merge (AX's visual reads `PILOT_EYE`, AG's geometry the same): `definitionInconsistencies(ah56)` is empty.
15. **The collective gauge range** (integrator, at the AG merge): the panel and HUD read AG's physical range −2.5…18.5° plus the
    configuration offset, so the AMCS gauge spans 4.5–25.5° indicated (mid lever 15°, ICS 8°). AMCS-73 SoF 2b gives 4.5–21.5° indicated
    for the AMCS ship (P, facts.ts `AH56_COLLECTIVE_DEG`); the physical top of 18.5° is the ICS's (P), shared by both configurations
    (AGENT, plan 7.1). PN's dev mock now sets its 11° hover / 13° cruise levers on the definition's range. Close with: a per-configuration
    collective top (the same definition seam as the collective floor in item 10).

## Handed over by other packages (integrator)

- **Controls (TW):** the pusher grip moves at 0.25 of travel per second when held; the re-centring keyboard cyclic returns at the
  Numpad 5 rate (4/s). Both are AGENT choices. The prop-schedule assist has no menu toggle yet.
- **Sound (AU):** ENGINE FIRE is declared but never sounds (no state reports a fire). The FLAWS voice uses the browser's speech synthesis,
  shared with the Flight School instructor, silent where it does not exist. Many levels and orders are ESTIMATE (T64 Ng 100 % =
  18,000 rpm, mesh order 330, impulsive-noise onset at advancing-tip Mach 0.82, the pusher's 15 kN cruise thrust, the hum and half-P
  levels, gear motor 240 Hz, the FLAWS words). The cabin-level margins are tight (hover −16.4 dBFS against a −17 floor; 190 KTAS peaks
  −2.2 against −2); the half-P thump peaks at −0.5 dBFS. tests/audio/ah56.test.ts's S0-stub rows (skids, no gear voice) were converted to
  the wheels at the AG merge.
- **Panel (PN, [ah56-panel.md](../../../docs/ah56-panel.md) "Compromises"):** the rear-seat panel is an UNVERIFIED reconstruction; ASI
  marks are ESTIMATE (Vne 195 KCAS INF); no hydraulic model (3000 psi while the rotor turns); the ICS buttons are not switches; APU,
  abort-stop, rotor brake, directional trim and Nf ALTERNATE are not drawn; MASTER CAUTION does not latch; the AMCS Nf band (95–105
  green) is ESTIMATE; the tail wheel uses gear lamp 1 (lettered TAIL).
- **Exterior (AX, [ah56-exterior.md](../../../docs/ah56-exterior.md)):** head hardware, gyro post height, gear legs, sponsons, intakes,
  exhaust and the 32° fin sweep are photographic ESTIMATES (no dimensioned three-view found). The wing incidence is drawn to the
  waterline (published datum unstated). No gear doors are drawn (none found on the mains; the fin housing is open). Until the solver
  publishes a hingeless blade pose the head droops its blades by its own −0.9° fallback (ESTIMATE). The hub hardware stays solid at rotor
  speed; only the ICS gyro X fades. Shared renderer: the tail rotor's blur disc reads heavy (solidity alpha near the 0.25 cap) and the
  main disc faint in chase views. Integrator, at the AX merge: the main-gear trunnion moved from FS 281 to FS 264 with AG's axles (FS 285
  → 268), and the head draws a non-finite gyro cyclic as zero (the gyro definition routes the dev page's tilt into the swashplate).

## Stages 3-4: the wing and the pusher (AC, handed over; [ah56-compound.md](../../../docs/ah56-compound.md) section 9)

Numbers as AC measured them on the stage-4 aircraft; the stage-5 section moved some (the stage-5 list below and
[ah56-integration.md](../../../docs/ah56-integration.md) have the integrated values).

- **C6 rotor lift share** 71 / 47 / 26 % at 120 / 160 / 190 KCAS on 13° indicated (ESTIMATE 40–60 / 20–35 / 10–25 %): AG's collective
  reading (13° AMCS indicated = 6° at 0.75 R) kept for the AMCS's own operation; the rotor-centre reading gave 54 / 30 / 11 % but broke
  AMCS-73's lift-off on 13° and the hover inside the travel. it.fails.
- **C9 / C26 the AMCS lateral trim**: 0.19 in left shift 125–190 KCAS (P about 0.5 in); symmetric-wing trim 0.69 in at 190 (D 0.8–1.5):
  the AMCS's lateral stick per kN m of hub moment is small (about 0.02 in), so the 12.5 kN m prop reaction is 0.26 in of stick.
- **C10** 0 → 165 KTAS in 61.9 s passes (P 53 s ± 20 %); 165 → 188 KTAS takes 20 s against P 54 s (too much thrust margin at high speed;
  the prop map's efficiency and the flat plate fitted to it).
- **C11** below about 150 KTAS full reverse decelerates at 0.15–0.2 g (P 0.31 g average); 196 KTAS to the hover not reached in 90 s.
  196 → 165 KTAS passes (5.9 s, P 5.4 s).
- **C16** reverse thrust on the ground yaws the nose about 2° LEFT (P right): the prop's slipstream reaches no surface. The rolling
  take-off lifts off on 15° indicated at 62 KIAS, not 13° (the rotor wants about 2° more collective than the aircraft, as in the
  18.8° indicated hover).
- **C17** ICS full stick 40 R / 34 L °/s at 122 KCAS and 43 R / 31 L at 152 against 77 R / 42–49 L (P): AG's ICS steady rates (G7 gaps)
  with the wing's roll damping.
- **C22** sizes: cyclic held at −6° gives 1.1° nose up and 4.9 kt rearward (ESTIMATE 2–4°, 10–15 kt); +10° re-trimmed 5.3° nose down
  (ESTIMATE 2–5°). **The plan's +4° row has the force balance backwards** (AGENT finding, for the owner): forward thrust held over a spot
  tilts the disc aft and the nose goes UP by about T/W (measured +2.7°, predicted 2.8°); the test asserts the physical sense.
- **C23** the ICS lateral trim shift hover → 100 KCAS is about 0.8 in RIGHT (P 1.1 in left); the AMCS shift 0.12–0.15 in (P 0.4–0.7 in).
- **The delta-beta sensor** is the model's (engine torque at the rotor below half the prop's, 1,600 N m arming floor, ESTIMATE); it
  ignores load factor, and a collective dump at speed that splits the needles can latch it. One reverse target (AMCS −8.5°).
- **The grip does not creep in the sim's controls**: a touch of the grip re-seats the blades on it (C25 passes on the pusher alone).
- **Prop efficiency** 0.753 at J 1.15 / C_P 0.34 against about 0.80 (ESTIMATE, Hamilton Standard charts): the BEMT's induced, swirl and
  tip-loss terms plus wave drag at tip Mach 0.84 (`src/physics/propulsion/**`). The fuselage flat plate (1.0 m², 1.53 m² with stores at
  194 KTAS) stands for what this prop map can push, not a physical estimate; at 0.80 it would be about 1.2 m².
- **Stores drag on by default** (4 XM159 pods, P ΔFe 2 → 6 ft²; AGENT): clean AMCS reaches 213 KTAS, with stores about 199.
- **The AMCS gyro pair lives in compound.ts** (`AH56_COMPOUND_GYRO`: K_R and the longitudinal stick moment override gyro.ts's 7,500 /
  811 N m; AC's refit, then AH's). gyro.ts keeps the stage-2 fit for reference.
- **ICS hands-off hover** pitches up on the compound (AC: +17.6° in 20 s calm, headless; in the sim with the 8 kt default wind +29°,
  22 kt). On the integrated tree (air data wired) the ah56Ground readout reads ICS −5.3 → −3.4° roll, +8.8° pitch, 5.2 kt; AMCS −5.4 →
  −6.4° roll, +2.3° pitch, 3.3 kt after 20 s (calm).
- **Resolved at the AC merge (integrator):** an ICS reset trimmed on the AMCS's blade-angle schedule (4.84° indicated at 160 KCAS);
  `flightModel.ts` now passes `ic.rotorcraftConfig` to `pusherTrimLever` (AC's request). The default definition in ICS trims 5.97 /
  5.95 / 5.98° at 120 / 140 / 160 KCAS (P 5–7°); the C7 it.fails row is a passing row.
