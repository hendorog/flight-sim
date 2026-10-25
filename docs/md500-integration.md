# MD 500E integration — feat/pc12-md500

This records the integration of the MD Helicopters MD 500E (`md500`, 369E, Rolls-Royce 250-C20B) on
`feat/pc12-md500`: the turboshaft stage and flight model (T2), the sound (A1), the exterior (M2) and the panel (M3),
merged in plan §7's order. **Available in the chooser since 17 October 2026 (owner decision), with the open items below.** It is a flight-model and integration record,
not a release sign-off: the hover shots, the heliHold probe, the build check and the reviews of plan §8 steps 5-9 were
not run in this pass (see the end). The turboshaft model itself is described in [turboshaft-model.md](turboshaft-model.md),
the flight model in [md500-flight-model.md](md500-flight-model.md), T2's contract notes in
[md500-integration-notes.md](md500-integration-notes.md).

Source tags: **P** = primary (MD 500E RFM CSP-E-1, EASA TCDS / IM.E.052 for the engine); **F** = OH-6A flight-test /
derivative data (Heffley et al.), a related but different aircraft; **M** = manufacturer marketing figure; DERIVED =
arithmetic on sourced values; ESTIMATE = no source, an AGENT choice. Every choice not in `owner-notes.md` is an AGENT
choice.

## The output stage (owner decision 4)

The 250-C20B is a free power turbine on the engine output shaft (gearRatio 1, 6016 rpm = 100 % N2) driving the main
transmission (engine ratio 12.594) through a freewheel. The N2 governor (power-turbine governor) trims the gas
producer's Ng demand under the twist grip's schedule, with collective anticipation and a beep switch
(`ControlInputs.n2Beep`, ; / '). The twist grip: CUTOFF below 0.05, GROUND IDLE 0.18 (F1 stops there), FULL OPEN 1;
Shift+F1 to CUTOFF. Below full open the governor is in manual mode.

## Measured (T2's acceptance, `tests/rotorcraft/md500*.test.ts`, re-run green at integration)

| Item | Measured | Target | Source |
| --- | ---: | --- | --- |
| HIGE 3000 lb, ISA / ISA+20 | 8428 / 5732 ft | 8450 / 5750 ± 400 | P RFM Fig 5-4 |
| HIGE 2600 lb ISA | 12 295 ft | 12 300 ± 400 | P Fig 5-4 |
| HOGE 2900 lb, ISA / ISA+20 | 6924 / 4131 ft | 6980 / 4200 ± 400 | P Fig 8-1 |
| HOGE 2600 lb ISA | 10 186 ft | 10 350 ± 400 | P Fig 8-1 |
| Autorotation Nr, collective full down, 2250 lb SL 60 KIAS | 484.7 rpm | 485 ± 5 | P RFM 4-25 |
| — weight / altitude slope | -11.2 rpm/100 lb, +7.4 rpm/1000 ft | -10 ± 3, +6.5 ± 2 | P |
| Vne Fig 2-6 tables, autorotation floor and cap | exact | exact | P |
| Vy (minimum power) | 64.9 KIAS | 62 ± 8 | P |
| Governor steady: set 103.0 % at flat pitch, then 87 psi climb | N2 103.76 % | 103.5-104.0 | P RFM 4-22 |
| Beep range at flat pitch, high / low | 104.4 / 97.7 % | 104-105 / ≤ 98 | P RFM 4-18 |
| Snap deceleration: N1 passes 65 % | 2.19 s, no flame-out | ≥ 2.0 s | P RFM 4-19 / 4-28 |
| Engine failure at 120 KIAS cruise (62.9 psi), collective held: horn 468 rpm / 410 rpm | 0.27 / 1.08 s | 0.15-0.35 / 0.7-1.2 s | P (sign, horn) / DERIVED |
| — nose after 0.5 s | 8.9° left | yaws left | P |
| — collective down 1 s after: Nr minimum / back in 410-523 | 408.5 rpm / 1.65 s | ≥ 380 / ≤ 3 s | DERIVED / ESTIMATE |
| Needles in autorotation, grip at idle: Nr vs N2 | 101.5 vs 95.7 % (split 5.8 %) | split > 5 % | P |
| Shutdown to CUTOFF: needles split, Nr lags; ENG OUT | 0.03-0.05 s; at N1 55 % | ≤ 2 s; 55 % | P RFM 4-26 |
| Start (OAT 15 °C): rotor turning / START released / TOT peak / idle N1 | 23.1 % / 58.5 % / 772 °C (0 s > 810) / 64.4 % | ≤ 25 / 58-60 / 650-810 / 64-65 | P |
| — XMSN pressure up after light-off | 26.8 s | ≤ 30 | P |
| Hover 3000 lb SL: torque IGE / OGE | 71.5 / 79.3 psi | 62-72 / 72-82 | DERIVED |
| — TOT / N1 IGE, OGE | 647 / 692 °C, 95.4 / 97.2 % | 620-720 °C | DERIVED |
| Hover IGE: pitch / pedal / roll | +2.5° / -0.26 / 3.7° left | +1..+5 / -0.20..-0.45 / 1-3 (ESTIMATE) | **roll fails, see below** |
| Ground idle N2 / ground attitude | 59.4 % / 4.70° nose up | 55-70 / 4.7 | ESTIMATE / P |
| Governor transients: 90.7 psi in 2 s, 1 s snatch, dump | N2 min 102.77 / 102.57 %, peak 105.3 % | ≥ 100.5 / ≥ 98.5 / ≤ 106 | ESTIMATE |
| Autorotation, grip FULL OPEN, Nr 509.7 rpm | N2 103.6 % (was 103.0), max 104.0 | ± 1, < 108 | ESTIMATE |
| Rate of descent, 60 KIAS, 3000 lb, Nr 490 | 1808 ft/min | 1600-2200 | ESTIMATE |
| Glide 80 vs 60 KIAS at 480 rpm | 4.4 vs 3.4 (1.28 ×) | ≥ 1.15 × | P (shape) |
| Max ROC at 87.2 psi, Vy: 3000 / 2600 lb | 1848 / 2355 ft/min | 1770 ± 20 % | M |
| Level speed at MCP 81.3 psi, 3000 lb | 139.3 KTAS | 130-135 ± 5 % | M |
| Cruise 120 KIAS: pitch (2700 lb) / cyclic forward of hover / fuel (3000 lb) | -3.4° / 0.22 / 193 lb/h | -2..-6 / ≤ 0.3 / 184 ± 15 % | ESTIMATE / M |
| Control power vs OH-6A, hover / 60 kt: roll accel, pitch accel | 82.3/82.8, 57.6/54.2 deg/s² | 84.3/82.7, 53.1/53.5 ± 30 % | F |
| — pitch rate at 0.5 s | 21.6 / 18.4 deg/s | 17.1 / 14.7 ± 30 % | F |
| Resume mid-hover: Nr / N1 step | 0.02 / 0.03 % | ≤ 0.2 % | AGENT |
| Engine: power at TOT 810 °C SL ISA / spec point | 320 kW / 770 °C | 313 kW / 790 °C | P EASA |

## Three handling gaps, held as expected failures

These are `it.fails('KNOWN ... GAP')` tests in `tests/rotorcraft/md500Performance.test.ts` and entries in
[src/aircraft/md500/KNOWN_ISSUES.md](../src/aircraft/md500/KNOWN_ISSUES.md). They were reported, not fitted: the OH-6A
references are F-tagged (a 4-blade aircraft with the earlier tail rotor; Heffley's derivatives include the OH-6A's
control-system flex).

| Gap | Measured | OH-6A (F) |
| --- | ---: | ---: |
| Yaw, 0.1 pedal step: initial acceleration, hover / 60 kt | 148 / 152 deg/s² | 54 / 56 |
| — yaw rate after 1 s, hover / 60 kt | 65.5 / 3.8 deg/s | 36.8 / 5.7 |
| Roll rate at 0.5 s per 0.1 lateral step, hover / 60 kt | 20.4 / 20.8 deg/s | 15.1 / 13.8 |
| Hover IGE roll at 3000 lb | 3.7° left | 1-3° (ESTIMATE; OH-6A 3.05° at 2550 lb) |

## Workarounds and estimates the owner should know

- **20 kW power-turbine loss** stands in for the low runaway speed of a lightly loaded free turbine (the core's fixed
  stall-torque law cannot produce it); it should come down to the gear train's 4-5 kW once the power-turbine
  characteristic depends on gas power (turbine-model.md hand-over 7). The extra loss costs fuel, not torque.
- **The horizontal stabiliser**: the aerodynamics read it leading edge up (+6.17°) with an inverted cambered section, the
  only reading that flies the cruise-attitude row (T2's sweep in md500-flight-model.md); the exterior draws it leading
  edge down 6.17° to the waterline (M2, from the TCDS's 9.17° to the mast normal less the 3° shaft tilt). The two
  disagree on the sign; KNOWN_ISSUES "Exterior and head drawing".
- **Tail-rotor height in the ground attitude**: RFM Fig 1-1 heights are in the 4.7° nose-up ground attitude. The tail hub
  sits at WL 51.4 in level body axes (2.0 ft tip clearance at 4.7°); the exterior's level-axis tip height is 0.988 m
  (0.605 m in the ground attitude, P 0.61 ± 0.05).
- Hinge offset 0.165 m, the ENGINE OUT low-rotor arming latch, the governor dynamics, the main-rotor blade data, the
  tail-rotor rpm (2933, ratio 5.96) and the skid dampers are ESTIMATES.
- 410 rpm / 80 KIAS best glide is reported, not asserted: the modelled rotor is at the retreating-blade stall boundary.

## What the integration changed

- `definitionInconsistencies(md500)` is empty (after M2 and M3 closed the eye, the hub and the ASI red line).
- A consistency rule: the sound's tail rotor (blades, diameter, ratio) is the definition's.
- Known-issues rows for the exterior, the panel and the sound (14 entries).
- Nothing in the md500 flight model was changed at integration.

## Not run in this pass (plan §8 steps 5-9)

The heliHold probe, the hover shot with its N1 / N2 / Nr / psi readout, every md500 shot of plan §10 (exterior, head,
rotor turning, cockpit, panels, view out), `npm run build` with `check-build.mjs`, the Codex review and the look
checks. The panel was verified against T2's state only through its unit fixtures and the dev mock, not in the running
sim. The full vitest suite was not run.
