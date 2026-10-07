// The owner playtest fixes in the engine (decisions 1-4): guided challenge-and-response checklists (the item
// is done when its state holds, the reason is said once per run, the controls are pointed at in order),
// state-driven reminders that never repeat themselves and then offer help, ground coaching of the rpm, and the
// taxi guide's position-based calls along the real KFBL route from the stand to holding point A1.

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/training/grading/grade', async () => ({ Grader: (await import('./fakes/runnerFakes')).FakeGrader }));
vi.mock('../../src/training/grading/results', async () => {
  const f = await import('./fakes/runnerFakes');
  return { lessonOutcome: f.fakeLessonOutcome, lessonStars: f.fakeLessonStars, overallImpression: () => '' };
});
vi.mock('../../src/training/grading/debrief', async () => ({ buildDebrief: (await import('./fakes/runnerFakes')).fakeBuildDebrief }));
vi.mock('../../src/training/engine/events', async () => {
  const f = await import('./fakes/runnerFakes');
  return { DerivedEventDetector: f.NullDetector, LandingDetector: f.NullDetector, touchdownData: () => null };
});

import type { ControlInputs } from '../../src/core/types';
import { TrainingBus } from '../../src/training/engine/bus';
import { checklist, end, eq, ge, gt, held, lt, task, wait } from '../../src/training/engine/dsl';
import { differentLine, normaliseLine, ReminderLadder } from '../../src/training/engine/reminders';
import { LessonRunner, RUNNER_LINES, type RunnerDeps, type RunnerHost } from '../../src/training/engine/runner';
import { TaxiGuide } from '../../src/training/engine/taxiGuide';
import { buildTaxiRoute } from '../../src/training/geo/taxiRoute';
import { STANDARDS } from '../../src/training/grading/standards';
import { createTaxiProvider } from '../../src/training/telemetry/providers/taxi';
import { Telemetry } from '../../src/training/telemetry/telemetry';
import type {
  AircraftTypeDef, CalloutModel, ChecklistDef, ExerciseDef, Lesson, PhaseDef, SignalFrame, TaxiRoute, TelemetrySources, TrainingSettings,
} from '../../src/training/types';
import { PARKING } from '../../src/world/airport/layout';
import { FakeHost, ScriptedTelemetry, seededRng, testAircraft } from './fakes/runnerFakes';

// ---- fixtures ---------------------------------------------------------------------------------------------------

const BEFORE_START: ChecklistDef = {
  id: 'beforeStart', title: 'Before starting engine', items: [
    { id: 'avionicsOff', challenge: 'Avionics switch', response: 'Off', check: eq('avionics', false) },
    { id: 'master', challenge: 'Master switch', response: 'On', check: eq('master', true) },
    { id: 'propArea', challenge: 'Propeller area', response: 'Clear' },
    { id: 'mixture', challenge: 'Mixture', response: 'Rich', check: ge('mixture', 0.95), critical: true },
  ],
};

function aircraft(): AircraftTypeDef {
  const a = testAircraft();
  return { ...a, checklists: { ...a.checklists, beforeStart: BEFORE_START } as AircraftTypeDef['checklists'] };
}

const EX: ExerciseDef[] = [{ id: 'ex', title: 'Practice', skill: 'groundOps', mode: 'practice', standard: 'training', required: false, weight: 1 }];
const SETTINGS: TrainingSettings = {
  authority: 'easa', talkativeness: 'normal',
  voice: { instructor: null, examiner: null, rate: 1, volume: 0.9, captions: true, captionsOnly: true },
  instructorSaves: true, liveBars: true, autoAck: false, logFreeFlights: false,
};

function lesson(flow: PhaseDef[], over: Partial<Lesson> = {}): Lesson {
  return {
    id: 'G01', version: 1, number: 2, title: 'Ground test', syllabusRef: { easa: 'Ex 2', faa: 'ACS II' }, stage: 'handling',
    kind: 'dual', persona: 'instructor', requires: [], aircraft: 'any', estMinutes: 10,
    start: { kind: 'ground', spot: 'parking', engine: 'cold' }, weather: { preset: 'calm' },
    rules: { coachLevel: 'full', autopilot: 'forbidden', maxTimeScale: 1, instructorSaves: true, maxDurationS: 1500 },
    briefing: { aim: 'Test.', points: ['One.'], numbers: [], tolerances: [], airmanship: [], keys: [], spoken: { text: 'Today.' } },
    exercises: EX, flow, ...over,
  };
}

/** On the stand, engine off, everything off. */
function coldSignals(): SignalFrame {
  return {
    onGround: true, engineRunning: false, rpm: 0, gsKt: 0, avionics: true, master: false, mixture: 0.2, throttle: 0,
    brakes: 0, parkingBrake: true, mags: 0, altFt: 394, asiKt: 0, kias: 0, hdgDeg: 160, aiBankDeg: 0, bankDeg: 0, aglFt: 0,
    vsiFpm: 0, flapsDeg: 0, studentInput: false,
  };
}

class Harness {
  host = new FakeHost();
  tel = new ScriptedTelemetry();
  bus = new TrainingBus();
  signals: SignalFrame = coldSignals();
  runner: LessonRunner;
  callouts: (CalloutModel | null)[] = [];
  controls: Partial<ControlInputs>[] = [];

  constructor(readonly l: Lesson, over: Partial<RunnerDeps> = {}) {
    const ui = this.host.ui as unknown as { setCallout(c: CalloutModel | null): void };
    ui.setCallout = (c) => this.callouts.push(c);
    (this.host as unknown as { setControls(c: Partial<ControlInputs>): void }).setControls = (c) => {
      this.controls.push(c);
      // The aircraft does what she set.
      if (c.mixture !== undefined) this.signals.mixture = c.mixture;
      if (c.avionics !== undefined) this.signals.avionics = c.avionics;
      if (c.masterBattery !== undefined) this.signals.master = c.masterBattery;
    };
    const deps: RunnerDeps = {
      aircraft: aircraft(), standards: STANDARDS, authority: 'easa', lines: {}, rng: seededRng(3), telemetry: this.tel.asTelemetry(),
      bus: this.bus, settings: SETTINGS, demos: {}, progress: null, attempt: 1, ...over,
    };
    this.runner = new LessonRunner(l, this.host as unknown as RunnerHost, deps);
  }

  async start(): Promise<this> {
    await this.runner.begin();
    this.runner.startFlight();
    return this;
  }

  tick(dt = 0.1): void {
    this.runner.update(dt, dt, { studentInput: false, signals: this.signals } as unknown as TelemetrySources);
  }

  run(s: number): void {
    for (let i = 0; i < Math.round(s / 0.1); i++) this.tick();
  }

  get captions(): string[] {
    return this.host.speech.captions;
  }

  /** Callout targets in the order they were first shown (distinct consecutive). */
  get pointed(): string[] {
    const out: string[] = [];
    for (const c of this.callouts) if (c && out.at(-1) !== c.target) out.push(c.target);
    return out;
  }
}

// ---- guided checklists -----------------------------------------------------------------------------------------

describe('guided challenge-and-response checklist (decision 2)', () => {
  it('reads each item with its state, where and why; done from state without Enter; points at each control in order', async () => {
    const h = await new Harness(lesson([{ id: 'p', title: 'P', steps: [checklist('ck', 'beforeStart', 'challengeResponse', { exercise: 'ex', timeoutS: 300 }), end('fin')] }])).start();
    h.tick();
    // Avionics are on: the instructor says what it must be, where it is, and why.
    expect(h.captions[0]).toBe('Avionics switch: OFF.');
    expect(h.captions[1]).toMatch(/^That's the rocker at the right of the switch row.*Key I\.$/);
    expect(h.captions[2]).toBe(RUNNER_LINES['why.avionicsOff'].text);
    h.run(0.3);
    const c = h.callouts.at(-1)!;
    expect(c).toMatchObject({ target: 'avionics', label: 'Avionics switch', state: 'OFF', key: 'I', done: false, source: 'checklist', glance: true });
    expect(c.keyCode).toEqual({ code: 'KeyI', shift: false });
    expect(c.why).toBe(RUNNER_LINES['why.avionicsOff'].text);
    // The student finds it and switches it off: checked, no Enter.
    h.signals.avionics = false;
    h.run(0.3);
    expect(h.captions).toContain('Checked.');
    // Master: off -> "Master switch: ON." and the student switches it on.
    expect(h.captions).toContain('Master switch: ON.');
    h.signals.master = true;
    h.run(0.3);
    // The prop area has no state: Enter answers it.
    expect(h.captions).toContain('Propeller area: clear? Press Enter when it is.');
    h.runner.input('ack');
    h.run(0.3);
    expect(h.captions).toContain('Clear');
    expect(h.captions).toContain('Mixture: RICH.');
    h.signals.mixture = 1;
    h.run(0.5);
    expect(h.runner.phase).toBe('debrief');
    expect(h.pointed).toEqual(['avionics', 'master', 'mixture']);
    expect(h.host.ended[0].exercises.find((e) => e.exerciseId === 'ex')?.grade).toBe(4);
  });

  it('an item already set is verified aloud; the why and the where are said once per run', async () => {
    const steps = [
      checklist('ck1', 'beforeStart', 'challengeResponse', { timeoutS: 300 }),
      checklist('ck2', 'beforeStart', 'challengeResponse', { timeoutS: 300 }),
      end('fin'),
    ];
    const h = await new Harness(lesson([{ id: 'p', title: 'P', steps }])).start();
    h.signals.avionics = false;
    h.tick();
    expect(h.captions[0]).toMatch(/^Avionics switch: off\. (Checked|Good|That's it)/);
    for (let i = 0; i < 400 && h.runner.phase === 'running'; i++) {
      h.tick();
      h.signals.master = true;
      h.signals.mixture = 1;
      if (i % 10 === 0) h.runner.input('ack');
    }
    expect(h.runner.phase).toBe('debrief');
    const once = (t: string): number => h.captions.filter((c) => c === t).length;
    expect(once(RUNNER_LINES['why.avionicsOff'].text as string)).toBe(1);
    expect(once(RUNNER_LINES['why.master'].text as string)).toBe(1);
    expect(once(RUNNER_LINES['why.mixture'].text as string)).toBe(1);
    expect(h.captions.filter((c) => c.startsWith("That's ")).length).toBeLessThanOrEqual(2);   // where-lines: master, mixture, once each
  });

  it('reminders say what is still wrong, never in the same words, then offer help; [ sets it and moves on', async () => {
    const h = await new Harness(lesson([{ id: 'p', title: 'P', steps: [checklist('ck', 'beforeStart', 'challengeResponse', { timeoutS: 300 }), end('fin')] }])).start();
    h.signals.avionics = false;
    h.signals.master = true;
    h.tick();
    for (let i = 0; i < 80 && !h.captions.includes('Mixture: RICH.'); i++) {
      h.tick();
      if (i % 10 === 5) h.runner.input('ack');
    }
    expect(h.captions).toContain('Mixture: RICH.');
    const from = h.captions.length;
    h.run(40);
    const said = h.captions.slice(from).filter((c) => c !== RUNNER_LINES['why.mixture'].text && !c.startsWith("That's "));
    expect(said[0]).toBe('The mixture is still lean: it needs to be rich, key Shift+M.');
    expect(said[1]).toMatch(/^Look at the red knob right of the throttle\. Mixture: rich\.$/);
    expect(said[2]).toBe('Would you like me to show you where the mixture is? Press the left bracket.');
    expect(said).toHaveLength(3);
    for (let i = 1; i < said.length; i++) expect(normaliseLine(said[i])).not.toBe(normaliseLine(said[i - 1]));
    h.runner.input('showMe');
    expect(h.controls.at(-1)).toEqual({ mixture: 1 });
    expect(h.captions.at(-1)).toMatch(/^Here: the red knob right of the throttle\. Mixture rich, like that\.$/);
    h.run(0.5);
    expect(h.runner.phase).toBe('debrief');
  });

  it('solo checklists keep the old behaviour (no guidance, no callouts)', async () => {
    const h = await new Harness(lesson([{ id: 'p', title: 'P', steps: [checklist('ck', 'beforeStart', 'challengeResponse', { timeoutS: 300 }), end('fin')] }], { kind: 'solo' })).start();
    h.tick();
    expect(h.captions[0]).toBe('Avionics switch?');
    h.run(1);
    expect(h.callouts.filter((c) => c !== null)).toHaveLength(0);
  });
});

// ---- state-driven reminders (decision 4) ------------------------------------------------------------------------

describe('reminders follow the state and never repeat (decision 4)', () => {
  it('differentLine / ReminderLadder', () => {
    expect(differentLine(['Throttle back.', 'Ease it back.'], 'throttle back')).toBe('Ease it back.');
    expect(differentLine(['Same.'], 'same')).toBeNull();
    const L = new ReminderLadder();
    expect(L.next(['A one.', 'B two.'])).toBe('A one.');
    expect(L.next(['A one.', 'B two.'])).toBe('B two.');
    expect(L.dueForHelp).toBe(true);
  });

  it('a task nudge names what is still missing first, then the lesson nudge, then offers help once', async () => {
    const MISSING = 'The mixture is still lean: push it fully in, the red knob.';
    const NUDGE = 'Set up for the start: {missing} first.';
    const t = task({
      id: 'setup', exercise: 'ex', brief: { text: 'Get her ready to start.' }, pf: 'student',
      card: { title: 'Set up', targets: [] }, goal: held(ge('mixture', 0.95), 1), timeoutS: 200, criteria: [],
      feedback: { start: { text: 'Go ahead.' }, nudge: { cue: { text: NUDGE }, afterS: 3, everyS: 4, missing: [{ when: lt('mixture', 0.95), text: 'the mixture', cue: { text: MISSING }, point: 'mixture' }] } },
    });
    const h = await new Harness(lesson([{ id: 'p', title: 'P', steps: [t, wait('w', { const: false })] }])).start();
    h.run(20);
    const nudges = h.captions.filter((c) => c === MISSING || c.startsWith('Set up for the start') || c === RUNNER_LINES['runner.taskHelpSayAgain'].text);
    expect(nudges).toEqual([MISSING, 'Set up for the start: the mixture first.', RUNNER_LINES['runner.taskHelpSayAgain'].text]);
    // The missing item was pointed at while it was named.
    expect(h.callouts.some((c) => c?.target === 'mixture' && c.source === 'reminder')).toBe(true);
  });
});

// ---- ground coaching --------------------------------------------------------------------------------------------

describe('ground coach: rpm above 1,000 is acted on', () => {
  it('stationary above 1,200 rpm for 5 s: bring the power back; reminders differ; nothing while a step wants power', async () => {
    const h = await new Harness(lesson([{ id: 'p', title: 'P', steps: [wait('w', { const: false })] }])).start();
    Object.assign(h.signals, { engineRunning: true, rpm: 1550, gsKt: 0 });
    h.run(4.5);
    expect(h.captions.filter((c) => c.startsWith('Bring the power back'))).toHaveLength(0);
    h.run(1);
    expect(h.captions.at(-1)).toBe('Bring the power back to 1,000 rpm: throttle out a little, key F2.');
    expect(h.callouts.some((c) => c?.target === 'throttle')).toBe(true);
    h.run(16);
    const rem = h.captions.filter((c) => /rpm/.test(c));
    expect(rem.length).toBe(2);
    expect(normaliseLine(rem[1])).not.toBe(normaliseLine(rem[0]));
    h.signals.rpm = 1000;
    const n = h.captions.length;
    h.run(30);
    expect(h.captions.length).toBe(n);

    // A run-up task (card rpm 1,800): no remark.
    const runup = task({ id: 'ru', exercise: 'ex', brief: { text: 'Run-up.' }, card: { title: 'Run-up', targets: [{ label: 'RPM', sig: 'rpm', value: 1800, tol: 100, unit: 'rpm' }] },
      goal: { const: false }, timeoutS: 100, criteria: [] });
    const r = await new Harness(lesson([{ id: 'p', title: 'P', steps: [runup] }])).start();
    Object.assign(r.signals, { engineRunning: true, rpm: 1800, gsKt: 0 });
    r.run(20);
    expect(r.captions.filter((c) => /power back|rpm/i.test(c) && c !== 'Run-up.')).toHaveLength(0);
    void gt;
  });
});

// ---- taxi guide calls along the real layout --------------------------------------------------------------------

function along(r: TaxiRoute, s: number): { north: number; east: number; hdg: number } {
  const p = r.points;
  let k = 1;
  while (k < p.length - 1 && p[k].sM < s) k++;
  const a = p[k - 1], b = p[k];
  const t = Math.max(0, Math.min(1, (s - a.sM) / (b.sM - a.sM || 1)));
  return { north: a.north + (b.north - a.north) * t, east: a.east + (b.east - a.east) * t, hdg: Math.atan2(b.east - a.east, b.north - a.north) };
}

describe('taxi guide: position-based calls from the stand to A1 (decision 3)', () => {
  it('briefs the route, calls each junction before and at it, the long legs, and the hold; never the same words twice', () => {
    const route = buildTaxiRoute(PARKING.north, PARKING.east, 'A1')!;
    const tel = new Telemetry([createTaxiProvider()]);
    const guide = new TaxiGuide(route, true);
    const calls: { s: number; id: string; text: string }[] = [];
    const models: string[] = [];
    for (let s = 0; s <= route.lengthM + 0.1; s += 1) {
      const p = along(route, Math.min(s, route.lengthM - 0.01));
      const src = { state: { position: { x: p.north, y: p.east, z: 0 }, heading: p.hdg, onGround: true }, taxiRoute: route } as unknown as TelemetrySources;
      const f = tel.sample(src, 0.1);
      f.gsKt = 8;
      const c = guide.update(f, 0.1, true);
      if (c) calls.push({ s, id: c.id, text: c.cue.text as string });
      const m = guide.model(f);
      if (m) models.push(`${m.holdShort ? 'HOLD' : m.action}:${m.name}`);
    }
    const ids = calls.map((c) => c.id);
    expect(ids[0]).toBe('brief');
    expect(calls[0].text).toBe('Our route: right onto the apron line, left onto B1, right onto Alpha, then left onto A1 and hold short.');
    expect(ids).toContain('stand');
    expect(calls.find((c) => c.id === 'stand')?.text).toBe('Straight ahead out of the stand to the yellow line, then turn right along it.');
    for (const id of ['turn:0', 'turn:1', 'turn:2', 'turn:3', 'prep:2', 'prep:3', 'follow:1', 'follow:2', 'mid:3', 'hold:far', 'hold:near']) expect(ids, id).toContain(id);
    expect(calls.find((c) => c.id === 'turn:1')?.text).toBe('Turn left now onto B1; follow the yellow line round.');
    expect(calls.find((c) => c.id === 'follow:2')?.text).toMatch(/^Now follow Alpha ahead, about \d+ metres\. A1 will be on the left\.$/);
    expect(calls.find((c) => c.id === 'hold:far')?.text).toBe('Holding point A1 ahead: stop before the double yellow lines across the taxiway.');
    // Each call once, no two alike, and in route order (each turn call after its approach call).
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(calls.map((c) => normaliseLine(c.text))).size).toBe(calls.length);
    expect(ids.indexOf('prep:3')).toBeLessThan(ids.indexOf('turn:3'));
    expect(ids.indexOf('turn:3')).toBeLessThan(ids.indexOf('hold:far'));
    // The HUD shows each next action in turn, then HOLD SHORT.
    const seq = models.filter((m, i) => i === 0 || models[i - 1] !== m);
    // A1 is only ~40 m long: past the turn onto it the HUD goes straight to HOLD SHORT.
    expect(seq).toEqual(['right:Apron line', 'left:B1', 'right:Alpha', 'left:A1', 'HOLD:A1']);
  });

  it('a wrong turn: stop, and a new route from where the aircraft is', () => {
    const route = buildTaxiRoute(PARKING.north, PARKING.east, 'A1')!;
    const tel = new Telemetry([createTaxiProvider()]);
    const guide = new TaxiGuide(route, true);
    const p = along(route, 400);
    // 40 m off Alpha (into the grass).
    const src = { state: { position: { x: p.north + 40 * Math.sin(p.hdg), y: p.east - 40 * Math.cos(p.hdg), z: 0 }, heading: p.hdg, onGround: true }, taxiRoute: route } as unknown as TelemetrySources;
    let said = '';
    for (let i = 0; i < 50; i++) {
      const c = guide.update(tel.sample(src, 0.1), 0.1, true);
      if (c?.id.startsWith('offRoute')) said = c.cue.text as string;
    }
    expect(said).toMatch(/^That's not our way/);
    expect(guide.needsReroute).toBe(true);
  });
});

// ---- playtest 3 fixes --------------------------------------------------------------------------------------------

describe('playtest 3: guided lines are heard in order, prime verified, rpm enforced, the grass called', () => {
  it('the next item is not read while the last item\'s lines are still being said', async () => {
    const h = await new Harness(lesson([{ id: 'p', title: 'P', steps: [checklist('ck', 'beforeStart', 'challengeResponse', { timeoutS: 300 }), end('fin')] }])).start();
    h.host.speech.hold = true;   // the voice is still talking
    h.tick();
    const read = h.host.speech.queue.map((r) => r.caption);
    expect(read[0]).toBe('Avionics switch: OFF.');
    // The student switches it off at once: "Checked", but the master is not read until the voice is free.
    h.signals.avionics = false;
    h.run(2);
    const queued = h.host.speech.queue.map((r) => r.caption);
    expect(queued).toContain('Checked.');
    expect(queued).not.toContain('Master switch: ON.');
    // Guided lines outlive a long reading (no 8 s TTL).
    expect(Math.min(...h.host.speech.queue.map((r) => r.ttlMs))).toBeGreaterThanOrEqual(30000);
    h.host.speech.hold = false;
    h.host.speech.finishAll();
    h.run(0.3);
    expect(h.captions).toContain('Master switch: ON.');
  });

  it('the prime item is done only once the pump has been on and is off again', async () => {
    const a = testAircraft();
    const { C172S } = await import('../../src/training/aircraft/c172s');
    const prime: ChecklistDef = { id: 'beforeStart', title: 'Before start', items: C172S.checklists.beforeStart.items.filter((i) => i.id === 'fuelPumpPrime') };
    const h = await new Harness(lesson([{ id: 'p', title: 'P', steps: [checklist('ck', 'beforeStart', 'challengeResponse', { timeoutS: 300 }), end('fin')] }]),
      { aircraft: { ...a, checklists: { ...a.checklists, beforeStart: prime } as AircraftTypeDef['checklists'] } }).start();
    Object.assign(h.signals, { fuelPump: false });
    h.run(1);
    expect(h.captions[0]).toBe('Fuel pump: ON, THEN OFF.');
    expect(h.runner.phase).toBe('running');
    h.signals.fuelPump = true;
    h.run(3);
    expect(h.runner.phase).toBe('running');
    h.signals.fuelPump = false;
    h.run(1);
    expect(h.runner.phase).toBe('debrief');
  });

  it('rpm still high after the offer of help: she brings the throttle back herself, and the callout shows F2', async () => {
    const h = await new Harness(lesson([{ id: 'p', title: 'P', steps: [wait('w', { const: false })] }])).start();
    Object.assign(h.signals, { engineRunning: true, rpm: 1840, gsKt: 0 });
    h.run(70);
    expect(h.controls.some((c) => c.throttle !== undefined && c.throttle < 0.1)).toBe(true);
    expect(h.captions.some((c) => /^I'll bring the throttle back to 1,000 rpm for you/.test(c))).toBe(true);
    expect(h.callouts.some((c) => c?.target === 'throttle' && c.key === 'F2')).toBe(true);
    expect(h.captions.some((c) => /1,840 rpm/.test(c))).toBe(true);
  });

  it('off the paved surface while taxiing: "Stop", repeated while it lasts', async () => {
    const h = await new Harness(lesson([{ id: 'p', title: 'P', steps: [wait('w', { const: false })] }])).start();
    Object.assign(h.signals, { engineRunning: true, rpm: 1000, gsKt: 6, onPaved: false });
    h.run(25);
    const stops = h.captions.filter((c) => /^Stop/.test(c));
    expect(stops.length).toBeGreaterThanOrEqual(2);
    expect(normaliseLine(stops[1])).not.toBe(normaliseLine(stops[0]));
  });

  it('a nudge with a missing list is silent when nothing on it is missing', async () => {
    const t = task({
      id: 'ru', exercise: 'ex', brief: { text: 'Run-up.' }, pf: 'student', card: { title: 'Run-up', targets: [] },
      goal: { const: false }, timeoutS: 200, criteria: [],
      feedback: { nudge: { cue: { text: 'Still waiting on {missing}.' }, afterS: 3, everyS: 4, missing: [{ when: lt('rpm', 1700), text: 'the rpm', cue: { text: 'Throttle up to 1,800.' } }] } },
    });
    const h = await new Harness(lesson([{ id: 'p', title: 'P', steps: [t, wait('w', { const: false })] }])).start();
    Object.assign(h.signals, { engineRunning: true, rpm: 1800, gsKt: 0 });
    h.run(20);
    expect(h.captions.filter((c) => /Throttle up|Still waiting/.test(c))).toHaveLength(0);
    h.signals.rpm = 1500;
    h.run(10);
    expect(h.captions).toContain('Throttle up to 1,800.');
  });
});
