# MD 500E: T2 integration notes

What package T2 (turboshaft stage and the MD 500E flight model) changed in shared contracts, what the other packages
read from it, and what is left for the integrator. Branch `pcmd/t2`, cut from the scaffold `84d3859`.

## Shared contract changes (all additive; legacy types byte-identical)

| Where | Change | Who reads it |
| --- | --- | --- |
| `physics/rotorcraft/definition.ts` | `RotorcraftDefinition.shaftTilt?` (rad, forward); `skids.frontZ?`; `TurboshaftControlDef.governor.datumNg?`; `RotorcraftState.turboshaft.lowRotorArmed?` (optional); `cyclicAngles(def, controls)` helper (rad, `aft` / `right`) | M2 (visual blade pitch and disc tilt), M3 (state) |
| `physics/rotorcraft/limits.ts` | `SpeedPlacard.temperatures?` (non-uniform OAT axis), `massBands?`; `SpeedCorrections.powerOffFloor?`, `powerOffCap?`; `placardVne(..., mass?)`, `placardBand()` | panel Vne (M3) through `RotorcraftState.vneKias` |
| `physics/rotorcraft/rotorcraft.ts` | `Rotorcraft.turboshaft` (`TurboshaftControl` or null); the `'freewheel'` drive path; shaft frame; asymmetric cyclic | flightModel |
| `physics/rotorcraft/turboshaft.ts` (new) | `TurboshaftControl.stepTurboshaft(dt, c, engine, out, busVolts)` (the S0 contract), `publish()`, `gripPosition()`, `plaNg()`, `emptyTurboshaftState()`, `TURBOSHAFT_BUS_VOLTS`, `REIGNITION_ARM_PSI` | flightModel; M3 may reuse `gripPosition` for the HUD |
| `physics/flightModel.ts` | turboshaft call in place of `throttle()`; steady-engine reset trim; cyclic neutral on the ground for `cyclicLimits` types | — |
| `sim/resume.ts` | articulated blade count per type (s269 3, md500 5); `rotor.turboshaft` validated field by field; `controls.reverse` ∈ [0, 1]; `n2Beep` forced to 0 | all |

## md500 data files other packages read (changed since the scaffold)

- `dimensions.ts`: **`FLAP_HINGE_OFFSET` / `LAG_HINGE_OFFSET` 0.165 m** (was 0.140: the 500D hub's extra inch, S);
  **`TAIL_HUB.z` at WL 51.4** (the RFM's tip clearance is in the 4.7° ground attitude); new `GROUND_ATTITUDE_DEG`,
  **`SKID_FRONT_Z`** (front skid contacts 0.087 m lower than `SKID_Z`: the skid tubes slope, the deck sits 4.7°
  nose up). M2: the skid tubes, the tail-rotor hub and the hub fairing follow these.
- `facts.ts`: new `MD500_TWIST_GRIP` (CUTOFF < 0.05, GROUND IDLE 0.18, FULL OPEN 1), `MD500_N2_BEEP`
  (97.5–104.5 %, default 103 %), `MD500_XMSN_PRESS_SWITCH_PSI` (5 psi). T1b binds the grip keys to these; M3 the
  XMSN OIL PRESS light.
- `rotorcraft.ts`: `MD500_ROTORCRAFT` is final (the visual imports it, so `rotor geometry and dynamics` stays equal).
  `cyclicLimit` (the legacy symmetric field) is the mean half-travel; renderers should use `cyclicAngles()`.
- `powerplant.ts`: `ALLISON_250_C20B` (N1 `referenceRpm` 50 970; `ratedPower` = `MD500_ENGINE_RATED_W`).
- `index.ts`: `controlDefaults.magnetos 0`, `throttle 0` (grip CUTOFF), input `twistGrip`, `n2Beep`, `springTrim`.

## Contract requests

- **T1a (turbine core):** a power-dependent power-turbine characteristic in `TurbineDef.powerTurbine` (stall-torque
  ratio or runaway speed as a function of gas power). Why: the unloaded PT's runaway speed at idle; today the MD 500
  carries a 20 kW loss instead of 4–5 kW (`docs/turboshaft-model.md` §5).
- **T1b (input):** grip keys on `MD500_TWIST_GRIP`; F1 stops at GROUND IDLE (0.18), Shift+F1 CUTOFF (0); beep keys to
  `ControlInputs.n2Beep` (momentary). The flight model does not read `c.mixture` on a turboshaft (the grip is the fuel
  shut-off); the FUEL VALVE is the fuel selector (`fuelSelectorCycle ['on', 'off']`).
- **M2 (exterior):** `exteriorRotor` / blade pose from `cyclicAngles()` instead of `cyclicLimit`; the mast drawn 3°
  forward (`SHAFT_TILT_DEG`); the dimension changes above; `visual.ts` pilot eye at `PILOT_EYE`.
- **M3 (panel/UI):** RE-IGN P RST reset is `ControlInputs.lampTestId = 'reign'` (press); `RotorcraftState.turboshaft`
  carries the gauges (`n2Pct`, `nrPct`, `torquePsi`, `needlesSplit`, the lights); `lowRotorArmed` is optional. ASI
  red line = `reference.vne` 152.
- **A1 (audio):** `engines[0].engine.ratedPowerW = MD500_ENGINE_RATED_W` and `combustion: 'turbine'` (consistency).

## Consistency list in this worktree (`definitionInconsistencies(md500)`)

Every remaining item belongs to a package not merged here:

```
md500: pilot's eye (x/y/z): geometry (0.7531, -0.3302, -0.5322), visual (S269 stub)    -> M2
md500: rated power: powerplant 313000, audio 134226                                     -> A1
md500: engine is a gas turbine: powerplant true, audio false                            -> A1
md500: airspeed red line: reference 152, panel 94                                       -> M3
```

Every other type: zero inconsistencies (the consistency test passes for all of them).

## Guards run (plan §9, T2)

`tests/rotorcraft/s269Legacy.test.ts`, `contactAirborne.test.ts` (exact digests unchanged), `systems.test.ts`,
`tests/aircraft/r44Setup.test.ts`, `s269Flights`, `r44Flights`, `flights`, `demo`, `trim`, `tests/sim/scenario-spawns`,
`tests/sim/resume`, `tests/fdm/flightModel`, plus `tests/aircraft/{consistency,contract,importOrder}`: all pass except
the md500 consistency row (the list above). New: `tests/rotorcraft/md500Systems.test.ts` (18),
`md500Performance.test.ts` (12 + 3 expected `KNOWN ... GAP` failures), `tests/aircraft/md500Physics.test.ts` (11).
