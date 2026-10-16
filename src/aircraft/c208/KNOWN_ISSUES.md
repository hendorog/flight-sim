# Cessna 208 Caravan 675: known issues

See also the [cross-aircraft issues](../../../docs/known-issues.md#cross-aircraft-issues) and the
[turbine model](../../../docs/turbine-model.md). Entries are ordered by pilot impact.

## Full reverse held to a stop with full brakes — **defect**

Holding the power lever in full reverse (-14.6 deg, Ng 85 %, about 2.9 kN aft) with full braking down to walking
pace lifts the left main wheel at about 5 kt, then the nose wheel, and collapses the right main leg (about 55-71 kN):
`crashed` "Right main gear collapsed". In ground fine, or out of reverse to ground fine by 40 KIAS (the POH's
technique), the roll ends normally (205 m in ground fine, 195 m with reverse cancelled at 40 KIAS, 274 m on the gate).
Evidence: a landing roll at 78 KTAS, flaps 30, `rollReverse 1` with no cancel (tests/fdm/measure.ts landingRoll); the
same defect on the turbine-core test-bed (docs/turbine-model.md, hand-over 3).
Close with: a look at the brake and tyre model with aft thrust near zero speed (physics/gear), then a reverse-to-stop
item in the conformance targets.

## Beta range lever schedule — **simplification**

The blade angle follows the power lever linearly from the low-pitch stop (15 deg at 0.75 R) to ground fine (-5.5 deg)
over the first 40 % of the aft travel. This propeller makes as much static thrust at idle with 5-8 deg of blade as on
the stop (it is partly stalled there at 700 rpm), so the first half of the beta travel does not slow a taxi: at LOW IDLE
the aircraft settles at 22 kt on the gate, 23 kt at half the pitch-only travel and stops in ground fine. The real lever
slows the taxi progressively. The half-travel items (8-12 kt) are held open as `C208-beta-cam`.
Evidence: [conformance targets](../../../tests/conformance/targets/c208.ts) `C208_BETA_TAXI`,
[requests](../../../tests/conformance/requests.ts).
Close with: a lever-to-blade-angle schedule (beta cam) in BetaDef, and the half-travel items judged again.

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

## Keyboard circuit — **unvalidated**

The conformance suite's keyboard circuit is not flown: its pilot sets power by rpm, which a governed turboprop
does not show (the propeller holds 1900).
Evidence: [conformance test](../../../tests/conformance/c208.test.ts).
Close with: a torque-based keyboard pilot and the circuit flown.

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
