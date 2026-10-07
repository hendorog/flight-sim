// Ground handling (L02, and silently in the L21 skill test): the before-start checks, the start, the after-start
// checks, the taxi to holding point A1, the run-up and the before-take-off checks.
//
// Owner playtest of L02 (a PPL holder): "there were no directions on where the holding point was, which way to
// turn while taxiing"; "the instructor is just repeating the same thing"; "no point just saying avionics switch,
// when the student needs to first find the switch, then which way to switch it"; "there was no checklist before
// start to verify everything was set up"; "the RPM was well above 1000 and no action taken". So:
//   - every checklist item names its control, the position it must be in, and why (aircraft/c172s.ts carries
//     control, state, key and why on each item; the UI points at the control);
//   - the before-start checklist verifies the whole set-up before cranking, item by item, from the state;
//   - after the start the throttle comes back to 1,000 rpm, verified, with a reminder above 1,200 rpm;
//   - the taxi is called turn by turn by the engine's taxi guide (TaskStep.taxi), from the distance along the
//     route, as an instructor would: which way, how far, which taxiway, and where the holding point is (position
//     boxes lost every call once the aircraft was 10 m off the line, playtest 3);
//   - reminders are coach rules, one per thing still missing, each naming that thing (instruction.ts reminder),
//     never the whole instruction again.
//
// TAXI ROUTE (layout.ts, runway 07 frame: rwyAlongM from the 07 threshold, rwyAcrossM + right of the centreline;
// the apron is on the left, -across). Stand A10 (along 889, across -303, facing the runway) -> ahead 28 m to the
// apron taxi line (across -275) -> RIGHT along it 49 m to Bravo 1 (along 840) -> LEFT up B1 155 m to the parallel
// taxiway Alpha (across -120) -> RIGHT along Alpha 825 m, the runway on the left -> LEFT onto Alpha 1 (along 15)
// -> hold short of the double yellow lines (across -76), stopping about 4 m before them. The AutoStudent
// (tests/training/autoStudent.ts taxiToA1Program) taxis the same way.

import { all, any, binary, capture, check, checklist, eq, ever, gt, held, hold, lt, near, not, peak, say, v } from '../../engine/dsl';
import type { CoachRule, Criterion, Pred, StepDef, TaskStep } from '../../types';
import { between, rpm, task } from './common';
import { feedback, ms, reminder } from './instruction';

export type ChecklistMode = 'challengeResponse' | 'silent';

// ---- the route, in the runway 07 frame ----------------------------------------------------------------------

/** The A1 hold line (across, m). */
const HOLD_LINE_ACROSS = -76.2;

/** Hold A1: on connector A1 short of the hold line (76 m left of the centreline), around rwyAlongM 15. */
export const AT_HOLD_A1: Pred = all(between('rwyAlongM', -40, 80), between('rwyAcrossM', -140, -77));

/** The brake test: a firm squeeze on the toe brakes while rolling. */
const BRAKE_TEST: Pred = all(gt('brakes', 0.4), gt('gsKt', 1));
const engineRunning: Pred = eq('engineRunning', true);

// ---- engine start ---------------------------------------------------------------------------------------------

/**
 * What can stop a cold engine starting, each its own reminder: the line names the one thing that is wrong.
 * Only while the engine is not running.
 */
function startReminders(): CoachRule[] {
  const notRunning = not(engineRunning);
  return [
    reminder({ id: 'startMaster', when: all(notRunning, eq('master', false)), afterS: 6, point: 'master',
      say: ['The master switch is still off.', 'Master switch ON, the red switch on the left: the starter needs it.'] }),
    reminder({ id: 'startFuel', when: all(notRunning, not(eq('fuelSel', 'both'))), afterS: 6, point: 'fuelSelector',
      say: ['The fuel selector is not on BOTH.', 'Fuel selector to BOTH, on the floor between the seats: no fuel, no start.'] }),
    reminder({ id: 'startMixture', when: all(notRunning, lt('mixture', 0.9)), afterS: 6, point: 'mixture',
      say: ['The mixture is still lean.', 'Push the mixture fully in, the red knob: rich for the start.'] }),
    reminder({ id: 'startThrottle', when: all(notRunning, gt('throttle', 0.1)), afterS: 4, point: 'throttle',
      say: ["That's a lot of throttle for a start: it will race when it fires.", 'Close the throttle, F2, then two taps of F3: a quarter of an inch.'] }),
    reminder({ id: 'startPump', when: all(notRunning, eq('fuelPump', true), held(eq('fuelPump', true), 8)), afterS: 0, point: 'fuelPump',
      say: ['Fuel pump off now, key J: it has primed, more floods the engine.'] }),
    reminder({ id: 'startLongCrank', when: held(eq('starter', true), 8), afterS: 0, priority: 0, minLevel: 'silent',
      say: ['Let the key go: no more than 10 seconds on the starter.'] }),
  ];
}

/** Above 1,200 rpm on the ground for 5 s, standing still (owner playtest: "the RPM was well above 1000"). */
const RPM_HIGH: Pred = all(engineRunning, gt('rpm', 1200), lt('gsKt', 1));
function rpmHighReminder(afterS = 5): CoachRule {
  return reminder({ id: 'rpmHigh', when: RPM_HIGH, afterS, point: 'throttle',
    say: ['Bring the power back to 1,000: key F2.', 'Throttle back, the black knob, until the tachometer reads 1,000.',
      'Above 1,000 standing still, the engine runs hot and the brakes have to hold us.'] });
}

/**
 * The before-start checklist (every set-up item verified from the state, before cranking), the start checks
 * (prime, propeller area clear), the start itself (starter under 10 s), the oil pressure (within 30 s) with the
 * throttle back to 1,000 rpm, and the after-start checklist.
 */
export function engineStartSteps(pre: string, exercise: string, mode: ChecklistMode): StepDef[] {
  // The instructor talks the student through it in L02 (challenge and response); the skill test is silent.
  const talk = mode === 'challengeResponse';
  // Ground idle band: 0.04 of throttle idles at about 880 rpm warm, so the band is 800-1,200 (as the after-start
  // checklist), not 900-1,100 (playtest 3: a normal start never completed the oil step).
  const idleBand = between('rpm', 800, 1200);
  return [
    checklist(`${pre}ckBeforeStart`, 'beforeStart', mode, { exercise }),
    // Talked through, the start is its own task: the lookout and "Clear prop!" first (the brief), then the key.
    // The engine-start list (propeller area, start, oil) is the silent skill test's record of the same.
    // The lookout is heard in full before the key is pointed at (playtest 3: never spoken in any run).
    ...(talk ? [say(`${pre}lookout`, 'L02.start', { wait: true })] : [checklist(`${pre}ckEngineStart`, 'engineStart', mode, { exercise })]),
    task({ id: `${pre}crank`, exercise, brief: talk ? 'L02.crank' : 'L02.start',
      card: { title: 'Start the engine', targets: [rpm(1000, 200)] },
      // Running for 5 s, not 2: an engine that catches and dies again has not started.
      goal: held(engineRunning, 5), timeoutS: 90, onTimeout: 'fail', coach: talk ? startReminders() : [],
      ...(talk ? { point: 'magnetos' as const, pointState: 'START', pointWhen: engineRunning } : {}),
      criteria: [
        binary(`${pre}starterTime`, 'Starter under 10 s', held(eq('starter', true), 10), { required: true,
          advice: { fail: 'Release the starter after 10 seconds and let it cool before trying again.' } }),
      ],
      ...(talk ? { feedback: feedback({
        start: 'Go ahead: hold S to turn the key to START. Let go the moment it fires.',
        milestones: [
          ms('cranking', eq('starter', true), ['Cranking. Watch the propeller; let go as soon as it fires.']),
          ms('caught', engineRunning, ["It's running. Let go of S: the key springs back to BOTH."]),
        ],
        success: 'Engine running. Eyes on the oil pressure.',
        nudge: ['Hold S until the engine fires.', 'Key to START now: hold S, 10 seconds at most.'],
        nudgeAfterS: 12, nudgeEveryS: 20,
      }) } : {}) }),
    task({ id: `${pre}oil`, exercise, brief: 'L02.oilPressure',
      card: { title: 'Oil pressure rising, 1,000 rpm', targets: [
        { label: 'OIL', sig: 'oilPsi', value: 60, tol: { minus: 35, plus: 40 }, unit: 'psi' }, rpm(1000, 200)] },
      goal: all(held(gt('oilPsi', 25), 2), held(idleBand, 3)), timeoutS: 60, onTimeout: 'next',
      coach: talk ? [rpmHighReminder(), reminder({ id: 'rpmLow', when: all(engineRunning, lt('rpm', 750), gt('step.t', 8)), afterS: 4, point: 'throttle',
        say: ['A touch more throttle, key F3: about 1,000 rpm.', 'Below 800 rpm the plugs foul: a little more power.'] })] : [],
      criteria: [
        check(`${pre}oilRise`, 'Oil pressure within 30 s', { pred: gt('oilPsi', 25), withinS: 30, required: true }),
        check(`${pre}idle1000`, '1,000 rpm after the start', { pred: held(idleBand, 3), required: true,
          advice: { fail: 'After the start, set 1,000 rpm: no higher while we stand still.' } }),
      ],
      ...(talk ? { feedback: feedback({
        start: 'Eyes on the oil pressure gauge, low on the left of the panel: the needle rises into the green.',
        milestones: [
          ms('rising', gt('oilPsi', 10), ['There it goes: oil pressure rising.']),
          ms('green', gt('oilPsi', 25), ['Oil pressure in the green. Now set 1,000 rpm on the tachometer.']),
          ms('idle', all(gt('oilPsi', 25), held(idleBand, 1)), ['1,000 rpm. That is where it sits while we stand still.']),
        ],
        success: 'Oil pressure green, 1,000 rpm. Now the after-start checks.',
        // What is still missing, from the state (never the oil once it is green).
        nudge: ['Still waiting on {missing}.'],
        nudgeMissing: [
          { when: lt('oilPsi', 25), text: 'the oil pressure', cue: { text: 'Watch the oil pressure. If it does not rise within 30 seconds, we shut down.' }, point: 'oil' },
          { when: not(idleBand), text: '1,000 rpm', cue: { text: 'Oil is green. Now 1,000 rpm on the tachometer: small throttle movements, F2 or F3.' }, point: 'throttle' },
        ],
        nudgeAfterS: 15, nudgeEveryS: 25,
      }), } : {}) }),
    checklist(`${pre}ckAfterStart`, 'afterStart', mode, { exercise }),
  ];
}

// ---- taxi --------------------------------------------------------------------------------------------------------

/**
 * Taxi reminders the ground coach does not already make (it watches the speed, the yellow line, the brake test,
 * the grass and the rpm on every taxi with a route): the parking brake left on, and the hold line close ahead.
 */
// The parking-brake nudge waits 24 s: the brief, the way out of the stand and "Go ahead" take about 13 s
// (round 7: it came 7 s after "Go ahead").
function taxiReminders(): CoachRule[] {
  return [
    reminder({ id: 'parkingBrakeOn', when: all(eq('parkingBrake', true), lt('gsKt', 1), gt('step.t', 24)), afterS: 4, point: 'parkingBrake',
      say: ['The parking brake is still set: Shift+B releases it.', 'Parking brake off first, Shift+B; then a little power, F3, to get rolling.'] }),
    reminder({ id: 'holdSlow', when: all(between('rwyAlongM', -20, 45), gt('rwyAcrossM', -100), gt('gsKt', 5)), afterS: 0.5,
      priority: 0, minLevel: 'silent', say: ['Slow down: the hold line is just ahead.', 'Throttle closed and brake: stop before the double yellow lines.'] }),
  ];
}

/**
 * Taxi from the apron to holding point A1: speed, brake test, paved surfaces, and the hold line (safety). With
 * `talk`, she calls the route as it comes, from the distance along it (TaskStep.taxi: the engine's taxi guide,
 * whatever the cross-track: playtest 3 lost every call once the aircraft was 10 m off the line).
 */
export function taxiToA1Task(id: string, exercise: string, brief: string, talk = false): TaskStep {
  return task({ id, exercise, pf: 'student', brief,
    ...(talk ? { taxi: { to: 'A1' as const, brief: false }, feedback: feedback({
      start: 'Go ahead: a little power to get moving, then close the throttle and test the brakes.',
      milestones: [
        ms('moving', gt('gsKt', 2), ["We're moving. Brake test now: a short squeeze on both toe brakes."]),
        ms('braked', ever(BRAKE_TEST), ['Brakes work. Eyes outside now; I will call each turn.']),
      ],
      success: 'Stopped short of the line at holding point A1. Nicely taxied.',
      // Generic only: the reminders above say what is wrong, from the state; the taxi guide gives the next turn.
      nudge: ['Follow the yellow line; I will call each turn.', 'A little power to keep rolling, then throttle back to walking pace.'],
      nudgeAfterS: 30, nudgeEveryS: 60,
    }) } : {}),
    // Never taxi on a dead engine: if it stopped after the start (flooded, mixture pulled, starter released
    // too soon) the taxi waits, and the instructor says what to do instead of briefing a taxi (wave-3 playtest).
    when: engineRunning, whenPrompt: { afterS: 3, cue: 'L02.engineStopped', everyS: 25 },
    card: { title: 'Taxi to holding point A1', targets: [{ label: 'GS', sig: 'gsKt', value: 8, tol: { minus: 8, plus: 7 }, unit: 'kt' }] },
    goal: held(all(lt('gsKt', 1), AT_HOLD_A1), 2), timeoutS: 600, onTimeout: 'fail', coach: talk ? taxiReminders() : [],
    criteria: [
      peak(`${id}Gs`, 'Taxi speed', 'gsKt', 0, { minus: 0, plus: 15 }, { peakOf: 'max', required: true,
        advice: { high: 'Slow down: a brisk walking pace. Close the throttle before you need the brakes.' } }),
      check(`${id}Brakes`, 'Brakes tested as you moved off', { pred: BRAKE_TEST, withinS: 60, required: true }),
      binary(`${id}Paved`, 'Stayed on the paved surface', held(eq('onPaved', false), 1), { required: true }),
      binary(`${id}HoldLine`, 'Stopped before the hold line', eq('pastHoldLine', true), { required: true, safety: true,
        advice: { fail: 'You crossed the holding point line: that is a runway incursion. Stop well before it.' } }),
    ] });
}

/** The A1 hold line, for other modules that need it (across, m). */
export const A1_HOLD_LINE_ACROSS_M = HOLD_LINE_ACROSS;

// ---- run-up -------------------------------------------------------------------------------------------------------

/**
 * A magneto's drop: the lowest rpm while that magneto alone is selected (after 1 s, so the switch itself is
 * not sampled), against the run-up rpm captured just before. The band is 150 rpm below, the C172S's maximum
 * drop (magDropMaxRpm: a tolerance cannot name a setting), and a little above.
 */
function magDrop(id: string, label: string, rpmVar: string, mags: 1 | 2): Criterion {
  return peak(id, label, 'rpm', v(rpmVar), { minus: 150, plus: 25 }, { peakOf: 'min', activeWhen: held(eq('mags', mags), 1), required: false,
    advice: { low: 'A drop beyond 150 rpm needs an engineer: it is a no-go item.' } });
}

/**
 * Run-up: the run-up checklist, 1,800 rpm set and captured, the magneto check, and the before-take-off
 * checklist. Each magneto's drop is graded (not required, section 4.1); the 50 rpm left/right difference
 * compares two measurements, which no single criterion can, so it is not graded.
 */
export function runupSteps(pre: string, exercise: string, mode: ChecklistMode): StepDef[] {
  const talk = mode === 'challengeResponse';
  const runup = { setting: 'runupRpm' } as const;
  // Talked through, the run-up goes in the order an instructor flies it: 1,800 rpm, the magnetos, then the
  // run-up checklist confirms what was just done (suction, instruments, idle, back to 1,000). Playtest 3: the
  // list first asked to confirm a magneto check that had not happened yet. The skill test observes silently.
  const ckRunup = checklist(`${pre}ckRunup`, 'runup', mode, { exercise });
  const steps: StepDef[] = [
    task({ id: `${pre}setRunup`, exercise, brief: 'L02.runupRpm',
      card: { title: 'Run-up: 1,800 rpm', targets: [rpm(runup, 100)] },
      // Held for 8 s: the rpm criterion needs 5 s of samples after its 2 s settling to grade at all.
      // +-100 rpm: a keyboard tap moves the run-up rpm 60-120 (playtest 3: +-50 for 8 s was never achieved).
      goal: held(near('rpm', runup, 100), 8), timeoutS: 90, onTimeout: 'next',
      coach: talk ? [
        reminder({ id: 'runupBrake', when: eq('parkingBrake', false), afterS: 2, priority: 0,
          say: ['Parking brake, please: it must hold us at 1,800.', 'Parking brake SET before the power comes up.'] }),
        reminder({ id: 'runupLow', when: all(lt('rpm', { setting: 'runupRpm', add: -150 }), gt('step.t', 15)), afterS: 6,
          say: ['A little more power: 1,800 on the tachometer.', 'Throttle forward slowly until the tachometer reads 1,800.'] }),
        reminder({ id: 'runupHigh', when: gt('rpm', { setting: 'runupRpm', add: 150 }), afterS: 3,
          say: ["That's above 1,800: ease the throttle back.", 'Small movements: back a little, until the tachometer reads 1,800.'] }),
      ] : [],
      // Graded from the moment 1,800 is first set: the climb of the rpm toward it is not a deviation.
      criteria: [hold(`${pre}runupRpm`, 'Run-up rpm', 'rpm', runup, 100, { settleS: 2, activeWhen: ever(held(near('rpm', runup, 100), 1)), required: true })],
      ...(talk ? { feedback: feedback({
        start: 'Go ahead: brakes holding, throttle forward slowly, eyes on the tachometer.',
        milestones: [ms('nearly', gt('rpm', { setting: 'runupRpm', add: -300 }), ['Nearly there. Small throttle movements now.'])],
        success: '{setting.runupRpm:rpm}, steady, and the brakes are holding. Good.',
        nudge: 'Still waiting on {missing}.',
        // Said only while it is wrong: never "throttle up to 1,800" at 1,800 (playtest 3).
        nudgeMissing: [
          { when: lt('rpm', { setting: 'runupRpm', add: -100 }), text: 'the run-up rpm', cue: { text: 'Throttle up slowly, F3, until the tachometer reads {setting.runupRpm:rpm}.' }, point: 'throttle' },
          { when: gt('rpm', { setting: 'runupRpm', add: 100 }), text: 'the run-up rpm', cue: { text: 'A little too much: ease back with F2 to {setting.runupRpm:rpm}.' }, point: 'throttle' },
        ],
      }) } : {}) }),
    capture(`${pre}capRpm`, { [`${pre}rpmRun`]: 'rpm' }),
    task({ id: `${pre}mags`, exercise, brief: 'L02.mags',
      card: { title: 'Magnetos: right, both, left, both', targets: [rpm({ var: `${pre}rpmRun` }, { minus: 150, plus: 50 })] },
      goal: all(ever(held(eq('mags', 1), 3)), ever(held(eq('mags', 2), 3)), held(eq('mags', 3), 2)),
      timeoutS: 180, onTimeout: 'next', coach: talk ? [
        // What is still to do, from the state: the next magneto, or back to BOTH.
        reminder({ id: 'magsRight', when: all(not(ever(held(eq('mags', 1), 3))), eq('mags', 3), gt('step.t', 8)), afterS: 6,
          say: ['Right magneto first: key 2, to R.', 'Key back two clicks from BOTH, to R, and watch the drop.'] }),
        reminder({ id: 'magsLeft', when: all(ever(held(eq('mags', 1), 3)), not(ever(held(eq('mags', 2), 3))), eq('mags', 3)), afterS: 6,
          say: ['Now the left magneto: key 3, to L.', 'Key one click back from BOTH, to L, and note the drop.'] }),
        reminder({ id: 'magsBoth', when: any(held(eq('mags', 1), 6), held(eq('mags', 2), 6)), afterS: 0,
          say: ['Back to BOTH now: key 4.', 'Key back to BOTH: a few seconds on one magneto is enough.'] }),
      ] : [],
      criteria: [
        check(`${pre}magR`, 'Right magneto checked', { pred: held(eq('mags', 1), 3), required: true }),
        check(`${pre}magL`, 'Left magneto checked', { pred: held(eq('mags', 2), 3), required: true }),
        magDrop(`${pre}dropR`, 'Drop on the right magneto', `${pre}rpmRun`, 1),
        magDrop(`${pre}dropL`, 'Drop on the left magneto', `${pre}rpmRun`, 2),
        binary(`${pre}magOff`, 'Never switched to OFF', eq('mags', 0), { required: true, safety: true,
          advice: { fail: 'Never turn the magnetos to OFF at high power: the backfire can damage the engine.' } }),
      ],
      ...(talk ? { feedback: feedback({
        start: 'Go ahead: right magneto first, key 2. Watch the rpm drop a little, then back to both.',
        milestones: [
          ms('right', held(eq('mags', 1), 2), ['Right magneto: a small drop. That is normal. Back to both.']),
          ms('both', all(ever(held(eq('mags', 1), 2)), held(eq('mags', 3), 1)), ['Both. Now the left magneto.']),
          ms('left', all(ever(held(eq('mags', 1), 2)), held(eq('mags', 2), 2)), ['Left magneto: a similar drop. Back to both.']),
        ],
        success: 'Both magnetos good, drops within limits. Each ignition system works on its own.',
        nudge: 'Magnetos: right, both, left, both. A few seconds on each.',
      }) } : {}) }),
  ];
  return [...(talk ? [] : [ckRunup]), ...steps, ...(talk ? [ckRunup] : []), checklist(`${pre}ckBeforeTo`, 'beforeTakeoff', mode, { exercise })];
}
