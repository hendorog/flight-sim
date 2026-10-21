# Twin turboshaft drivetrain (Bo 105 CB-4) and the new rotorcraft inputs

Package TW of the hingeless/rigid-rotor programme (plan revision 2, sections 3.2, 3.4 and 5). Code:
`src/physics/rotorcraft/twinTurboshaft.ts`, `src/physics/rotorcraft/turboshaft.ts` (per-engine control),
`src/physics/flightModel.ts` (substep and reset), `src/aircraft/bo105/twin.ts` (data), `src/input/**` (keys),
`src/sim/rotorcraft/autopilot.ts`. Tests: `tests/rotorcraft/twin{Rig.ts,Drive,Governor,Oei}.test.ts`,
`tests/input/rotorcraftKeys.test.ts`, `scripts/check-keys.mjs`.

Tags: P = EASA TCDS R.011 / BO 105 Training Manual; P5 = BO 105 CB-5/CBS-5 Flight Manual used for the CB-4 (same
engines, transmission, rotor limits); D = derived; ESTIMATE = no source; AGENT = a choice made by this package, not
by the owner.

## 1. What the pilot has

| Control | Bo 105 | Keys (laptop) |
|---|---|---|
| Two overhead power levers OFF - IDLE - FLIGHT, IDLE lock (P5 FM 7-12) | `ControlInputs.engines[i].throttle` with the profile's `twistGrip` stops | 8 / 9 / 0 choose the left / right / both levers; F1 IDLE, F4 FLIGHT, F2 / F3 back / forward (back stops at IDLE), Shift+F1 OFF through the IDLE lock. In the air Shift+F1 with both levers selected does nothing and says "Select an engine first" (AGENT: the twin guard of the aeroplane twins). |
| ENGINE TRIM fore/aft (both N2) | `n2Beep` | `;` aft (DECR) / `Shift+;` fore (INCR), held |
| ENGINE TRIM left/right (torque split) | `n2BeepSplit` | `Shift+,` left / `Shift+.` right (`<` `>`), held |

Wheeled pusher helicopter (the AH-56A's profile is AG's; these are tested on a synthetic profile):

| Control | Profile field | Keys |
|---|---|---|
| Pusher twist grip (blade angle) | `propLever` | `;` back (toward reverse) / `Shift+;` forward, held: a press 0.02 of travel, then 0.25 of travel per second (AGENT) |
| Grip snaps (hover detent -2.2 deg, autorotation +8 deg, full reverse -12 deg) | `propLever.snaps` (lever positions) | `Shift+/` steps to the next snap in the listed order; from anywhere else to the first |
| Nf / RPM SET beep (moved off the propeller keys) | `n2Beep` with `propLever` | `Shift+,` DECR / `Shift+.` INCR, held |
| Tail-wheel lock | `tailWheelLock` | `Shift+'` toggles |
| Gear lever | `gearLever` | F7 DOWN / Shift+F7 UP |
| Toe brakes, parking brake | `wheelBrakes` | `,` `.` `B` held, `Shift+B` (hidden on helicopters on skids, as before) |
| Re-centring keyboard cyclic (rate-command gyro) | `centringCyclic` | the arrows; let go, the cyclic glides back to the spring-trim anchor at the Numpad 5 rate (4 of travel per second); the mouse yoke rests in a 0.03 deadzone unless the profile sets its own (AGENT, about 0.17 in of 5.8 in) |
| Prop follows the trim schedule until the grip is touched | `propLever.schedule` + `InputAssists.propSchedule` | off by default; a menu toggle is the UI's (request below) |

**Shift+ fallback.** `,` `.` `/` `'` keep their shift-agnostic actions (toe brakes, carburettor heat, panel lights) and
gain a Shift+ action. `actionForKey(code, shift, profile)` gives the Shift+ action only on a type that has it; every
other type keeps the old action on Shift as well (a held Shift never stops the brakes of an aeroplane). The help
listing (`keyBindingsFor`) shows each new key only on a type that has it, with its own text.

## 2. Coupling: two freewheels on one transmission

`Rotorcraft.driveFreewheel` (RC's seam) integrates the rotor's free deceleration once and then asks
`jointFreewheelImpulse(omega, I, engines, r, eta, cap, dt)` for one impulse per engine. The engaged set S is every
engine whose output shaft overruns the rotor (omega_i > r omega). All engines of S end at one shaft speed v = r omega':

    a = eta r^2 / I
    v (1 + a sum_free I_i) = r omega + a sum_free I_i omega_i + a sum_capped capNm dt
    J_i = I_i (omega_i - v)

An engine whose J would be negative leaves S (it would have to be driven by the rotor), one above the cap
(`transmissionTorqueLimit` x dt, twice the transient torque, never binding in use) is held at it, and the set is
solved again. The sums run in a canonical order (by shaft speed, then inertia), so the result does not depend on
which engine is "engine 1" (T2: identical to the last bit over 10 s). With one engine and no cap it reduces to the
legacy impulse `excess / (1/I_e + eta r^2 / I)` (checked to 1e-12).

Energy (T3): over a 20 s manoeuvre with an engine cut and relit, engine shaft work less the (1 - eta) transmission
loss equals the rotor's energy gain plus the aerodynamic work to -0.075 %. The work is taken at the shaft speed each
step starts from (the coupled speed): the engine's own acceleration over a step, taken back by the next impulse, is the
split integration's, not the shaft's (measuring at the mid-step uncoupled speed shows a 0.70 % first-order residual
that halves with the step).

A dead engine's freewheel overruns: its needles split (`needlesSplit`, Nr above N2 by more than 1 %) and its torque
reads 0 once its power turbine has run down (T4: -0.00002 %).

## 3. Governors and load sharing

Each engine runs its own fuel control and N2 governor on the single-engine law (`turboshaft.ts`; MD 500E calibration,
docs/turboshaft-model.md): PLA schedule, proportional droop (5 % N2 per unit N1) about the collective compensator's
datum, an integral that acts in transients only. Engine 1's block is `RotorcraftState.turboshaft`, engine 2's
`twinTurboshaft.second`, through `TurboshaftControl`'s slot accessor (a function of the state, so a resume that
replaces the blocks is followed). Each engine reads its own lever, `engineControl(c, i, 'throttle')`, and returns its
own override (`out.engines[i]` keeps the pilot's own per-engine overrides, e.g. the selected engine's starter).

With both freewheels engaged the two output shafts turn at one speed, so the load splits by the droop: equal datums,
equal N1, equal torque.

- **ENGINE TRIM fore/aft** moves both set points together (`n2SetPct`, kept equal; range 98-102 %, 1 %/s; P5 FM 4-16
  normal band, rate ESTIMATE).
- **ENGINE TRIM left/right** moves `splitPct` (% N1) at 0.7 %/s within +/- 6 % (ESTIMATE): engine 2's compensator datum
  up by half of it, engine 1's down by half (P5 FM 7-12: one engine's torque up, the other's down). AGENT choice: the
  split acts on the datum, not on the N2 set point, so the torques trade at once with no change of N2; on the set
  point the governor's integral (time constant 1/(1.5 x 4 x 0.05) = 3.3 s) made a held switch overshoot zero by 5 %.
- **Rig mismatch** (AGENT, ESTIMATE): engine 2's datum is 1.3 % N1 rich, so a run-up shows a 3.6 % torque split until
  the pilot synchronises (FM 4-16 "Torque - synchronize"). Set `BO105_TWIN.rigMismatch` to 0 to remove it.
- **Reset** (`resetTwinTurboshaft`): every running engine quasi-steady at one PLA demand (each carries half the trimmed
  torque), the split synchronised (`splitPct = -100 x rigMismatch`), both set points at the value that holds the
  present N2, each integral at its steady value. `InitialConditions.enginesRunning` is honoured: a stopped engine has
  its lever OFF, N1 0, its power turbine stopped (needles split) and the other engine carries the trim.

## 4. Warning unit, OEI and the power limits

`publishTwin` (P TM 00-44 warning box K-DW02/01, P5 FM 3-16), bus powered (above 18 V):

| Flag | Condition |
|---|---|
| `n1SplitLight` | N1 differ by 12 % or more (the unit beeps with it) |
| `nrLowLight`, `nrLowTone` (650 Hz, 5/s) | NR 75-95 % (TM: the band's floor keeps the unit quiet at ground idle) |
| `nrHighLight` | NR 103 % or more |
| `nrHighTone` (2600 Hz steady) | NR 108 % or more |
| `RotorcraftState.lowRpmLight` | the one RPM warning light: any of the three lights |
| `RotorcraftState.lowRpmHorn` | `nrLowTone` (the N1-split beeping is `n1SplitLight`, the high tone `nrHighTone`; AU plays them) |
| `RotorcraftState.lowRpm` | NR at or below 95 % (unpowered too) |
| `oei` | one gas producer below the ENGINE OUT N1 (55 %) with the other above it |
| `powerLimitExceeded` | AEO: either engine above 86 % torque, 810 C, 105 % N1, or more than 5 min above MCP (86 % / 779 C); OEI: the survivor above 95 % torque or 810 C or 105 % N1, or `oeiSeconds` (time above the OEI MCP 95 % / 779 C) beyond 30 min (P TCDS p9, P5 FM 2-9) |

The OEI flag waits for N1 to fall below 55 %, about 1.4 s after a fuel cut; until then the survivor is judged against
the AEO limits (it reads `powerLimitExceeded` for that moment).

## 5. The installed engine (proposed for BO)

The shared `ALLISON_250_C20B` (MD 500E) is stronger at a given TOT than the Bo 105's sources allow: on the twin rig it
reads 82 % Bo 105 torque at 95.8 % N1 / 657 C and 95 % at 98.5 % N1 / 724 C, and one engine tops above 115 % torque.
`BO105_INSTALLED_C20B` (twin.ts) re-draws the map above 85 % N1 through two anchors:

- P5 FM 4-17: recommended cruise maximum 82 % torque at 738 C TOT;
- P TCDS p9: OEI emergency 283 kW (95 %) at N1 104 % and TOT 810 C, taken as the running-line point at the 105 % N1
  stop at sea level ISA, 100 % N2.

Gas power = shaft power + 18.6 kW (power-turbine friction and accessories at 100 % N2, measured on the rig); TOT
linear in gas power between the anchors (1.86 C/kW); the fuel flow keeps the MD 500E's specific consumption at each N1.
Idle, light-off, start and snap-deceleration points (85 % N1 and below) and the fuel control are unchanged. Rig
readings: 82 % at 99.6 % N1 / 737 C, 95 % at 104.9 % N1 / 809 C. ESTIMATE (the interpolation; anchors P5 and P). The
313 kW type rating (EASA IM.E.052) is not reached in this installation.

## 6. Acceptance (twin rig: the Bo 105 definition with both engines coupled, `BO105_TURBOSHAFT_INDICATION` (torque in %
of 298 kW), `BO105_INSTALLED_C20B`, Bo 105 inertia at 2200 kg; the S0 stub's rotor; sea level ISA)

| # | Row | Target (tag) | Measured |
|---|---|---|---|
| T1 | legacy digests, goldens | exact | legacyDigest, s269Legacy, contactAirborne unchanged; goldens = baseline (c172Sim x 2) |
| T2 | swap engine indices, rotor omega over 10 s | <= 1e-12 rad/s | 0 (identical) |
| T3 | energy over 20 s | +/- 0.5 % | -0.075 % |
| T4 | engine 2 at IDLE, engine 1 driving (60 KIAS, 2200 kg) | torque 0, split, NR governed | engine 2 0.0000 %, split; engine 1 75.0 %; NR 99.4 %; practice autorotation (levers IDLE, collective down): both split, NR 110.4 % |
| T5 | matched rigging, hover 2200 kg | split <= 1 % (AGENT) | 0.0 % (73.4 / 73.4 %) |
| T5 | rig mismatch, unsynchronised | 4 +/- 2 % | 3.6 % (71.6 / 75.2 %) |
| T5 | ENGINE TRIM left held | crosses zero at 1.5-3 %/s; synchronised <= 1 % (ESTIMATE) | 1.8 %/s at 2.2 s; let go there: -0.7 % |
| T6 | ENGINE TRIM fore/aft | both N2 together, 98-102 % at about 1 %/s (ESTIMATE / P5) | 1.00 %/s; set points 98 / 102 %; N2 98.8 / 102.6 % in the hover (the compensator over-compensates by 0.6-0.8 % at 2200 kg: BO's governor data) |
| T7a | OEI from 2 x 45 % (60 KIAS, 2539 kg), collective held, pedals fixed | NR >= 92 %, >= 97 % in 4 s; survivor <= 95 %, N1 <= 105 %; light + 650 Hz while NR <= 95 %; oei; LEFT yaw <= 10 deg/s (ESTIMATE / P sense) | NR min 97.6 % (never below 97); survivor settles 87.7 %, peak 94.0 %; N1 max 101.8 %; TOT max 762 C; oei at 1.3 s; nose LEFT first, 7.4 deg/s, then 10.8 deg/s right as the survivor re-accelerates the rotor |
| T7b | OEI from 2 x 55 % (hover, 1720 kg), collective held | NR 93-96 % within 5 s and stays; light + 650 Hz on; survivor at the N1 stop 105-106 %, <= 105 % torque; TOT 810 C; collective down at 2 %/s: NR >= 97 %, light off (ESTIMATE / P5 FM 3-21) | NR 96.0 % at 5 s, 95.5 % at 12 s; N1 104.8 % (the fuel control's 0.2 % droop below the 105 % stop); torque max 104.6 %; TOT 810 C; recovery in 2.5 s to 98.6 %, low-NR light out. **Gap:** NR settles above 95 %, so the light and tone stay off (95.6 % with heading held by the pedals, 96.1-96.6 % with them fixed); at 60 KIAS NR settles at 97.4-97.6 % (the descent makes up the power) |
| T7c | survivor over every OEI run | <= 106 % N1, <= 105 % torque | 104.8 %, 104.6 % |
| T7b on the MD 500E map | report | - | survivor 117 % torque peak, 112 % settled, N1 102.3 %, TOT 805 C, NR 99.3 %: why the installed map |
| T8 | in-flight start of engine 2 (60 KIAS, 2200 kg) | engages at N2 = NR, transient <= 0.5 % (ESTIMATE) | engages as the lever leaves IDLE (unloaded N2 at IDLE 95.6 %); excursion 0.09 %; NR then settles 0.55 % higher (less droop with the load shared; the pilot beeps it back) |
| T9 | warning unit | exact (P TM 00-44) | every threshold to 0.01 % as in section 4 |
| T10 | airborne resets 0 / 60 / 120 KIAS | torques +/- 1 %, no step > 0.3 % over 2 s | equal to 1e-9; worst 0.011 %; `[true, false]` and `[false, true]` give the cut engine split, OEI, worst 0.004 % |
| T11 | resume mid-OEI through JSON | no NR or N1 step > 0.2 % | NR 0 at restore; 3e-6 % over 0.5 s (the published N1 gauge is stale until the first step: a SimPhysics restore detail) |
| T12 | inputs | check-keys, tests/input | check-keys passes (Bo 105 lever stops and ENGINE TRIM with real key events, Shift+, braking on the C172S); tests/input 247 pass |
| T13 | autopilot with engine 1 shut down | engages | engages and holds 10 s at 60 KIAS (altitude error 0.001 m) |
| T14 | ground start of engine 2, engine 1 at IDLE | NR dip <= 1 %; no N1-split light 10 s after (ESTIMATE) | NR 49.5 % (one engine at IDLE) dips 0.93 % (the starter's load on engine 1's generator); engages at 16.2 s; light out |
| T15 | both levers IDLE -> FLIGHT over 5 s | NR 60 -> 98 % in 10-20 s; no overshoot > 102 %; split <= 5 %; TOT < 779 C (ESTIMATE) | NR 59.0 -> 98 % in 4.4 s (**gap**); peak 101.4 %; split 0; TOT max 611 C |
| T16 | one lever at IDLE in flight | split, torque 0, the other carries | 0.00001 % / 74.9 % (total before 76.7 %); NR 99.4 % |

In-sim (`index.html?aircraft=bo105&hover=1`, 20 s, the stub's MD 500E gauges in psi): NR 424.5 rpm (100.0 %), N1
86.2 / 86.2 %, N2 100.0 / 100.0 %, torque 40.9 / 40.9 psi (42.7 % each), split synchronised (-1.3 % N1), no crash.

## 7. Known gaps and issues (for the KNOWN_ISSUES files)

- T7b: from 2 x 55 % NR settles at 95.5-96.6 %, just above the 95 % warning threshold, so the RPM light and 650 Hz
  stay off; at 60 KIAS it settles at 97.4-97.6 %. The descent with the collective held makes up most of the deficit.
  Depends on the real rotor and tail rotor (BO): re-measure with `tests/rotorcraft/twinOei.test.ts`.
- T15: NR follows the levers through the PLA schedule; IDLE -> FLIGHT over 5 s gives 98 % in 4.4 s, not 10-20 s. The
  10-20 s ESTIMATE implies acceleration limiting in the fuel control (`accelFuel`, BO's engine data).
- The N1-split warning is not resettable (TM 00-44: "resettable"): in OEI flight the RPM light and the N1-split beeping
  stay on. A reset needs a control and a persisted latch (state block frozen at S0).
- Auto-reignition (the MD 500E's RE-IGN, `TurboshaftControlDef`) also runs per engine on the twin: a cut engine's
  igniters fire while its N1 is below 55 % and the transmission has pressure. Harmless with the lever OFF; the Bo 105
  has no such system (BO's definition decides).
- With two engines sharing, each governor droops less: NR settles about 0.5 % higher than on one engine at the same
  power (the pilot re-beeps); a real hydromechanical twin does the same.
- The OEI flag waits for N1 below 55 % (about 1.4 s after a cut); in between the survivor is judged on AEO limits.
- After a resume, the published N1 gauges are those of the reset until the first physics step (SimPhysics restore).

## 8. Changes for other owners (requests)

- BO, `src/aircraft/bo105/rotorcraft.ts`: spread `BO105_TURBOSHAFT_INDICATION` over `systems.turboshaft` (torque in %,
  Bo 105 limits, engine-out 55 % N1 / 95 % NR); re-check T6 (N2 at the beep stops sits 0.6-0.8 % above the set point:
  `governor.datumNg` / `anticipation` for two engines).
- BO, `src/aircraft/bo105/powerplant.ts`: `engine: BO105_INSTALLED_C20B` for both engines (or its own map meeting the
  same two anchors); re-run `tests/rotorcraft/twinOei.test.ts`.
- BO, `src/aircraft/bo105/input.ts`: drop the MD 500E's twist-grip `labels` (throttleDown/Up/Idle/Full) so the help
  shows the power-lever texts; `BO105_POWER_LEVER` stops already planned.
- AG, `src/aircraft/ah56/input.ts`: `propLever { detent, snaps: [hover, autorotation, reverse] }` as lever positions,
  `n2Beep`, `tailWheelLock`, `gearLever`, `wheelBrakes`, `centringCyclic` (and `mouseYoke` only if it wants other than
  the 0.03 deadzone); AC: `propLever.schedule` from `pusherTrimLever`.
- PN / integrator (`src/ui/menu.ts`, `src/ui/uiSystem.ts`): a menu toggle for `InputAssists.propSchedule` (off by
  default); the HUD's PWR 1 / PWR 2 and split readouts read `engines[i].throttle` and `twinTurboshaft.splitPct`.
- AU: the twin's tones are `twinTurboshaft.nrLowTone` (650 Hz, 5/s), `nrHighTone` (2600 Hz steady) and the beeping
  with `n1SplitLight`; `lowRpmHorn` mirrors `nrLowTone`.
