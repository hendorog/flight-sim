# Flight School

An instructor-led course from the first flight to the PPL skill test, flown in the same aircraft and world as
free flight (design: [instructor-spec.md](instructor-spec.md)). "Open Flight School" on the menu's Flight tab (Escape) opens
the school home: the syllabus, the logbook, the challenges and the settings (EASA or FAA standard, instructor
voice, captions). A first visit opens a welcome card.

**What is in it.** 21 lessons in five stages: handling (L01 effects of controls to L07 stalling), circuits
(L08 take-off to L14 first solo), advanced (L15 steep turns to L19 instrument appreciation), navigation (L20)
and the skill test (L21), plus the N1 night rating and four challenges (spot landing, dead-stick, crosswind
master, precision circuit) unlocked by the matching lessons. A lesson unlocks when the ones it needs are competent;
anything else can be flown for practice (no logbook credit).

**How a lesson works.** A briefing (aim, points, the exercises and their standards) behind the curtain, then the
flight: the instructor demonstrates ("follow me through"), offers you control (the strip at the top shows who
has it: press Enter to take it), coaches while you fly (captions, and spoken with the Web Speech voices when
available), and takes control back when a safety limit is passed ("I have control!"): near the ground with
full power and a climb, never by closing the throttle. With "Instructor saves" off in the school settings she
does not take over, but she still calls the danger ("Too much bank! Roll the wings level!"). The task card (Tab
cycles it) shows the targets and tolerances of the current exercise; checklists are challenge and response
or flows (see the guidance below for how a dual lesson talks you through them). Every exercise is graded 1-4 against the EASA or FAA tolerances, as the
weakest required criterion over every task that scored it in one run of its phase (an assessed circuit is
graded on all its legs); a task flown again within the run replaces its earlier try, and the best run counts
(the first in check and test lessons). The lesson is Competent when every required exercise reaches
Satisfactory, and the stars (1-3) follow from the grades. The debrief shows the exercise table, the main points and the flight trace; the logbook keeps every
attempt. During a lesson time acceleration is limited to what the lesson allows (a toast says so), the
autopilot (A) is only available where the exercise permits it, and a reload resumes the lesson at the step it
was on ("Right, where were we."), with the flight. A crash in a lesson offers the debrief (which starts with
what happened; items a crash cut short are not graded), a retry from the last checkpoint, or a restart.

**Feedback while you fly.** Each exercise the instructor talks you through has its own commentary (TaskFeedback
in `src/training/types.ts`): the instruction, then "Go ahead..." once you have control (never while she has it);
progress remarks as you reach each stage ("Fifteen left... Now roll smoothly through level to 15 right"), of
which only the latest one still true is said when she finishes talking, so she never praises a stage you have
already left; a confirmation when the goal is met ("Good. Elevator controls pitch..."); and neutral reminders
after a quiet spell while the goal is not yet met. When an exercise ends, its lines still waiting to be said are
dropped (only the confirmation carries over). Such an exercise shows live targets on the card even when it is
graded, and the strip shows ASSESSMENT only on the exercises she flies in silence, which end with "Thank you."
In stage 1 (L01-L08) she talks sooner and more often. If you hand control back (Shift+Enter) mid-exercise, its
clock stops until you take control again (Enter, then Enter on her "You have control"); she reminds you every
30 s. At the end of an airborne lesson she takes control and her closing line is heard before the debrief opens.

**Guidance in the cockpit and on the ground** (dual lessons; the owner's playtest of L01 and L02).
- *Callouts.* Whenever the instructor names a control or an instrument (a checklist item, a step that points at
  something, a reminder), a pulsing ring sits on it with a label: its name, the state it must be in ("ON",
  "OFF", "RICH", "BOTH", "1,000 RPM"), the key that works it ("hold S" for the starter, "hold Shift+M" for
  the mixture) and, on its first reading, why. Off screen, an arrow on the screen edge points toward it. Clicking
  the label presses the key. One callout at a time; it turns green when the state is reached.
- *Glance.* When a callout's control is off screen the cockpit view turns briefly toward it and comes back to
  the forward view when it is done or after 6 s. School settings: "Glance" (on by default). The look keys
  still move the view as usual.
- *Guided checklists.* Each item is read with its required state, where the control is and its key (the first
  time that control comes up) and a reason of 15 words or fewer ("Avionics off for the start: the starter's
  voltage dip can damage the radios"). The item is done the moment the aircraft is in that state (no Enter);
  only items that cannot be seen from the state (the propeller area, the engine instruments) take Enter. The next
  item is read only once she has finished speaking about the last, so every line is heard in order. Reminders
  say what is still wrong ("The throttle is still at 1,840 rpm: it needs to be 1,000 rpm, key F2"), never in
  the same words twice; after two she offers to show you ([), and if it is left too long she sets it herself.
  L02's before-start checklist verifies the whole set-up before the start, including the prime (fuel pump on,
  then off) and the throttle opened a quarter inch (two taps of F3).
- *Engine rpm on the ground.* Standing still above 1,200 rpm for 5 s: "Bring the power back to 1,000 rpm"
  (pointing at the throttle, key F2), then the tachometer, then an offer of help; still high after that, she
  brings the throttle back herself. L02 does not leave the stand above 1,250 rpm.
- *Taxi guidance.* A route from the stand to the holding point along the real taxiway centrelines. She calls
  it as an instructor would, from the distance along the route (whatever the cross-track): "Straight ahead out
  of the stand to the yellow line, then turn right along it", "B1 is the next left, in about 40 metres", "Now
  follow Alpha ahead, about 800 metres. A1 will be on the left", "Holding point A1 ahead: stop before the double
  yellow lines". A taxi panel shows the next action (left, right, straight), its distance and the turns after
  it, the cross-track on the yellow line, and HOLD SHORT in red on the last connector. The ground coach watches
  the speed (over 15 kt), the yellow line (over 3 m off), the brake test, the grass ("Stop! We're off the
  taxiway", repeated while it lasts) and a parking brake left on.
- *Reminders follow the state.* A nudge names what is still missing, and says nothing when nothing is (no
  "throttle up to 1,800" at 1,800); a reminder never repeats the previous line's words.

**Lesson limits.** Each exercise has limits suited to it (L01: bank 45°, pitch +20/−15°, 60-125 KIAS; trimming
also ±400 ft). Beyond one for 1.5 s she takes control ("I have control." and why), restores straight and level at
the height, heading and speed the exercise started from, talking through it ("Wings coming level... nose on the
horizon"), gives a teaching point, and hands back with the three-way call; the exercise then starts again. On
the third time on one exercise she says she will come back to it and moves on, and the exercise fails. A limit
intervention is not a safety intervention: it never ends the lesson, but that exercise cannot reach grade 4, and
the debrief names it ("I took control three times when the bank went past the lesson limit"). The safety
envelope above still takes precedence. With "Instructor saves" off she says the line but does not take over.

**Keys during a lesson** (they only act while a lesson runs; elsewhere they keep their free-flight meaning):

| Key | Action |
|---|---|
| Enter | Acknowledge: take control when offered, confirm a checklist item, continue |
| Shift+Enter | Hand control back to the instructor |
| R | Say again (repeat the last instruction) |
| [ | Show me (the instructor demonstrates the current exercise again) |
| Tab | Cycle the task card: compact, expanded, hidden |
| Shift+R | Retry the current phase from its checkpoint |

**URL parameters** (in addition to the ones above):

| Parameter | Meaning |
|---|---|
| `school=0`, `school=1` | 0: never open the welcome card or school home on boot; 1: open it even when a flight is resumed or `scenario=` is given (automated browsers behave as `school=0` unless `school=1`) |
| `lesson=L04` | Open that lesson's briefing directly (locks ignored: practice credit unless it is available) |
| `phase=climb` | With `lesson=`: start at that phase (no logbook credit) |
| `brief=0` | With `lesson=`: skip the briefing and start flying |
| `voice=0` | Captions only, no speech |
| `standard=easa`, `standard=faa` | The grading standard for this session (the saved profile is not changed) |
| `tstore=mem` | In-memory school store: nothing is read from or written to `localStorage` |
| `unlock=1` | Every lesson available this session (practice credit only) |
| `student=auto` | Development (dev server only): the scripted AutoStudent flies the student's tasks |

`window.__sim.training` is the automation API: `start(id, {phase, brief, standard})`, `state()` (phase, step,
authority, captions, strip and card), `input(cmd)` (`ack`, `handback`, `sayAgain`, `showMe`, `retryPhase`,
`restartLesson`, `abandon`), `skipStep()`, `end()`, `result()`, `transcript()`, `profile()`, `export()`, `import(json)`,
`command(cmd)` (the School UI's commands), and the live `runner`, `store` and `system`.

The school's progress (profile, lesson results, logbook, traces) is in `localStorage` (`fs.training.v1`); the
school's settings screen downloads and imports it as a JSON file. A reload mid-lesson writes the lesson's resume block into
the flight snapshot (snapshot schema 2; schema-1 snapshots still resume as free flight).

**Conformance.** The lessons are tested headless with the real flight model, lesson runner, copilot,
telemetry, grader and speech scheduler (captions on a simulated clock): `tests/training/conformance*.test.ts`
fly lessons with a scripted student (`tests/training/autoStudent.ts`), which must end each one competent
(the skill test: pass) within its time limit, with no crash, no intervention and every demonstration done; a
negligent student (biased or oscillating targets) must end not yet competent with the right coaching, and a
70° bank must bring the instructor in. A reload mid-lesson must resume at the same step and finish. By default
the suite flies a representative set (L04, L09, L12, L15); `FS_CONFORMANCE=1 npx vitest run tests/training/conformance`
flies every lesson and challenge and the negligent-student course (about 12 minutes on 32 cores). Recorded telemetry of real flights
(`tests/training/fixtures/`, re-recorded with `node scripts/record-telemetry.mjs`) checks the event detectors
and the landing, steep-turn and altitude grading. In the real app, `node scripts/fly-lesson.mjs L04` flies a lesson
in headless Chrome with screenshots of the briefing, a demonstration, the handover, a coaching remark, the
debrief and the logbook (`shots/school/flights/<id>/`); `--reload` reloads mid-practice and checks the resume,
`--keys` flies the student's tasks with real key events.
