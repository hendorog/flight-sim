# Piper PA-38 Tomahawk II: known issues

See also the [cross-aircraft issues](../../../docs/known-issues.md#cross-aircraft-issues). Entries are ordered by pilot impact.

## Reported high stall speed awaits observation — **unvalidated**

The owner felt stall speed was too high; the investigation did not confirm an aerodynamic defect.
Evidence: [Stall measurements](../../../docs/pa38-stall.md#stall-measurements): 51.4 KIAS clean / 49.8 KIAS at 34° at 1,670 lb, versus POH 52/49; [pa38Stall tests](../../../tests/fdm/pa38Stall.test.ts).
Close with: the owner’s observed loading, flap setting and entry/indication trace, then a like-for-like comparison.

## Developed spins — **missing feature**

A full-aft, full-rudder entry produces a spiral; developed spins and recovery are not represented.
Evidence: [aircraft limitations](../../../docs/aircraft.md).
Close with: a validated post-stall/spin model and aircraft-specific entry/recovery checks.

## Stall strips and warning calibration — **estimate**

Strip stations and the vane installation angle lack measured rigging data.
Evidence: [aero](aero.ts): Piper SL 876 was not found; [stall investigation](../../../docs/pa38-stall.md#fix-and-scope) uses an estimated 6.8° clean trip incidence.
Close with: SL 876/installation measurements and warning-margin validation across configurations.

## Stall buffet — **missing feature**

The T-tail’s rattle and shake in the wing wake are replaced by generic buffet.
Evidence: [notModelled](index.ts).
Close with: measured or observed Tomahawk buffet response and a corresponding model.

## Rapid throttle response and carb-heat damage — **missing feature**

Rapid-throttle stumble is absent. Full-power carb heat reduces power without detonation damage.
Evidence: [notModelled](index.ts), citing POH 4.29 for the carb-heat limitation.
Close with: a carburettor transient model and sourced detonation/damage criteria.

## Hand primer — **estimate**

The primer is the C152's (the same O-235): modelled, with estimated tables set to the stroke counts of POH 4.13. Each key press
is a whole stroke: the handbook's last stroke left out and pushed in slowly as the engine fires is not a separate action.
Evidence: [notModelled](index.ts), [C152 powerplant](../c152/powerplant.ts) (O235_PRIMER).
Close with: a measured primer delivery and observed start behaviour; a held-out last stroke if wanted.

## Handling and geometry parameters — **estimate**

Body inertia, tail/CG geometry, gear compliance and fuel flow retain estimates.
Evidence: [systems](systems.ts) (Roskam inertia estimate), [geometry](geometry.ts), [gear](gear.ts) (~48 kN/m), [powerplant](powerplant.ts) (~9.3 US gal/h).
Close with: measured mass distribution, rigging, suspension and engine data; recheck handling and performance.

## Rudder tab and Tomahawk I — **missing feature**

The rudder tab is only a fixed offset; the earlier Tomahawk I configuration is absent.
Evidence: [notModelled](index.ts): the current aircraft has both flow-strip pairs and Tomahawk II wheels.
Close with: adjustable ground rigging and a separately sourced earlier variant if supported.

## Yoke horn passes through the throttle and mixture levers at full forward and full roll — **defect**

With the yoke at full forward and full roll, the inboard horn passes through the throttle and mixture levers at an end of their travel. Only at simultaneous stops; the neutral view is clear.
Evidence: [yokeQuadrantClearance test](../../../tests/render/yokeQuadrantClearance.test.ts) (marked expected-fail for this type).
Close with: horn, lever or knob geometry that clears at every stop, then drop the type from `KNOWN_CLASH`.

## Hand brake is on or off only — **missing feature**

The standard hand brake (POH 7.7, fig 7-13), the one used in training, is Shift+B: it pulls and locks full braking on both mains, as the parking brake. It cannot be pulled part-way, so progressive braking is on the toe brakes (B or the pedals), the optional fit, which the model has.
Evidence: [notModelled](index.ts), [gear](gear.ts), Shift+B → `parkingBrake` in [bindings](../../input/bindings.ts).
Close with: a progressive hand-brake input (an axis or a held key) that feeds both mains' brakes, and the lock as its own action.
