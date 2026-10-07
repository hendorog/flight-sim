# Frozen rigs of the golden tests

The golden records (`tests/golden/*.golden.test.ts`) are built with the functions in this directory and with
nothing from the component test directories. They are copies, taken on 2026-10-05 from the untouched tree, of
the helpers the goldens used to import:

| file here | copied from | names |
|---|---|---|
| `aero.ts` | `tests/aero/helpers.ts` | `Condition`, `neutralSurfaces`, `makeInput` |
| `gear.ts` | `tests/gear/rig.ts` | `DT`, `MASS`, `planeEnvironment`, `ExternalLoad`, `GearRig` |
| `propulsion.ts` | `tests/propulsion/helpers.ts` | `DT`, `isa`, `Condition`, `makeInput`, `run`, `runningSystem` |
| `fdm.ts` | `tests/fdm/helpers.ts` | `FRAME`, `ELEVATION`, `LOADING`, `calmWeather`, `flatEnvironment`, `Rig`, `makeRig`, `resetTo`, `at` |
| `workletHost.ts` | `tests/audio/workletHost.ts` | `SR`, `BLOCK`, `SynthHost` |
| `typeFdm.ts` | `tests/fdm/helpers.ts`, its definition branch (2026-10-07, wave D1) | `TypeRig`, `makeTypeRig`, `resetTypeTo` |

Why: the owners of those helpers generalise them for other aircraft types. A changed default in a helper would
move a golden for a reason that is not the component under test, and a red golden could be made green by
editing the rig instead of the code.

Rules:

- Nobody but the lead edits `tests/golden/**`.
- These files import only from `src/`, and only names that exist in the untouched tree with their present call
  signatures (contract 4.0.5). If one of them stops compiling, the change that broke it removed or reshaped
  an export it had promised to keep: fix that change, not this directory.
- A rig is not "improved": its integrator, its defaults (1050 kg, 72 kg per tank, ISA constants, 1/240 s,
  1/60 s) are part of the recorded numbers.
