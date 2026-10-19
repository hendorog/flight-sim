# Diamond DA20-C1: known issues

See also the [cross-aircraft issues](../../../docs/known-issues.md#cross-aircraft-issues). Entries are ordered by pilot impact.

## Exterior lights produce zero output — **defect**

The 14 V installation is evaluated as a 28 V light system, so working switches cannot illuminate the exterior lights.
Evidence: [powerplant](powerplant.ts) regulates at 14.2 V; [AircraftVisual](../../render/aircraft/AircraftVisual.ts) omits nominal voltage; [AircraftLights](../../render/aircraft/lights.ts) defaults to 28 V and clamps output to zero below 18 V.
Close with: passing the installation voltage into the light renderer and verifying powered night lighting.

## Developed spins — **missing feature**

A full-aft, full-rudder entry produces a spiral; developed spins and recovery are not represented.
Evidence: [aircraft limitations](../../../docs/aircraft.md).
Close with: a validated post-stall/spin model and aircraft-specific entry/recovery checks.

## Priming and alternate fuel-pump installation — **missing feature**

FUEL PRIME/high-speed pump behavior, flooded/hot starts and the optional altitude-compensating pump’s idle behavior are absent.
Evidence: [notModelled](index.ts) and [panel FUEL PRIME comment](panel.ts).
Close with: two-speed pump/start behavior and sourced optional-pump data.

## Trim indication — **missing feature**

The indicator displays switch command while the powered spring datum follows at 2°/s.
Evidence: [notModelled](index.ts) and [systems](systems.ts).
Close with: an indication driven by actual trim position and checks during travel and bus loss.

## Canopy and structural temperature — **missing feature**

Open/unlatched canopy effects and the 55°C structural-temperature limit are absent.
Evidence: [notModelled](index.ts).
Close with: canopy state/effects and a sourced temperature-limit model.

## Ground handling, rigging and engine assumptions — **estimate**

Caster friction/drag, leg stiffness, wing incidence, trim gearing, flap timing and alternate-air losses are not measured installation data.
Evidence: [gear](gear.ts) (60–70 kN/m mains), [geometry](geometry.ts), [systems](systems.ts) (6 s flaps), [powerplant](powerplant.ts) (15 K / 3% alternate-air losses).
Close with: caster/strut, rigging, actuator and engine measurements, then handling validation.

## Optional propeller and panel — **missing feature**

The optional MT propeller and G500 TXi panel are absent.
Evidence: [notModelled](index.ts).
Close with: sourced optional configurations and their presentation/performance checks.
