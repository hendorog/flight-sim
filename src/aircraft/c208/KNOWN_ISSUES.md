# Cessna 208 Caravan 675: known issues

See also the [cross-aircraft issues](../../../docs/known-issues.md#cross-aircraft-issues) and the
[turbine model](../../../docs/turbine-model.md). Entries are ordered by pilot impact.

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

The beta cam (`C208_BETA.pitchOnlySchedule`, integration) is three points: the low-pitch stop (15 deg at 0.75 R) at the
gate, about 0 deg at half the pitch-only travel (73 % of the way to ground fine), ground fine (-5.5 deg) at 40 % of the
aft travel. With the angle linear in the lever, half travel was 4.75 deg, where this blade at idle pulls as hard as on the
stop (1346 N, 22.8 kt). Measured at LOW IDLE, maximum gross, level, unbraked: on the gate 1292 N and a steady 22 kt;
half travel (lever 0.2) 1089 N, Np 1285 and a steady 10.9 kt (band 8-12 kt, ESTIMATE); ground fine 186 N and 0 kt. The first quarter of the
travel still passes the 5 deg hump (about as much thrust as on the stop), so the taxi slows over the second quarter.
Evidence: [conformance targets](../../../tests/conformance/targets/c208.ts) `C208_BETA_TAXI`,
[powerplant.ts](powerplant.ts) `C208_BETA`.
Close with: the real cam profile (a PT6A-114A / McCauley beta schedule).

## Beta and reverse data — **estimate**

The blade angles are the TCDS's (IM.A.226 sect. 6.2: low pitch +15.6, reverse -14, feather +88 deg at the 30 in station)
moved to the model's 0.75 R reference as differences from the low-pitch stop. Ground fine (-5.5 deg, about 190 N of
static thrust at LOW IDLE), the pitch-only share of the lever (40 %), the beta valve's rate (20 deg/s), the reversing
cam's top (85 % Ng) and the topping reset in reverse (95 % Np, 1805 rpm, under the TCDS's 1825) are estimates; no POH
figure for the reverse torque was in hand. Full reverse on a static run gives 1160 ft lbf at 1800 rpm and 85 % Ng (the
blade absorbs no more at -14.6 deg; the TCDS allows 1865 ft lbf). LOW IDLE gas power was raised from 20 to 40 shp to
let the aircraft creep off on the gate as the real one does.
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
flaps 20 for the take-off and the climb at 85-95 KIAS, and beta after touchdown. It needs a wider circuit than the
172's: at flight idle (HIGH IDLE) the propeller on its low-pitch stop still turns about 400 ft lbf at 78-95 KIAS, so
with flaps FULL at idle the Caravan comes down at only about 3.6 deg; the pilot descends 450 ft from abeam the
threshold and turns base 2500 m beyond it. A real Caravan comes down far more steeply at idle, so the flight-idle
thrust (or drag) on approach is suspect; it was not recalibrated here (the low-pitch stop carries the climb and cruise
fit).
Evidence: [conformance targets](../../../tests/conformance/targets/c208.ts) `KEYBOARD_PILOT_TARGETS`,
`C208_KEYBOARD_CIRCUIT`; `node scripts/fly-keyboard.mjs c208 <dir>`.
Close with: the POH's idle descent figures (rate of descent at idle, flaps FULL), the flight-idle thrust checked
against them, and the 172's circuit flown unchanged.

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
