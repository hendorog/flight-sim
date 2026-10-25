# Cessna 208 Caravan 675: known issues

See also the [cross-aircraft issues](../../../docs/known-issues.md#cross-aircraft-issues) and the
[turbine model](../../../docs/turbine-model.md). Entries are ordered by pilot impact.

## Idle drag on the ground and in the air — **fixed 2026-10-26 (estimate)**

Owner report: after touchdown with the power lever at idle the Caravan "will not stop on its own". Measured (maximum
landing weight, flaps FULL, touchdown 71 KIAS, power lever on the gate, condition HIGH IDLE, no brakes): the propeller
on its low-pitch stop pulled +1.8 kN at 70 kt and +3.2 kN at 10 kt, so the roll levelled off at 55 kt; on the brakes it
pulled 3.5 kN. In the air it pulled +1.2 kN at 95 KIAS clean, an idle glide of L/D 21 against 12.7 feathered. Rolling
resistance (0.02, shared, Torenbeek) and airframe drag (CD about 0.12 on the roll, flaps FULL) were in order; the C172S
on the same model creeps at about 4 kt at idle. Two causes: the TCDS's low-pitch stop (+15.6 deg) is at the 30 in
station but stood in the model at 0.75 R, 6.9 deg too coarse along the blade's twist; and HIGH IDLE (65 % Ng) gave
about 120 shp of gas power (between 70 shp at 60 % and 170 at 70 %), LOW IDLE 40 shp. Now: the stop at 8.7 deg at
0.75 R (reverse 29.6 deg below it, -20.9), gas power 25 / 40 shp at LOW / HIGH IDLE (70-80 % Ng refaired), the beta
cam linear. After: HIGH IDLE on the gate 1.45 kN static, unbraked steady 26 kt (the landing roll from 71 KIAS passes
50 kt at 27 s and 30 kt at 97 s); LOW IDLE on the gate 0.93 kN, about 7 kt; idle descents clean at 95 / 120 KIAS
-0.4 / -1.8 kN (5.0 / 7.3 deg), flaps FULL at 78 KIAS 6.4 deg (was 4.6). Source for the behaviour: AOPA Pilot, Turbine
Pilot: Cessna Caravan, March 2009 (feathering at idle makes it surge forward; below about 500 ft lbf the blades are "a
giant, drag-producing disc"; "a fair amount of breakaway power" to start taxiing). The idle powers and the angle at
0.75 R (the model's helix twist, not McCauley's blade drawing) are ESTIMATES. With no brakes and no beta the aircraft
still settles into a brisk taxi at HIGH IDLE: the POH's technique is beta after touchdown. Side effect: the suite's
engine-dead glide (targets `glide`, labelled `propeller: 'feathered'`) trims this single with its propeller
windmilling on the stop, not feathered (blade 8.7 deg, 1674 rpm at 95 KIAS): it went from 12.0 to 10.8 at 88 KIAS
(best-glide speed 95 to 88 KIAS) with the finer stop; feathered in flight it glides at about 12.8. Flaps FULL at
78 KIAS idle still pulls about +0.2 kN: the remaining soft spot (a finer real stop would turn it into drag).
Owner decisions: the LOW IDLE taxi bands (the gate 4-12 kt, was 15-30; half travel 1-6 kt, was 8-12), and whether
HIGH IDLE on the gate should roll slower still.
Evidence: [conformance targets](../../../tests/conformance/targets/c208.ts) `C208_BETA_TAXI`, `C208_IDLE_DESCENT`;
tests/aircraft/c208.test.ts; [powerplant.ts](powerplant.ts) `FINE`, the gas-generator map.
Close with: POH idle-descent and taxi figures, the PT6A-114A idle torque and Np on the gate, the real blade twist.

## Full reverse held to a stop with full brakes — **not reproduced (closed)**

The defect seen on the turbine-core test-bed and on the C208 at T1b (full reverse held to walking pace with full
brakes lifted a main wheel, then the nose, and collapsed the other main at 55-71 kN) does not reproduce on the
integrated aircraft (polish 2026-10-17). A landing roll at 78 KTAS, flaps 30, `rollReverse 1` with no cancel and full
brakes (tests/fdm/measure.ts landingRoll), then reverse and full brakes held 10 s at the stop, at maxGross, MLW, the
forward and the aft loading: no crash, rolls 180-196 m, mains at most 20.3 kN, the nose at least 0.3 kN except at the
aft loading (unloaded for 0.17 s as the aircraft rocks back after the braked stop), pitch -1.0 to +1.0 deg, full
reverse -2.9 kN at Np 1801 and Ng 85 %. From rest on full brakes: the nose keeps 0.9-4.2 kN. The PC-12 at its aft
limit does sit back on its tail in the same test (its own KNOWN_ISSUES): a matter of its CG and thrust, not a gear defect.
The test-bed graft was not re-run.
Evidence: the polish probes (work/pcmd/polish-pc12-tools/collapse.test.ts, static.test.ts).
Close with: a reverse-to-stop item in the conformance targets if the POH gives a technique for it.

## Beta range lever schedule — **estimate**

The blade angle is linear in the lever over the pitch-only travel, from the low-pitch stop (8.7 deg at 0.75 R) at the
gate to ground fine (-5.5 deg) at 40 % of the aft travel. Until 2026-10-26 a cam (73 % of the way at half travel) made
up for the old 15 deg stop. Measured at LOW IDLE, maximum gross, level, unbraked: on the gate 925 N and about 7 kt;
half travel (lever 0.2, 1.6 deg) 809 N, Np 984 and 2.7 kt (band 1-6 kt, ESTIMATE); ground fine 125 N and 0 kt.
Evidence: [conformance targets](../../../tests/conformance/targets/c208.ts) `C208_BETA_TAXI`,
[powerplant.ts](powerplant.ts) `C208_BETA`.
Close with: the real cam profile (a PT6A-114A / McCauley beta schedule).

## Beta and reverse data — **estimate**

The blade angles are the TCDS's (IM.A.226 sect. 6.2: low pitch +15.6, reverse -14, feather +88 deg at the 30 in station):
the stop carried to 0.75 R along the model's twist (8.7 deg), reverse the TCDS's difference below it (-20.9), feather
left at 88 deg. Ground fine (-5.5 deg, about 125 N of
static thrust at LOW IDLE), the pitch-only share of the lever (40 %), the beta valve's rate (20 deg/s), the reversing
cam's top (85 % Ng) and the topping reset in reverse (95 % Np, 1805 rpm, under the TCDS's 1825) are estimates; no POH
figure for the reverse torque was in hand. Full reverse on a static run gives -3.5 kN, 1218 ft lbf at 1709 rpm and
85 % Ng (the TCDS allows 1865 ft lbf, 1825 rpm); before 2026-10-26, at -14.6 deg, -2.9 kN and 1162 ft lbf at 1800 rpm.
LOW IDLE gas power, raised from 20 to 40 shp at integration to let the aircraft creep off on the gate, is 25 shp since
2026-10-26 (see the idle drag entry).
Evidence: [powerplant.ts](powerplant.ts) `C208_BETA`, `PT6A_114A.turbine.reversingCam`.
Close with: the POH's reverse and beta figures (Np, torque, Ng at full reverse; idle Np on the gate and in beta).

## Engine data — **estimate**

The PT6A-114A running line (fuel flow, ITT and power against Ng), the start schedule, the spool inertia, the
starter-generator and the oil model are a plausible PT6 shape fitted to a few POH figures (take-off torque, Vy
climb, maximum cruise at 10 000 ft), not a P&WC engine deck.
Evidence: [powerplant.ts](powerplant.ts), [docs/turbine-model.md](../../../docs/turbine-model.md).
Close with: the POH's power-setting tables (torque, ITT, Ng and fuel flow against altitude and OAT) as conformance
items, and the map refitted to them.

## Airframe data — **estimate**

No engineering data sheet exists yet. Planform, tail areas, control travels, CG range, inertia, gear stiffness,
drag items and the airspeed calibration are three-view and handbook-derived estimates; the stall speeds and the
glide ratio are weak (recalled) data.
Evidence: the ESTIMATE / 3V comments in [geometry.ts](geometry.ts), [systems.ts](systems.ts), [aero.ts](aero.ts),
[gear.ts](gear.ts).
Close with: a data sheet like the other types' (TCDS A37CE, POH, maintenance manual) and the numbers moved to it.

## Keyboard circuit — **workaround**

The keyboard circuit is flown by torque (the pilot reads ft lbf and sets it with taps; take-off 1750, climb 1650),
flaps 20 for the take-off and the climb at 85-95 KIAS, and beta after touchdown. It was widened (base 2500 m beyond the
threshold, 450 ft descended from abeam it) when the idle propeller still turned about 400 ft lbf on approach and flaps
FULL at idle came down at only 3.6 deg. Since 2026-10-26 idle drags (about 100 ft lbf, 6.4 deg at 78 KIAS flaps FULL);
the circuit was left as it was and passes, with the flare raised from 7 to 7.5 m (touchdown 1.41 / 1.69 m/s calm /
10 kt crosswind; limit 1.8).
Evidence: [conformance targets](../../../tests/conformance/targets/c208.ts) `KEYBOARD_PILOT_TARGETS`,
`C208_KEYBOARD_CIRCUIT`; `node scripts/fly-keyboard.mjs c208 <dir>`.
Close with: the POH's idle descent figures, then the circuit brought back toward the 172's.

## Roll spoilers, anti-ice, inertial separator — **missing feature**

The ailerons carry the roll power alone; the inertial separator and the engine, propeller and airframe anti-ice
(with their power and ITT penalties) are absent.
Evidence: [notModelled](index.ts).
Close with: the spoiler geometry and the bypass and anti-ice penalties on the gas generator.

## In-flight flame-out — **missing feature**

After a flame-out the gas generator runs down to zero instead of windmilling at 10-15 % Ng, so every air start is
starter-assisted; there is no auto-ignition.
Evidence: [notModelled](index.ts), [docs/turbine-model.md](../../../docs/turbine-model.md).
Close with: a windmilling compressor driven by ram pressure and a windmill relight envelope.
