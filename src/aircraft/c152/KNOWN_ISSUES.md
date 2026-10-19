# Cessna 152: known issues

See also the [cross-aircraft issues](../../../docs/known-issues.md#cross-aircraft-issues). Entries are ordered by pilot impact.

## Developed spins — **missing feature**

A full-aft, full-rudder entry produces a spiral; developed spins and recovery are not represented.
Evidence: [aircraft limitations](../../../docs/aircraft.md).
Close with: a validated post-stall/spin model and aircraft-specific entry/recovery checks.

## Primer and rapid throttle response — **missing feature**

Cold starts need no priming; over-priming and the stumble from opening a throttle without an accelerator pump are absent.
Evidence: [notModelled](index.ts).
Close with: primer/fuel-film behavior and cold, flooded and rapid-throttle checks.

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
