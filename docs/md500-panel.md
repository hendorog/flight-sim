# MD 500E panel, UI, checklists, training (package M3)

Sources: RFM CSP-E-1 Rev 16 (Fig 2-5 instrument markings, Fig 2-6 Vne cards, Fig 3-1 warning lights, Fig 4-2 panel LH
command, Fig 4-4 grips, Sections III and IV), research-md500.md sections 4, 10, 11, 12. Tags: P primary, D derived,
ESTIMATE no source.

## What is on the face (`src/aircraft/md500/panel.ts`, `panelLayout.ts`)

The face is the frozen 17.3 x 13.7 in (1056 x 840 px at 2400 px/m, names `MD500_PANEL_FACE/CANVAS/OUTLINE` unchanged).
The real lower (slant) console is a separate 16.3 x 10.1 in panel; it is painted on the same canvas below y 652 because
the 3D cockpit has one face texture.

| Part | Content | Tag |
| --- | --- | --- |
| Top strip | 16 lenses of Fig 3-1: ENGINE OUT (red), XMSN OIL PRESS (red), XMSN OIL TEMP (red), BAT TEMP 160 (red, never lit), BAT TEMP 140 (amber, never lit), RE-IGN P RST (press resets), FUEL LEVEL LOW (<= 35 lb), FUEL FILTER (never lit), M/R and T/R XMSN CHIPS, ENGINE CHIPS, GEN OUT, three blank optional lenses, PRESS TO TEST; horn dome plate at top centre | P |
| Left column | ASI (green 42-152, red 152, red/white hatched radial at 130) over the dual tach | P |
| Dual tach | `panelTach.ts`: N2 % outer 0-120 (long needle, green 102-103, red 102/103, red dot 113), Nr rpm x100 inner (short needle lettered R, green and red 410/523). Both needles share one angle law (Nr / 477.67 = percent), so they superimpose in powered flight (RFM 4-17) and split in autorotation or at shutdown | P / spacing ESTIMATE |
| Second column | attitude over directional gyro (optional fit, AGENT choice, as in the Radecki photo) | AGENT |
| Third column | altimeter over VSI | P (altimeter position) |
| Engine column | oil temperature (green 0-107 C), torque psi (green 0-81.3, yellow 81.3-87.2, red 87.2, blue dot 74.3), TOT x100 C (green 360-755, yellow 755-810, red 810, red dot 843, blue dot 738), N1 with the 0-9 vernier (`panelN1.ts`; green 64-105, red 59 and 105) | P |
| Right column | oil pressure (yellow 50-90, green 90-130, red 50/130), fuel quantity lb x100 (red 12.5 lb, red dot 35 lb), ammeter 0-150 A (green 0-85, yellow 85-150), clock/OAT | P |
| Vne cards | all three Fig 2-6 tables (weight bands up to 2000, 2001-2500, 2501-3000 lb), cell for cell, dashes = NO FLIGHT, the autorotation rule (-22 kt, minimum 85/90/95) | P |
| Console | FUEL VALVE pull knob (pull = closed), switch row BAT, GEN, START PUMP, ANTI-COLL, POS LT, LDG LT, PNL LT, RADIO with panel and radio dimmers, START + IGNITION group, NAV/COM and transponder, 18 labelled circuit breakers | P (names) / ESTIMATE (order, amps) |

Torque is `md500TorquePsi(EngineState.torque)` (psi per OUTPUT-shaft N m, `EngineDef.gearRatio 1`); TOT is
`EngineState.itt`; N1 is `EngineState.ng` (percent); N2 % is `EngineState.rpm / 6016` through
`InstrumentSystemsDef.rotorTach` (so `EngineState.rpm` on the 250 must be the output shaft, which it is with gearRatio 1);
Nr is `RotorcraftState.rotorRpm / 477.67`. Needles read through the shared lag filters, not the instantaneous state.

### Lamps (`MD500_INSTRUMENT_SYSTEMS.lamps`; all need bus power > 18 V, and PRESS TO TEST / the lens itself lights it)

| Lamp | Rule | Source |
| --- | --- | --- |
| ENGINE OUT | `RotorcraftState.turboshaft.engineOutLight` (T2: N1 < 55 % or Nr < 468 rpm) | P RFM 3-3 |
| XMSN OIL PRESS | transmission oil pressure < 5 psi (or no transmission state) | threshold ESTIMATE; on before start, out within 30 s of light-off P RFM 4-16 |
| XMSN OIL TEMP | transmission oil > 121 C | ESTIMATE |
| RE-IGN P RST | `turboshaft.reignitionLight` (latched by T2; pressing the lens sets `lampTestId 'reign'`, which T2 clears the latch on) | P RFM 1-13 |
| FUEL LEVEL LOW | fuel (sender, not the damped needle) <= 35 lb | P RFM 3-23 |
| GEN OUT | GEN switch off, or the engine not running | P RFM 4-16 |
| T/R XMSN CHIPS | `transmission.tailChips` | the one chip detector the shared state models |
| BAT TEMP 160/140, FUEL FILTER, M/R CHIPS, ENGINE CHIPS | never lit, test only (no state) | |

## Compromises (also in KNOWN_ISSUES at the gate)

1. **Dots are thin arcs.** The shared single-dial renderer has no dot primitive: the torque 74.3 psi blue dot, TOT blue 738 and red 843
   dots and the 35 lb fuel dot are 1-2 degree arcs.
2. **Dial spacing is artwork** estimated from Fig 2-5 and the Radecki photo, all band boundaries are the published limits. The ASI map
   (0-160 kt over 330 degrees) is an ESTIMATE; the inner mph ring is not drawn.
3. **START and IGNITION.** The real START button is on the collective head (Fig 4-4). The panel has its console twin through the shared
   `toggles` ignition group, which also draws an IGNITION switch (continuous ignition, `magnetos`) that the real 500E does not have.
   No other `IgnitionPanelDef` kind fits a turbine with no key; contract request below.
4. **Ammeter** reads generator output (0-150 A, as the figure). The RFM start-abort cue "ammeter zero or positive" (battery discharge
   during the start) cannot be seen on it.
5. **Tach generators are self-powered** (ESTIMATE: the RFM is silent), so N2, Nr, N1, TOT and torque read with the bus dead; the lenses do not.
6. **Circuit breakers** are painted only (names RFM Fig 4-2, ratings ESTIMATE); pulling one does nothing, so the ENG OUT breaker
   caution (RFM 1-13, 5-35) is not modelled.
7. **Electric attitude and DG** are an optional fit (AGENT); no vacuum system exists.
8. **Early-generic RE-IGN TEST** (three-position) and the RE-IGN TEST switch of the other wiring are not on the console.

## Finding for T2: does the ENGINE OUT horn sound through the start? (RFM 4-13..4-17, 1-11, 3-24, 4-26)

* The lights XMSN OIL PRESS, ENG OUT and GEN OUT are on at BAT ON (4-13/4-16). The ENGINE OUT lens clears when N1 passes 55 %.
* The AUDIO horn is NOT sounded through the start: the start procedure keeps the GEN switch OFF until ground idle (4-15, 4-17), and "the
  generator switch must be in the ON position to enable the Engine Out / Low Rotor audio warning" (3-24, pre-generic and late-generic
  wiring, which replaced the early air/ground switch, 1-11). So `engineOutHorn = engineOutLight && ControlInputs.alternator`
  (GEN ON). The GEN ON, then OFF cycle is the horn check (4-13); the shutdown check expects the horn at 55 % N1 if GEN is still ON, and the
  RFM shutdown list switches GEN off after it (4-26/4-27).
* **The Nr < 468 rpm half must not act at ground idle.** At 64-65 % N1 the rotor turns about 65 % (about 310 rpm), far under 468, yet the
  lights must be out at idle (4-16). The real unit therefore arms the low-rotor half only above idle (the RFM does not say where); T2
  needs a gate (for example N1 above about 80 %, or collective, ESTIMATE). My dev mock uses N1 > 80 %.

## UI (`ui.ts`)

HUD: COLL, GRIP (CUTOFF / IDLE / FLY / BETWEEN, `(MANUAL)` when the governor is out), N2 SET (marker bar over the 97.5-104.5 % beep range);
readouts N1 %, TOT, TQ psi, N2/Nr % (SPLIT, ENG OUT flags), VNE, BUS, OAT. `starterAdvice`: "Hold START; roll the grip to GROUND IDLE at
12-15 % N1; release at 58-60 %" (after BAT / fuel valve / collective checks). Keys quoted: F5/F6 collective, F1/F2/F3 grip, ; and Shift+; N2 beep
(T1b wires them).

## Checklists (`checklists.ts`)

Paraphrased, never copied, from RFM Section IV: before start, engine start (with abort cue), after start, run-up checks (beep range, low
rotor, rigging snap), before take-off, take-off/climb, after landing, shutdown (2 min idle, needle split, ENGINE OUT at 55 %), and Section III:
engine failure (>= 500 ft, below 500 ft, hover), low rotor, fuel control / N2 governor failure, generator. `item.live` checks use the existing
checklist frame signals (`turbine.ng`, `turbine.itt`, `checklist.rotorPercent/enginePercent`); the grip itself is not a signal (its fractions
belong to T2), so grip items are judged from N1.

## Training (`training.ts`)

Vne 152, Vy 62, Vglide 80 (maximum glide), Vdescent 60 (autorotation minimum descent), `Vs0 Vs1 Vr Vfe10 VfeFull Vno = 0` and all other
airplane slots 0 (unavailable), `school: false`, run-up N2 102 % (RFM 4-19).

## Dev page and shots

`dev/instruments.html?type=md500&freeze=1&t=<s>`: t 6-26 start (lights on), 26-40 idle, 40-200 flight, > 200 autorotation (needles split);
`&split=1` rolls the grip to idle after 200 s (N2 follows N1 down, Nr stays). Shots: `work/pcmd/shots/M3/`.
