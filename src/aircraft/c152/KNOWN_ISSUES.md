# Cessna 152: known issues

See also the [cross-aircraft issues](../../../docs/known-issues.md#cross-aircraft-issues). Entries are ordered by pilot impact.

## Developed spins — **missing feature**

A full-aft, full-rudder entry produces a spiral; developed spins and recovery are not represented.
Evidence: [aircraft limitations](../../../docs/aircraft.md).
Close with: a validated post-stall/spin model and aircraft-specific entry/recovery checks.

## Rapid throttle response — **missing feature**

The stumble from opening a throttle without an accelerator pump is absent.
Evidence: [notModelled](index.ts).
Close with: a carburettor transient (wall film on throttle opening) and rapid-throttle checks.

## Hand primer — **estimate**

The primer is modelled (cold engines need it, over-priming floods, the flooded-start procedure clears it, an unlocked primer
roughens the idle), but the charge per stroke, the cold induction film, the evaporation from the ports and the wet-plug
flooding are estimates set to give the POH's stroke counts (4-7, 4-11, 4-19), not measured.
Evidence: [powerplant](powerplant.ts) (O235_PRIMER), [primer tests](../../../tests/propulsion/primer.test.ts).
Close with: a measured primer delivery and observed start behaviour (strokes against OAT, flooding) to recheck the tables.

## Fuel transfer on slopes — **missing feature**

Both tanks feed equally; cross-feed through the vent line on a slope is absent.
Evidence: [notModelled](index.ts).
Close with: tank/vent geometry and a head-dependent transfer model.

## Control rigging — **missing feature**

The 1° aileron droop is absent; the ground-adjustable rudder tab is only a fixed offset.
Evidence: [notModelled](index.ts).
Close with: rigging geometry and control-response checks.

## Handling and system parameters — **estimate**

Tail sections, gear compliance, flap travel time and takeoff fuel flow include unmeasured assumptions.
Evidence: [aero](aero.ts), [gear](gear.ts) (~50 kN/m), [systems](systems.ts) (~9 s flaps), [powerplant](powerplant.ts) (~9 US gal/h), and [geometry](geometry.ts) estimate comments.
Close with: measured section/rigging, gear, actuator, fuel-flow and cockpit/airframe geometry data.

## Optional equipment and later variants — **missing feature**

Wheel fairings, long-range tanks, the 108 hp O-235-N2C and the 1979 ramp-weight increase are absent; this is the 1978 trainer.
Evidence: [notModelled](index.ts); its POH cruise figures include fairings worth about 2 kt.
Close with: separate sourced equipment/variant configurations and performance checks.
