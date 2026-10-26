# Piper PA-34 Seneca I: known issues

See also the [cross-aircraft issues](../../../docs/known-issues.md#cross-aircraft-issues). Entries are ordered by pilot impact.

## Exterior lights produce zero output — **defect**

The 14 V installation reaches the same 28 V renderer path as the DA20, leaving exterior light output at zero.
Evidence: [powerplant](powerplant.ts) regulates at 14.0 V; [AircraftVisual](../../render/aircraft/AircraftVisual.ts) omits nominal voltage; [AircraftLights](../../render/aircraft/lights.ts) defaults to 28 V with an 18 V cutoff.
Close with: installation-aware voltage scaling and powered night-light checks, including the nose-gear interlock.

## Developed spins — **missing feature**

A full-aft, full-rudder entry produces a spiral; developed spins and recovery are not represented.
Evidence: [aircraft limitations](../../../docs/aircraft.md).
Close with: a validated post-stall/spin model and aircraft-specific entry/recovery checks.

## Brief taxi stall-warning chirp — **defect**

Abrupt half-throttle taxi acceleration can still sound a clean-wing warning for 33 ms.
Evidence: [Stall investigation, cross-type findings](../../../docs/pa38-stall.md#fix-and-scope): 5.02 m/s, local alpha 9.60° against 9.45°, geometric section angle only 3.51°.
Close with: investigating the induced-flow transient and a regression that preserves genuine gust/high-alpha warnings.

## Propeller failure and operating-limit behavior — **missing feature**

The 2200–2400 rpm avoid band and dampers have no effect; loss of feathering-dome nitrogen cannot prevent feathering or cause overspeed.
Evidence: [notModelled](index.ts).
Close with: sourced damper/charge dynamics and failure checks.

## Gear and landing limitations — **missing feature**

Landing above 4000 lb is permitted; hydraulic leaks cannot drop the gear. The nose-gear mirror and nav-linked gear-light dimming are absent.
Evidence: [notModelled](index.ts).
Close with: weight-limit consequences, hydraulic leak behavior and the missing indications.

## Control interconnect and alternate-air doors — **missing feature**

The aileron-rudder spring interconnect is absent; alternate-air doors are switches only.
Evidence: [notModelled](index.ts): feet-off Dutch roll and pedal-induced roll differ from the aircraft.
Close with: linkage/force data and control/door behavior checks.

## Handling, warning and system parameters — **estimate**

Body inertia, stabilator tab gearing, warning installation angles and gear emergency-extension timing remain estimates.
Evidence: [systems](systems.ts), [gear](gear.ts), [aero](aero.ts); [stall investigation](../../../docs/pa38-stall.md#fix-and-scope) does not independently source the retained 5–10 mph horn margin.
Close with: mass/rigging, warning and hydraulic measurements; also validate priming assumptions in [powerplant](powerplant.ts).

## Optional equipment — **missing feature**

The Janitrol heater, ice protection and AltiMatic autopilot are absent.
Evidence: [notModelled](index.ts).
Close with: installation-specific systems and operating checks.

## Yoke horn passes through the quadrant levers at full forward and full roll — **defect**

With the yokes at full forward and full roll, the inboard horns pass through the propeller and mixture lever knobs at full forward travel. Only at simultaneous stops; the neutral view is clear.
Evidence: [yokeQuadrantClearance test](../../../tests/render/yokeQuadrantClearance.test.ts) (marked expected-fail for this type).
Close with: horn, lever or knob geometry that clears at every stop, then drop the type from `KNOWN_CLASH`.
