# Flyable helicopter hold and adaptive-control experiment

The R22, R44 and Schweizer 269 now have an opt-in helicopter hold controller.
It uses ordinary cyclic, pedals and collective; it does not inject forces or
write flight-model state. The fixed-wing autopilot remains separate.

## Fly it

Check out `experiment/helicopter-matrix-pencil`, then run `npm ci` and `npm run dev`.
Open the dev server's URL with:

```text
/index.html?aircraft=r22&hover=1&ap=1&resume=0
```

Use `aircraft=r44` or `aircraft=s269` for the other helicopters. `hover=1` starts
15 m above the runway with a running, trimmed aircraft; `ap=1` engages hold.
The start retains your configured weather. For the first flight, use calm weather
and 1x simulation rate. The Flight menu also has **Start helicopter hover test**.

- **A** engages/disconnects. Engaging airborne captures heading, altitude and
  current forward speed; below 3 m/s ground speed it selects position hold.
- **Escape → Flight → Autopilot** sets heading, altitude MSL in feet, and forward
  speed in knots. Speed 0 selects hover and captures position when returning from
  cruise. Try 40 kt, a 45° heading change, a small climb, then 0 kt.
- **T / Shift+T** adjusts altitude by ±100 ft, as on the fixed-wing autopilot.
- Cyclic, pedals or collective keys/axis movement disconnects hold. Idle hardware
  does not overwrite the held controls. Camera controls remain available.
- Throttle and governor switches remain with the pilot. R22/R44 use their installed
  governor when enabled. **S269 has no installed governor: manage its throttle
  manually as collective/speed change.** Hold disconnects on low/high rotor RPM,
  engine failure, ground contact, crash or excessive attitude.
- Helicopter hold is deliberately not saved as engaged across reloads. A resumed
  normal flight requires A to reengage; the explicit hover-test URL starts fresh.

This is hold, not automatic takeoff, approach or landing. Forward-speed hold uses
signed body-axis ground velocity; it is not an indicated-airspeed controller.
Hover holds a world position using limited body-axis velocity demands. Heading
commands slew at 8°/s; altitude capture is limited to ±1.5 m/s. Inner controls
are rate-limited and integrators stop winding farther into actuator saturation.

## Online experiment

**Experimental adaptation** in the Flight menu is off by default. Roll and pitch
identifiers record actual control inputs and angular rates at 20 Hz, maintaining
8-second windows and fitting once per second. The front end fits ARX(2,2) with an
offset, then applies the rank-two Matrix Pencil estimator to its synthesized
impulse response. It does not mistake raw forced/closed-loop output for plant
free response. There is no injected probing/dither.

Model acceptance requires actuator variation, observable rate variation,
nondegenerate regressors, an unsaturated actuator, a held-out one-step prediction
error below 15% of held-out rate standard deviation, resolved decaying poles and
positive short-horizon response. Accepted response authority relative to the
first accepted model scales proportional/rate gains by 0.8–1.2, moving at no
more than 0.02 scale units per second. Turning adaptation off, or a rejected fit,
smoothly returns gains toward baseline. Integrator gains and collective/yaw
loops are not adapted. The menu reports collecting, observing, adapting or a
rejection reason. Quiet trimmed flight often reports **awaiting excitation**;
that is expected.

This remains a heuristic, bounded adaptation experiment, not a proof of
closed-loop stability or an established improvement over PID/RLS. SISO models
can be biased by cross-axis dynamics, disturbances and feedback-correlated noise.
The Matrix Pencil step extracts modes from an already fitted low-order model;
it adds no independent identification information. Long-horizon prediction,
MIMO identification, RLS comparison and robustness analysis remain future work.

## Validation

Tests exercise maximum-gross hover and 60 kt cruise for all three helicopters,
small altitude/heading captures, engine/RPM engagement/disconnect conditions,
and the production SimPhysics engagement path. A 110 s flight goes from the
15 m hover start to 40 kt, turns 45°, climbs 10 m and returns to hover with
adaptation enabled. The S269 test includes an independent manual-throttle pilot.
A further R22 test holds position in 8 kt crosswind with 3 kt gusts. Input tests
cover collective/cyclic/pedal takeover and idle hardware authority. Synthetic
online identification tests verify known poles, changed control authority,
rate/magnitude bounds, unexcited data and irregular sample rejection.

The wider regression run passed 319 checks across flight controls, input, UI,
resume and aircraft setup. Four airborne-contact hash checks failed identically
on untouched main (4b57c44); they are not introduced by this branch. TypeScript
checking and the production build pass.

The shared simulator runs in node, using the same physics/control paths as the
browser. Browser screenshot verification was unavailable in this environment:
Chrome was absent and its download failed. The visual menu layout still needs a
browser smoke check. No claim of flight-test validation is made.

## Original free-response experiment

Run the repeatable first experiment:

```sh
npm ci
npm run test -- tests/rotorcraft/matrixPencil.test.ts --silent=false
```

## What is implemented

`src/physics/identification/matrixPencil.ts` estimates a rank-two real-data
matrix pencil. It forms shifted Hankel matrices H0 and H1, retains the two
leading left singular vectors U via a symmetric covariance eigensolve, and
finds the eigenvalues of `(Uᵀ H1 H0ᵀ U) diag(sigma²)⁻¹`. It reports discrete
poles and principal-log continuous poles (s⁻¹), retained Hankel energy,
second/first singular-value ratio, and a normalized two-step recurrence error.
It rejects nonfinite/short records, invalid sample intervals, zero responses
and poorly resolved second modes. No stability filtering hides growing modes.

Synthetic checks cover two real poles, a damped oscillation with deterministic
noise, and invalid or unidentifiable data. Simulator checks run two independent
R22 flight models at each operating point with the same constant trimmed pilot
controls. One receives a 0.01 right-cyclic pulse for 0.1 s. After release,
roll-rate differences are sampled at 60 Hz for two seconds. This paired
trajectory subtraction removes much of the baseline trim drift without using
internal force, inertia or rotor-state channels in the estimator. The governor
remains as configured by the simulator trim; these are local aircraft-plus-
governor response estimates, not an isolated ungoverned rotor plant.

Initial results on commit ff242fb1b63f62d1c4c7b6922de1feb63b1a4d87:

| Operating point | Estimated local roll poles, s⁻¹ | Retained energy | Recurrence error |
| --- | --- | --- | --- |
| Hover, maximum gross | -5.070 ± j3.598 | 99.970% | 0.00418 |
| 65 KIAS, maximum gross | -6.475, -7.265 | 99.998% | 0.000746 |
| 65 KIAS, solo loading | -4.061, -9.496 | 99.998% | 0.000715 |

These are descriptive low-order fits to the simulation, not validated physical
pole measurements. `usable` in the printed report means only >99% retained
energy and <0.02 recurrence error. It is not statistical confidence, a full
prediction validation, or permission to adapt. The tests assert finite,
nontrivial, bounded, crash-free pulse trajectories, not these exact pole values.

## Limits before adaptation

- Output-only MPM requires a free response or an identified impulse response.
  Feeding it ordinary autopilot output would mix forcing and feedback dynamics.
- Plant residues, gain, zeros, delays and cross-axis coupling are still missing.
  Good poles alone do not determine controller gains.
- Two modes are a deliberately small starting model. Covariance formation
  squares the singular-value condition number; a production implementation
  should use direct SVD, order selection and multiple window lengths.
- Principal-log frequencies are limited by Nyquist. The pulse duration, record
  length and sample rate need sensitivity checks for weak or slow modes.
- Paired simulation trajectories cannot be recorded in live flight. An online
  version needs known actuator inputs and an input-output estimator, sufficient
  excitation, and closed-loop bias handling.
- Three separately initialized operating points demonstrate sensitivity to
  conditions. They do not demonstrate tracking changes during one flight.

## Remaining research

1. Compare fixed baseline, RLS adaptation and MPM-assisted adaptation on identical
   changing-loading/airspeed and disturbance scenarios. Report tracking RMS,
   overshoot, settling time, control saturation, rotor-RPM excursions and crashes.
2. Add held-out multi-step prediction, window/order sensitivity and MIMO models.
3. Evaluate stronger robustness checks and MPC only after the identification and
   adaptive-control comparison demonstrate a measurable advantage.
