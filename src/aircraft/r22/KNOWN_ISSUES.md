# Robinson R22 Beta II: known issues

See also the [cross-aircraft issues](../../../docs/known-issues.md#cross-aircraft-issues). Entries are ordered by pilot impact.

## Autorotation flare and landing — **unvalidated**

A progressive ~40 ft flare, no climb, <10 kt touchdown and forward cyclic before skid contact have not been validated together on grass/asphalt. Early excess lift remains an owner suspicion, not an established cause.
Evidence: [Round 5](../../../docs/r22-flight-model.md#round-5-40-ft-flare-investigation--unresolved): retained 60 ft pilot loses RPM; 40 ft trials touch at 48–50 kt. Two gross/solo `KNOWN RPM GAP` [expected failures](../../../tests/rotorcraft/flights.test.ts) remain.
Close with: measured transient pitch/thrust/RPM evidence and passing both landings within 90–110% NR, including slide and tail clearance.

## Mouse cyclic in wind — **unvalidated**

Hover usability with wind, gusts and a human pilot has not been established.
Evidence: [mouse cyclic tests](../../../tests/rotorcraft/mouse.test.ts): `20-second scripted mouse hover` uses calm flatEnvironment; [remaining work](../../../docs/r22-flight-model.md#remaining-work).
Close with: human mouse-hover trials in steady wind and gusts, with recorded drift and workload.

## Performance and handling validation — **unvalidated**

Hover-chart residuals, maximum glide, climb curves, hover attitude/CG and transient handling still need independent validation.
Evidence: [remaining work](../../../docs/r22-flight-model.md#remaining-work) identifies missing induction/fuel, fan, rotor-loss, inertia and weight-and-balance evidence.
Close with: installation measurements, a specific aircraft’s loading sheet and flight-test comparisons.

## Rotor and skid parameters — **estimate**

Rotor inertia, polar/response parameters, teeter/contact limits and surface friction are engineering assumptions.
Evidence: [rotorcraft](rotorcraft.ts): main inertia 146 kg m², longitudinal sliding friction 0.2 grass / 0.3 runway; [model notes](../../../docs/r22-flight-model.md).
Close with: blade mass/polars, transient response, steel-shoe friction and structural contact measurements.

## Coning and blade droop — **estimate**

Blade bending stiffness and droop stops are unmeasured; the quasi-static visual model is not precise hover-coning validation.
Evidence: [coning parameters](../../../docs/rotor-coning.md#shared-balance-and-parameters): 12 kg/blade, −1° stop, EI 3600 N m².
Close with: measured blade mass distribution, hinge/stop dimensions and flapwise stiffness/coning curves.

## Rotor and ground-contact fidelity — **missing feature**

Free wake/LTE, elastic blade dynamics, dynamic-stall hysteresis and ground resonance are unresolved; terrain snagging and blade/tailcone collision are absent.
Evidence: [remaining work](../../../docs/r22-flight-model.md#remaining-work) and [model notes](../../../docs/r22-flight-model.md).
Close with: the missing coupled dynamics/contact models and validation of VRS recovery, sideward/rearward flight and retreating-blade stall.

## Demonstrations differ from POH procedures — **unvalidated**

The scripts use flight RPM during warm-up and 60 KIAS climb versus sea-level Vy 53 KIAS, alongside the open flare limitation.
Evidence: [demo checklist notes](../../../docs/checklists-and-captions.md).
Close with: procedure-aligned scripts and pilot review; retain disclosure until validated.
