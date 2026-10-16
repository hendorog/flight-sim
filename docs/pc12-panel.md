# Pilatus PC-12/47: panel, EIS, CAWS, UI, checklists and training

Package P3 of the PC-12/MD 500E feature (branch `pcmd/p3`). Files: `src/aircraft/pc12/{panel,panelLayout,ui,training,checklists,devMock}.ts`,
`src/instruments/render/eisWindow.ts`, `src/instruments/dynamics/cabinDisplay.ts`,
`src/instruments/{panelDef,panelParts,panel,fixedPanel}.ts`, `src/ui/checklistModel.ts`, test `tests/aircraft/pc12Panel.test.ts`.

Tags as in `docs/pc12-sources.md`: PHOTO (Commons photographs of the /47 cockpit), 47E-PROXY (47E POH Report 02277 Rev 20),
SECONDARY (training flashcards about 2013), TCDS, AGENT (our choice, never an owner decision), ESTIMATE.
Only the analogue-style panel itself (no glass, no EPECS) is an owner decision (owner-notes item 1); everything below is AGENT.

## Layout (panelLayout.ts, 2800 x 1040 px at 2000 px/m)

Read from the /47 photographs (C-GMPY, PilatusPC-12Cockpit): standby instruments outboard; the pilot's basic T (ASI, attitude,
altimeter over RMI-place NAV indicator, heading indicator in the EHSI place, VSI); flap gauge and clock below; the EIS 3 x 3 window
grid in the centre with the CAWS 6 x 8 grid under it and the gear handle at its left; radio stack right of the EIS; cabin
altitude/differential gauge; the co-pilot's T; switches, STARTER and IGNITION at the lower left; the pedestal (MOR, PCL, condition
lever, flap lever) under the CAWS. Coordinates are ESTIMATE from the photographs.

**Scale moved from the seed's 1250 px/m to 2000 px/m (AGENT).** The flat Upper view (`fixedPanel.ts`, tested for every type) needs a
3-1/8" instrument at least 120 CSS px across at 1366 x 768, which a native-size bezel (172 px) only gives at about this scale. The 3D
cockpit derives its face from `PC12_PANEL_SIZE` and `PC12_PANEL_PX_PER_M` (the C208 does), so P2 follows by construction. The names
`PC12_PILOT_T`, `PC12_COPILOT_T`, `PC12_EIS`, `PC12_CAWS`, `PC12_GEAR_HANDLE`, `PC12_FLAP_GAUGE`, `PC12_PEDESTAL`, `PC12_YOKES` are
kept (`PC12_EIS.x/y` is still the grid centre, `PC12_PILOT_T` still the attitude indicator).

## Engine instrument system (eisWindow gauge kind)

New shared gauge kind `eisWindow` (`panelDef.ts`, rendered by `render/eisWindow.ts`, reusable by the MD 500 panel): a self-lit black
window with a title, an optional round dial (bands, red lines, numbered marks, needle), up to three digital readouts with alert
colours and optional vertical bars. Dark while the bus is dead, self-lit in the night map. Windows: TQ, ITT, NG / FUEL FLOW and USED,
FUEL QTY (L, R bars and figures), NP / BAT (DC A, DC V), GEN 1 / GEN 2 (A each, DC V), ENG OIL (bar and figures).

| Window | Marks | Source |
| --- | --- | --- |
| TQ psi, 0 to 70 | green to 36.95 (MCP), yellow to 44.34 (take-off), red radial 44.34, red from 61 (transient) | TCDS C.III.4.3 via `PC12_TORQUE_PSI`; band colours AGENT |
| ITT C, 0 to 1100 | green 400 to 760, yellow to 800, red lines 800 and 1000 (start), red above 870 | TCDS via `PC12_ITT_C` |
| NG %, 0 to 110 | green 50.7 to 104, red line 104 | ETCDS / 47E-PROXY 2-6 |
| NP rpm, 0 to 2000 | red arc 350 to 950 (prohibited on the ground), green 1600 to 1700, yellow to 1870 | TCDS C.III.6.7, `PC12_NP_*` |
| FUEL FLOW pph, 0 to 800 | none; USED is `readings.fuelUsedGal`: the tank-sender drop since the last instrument reset (scenario, teleport, resume), re-based to 0 by any refuel (a rise above 0.5 gal) | AGENT; FUEL RESET not modelled |
| ENG OIL | pressure green 90 to 135, yellow 60 to 90 and 135 to 200, red lines 60 and 200; temperature red above 105 C | ETCDS IV.4.2, POH 2-6 note 2 (pressure); TCDS C.III.4.3 (MCP oil temperature) |

Torque is `pc12TorquePsi(EngineState.torque)` everywhere (panel, HUD, devMock, test). Fuel is read in pounds at 6.7 lb/US gal.

## CAWS (6 x 8)

48 lenses in `AnnunciatorPanel` (6 columns): the legacy legends of research-pc12.md section 14 (SECONDARY) plus 47E CAS equivalents
(ESTIMATE: CAB PRESS, PASS DOOR, ENG OIL, FUEL IMBAL, PUSHER ICE, GEN 1 HOT, EPS) and spare blank lenses. Every lens takes the lamp
test (CAWS TEST button = `annunciatorTest`) and is dark with the bus dead (below `PC12_BUS_DEAD_VOLTS`).

Modelled (drive from the state): ESNTL BUS and N ESSNTL BUS below 22 V; PROP LOW P (propeller `beta` flag, airborne);
L FUEL LOW / R FUEL LOW below 20 US gal; FUEL PRESS below 2 psi; HYDR (emergency gear extension selected; there is no hydraulic
model); GEN 1 OFF / GEN 2 OFF below 0.5 A; PUSHER (stick shaker or pusher active); STARTER (green); IGNITION (green, starter or
ignition ON). Everything else is unlit (OIL QTY, ENG FIRE, AV BUS, AP TRIM, AIR/GND, CARGO DOOR, ice protection, FLAPS, BAT HOT,
INVERTER, BUS TIE, CHIP and the rest).

## Other panel parts

* Gear handle with three greens and the red unsafe light (`gearLights`, lever clickable), emergency gear knob.
* Flap gauge (small dial, UP / 15 / 30 / 40 from `flapsDeg`).
* Cabin altitude / differential gauge: a **display function** of pressure altitude on the 47E controller schedule (FL300 10 000 ft,
  FL250 7379, FL200 5315, FL150 3680, FL100 2252; max 5.75 psid, standard-atmosphere differential), cabin rate limited to 500 ft/min,
  and the differential held to 5.75 psid by the (display) safety valve in a climb faster than the rate limit allows. No
  pressurisation systems model: `dynamics/cabinDisplay.ts`, owned and stepped by `InstrumentSet` (`InstrumentSystemsDef.cabin`,
  `readings.cabinAltFt` / `cabinDiffPsi`) in every camera view; a reset, teleport or resume puts the cabin on the schedule.
* Buttons: STARTER INTR (`starterInterrupt`, held; also Shift+N), PUSHER INTR (`pusherInterrupt`, held), CAWS TEST.
* Switch row: BAT, GEN 1, GEN 2, AVIONICS, FUEL PUMPS, beacon, nav, strobe, landing, taxi, pitot heat; STARTER and IGNITION
  (`switches: 'ignition'`).
* Placards: Vmo / Mmo / Vo, Vfe, Vlo / Vle, engine limits, 5.75 psid, "350 to 950 rpm prohibited".
* Flat view: `fixed.crops` keeps the EIS whole in the Upper view, `fixed.lampsBeside` puts the CAWS beside it.

## UI, checklists, training

* HUD: PWR (IDLE, percent, BETA then REV aft of the gate: REV once `bladePitch < 0`), COND (CUT-OFF / GND IDLE / FLT IDLE at
  mixture < 0.1 / 0.1 to 0.5 / 0.95+, the C208's thresholds), FLAPS, TRIM; no PROP bar. Readouts TRQ psi, ITT, Ng, Np.
  Start card and `starterAdvice` as plan 5.4: "Press STARTER once; condition lever to GROUND IDLE at 13 % Ng; the starter cuts out
  at 50 % Ng".
* Training: V-speeds from `PC12_REFERENCE`, Vno = Vne = 236, `school: { syllabus: false }`. Checklists are PARAPHRASED from the 47E
  POH sections 3, 4 and 7 (47E-PROXY); never copied. Sections: the 14 school lists plus preflight, taxi (control speed in beta),
  take-off (rudder trim), climb, cruise, descent, landing ("PCL idle, reverse as required"), power failure, start fire, hot start,
  engine fire, generator failure, stick pusher. `item.live` predicates on the audited lever and switch items;
  `checklistModel.ts` has the pc12 branch (gear live from `checklist.gearDown`; start sequence and gear-up stay manual).
* Torque predicates are in ft lbf on `turbine.torqueFtLb` (3708 ft lbf = 44.34 psi), the psi in the response text.

## Not modelled / KNOWN ISSUES (for docs/known-issues.md at integration)

* GEN 1 and GEN 2 rockers are tied (one `alternator` control); real GEN 2 cannot carry the ice loads. Fuel pumps are one rocker.
* STARTER INTR (integration): the button and Shift+N hold `ControlInputs.starterInterrupt`, which cancels a latched start
  in the turbine core (a second STARTER press does too). The STARTER and IGNITION lenses read the engaged starter
  (`EngineState.starter`), so they stay lit for the whole latched start.
* The pusher test, MOR, EIS FUEL RESET / MENU / TEST buttons,
  ice-protection switches, ECS and cabin controls are painted or absent, not working.
* `Vs1` in the training data is the flaps-UP pusher speed, 95 KIAS (`reference.vs1`). The generic type test compares Vr (82, a
  flaps-15 speed) with Vs0 when the type takes off with flap. The low-and-slow safety rule uses Vs0 + 10 = 77 KIAS, not the
  other types' Vs1 + 5 (100), which is above the PC-12's normal approach speeds (AGENT choice).
* The standby instruments are full-size (`instrumentScale` is per class). No turn coordinator is fitted: the pilot's, co-pilot's
  and standby attitude indicators carry an inclinometer (slip ball across the foot of the face, `inclinometer: true`), so the
  lesson spot `ball` names the pilot's attitude indicator's tube and `tc` the pilot's attitude indicator.
* The EIS is drawn as nine round-dial windows; the real /47 EIS is a monochrome LCD whose exact window list is not sourced
  (research-pc12.md section 15 gap).
