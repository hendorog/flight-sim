# Piper PA-38 Tomahawk II: known issues

See also the [cross-aircraft issues](../../../docs/known-issues.md#cross-aircraft-issues). Entries are ordered by pilot impact.

## Reported high stall speed awaits observation — **unvalidated**

The owner felt stall speed was too high; the investigation did not confirm an aerodynamic defect.
Evidence: [Stall measurements](../../../docs/pa38-stall.md#stall-measurements): 51.4 KIAS clean / 49.8 KIAS at 34° at 1,670 lb, versus POH 52/49; [pa38Stall tests](../../../tests/fdm/pa38Stall.test.ts).
Close with: the owner’s observed loading, flap setting and entry/indication trace, then a like-for-like comparison.

## Developed spins — **missing feature**

A full-aft, full-rudder entry produces a spiral; developed spins and recovery are not represented.
Evidence: [README aircraft limitations](../../../README.md#aircraft).
Close with: a validated post-stall/spin model and aircraft-specific entry/recovery checks.

## Stall strips and warning calibration — **estimate**

Strip stations and the vane installation angle lack measured rigging data.
Evidence: [aero](aero.ts): Piper SL 876 was not found; [stall investigation](../../../docs/pa38-stall.md#fix-and-scope) uses an estimated 6.8° clean trip incidence.
Close with: SL 876/installation measurements and warning-margin validation across configurations.

## Stall buffet — **missing feature**

The T-tail’s rattle and shake in the wing wake are replaced by generic buffet.
Evidence: [notModelled](index.ts).
Close with: measured or observed Tomahawk buffet response and a corresponding model.

## Priming and carb-heat damage — **missing feature**

Cold starts need no primer; over-priming and rapid-throttle stumble are absent. Full-power carb heat reduces power without detonation damage.
Evidence: [notModelled](index.ts), citing POH 4.29 for the carb-heat limitation.
Close with: primer/fuel-film behavior and sourced detonation/damage criteria.

## Handling and geometry parameters — **estimate**

Body inertia, tail/CG geometry, gear compliance and fuel flow retain estimates.
Evidence: [systems](systems.ts) (Roskam inertia estimate), [geometry](geometry.ts), [gear](gear.ts) (~48 kN/m), [powerplant](powerplant.ts) (~9.3 US gal/h).
Close with: measured mass distribution, rigging, suspension and engine data; recheck handling and performance.

## Rudder tab and Tomahawk I — **missing feature**

The rudder tab is only a fixed offset; the earlier Tomahawk I configuration is absent.
Evidence: [notModelled](index.ts): the current aircraft has both flow-strip pairs and Tomahawk II wheels.
Close with: adjustable ground rigging and a separately sourced earlier variant if supported.
