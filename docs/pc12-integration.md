# PC-12/47 integration — feat/pc12-md500

This records the integration of the Pilatus PC-12/47 (`pc12`) on `feat/pc12-md500`: the turbine core's beta and
reverse (T1a), the flight model and systems (P1), the C208's beta and the keys (T1b), the sound (A1), the exterior and
cockpit shell (P2) and the panel (P3), merged in that order. **The type still ships `available: false`.** It is a
flight-model and integration record, not a release sign-off: the shots, the browser circuits, the build check and the
reviews of plan §8 steps 5-9 were not run in this pass (see the end).

Source tags: TCDS = EASA TCDS A.089 / IM.E.008 (primary, the /47's own); **47E-PROXY** = the PC-12/47E POH (Report
02277), a PT6A-67P aircraft of the same airframe family — the /47 AFM (02211 + AFMS 33) was not obtained, so every
performance, start, idle, quadrant and pusher figure tagged 47E-PROXY is a proxy, not the /47's book; CHART-READ = read
off a 47E chart (about ±100 ft or ±2 kt reading error); DERIVED = arithmetic on sourced values; ESTIMATE = no source,
an AGENT choice. Every choice not in `owner-notes.md` is an AGENT choice.

## The quadrant

As the owner-notes clarification says: a POWER CONTROL LEVER with beta and reverse aft of a gated idle detent (throttle
forward of the gate, `ControlInputs.reverse` aft of it), a CONDITION lever (`mixture`: CUT-OFF/FEATHER below 0.1,
GROUND IDLE 0.1, FLIGHT IDLE 1), and the MANUAL OVERRIDE lever drawn fixed at OFF (not modelled). No propeller lever:
the governor holds 1700 rpm (`selectedBy: 'conditionLever'`) and the blades feather at CUT-OFF/FEATHER.

## Measured at integration (HEAD of feat/pc12-md500)

`FS_AIRCRAFT=pc12 npx vitest run tests/conformance/pc12.test.ts`: 120 of 120 items pass (flown tier included). Values
from that run:

| Item | Measured | Target | Source |
| --- | ---: | --- | --- |
| Static PCL full, SL ISA: torque | 44.21 psi | 44.0-46.0 | TCDS 44.34; 47E-PROXY limiter 44.3 |
| — Ng / ITT / Np | 94.4 % / 771 °C / 1700 rpm | 93-99 % / 680-780 °C / 1700 ± 30 | ESTIMATE / ESTIMATE / TCDS |
| PCL full, 10 000 ft, 150 KIAS: torque / ITT | 41.60 psi / 778 °C | 40.5-43.0 / < 800 | 47E-PROXY 7-10 / TCDS |
| Hot and high, 8000 ft 26 °C, ITT 800 °C | 32.7 psi | 29-34 | ESTIMATE from 47E-PROXY Fig 5-2-3 |
| Max cruise 36.9 psi, SL / 8000 / 12 000 ft | 231.7 / 248.0 / 256.1 KTAS | 229 / 247 / 256 ± 4 % | 47E-PROXY Fig 5-2-31 |
| — fuel flow | 635 / 565 / 526 lb/h | 634 / 564 / 541 ± 10 % | 47E-PROXY Fig 5-2-31 |
| — ITT at 12 000 ft | 755 °C | < 760 | TCDS MCP |
| Max level speed, SL | 231.3 KTAS | 229 ± 6 % | 47E-PROXY |
| Best rate of climb, SL, MTOW | 1526 ft/min at 121 KIAS | 1650 ± 20 % at 130 ± 10 | ESTIMATE (SECONDARY ~1680) / 47E-PROXY 4.2 |
| Best glide ratio / speed, feathered | 15.6 at 119.3 KIAS | 15.8 ± 1.5 / 119 ± 10 | DERIVED Fig 5-2-46 / 47E-PROXY 3.2 |
| Pusher speed clean / flaps 15 / 30 / 40 | 96.3 / 79.1 / 70.5 / 68.4 KCAS | 97 / 80 / 72 / 69 ± 3 | 47E-PROXY Fig 5-2-1 CHART-READ |
| Shaker margin clean / flaps 40 | 6.4 / 6.9 kt | 5-10 | 47E-PROXY 7-21 |
| Push at 1 kt/s, flaps 40: nose drop / height lost / pushes | 17.2° / 144 ft / 1 | 8-20° / < 300 ft / 1 | 47E-PROXY 5 p. 329 |
| Take-off roll, flaps 15, rotate 80 KIAS | 489 m | 518 ± 15 % | 47E-PROXY Fig 5-2-12 CHART-READ |
| Take-off, rudder trim 0: peak heading error / pedal | 3.2° / 0.50 | < 5° / < 0.6 | AGENT |
| Landing roll at MLW, flaps 40, brakes 1280 N m (0.4 of the original 3200, 0.533 of the gate-0 2400), GROUND IDLE after touchdown, on the gate | 385 m | 389 ± 30 | 47E-PROXY Fig 5-2-52 CHART-READ |
| — in full reverse, back to the gate below 40 KIAS | 291 m | 280 ± 35 | DERIVED (0.72 × 389) |
| — ratio | 0.75 | 0.72 ± 0.08 | DERIVED from the 47E-PROXY example |
| Approach at Vref 85 KIAS, flaps 40, 3°, MLW: torque | 13.5 psi | 8-18 | ESTIMATE |
| Rudder for zero sideslip: full power 130 KIAS / 200 KIAS level | 0.22 / 0.04 | 0.15-0.45 / -0.02-0.12 | ESTIMATE |
| Ground idle on the gate: Np / Ng / ITT (parking brake) | 1057 rpm / 54.9 % / 534 °C | 1060 ± 60 / 50.7-61.4 / < 750 | 47E-PROXY 7-11, 2-6 |
| Idle taxi, GROUND IDLE: on the gate / half beta / ground fine | 20.7 / 8.2 / 0.0 kt | 15-30 / 8-12 / ≤ 5 | ESTIMATE / AGENT / AGENT |
| Ground fine static thrust | 216 N | ± 500 | AGENT |
| Gear retraction / extension at 130 KIAS | 7.4 / 7.4 s | 5-9 | ESTIMATE |
| Rest attitude / propeller clearance | -0.4° / 0.26 m | -1.0-1.5° / 0.30 ± 0.05 | 3V / ESTIMATE |
| Hands-off cruise 60 s: altitude / heading / max VS | 0.7 m / 1.3° / 6.8 ft/min | < 15 m / < 3° / < 50 | contract |
| CPU: physics sub-step / reset vs C172S | 0.95 / 0.94 | < 1.3 | contract |

Keyboard circuit (same run, flown tier; integration change below): light turbulence — touchdown 77.2 KIAS at
0.99 m/s, 354 m past the threshold, stopped after 250 m, 1.8 m off the centreline, g 0.55-1.50, bank at most 26.8°;
10 kt crosswind with turbulence 0.2 — 77.2 KIAS at 1.67 m/s (limit 1.8), 269 m roll, 1.7 m off, g 0.53-1.44.

Turbine-core test-bed figures with the PC-12 numbers (T1a, `tests/propulsion/beta.test.ts`, unchanged by the
integration): latched start cuts out at 50.0 % Ng (PC12_START 50 ± 1, 47E-PROXY); STARTER INTERRUPT (new switch) at
20 % Ng drops the starter at < 21 % and the start hangs; dry motoring times out at 80 s; torque limiter SL / 10 000 /
20 000 ft 44.23 / 41.54 / 37.36 psi against 44.30 / 41.60 / 37.46 (± 0.5, 47E-PROXY 7-10); Ng never above 103.7 %
(limit 104); overspeed governor with the primary governor failed, full-power dive to 260 kt: peak Np 1807 (≤ 1838).
On the PC-12 itself (P1): one press reaches 50 % Ng at 29 s, peak ITT about 750 °C.

## What the integration changed

- `ControlInputs.starterInterrupt` (held): cancels a latched start; Shift+N and the panel's STARTER INTR button hold it;
  a reload releases it. The STARTER and IGNITION lenses, the starter whine and the igniters read the engaged starter
  (`EngineState.starter`), so they stay on for the whole latched start.
- A windmilling engine on a condition-lever propeller (`engineStopControls`) keeps the condition lever at
  CUTOFF_BELOW with the fuel off, instead of mixture 0, which on this hub is CUT-OFF/FEATHER.
- The conformance landing roll moves the condition lever to GROUND IDLE at touchdown (`LandingOptions.rollCondition`)
  and flies at MLW (`landing.atMaxLanding`); `IdleTaxiCase.seconds`; `'PC12-beta'` removed from OPEN_REQUESTS (the
  list is empty). The generic landing items are judged and pass (table).
- The keyboard pilot's roll-out (opt-in `rolloutOnMainsS: 1`, `rolloutReverse` ground fine below 75 KIAS). Before, the
  roll-out stayed on the gate at FLIGHT IDLE and the aircraft floated on its mains for up to 66 s: a 2.0 km roll in light
  turbulence, past the far end of the 1800 m runway.
- CAWS chimes: a lens with `chime` (red = warning, amber = caution) emits the `caws` sim event on its edge (not at a
  reset, not on the lamp test); the audio strikes the chime on it.
- The visual: wheels on the definition's fully extended contact points (static sag 0.011 / 0.10 m), the panel face at
  P3's 2000 px/m canvas (1.40 × 0.52 m), the pilot's-eye test made real (PC12_EYE adopted).
- Training load factors +3.4 / -1.36 g (TCDS A.089 C.III.5; was +3.2 / -1.28).
- `STABILIZER_EQUIVALENCE` moved to a pure module (`src/physics/stabilizerEquivalence.ts`) so `pc12/systems.ts` does not
  load the control system (importOrder rule).
- Resume validates `gasGenerator`, `starterLatch` and `stickPusher`.
- Consistency rules: the reverse growl exactly on a reversing type at its own full-reverse angle, the overspeed
  warning and the stick shaker in both the definition and the sound, the beta cam's shape.
- `definitionInconsistencies(pc12)` is empty.

## Unresolved, honestly

- **The /47 book.** Every performance, start, idle, pusher and quadrant target above is 47E-PROXY or ESTIMATE. The
  /47's 760 °C MCP ITT makes less power above about 14 000 ft than the 47E's charts; the model follows its own ITT there.
- **Reverse torque about 16 psi** against the 47E's maximum reverse of 34.25 psi (900 shp). Full reverse static is
  -5.35 kN, 52 % of the take-off thrust (T1a band 40-70 %, ESTIMATE). Polish 2026-10-17: no section setting inside the
  TCDS -17.5 deg passes 20 psi, and a negative-side drag rise that reached 32 psi broke the idle, taxi, cruise-trim and
  reversed-roll rows; the cause is the ESTIMATE helix twist (the inner third stays at a positive angle in reverse).
  KNOWN_ISSUES "Reverse torque".
- **Reverse held to a stop with full brakes**: no gear collapse on the PC-12 or the C208 (polish 2026-10-17, four
  loadings, 10 s at the stop); the PC-12 at MTOW on the aft limit sits back on its tail (13.7 deg) while the reverse is
  held (ESTIMATE CG and hub heights; KNOWN_ISSUES). docs/known-issues.md still carries the old cross-aircraft entry.
- **Take-off swing** (owner to judge): peak pedal 0.50 at about 14 kt with the 47E take-off trim, 0.67 without it in
  P1's measurement (0.58 with +0.3 trim); in the conformance roll with rudder trim 0 the heading stays within 3.2°.
- **Keyboard circuit**: the round-out depends on the flare height (P1: flareM 7 crashed the crosswind circuit at
  2.7 m/s). The condition lever has keyboard detents since the polish (M back to GROUND IDLE, CUT-OFF by a fresh M held
  1 s there); the keyboard pilot selects GROUND IDLE on the roll-out.
- **Not modelled**: the MOR, pressurisation (the cabin gauges are a display function), ice protection and the inertial
  separator, the aileron trim, the collector tanks and fuel balance, the elevator float and down-spring; GEN 1 / GEN 2
  are one control.
- **Sound** figures are all ESTIMATE (no PC-12 recording).
- **Visual**: one-piece windscreen without the centre post, round exhaust stubs, four-seat executive cabin; the
  drawn wing incidence (2° to 0°) differs from the aerodynamic rigging (-0.5° / -3.0°).
- 20 KNOWN_ISSUES entries: [src/aircraft/pc12/KNOWN_ISSUES.md](../src/aircraft/pc12/KNOWN_ISSUES.md).

## Not run in this pass (plan §8 steps 5-9)

The browser flights (`fly-circuit.mjs pc12`, `fly-keyboard.mjs pc12`), every shot of plan §10, `npm run build` with
`check-build.mjs`, the Codex review and the look checks. P1's real-app autoflight circuit (lift-off 95 KIAS, climb 105
KIAS at 1390 ft/min, touchdown 84 KIAS at 0.6 m/s, stop in 175 m with reverse) was flown before P1's last swirl change
and was not re-flown. The full vitest suite was not run; the targeted runs are listed in the integration notes.
