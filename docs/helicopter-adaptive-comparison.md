# Helicopter hold: fixed gains vs matrix-pencil adaptation

Headless comparison on main 48337e7 (2026-10-16). Probe: `work/heliAdapt.test.ts` (git-excluded; copy to
`tests/tmp/` to run). It flies the production path: SimPhysics, `hoverScenario`, `autoflightOnReset`, and the
S269 manual-throttle pilot from `tests/rotorcraft/autopilot.test.ts`.

Matrix, for each of R22, R44 and S269:

- **Loading:** typical (solo) and max gross.
- **Weather:** calm (one run), and wind 8 kt from 270° with 3 kt gusts and turbulence 0.1. The turbulence
  seed is varied 1–3 by mocking `createWorldEnvironment`; SimPhysics always passes seed 1.
- **Case `hover`:** 60 s of position hold.
- **Case `seq`:** the documented 110 s sequence: 40 kt at 10 s, then +45° and +10 m at 40 s, then hover at
  70 s.
- **Modes:**
  - fixed gains;
  - adaptive (`HelicopterAutopilot.adaptive = true`);
  - two controls with the roll and pitch gain scale pinned at the adaptation limits, 0.8 and 1.2, for the
    whole flight.

That is 192 flights. None crashed or disconnected, and no actuator saturated.

## Result

Adaptation made no measurable difference to any tracking metric. Every gap between adaptive and fixed is far
inside the spread between turbulence seeds. The pinned runs show why: holding the gains at 0.8× or 1.2× for
the entire flight barely changes the tracking either. What changes is cyclic activity, by about ±20–30 %.
The roll and pitch inner loops are not what limits the hold. The outer speed, position and heading loops are.

Mean over seeds. In each cell the first value is fixed / adaptive (± the seed standard deviation of fixed)
and the bracket is [pinned 0.8, pinned 1.2]. Wind runs, max gross:

| | R22 | R44 | S269 |
|---|---|---|---|
| Hover position RMS, m | 2.01 / 2.01 ±0.08 [2.04, 1.98] | 1.92 / 1.92 ±0.10 [1.94, 1.90] | 2.03 / 2.03 ±0.05 [2.04, 2.02] |
| Hover altitude RMS, m | 0.554 / 0.554 ±0.02 | 0.462 / 0.462 ±0.02 | 0.87 / 0.87 ±0.07 |
| Hover heading RMS, ° | 1.36 / 1.36 ±0.12 | 1.07 / 1.07 ±0.09 | 1.02 / 1.02 ±0.09 |
| Hover lateral cyclic rate RMS, /s | 0.143 / 0.143 [0.115, 0.181] | 0.181 / 0.181 [0.131, 0.337] | 0.124 / 0.124 [0.099, 0.167] |
| Seq: speed overshoot on 40 kt, kt | 10.7 / 10.7 ±0.05 | 9.79 / 9.79 ±0.05 | 10.7 / 10.7 ±0.08 |
| Seq: speed settle (±2 kt), s | 27.8 / 27.8 ±0.17 | 29.2 / 29.2 ±0.12 | 28.1 / 28.2 ±0.31 |
| Seq: heading overshoot on 45°, ° | 8.1 / 8.1 ±0.67 | 6.89 / 6.89 ±0.39 | 5.62 / 5.63 ±0.52 |
| Seq: heading settle (±2°), s | 15.7 / 15.7 ±0.58 | 15.6 / 15.6 ±0.28 | 13.6 / 13.7 ±0.21 |
| Seq: altitude settle (±0.5 m), s | 15.6 / 15.6 ±5.8 | 20.1 / 20.1 ±5.0 | 22.3 / 22.3 ±3.8 |
| Seq: return to hover settle (±1 kt), s | 34.1 / 34.0 ±0.14 | 33.0 / 33.0 ±0.14 | 34.8 / 34.8 ±0.45 |

Typical loading and calm air show the same picture. The largest adaptive-minus-fixed difference anywhere is
an altitude settling time of 20.8 → 19.6 s (R22, typical, wind), against a seed spread of ±5.1 s.

## How often it adapted

The status is sampled once a second, for both identifiers. "Scale ≠ 1" is the share of time the roll or
pitch scale was off 1.

| Case | Scale ≠ 1 | Adapting | Awaiting excitation | Prediction rejected | Authority rejected | Other |
|---|---|---|---|---|---|---|
| Hover, calm | 0 % | 0 % | 87 % | 0 % | 0 % | 13 % collecting |
| Hover, wind | 9 % | 5 % | 34 % | 26 % | 20 % | collecting, unresolved |
| Sequence, calm | 58 % | 28 % | 35 % | 14 % | 4 % | 12 % unresolved |
| Sequence, wind | 71 % | 32 % | 7 % | 38 % | 11 % | collecting, unresolved |

During the sequences the scale did use its whole range, 0.8 to 1.2. In hover it stayed within 0.98–1.06.
So the identifier does work when manoeuvres excite it. Its output just has no lever on the result.

## Observations outside the adaptation question

The baseline outer loops are the weak spot.

- **Speed:** a 0 → 40 kt demand overshoots by 10–12 kt (25–30 %) and takes 26–29 s to settle within 2 kt.
- **Heading:** a 45° change overshoots by 4–8°.
- **Return to hover:** stopping from 40 kt takes about 33 s.

Tuning the speed and heading loops, for example with a rate-limited speed reference or more damping, would
improve tracking far more than any roll or pitch gain adaptation can.

## Fixed wing

There is no case for porting this to the fixed-wing autopilot.

- **No lever:** the helicopter result shows the bounded gain scaling cannot change tracking.
- **Already scheduled:** the fixed-wing loops already schedule their gains with dynamic pressure, which is the
  main source of plant variation there.
- **Wrong target:** the one fixed-wing defect found, rudder hunting in turbulence, was a gain too high for
  turbulence. That is not something the identifier measures.
