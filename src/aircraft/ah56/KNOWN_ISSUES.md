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
- **T4 (R4 / item 2, should). Hover heading and position wander: closed by the final fix round's vector in-plane force;
  re-measured.** The raw aircraft (STAB ASSIST off; T8 turns it on by default). Hands off 20 s from the trimmed hover in calm air: from the 15 m spawn (SimPhysics) AMCS -5.35 -> -5.49 deg of
  roll, 0.41 kt, 0.61 deg of heading; ICS -5.25 -> -5.13 deg, 0.31 kt, 0.63 deg (ah56Ground, a new regression row: heading under 5
  deg, drift under 2 kt); from the 10 ft IGE trim (`out/hover-r1.log`) AMCS 0.3 kt and -0.6 deg, ICS 0.3 kt and -0.6 deg (the
  reviews: 44 deg / 5.6 kt and 17.5 deg / 4.7 kt). The delayed pilot with the 8 kt side gust (same log): AMCS full gain holds at
  every delay (5.8 / 10.5 / 18 m at 0 / 0.3 / 0.5 s), half gain lost at 51 / 46 / 43 s (was 49 / 41 / 40); ICS full gain lost at 42 /
  35 / 38 s (was 36 / 34 / 30), half gain 34 / 32 / 30 s (was 25 / 24 / 23). The slow-pilot hover is item 8's (T8).
- **T5 (R5, should). Hover pedal: the damping is momentum theory; the keyboard gearing is the laptop lever (changed); the stop's
  windmill-brake thrust is RC's.** The tail rotor's yaw damping re-derived: dT/dw = rho A Omega R (sigma a / 8) / (1 + sigma a /
  (16 lambda_i)) with sigma 0.297 (P) gives 0.185 kN per m/s at the 8 kN hover thrust (D; the pilot-review round's formula is right),
  measured 0.21; N_r about 25 kN m s with the drive reaction, tau about 2 s, about 53 deg/s per inch steady. Neither report gives
  the AH-56A a yaw damper (AMCS: trim schedule and sideslip SAS; ICS: desensitizer, decoupler, roll compensator), so nothing is
  added to the physics. Full pedal 3 s (`out/hover-r1.log`): AMCS 163 deg/s right / 113 left, 90 deg in 1.45 / 1.76 s; ICS 156 /
  125 (APE 1.1's hover limit 45 deg/s is a pilot limit). Changed: the keyboard pedal ramp (input.ts, AGENT): 0.03 -> 0.2 of the axis
  per second over 1.5 s (was the MD 500E's 0.06 -> 0.35 over 1.2 s), so a 1 s key tap is 0.15 in (was 0.35 in) and a 2 s hold 0.7
  in (was 1.4): without the STAB ASSIST the 1 s tap peaks at 17 deg/s (43 before) and the 2 s hold at 60 (95); with it 5 and 23
  deg/s, the heading settling within 3-12 deg (`out/keypedal-*.log`; ah56Assist row). The keyboard pedal does not re-centre when the
  key is let go (the profile's pedal, as on the other helicopters), so without the assist a tap leaves a steady turn (the reviews'
  "persistence"); the assist's heading hold and pedal follow-up remove it. Not changed: the tail rotor at its -7.4 deg stop yawing
  15-26 m/s against its thrust (windmill-brake state) makes 0.3-1.3 kN where momentum theory gives about 2 kN (rotor.ts
  inflowTarget, shared: contract request to RC).
- **T8 (item 8, beginner). STAB ASSIST on the AH-56A through its own input profile, ON by default (a labelled sim aid).** The
  keyboard beginner of `tests/rotorcraft/bo105KeyPilot.ts` on the AMCS hover, 60 s: without it 27-30 m of drift (lost at 58-60 s in
  three of six runs) and the heading wandering 72-180 deg on the old pedal ramp (58 deg and 15 m on the new); with it 1.9-2.8 m,
  under 5.5 deg of attitude and 0.1 deg of heading at every tap rate and delay tried (`out/key-off.log`, `key-profile.log`;
  ah56Assist rows). The shared law and the Bo 105's gains, unchanged (src/sim/rotorcraft/stabilityAssist.ts is the Bo 105 lane's);
  Shift+A toggles it; the controls list and the HUD hints say it is a sim aid. Off on the wheels (taxi unchanged, T1), faded out
  between 30 and 50 KIAS (round 2, T9: retuned, faded out between 30 and 60). Not measured: the ICS with the assist (the key rig spawns the default AMCS); the assist's cyclic term on
  the ICS's slower, coupled gyro is the owner's to try (config=ics).
- **T6 (R6, should). ICS autorotation at 1 deg of collective or less: the gyro-to-stop and Nr collapse no longer occur; the aft
  stick margin is small.** Re-measured on this tree (the final fix round's flap-rate term in the gyro's blade moments, kept as the
  recommendation said) with the reviewer's own probe (`out/disc-r1.log`) and the decomposition probe (`out/icsauto-r1.log`), 95 KCAS,
  19,700 lb, 2,700 ft, prop +8 deg, engine off: full-gain pilot at 0.5 deg, aft stick 1.08 / 3.04 / 4.25 / 4.83 in at 2 / 4 / 6 / 8
  s, the gyro within 0.5 deg of centre, Nr 94.5 / 92.7 / 96.3 / 101.4 / 103.5 % at 2-10 s, 2,630 ft/min at 10 s (was: the gyro on
  its 15 deg stop at 8 s, moment stall, Nr 72 % at 12 s); at 2 deg 3.3 in aft and Nr 97.7 %. The half-gain pilot holds Nr 96 % but
  lets the speed run to 117 KIAS. Frozen at the entry trim it still rolls off left (43 deg at 4 s) and dives: the stick must hold
  the hub's nose-up 30 kN m (the airframe's nose-down moment in the descent flow, the same balance as T3). PN's ICS training text
  can keep the P 0.5 deg floor; 4.8 of the 5.5 in of aft stick is used at it.
  **The moment-stall break is refitted** (the recommendation: keep the flap-rate term, refit the FITTED break; highSpeed.ts, docs/
  ah56-high-speed.md section 9): the centre-of-pressure shift 0.4 c -> 0.2 c within 1.5 deg past the stall. Stabilising at 1.4 g /
  122 KCAS the stall now pitches up 0.22 g with 24 deg of right roll that the test pilot holds 0.19 in inside the stick (was 141 deg
  with the lateral stick on its stop and 0.44 g: a departure); onsets 1.4 g at 122 KCAS and 1.5 g at 154 (P 1.4 / 1.5 +/- 0.2; were
  1.3 / 1.4); 190 KCAS / 1.43 g 0.35 deg of right roll (the row's 0.5 deg: the KNOWN GAP row at 0.69 now passes). Held to 1.6 g at
  122 KCAS it still departs (54 deg, the stick on its stop). Unchanged: H5 (a departure past 1.3 g, not a gradient), H6, C2 / C3
  (8,375 / 5,750 / 8,625 ft), C4 201.1 KTAS, C12 2,509 ft/min; G3 / G5a / half-P / H3 / H10 rows green (`W/tune/ah56/
  logs-item6-suites.txt`).
- **T7 (R7, should). Engine failure at 63 KCAS: on the ICS (the P aircraft) the minimum is 80.7 % against about 82 %; the SoF
  autorotation collective stays the C12 item.** ASTA-72 para 67 (P, read this round): the 63 KCAS level entry went 3 % below the 85 %
  minimum transient after a 2 s delay of the collective, on the ICS aircraft (100 % = 246 rpm). The reviews compared the AMCS (from
  97.5 %) with it: 77.6 %. The ICS (`out/fail63-ics*.log`; ah56Systems G11b, a passing sense row and an `it.fails` 82 +/- 1 % row):
  82.6 % at the end of the 2 s delay, minimum 80.7 % with the collective dumped to 0.5 deg in 0.3 s (79.2-79.6 % over 1 s), back to
  103 % at 12 s. The decay is the P drivetrain inertia (10,742 slug-ft^2 referred to the rotor; facts.ts tags it P, not ESTIMATE)
  against the 46.5 % torque the trim needs at 63 KCAS: 10 %/s in the first second, which the power and inertia set (D). Not
  changed. The SoF autorotation collective (AMCS 4.5-7 deg indicated = -2.5..0 deg at 0.75 R) overspeeds the rotor: from 63 KCAS
  118 % at 4.5 deg, 107 % at 7 deg, 97.5 % at 9 deg after 12 s (`out/fail63-amcs*.log`); the 95 KCAS autorotation trims 100 % at
  7.8 deg indicated. Lowering the autorotation collective needs more rotor drag, which raises C12's rate of descent (2,508 ft/min,
  already 8 ft/min over P 2,200 +/- 300): the two pull opposite ways on the section's drag and the AMCS collective reference
  (compound.ts "collective gauge"); recorded, owner / AH.
- **T2 (R2, must). Reverse-thrust deceleration: the mechanism is the BEMT's momentum model in the propeller-brake state; the
  reverse branch is refitted (FITTED), the rest is a contract request.** At -12 deg and 60-120 KTAS the reverse prop works at a disc
  thrust coefficient T / (q A) of 0.8-1.9 (`out/propbe.log`), the turbulent-wake regime where simple annulus momentum over-predicts
  the induction (real rotors follow Glauert's empirical branch): the BEMT gives -7.7 / -8.2 / -9.0 / -11.2 kN at 60 / 80 / 100 / 120
  KTAS where the blade elements without induction give -14.9 / -16.1 / -17.7 / -19.6 kN (static -6.7 against -9.0). The fix
  belongs in the shared src/physics/propulsion/bemt.ts (a high-induction correction; contract request to TW: it touches every
  reversing or windmilling prop). The lift-share story of R2 was checked and is the wrong way round: a wing that lifts more at a
  given attitude (zero-lift -4 / -6 deg, `out/ld-*.log`) trims more nose down, and the decel gets WORSE (0.21 / 0.16 g from 165 to
  80 KTAS), because the rotor then has to flare less. Changed (compound.ts, FITTED to ASTA-72 para 15 / Table 3, C11): the prop
  section's negative branch clMin -0.8 -> -1.2, cdMax 1.6 -> 2.0, standing in for the missing induction correction (+2-3 kN at
  60-120 KTAS). The P-technique decel (`out/ld2-*.log`: collective held, -12 deg in 4 s, cyclic holding height, 19,200 lb, 1,500
  ft), before -> after: AMCS 165 -> 80 KTAS 0.22 -> 0.25 g, 50 KTAS at 33.1 -> 29.7 s, 20 KTAS at 42.3 -> 36.8 s; ICS 0.21 -> 0.23
  g, 33.9 -> 30.6 s, 41.0 -> 36.5 s; with a tighter height hold 0.26 / 0.25 g and the ICS to the hover (3 KTAS) in 39.1 s (P 33 s
  +/- 20 % = 26.4-39.6, 0.31 g). C11's own row: 196 -> 165 KTAS 5.43 s (P 5.4), its scripted pilot still does not reach 3 KTAS in
  90 s (`it.fails` kept). Re-checked: C13 25 -> 18 deg in 0.48 s, the 24 deg stop 72.7 % Nr at 5 s (was 73.3; P 68, band 60-75);
  C20 at 188 KCAS prop action 84.1 % (82.9) against the collective 60.4 % (62.1), still the prop critical; C16 ground reverse -7.1
  kN (-6.7); C12 2,509 ft/min (unchanged, the +8 deg drag at 95 KTAS is on the attached branch); C10 59.0 s to 165 KTAS, 77.5 s to
  188 (the forward branch untouched; C10's 188 KTAS row stays `it.fails`).

## Tuning round 2 (2026-10-22, branch tune/ah56; the Fable pilot gate's beginner side; AGENT choices, not owner decisions)

The gate re-ran round 1's numbers exactly and flew the aircraft as the owner will (keyboard, no helicopter experience): the hover
held, nothing beyond it did. Probes and logs `W/tune/ah56/r2/` (`out/bat-*.log`: the gate's battery per profile variant;
`out/wbat-*.log`: the watching beginner; `out/p*.log`: the single probes). The physics is untouched this round: input choices, sim
presets, cues and rows only.

- **T9 (the gate's musts 1-2 and shoulds 3-5, 8). The keyboard beginner beyond the hover.** New test pilot:
  `tests/rotorcraft/ah56KeyPilot.ts`, a WATCHING beginner (presses every 0.8 s seen 0.3 s late, or every 1.2 s seen 0.5 s late,
  holds a key until the seen error, led by the seen rate, is inside a band, at most 2 s; 1 s on the collective). The Bo 105 helper's
  0.1-0.6 s taps do not move this aircraft's re-centring, rate-command keyboard cyclic, so beyond the hover they measure the aid
  alone. Calibrated: on round 1's profile it holds the hover (2.3-2.6 m) and fails the transition and the lift-off, as the gate did.
  - *Transition (must 1).* Cause: the shared law's cyclic datum is attitude COMMAND (the captured attitude + stickAttitude x the
    stick); a re-centring stick puts it back to the captured hover attitude at every key release, and the hold (katt 1.2, full to
    30 KIAS) pulled each push back within about 4 s. The gate's fadeKias [15, 30] (measured: hover fine, transition possible) loses
    the rate damping and the pedal follow-up above 30 KIAS, where this aircraft's trims are still moving (0.10 of the stick aft and
    0.62 of the pedal right between the hover and 45-60 KIAS, `out/p5_speedtrim.log`). Shipped (input.ts): a light hold, katt 0.3
    and stickAttitude 0.6, over [30, 60] KIAS. The gate's pushes (1.5 s ArrowUp every 4 s, collective written) reach 60 KIAS in 42
    s (round 1: never, 46.9 at most); the watching beginner reaches 40 KIAS in 22 / 24 s with the heading 30 / 27 deg off (round
    1's profile, the same pilot: 44 / 34 s, 95 / 50 deg off). Swept and measured (`out/wbat-*.log`): katt 0.6-1.2 at [15-30, 45-60] slower out of the hover and
    no better on the way back; no cyclic term at all (the AMCS's own attitude hold) loses the hover (13-45 m); the follow-up
    deadband at 0.05 fights every push. KNOWN GAP (ah56Assist, `it.fails`): hover -> 40 KIAS -> hover. The way back crashed (68 s,
    0.8 s pace) or was not stopped in 90 s (1.2 s), the heading 68 / 164 deg off: in the 25-60 KIAS band the keyboard pedal stays
    where the hover left it while the trim moves 0.4-0.6 to the right, the beginner flies 20-30 kt of sideslip with the yaw
    swinging 10-20 deg/s, and the stick's anchor stays at the hover trim, 0.08 forward of the 40 KIAS trim, so every released key
    lets the nose drop (rate command). Even from a trimmed 40 KIAS start (`out/wdecel-*.log`) the beginner, with or without the
    aid, does not stop in 90 s. What would fix it is in the shared law (contract requests): the datum re-captured when a
    re-centring stick returns to its anchor (attitude hold at the attitude the pilot left, as the gyro itself holds), and a pedal
    follow-up from sideslip (turn coordination) in the fade band.
  - *Lift-off (must 2).* Causes: (1) the ground trim leaves the cyclic at 0, 0.06 forward of the hover's, and the re-centring
    keyboard stick returns there: the aircraft left the ground nose 2-2.5 deg low and ran forward at 1-2 kt/s (`out/
    p3_lifttrace.log`); (2) the datum is captured at the ground attitude once the wheels carry under half the weight (about 1 deg
    nose low of the IGE hover); (3) the hover pedal is 0.38 left of the ground trim. Shipped: the ground starts (cold, running,
    lined up) hold the cyclic at the IGE hover trim (sim.ts, D: 0.058 / -0.028; 20 s on the wheels hands off, brakes off: 0 m, 0.2
    deg); the heading hold's authority 0.5 (was 0.3), the pedal follow-up 0.5 per s (was 0.2). Rejected with its number: the pedal
    preset at the hover trim, which turned the aircraft 36 deg on its locked tail wheel in 20 s with the collective down
    (`out/p1_trim.log`). Passing rows: F6 held to the first unload, then the watching beginner (feet off the pedals) 3 m up for 30
    s: 10.0 / 11.5 m of drift, 21 / 9 deg of heading, no crash (round 1's profile: crashed at 17 / 22 s, the heading 110 / 97
    deg off; `out/wbat-R1.log`). KNOWN GAP: the same with the Bo 105
    tapper (85 m, 38 deg). Not a row: F6 held until 2.6 m up (the collective overshoots to 0.67) then the tapper crashes on a main
    gear at 7.5 s in every profile tried. Feet off: with the beginner's own pedal keys the heading went 90-180 deg in every
    lift-off; the STAB ASSIST hint now says to leave Z / X alone in the hover and the lift-off.
  - *Collective (should 3).* collectiveRate 0.12 -> 0.06 (F5 held 1 s from the 15 m hover: the wheels at 645 fpm at most, no
    crash; round 1: the ground at 1,057 fpm, a crash; a 0.5 s tap sinks at 369 fpm and stays up; 0.05 measured 560 fpm and a
    slower lift-off). It still reaches the wheels: hands off after the 1 s press nothing stops the descent until the ground
    cushion (the "stays airborne" of the gate is not met, recorded). The hand-rate pair (Shift+F5 1.0 / Shift+F6 0.5 per second,
    the Bo 105's ESTIMATES) with Shift+F5 stopping at 0.15 (7.7 deg indicated): this model's steady autorotation holds 98.6 % Nr at
    90 KIAS and 101.4 % at 75 KIAS there (`out/p7_auto.log`; 0.10: 103.4 / 106.9 %; the floor 108 / 112.5 %). The engine-failure
    dump at 60 KIAS / 150 m, 1 s after the cut (`out/p10_dump.log`): Shift+F5 reaches the stop in 0.3 s, Nr minimum 83.1 %;
    the fine F5 took 5.7 s and 75.5 % (written 1 s dump 81.5 %).
  - *Cyclic keys (should 4).* A constant 0.1 of the axis per second (was the MD 500E's 0.05 -> 0.35 squared over 1.2 s): held 1 / 2
    / 3 s, 1.3 / 4.6 / 9.7 deg of pitch and roll 1.9 / 6.9 / 14.6 deg with the aid (round 1: 2.3 / 13.6 / 33.7 and 3.2 / 20.5 / 51.7,
    a 3 s roll hold reached the ground). The gate's 0.1 and stickAttitude 0.6 taken as recommended.
  - *Heading hold (should 5).* The gate recommended kpsi 0.5 / kr 0.5; measured, the rate term was what saturated (kr x r at the
    15-22 deg/s ringing over the 0.13 yawAuthority), and kpsi 0.5 weakened the lift-off. Shipped kpsi 1.0, kr 0.5 within
    yawAuthority 0.25, holdAuthority 0.5, pedal follow-up 0.5/s: a 0.5 s F6 tap 3.0 deg/s and 2.3 deg (round 1 8.7 deg/s); a 2 s
    right pedal hold peaks 19 deg/s and from 6 s on rings at 4.2 deg/s at most, 3.2 deg from the datum the hold took (round 1:
    14.3 deg/s). Rows in ah56Assist.
  - *Cost of the light hold:* a released 2 s push drifts further hands off (2 s ArrowRight from the hover: 148 m in 22 s, round 1
    118 m; 2 s ArrowUp 99 m, round 1 82 m). The hover itself holds (rows).
  - *The ICS on keys (T8's open item, measured, not tuned; `out/p11_ics.log`):* with the aid the hover holds (the Bo 105 tapper 1.2-1.3
    m, the watching beginner 1.3 m; without it lost at 52-54 s); the keyboard lift-off rolls right onto the wingtip within 2 s of the
    first unload with every cyclic preset tried (round 1's 0 / 0 and this round's AMCS 0.06 / -0.03; the ICS's own IGE trim, -0.07 /
    -0.24 of lateral stick, puts it off at 6-10 s), and the push out of the hover reaches 40 KIAS in 39-41 s through 48-64 deg of
    attitude. The ICS's lateral hover trim (0.24 of the travel left) is far from the AMCS's; the presets and the aid are the AMCS's.
    The keyboard beginner flies the AMCS (the default); the ICS on keys is the owner's to try.
- **T7 addendum (the gate's should 7). The power-off envelope of the model, for the beginner.** From the 15 m hover no technique
  tried survives (the gate: Nr 97 -> 45 % in 4.8 s, 1,800-2,000 fpm, consistent with the P inertia and the P 63 KCAS decay scaled by
  the hover torque); from 60 KIAS / 150 m the autorotation sinks 3,300 fpm and the touchdowns were 960-2,050 fpm. Autorotation
  landings are prohibited (P, the hints). The beginner's engine-failure lesson is the low hover: ah56Systems G11c (new, passing),
  wheels 3 m up, the written pilot levels the wings and raises the collective at 1.0 per second from 1.5 m: 282 fpm, no damage. On
  keys hands off (the aid holds the hover's 4.2 deg of left roll), Shift+F6 from 2 m touches at 320 fpm on the LEFT main alone and
  collapses it (140 kN; ah56Assist KNOWN GAP); the hint card says to level the wings. The gear check asked for (`out/p9_land*.log`):
  a vertical landing in the hover attitude (5 deg left wing low) collapses the left main from about 375 fpm (one-wheel peaks 107 kN
  at 298 fpm, 204 kN at 463, 321 kN at 560 with the limit removed; wings level 90 kN at 386 fpm, 218 kN at 550). The main leg's
  140 kN limit and the stiff gas column (gear.ts, ESTIMATES sized for a level 9.5 ft/s drop) do not cover a one-wheel touchdown at
  the P 9.5 ft/s sink limit, which a landing from this aircraft's left-wing-low hover is. The tail wheel's 45 kN limit (about 6.8
  times its 6.6 kN static share, untagged, ESTIMATE by gear.ts's header) collapsed at 55 kN in the gate's autorotation touchdowns,
  tail first at 15-17 deg nose up and 3.3 m/s, above the P 2.9 m/s. Not changed this round (a crash threshold of AG's gear, no
  handling effect; the one-wheel and tail-down landing conditions at the P sink limit would set them): owner / AG.
- **T1 addendum (the gate's should 6). Taxi cues.** The unlock toast reads "Tail wheel UNLOCKED: turns below 5 kt only; lock it
  (Shift+') above 10 kt" (ui.ts switches) and a Taxi hint row says to taxi LOCKED with the feet off the pedal keys above 10 kt
  (sim advice; the test pilots taxied unlocked to 20 kt). New passing row (ah56Ground): LOCKED at 20 kt, the 1 in pulse, a pilot 0.3
  s late within 1 in of the trim: back within 0.35 deg (the gate's keyboard tapper wound the non-centring pedal to 3 in and struck
  a wingtip at 28 kt). Contract requests: a speed-conditional cue (the toast when unlocking above 5 kt; ui), a re-centring
  pedal-key option on the wheels (input).

## Tuning round 3 (2026-10-25, branch tune2/ah56; the owner's film notes; AGENT choices, not owner decisions)

Probes and logs: `W/tune2/ah56` (notes.md, out/, logs/).

- **T10 (item A, must). The gyro alone holds the trimmed hover hands-off, offsets included; the precession under a NEW moment is the
  rate command; the AMCS net spring was the defect.** New file tests/rotorcraft/ah56GyroHover.test.ts, the stage-2 helicopter (no
  wing, no pusher), aids off, stick held, both configurations; docs/control-gyro-model.md section 7b has the derivation and the
  tables.
  - The film's case (a man on a 16 ft boom, trimmed, released, hands off) holds: 90 kg at 4.9 m to starboard or port, 30 s, AMCS
    0.03 deg of attitude, 1.5-1.8 m, stick 1.9 %; ICS 0.5 deg, 0.6 m, stick 17.1 % (KNOWN GAP against ~15 %: the P stick gearing
    against G4's 5.5 kN m per inch). A 10 in lateral CG shift: AMCS 0.1 deg, 2.2-2.5 m, stick 9.1 %; ICS 82 % of the lateral stick
    (KNOWN GAP). Hands-off 30 s from trim: AMCS OGE 0.17 deg, 3.1 m; IGE 0.04 deg, 1.7 m; ICS 0.65 / 0.51 deg, 0.8 / 0.6 m.
  - A NEW steady moment with the stick held has no fixed-lean equilibrium (the gyro's balance pins the hub moment to the stick;
    the lean does not change the thrust's moment about the CG): it is a rate, K_R beta / H on the AMCS. Measured 0.98 / 1.16 / 0.76
    of it for a 2.2 kN m nose / tail step and the 4.33 kN m boom step (0.37 / 0.37 / 0.73 deg/s). The ah56Handling "625 N m" row is
    re-titled accordingly. On the ICS the same step is Lambda M / H = 5.6 deg/s (0.34 in of stick): the pilot's to take out, as the
    film's nose-handle step was.
  - The defect: the AMCS net spring (ESTIMATE 5559 - 4500 = 1059 N m/rad, a third of K_R) left the low-frequency rotor speed- and
    dihedral-UNSTABLE through a cross-axis residual flap (gyro settled, per m/s: u -> pitch -265 N m, v -> roll +178, cross terms
    559 / 774): the hands-off IGE hover reached 21.7 deg and 71 m in 60 s, the 625 N m step 10.4 deg in 20 s. Refitted to 250 N m/rad
    (gyro.ts AMCS_NET_SPRING, ESTIMATE; Hoh-74 sect 6.1: a negative spring that "partially compensate[s]" the positive one, "the
    pitch-roll cross coupling is zero"): u -> pitch +161, v -> roll -212, cross 124 / 75; IGE 60 s 0.04 deg, 9.1 m; the step 5.1 deg
    at 20 s. The input rotation (FITTED to G8) 5 -> 3 deg for G8's margin (0.130 / 0.155). Every other AH-56A row passes; G5, G6,
    C18, C19 within 2 %; C9's 190 KCAS lateral trim 0.34 -> 0.18 in. Side effect: the IGE engine failure on keys hands off now holds
    the gear (ah56Assist, was a KNOWN GAP).
  - Left: OGE, hands off on the pedals too, 60 s: 2.9 deg, 51 m, the heading 29 deg: a lateral drift starts the tail rotor's
    weathercock and the yaw of the rolled hover carries the space-held tilt round (tail rotor / in-plane, scored apart; with the
    heading held on the pedals 0.36 deg, 22.8 m). The ICS 60 s hands off grows to 29 deg (KNOWN GAP; its spring, cant and sweep are P).
  - Round 4 (the pass-2 gate's disclosures). On the SHIPPED compound (wing on, the pusher at the hover detent; the owner's Shift+A
    aircraft), aids off: IGE 60 s 0.49 deg, 10.4 m; OGE 30 s 0.21 deg, 3.5 m; the trimmed boom 0.08 deg, 2.1-2.4 m at 30 s, 1.9 % of
    stick. OGE 60 s with the pedals free it is 5.9 deg, 59 m, the heading 61 deg, 12 kt (the stage-2 rig's 2.9 / 51 / 29 above: the
    compound's weathercock is stronger; scored apart, tail rotor).
  - A step load with the stick held: the attitude stays bounded but the DRIFT does not. The 4.33 kN m boom step rolls 3.2 / 6.0 / 7.9
    / 11.9 deg at 5 / 10 / 15 / 30 s, and the ground speed is 2.5 / 9 / 17 / 46 kt, the heading through 170 deg by 30 s, 250-660 m in
    60 s, heading held or free, stage-2 and compound alike (new informational A4 30 s row; the gate's p1). So a step load leaves the
    hover within 15 s and needs a re-trim of about 2 % of the stick; the film's nose-handle step was pilot-flown, and the owner's
    "fixed lean, no drift build-up" is reproduced for the TRIMMED offset (A2).
  - The ICS hands-off oscillation is a ground contact, not only an attitude: the 3 m IGE hover (stage-2 and compound, with and without
    the boom) hits the ground at 52 s; OGE 29-43 deg by 60 s. Pre-existing (this round changed only the AMCS constants); the film's 30 s
    window holds (0.5 deg, 1 m). On keys the ICS runway lift-off rolls onto the right wingtip 1.6 s after the unload (24 deg at 34
    deg/s), hands off or with the beginner, as on main 7b3e8f4 (2.1 s): the ICS hint now says to fly it with a stick or from the hover
    scenario (the keyboard beginner profile and the aids are the AMCS's).
- **T11 (items B, C, D). The keyboard beginner: the whole flight now completes; a light attitude hold kept for the way back; four
  new sim aids; the main leg sized for the one-wheel touchdown.** AGENT choices for the owner (no helicopter experience, keyboard
  and trackpad; "go with recommendations"). Rows: tests/rotorcraft/ah56Assist.test.ts (round 3 block) and the new
  ah56KeyMission.test.ts (the whole flight); the test pilot is ah56KeyPilot's watching beginner, feet off the pedal keys.
  - B (the owner prefers the gyro, not a pitch/roll STAB ASSIST, for the attitude). With T10 the beginner holds the hover with the
    cyclic attitude term OFF (the Bo 105 helper's tapper 3.7-5.0 m in 60 s, the watching beginner 2.2-15.4 m), so the hover does
    not need it. The whole flight does: with it off 2 of 4 paces landed, the hover after the stop drifting 80-900 m; with katt 0.3
    and the datum RE-CAPTURED where the re-centring keyboard stick comes back to rest (recaptureOnCentre: the attitude the pilot
    left, held as the gyro holds it, firmer; not round 2's command back to a captured hover attitude) and captured only fully
    airborne (captureAirborne), 4 of 4, the hover 5-24 m. katt 0.15 or authority 0.1 completed 3 of 4 (4 samples: noise around
    "with it"). Shipped: katt 0.3, stickAttitude 0.6, authority 0.2, both re-capture fields. The price: the knock, 2 s ArrowRight
    then hands off, 168 m in 22 s (round 2 148 m; katt 0: 162 m), ArrowUp 114 m (99; 103). katt 0 is
    one line in input.ts (the numbers above are for the owner's choice).
  - Round 4, the knock over 60 s (the pass-2 gate's should; an OWNER DECISION). From the 15 m hover, aids on, a cyclic tap then
    hands off 60 s (W/tune2/ah56/r4/out/arm-1.log): a 1 s tap leaves at 8-28 KIAS, 200-440 m away (ArrowDown backwards at 8 kt); a 2 s
    tap became a climb-out at 47-67 KIAS to 44-273 m AGL, 957-1,179 m away, because the PROP SCHEDULE came in from 30 KIAS and the
    height hold fades at 30-40. Nothing crashes, but the watching beginner after a 2 s push never regains the spot in 60 s (ends
    92-346 m off at 7-33 kt; arm-3.log). Neither option is shipped; both were flown for the owner.
    Option (ii), keeping the gyro's behaviour (the propLever.schedule.arm hunks of W/tune2/ah56/r4/arm-and-groundroll-shared.patch,
    ~15 lines in the shared input files): the PROP SCHEDULE holds the hover detent until the nose-down key is held at 15 KIAS or more (and again below 10).
    The 2 s tap then stays at 26-45 KIAS and 17-58 m AGL (no climb-out) but still drifts 600-824 m; the 1 s tap, the beginner's
    recovery (7 of 8 the same), the pushes row and the whole flight are unchanged; but the deliberate transition gets worse at all
    four paces (out/trans-1.log): hover to 38 KIAS 33.7-39.5 s (27.1-29.7) with the heading 18-54 deg off (14-37), and back to the
    hover in 60 s / not in 90 s at two of the three paces that made it (35-37 s) - a cost on the core manoeuvre for a mis-input.
    Option (i), the owner said they would rather not have a pitch/roll aid: the shared law's translationalRate (the Bo 105 lane's
    TRC, fadeKt 10-20 kt) on the keyboard cyclic. With this profile's light katt 0.3 it makes the 2 s tap WORSE (60-96 KIAS, 110-156
    m AGL); with katt 1.0 within 0.3 of the travel the 1 s tap drifts 5-6 m and the 2 s tap 17-19 m, back to 1 kt or less by 60 s,
    and the whole flight's stop takes 8-12 s (shipped 78 s / over 90 s), but at the 1.2 s pace the landing heading spun 142 deg
    (shipped 43; out/trc-1.log). Option (i) is two lines in input.ts; the hint's "bring it back yourself" is the defence today. Shift+A switches the STAB ASSIST off; the prop schedule lets go when the prop grip is touched.
  - C, the "one gate" (above 25 KIAS the keyboard pedal stayed at the hover's): sideslipPedal walks the keyboard pedal to zero
    sideslip from 20 to 160 kt of forward air speed, above the assist's fade too. The circuit's four turns and legs complete at every
    pace (before: the heading 140-171 deg off on leg 1, 20-30 kt of slip); at 80 / 100 KIAS a pedal knocked 0.13 off is back in 5 s
    with zero slip (without: the roll spiralled to -30 deg). Re-centring pedal keys (centringPedals): the raw aircraft keeps the
    Bo 105 tapper's heading within 11.6 deg (round 2's non-centring keys: 72.6 deg); the beginner's own Z / X in the lift-off still
    spin it (84-180 deg, no crash): the hint says leave them alone.
  - C, the transition: the rotor is speed-stable since T10, and the beginner tilting the nose alone settled at 42-50 KIAS (the
    pushes row never reached 60). The P technique is the propeller (APE-I para 97), so the existing laptop aid
    InputAssists.propSchedule is ON for this type (propLever.schedule.default): until the pilot touches the prop grip, it follows
    the AMCS trim schedule from 40 KIAS and holds the hover detent below 30 (AGENT: with the table's 5 deg at 20 kt the stop pushed
    against prop thrust, 0-1 of 4 decelerations reached the hover; with the detent 3 of 4); it lets go with the engine stopped.
    38 KIAS in 27-30 s (was 50 s / not in 60), 60 KIAS by the pushes in 30.1 s, the circuit at 62-77 KIAS.
  - The whole flight (ah56KeyMission, two paces; four in W/tune2/ah56 out/fin_c1_*.log): every flight lands, no crash; at 0.8 s the
    stop takes 71.8 s, the hover 8.0 m, the touchdown 51 fpm at 1.0 kt. KNOWN GAP at 1.2 s (0.5 s late): not stopped in 90 s, the
    hover 18.8 m, 40 fpm at 9.5 kt (still no crash; the 1.2 s touchdown varies 10-20 kt between rigs: 9.5 kt in ah56KeyMission,
    18.8 kt in the probe mission of W/tune2/ah56/clib.ts). The way back from 40 KIAS (ah56Assist): 36.7 s at 0.8 s, not stopped in 90 s at
    1.2 s, and feet off the heading ends 44-57 deg from the start (the hold takes the nose where it is at 20 KIAS) (KNOWN GAP).
  - D, the collective (heightHold, the Bo 105 lane's law with landAglM 4.5; collectiveFastRate.upStop 0.8 with the engine running):
    F6 held 1 / 2 s past the first unload: no crash, 15-67 fpm (round 2: crashes, left main at 420-699 fpm); F5 held 2 s in the 15 m
    hover: 13 m minimum, 337 fpm (960 fpm, a crash); Shift+F6 held to stop a sink: 19.6-21 m, the heading 25-29 deg (200 m, 180 deg).
    Shift+F5 for 1 s in the hover still hits the ground at 2,640 fpm: it is the autorotation entry; the key label and the hint say
    never in the hover (KNOWN GAP row on the record). Round 4 (the pass-2 gate's should): a sim guard, collectiveFastRate.downGate
    (opt-in, AH-56A only): with the engine running below 30 kt of forward air speed Shift+F5 acts as bare F5, the height hold's
    sink command (air speed: in a hover into a headwind of 30 kt or more it keeps the hand speed). 1 s in the 15 m hover: 14.8 m minimum, 194 fpm; 2 s: 12.7 m, 337 fpm; held 6 s: 5.4 m, 408 fpm; from the 3 m IGE
    hover 58-91 fpm (W/tune2/ah56/r4/out/shiftf5.log). At 90 KIAS it still reaches the 15 % entry stop in 0.5 s, and with the
    engine stopped it keeps the hand speed (the KNOWN GAP row is now three passing rows).
  - D, the run-on landing from a trimmed 45 KIAS approach, feet off (KNOWN GAP): 289 fpm, then the roll-out turns 140 deg as the
    collective comes down (no crash); at the slower pace 547 fpm and the right main collapses (181 kN). Round 4 (the pass-2 gate):
    the Landing hint's "hold the heading with Z / X on the wheels" was flown and does not work (the beginner's pedal keys on the
    wheels: 127 deg at 21 deg of roll; feet on from the approach: 145 deg, at the slow pace a right wingtip strike). The Landing hint
    now LEADS with the hover landing on a held F5 (6 of 6 at both paces, 8-68 fpm: the gate's p6) and says the run-on is not yet
    beginner-safe on keys (the roll-out swings 120-145 deg with the tail rotor as the collective comes down); the Z / X cue is gone.
  - Round 4, a ground-roll heading hold (the gate's should; StabilityAssistTuning.groundRollHeading, opt-in, AH-56A only, a sim aid):
    on the wheels with the tail wheel locked and no pedal key held, the touchdown heading is held on the keyboard pedals between 6
    and 50 kt of ground speed (faded in from 3, out by 60; kpsi 1.5, kr 0.5, within 0.5 of the axis, the pedal centre walked along).
    The swing came from the main term being off on heavy wheels and the tail rotor's thrust outliving the collective. 40 / 45 / 50
    KIAS approaches at 0.8 / 1.0 / 1.2 s, feet off (W/tune2/ah56/r4/out/runon-5.log, runon-6.log; the touchdowns that collapse a main
    at the slow pace left out): with the brakes held below 20 kt 7 of 7 roll-outs end intact (without the hold 1 of 7: wingtip
    strikes, main and tail legs collapsed, 49-145 deg off the approach heading); with the brakes held from the touchdown 5 of 7 (2 nose-overs onto the
    turret, pitch -8.9 deg: a straight roll-out takes the full braking, which the swing used to hide; without the hold 6 of 7 intact,
    swinging 38-150 deg). New ah56Assist rows (45 KIAS, 0.8 / 1.0 s, brakes below 20 kt): 16.6 / 32.3 deg from the touchdown heading,
    no crash. Still not beginner-safe, so the Landing hint keeps the hover landing first: at the 1.2 s pace the beginner's approach
    touches down at 547-565 fpm and collapses a main (no ground-roll term can help), and full brakes above 20 kt can nose over; the
    hint says brakes below 20 kt and feet off the pedal keys (the beginner's own Z / X on the wheels crashed 10 of 16 at 45 / 55 KIAS in
    runon-5, 3 of 4 with this hold). The KNOWN GAP row (both paces, from the approach heading) stays: 55 deg at 0.8 s (35 of it before the
    touchdown), the collapse at 1.2 s. kpsi 2 crashed 3 of 14 (1.5: 2 of 14); kpsi 3 nosed over in the 45 KIAS full-brake case (runon-2).
  - D, the main gear (gear.ts limitLoad, the collapse load, ESTIMATE): 140 -> 180 kN, D from the P 9.5 ft/s touchdown sink with FAR
    27: the level landing at the P sink gives 103 kN a main (this strut, the hover collective), FAR 27.483 puts the level-landing load
    on one wheel, 1.5 x ultimate = 155 kN; a vertical landing from this aircraft's 4.7 deg left-wing-low hover is a one-wheel
    touchdown, 173 kN at the P sink. At 1.2 x the sink (11.4 ft/s, FAR 27.725 reserve energy) the level case holds (152 kN) and the
    one-wheel case still collapses (new ah56Ground G13 row). The IGE engine failure on keys now holds the gear from a 2 m pull (451
    fpm, 145 kN) but not from 1.6 or 2.5 m (542 / 481 fpm, 184 / 183 kN): sensitive, recorded.
  - Round 4, the engine-failure hint (the pass-2 gate, must): it said Shift+F6 "from about 1.5 m" (the written pilot of ah56Systems
    G11c), where its own level-wings technique on keys collapses a main at one lag of two (181 kN). It now says about 2 m of wheel
    height, 6-7 ft on the HUD AGL, between 1.75 and 2.25 m. The window, wings levelled on the arrow keys 0.3 / 0.5 s late (three new
    passing ah56Assist rows; W/tune2/ah56/r4/out/ige.log): 1.75 m 361-406 fpm, 96 kN a main; 2.0 m 309-323 fpm, 70 kN; 2.25 m 315-335
    fpm, 93 kN. Outside it 1.5 and 2.5 m hold at one lag and collapse a main at the other (181 / 183 kN), 1.0 m at both. Hands off
    (the older row, a different technique) only 2.0-2.25 m holds (317 / 315 fpm, 145 / 175 kN); 1.75 m collapses (416 fpm, 181 kN).
  - Integration (tune/rigid-r2, the round-4 gate's must): the hint's cue was the true height, but the pilot reads the HUD AGL
    (rounded, 2.5-3 m/s of sink) late. Flown off the seen HUD reading (W/tune2/ah56/gate2/out/q_edges.txt qD, q_hud8.txt): first
    reads 7 ft holds at 0.3 s (1.8 m, 389 fpm, 90 kN) but collapses the left main at 0.5 s (1.3 m, 514 fpm, 183 kN); 6 ft collapses
    at 0.5 s (184 kN); 8 ft holds at 0.2-0.5 s (2.4-1.9 m, 315-411 fpm, 67-106 kN) and collapses only at a 0.1 s read (180 kN).
    The hint now says: hold Shift+F6 when the HUD AGL first reads 8 ft (arriving at about 2 m). The window in true height above
    (1.75-2.25 m) is unchanged. Open: the ah56Assist igeLevelWings rows still pull on the true height with no lag; they should
    trigger on the lagged, HUD-rounded reading (the gate's nice).
  - Open from the round-4 gate (W/tune2/ah56/gate2/notes.md, q_edges.txt), not fixed at integration: (should) Shift+F5 outside the
    30 kt gate but low, at the beginner's own 40 KIAS / 30 m descent, is still the full hand-speed drop: 1 s takes 36-39 % of the
    collective and the aircraft hits the ground 2.5 s later at 2,440-2,740 fpm, hands off and with the watching beginner at both
    paces (gate's fix: downGate.maxAglM 150, Shift+F5 as F5 below 500 ft AGL too). (nice) After a run-on roll-out the keyboard
    pedal centre the ground-roll hold walked stays at +0.30 / +0.35 of travel, so the next hands-off F6 lift-off swings 20.2 / 19.4
    deg of heading (9.4 deg from a clean start); walk it back when the hold disengages.
  - Not done: item E (an XH-51A-sized gyro rig): not cheap (a definition of its own), not attempted. The ICS on keys: not re-flown.

## Tuning round 5, the keyboard feel (2026-10-25, branch tune3/ah56keys; OWNER decisions: no auto-centring, a crisp feel; the how is AGENT choices)

- **T12. The keys: no auto-centring, an attitude-command stick, yaw-rate pedals, faster collective commands.** The owner's reports on
  the AH-56A keys: "spring loaded and unresponsive", "feels like a 747, not a military helo", "the auto centre action of the
  controls is also a big issue. Not possible to fly this if the controls keep reverting back". Measured through the real key path
  (W/rigid/tune3, notes.md, table_before_after.md; 15 m hover, assist on): before, a 1 s arrow key gave 3 deg/s of roll and 1.9 of
  pitch, the first 1 deg/s at 0.4 / 0.75 s, the stick then springing back; a 1 s pedal key 1.8 deg/s.
  - Shipped (docs/ah56-integration.md section 16; input.ts): the keyboard cyclic and pedals stay where the keys leave them
    (centringCyclic, centringPedals and recaptureOnCentre dropped; 5 still centres; the mouse yoke unchanged, its 0.03 deadzone
    written out). With the STAB ASSIST on the stick is an attitude command (StabilityAssistTuning.keyAttitude, opt-in): 30 deg of
    bank / 15 deg of pitch at 0.6 of the axis, the assist flying it with its own zero-rate trim at every speed; a held arrow key
    about 22 deg/s of bank and 12 of pitch, the first 1 deg/s at 0.1 s (roll) / 0.25 s (pitch), the attitude stays when the key
    comes up; within 4 m of the ground the bank closes to 8 deg (10 m: 30). The pedal keys are a yaw-rate command
    (StabilityAssistTuning.keyPedal, opt-in): 34 deg/s after a 1 s key (35-39 at most), the turn braked when the key comes up and
    the heading hold taking the new heading (a 2 s key: 0.1 deg/s and 1.1 deg from the datum 6 s later; before 0.3 deg/s, 5.4 deg);
    the keyboard pedal then settles to the pedal that holds the heading. F6 / F5 held: 4.5 / 2.5 m/s climb / sink commands at every
    speed (heightHold.held, everySpeed; before 2 / 2 below 30 KIAS), the first 0.3 m/s at 0.3 / 0.45 s.
  - Side fixes the crisp keys needed (AGENT): the sideslip pedal gain 1 -> 0.5 and a yaw damper about the coordinated rate above
    30-45 KIAS (keyPedal.cruiseDamp): the crisp banks excited a lightly damped 6.5 s yaw-sideslip swing that the sideslip pedal
    pumped (r 0-13 deg/s at a steady 11 deg bank, 45 KIAS; now settled in 5 s); the collective-to-pedal crossfeed (pedalCrossfeed
    -2 per unit, 3 s washout): a 1 s F6 in the hover swung the nose 18 deg/s, now 6; the attitude-command trim integrates only while
    the stick is still (integrating the ramp overshot the release 3-6 deg).
  - Rows restated (tests/rotorcraft/ah56Assist, ah56KeyMission; before / after in each comment): the 1 s pedal tap (under 15
    deg/s -> 25-45 deg/s, the new heading held); the held arrow keys (1 s >= 1 deg, 3 s < 15 / 20 deg -> 1 s >= 10 deg, 3 s < 22 / 32,
    the bounds 15 / 30); the raw-aircraft tapper (held -> lost at 31.9 s, the keys no longer re-centre); the watching beginner's
    lift-off drift (15 -> 25 m: 23.3 / 22.6 m); two KNOWN GAPs now pass (the Bo 105 tapper's lift-off: 22-26 deg, 8-10 m; the
    run-on landing, both paces: 201-228 fpm, 10-22 deg); the IGE engine-failure rows' wings-level pilot sizes its presses to the bank
    (|roll| / 22 s, a 0.7 s wait) and passes the unchanged P bands (297-394 fpm, 66-114 kN).
  - KNOWN GAP (the price of the crisp keys, with numbers): the whole flight still lands at both row paces, no crash, but the stop to
    under 3 kt for 2 s within 90 s is no longer reached at the 0.8 s pace (round 3: 71.8 s, the hover 8.0 m, 51 fpm at 1.0 kt; now
    not stopped, the hover off 330 m, 35 fpm at 17.6 kt). Over six paces (the two row paces and 0.75 / 0.85 / 1.15 / 1.25 s) the
    roll key rate decides it: 0.1 per s (5 deg/s, near the old feel) 6 of 6 landed with the stop reached at four; 0.25-0.5 per s 4-5
    of 6; shipped 0.45 per s: 5 of 6 land (the 1.25 s pace strikes a wingtip after a 32 kt touchdown), the stop reached at one (0.85
    s: 44.8 s, the hover 8.2 m). The roll key rate is one number in input.ts (assists.axes.aileron) for the owner to trade. Assist OFF the keys stay too: on the raw rate-command gyro a 1 s arrow key left alone crashes from 15 m in about 6 s and
    a 1 s pedal key spins the hover at 120 deg/s; the hint says the raw stick keeps the nose moving. Held 2-3 s nose-down at 100
    KIAS from 100 m and left there, the 15 deg dive reaches the ground in about 8 s (the attitude stays as commanded).
