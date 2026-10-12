# Helicopter adaptive-control experiment: identification stage

The simulator's existing autopilot is a fixed-wing controller. This experiment
starts a separate path toward helicopter attitude/heading/altitude hold, followed
by online identification and bounded controller adaptation. It does not engage
an autopilot, change the UI, or retune any gains yet.

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

## Next stages

1. Build and validate a dedicated helicopter baseline attitude/rate controller
   with heading on pedals and altitude/vertical speed on collective. Preserve
   governor operation and manual takeover; start with airborne hover only.
2. Record commanded cyclic/pedals/collective and measured motion. Estimate an
   input-output impulse response before applying MPM; compare against RLS on
   identical data and noise, including cross-axis behavior.
3. Test held-out multi-step predictions, pulse amplitude/window sensitivity,
   changing loading/airspeed and disturbances. Cover R44 and S269 separately.
4. Enable opt-in bounded, gradual gain updates only after excitation, prediction,
   control-authority and closed-loop robustness checks. Maintain baseline
   fallback and bumpless transitions; do not interpret fit quality as stability.
5. Compare fixed baseline, RLS adaptation and MPM-assisted adaptation on the same
   scenarios using tracking RMS, peak attitude error, settling time, control
   saturation, rotor-RPM excursions and crashes. Consider MPC after identification
   has demonstrated a measurable advantage.
