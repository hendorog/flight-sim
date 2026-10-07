// Replays of the recorded telemetry fixtures (spec section 6.4.2; recorded by scripts/record-telemetry.mjs
// from real flights of the flight model, see record.ts): the derived-event and landing detectors, the
// grader and the coach run on flown data, frame by frame at 30 Hz, exactly as the runner feeds them.
//
// The assertions are the results the recorded flights must give: which events fire and where, the graded
// outcome of the criteria the lessons use (at the test and the training standard), and the coach topics. A
// detector, grading or coach change that alters any of them shows up here.

import { describe, expect, it } from 'vitest';
import { C172S } from '../../../src/training/aircraft/c172s';
import { hold, lt, peak } from '../../../src/training/engine/dsl';
import { TrainingBus } from '../../../src/training/engine/bus';
import { Coach } from '../../../src/training/engine/coach';
import { DerivedEventDetector, LandingDetector } from '../../../src/training/engine/events';
import { Grader } from '../../../src/training/grading/grade';
import { gradeLanding } from '../../../src/training/grading/landing';
import { STANDARDS } from '../../../src/training/grading/standards';
import { Telemetry } from '../../../src/training/telemetry/telemetry';
import type {
  AuthorityId, EvalContext, ExerciseDef, Grade, LandingData, SignalDef, SignalFrame, SignalId, Standard, TaskStep, TrainingEventRecord,
} from '../../../src/training/types';
import circuitJson from './circuit.json';
import descentBustJson from './descentBust.json';
import goAroundJson from './goAround.json';
import hardLandingJson from './hardLanding.json';
import noseFirstJson from './noseFirst.json';
import stallJson from './stall.json';
import steepTurnJson from './steepTurn.json';
import type { TelemetryFixture } from './record';

const FIELD_ELEV_FT = 394;
const defs = new Telemetry();

/** One replay: the fixture's frames through the bus, the detectors and an EvalContext like the runner's. */
class Replay implements EvalContext {
  readonly frame: SignalFrame = {};
  readonly bus = new TrainingBus();
  readonly events = this.bus;
  readonly aircraft = C172S;
  readonly fieldElevFt = FIELD_ELEV_FT;
  readonly standards = STANDARDS;
  vars: Record<string, number> = {};
  stepMark = 0;
  stepT = 0;
  dt = 0;
  simT = 0;
  pilot: 'student' | 'instructor' = 'student';
  speechIdle = true;
  readonly derived = new DerivedEventDetector(this.bus);
  readonly landing = new LandingDetector(this.bus);
  readonly log: TrainingEventRecord[] = [];
  /** LandingData summaries the landing detector produced. */
  readonly landings: LandingData[] = [];
  private touch = 0;
  private i = 0;

  constructor(readonly fx: TelemetryFixture, readonly authority: AuthorityId = 'easa', readonly standard: Standard = 'test') {
    this.bus.on('*', (r) => this.log.push(r));
  }

  signalDef(id: SignalId): SignalDef | undefined {
    return defs.def(id);
  }

  exerciseGrade(): Grade | null {
    return null;
  }

  get done(): boolean {
    return this.i >= this.fx.t.length;
  }

  /** The next frame: the touchdowns of the steps since the last frame, then the frame and the detectors. */
  next(): void {
    const fx = this.fx;
    const t = fx.t[this.i];
    this.dt = this.i === 0 ? 0 : t - fx.t[this.i - 1];
    this.simT = t;
    this.stepT += this.dt;
    while (this.touch < fx.touchdowns.length && fx.touchdowns[this.touch].t <= t + 1e-9) {
      const td = fx.touchdowns[this.touch++];
      this.bus.emit('touchdown', { wheel: td.wheel, sinkFpm: td.sinkFpm }, td.t);
      this.landing.onTouchdown(td.td, td.t);
    }
    for (const sig of fx.signals) this.frame[sig] = fx.columns[sig][this.i];
    this.derived.update(this.frame, t, this.dt);
    const l = this.landing.update(this.frame, t, this.dt);
    if (l) this.landings.push(l);
    this.i++;
  }

  run(each?: () => void): this {
    while (!this.done) {
      this.next();
      each?.();
    }
    return this;
  }

  /** Events of a type, in order. */
  of<K extends TrainingEventRecord['type']>(type: K): TrainingEventRecord<K>[] {
    return this.log.filter((r) => r.type === type) as TrainingEventRecord<K>[];
  }
}

const fixture = (j: unknown): TelemetryFixture => j as TelemetryFixture;
const exercise = (id: string, standard: Standard): ExerciseDef => ({ id, title: id, skill: 'descent', mode: 'assessed', standard, required: true, weight: 1 });

/** Grade one task over a stretch of a replay with the real Grader (sampling every frame while `active`). */
function gradeTask(r: Replay, step: TaskStep, standard: Standard, from: (r: Replay) => boolean, until: (r: Replay) => boolean) {
  const grader = new Grader({ standards: STANDARDS, authority: r.authority, exercises: [exercise(step.exercise, standard)], firstAttemptCounts: false });
  let open = false;
  let closed = false;
  r.run(() => {
    if (closed) return;
    if (!open && from(r)) {
      open = true;
      r.stepT = 0;
      grader.beginTask(step, r);
      return;
    }
    if (!open) return;
    grader.sample(r);
    for (const e of r.bus.since(0)) grader.onEvent(e, r);
    r.bus.clear();
    if (until(r)) {
      closed = true;
      grader.endTask('success', r);
    }
  });
  if (open && !closed) grader.endTask('success', r);
  return grader.exerciseResults()[0];
}

describe('recorded fixtures: events', () => {
  it('a keyboard-flown circuit: lift-off, every circuit leg, mains-first touchdown, a full-stop landing', () => {
    const r = new Replay(fixture(circuitJson)).run();
    const lift = r.of('liftoff');
    expect(lift).toHaveLength(1);
    expect(lift[0].data.kias).toBeGreaterThan(50);
    expect(lift[0].data.kias).toBeLessThan(65);
    const legs = new Set(r.fx.columns.circuitLeg as string[]);
    for (const leg of ['ground', 'upwind', 'crosswind', 'downwind', 'base', 'final']) expect(legs.has(leg), leg).toBe(true);
    const mains = r.of('mainsTouchdown');
    expect(mains).toHaveLength(1);
    expect(mains[0].data.firstWheel).not.toBe('nose');
    expect(r.landings).toHaveLength(1);
    const l = r.landings[0];
    expect(l.fullStop).toBe(true);
    expect(l.crashed).toBe(false);
    expect(l.onRunway).toBe(true);
    expect(l.sinkFpm).toBeLessThan(300);
    expect(r.of('stopped').length).toBeGreaterThanOrEqual(1);
  });

  it('a hard landing: mains first at about 465 fpm, one bounce; the landing grader fails the sink at test standard', () => {
    const r = new Replay(fixture(hardLandingJson)).run();
    expect(r.landings).toHaveLength(1);
    const l = r.landings[0];
    expect(l.firstWheel).not.toBe('nose');
    expect(l.sinkFpm).toBeGreaterThan(440);
    expect(l.sinkFpm).toBeLessThan(490);
    expect(l.bounces).toBeGreaterThanOrEqual(1);
    const rows = gradeLanding(l, { standards: STANDARDS, authority: 'easa', standard: 'test', vrefKt: 65, zone: 'touchdownZoneFt' });
    const sink = rows.find((x) => x.id.endsWith('sink'))!;
    expect(sink.grade).toBe(1);   // 0/+400 at test: n > 1
    const training = gradeLanding(l, { standards: STANDARDS, authority: 'easa', standard: 'training', vrefKt: 65, zone: 'touchdownZoneFt' });
    expect(training.find((x) => x.id.endsWith('sink'))!.grade).toBe(3);   // 0/+500 at training: n < 1
  });

  it('a nose-first arrival: the landing records the nosewheel first and the grader fails it as a safety item', () => {
    const r = new Replay(fixture(noseFirstJson)).run();
    expect(r.of('mainsTouchdown')[0].data.firstWheel).toBe('nose');
    const l = r.landings[0];
    expect(l.firstWheel).toBe('nose');
    const rows = gradeLanding(l, { standards: STANDARDS, authority: 'easa', standard: 'test', vrefKt: 65, zone: 'touchdownZoneFt' });
    const first = rows.find((x) => x.id.endsWith('firstWheel'))!;
    expect(first.safety).toBe(true);
    expect(first.grade).toBe(1);
  });

  it('a go-around at 200 ft: one goAround event between 150 and 250 ft AGL, no landing', () => {
    const r = new Replay(fixture(goAroundJson)).run();
    const ga = r.of('goAround');
    expect(ga).toHaveLength(1);
    expect(ga[0].data.aglFt).toBeGreaterThan(150);
    expect(ga[0].data.aglFt).toBeLessThan(250);
    expect(r.of('mainsTouchdown')).toHaveLength(0);
  });

  it('a power-off stall: the warning, then one break, then the warning goes off in the recovery', () => {
    const r = new Replay(fixture(stallJson)).run();
    const on = r.of('stallWarnOn');
    const brk = r.of('stallBreak');
    expect(on.length).toBeGreaterThanOrEqual(1);
    expect(brk).toHaveLength(1);
    expect(on[0].simT).toBeLessThan(brk[0].simT);
    expect(brk[0].data.kias).toBeLessThan(55);
    expect(r.of('stallWarnOff').length).toBeGreaterThanOrEqual(1);
  });

  it('a steep turn: the roll-out completes once the turn has been armed', () => {
    const fx = fixture(steepTurnJson);
    const r = new Replay(fx);
    r.next();
    r.derived.armRollout(Number(fx.columns.hdgDeg[0]));
    r.run();
    expect(r.of('rolloutComplete')).toHaveLength(1);
  });
});

describe('recorded fixtures: grading', () => {
  /** The L04 assessed descent's rate and level-off criteria, levelling at 3,000 ft. */
  const descent: TaskStep = {
    kind: 'task', id: 'aDesc', exercise: 'desc', brief: { text: '' }, card: { title: '500 fpm descent, level off', targets: [] }, goal: { const: false },
    criteria: [
      hold('aDescVs', 'Descent rate', 'vsiFpm', -500, 'vs', { settleS: 10, activeWhen: { sig: 'altFt', op: '>', v: 3150 }, required: true }),
      peak('aDescLevel', 'Level-off', 'altFt', 3000, 'altitude', { peakOf: 'min', required: true }),
    ],
  };

  it('a level-off 160 ft low fails at the EASA test standard (±150) and is Good at the training standard (±200)', () => {
    const fx = fixture(descentBustJson);
    expect(Math.min(...(fx.columns.altFt as number[]))).toBe(2840);
    const test = gradeTask(new Replay(fx, 'easa', 'test'), descent, 'test', (r) => r.simT > 6, () => false);
    const level = test.criteria.find((c) => c.id === 'aDescLevel')!;
    expect(level.grade).toBe(1);
    expect(level.worst?.dev).toBeCloseTo(-160, 0);
    const vs = test.criteria.find((c) => c.id === 'aDescVs')!;
    expect(vs.grade).toBeGreaterThanOrEqual(3);
    expect(test.grade).toBe(1);
    const training = gradeTask(new Replay(fx, 'easa', 'training'), descent, 'training', (r) => r.simT > 6, () => false);
    expect(training.criteria.find((c) => c.id === 'aDescLevel')!.grade).toBe(3);
    expect(training.grade).toBe(3);
  });

  it('the steep turn holds 45° within the FAA ±5 and the altitude within ±100 ft', () => {
    const fx = fixture(steepTurnJson);
    const step: TaskStep = {
      kind: 'task', id: 'steep', exercise: 'steep', brief: { text: '' }, card: { title: '45° turn left, 360°', targets: [] }, goal: { const: false },
      criteria: [
        hold('bank', 'Bank angle', 'aiBankDeg', -45, 'bankSteep', { settleS: 0, activeWhen: lt('aiBankDeg', -42), required: true }),
        hold('alt', 'Altitude', 'altFt', Math.round(Number(fx.columns.altFt[0])), 'altitude', { settleS: 5, required: true }),
      ],
    };
    const faa = gradeTask(new Replay(fx, 'faa', 'test'), step, 'test', () => true, () => false);
    expect(faa.criteria.find((c) => c.id === 'bank')!.grade).toBeGreaterThanOrEqual(3);
    expect(faa.criteria.find((c) => c.id === 'alt')!.grade).toBeGreaterThanOrEqual(3);
    expect(faa.grade).toBeGreaterThanOrEqual(3);
  });
});

describe('recorded fixtures: coach', () => {
  it('the late level-off draws the levelling and altitude remarks during the descent', () => {
    const fx = fixture(descentBustJson);
    const r = new Replay(fx, 'easa', 'training');
    const coach = new Coach({ talkativeness: 'normal', rate: (id) => rate(r, id) });
    const step: TaskStep = {
      kind: 'task', id: 'desc', exercise: 'desc', brief: { text: '' }, goal: { const: false },
      card: { title: '500 fpm descent, level off', targets: [
        { label: 'VS', sig: 'vsiFpm', value: -500, tol: 'vs', unit: 'fpm' },
        { label: 'ALT', sig: 'altFt', value: 3000, tol: 'altitude', unit: 'ft' },
      ] },
      criteria: [], coach: ['levelOff', 'altitude', 'vs'],
    };
    coach.setLevel('full');
    coach.beginPhase();
    const topics: string[] = [];
    let begun = false;
    r.run(() => {
      track(r);
      if (!begun && r.simT > 6) {
        begun = true;
        r.stepT = 0;
        coach.beginTask(step, r);
      }
      if (!begun || r.dt <= 0) return;
      const remark = coach.update(r, r.stepT > 8, true);
      if (remark) topics.push(remark.topic);
    });
    expect(topics).toContain('levelOff');
    expect(topics).toContain('altitude');
  });

  it('a well-flown steep turn draws no remark about the bank or the altitude', () => {
    const fx = fixture(steepTurnJson);
    const r = new Replay(fx, 'faa', 'test');
    const coach = new Coach({ talkativeness: 'normal', rate: (id) => rate(r, id) });
    const alt0 = Math.round(Number(fx.columns.altFt[0]));
    const step: TaskStep = {
      kind: 'task', id: 'steep', exercise: 'steep', brief: { text: '' }, goal: { const: false },
      card: { title: '45° turn left', targets: [
        { label: 'BANK', sig: 'aiBankDeg', value: -45, tol: 'bankSteep', unit: 'deg' },
        { label: 'ALT', sig: 'altFt', value: alt0, tol: 'altitude', unit: 'ft' },
      ] },
      criteria: [], coach: ['altitude'],
    };
    coach.setLevel('full');
    coach.beginPhase();
    const topics: string[] = [];
    r.run(() => {
      track(r);
      if (r.dt <= 0) return;
      if (r.simT < 5.1 && r.simT > 5) coach.beginTask(step, r);
      const remark = r.simT > 5 ? coach.update(r, true, true) : null;
      if (remark && !remark.praise) topics.push(remark.topic);
    });
    expect(topics.filter((t) => t === 'altitude')).toHaveLength(0);
  });
});

// ---- the coach's "already correcting" rates: a 1 s low-pass of each signal's derivative, as Telemetry does ----

const rates = new WeakMap<Replay, Map<string, { prev: number; rate: number }>>();

function track(r: Replay): void {
  let m = rates.get(r);
  if (!m) rates.set(r, (m = new Map()));
  for (const sig of ['altFt', 'vsiFpm', 'asiKt', 'aiBankDeg', 'hdgDeg']) {
    const x = Number(r.frame[sig]);
    const st = m.get(sig);
    if (!st) {
      m.set(sig, { prev: x, rate: 0 });
      continue;
    }
    if (r.dt > 0) {
      const d = (x - st.prev) / r.dt;
      st.rate += (d - st.rate) * Math.min(1, r.dt / 1);
    }
    st.prev = x;
  }
}

function rate(r: Replay, id: SignalId): number {
  return rates.get(r)?.get(id)?.rate ?? 0;
}
