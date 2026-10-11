# Schweizer 269C-1 / 300CB: known issues

See also the [cross-aircraft issues](../../../docs/known-issues.md#cross-aircraft-issues). Entries are ordered by pilot impact.

## Autorotation flare and landing — **unvalidated**

A complete slow, level, descending autorotation landing without tail contact is not accepted.
Evidence: [flight-model landing attempts](../../../docs/s269-flight-model.md): original gross attempt 21.10 kt, solo stinger impact; two `KNOWN FLARE GAP` [expected failures](../../../tests/rotorcraft/s269Flights.test.ts) remain after integration.
Close with: both gross/solo landings below 10 kt, within 390–504 rotor RPM, with validated flare/level timing and tail clearance.

## Hot/high IGE hover ceiling — **defect**

The leaned 1600 lb / 80°F IGE ceiling is ~6305 ft versus ~4300 ft in the RFM; the cause remains unresolved.
Evidence: [round-2 power audit](../../../docs/s269-round2.md) and [integration ceiling table](../../../docs/s269-integration.md#hover-ceiling-remains-unacceptable); [performance tests](../../../tests/rotorcraft/s269Performance.test.ts) record roots without asserting chart agreement.
Close with: installed HO-360-C1A power-available/MAP/fuel-flow data, fan/drivetrain loss maps and rotor/wake evidence; no single cause is established.

## Coupled lead-lag and ground resonance — **missing feature**

Production lag remains zero. Coupled lag was rejected after instability near 190–230 rotor RPM with assumed damper/support values; oleo gas/poppet dynamics are absent.
Evidence: [round-2 lag audit](../../../docs/s269-round2.md#lead-lag-why-the-rejected-experiment-is-still-unsuitable).
Close with: a full body/blade kinetic model, measured damper/oleo support data and healthy/degraded startup, shutdown and impact validation.

## Development status and handling validation — **unvalidated**

This is an in-development reduced harmonic rotor model. CB OGE predictions, asymmetric cyclic stops, rigging/phase, manual throttle correlation and engine cooling/fuel flow lack independent validation.
Evidence: [registry](../registry.ts), [definition](index.ts), [round-2 report](../../../docs/s269-round2.md): the RFM has no carburetted CB OGE chart.
Close with: CB-specific flight/installed-power data and measured rigging, blade/body inertia and throttle response.

## Mouse cyclic in wind — **unvalidated**

Calm scripted hover does not establish human hover usability in wind or gusts.
Evidence: [mouse cyclic tests](../../../tests/rotorcraft/mouse.test.ts): `20-second scripted mouse hover` uses calm flatEnvironment.
Close with: human wind/gust hover trials, including manual throttle, with drift and workload measurements.

## Checklists and training — **missing feature**

There is no checklist content, validated startup checklist, lesson syllabus or demonstration.
Evidence: [training](training.ts) contains empty checklist slots; [definition](index.ts).
Close with: RFM-sourced procedures and validated startup/flight sequences before publishing guidance.

## Coning parameters — **estimate**

Blade mass, hinge geometry and the droop stop are unmeasured; pose stop reactions do not feed back into flight dynamics.
Evidence: [coning source table](../../../docs/s269-sources.md#physical-coning-and-droop-stop-pose-s269coning): 15 kg blades, −2° stop; [integration limits](../../../docs/rotor-coning.md#integration-and-limits).
Close with: blade mass/hinge/stop measurements and validation of coupled stop reactions.

## Elastic blade sag — **missing feature**

The blades remain rigid spans on their droop stops; no elastic sag is represented.
Evidence: [coning integration](../../../docs/rotor-coning.md#integration-and-limits): 269 flapwise EI is unspecified.
Close with: 269-specific EI/mass data and an elastic model checked against stopped and running blade shapes.

## Spring trim and transmission systems — **estimate**

Electric trim motor rate/force and transmission pump/thermal behavior use assumed values.
Evidence: [integration](../../../docs/s269-integration.md#connected-behavior): 0.04/s normalized trim rate, 40 N full-deflection spring force; chip indication has no automatic wear/failure generator.
Close with: measured actuator forces/rates, pump/cooling maps and a validated sensor/failure model.

## Geometry and moving hardware — **estimate**

Oleo mounts, hinge sequence, control phasing and tail rotation sense lack dimensioned confirmation; oleos are visually static.
Evidence: [exterior limitations](../../../docs/s269-exterior.md) and [integration geometry](../../../docs/s269-integration.md#tail-geometry-and-contact).
Close with: HMI/IPC dimensions/rotation drawings and a suspension-state contract for stroke animation.

## Cockpit correction on hardware GPU — **unvalidated**

The corrected window/frame geometry was inspected only with software Vulkan; default-high hardware-GPU acceptance is outstanding.
Evidence: [round-2 visual evidence](../../../docs/s269-round2.md): the adjacent oval is identified as a ventilation ring, so its identity is no longer an open issue.
Close with: hardware-GPU/default-high cockpit checks, including side, roof and night views.
