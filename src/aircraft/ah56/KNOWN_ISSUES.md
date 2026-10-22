# Lockheed AH-56A Cheyenne: known issues

Owner: AG (stage-2 flight model package). Ordered by pilot impact, with the test that shows each. Other packages hand their entries over
in PR text; the integrator adds them. Stage 2 is the pure helicopter: the wing and the pusher (stages 3-4) and the high-advance-ratio
aerodynamics with the half-P hop (stage 5) are not in this build, so neither is anything that depends on them.

1. **Resolved at the AG merge (integrator): the gyro's speed-scheduled augmentation is live in the sim.** `Rotorcraft.compute` now
   passes `{ hub: hubAir, density }` to `ControlGyro.advanceCoupled` (AG's request, work/rigid/ag-integrator-requests.patch, applied in
   the merge commit). The rig's stand-in retired itself (PRODUCTION_AIR_WIRED); the AG list on the merged tree: 73 passed, 10 expected
   fail, 0 failed. Kept here so the numbers in item 8 and docs/control-gyro-model.md section 5 read in context.
2. **Resolved in the final fix round (the in-plane force is a vector; section "Final fix round" below). Was: the hands-off hover drifts away from the spawn.** From the 15 m hover spawn (18,300 lb, the test loading) in calm air the AMCS rolls
   from 5.1° to 1.3° left in 20 s with the nose 6.4° down and 11 kt of drift; the ICS from 5.0° to 1.4° left, nose 10.3° up, 7 kt. The trim
   balances the rotor at exactly zero airspeed, where `Rotorcraft.compute` applies no main-rotor in-plane force; the first step's 1e-7 m/s
   switches on the hingeless rotor's hover in-plane force (about 330 N) along an arbitrary direction, a 625 N m rolling moment the trim
   never saw, and the AMCS turns a steady moment into a steady rate (about 0.26 °/s per kN m: it nulls the hub moment, not the attitude
   error; ah56Handling.test.ts "G6 variant"). Contract request to RC: work/rigid/ag-rc-inplane-fade.patch fades the force in over the
   first 0.3 m/s (legacy digests unchanged); with it AMCS −5.1 → −6.2° and ICS −5.0 → −7.2° (0.2° past the G9 band), 3.1 kt each, in 20 s.
   Evidence: ah56Ground.test.ts "hover readout" (it.fails), docs/ah56-flight-model.md section 6.
   **Integrated stage-5 aircraft** (integrator): AMCS −5.4 → −1.9° roll, +10.7° pitch, 14.3 kt; ICS −5.3 → −10.5°, −2.4°, 6.6 kt in
   20 s calm. The fade, gated on the control gyro and measured on the integrated tree: AMCS −5.4 → −5.4°, +2.2°, 2.1 kt; ICS −5.3 →
   −8.0°, +3.1°, 4.1 kt; but it also moves the hover step responses the gyro is fitted on (G7 ICS roll τ63 0.28 → 0.31 s, AMCS hover
   roll sensitivity 63.5 → 69.6 °/s²/in), so it was NOT applied: a rotor-physics choice for RC (carry the in-plane side component) or
   the owner (docs/ah56-integration.md section 3 item 7).
   **In the sim after the final fix round** (`index.html?aircraft=ah56&hover=1&cam=chase&resume=0&run=20`, 20 s hands off;
   W/shots/final/ah56-*hover*.png): calm (`&wind=0,0`, 1 kt residual) AMCS −5.5° roll, −2.3° pitch, 3.1 kt; ICS −5.3°, +3.8°,
   3.5 kt; in the default 8 kt wind AMCS −1.6°, −3.5°, 10.8 kt over the ground (drifting with the wind), ICS −11.5°, +1.9°,
   13.2 kt; Nr 239.8 / 246.0 rpm, nothing crashes. The sim's calm hover holds the G9 band; with the wind it drifts with it.
   **Superseded, at gate 0** (AH-56 verifier gate 0, `index.html?aircraft=ah56&hover=1&run=20`, 20 s hands off): in the default 8 kt
   wind the AMCS ends at 0.8° RIGHT roll, −2.2° pitch, 7 kt (headless with the same wind +1.3°, −2.3°, 6.8 kt: the two
   agree); the ICS at 4.9° left, +9.4° pitch, 10 kt. In calm air (`&wind=0,0`) the AMCS ends at 1.4° left, −7.3° pitch,
   12 kt with the heading 80° left of the spawn, and the ICS at 6.9° RIGHT, −1.1°, 17 kt. The calm runs leave in
   different directions from the headless ones (AMCS pitch −7.3° in the sim, +10.7° headless) because the force switches
   on along whatever the first tiny velocity is; headless is deterministic and independent of the step split. Nr holds
   (239.86 / 246.04 rpm), the gyro stays inside its stops and nothing crashes. The hands-off heading wander (40-80° in
   20 s in calm air) has no plan row.
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
   **Unlocked taxi ground-loops** (pilot-review round, 2026-10-22; "Pilot review round" below, item R1): with the tail wheel
   unlocked the prop taxi is directionally divergent from about 5-10 kt hands off, and a 1 in pedal pulse at 20 kt tips the
   aircraft onto the right wingtip in about 4 s; locked, the same pulse gives under 5 °/s. **Full pedal while rolling** at
   5-10 kt with the tail wheel unlocked and no brakes spins the aircraft at 140-160 °/s and collapses the left main gear (140 kN
   limit) within 10 s (not a G13 row, which is at ground idle).
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
  abort-stop, rotor brake, directional trim, Nf ALTERNATE and the hydraulic 1 / 1A / 2 switches are drawn inert (static, no
  hotspot, not modelled; the UNVERIFIED notice is in the "Rear panel" hint, not on the face); MASTER CAUTION does not latch; the AMCS Nf band (95–105
  green) is ESTIMATE; the tail wheel uses gear lamp 1 (lettered TAIL).
- **Exterior (AX, [ah56-exterior.md](../../../docs/ah56-exterior.md)):** head hardware, gyro post height, gear legs, sponsons, intakes,
  exhaust and the 32° fin sweep are photographic ESTIMATES (no dimensioned three-view found). The wing incidence is drawn to the
  waterline (published datum unstated). No gear doors are drawn (none found on the mains; the fin housing is open). Until the solver
  publishes a hingeless blade pose the head droops its blades by its own −0.9° fallback (ESTIMATE). The hub hardware stays solid at rotor
  speed; only the ICS gyro X fades. Shared renderer: the main disc reads faint in chase views. The tail rotor's blur disc (solidity alpha on
  the shared 0.25 cap) is halved for this type by `rotorcraftVisual.tail.blurAlpha` 0.5 (gate-1; legacy types default 1); the pusher's own
  uniform disc peaks at 0.18 opacity (was 0.35, which covered the tail cone in the hover chase view).
  The gear-up sponson strike points in gear.ts sit at WL 52 while the drawn sponson bottom is WL 60 (gate-1 shelf; was
  57.5): a gear-up landing registers the sponson strike about 8 in before the drawn skin touches (physics unchanged). Integrator, at the AX merge: the main-gear trunnion moved from FS 281 to FS 264 with AG's axles (FS 285
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
- **Resolved (final fix round): the AMCS gyro pair lives in gyro.ts.** K_R 3,200 N m/rad and the longitudinal stick moment 566 N m
  (AC's refit, then AH's) used to override gyro.ts's stage-2 7,500 / 811 N m from compound.ts (`AH56_COMPOUND_GYRO`); they are now
  gyro.ts's own numbers with the compound named as the fitting condition (docs/control-gyro-model.md section 6). The flown aircraft is
  unchanged; the no-compound rig (G10) now flies them too.
- **ICS hands-off hover** pitches up on the compound (AC: +17.6° in 20 s calm, headless; in the sim with the 8 kt default wind +29°,
  22 kt). On the integrated tree (air data wired) the ah56Ground readout reads ICS −5.3 → −3.4° roll, +8.8° pitch, 5.2 kt; AMCS −5.4 →
  −6.4° roll, +2.3° pitch, 3.3 kt after 20 s (calm).
- **Resolved at the AC merge (integrator):** an ICS reset trimmed on the AMCS's blade-angle schedule (4.84° indicated at 160 KCAS);
  `flightModel.ts` now passes `ic.rotorcraftConfig` to `pusherTrimLever` (AC's request). The default definition in ICS trims 5.97 /
  5.95 / 5.98° at 120 / 140 / 160 KCAS (P 5–7°); the C7 it.fails row is a passing row.

## Stage 5: high advance ratio, moment stall, half-P hop (AH, handed over; [ah56-high-speed.md](../../../docs/ah56-high-speed.md) section 8.2)

- **H3 profile-power rise** at 200 KTAS: the rotor's profile power rises 9.9 % with the Mach terms (629 against 573 shp), but total power
  required falls 1.6 % (torque 114.9 against 116.9 %), against ≥ 10 % (D, the plan's row rested on the M_dd 0.78 ESTIMATE). The tip's
  drag divergence is M 0.83 (P Ferri), so the 200 KTAS tip (M 0.89) is only 0.06 past it, and the prop carries most of the power. it.fails.
- **H5 ICS manoeuvre stability**: stick per g above 1.3 g at 122 KCAS is 6.9 in/g (6.6 without stall) against neutral, ≤ 0.1 in/g (P):
  the airframe pitch stiffness and the gyro's steady stick moment (AG/AC); the moment stall reverses the gradient only past its onset.
- **H9 periodic flap damping** changes the hub moment per cyclic by +2.2 % at μ 0.5 against 8–15 % (D); RC's R23 found the same cause
  (the damping is 1/rev and reaches the harmonics only through the cone and the reverse-flow region).
- **H4 moment-stall onsets** sit 0.10–0.15 g above ASTA-72's (1.65 g at 154 KCAS, 1.5 g at 122 KCAS, against 1.5 ± 0.2 and 1.4 ± 0.2;
  pass). The flown moment break is a FITTED ESTIMATE of dynamic stall; no primary dynamic-stall data for this section were found. In the
  first seconds the roll is about twice the pitch-up (ASTA-72: the pitch-up was the loss of control). Past the onset, with the scripted
  pilot still asking for g, the pitch-up runs away to 2.1–2.4 g with 17–27 °/s of right roll (for the owner: too violent?).
- **H6 AMCS steady turns**: full aft stick holds 2.28 g at 155 KCAS and 2.45 g at 180 KCAS (4.3–5.1 in/g; AMCS-73 para 37: to 2.5 g);
  the rate-command calibration fits the first peak, not the steady state (AG).
- **The AMCS refit margins are thin** (AH's handover, applied at the AH merge: K_R 3,200 N m/rad and the longitudinal stick moment
  566 N m in compound.ts; the lateral stick moment 907 N m and the input rotation 5° in gyro.ts): hover pitch sensitivity, 150 KCAS roll
  sensitivity, C18 pitch at 180 KCAS and C9 at 190 KCAS each within 0.4–1.9 % of a band edge. A refit with margin needs AG's model of the
  sensitivity per unit response (1.9 /s against AMCS-73's 1.5 /s).
- **The ICS longitudinal trim moved forward** with the section: 1.0 / 1.2 / 5.0 in at 122 / 154 / 190 KCAS (20,000 lb, 4,600 ft),
  against 0.5 / 0.5 / 3.7 in at stage 4 (Prandtl-Glauert 0.8 in and the tuck 0.3 in of it at 190 KCAS); 190 KCAS sits 0.5 in from the
  5.5 in forward stop. AC reported the stage-2 ICS needing 5.37 of 5.5 in at 150 KCAS and saturating at 170 (unlisted until now).
- **C12 autorotation** (19,700 lb, 2,700 ft DA, 95 KCAS, prop +8°): 2,508 ft/min against 2,200 ± 300 (P ASTA-72 para 69), 8 ft/min
  outside; stage 4 read 2,492. One candidate: the section's post-stall drag reads 0.156 / 0.221 / 0.302 against Report 530's 0.127 /
  0.195 / 0.275 (+23 / +13 / +10 %) with the disc root stalled. Owner options (AGENT, not decided): fit the post-stall drag (AH), re-fit
  the autorotation drag (AC), or keep the KNOWN GAP row (it.fails at the AH merge).
- **Rows moved by the stage-5 section, re-tested on a section without stall** (AH's handover proposals for AG's tests, applied by the
  integrator): G3 auto-trim reads 2.4 % at 0.5 s without stall, 25–28 % on the stalling section (AG's level fixed shaft at 10.5° and
  100 KTAS stalls the front of the disc); G5a full aft AMCS stick reaches the gyro stop on the stalling section (flap 8.1°).
- **The half-droop stability row** decays to 0.125° 6 s after the kick (bound 0.1°; it.fails, the bound kept): Prandtl-Glauert slows
  the decay.
- **The half-P hop is a scripted event** (owner note O1): trigger thresholds (0.75 in stirs, 0.5 in doublets, 7.5° collective, 0.5 in/s
  "still"), growth 1.216 / decay 0.82 per forcing cycle, 1 s onset fade, roll moment 100 kN m per unit (94 kN m D × 1.06 FITTED), plunge
  12.2 kN (D) are ESTIMATES. The amplitude HOLDS while the stick moves without stirring (AGENT reading; the alternative "decays whenever
  the stirring stops" is one line in halfPHop.ts, for the owner). The sound clamps the thump at amplitude 2 (AU's mapping) while the
  event grows to 3.33 at the strike.
- **The section**: one for the whole span with the tip's Mach terms; Cl max against Mach and the flown moment break (0.2 c within 4°,
  faded between M 0.45 and 0.6) are ESTIMATES fitted to H4. Not modelled: lift divergence past M_dd, reversed-flow camber and Mach
  effects, dynamic-stall lift overshoot and hysteresis, the buffet before moment stall.
- **Cost**: 1.9 × the MD 500E per step on the 12 × 18 grid (H10 ≤ 2 ×); the plan's ≥ 36 × 16 grid would be 3.7–4.0 × (above μ 0.3
  only needs RC's rotorcraft.ts to choose the grid by advance ratio).
- **The 1-g retreating-tip stall margin** is about 0.4° at 122 KCAS / 20,000 lb / 4,600 ft (1.7° on the fine map), consistent with
  ASTA-72 para 88. Heavier or higher 1-g trims were not checked.

## Integration dispositions (integrator, at the AH merge; [ah56-integration.md](../../../docs/ah56-integration.md))

- **G7a ICS full lateral stick** (ah56Handling, it.fails KNOWN GAP): 39.7 R / 35.2 L °/s, ratio 1.13, at 120 KCAS on the integrated
  aircraft (band 40–65, ratio 1.5–1.9; stage 2 read 50.0 / 31.1). The wing's roll damping and the compound's ICS lateral trim; no ICS
  refit (G4 pins the stick moments). C17 is the compound's P row.
- **G8 ICS off-axis** (it.fails KNOWN GAP at the 0.3 bound): p/q +0.28 at the hover, −0.33 at 100 KCAS (stage 2: +0.24 / −0.14).
- **G10** keeps its meaning: it flies the AH-56A without the compound patch (no wing, no pusher; the stage-5 rotor section in) and
  reads 11,410 ft (9,000–11,500, ESTIMATE). C2 (8,625–8,750 ft, P 8,500 ± 1,000) is the compound's row.
- **H3**'s trim bracket is 32–39° of prop blade angle (was 32–40°): with the gyro air data wired the Mach-off variant's 40° trim no
  longer converges. The numbers equal AH's (total −1.6 %, profile +9.8 %).
- **The hands-off hover readout** (ah56Ground, it.fails): AMCS −5.4 → −1.9° roll, +10.7° pitch, 14.3 kt; ICS −5.3 → −10.5° roll, −2.4°
  pitch, 6.6 kt after 20 s in calm air on the integrated stage-5 aircraft. On the stage-4 merge it held (AMCS −6.4°, ICS −3.4°).

## Pilot review round (2026-10-22: measured and routed on integ; [ah56-integration.md](../../../docs/ah56-integration.md) section 10)

Seven pilot-review items were measured with probes in `work/rigid/probes/tune-ah/` (outputs in `out/`). No flight-model number
changed: for each item the knob the review proposed either does not move the defect or has no source behind the value it would
need. Three test rows were added (ah56Ground: a passing locked-tail-wheel taxi row and an `it.fails` unlocked one; ah56Handling: an
`it.fails` ICS static-stability row). Every target below carries its tag; AGENT = not an owner decision.

- **R1. Unlocked taxi ground loop (must; AG).** P ASTA-72 para 79 and the SoF permit unlocked taxi to 20 kt and rate the ground taxi
  "excellent". The model (prop taxi on +3° after accelerating on +8°, the pedal settled on its trim): unlocked straight taxi at 10 kt
  with no input diverges, 0.4 → 6.8 → 39.8 °/s at 0.5 / 6 / 15 s; a 1 in left pulse for 1 s then the trim pedal leaves a steady
  18-32 °/s turn at 8-10 kt, peaks of 54-62 °/s with the aircraft slowing at 12-15 kt, and at 20 kt 53 °/s with the right wingtip on the
  ground at about 4 s (ah56Ground `it.fails` row). Locked: the same pulse gives at most 2.4 / 4.6 / 6.4 °/s and 1.5 / 3.5 / 4.6° of heading at
  10 / 20 / 30 kt (passing row). A pilot answering within 0.3 s (or 0.6 s at full gain) with up to 2.0-2.7 in of opposite pedal
  catches the 20 kt pulse; at 1.0 s it is lost. Mechanism (D): the mains sit 30 in ahead of the CG (P CG FS 298, 3V axles FS 268), so a turn's
  centripetal force at the mains turns the nose further (m a V = 68 kN m s at 20 kt), while at the straight-taxi trim the tail
  rotor carries only about 1 kN (drive reaction 18.1 kN m at 18.7 % torque, less the pusher's 5.2 and the tail wheel's 2.1), where
  its yaw damping is about 12-16 kN m s (momentum theory and the measured 0.47 kN at 20 °/s; 17.5 in the hover, R5).
  Sweeps (none applied): main-tyre cornering stiffness 4 / 12 per rad and relaxation 1.0 m do not move it (20 kt still tips at
  4 s); a castor damper of 300-3000 N m s/rad or swivel friction of 60-300 N m slows or holds small disturbances but gives
  stick-slip: the straight-taxi pedal trim wanders 0.05-1.8 in and walking-pace turns stall (3000 N m s/rad: 1 in at 5 kt turns at
  0.2-1.2 °/s) or reverse. The geometry is P/3V and the tail rotor P, so no ESTIMATE knob is left; owner / AG choice. **Handover
  to PN:** a HUD / instructor cue "tail wheel: LOCK for straight taxi, take-off and landing; unlock only to turn" (P para 79
  practice; the SoF's 20 kt unlocked limit is above the model's onset).
- **R2. Reverse-thrust deceleration (must; AC).** C11 196 → 165 KTAS passes (5.9 s, P 5.4 s ± 20 %). Flown the P way (para 15:
  collective held at the trim value, cyclic holding height, β to −12° in 4 s, gear at 120 KCAS), 19,200 lb, 1,500 ft: 165 / 120 /
  80 / 50 / 20 KTAS at 5.9 / 15.7 / 27.3 / 35.1 / 50.4 s (AMCS) and 5.0 / 17.4 / 27.2 / 33.6 / 40.5 s (ICS), against P's uniform
  0.31 g (196 → 0 in 33 s; 50 KTAS at about 24 s). The deficit is the 165-80 KTAS band: 0.20 g against 0.31 g, where the −12° prop
  gives 8.2-11.2 kN (80-120 KTAS) and the rotor carries the weight at a near-level attitude (+0.2 to +6° of pitch), so holding height
  with the cyclic never flares it. The pusher map at −12° (1,674 rpm, 1,500 ft): −6.7 kN / 1,212 shp static, −7.4 / 1,262 at 40 KTAS,
  −9.0 / 1,078 at 100, −20.8 / 2,576 at 196. Section sweeps (none applied): clMin −1.2 adds 1.5-3.4 kN at 20-120 KTAS and reaches
  50 KTAS 3.5 s sooner, but −0.8 is already generous for a thin cambered section in reversed flow and −1.2 changes the β +8° windmilling
  drag at 160-196 KTAS (−14.8 → −16.6 kN, −16.6 → −22.5 kN; C13 / C20); cdMax 2.0 adds under 0.5 kN below 100 KTAS (Viterna gives about
  1.2 for this blade's aspect ratio, so 1.6 is already above it); a lower helix twist (P/D 0.8-1.0) cuts the static −12° power 15-23 %
  without more thrust. Flown at 50 ft the scripted pilot cannot hold height; the 165-50 KTAS deficit is the same. The reviewer's
  "stuck at 23-35 kt" was the probe's flare law (it commanded −2.5 to −1.9° of pitch there) with the reverse prop absorbing
  1,270 shp (37 % torque) against the rotor's near-hover power. Owner-visible cause: the C6 lift share (rotor 71 % at 120 KCAS
  against the ESTIMATE 40-60 %); a wing-heavier aircraft has to flare to move lift back to the rotor.
- **R3. ICS longitudinal trim and static stability (must; AC, AG). Partly resolved in the final fix round (below): the 190 KCAS trim exists; the gradient is 0.07 in/kt.** At ASTA-72 para 44's conditions (P: ICS, aft CG FS 299.8, stores,
  4,000 ft; 18,300 lb) with the collective and the blade angle held at the trim settings: the trim stick is 2.89 / 4.80 in forward at
  120 / 150 KCAS and the gradient about trim 0.10 in/kt at both (P para 45: 0.015 / 0.012 in/kt), and no level trim exists at 190 KCAS
  (the 5.5 in stop; P used a 190 KCAS trim point, and para 37-38 trimmed to 186 KCAS with "only small" changes above 170). ah56Handling
  `it.fails` row. (The review's 0.07 in/kt was the schedule gradient, stick across trims with the collective and prop rescheduled,
  not the P measurement; AH's 1.0 / 1.2 / 5.0 in at 122 / 154 / 190 KCAS were fixed-collective 7 / 5 / 5° trims, a third kind.)
  Decomposition of the steady gyro balance (SL 18,300 lb, ICS schedule, 100 / 120 / 140 / 160 KCAS; the stick that alone cancels each
  term): sweep × hub moment +0.11 / −0.73 / −1.70 / −2.97 in; blade Cm −0.55 / −0.67 / −0.85 / −1.06 (its own gradient 0.0085 in/kt is
  P-sized); droop × in-plane −0.90 / −0.70 / −0.50 / −0.33; spring +0.24 … −0.01; the desensitizer piston a fixed −0.76 once saturated.
  The hub moment the rotor must make, +0.2 / −4.5 / −10.1 / −17.6 kN m, is the airframe's: at 160 KCAS the wing's downwash on the
  stabiliser gives +30.5 kN m nose up (TAIL_DOWNWASH, ESTIMATE 0.139 per unit wing Cl; DATCOM gives about 0.118), the stabiliser's own
  load +6.1, the wing −16.8, the pusher −0.8. G4 (D from P) reads it at 5.39 kN m per inch. Without the downwash on the tail the para
  44 trims are 0.31 / 0.37 in forward and the gradients 0.037 / 0.076 in/kt. Also missing: the wing section's pitching moment
  (`WingPanelDef` has none); thin-airfoil theory ties the −2° zero-lift ESTIMATE to Cm ≈ −0.05 (D), about −8.7 kN m at 160 KCAS SL.
  A refit of the wing / tail balance against this P row moves C6, C8, C9, C23, H4 / H5 and the AMCS schedule: AC (TAIL_DOWNWASH, a wing
  Cm in wings.ts and compound.ts) and AG (stabiliser lift slope and wash in base.ts, then the ICS fit), not applied here.
- **R4. Resolved in the final fix round (the in-plane force is a vector). Was: hands-off hover wander (should; RC / owner).** Unchanged (the reviewer's hover.log numbers stand): the zero-airspeed in-plane
  force of item 2; the fade patch stays unapplied (integration section 3 item 7).
- **R5. Hover pedal power and the yaw after release (should; AG / RC).** AMCS, 30 ft: 1 in of right pedal gives 16.5 / 36.5 °/s at
  0.5 / 1.5 s (tail rotor 8.02 → 4.78 kN); after release 27 / 21.5 / 16.4 / 16.9 / 28.3 °/s at +0.5 / 1 / 2 / 4 / 6 s with the
  aircraft sliding right 0.1 / 0.9 / 3.1 / 9.0 / 17.2 kt. The damping is as momentum theory gives it: the tail rotor adds 0.21 kN per
  m/s of tail side velocity (D: 0.185 at 8 kN, −(σa/8) / (1 + σa/16λ)), so N_r ≈ 17.5 kN m s from the tail rotor plus 7 from the drive
  reaction, τ ≈ 2 s and about 53 °/s per inch steady. The persistence is the control system: a body-axis yaw with the 5° left-roll
  trim turns into pitch at r sin φ (+0.8 → +7.5° nose up), the rotor's thrust tilt keeps its direction in space while the tail rotor's
  thrust turns with the body, so the aircraft slides, and the tail rotor weathercocks into the slide (7.65 kN at +4 s, below the
  8.02 kN trim, with the yaw to the right). A pilot holds position with the cyclic in a pedal turn. Full pedal's 163 °/s at 3 s with
  0.3-1.3 kN of tail-rotor thrust is the tail rotor at its −7.4° stop moving 15-26 m/s against its thrust
  (the windmill-brake state; momentum theory gives about 2 kN at 26 m/s, D): RC's tail-rotor inflow model. Not changed.
- **R6. ICS autorotation below 2° of collective (should; AG, AC).** 95 KCAS, 19,700 lb, 2,700 ft, β +8°, engine off, collective 0.5°,
  the rig pilot: the aft stick 0.43 / 2.11 / 3.25 in at 2 / 4 / 6 s is the sweep × hub term (hub +8.3 / +16.0 / +22.0 kN m nose up,
  the airframe's moment in the descent); at 8 s the gyro is on its 15° aft stop, the blade pitching moments jump to about 2,200 N m
  (moment stall) and Nr falls 96.7 → 80.7 → 72.2 % at 8 / 10 / 12 s. At 2° the same pilot holds 2.1-2.2 in aft with the hub at
  +17-21 kN m and Nr 96-97 %. Same root as R3. **Handover to PN:** the ICS training text should give 1.5-2° for the autorotation
  (the 2° trim holds Nr 95-97 %).
- **R7. Nr decay after an engine failure at 63 KCAS (should; AC / AH).** AMCS, 19,700 lb, 2,700 ft: the trim takes 46.1 % torque
  (main rotor 1,077 shp, tail rotor 70, prop 369 shp at its 13.3° schedule angle). Trimmed with the prop at +8° or +10° the total is
  47.3 / 46.5 % (the rotor takes over the prop's share) and the Nr minimum with a 2 s delay is 77.0 / 77.4 % against 77.6 % on the
  schedule: the decay is set by the total power at 63 KCAS and the P drivetrain inertia, not by the prop's share (P ASTA-72 para 68:
  about 82 %). The schedule at 60 KTAS is the AGENT "2-3° nose up" fit. Autorotation collective: 4.5° indicated overspeeds Nr to
  117-119 % within 12 s of a 63 KCAS entry, 7° holds 107 %; the 95 KCAS autorotation trims 100 % at 7.8° indicated (SoF 4.5-7°) — the
  C12 item (post-stall drag, +10-23 % against Report 530).

## Final fix round (2026-10-22, after the final assessment; AGENT choices, not owner decisions)

Commits on `feat/rigid-rotor` after `9d70cad`; numbers from `W/guards/integ/14-fix` (rotor fixes) and `15-p1` / `16-final`
(the wing balance), 18,300 lb SL ISA stores unless stated. The integration record section 11 has the before/after table.

- **Fixed: the hingeless in-plane force is a vector** (`rotor.ts`, `rotorcraft.ts inPlaneForce`). Hands-off hover 20 s calm:
  AMCS −5.35 → −5.49° roll, +0.76° pitch, 0.41 kt; ICS −5.25 → −5.13°, +0.53°, 0.31 kt (was 14.3 / 6.6 kt). The side component
  also acts in forward flight: the ICS lateral trim at 122 / 152 KCAS moved 0.18 / 0.13 in left → 0.06 right / 0.06 left (then
  0.36 / 0.50 in right with the wing balance below; P ASTA-72 para 38: 1 in left at 100 KCAS). **New KNOWN GAP rows:** C17 sense
  (full left stick now rolls faster: 37 R / 44 L °/s at 122 KCAS; P 77 R / 42 L) and the C23 frozen-controls roll through
  translation (+1.41 → −1.61 °/s, P right). The C23 ICS lateral shift had the wrong sign before any of this (0.89 in right against
  P 1.1 in left); it is now 1.31 in right.
- **Fixed: the pusher's gyroscopic reaction acts on the airframe** (`rotorcraft.ts`; its h joins angularMomentum after the free
  rotor's w x H compensation): about 1 kN m of pitch-to-yaw coupling at 0.3 rad/s. Plan seam amended (plan section 15 A6).
- **Fixed: trims and ground settles use the atmosphere's speed of sound** (`settle(..., soundSpeed)`). At 9,000 ft 180 KTAS the old
  trim started flight 0.065 m/s² and 0.008 rad/s² off balance (about 540 N).
- **Fixed: the ICS gyro's blade moments see the blade's flap rate** (`articulated.ts hubForcing`). Half the derived droop now decays
  to 0.009° in 6 s (was 0.125°, a KNOWN GAP row, now passing); G3 full-ICS gust residue 0.53 → 0.45 of the locked moment; G7 ICS
  pitch τ63 0.79 → 0.65 s (band 1.5-3.5), roll τ63 0.28 → 0.26 s (0.3-0.7); G8 ICS p/q hover 0.28 → 0.41. **For the owner: the
  moment stall is now a departure.** The H4 onsets still pass (1.3 g at 122 KCAS, 1.4 g at 154; P 1.4 / 1.5 ± 0.2), but held
  at 1.4 g at 122 KCAS the turn rolls 134° right against the no-stall flight (0.7° before) and reaches 1.84 g; at 1.5 g / 154 KCAS
  29° (1.1° before). H5's "stick per g" is then a departure, not a gradient (−18 in/g). The section's moment break is a FITTED
  ESTIMATE made without the flap-rate incidence. Options: keep (physically the more complete incidence), refit the moment-stall
  break (AH), or revert this one term and document its omission as an approximation (the final review's alternative).
- **Fixed: a save during a half-P hop keeps its forcing** (`HalfPHopState.age`; resume.ts validates it).
- **Partly fixed: R3, the ICS pitch trim.** The wing has a section pitching moment (cm0 −0.055, D) and the downwash at the tail is
  DATCOM's 0.119 per unit C_L (D; was the ESTIMATE 0.139). At para 44 (FS 299.8, stores, 4,000 ft): trims 1.74 / 3.04 / 4.50 in
  forward at 120 / 150 / 190 KCAS (the 190 KCAS trim now exists inside the 5.5 in stop); gradient about trim 0.073 / 0.071 in/kt
  against P 0.015 / 0.012 (was 0.106 / 0.098): KNOWN GAP row and the "ICS pitch trim" hint (ui.ts hints). The downwash grid with the
  Cm (scale 1 / 0.85 / 0.5 / 0.25 / 0 of 0.139) gives 0.084/0.079, 0.073/0.071, 0.049/0.093, 0.032/0.064, 0.017/0.031 in/kt: no
  physical value reaches para 45. Costs: **C23 ICS longitudinal shift hover → 100 KCAS 0.69 → −0.03 in forward (P 0.7 ± 0.3)**,
  of which the Cm takes 0.52 in and the downwash 0.20 (KNOWN GAP row: para 44-45 and para 25 pull the same knobs opposite ways);
  **H4 at 190 KCAS / 1.43 g: 0.27 → 0.69° of right roll** against the row's 0.5° reading of "none" (KNOWN GAP row). Gains: the ICS
  configuration itself now trims at V_H (C4 flies it: 201.1 KTAS at 114 %, 4.7-5.0 in forward; was flown on the AMCS gyro's
  mechanics), C5 clean 212.7 → 216.7 KTAS, C9 at 190 KCAS 0.48 → 0.34 in, C18 at 180 KCAS 4.23 → 4.32 °/s/in.
- **New KNOWN GAP: AMCS hands-fixed symmetric pull rolls left.** Full aft stick from 155 / 180 KCAS with the lateral stick, pedals,
  collective and prop at trim: −14.0 / −14.4° of roll in 3 s at 2.56 / 2.79 g (ESTIMATE bound 5°; P AMCS-73 para 37: "no
  uncommanded aircraft motions", "negligible lateral control position change with load factor"). With the wing incidences equalised
  −14.7 / −15.0°: the wing asymmetry is not the cause; the remainder is the rotor's pitch-rate-to-roll coupling, which the AMCS's
  flapping feedback (it nulls hub moment, not attitude) leaves to the pilot during the pitch-up. In the steady wind-up turns the
  lateral stick hardly moves with load factor (−0.03 / +0.02 in/g from 1.5 to 2 g at 155 / 180 KCAS), which is what para 37
  reports: the coupling is a transient of the pitch rate, not a roll due to lift.
- **C10 / C11 (prop map and flat plate) not refitted.** The fix asked for a Hamilton Standard efficiency datum at the V_H advance
  ratio and blade angle, or a measured static reverse thrust: neither is in the sources (searched ASTA-72, AMCS-73, APE-I, the
  Lockheed NTRS set). The prop efficiency stays the BEMT's 0.753 (ESTIMATE about 0.80) and the flat plate fitted to it; C10 (0 →
  188 KTAS 77.5 s, P 107 s ± 20 %) and C11 (hover not reached in 90 s; 165-80 KTAS at about 0.20 g, P 0.31 g) stay red. A P
  cross-check of the prop's low-blade-angle thrust exists but was not used: APE-I para 118 (ICS, 120 KCAS, collective 5°): prop
  16° → 9° dive, 12° → 12° dive at 2,400 ft/min, 8° → 16° dive at 3,500 ft/min.
- **Test rows made real:** G3 and G5a assert on the flown section at a collective where its stall takes no part (G3 0.26: clean
  auto-trim 2.9 % at 0.5 s; G5a 0.34: full aft 8.1° of gyro tilt inside the 10.1° stop); the G6 keyboard row holds the key until the
  stick reaches 0.5 in (1.18 s), the bank moves 2.6° and then holds within 0.43° for 10 s, and the plan's 0.3 s tap (0.05 in,
  0.1°) is a KNOWN GAP row; H10 asserts the plan's 2.0 x on the best of seven samples (1.82 x; the ICS 2.15 x at 160 KTAS,
  reported); the C4 row flies the ICS.
- **The AMCS gyro numbers live in gyro.ts** (above, "Resolved").


## Tuning round (2026-10-22, branch tune/ah56; AGENT choices, not owner decisions)

The eight open items of the pilot reviews and the final fix round, measured first with the probes in
`W/tune/ah56/probes/` (outputs in `out/`), then fixed at the source where a sourced or derived mechanism allowed it.

- **T1 (R1, must). Unlocked tail-wheel taxi: the divergence is the physics of a free castor; the P rating is pilot-in-the-loop.**
  Mechanism (D): with the main tyres much stiffer than the inertia terms the ground yaw mode is s = (m x U - N_r) / (Izz + m x^2),
  x = 0.76 m (mains ahead of the CG: P CG FS 298, 3V axles FS 268, re-checked on the Fort Campbell side photo), m x U = 31 / 63
  kN m s at 10 / 20 kt, N_r about 12.5 kN m s (the tail rotor at its 1 kN taxi trim, momentum theory in edgewise flow, D, and
  measured 0.47 kN at 20 deg/s): s = 0.34 / 0.9 per s (doubling 2 / 0.8 s); stable only below about 5 kt. The tyre ESTIMATES drop
  out of that limit (why the earlier cornering-stiffness sweeps did nothing). Swept and rejected (`out/ground2-*`, `ground3-*`,
  `ground4-*`, `relock*.log`): swivel friction 100-600 N m makes the castor a deadband with a breakout (the tyre's aligning moment
  saturates at mu N trail = 450 N m, so 150-300 N m is a third to two thirds of it: below 1-1.5 in of pedal no turn, above it 80-150
  deg/s), leaves path-dependent stuck angles (11-88 deg after a turn, so the lock pin cannot drop in) and turns both
  `tests/gear/ah56TailWheel` rows red from 100 N m; a swivel damper of 500-2000 N m s/rad lags the castor about 6 % at a 1 /s
  divergence while slowing walking-pace turns; trail 0.05 m changes nothing. gear.ts is unchanged. What P says (ASTA-72 para 79,
  APE-I para 133, read in the scans this round): "directional control during taxi was excellent", by tail-rotor thrust, the tail
  wheel unlocked "for all taxi turns", locked for take-off, landing and "high-speed taxi (above 20 knots)". New passing rows
  (ah56Ground): the 20 kt pulse with a pilot answering 0.3 s late holds the heading within 0.7 deg at 10 s on 2.2 in of pedal; at 10
  kt 0.5 s late within 1.8 deg on 2.4 in. Measured beyond the rows (`out/catch1.log`): at 20 kt 0.5 s late rings +/-15 deg but stays
  upright, 0.7 s and slower is lost; at 10 kt 1.0 s late spins it. The hands-off row stays `it.fails` (55.7 deg/s, right wingtip at
  about 4 s). Owner judgement (fixed-wing tail-dragger experience applies directly): accept the free-castor ground loop. The
  default LOCKED tail wheel (index.ts controlDefaults) keeps the beginner out of it; the HUD / instructor cue is PN's (contract
  request).
- **T3 (R3, must). ICS collective-fixed static stability: measured term by term; the wing / tail fit that reaches para 45 costs P
  rows beyond C23, so it is not flown (owner decision).** At ASTA-72 para 44's condition (aft CG FS 299.8, stores, 4,000 ft,
  18,300 lb, collective and blade angle held, path free) the stick gradient about trim is 0.0735 / 0.0708 in/kt at 120 / 150 KCAS
  (P para 45: 0.015 / 0.012). Per kt at 150 KCAS (`W/tune/ah56/probes stab44.test.ts`, `out/stab44-base.log`): the airframe's
  pitching moment grows +0.35 kN m nose up (stabiliser with the wing's downwash +0.49, of which the downwash term +0.31; the wing
  itself -0.30; the pusher +0.16, its falling thrust 0.5 m above the CG and its normal force 9.9 m aft), the hub must answer -0.35
  kN m, and the ICS reads it through the sweep feedback at 0.19 in per kN m (-0.067 in/kt); blade Cm -0.013, droop x in-plane
  +0.015 and spring -0.006 nearly cancel. The body angle of attack hardly changes (-0.02 deg/kt): the speed comes from the flight
  path, and the trim loads scale with q. The pitch desensitizer (P) is a gain on the stick while its 0.757 in piston is inside its
  authority, so below about 2.1 in of trim stick at 150 KCAS the stick gradient is the moment gradient / 0.64: smaller trims
  amplify it, which makes the 150 KCAS point non-monotonic in every airframe knob. Single-knob grid (`out/stab44-*.log`, 120 /
  150 KCAS): no downwash 0.017 / 0.031; downwash x 0.5 0.044 / 0.088; wing Cm -0.10 0.055 / 0.081, -0.15 0.035 / 0.067, 0 0.096 /
  0.089; stabiliser lift slope 2.5 0.050 / 0.081; rotor wash on the stabiliser 0, fuselage moment 0, blade Cm gain 0 change it by
  under 0.013. The pair wing Cm -0.10 with a quarter of DATCOM's downwash reaches 0.013 / 0.022 (the row's 0.024 bound) and the
  AMCS stays stable (0.009 / 0.011 against 0.018 / 0.021), but the suites on it (`W/tune/ah56/logs-item3-suites.txt`) show the
  price: the ICS trims go aft (0.6 / 1.4 / 3.4 in at 120 / 150 / 190 KCAS against 1.7 / 3.0 / 4.5 forward), so the 154 KCAS moment
  stall (H4, P 1.5 +/- 0.2 g) is no longer reached inside the aft stick (nMax 1.2 g; the stick per g is H5's 6 in/g), V_H 204.6
  KTAS (C4 band to 203.7; refittable by the flat plate), the AMCS pull-up from 180 KCAS peaks at 1.61 s on the full 4.95 in stop
  (C19, P 2.1 s +/- 20 %), and C9's high-speed left shift reverses (-0.02 in). The recommendation traded C23 only, so the flown
  values stay D (WING_CM0 = the thin-airfoil -0.055, TAIL_DOWNWASH_SCALE 1; both scaffolded in compound.ts so the fit is one
  line). Para 45 is not reachable with the wing / tail knobs without crossing H4; the decision is the owner's (contract request).
  The ah56Handling row stays `it.fails` at 0.071 in/kt.
