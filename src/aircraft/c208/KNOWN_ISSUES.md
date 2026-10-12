# Cessna 208 Caravan 675: known issues

See also the [cross-aircraft issues](../../../docs/known-issues.md#cross-aircraft-issues) and the
[turbine model](../../../docs/turbine-model.md). Entries are ordered by pilot impact.

## Beta and reverse — **missing feature**

The power lever stops at flight idle. On the ground at idle the propeller pulls about 3.5 kN at HIGH IDLE (less at
LOW IDLE), so the aircraft creeps or accelerates where the real one is taxied in beta, and the landing roll
is about 25 % longer than the POH's (275 m against 218 m; the conformance item is held open as `C208-beta`).
Evidence: [notModelled](index.ts), [conformance targets](../../../tests/conformance/targets/c208.ts).
Close with: blade angles below the flight-idle stop (ground fine, reverse) on the power lever's aft range, reverse
propeller maps, the beta valve and the Ng reset of the reversing cam; then judge `C208-beta` again.

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
