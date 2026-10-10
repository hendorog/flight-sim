# In-flight checklists and visual guidance

F or **Menu → Flight → Open aircraft checklist** opens the aircraft reference panel in any camera view. It is available during free flight, lessons and R22 demonstrations. Normal and emergency tabs have a section selector, previous/next buttons and a reset button. The first unfinished item is highlighted; a demonstration link instead highlights its referenced item.

**AUTO** means the mark follows current simulator state, including becoming unchecked if the state changes. **HAND** means a pilot confirmation. Clicking either kind overrides it until Reset all; manual unticks are respected. Reset restores automatic checks and clears manual marks across all sections. Progress lasts for this session and is cleared by a scenario reset; it is not saved on reload. Reference-panel marks do not acknowledge or grade Flight School tasks and never operate controls.

The existing airplane school lists are reused. Additional per-type data supplies preflight, cruise/descent, fire and electrical procedures, with climb or engine-failure context where the old lists only contained after-takeoff checks or restart touch drills. The added lists carry POH links; the reused lists retain their existing POH / school wording and lesson predicates. `live` in `training/checklistData.ts` is an optional, separately audited reference-panel predicate and does not change legacy lesson scoring.

## Sources and scope

Sources were retrieved/read on 11 October 2026. Page references in the panel are the manuals' printed page numbers. These are condensed simulator references, not complete walk-around inspections or replacements for aircraft-specific approved manuals, supplements and placards.

| Aircraft | Source | Additions |
| --- | --- | --- |
| C172S | [Cessna 172S POH](https://befa.org/wp-content/uploads/2019/12/POH-Cessna-172S.pdf), sections 3 and 4 | Preflight summary; climb, cruise, descent; engine-failure context; start/engine/electrical fire and low voltage |
| C152 | [1978 Cessna 152 POH](https://www.aeroelectric.com/Reference_Docs/Cessna/cessna-poh/C152-1978-POH-scanned.pdf), sections 3 and 4 | Same lifecycle gaps; arrival preparation uses the before-landing checks, with descent planning labelled as planning |
| PA-38-112 | [Piper Tomahawk POH](https://xplorepilots.com/descargas/aviones/PA38/PA38_POH.pdf), sections 3 and 4 | Preflight, cruise/arrival, power-off landing context, fire and alternator failure; distinguishes final speed with/without flow strips |
| DA20-C1 | [Diamond AFM Rev 29](https://salt.aero/wp-content/uploads/2021/11/DA202-C1-AFM-Rev-29.pdf), sections 3 and 4 | Preflight, cruise/descent, engine-failure context, fire and generator failure |
| PA-34-200 | [Piper Seneca POH VB-563](https://www.aeroelectric.com/Reference_Docs/Piper/Seneca_POH.pdf), Emergency Procedures and Operating Instructions | Preflight, climb/cruise/arrival, engine fire and alternator failure; original MPH speeds also shown with rounded knot conversions |
| R22 Beta II | [Robinson R22 POH](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r22_poh_full_book_b79e920713.pdf), sections 3 and 4; see also `r22-flight-model.md` | Normal procedures from preflight to shutdown; power failure at different heights, low RPM, fire and electrical failures |
| R44 Raven II | [Robinson R44 II POH](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44ii_poh_full_book_0586eefd22.pdf), sections 3 and 4; see also `r44-sources.md` | Type-specific normal/emergency procedures, including injected-engine start, hydraulics, 101–102% flight RPM and 70 KIAS autorotation |

The DA42 on this base still uses the C172S placeholder flight model and presentation. Its panel explicitly says aircraft-specific checklist data is unavailable; it does not relabel C172S procedures as DA42 procedures. A future type with no checklist, including S269, receives the same empty state. No S269 files are involved.

## What automatic marks mean

Live checks use actual controls and aircraft state. Engine controls are resolved separately for every engine, including per-engine overrides. Helicopter percentages use the aircraft definition's rotor reference RPM and engine ratio. An engaged-clutch check requires the switch engaged, full actuator engagement, and the actuator light out. Both engine and rotor tachometers must be in the stated flight range.

Inspections, doors, fuel condition, choice of tank, timed oil-pressure rise, magneto drop sequences, friction, control freedom, hydraulic checks, rotor brake, site selection and other pilot judgements stay manual. A point-in-time indication does not certify a sequence. Likewise the PA-34 affected-engine fire actions remain manual: checking both engines' switches would misrepresent that procedure. Unsupported legacy telemetry such as a generic suction value is not fabricated. Existing partial school predicates are admitted only for audited simple items.

Position checks use small endpoint tolerances; the 75% helicopter run-up indication uses ±0.5 percentage point. These are UI indication tolerances, not revised operating limits. No flight-model constants or geometry values were tuned.

Simulator limitations remain visible. The simplified R22/R44 starter needs a cracked grip, whereas the POH begins with it closed; this does not auto-complete the closed-throttle item. R44 priming, hydraulic controls and rotor braking are not fully represented. Preflight inspections and emergency checklists can be read even where the simulator cannot reproduce the failure.

## Captions

Stall, low rotor RPM and gear warnings are read directly from the same aircraft state flags used by the sound system, independently of audio output or mute settings. A persistent flight-cue panel retains the last switch/toast message, active warnings and a 20-entry history including cleared warnings.

Instructor captions always display, even for a saved preference that formerly disabled captions. During a lesson the latest line remains until replaced, and the latest instructor instruction remains separately visible if a radio/student line takes over. The on-screen history holds 30 lines with speaker and simulation timestamp. Tab can close the detailed lesson card but leaves the current task, assigned numeric targets and caption visible. Steps without numeric task targets do not invent them. `mute=1` disables instructor speech as well as simulator sound.

R22 demonstrations show **Now**, **Next**, their current control/readout display, a phase-specific checklist link and the last eight phase captions. These links are references, not acknowledgements. Existing engineering-script departures from POH procedure remain explicit: flight RPM during warm-up, 60 KIAS climb versus R22 sea-level Vy 53 KIAS, and the unvalidated 60 ft autorotation flare / below-90% touchdown RPM.

## Verification

Pure tests in `tests/ui/checklist.test.ts` cover actual clutch engagement/light state, independent engine/rotor tachs, manual overrides and reset, per-engine controls, intentionally manual sequences, missing-type handling, every demo phase link, and muted warning/voice behavior. Existing training checklist validators and speech scheduler tests remain applicable. Browser captures and verification logs live in the ignored `work/checklists/` directory; they include the production simulator, muted at 1366×768, with real control inputs and physics advancement for the cold start.

The initial `aircraft=r22&scenario=apron&resume=0&mute=1` capture loaded with `crashed=true` and `Main rotor strike` before pilot input. Its diagnostic images are named `apron-fault-*.png`. Cold-start checks therefore use the existing `demo=startup` placement, immediately release the script, then operate controls and advance the real physics. This scenario/obstacle issue was not changed in this UI work.

## Changed-file map

- `src/aircraft/{c172s,c152,pa38,da20,pa34,r22,r44}/checklists.ts`: cited per-type procedures. The matching `training.ts` files register them. The C172S profile moved intact, apart from registering the extra procedures, from `src/training/aircraft/c172s.ts` to `src/aircraft/c172s/training.ts`; the old path re-exports the profile and retains its generic helpers to preserve callers and the aircraft import boundary.
- `src/training/checklistData.ts`: optional reference metadata and pure data helpers.
- `src/ui/checklistModel.ts`, `checklist.ts`, `checklistStyles.ts`: audited live checks, progress and panel. `flightCues.ts`: warnings, latest switch cue and history. `uiSystem.ts`, `styles.ts`, `menu.ts`: lifecycle, visibility, F shortcut, styles and menu entry.
- `src/ui/school/{captions,lessonStrip,schoolUi,schoolStyles,settings}.ts`: persistent captions/history and assigned targets with the optional card closed.
- `src/ui/rotorcraftDemoGuide.ts`, `rotorcraftDemo.ts`: phase references, now/next and history.
- Small integration changes outside the UI/data files: `src/sim/Simulator.ts` wires the demo checklist callback and lists F; `src/sim/params.ts` makes `mute=1` silence speech; `src/input/bindings.ts` updates the Tab description. F10 remains emergency gear extension; Shift+F remains feathering.
- `tests/ui/checklist.test.ts`: behavioral coverage. `tests/aircraft/{c152,pa38,da20,pa34}.test.ts` replace fixed checklist counts with required procedure coverage. `tests/instruments/{r22,r44Panel}.test.ts` replace obsolete empty-checklist assertions; the stale R44 placeholder-name assertion now checks its actual type identity. Physics and expected-failure tests are unchanged.

Final automated checks: `npx tsc --noEmit` clean; focused UI/training/instrument run **134 passed**; aircraft/import-boundary regression run **77 passed**. `npx vitest run --maxWorkers=4` completed with **199 passed / 4 skipped files**, **2774 passed / 4 expected failures / 221 skipped tests** (2999 total), in 462.66 seconds under shared-machine load. Existing R22/R44 autorotation expected failures were left unchanged. No timeout failure needed an isolated rerun. Logs: `typecheck-final.log`, `focused-final.log`, `contract-tests.log`, `full-suite-final.log` under `work/checklists/`.

Muted browser captures (all 1366×768, opened and visually inspected):

| Image under `work/checklists/` | Observed evidence |
| --- | --- |
| `c152-runway.png` | Before-takeoff panel, 6/11 live marks, landing-light text cue |
| `r22-cold-before.png`, `r22-cold-battery.png` | Stopped engine/rotor; master operation increases engine-start marks from 2/13 to 4/13 |
| `r22-engine-started.png` | Real engine at 1690 RPM after 5 seconds of cranking; start and current oil-pressure checks tick; throttle-closed check clears; 5/13 marks |
| `r22-clutch-engaged.png` | After advancing the physics 55 seconds following clutch switch operation: clutch fully engaged/light out; engine 1448 RPM, rotor 289.57 RPM; warm-up range correctly remains unchecked |
| `r22-low-rpm-warning.png` | A slight collective input at low RPM triggers the real horn flag; its recovery caption is visible despite mute |
| `r44-runway.png` | Clutch, governor and both 101–102% tachometers tick; hydraulic/door inspections remain manual (3/8 marks) |
| `r22-demo.png`, `r22-demo-history.png` | At 70 seconds, Now/Next, three phase-history entries and the linked run-up RPM item; rotor 73.4%, so the flight-RPM mark remains unchecked |
| `lesson-in-progress.png`, `lesson-expanded.png`, `lesson-history.png` | Live L04 practice task with targets 74 kt / 5120 ft / 100°, persistent instruction, five-line caption history and the reference panel alongside; essentials remain after Tab cycles |
| `lesson-external.png` | The same active lesson in chase view; current task, targets, latest instructor caption and checklist remain visible |

The recorded captures report `muted=true`, `voice=false` and no simulator subsystem errors. The cold-start harness changes controls and calls the existing physics advance API; it never assigns aircraft state. Software ANGLE/SwiftShader was used after the hardware renderer lost its context. Browser verification also exercised manual untick, reset, menu launch, F launch and preservation of F10. The final import/helper-location check passed **25 tests**, and the final checklist-model check passed **9 tests**; typecheck and `git diff --check` remained clean. No changes are committed.
