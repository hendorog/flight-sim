# Robinson R44 Raven II: known issues

See also the [cross-aircraft issues](../../../docs/known-issues.md#cross-aircraft-issues). Entries are ordered by pilot impact.

## Autorotation flare and landing — **unvalidated**

The requested progressive ~40 ft flare, no climb, <10 kt contact, forward cyclic before touchdown and grass/asphalt slide need validation. Excess early lift is a suspicion, not a diagnosed cause.
Evidence: [integration comparison](../../../docs/r44-integration.md#numerical-comparison): touchdown NR ~87.15% gross / 79.08% solo, gross peak 109.42%; two `KNOWN FLARE GAP` [expected failures](../../../tests/rotorcraft/r44Flights.test.ts).
Close with: measured transient response and both gross/solo landings within 90–108% NR, with tail clearance and controlled slide.

## Hot/gross hover performance — **unvalidated**

Hover ceilings remain optimistic and the flight model is not flight-test validated.
Evidence: [integration comparison](../../../docs/r44-integration.md#numerical-comparison): 2500 lb / 40°C OGE ~2693 ft versus traced ~1000 ft; [model](../../../docs/r44-flight-model.md).
Close with: installed power, rotor-loss and hover measurements across weight/OAT, then reconcile residuals.

## Mouse cyclic in wind — **unvalidated**

Only calm scripted mouse hover is checked; windy human hover usability is open.
Evidence: [mouse cyclic tests](../../../tests/rotorcraft/mouse.test.ts): `20-second scripted mouse hover` uses calm flatEnvironment.
Close with: human trials in steady wind/gusts with drift and workload measurements.

## Starting and engine cooling — **unvalidated**

Exact closed-throttle/hot starts are unfinished; cooling uses fixed fan flow without a speed-dependent shaft-power model.
Evidence: [integration remaining gaps](../../../docs/r44-integration.md), [flight-model follow-up](../../../docs/r44-flight-model.md#coordinated-follow-up-required), [checklist](checklists.ts): start currently needs ~10% grip.
Close with: validated POH starting sequences and measured fan torque, thermal and fuel-flow maps.

## Interconnected fuel tanks — **missing feature**

Withdrawal is split across selected tanks instead of transferring from the higher auxiliary tank before the main empties.
Evidence: [integration, deferred tanks](../../../docs/r44-integration.md#result-and-sources).
Close with: fuel height/volume curves, line geometry and a head/flow model with depletion-order checks.

## Hydraulics, control stops and rotor brake — **missing feature**

Hydraulic failures, forces and switch behavior are absent; cyclic stops are symmetric and rotor braking is not simulated.
Evidence: [definition](index.ts), [model](../../../docs/r44-flight-model.md), [checklists](checklists.ts).
Close with: servo/linkage data, asymmetric stops and rotor-brake dynamics with operational checks.

## Warning sensors — **missing feature**

MR TEMP, MR CHIP, TR CHIP, CO, BRAKE, ENGINE FIRE and FUEL FILTER illuminate only in lamp tests.
Evidence: [current panel lamp bindings](panel.ts) and [integration gaps](../../../docs/r44-integration.md).
Close with: independent sensor/failure states and warning-circuit tests; AUX FUEL PUMP is already connected.

## Inertia, aerodynamics and system calibration — **estimate**

Blade/body inertia, polars, governor/clutch response, fuel-pressure switches and thermal parameters lack measured installation data.
Evidence: [flight model](../../../docs/r44-flight-model.md): main inertia 450 kg m² and assumed 21 kg blades; [integration](../../../docs/r44-integration.md) lists pump/switch estimates.
Close with: measured mass distribution, airfoil/rigging and system response data, then handling/power calibration.

## Coning and blade droop — **estimate**

Blade stiffness, hinge offsets and droop stops are unmeasured.
Evidence: [coning parameters](../../../docs/rotor-coning.md#shared-balance-and-parameters): −1° stop, EI 12000 N m², 21 kg/blade.
Close with: measured stop/hinge dimensions, mass distribution, EI and coning/sag curves.

## ASI position error — **unvalidated**

The POH position-error correction has not been transcribed; the model uses an empty calibration table.
Evidence: [flight-model follow-up](../../../docs/r44-flight-model.md#coordinated-follow-up-required), [airData](index.ts).
Close with: the applicable POH IAS/CAS curve and indication checks at low and cruise speeds.

## Cockpit and lighting approximations — **missing feature**

The shelf/pedestal share a single plane, PANEL/RADIO dimmers are coupled, and placards/flood lighting are unlit.
Evidence: [integration presentation limits](../../../docs/r44-integration.md); small placards require cockpit zoom.
Close with: separate geometry/circuits and sourced lighting/layout validation.
