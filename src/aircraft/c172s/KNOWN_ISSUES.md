# Cessna 172S: known issues

See also the [cross-aircraft issues](../../../docs/known-issues.md#cross-aircraft-issues). Entries are ordered by pilot impact.

## Developed spins — **missing feature**

A full-aft, full-rudder entry produces a spiral; developed spins and recovery are not represented.
Evidence: [aircraft limitations](../../../docs/aircraft.md).
Close with: a validated post-stall/spin model and aircraft-specific entry/recovery checks.

## Yoke horn passes through the throttle and mixture plungers at full forward and full roll — **defect**

With the yoke at full forward and full left roll, the right yoke's inboard horn passes through the throttle and mixture plunger knobs (pulled out). Only at simultaneous stops; the neutral view is clear.
Evidence: [yokeQuadrantClearance test](../../../tests/render/yokeQuadrantClearance.test.ts) (marked expected-fail for this type).
Close with: horn, lever or knob geometry that clears at every stop, then drop the type from `KNOWN_CLASH`.
