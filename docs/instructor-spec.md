# Flight School, step 1: the instructor (implementation specification)

Status: the specification to build from. It merges three design proposals (pilot-first, engine-first and
game-first) into one, and every conflict between them is decided here. Nothing in this document has been built
yet. Implementers follow it literally. Where it says "must", tests enforce it.

Scope: step 1 of the owner's plan (instructor, lessons, grading, logbook, licence, skill test) for the browser
C172S simulator in this repository. Steps 2-4 (avionics, ATC, more aircraft) plug into the seams named in
section 7 and need no rework of the engine.

Owner decisions this spec relies on:
- The flight performance is adequate and is not to be changed for this work. Flight outside the normal envelope
  (spins, held deep stalls at aft CG) is out of scope, and lessons are designed around it (section 4.2, L07).
- The owner is a real-world light-aircraft pilot who flies with keyboard and mouse on a laptop and values
  realism above game convenience.

Constraints (from the owner and the codebase): browser only; TypeScript, Vite and three.js; no new npm
dependencies and no external assets; speech through `speechSynthesis` with captions and a captions-only
fallback; all persistent data in `localStorage` with JSON export and import; lessons are declarative data that
one engine interprets; the existing 521 tests stay green.

---

## 0. How the three designs were scored, and what was taken from each

Scores are 1 (poor) to 5 (excellent).

| Criterion | Pilot-first | Engine-first | Game-first |
|---|---|---|---|
| Fidelity to real flight training | **5**: real exercise numbering, HASELL/BUMFH, three-way handover, honest min-aggregation, ACS/EASA tables | 4: EASA-led, checklists as challenge/response, examiner rules | 4: good patter and PFL/EFATO handling, but stars and medals dilute the "honest grade" message |
| Engine cleanliness and testability | 4: pure engine returning commands, closures | **5**: typed steps, hysteresis semantics, fake-clock speech scheduler, telemetry registry | 3: phase machine with transitions is simple but mixes grading into lesson-level criteria lists |
| Player motivation | 3: hub and certificates | 3: licences and skill EMA | **5**: short loop, checkpoints, anti-frustration rules, stars, challenges, trace replay, licence card |
| Fit with existing code | 4: step-controller hook, `resetTo`, curtain reuse | 4: same hooks plus a step observer the code does not need | **5**: one copilot hook, reuses `captureSnapshot`/`restore` for checkpoints, exports helpers rather than changing behaviour |
| Extensibility (avionics, ATC, aircraft) | 4: metric registry, speaker ids | **5**: signal providers, event-map declaration merging, cabin/radio channels, aircraft type def | 4: `registerVar`/`registerEvent` |
| Parallel implementability | 4: 8 + 2 + 3 agents, clear files | **5**: frozen contract, module table, linter, slices | 4: phase 0 plus 8 modules |

The synthesis takes:
- **From pilot-first:** the syllabus shape and exercise references, the tolerance tables by authority and
  standard, criterion kinds (`hold`, `peak`, `final`, `atEvent`, `check`, `binary`), minimum-aggregation of
  grades, "momentary deviation promptly corrected" rule, the coach presets and priority ladder, the instructor
  "holds" (simulated engine failure by closing the throttle), the safety envelope, phraseology rendering,
  logbook columns and the progression gates.
- **From engine-first:** the typed step model, the predicate language with hysteresis and `held` grace,
  telemetry as a registry of named signals with providers, the event map extended by declaration merging,
  the speech scheduler (priorities, TTL, dedupe, preemption, channels, watchdog), the `AircraftTypeDef`
  shape, the career file with a previous-good copy, the lesson linter, and the AutoStudent conformance tests.
- **From game-first:** the short core loop, checkpoints through the existing snapshot API, the anti-frustration
  rules, the "already correcting" suppression of coaching, the live tolerance chips, pattern diagnosis for the
  debrief, the trace recorder and scrubbable debrief graph, stars derived from grades, challenges with local
  bests, the licence card, and keyboard assists that never affect grades.

### 0.1 Conflicts and how they are resolved

| Topic | Options proposed | Decision | Reason |
|---|---|---|---|
| Lesson structure | exercises of steps (P); phases of typed steps plus exercise metadata (E); phases with transitions (G) | **Phases of typed steps** (E); task steps carry their criteria and name the exercise they score (P) | Typed steps are easiest to validate and test; keeping criteria next to the task avoids cross-referencing ids |
| Where the runner ticks | per frame (P, G); per physics step plus per frame (E) | **Once per rendered frame, after `panel.update`**, with sim `dt = physics.lastAdvance`. Touchdown and crash data are captured step-exact in the `ctx.events` handlers. The copilot runs per physics step | One rate keeps the engine simple. Lessons run at 1x (4x on nav legs), where frame sampling is ample. Step-exact touchdown values are the only thing that needs step resolution, and `SimPhysics` already emits them inside the step |
| Grade scale | 1-4 (P); 1-5 (E); outcome + 0-3 stars + score (G) | **Criterion and exercise grades 1-4** (Not yet / Satisfactory / Good / Excellent). **Lesson outcome** Competent / Not yet competent. **Stars 1-3 derived from the grades** for motivation. A 0-100 score exists only for challenges and the "overall impression" line | One honest scale; stars cannot disagree with it |
| Early-lesson leniency | per-exercise `training` standard (P); `toleranceScale` (E); practice ×1.5 setting (G) | **Per-exercise `standard`** (`training` / `test` / `commercial`). Every result also carries the **test-standard grade**, always shown ("Test standard: Satisfactory") | Real instructors grade early exercises against wider bands; the test grade keeps it honest |
| Default authority | FAA (P); EASA (E, G) | **Chosen on first run, default EASA**, FAA ACS selectable at any time. Results record the authority they were flown under | The instructor patter (HASELL, PFL, "follow me through") is UK/EASA style |
| Steep-turn bank tolerance under EASA | ±5 (P, E); ±10 (G) | **±10° for EASA, ±5° for FAA.** The briefing marks the EASA value "examiner practice; not tabulated in AMC1 FCL.235" | AMC1 FCL.235 has no bank tolerance; ±5 would be stricter than the authority |
| Acknowledge key | Space (P); Enter (E); F (G) | **Enter** = acknowledge / "I have control" / continue. **Space stays reserved** for radio push-to-talk in step 3 | Space is the natural PTT key on a laptop; Enter already confirms dialogs here |
| Hand control back | F (P); Shift+Enter (E) | **Shift+Enter** ("You have control" from the student) | Pairs with Enter; F stays free |
| Say again | bare R (P); `/` (E); bare `]` (G) | **Bare R**. The crash dialog's R keeps working because the dialog captures keys while it is open | Mnemonic; free in `bindings.ts` and the shell |
| Ask for a demonstration | `[` (G) | **Bare `[`** ("Show me") | Free in `bindings.ts` |
| Lesson card | Tab (P, G); F7 (E) | **Tab** cycles compact / expanded / hidden, with `preventDefault` | Free and promised free in `bindings.ts` |
| Resume on reload during a lesson | schema 2 with a training block (P, E); suppress and use a separate checkpoint (G) | **Schema 2 with an optional `training` block.** A reload resumes the lesson at the start of the current step. Schema-1 snapshots stay valid | The player loses nothing on a reload; the existing resume machinery is reused |
| Scenario id for lesson starts | widen `ScenarioId` with `'lesson'`/`'custom'` | **Do not widen `ScenarioId`.** Every `StartSpec` maps to a base scenario id for the `reset` event and the snapshot, and the event gains an optional `lessonId` | Additive only; no ripple through `SCENARIO_NAMES`, resume validation or the menu |
| Profiles | one (P, G); several (E) | **One profile per browser.** Import offers Replace or Merge | Simpler; a second pilot can use another browser profile or export and import |
| Landing order in the syllabus | circuits then landings (P); landing from final first (E); landing lesson then circuits (G) | **L09 approach and landing from final, then L10 the full circuit** | In a sim the flare deserves focused repetition before the full circuit workload |
| Night | rating (E, G); part of the course (P) | **N1 Night circuits.** Required before the skill test when the authority is FAA (14 CFR 61.109(a)(2)); an optional rating under EASA | Matches both regulations |

---

## 1. Player experience

### 1.1 Boot and coexistence with free flight

The existing boot path (loading screen, curtain, resume decision) is unchanged. After the loading screen lifts:

1. If the URL has `lesson=<id>`, the briefing for that lesson opens (test and dev path).
2. Else, if the resume decision is `resume` and the snapshot carries a `training` block, the lesson resumes
   (section 3.10).
3. Else, if the decision is `resume` without a training block, free flight resumes exactly as today. The
   Flight School is one click away in the menu.
4. Else, if no training profile exists, no `scenario=` is in the URL and `school=0` is not given, the
   **Welcome card** opens over the paused sim. Its three choices:
   - **Start flight training** (default, Enter): asks for the student name (default "Student pilot"), the
     authority (EASA Part-FCL by default, or FAA ACS), and the instructor voice (list of available voices,
     a "Test voice" button, and "Captions only"). It then opens the Flight School home.
   - **Free flight** (Esc): today's behaviour. The card does not return until the player opens the school
     from the menu (`fs.training.v1.welcomeDismissed = 1`).
   - **I'm already a pilot**: creates the profile with every lesson available (`experienced: true`).
     Competency still has to be earned by flying.
5. Else, if a profile exists and no `scenario=` is given, the **home screen** opens (`school=0` suppresses it).

The Escape menu gains a **School** tab (section 5.6). The Flight tab gains an "Open Flight School" button.
Free flight never changes behaviour when no lesson is active.

### 1.2 The core loop

```
Home -> Next-lesson card -> Briefing (sim already positioned behind the curtain, held)
  -> Start flight (Enter) -> curtain lifts
  -> demonstration ("follow me through") -> "You have control" (Enter) -> practice with coaching
  -> assessed attempt (instructor quiet) -> Debrief (paused)
  -> logbook entry -> unlocks -> Next lesson / Fly it again / Practise one exercise / Home
```

- A lesson is 8-15 minutes of flying and starts where the exercise happens ("I've flown us out to the training
  area"). No transit flying, except in the navigation lesson.
- Retrying a phase costs one key (Shift+R) or one click (debrief "Try this exercise again").
- The tolerance chips give immediate, silent feedback all the time. The voice speaks only when an error
  persists and the student is not already correcting it (section 3.6).

### 1.3 A lesson end to end (L04 Climbing and descending)

1. **Home.** The next-lesson card: "Lesson 4: Climbing and descending (EASA Ex 7 & 8 / ACS VI.B-C). Dual. About
   12 min. Starts at 2,500 ft over the training area."
2. **Briefing** (sim positioned and held behind the curtain). One screen: the aim; 3-5 key points; the
   numbers table generated from the aircraft profile (Vy 74 KIAS, best glide 68, descent 500 fpm at 90 KIAS);
   the tolerances for this lesson with both the lesson standard and the test standard; airmanship (lookout
   before every climb and descent; engine temperatures in a long climb); the keys used; the exercise sequence.
   "Listen" reads a 30-45 s summary. **Start flight** (Enter) lifts the curtain.
3. **Demonstration.** Chip: INSTRUCTOR HAS CONTROL, with FOLLOW ME THROUGH. "I have control. Follow me through
   on the controls. Watch the attitude, then the power, then the trim." The copilot flies; the existing control
   widget (forced visible) shows the instructor's yoke, rudder and throttle moving. The AI and ASI are ringed
   as they are mentioned.
4. **Handover.** "You have control." The chip blinks amber "OFFERED: press Enter". Enter: caption
   `YOU: I have control.` Instructor: "You have control." Chip turns green: YOU HAVE CONTROL.
5. **Practice.** "Climb to 3,500 feet at Vy." Speed sits at 81 kt for 4 s while not reducing: "Speed's high,
   81. Raise the nose a touch." Corrected: "That's better." Level-off coaching: "Start levelling now: attitude,
   power, trim."
6. **Assessed.** "This time I'll stay quiet. Descend to 2,500 feet at 500 feet per minute, 90 knots, and
   level off." Only safety calls. The lesson card hides the tolerance bars ("Assessment: no live feedback").
7. **Debrief** (paused). Outcome banner "Competent", stars, the exercise table with grades and the
   test-standard grade, criterion rows (target, tolerance, worst deviation with time, time within tolerance),
   trace graph with tolerance bands, and the instructor's spoken summary: "Good climbs; speed within 4 knots.
   Main point: level-offs. You went 160 feet through 3,500. Start levelling at 10 percent of your rate of
   climb, about 50 feet early." Buttons: Next lesson (Enter), Fly it again, Try one exercise again, Home (Esc).
   The logbook line is written.

### 1.4 Personas and speech rules

| Persona | Used in | Voice preference (first match) | Style |
|---|---|---|---|
| **Kate Mercer, FI(A)** (fictional; name editable) | every dual lesson, solo briefings and debriefs, the pre-solo check | en-GB female, en-AU, en-NZ, en-IE, any en-* female, any en-* | calm, short sentences, standard patter ("Lookout, attitude, instruments", "Attitude, power, trim"); praise rare and specific |
| **David Hale, Examiner** (fictional) | L20 skill test | en-GB male, en-US male, any other English voice; if only one voice exists: pitch 0.85, rate 0.92 | formal; gives tasks only; no evaluative remarks in flight; "I'll give you the debrief on the ground" |

Speech rules (enforced by the coach and the scheduler, section 3.6-3.7):
1. Brief, demonstrate, hand over, practise with corrections, assess quietly, debrief.
2. One voice at a time. Safety interrupts everything; stale coaching (older than 3 s in the queue) is dropped.
3. No nagging: at most one unprompted remark every 8 s, 3 per minute, 25 s per topic; nothing while the student
   is already correcting.
4. Below 300 ft AGL on final, in the flare and on the take-off roll: only Safety calls and the short calls
   defined for those steps ("Rotate", "Hold it off").
5. Praise: at most once per phase and once per 90 s, only after a correction is fixed or after 30 s with all
   chips green.
6. Interventions: "I have control" at Safety priority, then one sentence of reason after the aircraft is safe.
7. Captions always show the written form ("Climb to 3,500 ft at 74 kt"); speech uses aviation phraseology
   ("climb to three thousand five hundred feet at seventy-four knots"; exact rules in section 3.7.3).
8. `YOU:` lines (the student's acknowledgements) are captions only, never voiced.
9. Talkativeness setting: Quiet (cooldowns ×2, no praise, short debrief), Normal, Chatty (cooldowns ×0.7,
   explanatory lines on phase entry).

### 1.5 Control authority, "follow me through" and handover

- One authority state: `instructor` or `student`.
- While `instructor`: the copilot writes the flight controls every physics step after the input module. The
  keyboard yoke already follows external writes (`InputSystem`), so handovers are bumpless.
- **Instructor to student (three-way):** "You have control" -> Enter -> caption `YOU: I have control` ->
  "You have control" -> copilot releases on the next physics step. No Enter within 6 s: the offer is repeated
  once. After 15 s: "Press Enter when you're ready to take it." The copilot keeps flying. The setting
  "Auto-acknowledge handovers" (default off) treats the first deliberate flight-control input as Enter.
- **Student moves the controls without acknowledging** (input for > 1 s during an offer): "Say 'I have
  control' first: press Enter." Recorded as a minor fault `handoverProtocol`.
- **Instructor takes (plan or intervention):** the copilot engages on the same physics step, then "I have
  control". Enter afterwards is captioned `YOU: You have control` (good protocol, recorded, optional).
- **Student hands back:** Shift+Enter -> caption `YOU: You have control` -> "I have control" -> the copilot holds
  wings level, altitude and speed. "Take a breath; press Enter when you're ready." Enter -> a new offer. Counted
  in the debrief, not a fault.
- **Student input during a demo:** inputs are overwritten anyway. Sustained input for 1 s: "Light hands, just
  follow me through." Recorded as a minor fault `fightingControls` once per demo.
- **Hardware throttle at handover:** if a hardware throttle axis is in use and differs from the copilot's
  throttle by more than 0.05, the handover waits with the caption "Match the throttle" and a bar on the chip.
  Hardware yokes take effect at once (a hand on the yoke).
- **Holds (partial authority):** the instructor can hold the throttle, flap lever or mixture while the student
  flies ("Simulated engine failure. I have the throttle."). The held lever is written every physics step. The
  chip shows `THROTTLE: INSTRUCTOR`. Moving a held lever: "Leave the throttle, I've got it." Holds release
  on the step's release condition ("Go around: you have the throttle").
- The shell's "pilot input disconnects the autopilot" rule is unaffected because the copilot is not
  `physics.autoflight`.

### 1.6 Assists and difficulty policy

| Setting | Default | Affects grades? |
|---|---|---|
| Authority: EASA / FAA | EASA | sets the tolerance table (recorded with every result) |
| Keyboard assists (existing ground steering, roll trim) | on | **no**; recorded on the logbook line as "kbd assists" |
| Instructor saves (safety interventions) | on | an intervention already prevents Competent on that exercise; off means real crashes in dual lessons. Always off in solo flights and the skill test |
| Live tolerance bars on the lesson card | on | no; always hidden in assessed exercises and the skill test |
| Auto-acknowledge handovers | off | no |
| Calm-air variant (offered after 3 Not-yet attempts at a Phase 1 lesson) | offered | the result is labelled "calm air"; counts as Competent for Phase 1 only |
| Voice on/off, voice per persona, rate 0.8-1.3, volume, captions (forced on without speech), talkativeness | on / auto / 1.0 / 0.9 / on / Normal | no |
| Time acceleration | lesson-controlled | lessons cap it (1x, 4x on nav cruise legs) |
| "Experienced pilot" (all lessons available) | off | no; competency still needs flying |

Anti-frustration rules (normative):
1. Settling: each criterion has `settleS` (default 8 s; 15 s after a level-off or roll-out) before sampling.
2. Excursions shorter than 2 s count in time-within-tolerance but never as an excursion.
3. Checkpoints at phase entry (section 3.9). "Try again" restores without a reload. A lesson completed with
   phase retries is still Competent; stars are capped at 2.
4. After 2 failed attempts at a task the instructor offers a demonstration ("Want me to show you again? Press
   the left bracket.").
5. Pre-solo, a safety breach makes the instructor take control rather than letting the aircraft crash.

---

## 2. Data model

All training types live in `src/training/types.ts` (the contract file, written first). Everything is plain
JSON-serialisable data, which validation, resume and export rely on. Lesson authors write pilot units (kt, ft,
fpm, degrees, seconds of sim time); only the telemetry layer converts from SI.

### 2.1 Aircraft type

```ts
// src/training/types.ts
export type AircraftTypeId = 'c172s' | (string & {});
export type VSpeedId =
  | 'Vs0' | 'Vs1' | 'Vr' | 'Vx' | 'Vy' | 'Vcc' | 'Vglide' | 'Va' | 'Vfe10' | 'VfeFull' | 'Vno' | 'Vne'
  | 'Vapp' | 'VappFlapsUp' | 'Vref' | 'VshortField' | 'Vcruise' | 'Vslow' | 'VsteepTurn' | 'Vdescent'
  | 'Vdownwind' | 'Vtaxi';
export type AircraftSettingId =
  | 'patternAglFt' | 'cruiseRpm' | 'descentRpm' | 'circuitRpm' | 'runupRpm' | 'magDropMaxRpm' | 'magDiffMaxRpm'
  | 'approachFlapLever' | 'takeoffFlapLever' | 'shortFieldFlapLever' | 'maxDemoCrosswindKt';
export type ChecklistId =
  | 'beforeStart' | 'engineStart' | 'afterStart' | 'runup' | 'beforeTakeoff' | 'afterTakeoff' | 'hasell'
  | 'downwind' | 'final' | 'afterLanding' | 'shutdown' | 'engineFailure' | 'forcedLandingSecurity'
  | 'nightLights' | (string & {});

export interface ChecklistItem {
  id: string;
  challenge: string;             // 'Mixture'
  response: string;              // 'Rich'
  check?: Pred;                  // verified from state; absent = confirmed by Enter
  critical?: boolean;            // missing it caps the checklist grade at 1 (fuel selector, mixture, flaps for take-off)
  lookout?: boolean;             // satisfied by a clearing turn: step.turnDeg magnitude >= 90 within the step
}
export interface ChecklistDef { id: ChecklistId; title: string; items: ChecklistItem[] }

export interface AircraftTypeDef {
  id: AircraftTypeId;
  name: string;                  // 'Cessna 172S Skyhawk SP'
  icaoType: string;              // 'C172'
  registration: string;          // fictitious 'N172FS' (FAA) / 'G-FSCK' (EASA); chosen by authority
  classRating: 'SEP';
  vspeeds: Record<VSpeedId, number>;           // KIAS
  settings: Record<AircraftSettingId, number>;
  flapDetentsDeg: number[];                    // [0, 10, 20, 30]
  flapLeverForDeg: Record<number, number>;     // detent deg -> ControlInputs.flaps lever value
  limits: { gPos: number; gNeg: number; maxDemoCrosswindKt: number };
  checklists: Record<ChecklistId, ChecklistDef>;
  envelope: SafetyEnvelope;                    // defaults for the safety monitor (section 3.8)
  demoTuning?: Partial<{ maxBankDeg: number; rollRateDps: number }>;
}
```

`src/training/aircraft/c172s.ts` imports what exists in `src/core/c172.ts` and adds the rest (POH, KIAS):

| Speed | KIAS | Speed | KIAS | Speed | KIAS |
|---|---|---|---|---|---|
| Vs0 | 40 | Vs1 | 48 | Vr | 55 |
| Vx | 62 | Vy | 74 | Vcc (cruise climb) | 85 |
| Vglide | 68 | Va | 105 | Vfe10 | 110 |
| VfeFull | 85 | Vno | 129 | Vne | 163 |
| Vapp (flap 20) | 70 | VappFlapsUp | 75 | Vref (flap 30) | 65 |
| VshortField | 61 | Vcruise | 105 | Vslow | 55 |
| VsteepTurn | 95 | Vdescent | 90 | Vdownwind | 90 |
| Vtaxi | 15 | | | | |

Settings: `patternAglFt` 1000, `cruiseRpm` 2300, `descentRpm` 1900, `circuitRpm` 2200, `runupRpm` 1800,
`magDropMaxRpm` 150, `magDiffMaxRpm` 50, `approachFlapLever` = lever for 30°, `takeoffFlapLever` 0,
`shortFieldFlapLever` = lever for 10°, `maxDemoCrosswindKt` 15. Limits: +3.8 / -1.52 g.

A unit test asserts that every value shared with `src/core/c172.ts` is equal, so the flight model and the
lessons cannot disagree.

### 2.2 Tolerances and standards

```ts
export type AuthorityId = 'easa' | 'faa';
export type Standard = 'training' | 'test' | 'commercial';
export type TolKey =
  | 'altitude' | 'altitudeEngineOut' | 'heading' | 'headingEngineOut' | 'speed' | 'speedClimbApproach'
  | 'slowFlightSpeed' | 'bankMedium' | 'bankSteep' | 'rollout' | 'vs' | 'touchdownZoneFt' | 'touchdownZoneShortFt'
  | 'centrelineM' | 'glidepathFt' | 'stallHeightLossFt' | 'navAltitude' | 'navHeading' | 'xtkNm' | 'etaMin'
  | 'instrAltitude' | 'instrHeading' | 'turnRate' | 'sinkFpm';
export interface Tol { minus: number; plus: number }     // allowed below / above the target
export type ToleranceTable = Record<AuthorityId, Record<Standard, Record<TolKey, Tol>>>;
/** In lesson data: a key, a key scaled, a literal symmetric number, or a literal band. */
export type TolRef = TolKey | { key: TolKey; scale: number } | number | Tol;
```

`src/training/grading/standards.ts` holds `STANDARDS: ToleranceTable`. ±x means `{minus: x, plus: x}`.

| TolKey | EASA test | FAA test | training (both) | commercial (both) |
|---|---|---|---|---|
| altitude | ±150 ft | ±100 ft | ±200 ft | ±100 ft |
| altitudeEngineOut | ±200 ft | ±100 ft | ±250 ft | ±100 ft |
| heading | ±10° | ±10° | ±15° | ±10° |
| headingEngineOut | ±15° | ±10° | ±20° | ±10° |
| speed | ±15 kt | ±10 kt | ±15 kt | ±5 kt |
| speedClimbApproach | −5/+15 kt | −5/+10 kt | −5/+15 kt | −0/+5 kt |
| slowFlightSpeed | −0/+10 kt | −0/+10 kt | −0/+15 kt | −0/+5 kt |
| bankMedium (30°) | ±10° | ±10° | ±10° | ±5° |
| bankSteep (45°; commercial 50°) | ±10° (examiner practice) | ±5° | ±10° | ±5° |
| rollout | ±10° | ±10° | ±15° | ±10° |
| vs (rate targets) | ±200 fpm | ±200 fpm | ±300 fpm | ±100 fpm |
| touchdownZoneFt (beyond aim point) | 0/+400 (sim standard) | 0/+400 | 0/+600 | 0/+200 |
| touchdownZoneShortFt | 0/+200 | 0/+200 | 0/+300 | 0/+100 |
| centrelineM (main gear) | ±5 m | ±5 m | ±8 m | ±3 m |
| glidepathFt (3° path, beyond 1 NM) | ±100 ft | ±100 ft | ±150 ft | ±75 ft |
| stallHeightLossFt | 0/+200 (sim standard) | 0/+200 | 0/+300 | 0/+100 |
| navAltitude / navHeading | ±200 ft / ±10° | ±200 ft / ±15° | ±300 / ±20° | ±100 / ±10° |
| xtkNm / etaMin | ±1 NM / ±3 min | ±1 NM / ±3 min | ±2 / ±5 | ±0.5 / ±2 |
| instrAltitude / instrHeading | ±150 / ±10° | ±100 / ±10° | ±200 / ±20° | ±100 / ±10° |
| turnRate (standard-rate units) | ±0.2 | ±0.2 | ±0.3 | ±0.15 |
| sinkFpm (touchdown, limit) | 0/+400 | 0/+400 | 0/+500 | 0/+300 |

Values marked "sim standard" or "examiner practice" are design choices where the authority publishes no figure;
the briefing labels them so. Changing a value is a one-line data edit reviewed by the owner.

### 2.3 Telemetry signals

```ts
export type SignalKind = 'number' | 'angle' | 'bool' | 'enum';
export type SignalValue = number | boolean | string;
export type CoreSignalId =
  // indicated (what the student sees; grading uses these)
  | 'asiKt' | 'altFt' | 'vsiFpm' | 'hdgDeg' | 'aiPitchDeg' | 'aiBankDeg' | 'turnRate' | 'ball' | 'rpm'
  | 'oilPsi' | 'oilTempF' | 'fuelLGal' | 'fuelRGal' | 'suctionInHg' | 'ammeterA'
  // truth (safety, geometry, events)
  | 'kias' | 'tasKt' | 'gsKt' | 'altMslFt' | 'aglFt' | 'hafFt' /* height above field */ | 'vsFpm'
  | 'pitchDeg' | 'bankDeg' /* + right */ | 'hdgTrueDeg' | 'trackDeg' | 'driftDeg' /* heading - track */
  | 'aoaDeg' | 'gLoad' | 'stallWarn' | 'stallFrac' | 'onGround' | 'mainsOnGround' | 'noseOnGround' | 'crashed'
  | 'engineRunning' | 'pitchRateDps' | 'rollRateDps'
  // controls
  | 'throttle' | 'mixture' | 'flapLever' | 'flapsDeg' | 'trim' | 'elevator' | 'aileron' | 'rudder' | 'brakes'
  | 'parkingBrake' | 'mags' /* 0 off, 1 R, 2 L, 3 both */ | 'starter' | 'master' | 'alternator' | 'avionics'
  | 'fuelSel' /* 'off'|'left'|'right'|'both' */ | 'fuelPump' | 'pitotHeat' | 'lightNav' | 'lightBeacon'
  | 'lightStrobe' | 'lightLanding' | 'lightTaxi' | 'qnhErrHpa' /* kollsman - QNH */ | 'dgErrDeg' /* DG - magnetic */
  // airfield geometry (runway 07 frame; core/world.ts runwayCoords)
  | 'rwyAlongM' /* from the 07 threshold, + along 07 */ | 'rwyAcrossM' /* + right of the 07 centreline */
  | 'distAimFt' /* along-track beyond the aim point (scenarios.ts AIM_POINT) */ | 'gpDevFt' /* + above 3° path */
  | 'onRunway' | 'onPaved' | 'pastHoldLine' | 'circuitLeg' | 'downwindOffsetNm' | 'headwindKt' | 'crosswindKt'
  // derived
  | 'untrimmedS' | 'studentInput' | 'night' | 'sunElevDeg' | 'timeScale'
  // per step (reset on step entry)
  | 'step.t' | 'step.turnDeg' /* signed heading change integrated */ | 'step.altChangeFt' | 'step.maxBankAbsDeg'
  // navigation (route in the run)
  | 'nav.xtkNm' | 'nav.distNm' | 'nav.bearingDeg' | 'nav.etaErrMin' | 'nav.leg';
export type SignalId = CoreSignalId | `${string}.${string}`;   // provider-namespaced: 'xpdr.code', 'atc.clearedLand'
export type CircuitLeg = 'none' | 'ground' | 'upwind' | 'crosswind' | 'downwind' | 'base' | 'final' | 'deadside';

export interface SignalDef {
  id: SignalId; kind: SignalKind; unit: string;
  hyst: number;              // default comparison hysteresis, in the signal's unit
  rateTau?: number;          // time constant (s) of the filtered rate used by the coach's "correcting" test
  describe: string;
}
export interface TelemetrySources {
  state: Readonly<AircraftState>; controls: Readonly<ControlInputs>;
  readings: Readonly<InstrumentReadings> | null;   // null in headless tests: indicated signals fall back to truth
  weather: Readonly<WeatherSettings>; env: Environment; aircraft: AircraftTypeDef;
  studentInput: boolean; timeScale: number; route: NavRoute | null;
}
export interface SignalProvider {
  readonly id: string;                      // 'core', 'geo', 'nav'; step 2 adds 'xpdr', 'com'
  readonly defs: readonly SignalDef[];
  sample(out: SignalFrame, src: TelemetrySources, dt: number): void;
}
export type SignalFrame = Record<string, SignalValue>;    // one object per run, mutated in place
```

Default hysteresis and rate constants: `asiKt`/`kias` 1 kt (τ 1 s); `altFt` 20 ft (τ 1.5 s); `hdgDeg` 2°;
`bankDeg`/`aiBankDeg` 2° (τ 0.5 s); `vsFpm`/`vsiFpm` 50 fpm; `pitchDeg` 1°; `rwyAcrossM` 1 m; `aglFt` 10 ft;
`gLoad` 0.05; `ball` 0.05; others 0.

Signals of kind `angle` are compared on the circle (`wrap180(x - target)`). `untrimmedS` counts seconds with
`|elevator| > 0.08` while `|vsFpm| < 300` and `|bankDeg| < 10`, reset when the condition breaks for 1 s.
`circuitLeg` uses the left-hand circuit for runway 07 (downwind on the north-west side at `DOWNWIND_OFFSET`
900 m; `scenarios.ts`) and the rules: upwind beyond the far threshold with `|across| < 600 m`; crosswind turning
toward the downwind side; downwind heading within 30° of 250° and offset 500-2000 m; base heading within 40° of
160° beyond the near threshold; final heading within 30° of 070°, short of the threshold, `|across| < 400 m`;
deadside on the right of the runway within 1.5 NM.

### 2.4 Values and the predicate language

```ts
/** A number in a lesson, resolved at run time. Angles wrap automatically when compared with an angle signal. */
export type Ref =
  | number
  | { var: string; add?: number }
  | { vspeed: VSpeedId; add?: number }
  | { setting: AircraftSettingId; add?: number }
  | { field: 'elevFt'; add?: number }              // aerodrome elevation (394 ft)
  | { sig: SignalId; add?: number };
export type SigRef = SignalId | { var: string };

export type Pred =
  | { sig: SigRef; op: '<' | '<=' | '>' | '>='; v: Ref; hyst?: number }
  | { sig: SigRef; eq: number | string | boolean }
  | { sig: SigRef; near: Ref; tol: TolRef; hyst?: number }       // angle-aware band
  | { all: Pred[] } | { any: Pred[] } | { not: Pred }
  | { held: Pred; s: number; graceS?: number }                  // true for s continuous sim seconds
  | { ever: Pred }                                              // latched since step entry
  | { event: TrainingEventName; where?: Record<string, [number, number] | string | boolean>; count?: number }
  | { elapsed: number }                                         // step time >= N s
  | { turned: number }                                          // |step.turnDeg| >= N
  | { authority: 'student' | 'instructor' }
  | { speechIdle: true }
  | { leg: CircuitLeg | CircuitLeg[] }
  | { exerciseGrade: string; atLeast: Grade }
  | { const: boolean };
```

Semantics (`src/training/engine/predicates.ts`), compiled once per step into closures with their own state:
- `op`: `x > v` becomes true when `x > v`, and false only when `x < v - hyst` (default: the signal's `hyst`).
  The other operators are symmetric.
- `near`: `e = x - target` (wrapped to ±180 for angles). True when `-tol.minus <= e <= tol.plus`; false when it
  leaves the band by more than `hyst`.
- `held`: a timer accumulates sim time while the child is true. A drop-out of at most `graceS` (default 0.25 s)
  pauses the timer instead of zeroing it.
- `ever` latches. `event` scans the bus since the step mark, filtering `where` fields (number ranges inclusive,
  strings and booleans exact), true at `count` (default 1).
- `all` and `any` evaluate every child every tick (no short-circuit), so nested timers stay correct.
- A missing or NaN signal evaluates false; the linter reports unknown signal ids.

Builders in `src/training/engine/dsl.ts` return these plain objects:
`gt(s, v)`, `ge`, `lt`, `le`, `eq(s, x)`, `near(s, target, tol)`, `held(p, s, grace?)`, `all(...)`, `any(...)`,
`not(p)`, `ever(p)`, `ev(name, where?, count?)`, `elapsed(s)`, `turned(deg)`, `authority(who)`, `leg(...)`;
refs `v(name, add?)`, `vs(id, add?)`, `setting(id, add?)`, `fieldElev(add?)`, `sig(id, add?)`; tolerances
`std(key, scale?)`.

### 2.5 Training events

```ts
export interface TrainingEventMap {
  'touchdown': { wheel: 'nose' | 'left' | 'right'; sinkFpm: number };       // every wheel contact (SimEvents)
  'mainsTouchdown': TouchdownData;                                          // first main contact of a landing
  'landing': LandingData;                                                   // LandingDetector summary
  'liftoff': { kias: number; rwyAlongM: number };
  'stopped': {};                                                            // gs < 1 kt for 2 s on the ground
  'stallWarnOn': { kias: number }; 'stallWarnOff': {};
  'stallBreak': { kias: number; altFt: number };   // stallFrac >= 0.5, or stallWarn with pitch rate < -4°/s
  'goAround': { aglFt: number };                   // throttle >= 0.9 below 500 ft AGL near the runway, then vs > 0 within 5 s
  'crash': { reason: string };
  'thresholdCrossed': { heightFt: number; kias: number };
  'rolloutComplete': { hdgErrDeg: number };        // |bank| < 3° for 2 s after a task's turn
  'student.ack': {}; 'student.handback': {}; 'student.sayAgain': {}; 'student.showMe': {};
  'authority': { to: 'student' | 'instructor'; reason: 'plan' | 'intervention' | 'handback' };
  'intervention': { rule: string };
  'checklist.item': { checklist: ChecklistId; item: string; ok: boolean };
  'checklist.done': { checklist: ChecklistId; missed: string[] };
  'fault': { id: string; severity: 'minor' | 'major' | 'critical' };
  'hint': { topic: string; rung: 1 | 2 | 3 };
  'demo.done': { result: 'done' | 'aborted' | 'timeout' };
  'step.enter': { phase: string; step: string };
  'step.exit': { phase: string; step: string; result: 'success' | 'fail' | 'timeout' | 'skipped' };
  'speech.start': { id: string; actor: ActorId }; 'speech.end': { id: string; result: 'done' | 'interrupted' | 'dropped' };
}
export type TrainingEventName = keyof TrainingEventMap;
export interface TouchdownData {
  sinkFpm: number; kias: number; firstWheel: 'nose' | 'left' | 'right'; distAimFt: number; rwyAcrossM: number;
  driftDeg: number; bankDeg: number; pitchDeg: number; onRunway: boolean;
}
export interface LandingData extends TouchdownData {
  kiasAt50Ft: number; gpDevFtAt300: number; bounces: number; maxBounceFt: number; floatS: number;
  rolloutMaxAcrossM: number; fullStop: boolean; crashed: boolean;
}
```

Later steps add event types by declaration merging
(`declare module '../training/types' { interface TrainingEventMap { 'atc.clearance': {...} } }`); predicates pick
them up without engine changes.

### 2.6 Cues (what the instructor says)

```ts
export type ActorId = 'instructor' | 'examiner' | 'student' | 'tower' | 'ground' | 'atis' | 'system';
export type Channel = 'cabin' | 'radio';
export const enum Priority { Safety = 0, Instruction = 1, Coach = 2, Praise = 3 }
export type CueId = string;                    // key into src/training/content/lines.ts
export interface InlineCue {
  text: string | string[];                     // caption text with templates; an array gives variants
  speak?: string | string[];                   // synthesiser text when it differs (same templates)
  actor?: ActorId;                             // default: the lesson persona
  channel?: Channel;                           // default from actor ('tower' -> radio)
  priority?: Priority;                         // default Instruction
  interrupt?: boolean;                         // may cut lower-priority speech
  ttlS?: number;                               // drop if not started within (default: Safety 2, Instruction 8, Coach 3, Praise 3)
  key?: string; cooldownS?: number;            // dedupe / cooldown
}
export type CueRef = CueId | InlineCue | { id: CueId; vars: Record<string, Ref> };
```

Templates: `{name:format}`. `name` is a variable, a signal, `vspeed.Vy`, `setting.cruiseRpm` or `tol.altitude`.
Formats: `alt` (caption "3,500 ft", spoken "three thousand five hundred feet"), `hdg` ("070", "heading zero seven
zero"), `kt` ("74 kt", "seventy-four knots"), `fpm`, `deg`, `rpm` ("2,300 rpm", "two thousand three hundred R P
M"), `dev:alt` (signed deviation: "160 ft high", "a hundred and sixty feet high"), `side` (left/right), `dir`
(high/low, fast/slow), `nm`, `min`, `qnh` ("1013", "one zero one three").

Variants rotate with a seeded RNG and never repeat the previous one. Every line is at most 20 words (Chrome cuts
long utterances); longer briefings are split at sentence boundaries by the backend.

### 2.7 Demonstration scripts (the copilot)

```ts
export interface DemoAp {                     // pilot units; the copilot converts to AutopilotSettings (SI)
  lateral?: 'off' | 'wingLeveler' | 'heading' | 'bank';
  vertical?: 'off' | 'pitch' | 'verticalSpeed' | 'altitude' | 'airspeed';
  hdgDeg?: Ref; bankDeg?: Ref; maxBankDeg?: number; pitchDeg?: Ref; vsFpm?: Ref; altFt?: Ref; kias?: Ref;
  autothrottle?: boolean; yawDamper?: boolean; autoTrim?: boolean;
}
export type DemoControl = 'throttle' | 'flapsDeg' | 'mixture' | 'trim' | 'elevator' | 'aileron' | 'rudder' | 'brakes';
export interface Ramp { to: Ref; overS: number }
export type DemoSegment =
  | { kind: 'ap'; ap: DemoAp; set?: Partial<Record<DemoControl, number | Ramp>>; say?: CueRef; until: Pred; timeoutS: number }
  | { kind: 'autoflight'; plan: AutoflightPlan; say?: CueRef; until: Pred; timeoutS: number }   // reuses sim/autoflight.ts
  | { kind: 'raw'; hold: Partial<Record<'elevator' | 'aileron' | 'rudder' | 'throttle', number>>; ap?: DemoAp; forS: number; say?: CueRef }
  | { kind: 'pulse'; control: 'elevator' | 'aileron' | 'rudder'; amount: number; holdS: number; say?: CueRef }
  | { kind: 'pause'; s: number; say?: CueRef };
export interface DemoScript { id: string; segments: DemoSegment[]; abortWhen?: Pred }
```

`timeoutS` is mandatory on every `until` segment (a demo can never hang). `abortWhen` (and the global safety
envelope) switch to the recovery script.

### 2.8 Starts and weather

```ts
// src/sim/starts.ts (pure, node-safe; types re-exported from src/training/types.ts)
export type GroundSpot = 'parking' | 'holdA1' | 'holdA2' | 'lineup07';
export type AreaId = 'trainingArea' | 'fieldOverhead' | 'pflHighKey';
export type StartSpec =
  | { kind: 'scenario'; id: ScenarioId }
  | { kind: 'ground'; spot: GroundSpot; engine: 'running' | 'cold' }
  | { kind: 'air'; at: AreaId | { north: number; east: number }; altFt: number; altRef: 'msl' | 'field';
      hdgDeg: number; kias: Ref; flapsDeg?: number; gammaDeg?: number }
  | { kind: 'final'; distNm: number; kias: Ref; flapsDeg: number; heightOffsetFt?: number }   // offset from the 3° path
  | { kind: 'circuit'; leg: 'downwind' | 'base'; position: 'early' | 'abeamMid' | 'abeamThr'; kias: Ref; flapsDeg?: number }
  | { kind: 'attitude'; at: AreaId; altFt: number; kias: number; pitchDeg: number; bankDeg: number; hdgDeg: number };
export interface StartOptions { fuelFraction?: number; payload?: 'forward' | 'typical'; controls?: Partial<ControlInputs> }
export function buildStart(spec: StartSpec, env: Environment, opts?: StartOptions): Scenario;
export function baseScenario(spec: StartSpec): ScenarioId;   // ground parking/hold -> 'apron', lineup -> 'runway',
                                                             // air/attitude -> 'cruise', final -> 'final', circuit -> 'downwind'

// src/training/types.ts
export type WeatherPresetId = 'calm' | 'smooth' | 'light' | 'xwind10' | 'xwind15' | 'gusty' | 'hazy' | 'night' | 'imc';
export interface WeatherSpec {
  preset: WeatherPresetId;
  override?: Partial<WeatherSettings>;
  windDirDeg?: [number, number]; windKt?: [number, number]; gustKt?: [number, number]; turbulence?: [number, number];
}
```

- Ground spots come from `src/world/airport/layout.ts` (`PARKING`, `HOLD_SHORT` A1/A2, `LINE_UP` RWY07).
- Air starts reuse the existing trim path (`fm.reset(ic)` plus `trimControls`), so every start is in equilibrium.
  `attitude` starts reset at a trimmed condition, then call `fm.setKinematics` with the rotated attitude behind
  the curtain.
- Areas (`src/training/geo/areas.ts`): `trainingArea` is centred at (4000 N, −8000 E) NED with a 3 NM radius
  (the `cruise` scenario's known-good track); `fieldOverhead` is over the runway midpoint; `pflHighKey` is
  abeam the 07 upwind end on the deadside. A test asserts terrain ≤ (working altitude − 2,000 ft) over each
  area's radius at every lesson's start altitude; if the survey fails for (4000, −8000), the implementer moves
  the centre along the cruise track to the nearest point that passes and records it in the test.
- `payload: 'forward'` (default for all lessons) loads the aircraft at a forward-to-typical CG, where the
  stall behaviour is benign (round-5 report).
- Weather ranges are sampled with a seeded PRNG: seed = hash(lessonId, attemptNumber). Winds in v1 lessons stay
  within 040-160° so runway 07 is always into wind (the autoflight's approach assumes 07).
- Presets: `calm` (wind 0-3 kt, turbulence 0.03, cover 0.2); `smooth` (wind 5 kt, turbulence 0.05); `light`
  (070-110°/5-9 kt, turbulence 0.1, cover 0.35); `xwind10` (160°/10 kt, gust 14); `xwind15` (160°/13 kt, gust
  17); `gusty` (090°/12 kt gust 20); `hazy` (visibility 6 km); `night` (time of day 21.5 h, calm, clear);
  `imc` (cover 1.0, base 600 m, visibility 1,500 m).
- The player's own weather and time of day are saved when a lesson starts and restored when it ends.

### 2.9 Lessons, phases and steps

```ts
export type Grade = 1 | 2 | 3 | 4;   // 1 Not yet, 2 Satisfactory (competent), 3 Good, 4 Excellent
export type SkillId =
  | 'effectsOfControls' | 'groundOps' | 'straightLevel' | 'climb' | 'descent' | 'turns' | 'slowFlight' | 'stalls'
  | 'takeoff' | 'circuit' | 'approach' | 'landing' | 'goAround' | 'efato' | 'glideApproach' | 'steepTurn'
  | 'forcedLanding' | 'shortField' | 'crosswind' | 'instrument' | 'unusualAttitude' | 'navigation' | 'night'
  | 'checks' | 'airmanship' | 'radio' | 'transponder';
export type CoachLevel = 'full' | 'reduced' | 'minimal' | 'silent';
export type InstrumentId = 'asi' | 'ai' | 'alt' | 'tc' | 'dg' | 'vsi' | 'tach' | 'ball' | 'flaps' | 'fuel' | 'oil';

export interface Lesson {
  id: string;                         // 'L04'
  version: number;                    // bump on content change; records keep the version flown
  number: number; title: string;
  syllabusRef: { easa: string; faa: string };       // 'Ex 7 & 8', 'ACS VI.B-C'
  stage: 'handling' | 'circuits' | 'advanced' | 'navigation' | 'test' | 'rating';
  kind: 'dual' | 'solo' | 'check' | 'test';         // check: instructor, coach silent, gate; test: examiner
  persona: 'instructor' | 'examiner';
  requires: string[];                 // lesson ids that must be Competent
  requiresEndorsements?: EndorsementId[];
  requiredFor?: AuthorityId[];        // N1: ['faa'] -> a prerequisite of L20 only under FAA
  aircraft: AircraftTypeId[] | 'any';
  estMinutes: number;
  start: StartSpec; startOptions?: StartOptions;
  weather: WeatherSpec;
  rules: LessonRules;
  briefing: Briefing;
  vars?: Record<string, Ref>;
  route?: NavRoute;                   // navigation lessons
  exercises: ExerciseDef[];
  flow: PhaseDef[];                   // the first phase is the entry
  awards?: Award[];
  debriefTips?: Record<string, string>;   // `${criterionId}.${pattern}` -> tip
}
export interface LessonRules {
  coachLevel: CoachLevel;             // phases may lower it
  autopilot: 'forbidden' | 'allowed';
  maxTimeScale: number;               // default 1; phases may raise it (nav cruise 4)
  instructorSaves: boolean;           // false for solo, check and test kinds (forced)
  envelope?: Partial<SafetyEnvelope>;
  maxDurationS: number;               // 'running out of time' at this sim time; outcome 'incomplete'
  hood?: boolean;                     // instrument view restriction available in this lesson
}
export interface Briefing {
  aim: string;
  points: string[];                   // 3-5
  numbers: { label: string; value: Ref; unit: 'kt' | 'ft' | 'deg' | 'rpm' | 'fpm' | 'nm' | '' }[];
  tolerances: TolKey[];               // rendered for the lesson's standard and the test standard
  airmanship: string[];
  keys: string[];                     // InputAction or training key ids, shown with their bindings
  diagram?: { kind: 'circuit' | 'turn' | 'climb' | 'glide' | 'stall' | 'landingZone' | 'pfl'; bankDeg?: number };
  more?: string;                      // theory text behind a disclosure
  spoken: CueRef;                     // 30-45 s summary
}
export interface ExerciseDef {
  id: string; title: string; skill: SkillId;
  mode: 'demo' | 'practice' | 'assessed';
  standard: Standard;
  required: boolean;                  // counts toward lesson competency
  weight: number;                     // for the overall-impression line only
  testSection?: 1 | 2 | 3 | 4 | 5;    // skill test section
}
export type EndorsementId = 'firstSolo' | 'soloAreaSolo' | 'crosswind15' | 'night' | 'ppl' | (string & {});
export interface Award { id: EndorsementId; when: 'competent' | 'testPass'; title: string }

export interface PhaseDef {
  id: string; title: string;
  steps: StepDef[];
  checkpoint?: boolean;               // default true when the phase contains a task step
  repeat?: { max: number; until?: Pred };     // re-run the phase until `until` holds at phase end
  retryFrom?: StartSpec;              // reposition used by "try again" instead of the checkpoint
  coachLevel?: CoachLevel;
  maxTimeScale?: number;
  lowLevel?: boolean;                 // disables the minimum-height envelope rule (circuits, landings, PFL)
}

interface StepBase {
  id: string;
  when?: Pred;                        // entry condition; the step waits as 'pending' until true
  whenPrompt?: { afterS: number; cue: CueRef; everyS?: number };
  timeoutS?: number; onTimeout?: Outcome;      // default: 'fail' for task, 'next' otherwise
  pf?: 'student' | 'instructor';      // the runner performs the handover before the step starts
}
export type Outcome = 'next' | 'retry' | 'fail' | 'end' | { goto: string /* step id or 'phase:<id>' */ }
  | { demo: string; thenRetry: true } | 'instructorTakes';

export interface SayStep extends StepBase { kind: 'say'; cue: CueRef; wait?: boolean }
export interface WaitStep extends StepBase { kind: 'wait'; until: Pred; cue?: CueRef; prompt?: CueRef }
export interface CaptureStep extends StepBase { kind: 'capture'; vars: Record<string, Ref | SigRef> }
export interface SetupStep extends StepBase {
  kind: 'setup'; reposition?: StartSpec; weather?: WeatherSpec; controls?: Partial<ControlInputs>;
  holds?: Holds | null; hood?: boolean; timeScaleMax?: number; cue?: CueRef;
}
export interface HandoverStep extends StepBase { kind: 'handover'; to: 'student' | 'instructor'; ackTimeoutS?: number }
export interface DemoStep extends StepBase { kind: 'demo'; script: string | DemoScript; followMeThrough?: boolean; intro?: CueRef; highlight?: InstrumentId[] }
export interface ChecklistStep extends StepBase { kind: 'checklist'; checklist: ChecklistId; mode: 'challengeResponse' | 'flow' | 'silent'; exercise?: string }
export interface BranchStep extends StepBase { kind: 'branch'; cases: { when: Pred; goto: string }[]; else: string }
export interface EndStep extends StepBase { kind: 'end'; cue?: CueRef }
export interface TaskStep extends StepBase {
  kind: 'task';
  exercise: string;                   // ExerciseDef id this task scores
  brief: CueRef;                      // spoken on entry
  prompt?: CueRef;                    // Say again (default: brief, re-rendered with live values)
  card: TaskCard;
  goal: Pred;
  minS?: number;
  criteria: Criterion[];
  coach?: (CoachPresetId | CoachRule)[];
  faults?: FaultRule[];
  holds?: Holds;
  highlight?: InstrumentId[];
  on?: { event: TrainingEventName; where?: Record<string, [number, number] | string | boolean>; cue?: CueRef; goto: string }[];
  attempts?: number;                  // with onFail 'retry'
  onSuccess?: { cue?: CueRef; next?: Outcome };
  onFail?: { cue?: CueRef; next?: Outcome };
}
export interface TaskCard { title: string; targets: { label: string; sig: SignalId; value: Ref; tol?: TolRef; unit: string }[] }
export interface Holds { throttle?: number; flapsDeg?: number; mixture?: number; release?: Pred; cue?: CueRef }
export type StepDef = SayStep | WaitStep | CaptureStep | SetupStep | HandoverStep | DemoStep | ChecklistStep
  | BranchStep | EndStep | TaskStep;
```

### 2.10 Criteria, coaching and faults

```ts
export interface Criterion {
  id: string; label: string;                      // 'Climb speed'
  kind: 'hold'      // continuous sampling while the task is active, after settleS, while activeWhen
      | 'peak'      // worst value in the task
      | 'final'     // value at task exit
      | 'atEvent'   // one sample at an event (field of the payload, or a signal at that moment)
      | 'check'     // pred must become true (by task exit, or within `withinS` of entry)
      | 'binary';   // fails if `failIf` ever holds
  sig?: SignalId; target?: Ref; tol?: TolRef;     // hold, peak, final, atEvent
  peakOf?: 'abs' | 'max' | 'min';                 // peak: default 'abs' deviation
  event?: TrainingEventName; field?: string;      // atEvent
  pred?: Pred; withinS?: number;                  // check
  failIf?: Pred;                                  // binary
  settleS?: number; activeWhen?: Pred;
  required: boolean;                              // in the exercise grade
  safety?: boolean;                               // failing it fails the exercise outright (grade 1) and is listed first
  chart?: boolean;                                // plot in the debrief (default true for hold)
  advice?: { high?: string; low?: string; fail?: string };
}
export type CoachPresetId =
  | 'speed' | 'altitude' | 'heading' | 'bank' | 'ball' | 'trim' | 'levelOff' | 'vs' | 'flapLimit' | 'stallWarning'
  | 'rpmRedline' | 'approachSpeed' | 'centreline' | 'glidepath' | 'flare' | 'crosswindDrift' | 'circuitHeight'
  | 'downwindSpacing' | 'lookout';
export interface CoachRule {
  id: string; topic: string;
  when: Pred;                       // the problem
  afterS: number;                   // must persist (no flicker coaching)
  correcting?: { sig: SignalId; target: Ref };   // suppress while the error is shrinking (section 3.6)
  say: [CueRef, CueRef?, CueRef?];  // escalation: hint, specific, technique
  praise?: CueRef;
  priority: 0 | 1 | 2 | 3;          // 0 safety, 1 energy and path, 2 attitude and balance, 3 refinement
  minLevel: CoachLevel;             // dropped below this coach level (safety rules: 'silent')
  offerDemo?: boolean;              // third rung offers "Show me" ([)
}
export interface FaultRule { id: string; when: Pred; severity: 'minor' | 'major' | 'critical'; cue?: CueRef; once?: boolean; action?: 'note' | 'endTask' | 'takeover' }
```

Coach presets are generic: each binds to the task card target with the matching signal (`speed` -> `asiKt`,
`altitude` -> `altFt`, `heading` -> `hdgDeg`, `bank` -> `aiBankDeg`, `vs` -> `vsiFpm`), so lesson data names a
preset and its card, nothing more. Preset table (section 3.6.3).

### 2.11 Results, profile and logbook

```ts
export type Pattern = 'ok' | 'biasHigh' | 'biasLow' | 'oscillation' | 'drift' | 'late';
export interface CriterionResult {
  id: string; label: string; kind: Criterion['kind']; required: boolean; safety: boolean;
  target?: number; tol?: Tol; testTol?: Tol;
  grade: Grade; testGrade: Grade;
  within: number;                    // 0..1 (hold)
  maxN: number;                      // worst normalised error (|e| / side tolerance)
  worst?: { value: number; dev: number; atS: number };
  excursions: number; longestOutS: number; pattern: Pattern;
  detail: string;                    // 'Within ±150 ft for 91 %; worst 210 ft low at 3:12'
}
export interface ExerciseResult {
  exerciseId: string; title: string; mode: ExerciseDef['mode']; standard: Standard;
  grade: Grade | null; testGrade: Grade | null;      // null: demo or insufficient data
  criteria: CriterionResult[]; attempts: number; interventions: number; faults: FaultRecord[];
}
export interface FaultRecord { id: string; severity: 'minor' | 'major' | 'critical'; atS: number }
export interface FlightTimes {
  blockS: number; airborneS: number; nightS: number; instrumentS: number;
  landingsDay: number; landingsNight: number; takeoffs: number;
}
export interface LessonResult {
  lessonId: string; lessonVersion: number; attemptId: string; authority: AuthorityId;
  startedAt: string; endedAt: string;                 // ISO wall time
  outcome: 'competent' | 'notYet' | 'incomplete' | 'abandoned' | 'crashed' | 'testPass' | 'testPartial' | 'testFail';
  stars: 0 | 1 | 2 | 3;
  exercises: ExerciseResult[];
  interventions: number; handbacks: number; phaseRetries: number;
  flags: { calmAir: boolean; kbdAssists: boolean; instructorSaves: boolean; inputDevice: 'keyboard' | 'mouse' | 'hardware' };
  weatherLine: string;                                // 'Wind 090/7, turbulence light'
  flight: FlightTimes;
  debrief: { strength: string; main: string; next: string; spoken: string[] };
  traceId: string | null;
}

export interface LogbookEntry {
  id: string;                     // uuid
  date: string;                   // wall-clock ISO date
  aircraftType: string; registration: string;
  from: 'KFBL'; to: 'KFBL';
  role: 'dual' | 'solo' | 'pic' | 'test';
  times: FlightTimes;
  lessonId: string | null; lessonVersion: number | null;
  exercise: string;               // 'Ex 7 & 8 Climbing and descending'
  outcome: LessonResult['outcome'] | 'freeFlight'; stars: number | null;
  remarks: string;                // editable
  signedBy: string | null;        // 'K. Mercer FI(A)' for dual; null solo
  stamp?: 'FIRST SOLO' | 'SKILL TEST PASS' | 'NIGHT';
  traceId?: string;
}
export interface LessonProgress {
  status: 'locked' | 'available' | 'competent';
  attempts: number; bestStars: number; lastOutcome: LessonResult['outcome'] | null;
  exercises: Record<string, { best: Grade; last: Grade; competentAt?: string }>;
  bestTraceId?: string; completedAt?: string; lessonVersion: number;
}
export interface TrainingSettings {
  authority: AuthorityId; talkativeness: 'quiet' | 'normal' | 'chatty';
  voice: { instructor: string | null; examiner: string | null; rate: number; volume: number; captions: boolean; captionsOnly: boolean };
  instructorSaves: boolean; liveBars: boolean; autoAck: boolean; logFreeFlights: boolean;
}
export interface TrainingSave {
  format: 'fs-training'; schema: 1; createdAt: string; updatedAt: string; appBuild: string;
  profile: { studentName: string; instructorName: string; licenceNo: string /* 'FBL-0421' */; experienced: boolean };
  settings: TrainingSettings;
  progress: Record<string, LessonProgress>;
  skills: Partial<Record<SkillId, { last5: Grade[] }>>;
  endorsements: { id: EndorsementId; at: string; lessonId: string | null }[];
  logbook: LogbookEntry[];
  results: Record<string, LessonResult[]>;           // last 3 per lesson, traces stored separately
  bests: Record<string, ChallengeBest[]>;            // challenge id -> top 5
  testHistory: { at: string; outcome: 'testPass' | 'testPartial' | 'testFail'; failedSections: number[] }[];
}
export interface ChallengeBest { score: number; at: string; authority: AuthorityId; flags: LessonResult['flags']; traceId?: string }
```

Totals (hours, landings, dual, PIC, night) are always derived from the logbook (`career/totals.ts`), never stored.

### 2.12 Worked example: L04 Climbing and descending (complete)

File `src/training/content/syllabus/phase1.ts` (excerpt with the whole lesson). Line ids refer to
`src/training/content/lines.ts`; the lines used here are listed after the code.

```ts
import type { Lesson } from '../../types';
import { gt, ge, lt, near, held, all, any, ev, elapsed, v, vs, std,
         say, capture, handover, demo, task, setup, end, hold, final, peak, check } from '../../engine/dsl';

const climbTo = (tgtVar: string) => task({
  id: 'climb', exercise: 'climbPractice', pf: 'student',
  brief: { id: 'L04.climbTo', vars: { alt: v(tgtVar) } },               // "Climb to {alt:alt} at Vy. Lookout first."
  card: { title: 'Climb at Vy, level off', targets: [
    { label: 'IAS', sig: 'asiKt', value: vs('Vy'), tol: 'speedClimbApproach', unit: 'kt' },
    { label: 'ALT', sig: 'altFt', value: v(tgtVar), tol: 'altitude', unit: 'ft' },
    { label: 'HDG', sig: 'hdgDeg', value: v('hdg0'), tol: 'heading', unit: 'deg' } ] },
  goal: held(near('altFt', v(tgtVar), 60), 10),
  timeoutS: 240, onTimeout: { demo: 'climbLevelOff', thenRetry: true },
  coach: ['speed', 'heading', 'ball', 'trim', 'levelOff'],
  criteria: [
    hold('climbIas', 'Climb speed', 'asiKt', vs('Vy'), 'speedClimbApproach',
         { settleS: 12, activeWhen: lt('altFt', v(tgtVar, -150)), required: true,
           advice: { high: 'Raise the nose a little: in the climb, speed is controlled with attitude.',
                     low: 'Lower the nose: at full power a low speed means too much attitude.' } }),
    hold('climbHdg', 'Heading', 'hdgDeg', v('hdg0'), 'heading', { settleS: 8, required: true }),
    peak('levelOff', 'Level-off overshoot', 'altFt', v(tgtVar), 'altitude', { peakOf: 'max', required: true,
         advice: { high: 'Start levelling at 10 % of the climb rate: about 50 ft early at 500 fpm.' } }),
    final('levelAlt', 'Altitude after level-off', 'altFt', v(tgtVar), 'altitude', { required: true }),
  ],
});

export const L04: Lesson = {
  id: 'L04', version: 1, number: 4, title: 'Climbing and descending',
  syllabusRef: { easa: 'Ex 7 & 8', faa: 'ACS VI.B-C (basic attitude: climbs, descents)' },
  stage: 'handling', kind: 'dual', persona: 'instructor', requires: ['L03'], aircraft: 'any', estMinutes: 12,
  start: { kind: 'air', at: 'trainingArea', altFt: 2500, altRef: 'msl', hdgDeg: 100, kias: vs('Vcruise') },
  startOptions: { payload: 'forward', fuelFraction: 0.8 },
  weather: { preset: 'smooth' },
  rules: { coachLevel: 'full', autopilot: 'forbidden', maxTimeScale: 1, instructorSaves: true, maxDurationS: 1500 },
  briefing: {
    aim: 'To climb and descend at a chosen speed and rate, and level off at a chosen altitude.',
    points: ['Every change is Attitude, then Power, then Trim (APT); level-off is Attitude, Power, Trim too.',
             'Climb at Vy with full power; the speed is held with attitude.',
             'Begin the level-off at 10 % of the vertical speed: 50 ft early at 500 fpm.',
             'Descents: glide at best glide speed with idle power, or 500 fpm at 90 kt with reduced power.'],
    numbers: [{ label: 'Vy', value: vs('Vy'), unit: 'kt' }, { label: 'Cruise climb', value: vs('Vcc'), unit: 'kt' },
              { label: 'Best glide', value: vs('Vglide'), unit: 'kt' }, { label: 'Descent speed', value: vs('Vdescent'), unit: 'kt' },
              { label: 'Descent rate', value: 500, unit: 'fpm' }, { label: 'Descent power', value: { setting: 'descentRpm' }, unit: 'rpm' }],
    tolerances: ['altitude', 'heading', 'speedClimbApproach', 'speed', 'vs'],
    airmanship: ['Lookout ahead and above before climbing; ahead and below before descending.',
                 'Watch the oil temperature in a long climb: lower the nose if it rises toward the red line.',
                 'The 172S is fuel injected: there is no carburettor heat.'],
    keys: ['throttleUp', 'throttleDown', 'throttleFull', 'pitchUp', 'pitchDown', 'trimNoseUp', 'trimNoseDown'],
    diagram: { kind: 'climb' },
    spoken: 'L04.brief',
  },
  exercises: [
    { id: 'climbDemo', title: 'Demonstration: climb and level-off', skill: 'climb', mode: 'demo', standard: 'training', required: false, weight: 0 },
    { id: 'climbPractice', title: 'Climb at Vy and level off', skill: 'climb', mode: 'practice', standard: 'training', required: false, weight: 1 },
    { id: 'descentPractice', title: 'Glide and powered descents', skill: 'descent', mode: 'practice', standard: 'training', required: false, weight: 1 },
    { id: 'assessedClimb', title: 'Assessed: climb and level-off', skill: 'climb', mode: 'assessed', standard: 'test', required: true, weight: 2 },
    { id: 'assessedDescent', title: 'Assessed: 500 fpm descent and level-off', skill: 'descent', mode: 'assessed', standard: 'test', required: true, weight: 2 },
  ],
  flow: [
    { id: 'demo', title: 'Demonstration', steps: [
      say('intro', 'L04.demoIntro', { wait: true }),            // "I have control. Follow me through. Attitude, power, trim."
      capture('cap0', { alt0: 'altFt', hdg0: 'hdgDeg' }),
      demo('demoClimb', 'climbLevelOff', { followMeThrough: true, highlight: ['ai', 'asi', 'vsi'] }),
      say('demoWrap', 'L04.demoWrap', { wait: true }),          // "Level at {alt:alt}. Power back to 2,300, trimmed."
    ] },
    { id: 'practiceClimb', title: 'Your climb', repeat: { max: 2, until: { exerciseGrade: 'climbPractice', atLeast: 2 } }, steps: [
      handover('toStudent', 'student'),
      capture('capC', { hdg0: 'hdgDeg', a0: 'altFt' }),
      { kind: 'capture', id: 'tgtC', vars: { tgt: v('a0', 1000) } },
      climbTo('tgt'),
      say('climbDone', 'common.goodNowCruise'),                 // "Good. Cruise power, 2,300, and trim."
      task({ id: 'settle', exercise: 'climbPractice', brief: 'L04.settleCruise',
             card: { title: 'Cruise: 2,300 rpm, trimmed', targets: [{ label: 'RPM', sig: 'rpm', value: { setting: 'cruiseRpm' }, tol: 100, unit: 'rpm' }] },
             goal: held(all(near('rpm', { setting: 'cruiseRpm' }, 100), lt('untrimmedS', 1)), 5), timeoutS: 60, onTimeout: 'next',
             coach: ['trim'], criteria: [check('trimmed', 'Trimmed after level-off', { pred: held(lt('untrimmedS', 1), 5), required: false })] }),
    ] },
    { id: 'practiceDescent', title: 'Descents', steps: [
      capture('capD', { a1: 'altFt', hdg0: 'hdgDeg' }),
      { kind: 'capture', id: 'tgtD', vars: { glideTo: v('a1', -500), descTo: v('a1', -1000) } },
      task({ id: 'glide', exercise: 'descentPractice', pf: 'student',
             brief: { id: 'L04.glideTo', vars: { alt: v('glideTo') } },   // "Throttle closed, glide at {vspeed.Vglide:kt}, level at {alt:alt}."
             card: { title: 'Glide at best glide speed', targets: [
               { label: 'IAS', sig: 'asiKt', value: vs('Vglide'), tol: 'speed', unit: 'kt' },
               { label: 'ALT', sig: 'altFt', value: v('glideTo'), tol: 'altitude', unit: 'ft' } ] },
             goal: held(near('altFt', v('glideTo'), 60), 8), timeoutS: 180, onTimeout: 'next',
             coach: ['speed', 'ball', 'levelOff'],
             criteria: [hold('glideIas', 'Glide speed', 'asiKt', vs('Vglide'), 'speed', { settleS: 10, activeWhen: gt('altFt', v('glideTo', 150)), required: true }),
                        peak('glideLevel', 'Level-off', 'altFt', v('glideTo'), 'altitude', { peakOf: 'min', required: true })] }),
      task({ id: 'powered', exercise: 'descentPractice',
             brief: { id: 'L04.descend500', vars: { alt: v('descTo') } },  // "Descend at 500 feet per minute, 90 knots, to {alt:alt}."
             card: { title: '500 fpm at 90 kt', targets: [
               { label: 'IAS', sig: 'asiKt', value: vs('Vdescent'), tol: 'speed', unit: 'kt' },
               { label: 'VS', sig: 'vsiFpm', value: -500, tol: 'vs', unit: 'fpm' },
               { label: 'ALT', sig: 'altFt', value: v('descTo'), tol: 'altitude', unit: 'ft' } ] },
             goal: held(near('altFt', v('descTo'), 60), 10), timeoutS: 200, onTimeout: 'next',
             coach: ['speed', 'vs', 'ball', 'trim', 'levelOff'],
             criteria: [hold('descIas', 'Descent speed', 'asiKt', vs('Vdescent'), 'speed', { settleS: 12, activeWhen: gt('altFt', v('descTo', 150)), required: true }),
                        hold('descVs', 'Descent rate', 'vsiFpm', -500, 'vs', { settleS: 15, activeWhen: gt('altFt', v('descTo', 150)), required: true }),
                        peak('descLevel', 'Level-off', 'altFt', v('descTo'), 'altitude', { peakOf: 'min', required: true })] }),
    ] },
    { id: 'assessed', title: 'Assessed climb and descent', coachLevel: 'silent', steps: [
      say('quiet', 'common.illStayQuiet', { wait: true }),      // "This time I'll stay quiet. Fly it as if I'm not here."
      capture('capA', { a2: 'altFt', hdg0: 'hdgDeg' }),
      { kind: 'capture', id: 'tgtA', vars: { up: v('a2', 1000) } },
      { ...climbTo('up'), id: 'aClimb', exercise: 'assessedClimb', coach: [] },
      { kind: 'capture', id: 'tgtB', vars: { down: v('up', -1000) } },
      task({ id: 'aDescent', exercise: 'assessedDescent',
             brief: { id: 'L04.descend500', vars: { alt: v('down') } },
             card: { title: '500 fpm at 90 kt, level off', targets: [
               { label: 'IAS', sig: 'asiKt', value: vs('Vdescent'), tol: 'speed', unit: 'kt' },
               { label: 'VS', sig: 'vsiFpm', value: -500, tol: 'vs', unit: 'fpm' },
               { label: 'ALT', sig: 'altFt', value: v('down'), tol: 'altitude', unit: 'ft' },
               { label: 'HDG', sig: 'hdgDeg', value: v('hdg0'), tol: 'heading', unit: 'deg' } ] },
             goal: held(near('altFt', v('down'), 60), 10), timeoutS: 200, onTimeout: 'fail',
             criteria: [hold('aDescIas', 'Descent speed', 'asiKt', vs('Vdescent'), 'speed', { settleS: 12, activeWhen: gt('altFt', v('down', 150)), required: true }),
                        hold('aDescVs', 'Descent rate', 'vsiFpm', -500, 'vs', { settleS: 15, activeWhen: gt('altFt', v('down', 150)), required: true }),
                        hold('aDescHdg', 'Heading', 'hdgDeg', v('hdg0'), 'heading', { required: true }),
                        peak('aDescLevel', 'Level-off', 'altFt', v('down'), 'altitude', { peakOf: 'min', required: true }),
                        final('aDescAlt', 'Altitude after level-off', 'altFt', v('down'), 'altitude', { required: true }),
                        hold('aBall', 'Balance', 'ball', 0, 0.5, { required: false })] }),
      end('fin', 'L04.wrap'),                                    // "OK, I have control. Let's head back and talk about it."
    ] },
  ],
  debriefTips: {
    'levelOff.late': 'Anticipate: at 500 fpm start levelling 50 ft before the target.',
    'climbIas.oscillation': 'You were chasing the airspeed. Set the attitude, hold it, wait five seconds, then adjust.',
    'aDescVs.biasHigh': 'The descent was shallow: a little less power, and keep 90 kt with the attitude.',
  },
};
```

The `climbLevelOff` demo script (`src/training/content/demos.ts`):

```ts
export const climbLevelOff: DemoScript = { id: 'climbLevelOff', segments: [
  { kind: 'ap', say: 'L04.demoClimbEntry', ap: { lateral: 'heading', hdgDeg: v('hdg0'), vertical: 'airspeed', kias: vs('Vy'), autoTrim: true },
    set: { throttle: { to: 1, overS: 2 } }, until: all(gt('vsFpm', 400), held(near('kias', vs('Vy'), 4), 5)), timeoutS: 40 },
  { kind: 'ap', say: 'L04.demoLeadLevelOff', ap: {}, until: ge('altFt', v('alt0', 950)), timeoutS: 150 },
  { kind: 'ap', say: 'L04.demoApt', ap: { vertical: 'altitude', altFt: v('alt0', 1000) }, set: { throttle: { to: 0.72, overS: 4 } },
    until: held(near('vsFpm', 0, 100), 8), timeoutS: 40 },
], abortWhen: lt('aglFt', 1500) };
```

Lines added to `lines.ts` for this lesson (each with 1-3 variants): `L04.brief`, `L04.demoIntro`,
`L04.demoClimbEntry` ("Full power. Raise the nose to the climb attitude; let the speed settle at seven four."),
`L04.demoLeadLevelOff` ("Fifty feet to go: start lowering the nose now."), `L04.demoApt` ("Attitude, power,
trim."), `L04.demoWrap`, `L04.climbTo`, `L04.settleCruise`, `L04.glideTo`, `L04.descend500`, `L04.wrap`; shared:
`common.goodNowCruise`, `common.illStayQuiet`.

---

## 3. Engine

### 3.1 Placement in the frame and in the physics step

```
Simulator.frame:
  input -> [autopilot-disconnect rule, unchanged] -> physics.advance (per 1/240 s step:
      autoflight.update -> copilot.update (NEW) -> fm.step -> touchdown/crash events (training listeners capture
      step-exact state)) -> pose, aircraft, camera, sky, terrain, airport -> panel.update
  -> training.update(subsystemDt, wallDt)   (NEW: telemetry, runner, coach, safety, speech, UI models)
  -> ui -> audio -> post
```

- `training.update` runs after `panel.update` because indicated signals need fresh `InstrumentReadings`.
- Sim `dt` is `physics.lastAdvance` (0 while paused or behind the curtain), so pause, curtains and time
  acceleration need no special code in the runner. Speech advances on wall time.
- `TrainingSystem` subscribes to `ctx.events` `touchdown` and `crash`. The handlers run synchronously inside
  `SimPhysics.stepOnce`, so they read `physics.fm.state` at the exact step and build `TouchdownData` (sink rate
  from the event; position, IAS, attitude and drift from the step state).
- The copilot (`StepController`) runs per physics step, after the existing autoflight and before `fm.step`.
  While it is `flying`, `rudderFree` is false (same rule as the autoflight).

### 3.2 The runner

`src/training/engine/runner.ts`:

```ts
export interface RunnerHost {                       // implemented by TrainingSystem and by the headless test host
  reposition(spec: StartSpec, opts?: StartOptions): Promise<void>;   // curtain + resetTo; resolves when flying
  checkpoint(): CheckpointBlob; restore(cp: CheckpointBlob): Promise<void>;
  applyWeather(w: WeatherSpec, seed: number): void;
  copilot: InstructorPilot;
  speech: SpeechScheduler;
  setHood(on: boolean): void; setTimeScaleCap(max: number): void; setAutopilotAllowed(on: boolean): void;
  ui: TrainingUiPort;                               // publishes LessonStripModel, CardModel, DebriefModel
  now(): number;                                    // wall ms
}
export type RunPhase = 'briefing' | 'positioning' | 'running' | 'debrief' | 'ended';
export class LessonRunner {
  constructor(lesson: Lesson, host: RunnerHost, deps: RunnerDeps);   // deps: aircraft, standards, authority, lines, rng, telemetry, bus, settings
  readonly phase: RunPhase; readonly authority: AuthorityFsm; readonly grader: Grader; readonly coach: Coach;
  begin(): Promise<void>;                            // positions behind the curtain, shows the briefing
  startFlight(): void;                               // from the briefing
  update(simDt: number, wallDt: number, src: TelemetrySources): void;
  input(cmd: 'ack' | 'handback' | 'sayAgain' | 'showMe' | 'retryPhase' | 'restartLesson' | 'abandon' | 'skipStep'): void;
  snapshot(): RunSnapshot;                           // resume (section 3.10)
  static restore(lesson: Lesson, host: RunnerHost, deps: RunnerDeps, snap: RunSnapshot): LessonRunner;
  result(): LessonResult | null;
}
```

Per update (only when `phase === 'running'`):
1. `telemetry.sample(src, simDt)`; derived-event detection (`events.ts`) emits onto the training bus.
2. Step `on` handlers (event -> goto), then pending `when`.
3. Authority FSM (handover offers, acknowledgements, interference).
4. Current step behaviour (table below). Demo segments advance when their `until` holds or `timeoutS` passes.
5. Grader samples the active task's criteria (only while authority is `student`, so instructor time is never
   graded).
6. Coach considers remarks; faults evaluate.
7. Safety envelope; it can preempt everything (section 3.8).
8. Step timeout, then the exit outcome.
9. Trace recorder sample (2 Hz) and UI model publication (strip at 10 Hz, card on change).

| Step kind | Behaviour |
|---|---|
| say | Enqueue the cue. `wait`: finish on its `speech.end`; else immediately |
| wait | Finish when `until` holds; `prompt` repeats on Say again |
| capture | Resolve each var (signals read now) and finish |
| setup | Run actions in order (reposition awaits the curtain); finish when all are done |
| handover | Run the FSM; finish when authority matches `to`; `ackTimeoutS` (default 20) -> `onTimeout` |
| demo | Authority instructor, intro cue, run the script; finish on `demo.done` (aborted -> recovery, step result `fail`) |
| checklist | Section 3.5 |
| task | Speak `brief`, publish the card, start criteria, coach, faults, holds. Success: `goal` true and step time ≥ `minS`. A fault with `endTask`/`takeover` -> fail. `timeoutS` -> `onTimeout` |
| branch | Evaluated once at entry: first matching case, else `else` |
| end | Finish the lesson: close accumulators, write the result, go to the debrief |

Exit outcomes: `next` advances (at the end of a phase, `repeat.until` is evaluated; a repeat restores the
phase checkpoint); `retry` re-enters the step (counting `attempts`, then becomes `fail` -> `next`); `goto`
jumps; `{demo, thenRetry}` runs the demo, hands back and re-enters; `instructorTakes` runs `take('plan')`.
Every task and wait step must have a `timeoutS` or sit in a lesson with `maxDurationS` (linter rule), so no
lesson can hang.

### 3.3 Hysteresis and durations

All durations are sim seconds. Defaults: `held` grace 0.25 s; criterion `settleS` 8 s (15 s for criteria
marked as following a level-off or roll-out in their task); coach `afterS` per preset (3-4 s); safety breach
0.5 s (0 s for low-and-slow and g limits); excursion floor 2 s; handover ack repeat 6 s, final prompt 15 s;
student interference 1 s. Hysteresis comes from the signal definition unless the predicate overrides it.

### 3.4 Grading

`src/training/grading/*` (pure).

**Hold criteria.** For each frame with `simDt > 0`, authority `student`, after `settleS`, while `activeWhen`:
`e = x - target` (wrapped for angles); `n = e > 0 ? e / tol.plus : -e / tol.minus`, with a floor of 0.5 unit on
a zero-sided tolerance. Accumulate time-weighted: within (n ≤ 1), maxN, worst (value, time), mean e, mean n²,
sign changes of e with |n| > 0.5, a least-squares slope of e, and excursions (contiguous n > 1 of ≥ 2 s, with
duration and peak). The same samples are evaluated against the **test** tolerance in parallel, giving
`testGrade`.

| Grade | Hold rule |
|---|---|
| 4 Excellent | within ≥ 0.98 and maxN ≤ 0.6 |
| 3 Good | maxN ≤ 1.0 |
| 2 Satisfactory | maxN ≤ 1.5, within ≥ 0.90, and longest excursion ≤ 5 s (`test`, `commercial`) or ≤ 10 s (`training`): "deviations recognised and promptly corrected" |
| 1 Not yet | otherwise |

Fewer than 5 s of sampled time: no grade ("insufficient data"); a required criterion without a grade makes the
exercise ungraded, and the instructor repeats the task.

**Peak, final, atEvent:** n ≤ 0.6 -> 4; n ≤ 1 -> 3; on `training` only 1 < n ≤ 1.25 -> 2; else 1. On `test`
and `commercial` anything above tolerance is 1: a check ride has no "nearly".

**Check:** 3 if done in time, 1 if not. **Binary:** 3 unless `failIf` ever held, then 1.

**Exercise grade = minimum over its required criteria** (not an average) across the task steps that scored it
in the attempt. Safety criteria and critical faults force 1. Fault caps: two or more minor faults cap at 3; a
major fault caps at 2. An intervention during an assessed exercise makes it 1. The best attempt within a lesson
run counts (instructors grade the standard achieved), except in check and test lessons where the first flight
of each item counts (section 4.5 for the examiner's repeat rule).

**Lesson outcome:**
- `competent` when every required exercise has grade ≥ 2, in this run or a previous run of the same lesson
  version (exercise sign-offs carry over), and the lesson's assessed exercises in this run had no intervention.
  Check and test kinds require everything within one run.
- `notYet` otherwise; `crashed`, `abandoned`, `incomplete` as named.

**Stars** (only when competent): 1 = competent; 2 = every required exercise ≥ 3; 3 = every required
exercise 4, no coaching remark in assessed phases, no phase retries, no interventions. Calm-air variant or
retries cap at 2.

**Overall impression:** weighted mean of exercise grades, shown as one labelled line only.

**Patterns** (per hold criterion): `biasHigh`/`biasLow` when |mean e| > 0.4·tol with consistent sign;
`oscillation` with ≥ 4 qualifying sign changes per minute; `drift` with |slope| > 0.5·tol per minute; `late`
when first entry into tolerance after the target changed took > 2·settleS; else `ok`.

**Debrief** (`grading/debrief.ts`): at most 6 sentences on screen; the spoken part is the outcome line plus the
main point (≤ 25 s).
1. Safety items first ("You continued an unstable approach below 300 feet: that's a go-around every time.").
2. Outcome line.
3. Strength: the best graded required criterion with grade ≥ 3 ("Climb speed held within 4 knots."). Never
   praise a criterion below 3; if none, "You kept at it".
4. Main point: the criterion with the largest `weight × (4 − grade)`, quoting the measured value against the
   tolerance, with the tip from `debriefTips[criterion.pattern]`, else the criterion's advice, else the generic
   pattern tip.
5. Next time: the lesson's look-ahead line.

**Landing grader** (`grading/landing.ts`, fed by `LandingDetector`): a landing starts below 50 ft AGL on final and
ends on the ground for 3 s or airborne above 20 ft. Items (each a criterion graded with the standard rules):
sink at first main contact vs `sinkFpm`; `distAimFt` vs `touchdownZoneFt`; main-gear `rwyAcrossM` vs
`centrelineM`; drift at contact ≤ 5° (`training` 8°); first wheel (binary: nose first fails; safety); bounces
(binary: > 1 or > 3 ft fails); speed at 50 ft vs Vref with `speedClimbApproach`; on runway (safety). A crash
ends the landing as grade 1.

**Stall-recovery grader** (`grading/stall.ts`): height loss from `stallBreak` (or the warning, for incipient
recoveries) to positive climb vs `stallHeightLossFt`; recovery start > 2 s after the warning caps at 2;
secondary `stallBreak` within 10 s is a safety fail; bank during recovery > 20° caps at 2.

**Unusual-attitude grader** (`grading/unusual.ts`): nose-low: throttle reduced and wings rolled within 15° of
level before g exceeds 1.5; nose-high: power added and nose lowered before IAS falls below Vs1+5; g ≤ 3.0;
IAS < Vne; level attitude within 8 s.

### 3.5 Checklists

- `challengeResponse`: the instructor reads each challenge ("Mixture?"). The item completes when its `check`
  becomes true within 10 s, or on Enter for items without a check (caption `YOU: Rich`). An item already true
  needs one Enter to confirm. A missed item is recorded (`ok: false`) and the instructor says the response
  ("Mixture rich, please").
- `flow`: items in any order; complete when all checks are true or on Enter; missed items reported.
- `silent` (solo, check, test): observed only. A checklist whose `when` passes without being done is a fault
  (taking off without the `beforeTakeoff` items is major).
- Grade: 4 none missed; 3 one non-critical missed or late; 1 a critical item missed.

### 3.6 Coach

`src/training/engine/coach.ts`. Candidates come from the task's `coach` rules (presets bound to card targets).

#### 3.6.1 When a remark is made

A candidate is spoken only when all of these hold:
1. Its `when` has held for `afterS` (3 s; 1.5 s when n > 1.5 for target-based presets).
2. The task's criteria are past their settle time.
3. **Not already correcting:** for target-based rules, the remark is suppressed when `d|e|/dt < 0` (filtered
   rate from the signal's `rateTau`) and the projected time back inside tolerance,
   `(|e| − tolSide) / |d|e|/dt|`, is under 6 s.
4. No remark on this topic in the last 25 s (× talkativeness factor).
5. No unprompted remark of any kind in the last 8 s, and at most 3 in the last 60 s.
6. Rule priority allowed by the coach level: `full` all; `reduced` 0-2 with a 10 s gap; `minimal` 0-1 with a 15
   s gap; `silent` 0 only.
7. The voice is idle or the remark outranks what is playing (Safety only).

Selection: highest priority (lowest number), then the longest-active. Escalation per rule within a task: rung 1
hint -> rung 2 specific -> rung 3 technique (plus "Show me" offer when `offerDemo`). The rung resets after the
condition is clear for 20 s. Praise: once per phase, once per 90 s, after a correction is fixed or after 30 s with
every chip green ("That's better", "Nicely held, within 30 feet").

#### 3.6.2 Chips (silent, continuous)

Each card target shows a chip: green n ≤ 0.6, amber 0.6 < n ≤ 1, red n > 1. Chips are hidden in assessed
exercises when `liveBars` is off or the phase coach level is `silent`.

#### 3.6.3 Preset catalogue (`content/coachPresets.ts`)

| Preset | Condition | Rungs (captions) | Priority |
|---|---|---|---|
| speed | IAS target n > 0.7 | "Speed's {dir}, {asiKt:kt}." / "Nose {up/down} a touch; let the speed settle." / "Attitude first: set it, hold it, wait for the speed." | 1 |
| altitude | ALT n > 0.7 | "{dev:alt}." / "Small pitch change, then trim." / "Pick an attitude on the horizon and hold it." | 1 |
| vs | VS n > 0.8 | "Rate's {vsiFpm:fpm}, we want {target:fpm}." / "Adjust the power for the rate, attitude for the speed." | 1 |
| heading | HDG n > 0.7 | "Heading's drifting {side}, {hdgDeg:hdg}." / "Pick a point on the horizon." | 3 |
| bank | bank target n > 0.8 | "Bank {aiBankDeg:deg}, we want {target:deg}." / "Check the attitude indicator." | 2 |
| ball | \|ball\| > 0.35 for 3 s | "Ball's out {side}." / "{Side} rudder: step on the ball." | 2 |
| trim | untrimmedS > 10 | "You're holding pressure. Trim it out: Home or End." | 3 |
| levelOff | within 1.2 × 10 % of VS of the target and no pitch change started | "Start levelling now." / "Lead by 10 % of your rate: about {lead:alt} early." | 1 |
| flapLimit | flaps 10° above 110 kt, or > 10° above 85 kt | "Watch the flap limit: speed back below {limit:kt}." | 0 |
| stallWarning | stallWarn outside a stall exercise | "Stall warning: lower the nose, add power." | 0 |
| rpmRedline | rpm > 2700 | "Watch the RPM, red line." | 0 |
| approachSpeed | on final, IAS vs Vref outside speedClimbApproach | "Speed {asiKt:kt}, we want {vspeed.Vref:kt}." | 1 |
| centreline | final, \|rwyAcrossM\| > 15 | "Drifting {side} of the centreline." / "More into wind." | 1 |
| glidepath | final > 1 NM, \|gpDevFt\| > 100 | "You're {dev:alt} on the slope. Check the PAPI." / "Power for the slope, attitude for the speed." | 1 |
| flare | below 20 ft AGL: sink > 400 fpm | "Hold it off... hold it off." | 0 |
| crosswindDrift | final, \|driftDeg − crab needed\| > 3 | "You're drifting {side}; more into wind." | 1 |
| circuitHeight | downwind, \|hafFt − 1000\| > 100 | "Circuit height is {target:alt}; you're {dev:alt}." | 1 |
| downwindSpacing | downwind offset outside 0.6-1.1 NM | "You're {close/wide} on downwind; aim the wingtip just along the runway." | 2 |
| lookout | before a turn task entry with no turn of the head (not modelled): skipped in v1, data kept | — | 3 |

### 3.7 Speech

#### 3.7.1 Scheduler (`src/training/speech/scheduler.ts`, pure, fake-clock tests)

```ts
export interface SpeechRequest {
  id: string; actor: ActorId; channel: Channel; caption: string; speak: string;
  priority: Priority; interrupt: boolean; resumable: boolean; ttlMs: number; key?: string; cooldownMs?: number;
}
export interface Caption { id: string; actor: ActorId; channel: Channel; text: string; atWall: number; atSim: number; spoken: boolean }
export interface SpeechBackend {
  readonly kind: 'webspeech' | 'captions';
  ready(): Promise<boolean>;
  speak(text: string, voice: VoiceProfile, cb: { onStart(): void; onEnd(): void; onError(e: string): void }): void;
  cancel(): void; pause(): void; resume(): void;
}
export class SpeechScheduler {
  constructor(backend: SpeechBackend, now: () => number);
  enqueue(r: Omit<SpeechRequest, 'id'> & { id?: string }): string;
  cancel(match: { id?: string; key?: string; actor?: ActorId; priorityAtLeast?: Priority }): void;
  update(): void; pause(): void; resume(): void; flush(): void;    // flush: curtain / reposition
  busy(channel?: Channel): boolean; idle(actor?: ActorId): boolean;
  readonly transcript: readonly Caption[];                           // last 200
  onCaption?: (c: Caption) => void;
  onEvent?: (e: 'start' | 'end', r: SpeechRequest, result?: 'done' | 'interrupted' | 'dropped') => void;
  setBackend(b: SpeechBackend): void;
}
```

Rules:
1. One utterance at a time on one synthesiser.
2. Order: priority, then age. On dequeue, an expired request is dropped (`speech.end: dropped`).
3. Dedupe: a request with a queued `key` replaces it; a `key` spoken within `cooldownMs` is dropped.
4. Preemption: Safety preempts anything; `interrupt` preempts lower priorities. A preempted request goes back to
   the head if `resumable` (Instruction default true) and its TTL allows; otherwise `interrupted`.
5. Channels: while `radio` is busy, cabin requests below Safety wait (unused in step 1, required for step 3).
6. Gaps: 250 ms between utterances; 600 ms after a radio transmission.
7. Pause: the current utterance is cancelled and requeued at the head with a fresh TTL if resumable.
   Curtain/reposition: `flush()`.
8. Captions appear on **start** of an utterance and stay 3 s after its end (8 s in captions-only mode).

#### 3.7.2 Backends

- `webSpeech.ts`: waits for `voiceschanged` (1.5 s timeout); picks voices by persona preference (section 1.4)
  or the player's choice; splits text into sentences; calls `cancel()` before `speak()` after any pause or
  cancel; a watchdog ends an utterance after `1.5 × estimate + 2 s` (estimate = 0.35 s + words / 2.7 per s,
  scaled by 1/rate); `onerror` 'interrupted' or 'canceled' counts as an end; 3 other errors switch to captions
  with a toast. `speechSynthesis.pause()`/`resume()` follow the sim pause; `pagehide` cancels.
- `captionBackend.ts`: timer-driven with the same estimate (minimum 1.5 s) so pacing is identical. Used when
  `speechSynthesis` is missing, when no voice exists 3 s after the first user gesture, or with `captionsOnly`
  or `voice=0`. Toast once: "No speech voices available. The instructor will use captions. (Linux: install
  speech-dispatcher and a voice.)"
- Audio: `AudioSystem.setDuck(amount: number)` lowers the engine/air bus by up to 6 dB with a 150 ms ramp while
  cabin speech plays; `AudioSystem.chime(kind: 'intercom' | 'caption' | 'radio')` plays a 15 ms filtered noise
  click before instructor lines, a soft two-tone chime for new Instruction/Safety lines in captions-only mode,
  and a squelch tail for radio (step 3). Both are synthesised in the existing AudioContext; the worklet does not
  change.

#### 3.7.3 Phraseology (`speech/phraseology.ts`, pure)

`render(template, vars, ctx) -> { caption, speak }`:
- Headings digit by digit: 70 -> "070" / "zero seven zero"; 360 -> "360" / "three six zero".
- Altitudes: 3,500 -> "3,500 ft" / "three thousand five hundred feet"; 2,450 -> "two thousand four hundred and
  fifty feet". Deviations: "160 ft high" / "a hundred and sixty feet high".
- Speeds: "74 kt" / "seventy-four knots". V-speed names spoken "V Y", "V ref".
- Rates: "500 fpm" / "five hundred feet per minute". RPM: "two thousand three hundred R P M".
- Runway: "runway zero seven". QNH: "one zero one three". Frequencies (step 2): "one one niner decimal one".

### 3.8 Safety envelope and intervention

`src/training/engine/safety.ts`.

```ts
export interface SafetyEnvelope {
  maxBankDeg: number;            // 60 (L07: 60, steep turns: 65)
  maxPitchUpDeg: number;         // 25
  maxPitchDownDeg: number;       // -25
  maxKias: number;               // Vno + 11 = 140
  maxG: number; minG: number;    // 3.3 / 0.0
  minAglFt: number;              // 1000 outside lowLevel phases (upper-air lessons set 1500)
  lowAndSlow: { aglFt: number; belowKias: Ref };      // 300 ft, Vs1 + 5: immediate
  maxSinkFpmBelow200: number;    // 1000
  stallAllowed: boolean;         // false except L06/L07 above 2,000 ft AGL
  runwayExcursionM: number;      // |rwyAcrossM| > 13 on the ground above 15 kt
}
```

A breach that lasts 0.5 s (0 s for low-and-slow and g) in a lesson with `instructorSaves`:
1. Speech: "I have control!" at Safety (interrupts).
2. `authority.take('intervention')`; the copilot runs the recovery script:
   - nose low (pitch < −10° or IAS > Vno): throttle idle, roll wings level (`lateral: 'bank', bankDeg: 0`,
     `maxBankDeg` 60), pitch ramp to 0° until |bank| < 10° and VS > −500 fpm;
   - slow or stalled (stallFrac > 0.1 or IAS < Vs1): pitch −3°, full power, wings level until IAS > Vs1 + 15;
   - low (below the minimum height, or low-and-slow, or sink limit): full power, wings level, airspeed mode at
     Vy; flaps up a stage above Vfe or after 5 s of positive climb;
   - on the ground: idle, brakes, the autoflight's centreline rudder;
   - then hold: altitude capture at the present altitude, cruise speed, autothrottle.
3. Stable (wings ±5°, IAS 65-100 kt, VS ≥ 0, AGL > 500 ft) for 5 s: "OK, that was getting away from us." One
   short reason line. The task fails with an intervention; the runner offers "Let's try that again" (restores
   the phase checkpoint). Two interventions in one lesson end it ("That's enough for today; we'll talk it
   through on the ground").
4. Solo, check and test kinds: no recovery. Faults are recorded and the physics decides. In the test the
   examiner says "I have control. We'll stop the test there" only for imminent danger (low-and-slow,
   terrain), and the result is `testFail`.

The recovery script is a constant in `content/demos.ts` and is flown in node tests from seeds: 60° bank
nose-low spiral at 120 kt, 25° nose-up at 55 kt, wing drop at the stall, low-and-slow on final.

### 3.9 Copilot (instructor-pilot) and demo mode

`src/training/copilot/instructorPilot.ts` (node-safe):

```ts
export interface StepController { readonly flying: boolean; update(h: number, s: AircraftState, c: ControlInputs): void }
export class InstructorPilot implements StepController {
  readonly autoflight: Autoflight;                    // own instance (owns its own Autopilot); the student's KAP state is untouched
  get flying(): boolean;                              // authority instructor, or a demo/recovery running
  run(script: DemoScript, evalCtx: () => EvalContext): void;   // segment progression is driven by the runner's predicate evaluation
  holdHere(): void;                                   // wings level, hold altitude and speed
  recover(kind?: 'auto'): void;
  setHolds(h: Holds | null): void;                    // applied every step, even while the student flies
  stop(): void;
  readonly segmentIndex: number; readonly segmentT: number;
}
```

- `ap` segments convert `DemoAp` (degrees, kt, ft, fpm, with DG offset for headings) into
  `autoflight.autopilot.settings` and call `autopilot.update` directly; `set` writes and ramps controls.
- `autoflight` segments call `autoflight.engage(plan, s, c)` and `update`: the existing take-off, hold,
  approach, flare and rollout code (runway 07).
- `raw` writes fixed control positions; `pulse` deflects one control for `holdS` and returns it (effects of
  controls).
- Flap changes use the profile's detent lever values.
- `src/sim/autoflight.ts` exports `trackHeading` and `centrelineRudder` (no behaviour change) for the ground
  recovery.
- Demos only use in-envelope manoeuvres: stalls are entered by the autopilot-levelled entry, which round 5
  showed is benign, and recovered at the break; no deep stall is held.

### 3.10 Pause, reset, checkpoints, crash and resume

| Situation | Behaviour |
|---|---|
| Pause (P, menu open) | Sim dt 0, so the runner freezes. Speech pauses (resumable lines requeued). Captions stay |
| Briefing / debrief screens | The sim is held (`holding`), the runner is in `briefing`/`debrief` |
| Checkpoint | At each phase entry with a task: `{ flight: physics.captureSnapshot(...), runner: runner.snapshot(), traceOffset }` in memory (about 4 kB). The latest also goes to `fs.training.v1.checkpoint` |
| Shift+R in a lesson | "Try again from the start of this phase": curtain, `physics.restore(checkpoint.flight)`, runner restore, trace truncated, `phaseRetries++`. Shift+R outside a lesson is unchanged |
| Menu "Restart lesson" | Back to the briefing, positioned at the lesson start; a new attempt |
| Menu scenario buttons or `__sim.reset` during a lesson | Confirm "Abandon the lesson?"; on yes the lesson ends `abandoned` with a logbook line (dual time flown) and free flight starts |
| Crash, dual lesson | The generic crash dialog is replaced by the lesson crash panel: Debrief (default, Enter), Try again from checkpoint, Restart lesson. Outcome `crashed` |
| Crash, solo/check/test | Lesson ends `crashed` or `testFail`; debrief on the ground |
| Time scale | `setTimeScale` is clamped to the active phase cap with a toast "Lesson: time acceleration limited to 1x" |
| Autopilot (A) | Refused when `rules.autopilot === 'forbidden'` with the toast "Not in this exercise" |
| Reload mid-lesson | `FlightSnapshot` schema 2 carries `training: { lessonId, lessonVersion, run: RunSnapshot, start: StartSpec, checkpoint: CheckpointBlob \| null }`. Boot: the flight resumes, the runner is rebuilt with `LessonRunner.restore`, the current step restarts (its open accumulators are discarded), and the instructor says "Right, where were we." The debrief notes "(trace interrupted)". If the lesson version changed, the lesson restarts from its briefing |
| Snapshot too old (12 h) with a training block | The home screen offers "Resume lesson from the last checkpoint" using `fs.training.v1.checkpoint` |

```ts
export interface RunSnapshot {
  lessonId: string; lessonVersion: number; attemptId: string;
  phaseId: string; phaseRepeat: number; stepId: string; stepAttempt: number;
  vars: Record<string, number>; authority: 'student' | 'instructor'; holds: Holds | null;
  exercises: Record<string, ExerciseResult[]>;     // closed attempts
  faults: FaultRecord[]; interventions: number; handbacks: number; phaseRetries: number;
  flightTimer: FlightTimerState; startedAt: string; elapsedSimS: number; weatherSeed: number;
}
```

### 3.11 Persistence

`src/training/career/store.ts`, using the `KeyValueStore` / `browserStore()` pattern of `resume.ts`; every
access in try/catch. URL `tstore=mem` uses an in-memory store (scripts and tests).

| Key | Content | Size |
|---|---|---|
| `fs.training.v1` | `TrainingSave` (schema 1) | 20-150 kB |
| `fs.training.v1.prev` | the previous good `TrainingSave` | same |
| `fs.training.v1.backup.s<N>` | written once before migrating from schema N | same |
| `fs.training.v1.trace.<id>` | encoded trace | about 45 kB |
| `fs.training.v1.traceIndex` | `{ id, kind: 'best' \| 'latest' \| 'challenge', lessonId, at }[]` | small |
| `fs.training.v1.checkpoint` | latest checkpoint of the running lesson | about 6 kB |
| `fs.training.v1.welcomeDismissed` | '1' | |

- **Save** on lesson end, logbook edit, settings change (debounced 500 ms) and `pagehide`: copy the current
  value to `.prev`, write, read back and parse. On `QuotaExceededError`: evict traces (below) and retry once;
  then keep in memory and show a banner "Progress can't be saved in this browser; use Export".
- **Trace budget 2.5 MB:** keep best + latest per lesson, top challenge traces, and traces linked from the last
  20 logbook lines; evict `latest` traces whose lesson also has a `best`, oldest first.
- **Load:** parse and validate with hand-written guards (style of `validateSnapshot`). Invalid entities (one
  logbook line, one result) are dropped with a console warning, not the whole file. Corrupt file: fall back to
  `.prev` with a toast. `schema` older: run `MIGRATIONS[n]` in order after writing the backup. `schema` newer:
  read-only with a banner.
- **Export:** a Blob download `fs-training-<student>-<yyyy-mm-dd>.json` containing
  `{ format: 'fs-training', version: 1, exportedAt, app: { build }, data: TrainingSave, traces?: Record<id, string> }`
  ("Include traces" checkbox, default on).
- **Import:** file input -> parse -> validate -> migrate -> preview (name, lessons competent, hours, landings)
  -> **Replace** or **Merge**. Merge: logbook union by `id`; per lesson the better progress (status, then
  stars, then attempts max); per exercise the best grade; endorsements union with the earliest date; bests
  merged and re-trimmed to 5; the newer profile and settings. Nothing is written before the choice; invalid
  files are rejected with a reason.
- **Trace encoding** (`grading/trace.ts`): 2 Hz channels `t, altFt, asiKt, hdgDeg, aiBankDeg, vsiFpm, pitchDeg,
  aglFt, north, east, throttle, flapsDeg, gpDevFt, rwyAcrossM, authority`; `Int16Array` with per-channel scale
  and offset, base64. Bands `{ sig, fromS, toS, target, minus, plus, taskId }` and events `{ t, type, label }`
  (lift-off, touchdown with sink, stall warning, interventions, coach remarks with caption text, handovers,
  phase boundaries) are stored alongside. Demo spans are marked and drawn greyed.

**Logbook timer** (`career/logbook.ts`): block = engine running with movement (or lesson start if airborne or
running) to engine stop or lesson end; airborne = no wheel on the ground for 2 s until the last touchdown;
landings = `landing` events (full stop or touch-and-go); night = sun elevation < −6°; instrument = hood on or
`imc` weather while airborne; role: dual for `dual` and `check`, solo for `solo`, test for `test`. Free flights
are logged when "Log free flights" is on and the flight had ≥ 60 s airborne (role `pic` after the PPL, `solo`
before, remark "free flight"). Time is sim time.

---

## 4. Syllabus

Airfield KFBL: runway 07/25, 1,800 m × 30 m, elevation 394 ft (120 m), circuit height 1,394 ft MSL (1,000 ft
AAL), left-hand circuits for 07, downwind north-west of the field. All lessons fly runway 07 in v1. Speeds come
from the aircraft profile; tolerances are keys from section 2.2 (T = `training` standard, otherwise the
exercise is `test`). Phase coach levels in brackets.

### 4.1 Lessons

**Stage 1: Handling (dual, training area unless stated)**

| # | Lesson (EASA / ACS) | Objective | Start, weather | Exercises and pass standard (required in bold) |
|---|---|---|---|---|
| L01 | Effects of controls (Ex 3-4 / ACS I) | Know what each control does; trim the aircraft hands-off | air trainingArea 3,500 ft MSL, 100 kt; `calm` [full] | Demo primary effects (pulses with commentary), further effects (rudder->roll, aileron->adverse yaw, power->pitch/yaw, flap->pitch, trim). **Your turn: pitch ±5°, bank 15° and level, yaw and centre the ball** (check criteria). **Trim hands-off 30 s: untrimmedS = 0 and altitude ±200 (T)**. A familiarisation lesson never fails on technique |
| L02 | Ground: start, taxi, power checks, shutdown (Ex 2, 5 / ACS II.C-F) | Start the engine by the checklist, taxi safely, do the run-up | ground parking, cold; `calm` [full] | **Start checklist** (challenge/response, items verified from state; starter ≤ 10 s; oil pressure within 30 s). **Taxi to hold A1**: GS ≤ 15 kt (peak), brake check in first 50 m (check), stay on paved surfaces (binary `onPaved`), **stop before the hold line** (binary, safety). **Run-up**: 1,800 ±100 rpm, each magneto selected ≥ 3 s then BOTH (check); measured drop recorded and graded against 150/50 (not required); **before-take-off checklist**; shutdown checklist at the end (repositioned to parking) |
| L03 | Straight and level (Ex 6 / ACS VI.A) | Hold altitude, heading and speed at cruise and at reduced speed | air 3,500 ft, 105 kt; `smooth` [full] | Demo APT. Practice 2 min at cruise (T). Practice 80 kt clean (1,900 rpm) and 70 kt flap 20 (T). **Assessed 2 min with a mid-task speed change 105 -> 85 kt: alt, hdg, speed at test** |
| L04 | Climbing and descending (Ex 7-8 / ACS VI.B-C) | Climb at Vy, glide, 500 fpm descents, level-offs | air 2,500 ft, 105 kt; `smooth` [full -> silent] | Section 2.12. **Assessed climb**: IAS Vy `speedClimbApproach`, heading, level-off overshoot and final altitude `altitude`. **Assessed descent**: 90 kt `speed`, −500 `vs`, heading, level-off |
| L05 | Medium turns (Ex 9 / ACS VI.D) | Level, climbing and descending turns onto headings | air 3,500 ft, 100 kt; `light` [reduced] | Demo 30° turn and roll-out lead. Practice 360s left and right (`turned: 360`) and turns onto headings (T). Climbing turn 15° at Vy, descending glide turn 30°. **Assessed: 360 left and right at 30°: bank `bankMedium`, alt, speed, rollout** |
| L06 | Slow flight (Ex 10A / ACS VII.A) | Fly at Vslow with full control, clean and full flap | air 4,000 ft, 90 kt; `calm` [reduced]; stall warning allowed (coached, not a safety item) | HASELL challenge/response. Demo. Practice. **Assessed: Vslow `slowFlightSpeed`, alt, hdg, gentle turns bank 15 ±10; stall warning held > 2 s fails (binary)** |
| L07 | Stalling (Ex 10B / ACS VII.B-C) | Recognise the approach to the stall and recover at the incipient stage and at the stall, clean and in the approach configuration | air 4,500 ft, 90 kt; `calm`; `payload: forward`; envelope stallAllowed, maxBank 60, minAgl 2,500 [reduced] | HASELL with **clearing turn ≥ 180° within 120 s before each entry** (check, safety in the assessed exercise). Demo power-off clean stall (autopilot-levelled entry, recovery at the break). Practice: recover at the warning (incipient), then at the break, clean and flap 30 at 1,500 rpm. **Assessed: two stalls: stall grader (height loss `stallHeightLossFt`, recovery start ≤ 2 s, no secondary stall, bank ≤ 20° in recovery), hdg ±`heading` to the break, g ≤ 2.5, flaps retracted only above Vx**. Spins: briefed (PARE) only, not flown |

**Stage 2: Circuits and first solo (runway 07)**

| # | Lesson | Objective | Start, weather | Exercises and pass standard |
|---|---|---|---|---|
| L08 | Take-off and climb (Ex 12 / ACS IV.A) | Normal take-off, Vy climb, after-take-off checks | ground lineup07 running; `light` [full] | Demo (`autoflight: takeoff`, commentary). Practice ×2 with reposition (T). **Assessed: centreline on the roll ±`centrelineM` (hold until lift-off), rotate at Vr −0/+10 (atEvent liftoff), climb Vy `speedClimbApproach` from 200 ft AGL, track runway heading ±`heading`, before-take-off checks, flaps 0 and landing light on (check)** |
| L09 | Approach and landing (Ex 13 / ACS IV.B) | Stabilised final, flare, hold-off, touchdown in the zone | final 3 NM, 75 kt, flap 20; `light` [full -> reduced] | Demo landing (`autoflight: approach`, follow me through). Practice ×3, repositioned to final after each full stop (T). **Assessed ×2: stabilised gate at 300 ft AAL (Vref `speedClimbApproach`, \|across\| < 45 m, flaps 30, sink < 1,000 fpm; unstable continued below 200 ft = safety), landing grader at test, 3° path `glidepathFt` beyond 1 NM** |
| L10 | The circuit (Ex 13 / ACS III.B) | Fly a full circuit to a landing | ground lineup07; `light` [reduced] | Demo one circuit (copilot DemoScript: upwind to 500 ft AAL, crosswind, downwind at 1,000 AAL, 2,200 rpm, 90 kt, downwind checks, abeam threshold flap 10 and 1,500 rpm, base flap 20, final flap 30 at Vref, `autoflight: approach`). Practice: 2 circuits with full stop (T). **Assessed ×2: circuit height ±`altitude` on downwind, downwind offset 0.6-1.1 NM, downwind checklist (flow; fuel selector BOTH and mixture rich critical), approach speed, stabilised gate, landing grader**. Each safe assessed landing increments `records.safeLandings` |
| L11 | Go-arounds, flapless and glide approaches (Ex 13 / ACS IV.B, IV.N) | Go around from an unstable approach; land without flap and without power | final 1 NM / downwind abeamMid; `light` [reduced] | Demo go-around from 200 ft. **Go-around on call** (random 300-100 ft): `goAround` within 3 s, VS > 0 within 8 s, IAS ≥ Vx (peak min), flaps not fully up below 60 kt (binary), hdg ±10 of runway. **Unstable set-up** (final 1 NM, 150 ft high, 85 kt, flap 10, instructor silent): competent if the student goes around before 300 ft AAL or is stable by the gate and lands within tolerances. **Flapless landing** (VappFlapsUp, touchdown zone, sink). **Glide approach** (power idle abeam the aim point; touchdown in the first third: `distAimFt` ≤ +600) |
| L12 | Circuit emergencies (Ex 12E, 13E / ACS IX.B) | Engine failure after take-off and on downwind | ground lineup07 / downwind; `light` [reduced] | Brief. Demo EFATO (hold throttle 0 at 500 ft AGL; glide straight ahead; touch drills; go-around called at 200 ft, hold released). **EFATO ×2: IAS ≤ Vglide + 10 within 4 s (check), Vglide `speed` (hold), heading within ±30° of runway track (peak), no turn-back below 700 ft AGL (binary safety: `turned` > 90 below 700), engine-failure touch drills (flow: fuel selector BOTH, mixture RICH, mags BOTH, fuel pump ON) within 20 s, go-around on call**. **Engine failure on downwind (hold at the downwind midpoint): reach the runway** (projected glide at 500 ft AAL inside the touchdown zone, or landing on the runway) |
| L13 | Pre-solo progress check (Ex 14 prep; gate) | Show you are safe to fly solo | ground lineup07; `light`, wind ≤ 10 kt [silent]; kind `check`, instructor saves on (an intervention fails the check) | One circuit to land; one circuit with a go-around on call; one EFATO; one glide approach. All at test standard in one run. Gate: L08-L12 competent, `safeLandings` ≥ 3, no intervention in the last two dual lessons |
| L14 | First solo (Ex 14) | One circuit, full-stop landing, alone | ground holdA1 running; `calm` (wind ≤ 6 kt within 30° of 07); kind `solo` | Briefing on the ground by Kate ("One circuit, full stop. The aircraft climbs better without me; expect it."). **Solo circuit: stabilised gate, landing safe (sink ≤ 600, on runway, mains first), circuit height ±`altitude` at training**. Award `firstSolo`: ceremony card, logbook stamp FIRST SOLO, role solo |

**Stage 3: Advanced (dual unless stated)**

| # | Lesson | Objective | Start, weather | Exercises and pass standard |
|---|---|---|---|---|
| L15 | Steep turns and spiral-dive recovery (Ex 15 / ACS V.A) | 360° turns at 45° within test limits; recover from a spiral dive | air 4,000 ft, 95 kt; `smooth`; envelope maxBank 65 [minimal] | Demo steep turn (autothrottle, back pressure). Practice. Demo spiral set-up (bank 50°, nose −15°, idle) then "You have control: recover": IAS peak ≤ Vno, g peak ≤ 3.0 (safety 3.3), wings level within 4 s. **Assessed: 360 left and right at 45°: bank `bankSteep`, alt, speed (VsteepTurn `speed`), rollout ±`rollout`; clearing turn check** |
| L16 | Forced landing without power (Ex 16 / ACS IX.B) | Plan and fly a glide to a chosen field (the runway) | air pflHighKey 3,000 ft AAL; `light`; phases lowLevel [minimal] | Brief (diagram: high key 2,000 ft AAL abeam the upwind end, low key 1,000 ft abeam the threshold). Demo. Practice ×2 with throttle hold; go-around called at 200 ft. **Assessed (start abeam the field 2 NM out, 3,000 ft AAL): Vglide −5/+10 (hold), touch drills within 60 s (flow), high key 1,700-2,300 ft AAL and low key 800-1,200 ft AAL (atEvent at the key points), security checks on final (flow; restored by the instructor before the go-around), outcome: at the go-around call the projected glide reaches the touchdown zone (threshold to mid-runway)** |
| L17 | Crosswind circuits (ACS IV.C-D) | Take off and land with a crosswind | ground lineup07; `xwind10` then `xwind15` [reduced] | Demo crab on final and wing-down for touchdown; into-wind aileron on the roll. Practice 3 circuits. **Assessed ×2 in `xwind10`: landing grader with drift ≤ 5° at contact, bank ≤ 6° at contact and toward the wind (binary), centreline, roll-out centreline ±8 m, into-wind aileron below 40 kt for 70 % of the roll (check)**. Award `crosswind15` if a `xwind15` landing grades ≥ 3 |
| L18 | Short-field take-off and landing (ACS IV.E-F) | Max-performance take-off and a precise short landing | ground lineup07; `calm` [reduced] | Short take-off: flap 10, brakes, full power, rotate at 51 kt, **Vx −0/+10 to 50 ft AGL**, then Vy. Short landing: **VshortField −5/+10 on final, touchdown `touchdownZoneShortFt`, stop distance recorded, sink**. |
| L19 | Instrument appreciation and unusual attitudes (Ex 19 / ACS VIII) | Basic instrument flight and recovery from unusual attitudes | air 4,000 ft; `smooth`; hood [reduced] | Demo selective radial scan. Practice S&L, rate-one turns, climbs and descents. **Assessed: S&L 2 min (`instrAltitude`, `instrHeading`, speed), 180° rate-one turn (`turnRate`), constant-airspeed climb and descent 500 fpm; unusual attitudes ×2 (copilot sets nose-high 25°/30° bank/60 kt and nose-low −20°/45° bank under a blacked-out view "Close your eyes", then hands over): unusual-attitude grader**. Instrument time logged |

**Stage 4: Navigation and the test**

| # | Lesson | Objective | Start, weather | Exercises and pass standard |
|---|---|---|---|---|
| L20 | Navigation (Ex 18 / ACS VI.A) | Plan and fly a closed route by map, compass and clock, with a diversion | ground holdA1 running; `light`, wind at 3,500 ft 270/15; cruise phases maxTimeScale 4 (1 within 2 NM of a turning point) [minimal] | Nav log on the ground (headings ±3°, leg times ±1 min, from the E6B solution of the given wind). Route KFBL -> Foothill Lake -> Valley Lake -> town -> KFBL at 3,500 ft MSL (minimum safe altitudes checked by a terrain test: +1,000 ft). **Departure: set heading overhead and start the clock (Enter). En route per leg: xtk ≤ `xtkNm` (hold, settle 120 s), each turning point passed within 1 NM, ETA `etaMin`, `navAltitude`, `navHeading`. Diversion mid leg 2 to the alpine tarn: heading and time estimate within ±10° / ±3 min (mini form, 90 s), track within 1 NM. Rejoin overhead at 2,000 ft AAL, deadside descent, circuit to land at test** |
| L21 | PPL skill test (EASA skill test sections 1-5 / ACS) | Pass the test | ground parking cold; random fair weather (wind ≤ 12 kt, 040-160°); kind `test`, persona examiner, coach silent | Gate: L01-L20 competent (and N1 under FAA). Section 1 departure: checks, start, taxi, run-up, normal take-off. Section 2 airwork: S&L with speed change, climbs and descents, 30° turns, steep turns, slow flight, two stalls, unusual attitude under the hood. Section 3 navigation: first leg of the L20 route and a diversion with estimates. Section 4 approach and landing: rejoin, flapless or glide approach (random), normal landing, go-around from 200 ft. Section 5 emergencies: PFL (examiner throttle hold), EFATO. **Each item graded once at test standard; an item below 2 fails its section; the examiner may allow one repeat of a single item per section (the second flight counts). EASA: one failed section = `testPartial` (retake only that section within 30 days of sim calendar, offered from the hub); more = `testFail`. FAA: any failed task = `testFail` (notice of disapproval); retest of failed tasks. Any critical fault = `testFail`.** Pass: award `ppl`, licence card animates, logbook stamp SKILL TEST PASS |

The course is twenty lessons (L01-L20) followed by the skill test (L21).

**Rating (optional under EASA, required before L21 under FAA)**

| # | Lesson | Objective | Start | Pass standard |
|---|---|---|---|---|
| N1 | Night circuits | Fly circuits by night with the lighting checks | ground holdA1, `night` (21.5 h) | Lights checklist (nav, beacon, strobes, landing light on final; check). 3 circuits with full-stop landings (FAA 61.109(a)(2)(ii): 10 night take-offs and landings are needed for the certificate; the lesson logs 3 per run and the hub shows progress toward 10). **PAPI path `glidepathFt` ±75 below 500 AAL, landing grader at test.** Award `night` when 10 night landings are logged with one competent N1 |

### 4.2 Progression

- A lesson is `available` when all `requires` lessons are competent, all `requiresEndorsements` are held, and,
  for L13, `safeLandings` ≥ 3 and no intervention in the last two dual lessons. `experienced` makes all lessons
  available.
- Requires: L02-L07 need the previous lesson; L08 needs L07; L09 L08; L10 L09; L11 L10; L12 L11; L13 L12;
  L14 L13; L15-L19 need L14 and can be flown in any order; L20 needs L15-L19; L21 needs L20 (and N1 under FAA);
  N1 needs L14.
- Ranks on the licence card: Student Pilot -> Student Pilot (solo endorsed) after L13 -> First Solo after L14 ->
  Private Pilot (A), SEP land after L21 -> + Night.
- Hours: the hub shows the course hours next to the regulatory minimums (EASA 45 h with 25 dual and 10 solo;
  FAA 40 h with 20 dual and 10 solo), labelled "simulation; not creditable".
- Currency nudge: after 30 real days without flying, the home card suggests "Currency: three circuits"
  (L10 practice). It never blocks.

### 4.3 Challenges (optional; unlocked by stage; local best five)

| Challenge | Unlock | Setup | Score 0-100 |
|---|---|---|---|
| Spot landing | L09 | final 3 NM, `light` | 100 − \|distAimFt\|/4, minus sink penalty (sink > 300 fpm: −(sink − 300)/10); a nose-first or off-runway contact scores 0 |
| Dead-stick | L16 | 3,000 ft AAL, 3 NM east, engine stopped (mixture hold at cut-off) | touchdown zone (40), Vglide hold (30), no stall warning (15), sink (15) |
| Crosswind master | L17 | `xwind15` with gusts 10 | centreline (30), drift (30), sink (20), zone (20) |
| Precision circuit | L10 | lineup07 | 100 × (1 − mean normalised error over the circuit's hold targets/2), floored at 0 |

Medals: bronze 60, silver 80, gold 92. Bests are kept per authority. Challenges never affect lesson
competency.

---

## 5. User interface

All UI is DOM and Canvas 2D in the existing style (`src/ui/dom.ts` `el()`, tokens from `src/ui/styles.ts`),
mounted under `UISystem.root`, with CSS in `src/ui/school/schoolStyles.ts` appended to the existing UI CSS.
Elements never take focus while the menu is closed; modal screens capture keys only while open. Every screen
works at 1280×720 and 1600×900.

### 5.1 Flight School home (modal over the paused sim)

- The sim behind it sits on the apron, paused; the camera runs `orbit` slowly on wall time.
- Left card (360 px): header "KFBL Flight Training"; **Continue card** (next lesson, references, minutes,
  stars so far, big **Brief** button, Enter); **career track** (stages with milestone dots: First Solo, PPL,
  Night; current rank); buttons Syllabus, Challenges, Logbook, Licence, Settings, Free flight (Esc).
- Right corner: licence card preview (rank, total hours, last flight).
- A storage banner when saving is unavailable; a "Resume lesson" banner when a checkpoint exists.

### 5.2 Syllabus

Four stage rows plus Ratings and Challenges. Tiles show number, title, references, minutes, status (locked grey
with prerequisites listed on hover, available blue, competent green with stars, gate tiles with an examiner mark
drawn in CSS), and the best result. A tile opens the briefing.

### 5.3 Briefing

Positioned and held behind the curtain while open. Two columns: left the aim, points, airmanship, "More"
disclosure; right the numbers table, the tolerance table (lesson standard and test standard columns, authority
badge, footnotes for sim-standard values), the diagram (inline SVG generated from the `diagram` spec), the key
caps for the listed keys (from `bindings.ts` plus the training keys), and the exercise sequence as chips.
Weather line ("Wind 090/7, CAVOK, 09:30"). Buttons: **Start flight** (Enter), **Listen** (speaks the summary),
**Back** (Esc).

### 5.4 In flight

- **Lesson strip** (top centre, max 560 px, about 56 px tall): left the authority chip (INSTRUCTOR HAS CONTROL
  blue / FOLLOW ME THROUGH / OFFERED: press Enter amber blinking / YOU HAVE CONTROL green / SOLO / SKILL TEST),
  with a sub-chip for holds (THROTTLE: INSTRUCTOR); centre the task title; right up to 4 tolerance chips
  (`ALT +40`, `IAS −3`, `HDG 2°`, `BANK 44°`).
- **Tab** cycles the lesson card: compact strip -> expanded card (lesson, phase, task, targets with horizontal
  deviation bars: centre target, green ±tol, amber to 1.5·tol, red beyond; step timer; last 5 captions;
  checklist items with ticks) -> hidden. In assessed tasks the bars read "Assessment: no live feedback".
- **Caption bar** (bottom centre, above the control widget): speaker tag (INSTRUCTOR teal, EXAMINER slate,
  YOU grey, TOWER amber for step 3), then the text; Safety lines in red; fades 3 s after the end.
- **Instrument highlight:** pulsing ring over the named instrument in the cockpit view, positioned from
  `src/instruments/layout.ts` projected as `cockpitClicks.ts` does; hidden in external views.
- **Follow-through:** the existing control widget is forced visible with the label FOLLOW ME THROUGH while the
  copilot flies.
- **Hood:** a DOM mask over everything above the glareshield line (projected from `layout.ts` each frame);
  camera forced to cockpit while on; looking up capped at 10°. "Close your eyes" blackout is the same mask at
  full height.
- The HUD block moves down while the strip is visible; the hints card is suppressed while a profile exists.

### 5.5 Debrief (modal, sim paused)

- Header: outcome word (Competent / Not yet competent / PASS / PARTIAL PASS / NOT PASSED), stars, authority
  badge, flags (calm air, retries, assists, saves off). The spoken summary plays automatically with its
  caption; a Play button repeats it.
- Instructor points: strength / main point / next time.
- Exercise accordion: grade pip and test-standard pip, attempts, interventions; criterion rows: label, target,
  tolerance, worst deviation with time, % within, grade, pattern note. Clicking a row highlights its band and
  worst point in the graph.
- **Trace graph** (`traceGraph.ts`, canvas, full width): up to 4 stacked strips chosen from the charted
  criteria (altitude, IAS, heading or bank, VS or glide-path deviation); target line, tolerance band (pale
  green), half band (darker); demo spans greyed; phase boundaries labelled; event markers (drawn triangles and
  ticks: lift-off, touchdown with sink value, stall warning, intervention, coach remark with hover text).
  Scrubber; Replay at 1/4/16x; "Compare with best" ghost line.
- **Ground track** (`trackMap.ts`) for circuit, PFL and navigation lessons: runway, ideal circuit or route,
  flown track coloured by authority.
- Logbook line preview. Buttons: **Next lesson** (Enter, when unlocked), **Fly it again** (R), **Try one
  exercise again** (opens a list of phases with their checkpoints from this run), **Home** (Esc).
- Milestones (First Solo, PPL, Night) show a ceremony card before the debrief.

### 5.6 Menu integration

- `MenuTab` gains `'school'`. Outside a lesson: profile summary, "Open Flight School", the training settings.
  During a lesson: lesson, phase and step; objectives; live criteria; **Try again from this phase**, **Restart
  lesson**, **Show me (demonstration)**, **Abandon lesson**; caption log (last 30).
- Flight-tab scenario buttons ask "Abandon the lesson?" during a lesson.
- The crash dialog accepts a custom action set (lesson crash panel, section 3.10).

### 5.7 Logbook and licence

- **Logbook:** paper-style table: Date, Type, Reg, From/To, Dual, Solo/PIC, Night, Sim instr, Ldg D/N,
  Exercise, Remarks (editable), Signature, stamp. 10 rows per page with page totals and totals brought forward;
  filter lessons / free flights; each lesson row links to its debrief and trace when stored; "Copy as CSV".
- **Licence card:** CSS card with name, licence number, "Student Pilot" or "PPL(A) SEP (land)" / "Private
  Pilot ASEL" by authority, endorsements and ratings with dates, total hours, initials avatar.

### 5.8 Settings (Flight School)

Authority, instructor name, voice per persona (with Test buttons), rate, volume, captions, captions only,
talkativeness, instructor saves, live bars, auto-acknowledge, log free flights, experienced pilot, export,
import, reset progress (typed confirmation "RESET").

### 5.9 Keys

All verified free in `src/input/bindings.ts` and `Simulator.onKey` (the header comment of `bindings.ts` is
updated to list them as owned by the training module).

| Key | During a lesson | Elsewhere |
|---|---|---|
| Enter | acknowledge; "I have control" when offered; confirm checklist item; continue on briefings and prompts | confirms dialogs (unchanged) |
| Shift+Enter | "You have control" (hand control to the instructor) | — |
| R (bare) | Say again (the step prompt re-rendered with live values) | crash dialog R (unchanged, only while open) |
| [ (bare) | Show me (accept a demonstration offer, or ask for one) | — |
| Tab | cycle the lesson card (`preventDefault`) | — |
| Shift+R | try again from the start of this phase | restart scenario (unchanged) |
| A | refused unless the lesson allows the autopilot | autopilot (unchanged) |
| Shift+[ / Shift+] | clamped to the phase time-scale cap | unchanged |
| Esc | menu (School tab first) | unchanged |
| Space | **reserved** for push-to-talk (step 3); not used in step 1 | — |

Gamepad: the Start button pauses as today; no new gamepad bindings in step 1.

### 5.10 URL parameters (testing and dev)

| Parameter | Meaning |
|---|---|
| `school=0` / `school=1` | 0: never show the welcome card or home on boot; 1: open the home on boot even with a resume |
| `lesson=<id>` | Open that lesson's briefing directly (ignores locks: practice credit only unless it is available) |
| `phase=<phaseId>` | With `lesson=`: start at that phase (positioned by `retryFrom`, else the lesson start); no logbook credit |
| `brief=0` | With `lesson=`: skip the briefing and start flying |
| `voice=0` | Captions only |
| `standard=easa` / `faa` | Authority for this session (does not change the saved profile) |
| `tstore=mem` | In-memory training store (nothing written to localStorage) |
| `unlock=1` | All lessons available for this session (practice credit only) |
| `student=auto` | Dev only: the AutoStudent flies student phases (for screenshots and smoke runs) |

`window.__sim.training`: `start(id, { phase?, brief?, standard? })`, `state()` (lesson, phase, step, authority,
vars, card, last captions), `input(kind)`, `skipStep()`, `end()`, `result()`, `transcript()`, `profile()`,
`export()`, `import(json, mode)`, `runner`, `store`.

---

## 6. Integration contract and module split

### 6.1 Additive changes to the shared contract

`src/core/context.ts` (additive only):
- `SimEvents.reset: { scenario: ScenarioId; lessonId?: string }`.
- `SimEvents.lesson: { kind: 'start' | 'end' | 'authority' | 'phase'; lessonId: string; detail?: string }`
  (for audio ducking and UI).
- `SimCommands.startFrom?(sc: unknown /* Scenario */, opts: { lessonId: string; label: string }): Promise<void>`
  (curtain + `physics.resetTo`).
- `ScenarioId` is unchanged.

`src/sim/resume.ts`: `SNAPSHOT_SCHEMA = 2`; `FlightSnapshot.start?: StartSpec`, `FlightSnapshot.training?: unknown`
(validated by `src/training/career/validate.ts`); `validateSnapshot` accepts schema 1 (treated as 2 without
the new fields) and 2; `decideBoot` returns `{ kind: 'resume', ... }` as today, and the shell checks
`snapshot.training`. The existing resume tests keep passing unchanged, plus new ones.

`src/sim/SimPhysics.ts`:
- `copilot: StepController | null = null`; in `stepOnce` after `autoflight.update`:
  `this.copilot?.update(this.h, this.fm.state, this.controls);` (called every step: it flies when `flying` and
  applies holds even when the student flies), and `rudderFree` is false while `copilot?.flying`.
- `resetTo(sc: Scenario, weather?: WeatherSettings): Scenario` (the body of `reset` after `buildScenario`);
  `reset(id)` calls `resetTo(buildScenario(id, env))`. `StartOptions.fuelFraction` and payload are applied here.
- `captureSnapshot` stores `start` when the last reset came from a `StartSpec`.

### 6.2 Files

New (all under exclusive ownership, section 6.3):

```
src/training/types.ts                 contract (all types in section 2)
src/training/index.ts                 public barrel
src/training/aircraft/c172s.ts        AircraftTypeDef (+ checklists), registry.ts
src/training/telemetry/telemetry.ts   Telemetry, providers/core.ts, providers/geo.ts, providers/nav.ts
src/training/geo/areas.ts, circuit.ts, route.ts
src/training/engine/dsl.ts, predicates.ts, refs.ts, events.ts (derived events, LandingDetector)
src/training/engine/runner.ts, authority.ts, coach.ts, safety.ts, checklists.ts, bus.ts
src/training/grading/standards.ts, accumulators.ts, grade.ts, landing.ts, stall.ts, unusual.ts, patterns.ts,
                      results.ts, debrief.ts, trace.ts
src/training/speech/scheduler.ts, webSpeech.ts, captionBackend.ts, voices.ts, phraseology.ts
src/training/copilot/instructorPilot.ts
src/training/career/store.ts, validate.ts, migrations.ts, progress.ts, totals.ts, logbook.ts, challenges.ts
src/training/content/lines.ts, coachPresets.ts, demos.ts, weatherPresets.ts, personas.ts
src/training/content/syllabus/index.ts, stage1.ts, stage2.ts, stage3.ts, stage4.ts, ratings.ts, challenges.ts
src/training/content/validate.ts      the lesson linter
src/training/TrainingSystem.ts        Subsystem glue (owns runner, scheduler, copilot, store, UI models)
src/sim/starts.ts                     StartSpec -> Scenario
src/ui/school/home.ts, syllabus.ts, briefing.ts, debrief.ts, logbook.ts, licence.ts, settings.ts, welcome.ts,
               lessonStrip.ts, lessonCard.ts, captions.ts, highlight.ts, hood.ts, traceGraph.ts, trackMap.ts,
               navLog.ts, schoolStyles.ts, models.ts (view-model types)
src/dev/school.ts + dev/school.html   UI fixtures page for screenshots
tests/training/*.test.ts, tests/training/fixtures/*.json, tests/training/autoStudent.ts, headlessHost.ts
scripts/fly-lesson.mjs, scripts/record-telemetry.mjs
```

Modified:

| File | Change |
|---|---|
| `src/core/context.ts` | section 6.1 (contract owner) |
| `src/sim/SimPhysics.ts` | copilot hook, `resetTo`, start in the snapshot |
| `src/sim/scenarios.ts` | export `startOnFinal`, `startOnDownwind`, `kiasToTas` (no behaviour change) |
| `src/sim/autoflight.ts` | export `trackHeading`, `centrelineRudder` (no behaviour change) |
| `src/sim/resume.ts` | schema 2 fields and validation |
| `src/sim/Simulator.ts` | create `TrainingSystem` after UI; `training.update` after `panel.update`; key routing (5.9); time-scale clamp; A gate; Shift+R in lessons; `startFrom`; persist adds the training block; boot path (1.1); URL params; `__sim.training` |
| `src/sim/params.ts` | the parameters in 5.10 |
| `src/input/bindings.ts` | header comment only (training keys owned by `TrainingSystem`); `TRAINING_KEYS: KeyBinding[]` exported for the Controls tab |
| `src/ui/uiSystem.ts`, `menu.ts`, `overlays.ts`, `hud.ts` | School tab; mount layer for school UI; crash dialog custom actions; HUD offset while the strip is shown; hints suppressed with a profile |
| `src/audio/AudioSystem.ts` | `setDuck`, `chime` |
| `README.md` | Flight School section, keys, URL parameters, test count |

### 6.3 Module split (7 parallel implementers after the contract)

**Wave 0 (one agent, first, half a day): Contract.** Owns `src/training/types.ts`, `src/training/index.ts`,
`src/core/context.ts` additions, `src/sim/starts.ts` types only (function stubs throwing "not implemented"), and
the stub signatures of every exported class in section 3 (bodies `throw`). Gate: `tsc` clean, 521 tests green.
Frozen after review; changes afterwards go through the lead.

**Wave 1 (parallel, 7 agents):**

| # | Module | Owns (exclusive) | Must expose | Tests |
|---|---|---|---|---|
| 1 | Telemetry and predicates | `src/training/telemetry/**`, `geo/**`, `engine/dsl.ts`, `predicates.ts`, `refs.ts`, `events.ts`, `bus.ts` | `Telemetry`, providers, `compile(pred)`, `resolveRef`, `resolveTol`, DSL builders, `DerivedEventDetector`, `LandingDetector`, `TrainingBus`, `classifyCircuitLeg`, areas and route | `predicates.test.ts` (hysteresis edges, held grace, angle wrap, event scan, no short-circuit); `telemetry.test.ts` (units vs `mockState`); `circuit.test.ts` (legs along the scenarios' downwind and final); `areas.test.ts` (terrain clearance); `events.test.ts` on recorded fixtures (liftoff, mainsTouchdown, stallBreak, goAround) |
| 2 | Grading and career | `src/training/grading/**`, `src/training/career/**` | `Grader`, accumulators, landing/stall/unusual graders, `diagnose`, `buildDebrief`, trace encode/decode, `TrainingStore`, `validateTrainingSave`, migrations, `progress`, `totals`, `FlightTimer`, challenges scoring | `grading.test.ts` (grade table on synthetic series, asymmetric and zero-sided tolerances, momentary rule, min-aggregation, test-grade parallel); `patterns.test.ts`; `landing.test.ts`; `trace.test.ts` (round trip < 0.5 % error); `store.test.ts` (round trip, corrupt -> prev, quota eviction with fake storage, migration with backup, import replace and merge); `progress.test.ts` (gates, L13 gate, FAA N1 rule); `logbook.test.ts` (timer from a recorded circuit) |
| 3 | Speech | `src/training/speech/**`, `content/personas.ts`, `AudioSystem.setDuck/chime` | `SpeechScheduler`, `WebSpeechBackend`, `CaptionBackend`, `pickVoice`, `render` phraseology | `scheduler.test.ts` (fake clock and backend: priority, TTL drop, dedupe/cooldown, preemption and resume, channel exclusion, pause, captions on start); `webSpeech.test.ts` (fake `speechSynthesis`: voiceschanged timeout, missing `onend` watchdog, error downgrade); `phraseology.test.ts` |
| 4 | Copilot, starts and sim hooks | `src/training/copilot/**`, `src/sim/starts.ts`, `src/training/aircraft/**`, `content/demos.ts`, edits to `SimPhysics.ts`, `scenarios.ts`, `autoflight.ts` (exports) | `InstructorPilot`, `buildStart`, `baseScenario`, `SimPhysics.resetTo`, `copilot` hook, `C172S`, every demo script and the recovery script | `instructorPilot.test.ts` with the real `SimPhysics` in node: every demo script reaches its `until`s within timeouts and stays in the envelope; 30° and 45° turns hold ±50 ft; stall demo recovers with < 200 ft loss at the forward payload; recovery from the 4 seeds reaches stable within 10 s; holds keep the throttle at 0 against input; handover bumpless (control jump < 0.05). `starts.test.ts`: every StartSpec used by the syllabus trims and flies 30 s without a crash; `c172s.test.ts` (profile matches `core/c172.ts`). Existing 521 tests stay green |
| 5 | Runner, authority, coach, safety | `src/training/engine/runner.ts`, `authority.ts`, `coach.ts`, `safety.ts`, `checklists.ts`, `content/coachPresets.ts` | `LessonRunner`, `AuthorityFsm`, `Coach`, `SafetyMonitor`, `ChecklistRunner`, `RunSnapshot` | `runner.test.ts` with a fake host and scripted signal timelines: step lifecycle, pending/prompt, timeouts and every outcome, branch/goto/repeat, handover (ack, no ack, input without ack, handback, interference), intervention fails an assessed exercise, checkpoint retry, snapshot/restore equality; `coach.test.ts` (afterS, correcting suppression, gaps and 3/min, escalation and reset, praise rationing, levels); `safety.test.ts` |
| 6 | Content | `src/training/content/syllabus/**`, `lines.ts`, `weatherPresets.ts`, `content/validate.ts` | `SYLLABUS: Lesson[]`, `CHALLENGES`, `LINES`, `WEATHER_PRESETS`, `validateLesson`, `validateSyllabus` | `syllabus.test.ts`: the linter passes for every lesson (every signal, var, cue id, demo id, checklist id, vspeed, setting, tolerance key, goto target resolves; every phase reachable; every exercise fed by a task; every task and wait has a timeout; required exercises have ≥ 1 required criterion; prerequisites acyclic; every line ≤ 20 words) |
| 7 | School UI | `src/ui/school/**`, `src/dev/school.ts`, `dev/school.html`, edits to `src/ui/uiSystem.ts`, `menu.ts`, `overlays.ts`, `hud.ts` | `SchoolUi` (mount, open home/briefing/debrief, render strip/card/captions from models), `TrainingUiPort` implementation, crash-dialog actions, `MenuTab 'school'` | `schoolFormat.test.ts` (pure formatters: tolerance text, trace scaling, logbook totals rows); screenshots of every screen via the dev page with fixture models at 1280×720 and 1600×900 |

Modules 5 and 7 code against the interfaces of 1-4 and use fakes until those land. Module 6 writes data against
the types at once; the linter goes green as 1, 3 and 4 land their ids.

**Wave 2 (one agent): Integration.** Owns `src/training/TrainingSystem.ts`, `src/sim/Simulator.ts`,
`src/sim/params.ts`, `src/sim/resume.ts`, `src/input/bindings.ts` (comment and `TRAINING_KEYS`),
`README.md`, `scripts/fly-lesson.mjs`, `scripts/record-telemetry.mjs`, `tests/training/autoStudent.ts`,
`headlessHost.ts`, the conformance tests. It is the only agent that touches `Simulator.ts`.

**Wave 3 (2 agents): Calibration and playtest.** Run the conformance suite and the browser scripts; tune coach
thresholds and settle times in data only; report any tolerance that the AutoStudent cannot meet with the
keyboard pilot to the lead (tolerances are not loosened silently).

Gates for every module: `npx tsc --noEmit`; `npx vitest run` (the 521 existing tests plus the new ones); `npm
run build`; no new dependencies; free flight unchanged (existing scenario and resume tests);
`node scripts/check-build.mjs "scenario=cruise&cam=chase&run=5"` exits 0.

### 6.4 Test strategy

1. **Pure unit tests** per module (table above), node only, deterministic (seeded RNG, fake clocks).
2. **Recorded telemetry fixtures.** `scripts/record-telemetry.mjs` (node, `SimPhysics` + the existing autoflight
   and `tests/input/keyboardPilot.ts`) records `TelemetrySources`-equivalent frames at 30 Hz to
   `tests/training/fixtures/*.json` for: a circuit with landing, a hard landing (sink 700 fpm), a nose-first
   landing, a go-around, a stall and recovery, a steep turn, a 500 fpm descent with a 160 ft level-off bust.
   Grading, events and coach tests replay them and assert exact results.
3. **Headless conformance** (`tests/training/conformance.test.ts`, via `headlessHost.ts`: `SimPhysics` +
   `LessonRunner` + `CaptionBackend` + in-memory store, no DOM):
   - **AutoStudent** flies every lesson's student tasks by reading the task card and goal, driving its own
     `Autopilot` (airwork) or `keyboardPilot` (circuits and landings), acknowledging handovers and confirming
     checklist items. Every lesson must end `competent` (skill test `testPass`) within `maxDurationS`.
   - **NegligentStudent** biases each target by +1.3·tol, or oscillates at ±2·tol: lessons must end `notYet`,
     the expected coach topics must appear in the transcript, and a bank of 70° must trigger the intervention.
   - Every demo script reaches `demo.done: done`.
   - Runs with `test.concurrent` split per stage to keep the suite under 60 s added time; lessons longer than
     5 sim minutes run at physics-only speed (no frame cost).
4. **Browser scripts** (`playwright-core`, as the existing scripts):
   - `node scripts/fly-lesson.mjs <lessonId> <outDir> [--keys]`: opens `index.html?lesson=<id>&tstore=mem&voice=0`,
     takes screenshots of the briefing, the first demo, the handover, a coaching caption, the debrief and the
     logbook; with `--keys` it flies the student phases with real key events (based on `fly-keyboard.mjs`);
     without it uses `student=auto`. Exits non-zero on console errors, a crash or a non-competent result.
   - The release check runs L04, L09 and L15 with `--keys`.
   - A reload test: start L04, reload mid-practice, assert the lesson resumes at the same step.
5. **Screenshots** of every UI screen via `dev/school.html` fixtures with `scripts/shot.mjs`.

---

## 7. Extensibility (steps 2-4)

What stays generic: the runner, predicates, grading, coach, scheduler, store and UI never name an avionics box,
an ATC unit or an aircraft type. Everything enters through five seams:
1. **Signals:** `SignalProvider` registered with `Telemetry.addProvider`.
2. **Events:** `TrainingEventMap` declaration merging.
3. **Speech:** actors and channels in the scheduler (`tower`, `ground`, `atis` on `radio`).
4. **Lesson data:** predicates, checklists, cues and steps.
5. **Aircraft data:** `AircraftTypeDef` and its checklists, V-speeds and settings.

**Step 2: avionics (COM, NAV, transponder).** A new `src/avionics/` module owns `AvionicsState` as `ctx.avionics`
(the FDM is untouched), panel instruments, hotspots, keys and resume fields. It registers providers `xpdr`
(`xpdr.code`, `xpdr.mode`, `xpdr.ident`), `com` (`com1.active`, `com1.standby`, `com.tunedTo`) and `nav`
(`nav1.cdiDots`, `nav1.toFrom`), and events `xpdr.identPressed`, `com.swapped`. Lessons then say
`eq('xpdr.mode', 'ALT')` in the `beforeTakeoff` checklist (an edit to `c172s.ts` only) or `goal:
eq('xpdr.code', 4521)`. Instrument failures become a `SetupStep` field `fail?: { instrument: InstrumentId }`
implemented by a `FailureInjector` the avionics module registers with `TrainingSystem`.

**Step 3: ATC.** An `AtcSystem` Subsystem speaks through the same `SpeechScheduler` on the `radio` channel at
`Priority.Instruction` with the `radio` chime; channel exclusion keeps the instructor quiet while ATC transmits;
Safety still speaks over it. The student transmits with **Space** (push-to-talk, reserved now): a call composer
offers 2-4 phraseology options on digit keys and plays the chosen call as `actor: 'student', channel: 'radio'`.
ATC emits `atc.clearance`, `atc.instruction`, `atc.readback { ok, missing }`, `atc.callMade { correct }` and
provides `atc.clearedTakeoff`, `atc.clearedLand`, `atc.holdShort`. Lessons gain radio tasks with event
predicates; a global fault rule (critical: on the runway without clearance) lives in
`content/globalRules.ts`, active when ATC is live. Before step 3, `autoflight.ts` and `circuit.ts` take a
`RunwayEnd` ('07' | '25') parameter so ATC can assign runway 25; the lesson schema already carries the start and
weather that select it.

**Step 4: more aircraft.** Extract the flight-model interface `SimPhysics` uses into
`src/physics/interfaces.ts` (`AircraftFlightModel`); `AircraftTypeDef` gains `createFlightModel()`, visual,
panel and audio ids, and type-specific providers (`gear.down`, `prop.rpmLever`). Lessons are type-agnostic
because they use `{vspeed}`, `{setting}` and checklist ids; the linter checks each `(lesson, type)` pair in
`aircraft`. Differences training is ordinary lessons (`aircraft: ['pa28']`, award `TYPE_pa28`), and the hub
checks endorsements before a type can be flown solo in the career. `demoTuning` adjusts the copilot per type.
The logbook already records type and registration.

**More airfields.** `AreaId` and ground spots become a place registry; `NavRoute` legs gain an `airfield` kind,
allowing a land-away qualifying cross-country solo when the world has a second airfield.

---

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| No speech voices on Linux Chrome (the owner's Fedora machine) | Captions always on; automatic captions-only backend with identical pacing; toast with the speech-dispatcher hint; Test voice button |
| Chrome speech quirks (15 s cutoff, missing `onend`, stuck queue) | ≤ 20-word lines, sentence splitting, watchdog, cancel-before-speak, health counter with downgrade |
| Keyboard precision vs test tolerances | `training` standard early; settle times; momentary rule; trim coaching; AutoStudent with the keyboard pilot proves passability; EASA default; never loosened silently |
| Stall behaviour at typical/aft CG (round 5) | `payload: forward` in stall lessons; autopilot-levelled demo entries; recovery at the warning or break; envelope intervention at 60°; spins not flown |
| Vy reads ~80 KIAS at sea level in the model vs 74 POH | Training area at 2,500-4,500 ft where the model matches; `speedClimbApproach` +15/+10; the take-off climb is graded from 200 ft AGL |
| Autoflight assumes runway 07 | v1 weather keeps winds 040-160°; `RunwayEnd` generalisation scheduled before ATC |
| Demo misbehaviour | Every demo and the recovery flown in node tests from seeds; `timeoutS` and `abortWhen` on every segment |
| Regressions in shell files | One owner per hot file (`SimPhysics.ts` module 4; `Simulator.ts` wave 2; `menu.ts`/`uiSystem.ts` module 7); schema 1 snapshots still accepted |
| localStorage quota or loss | Small save, `.prev` copy, migration backups, trace budget with eviction, export reminders after milestones, per-entity validation |
| Lesson data errors | Strict types + linter in CI + mandatory timeouts + `skipStep` in dev |
| Performance | Predicates compiled to closures, `SignalFrame` mutated in place, trace 2 Hz, strip DOM updated at 10 Hz and only on change; budget < 0.2 ms per frame, measured in the conformance suite |
