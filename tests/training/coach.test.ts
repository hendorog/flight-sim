// Coach (spec 3.6) and the preset catalogue (3.6.3): afterS persistence (and the 1.5 s fast path), the
// "already correcting" suppression, topic and global gaps and the 3-per-minute cap, escalation rungs and
// their reset, praise rationing, coach levels, Safety bypass, quiet zones and talkativeness. Real predicates
// and refs; a hand-built EvalContext advanced in sim time.

import { describe, expect, it } from 'vitest';
import { Coach, quietZone, type CoachRemark } from '../../src/training/engine/coach';
import { TrainingBus } from '../../src/training/engine/bus';
import { gt, hold, lt, task } from '../../src/training/engine/dsl';
import { bindPreset, gateCoach, presetWhile, scaleTol } from '../../src/training/content/coachPresets';
import { STANDARDS } from '../../src/training/grading/standards';
import type {
  CoachLevel, CoachPresetId, CoachRule, EvalContext, InlineCue, SignalFrame, TaskCard, TaskStep, TrainingSettings,
} from '../../src/training/types';
import { cruiseSignals, testAircraft } from './fakes/runnerFakes';

type Ctx = EvalContext & { frame: SignalFrame; simT: number; dt: number; stepT: number };

function makeCtx(frame: SignalFrame = cruiseSignals()): Ctx {
  const bus = new TrainingBus();
  return {
    frame, vars: {}, aircraft: testAircraft(), fieldElevFt: 394, standards: STANDARDS, authority: 'easa', standard: 'training',
    events: bus, stepMark: 0, stepT: 0, dt: 0, simT: 0, pilot: 'student', speechIdle: true, exerciseGrade: () => null,
    signalDef: (id) => ({ id, kind: id === 'hdgDeg' || id === 'trackDeg' ? 'angle' : 'number', unit: '', hyst: 0, describe: '' }),
  };
}

const CARD: TaskCard = {
  title: 'Climb', targets: [
    { label: 'IAS', sig: 'asiKt', value: 74, tol: 'speedClimbApproach', unit: 'kt' },   // training: -5 / +15
    { label: 'ALT', sig: 'altFt', value: 3000, tol: 'altitude', unit: 'ft' },           // training: ±200
    { label: 'VS', sig: 'vsiFpm', value: 0, tol: 'vs', unit: 'fpm' },                   // training: ±300
    { label: 'HDG', sig: 'hdgDeg', value: 100, tol: 'heading', unit: 'deg' },           // training: ±15
  ],
};

function taskWith(coach: (CoachPresetId | CoachRule)[]): TaskStep {
  return task({ id: 't', exercise: 'ex', brief: 'x', card: CARD, goal: { const: false }, criteria: [], coach });
}

class Drive {
  readonly ctx: Ctx;
  readonly remarks: { t: number; r: CoachRemark }[] = [];
  rates: Record<string, number> = {};
  settled = true;
  idle = true;
  readonly coach: Coach;

  constructor(coach: (CoachPresetId | CoachRule)[], talk: TrainingSettings['talkativeness'] = 'normal', level: CoachLevel = 'full') {
    this.ctx = makeCtx({ ...cruiseSignals(), asiKt: 74, altFt: 3000, vsiFpm: 0, hdgDeg: 100 });
    this.coach = new Coach({ talkativeness: talk, rate: (id) => this.rates[id] ?? 0 });
    this.coach.setLevel(level);
    this.coach.beginPhase();
    this.coach.beginTask(taskWith(coach), this.ctx);
  }

  set(s: Partial<SignalFrame>): this {
    Object.assign(this.ctx.frame, s);
    return this;
  }

  run(seconds: number, dt = 0.1): this {
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) {
      this.ctx.dt = dt;
      this.ctx.simT = Math.round((this.ctx.simT + dt) * 1000) / 1000;
      this.ctx.stepT += dt;
      const r = this.coach.update(this.ctx, this.settled, this.idle);
      if (r) this.remarks.push({ t: this.ctx.simT, r });
    }
    return this;
  }

  get times(): number[] {
    return this.remarks.map((x) => x.t);
  }

  get topics(): string[] {
    return this.remarks.map((x) => x.r.topic);
  }
}

const text = (r: CoachRemark): string => {
  const c = r.cue as InlineCue;
  return Array.isArray(c.text) ? c.text[0] : c.text;
};

describe('Coach: when a remark is made (3.6.1)', () => {
  it('speaks only after the condition held for afterS (3 s), with the remark variables', () => {
    const d = new Drive(['speed']).set({ asiKt: 90 });   // +16 kt: beyond 0.7 x 15, n = 1.07
    d.run(2.9);
    expect(d.remarks).toHaveLength(0);
    d.run(0.2);
    expect(d.remarks).toHaveLength(1);
    const r = d.remarks[0].r;
    expect(r).toMatchObject({ topic: 'speed', rung: 1, priority: 1, praise: false, offerDemo: false });
    expect(r.vars).toMatchObject({ value: 90, target: 74, dev: 16, dir: 'fast', nose: 'up', side: 'right' });
    expect(text(r)).toBe("Speed's {dir}, {value:kt}.");
  });

  it('a large error (n > 1.5) speaks after 1.5 s', () => {
    const d = new Drive(['speed']).set({ asiKt: 100 });   // n = 26 / 15 = 1.73
    d.run(1.4);
    expect(d.remarks).toHaveLength(0);
    d.run(0.2);
    expect(d.remarks).toHaveLength(1);
  });

  it('is quiet while the student is already correcting (error shrinking, back within 6 s)', () => {
    const d = new Drive(['speed']).set({ asiKt: 92 });     // 3 kt beyond the +15 side
    d.rates.asiKt = -1;                                     // back inside in 3 s: correcting
    d.run(10);
    expect(d.remarks).toHaveLength(0);
    d.rates.asiKt = -0.2;                                   // 15 s to go: too slow to count
    d.run(0.2);
    expect(d.remarks).toHaveLength(1);

    const g = new Drive(['speed']).set({ asiKt: 92 });
    g.rates.asiKt = +1;                                     // getting worse
    g.run(3.1);
    expect(g.remarks).toHaveLength(1);
  });

  it('waits for the criteria to settle, but keeps timing the condition meanwhile', () => {
    const d = new Drive(['speed']).set({ asiKt: 90 });
    d.settled = false;
    d.run(5);
    expect(d.remarks).toHaveLength(0);
    d.settled = true;
    d.run(0.1);
    expect(d.remarks).toHaveLength(1);
  });

  it('escalates hint -> specific -> technique 25 s apart per topic, offers a demo on rung 3, and resets after 20 s clear', () => {
    const d = new Drive(['speed']).set({ asiKt: 90 });
    d.run(60);
    expect(d.remarks.map((x) => x.r.rung)).toEqual([1, 2, 3]);
    expect(d.times).toEqual([3, 28, 53]);
    expect(d.remarks[2].r.offerDemo).toBe(true);
    expect(text(d.remarks[1].r)).toBe('Nose {nose} a touch; let the speed settle.');
    d.run(20);                                   // still wrong: stays on the top rung
    expect(d.remarks.at(-1)?.r.rung).toBe(3);
    d.set({ asiKt: 74 }).run(21);                // clear for 20 s: the escalation resets
    const before = d.remarks.length;
    d.set({ asiKt: 90 }).run(30);                // (the per-minute cap may delay it; the rung is what counts)
    expect(d.remarks.slice(before).filter((x) => !x.r.praise)[0]?.r.rung).toBe(1);
  });

  it('global gap 8 s and at most 3 remarks a minute across topics; priority then longest-active picks', () => {
    const d = new Drive(['heading', 'vs', 'altitude', 'speed']);
    d.set({ asiKt: 90, altFt: 3300, vsiFpm: 400, hdgDeg: 120 });
    d.run(70);
    // Priority 1 topics first (vs active longest among equals by list order), heading (priority 3) waits.
    expect(d.topics.slice(0, 4)).toEqual(['vs', 'altitude', 'speed', 'vs']);
    // 3, 11, 19, then the 3-per-minute cap holds the fourth until the first remark is 60 s old.
    expect(d.times.slice(0, 4)).toEqual([3, 11, 19, 63]);
    expect(d.remarks[3].r.rung).toBe(2);
  });

  it('coach levels: minimal keeps priority 0-1 with a 15 s gap; silent keeps only safety rules', () => {
    const m = new Drive(['heading', 'speed', 'altitude'], 'normal', 'minimal').set({ asiKt: 90, altFt: 3300, hdgDeg: 120 });
    m.run(40);
    expect(m.topics).not.toContain('heading');
    expect(m.times.slice(0, 2)).toEqual([3, 18]);

    const s = new Drive(['speed', 'flapLimit'], 'normal', 'silent').set({ asiKt: 90, kias: 120, flapsDeg: 10 });
    s.run(10);
    expect(s.topics).toEqual(['flapLimit']);
    expect(s.remarks[0].r.vars.limit).toBe(110);
  });

  it('safety rules bypass the global gap, a busy voice and the quiet zones', () => {
    const d = new Drive(['speed', 'stallWarning']).set({ asiKt: 90 });
    d.run(3.1);
    expect(d.topics).toEqual(['speed']);
    d.idle = false;
    d.set({ stallWarn: true, circuitLeg: 'final', aglFt: 200 });
    expect(quietZone(d.ctx)).toBe(true);
    d.run(0.6);
    expect(d.topics).toEqual(['speed', 'stallWarning']);
    expect(d.remarks[1].r.priority).toBe(0);
  });

  it('quiet zones (final below 300 ft, flare, take-off roll) hold every non-safety remark', () => {
    const d = new Drive(['speed']).set({ asiKt: 90, circuitLeg: 'final', aglFt: 250 });
    d.run(10);
    expect(d.remarks).toHaveLength(0);
    expect(quietZone(makeCtx({ onGround: true, gsKt: 40, throttle: 1 }))).toBe(true);
    expect(quietZone(makeCtx({ onGround: false, aglFt: 30 }))).toBe(true);
    expect(quietZone(makeCtx(cruiseSignals()))).toBe(false);
  });

  it('talkativeness: quiet doubles the topic gap and never praises; chatty shortens it', () => {
    const q = new Drive(['speed'], 'quiet').set({ asiKt: 90 });
    q.run(60);
    expect(q.times).toEqual([3, 53]);
    const c = new Drive(['speed'], 'chatty').set({ asiKt: 90 });
    c.run(40);
    expect(c.times).toEqual([3, 20.5, 38]);
    q.set({ asiKt: 74 }).run(10);
    expect(q.remarks.some((x) => x.r.praise)).toBe(false);
  });
});

describe('Coach: praise rationing', () => {
  it('praises a fixed correction once per phase, with the rule praise line', () => {
    const d = new Drive(['speed']).set({ asiKt: 90 });
    d.run(3.1);
    d.set({ asiKt: 75 }).run(3);
    d.run(9);                                     // the 8 s global gap since the remark
    const praise = d.remarks.filter((x) => x.r.praise);
    expect(praise).toHaveLength(1);
    expect(praise[0].r.priority).toBe(3);
    expect((praise[0].r.cue as InlineCue).text).toContain("That's better.");
    d.set({ asiKt: 90 }).run(30).set({ asiKt: 74 }).run(20);
    expect(d.remarks.filter((x) => x.r.praise)).toHaveLength(1);   // once per phase
    expect(d.coach.remarksThisPhase).toBe(2);
  });

  it('praises 30 s with every chip green, but not again within 90 s even in a new phase', () => {
    const d = new Drive(['speed']);
    d.run(29.8);
    expect(d.remarks).toHaveLength(0);
    d.run(0.4);
    expect(d.remarks.map((x) => x.r.topic)).toEqual(['praise']);
    d.coach.beginPhase();
    d.run(60);
    expect(d.remarks).toHaveLength(1);
    d.run(31);
    expect(d.remarks).toHaveLength(2);
  });

  it('no praise below the reduced level', () => {
    const d = new Drive(['speed'], 'normal', 'minimal');
    d.run(40);
    expect(d.remarks).toHaveLength(0);
  });
});

describe('Coach presets (3.6.3)', () => {
  const card = (sig: TaskCard['targets'][number]['sig'], value: number): TaskCard => ({ title: 'x', targets: [{ label: 'X', sig, value, unit: '' }] });

  it('target presets bind to the card target with the matching signal, else return null', () => {
    expect(bindPreset('speed', CARD)?.correcting).toEqual({ sig: 'asiKt', target: 74 });
    expect(bindPreset('altitude', CARD)?.when).toEqual({ not: { sig: 'altFt', near: 3000, tol: { key: 'altitude', scale: 0.7 } } });
    expect(bindPreset('bank', CARD)).toBeNull();
    expect(bindPreset('bank', card('aiBankDeg', 30))?.when).toEqual({ not: { sig: 'aiBankDeg', near: 30, tol: { key: 'bankMedium', scale: 0.8 } } });
    expect(bindPreset('levelOff', card('asiKt', 74))).toBeNull();
    expect(bindPreset('lookout', CARD)).toBeNull();
    expect(bindPreset('trim', { title: 'x', targets: [] })?.priority).toBe(3);
  });

  it('priorities and minimum levels follow the catalogue', () => {
    const p = (id: CoachPresetId): [number, string] | null => {
      const r = bindPreset(id, { ...CARD, targets: [...CARD.targets, { label: 'BANK', sig: 'aiBankDeg', value: 30, unit: 'deg' }] });
      return r && [r.priority, r.minLevel];
    };
    expect(p('speed')).toEqual([1, 'minimal']);
    expect(p('heading')).toEqual([3, 'full']);
    expect(p('bank')).toEqual([2, 'reduced']);
    expect(p('ball')).toEqual([2, 'reduced']);
    expect(p('flapLimit')).toEqual([0, 'silent']);
    expect(p('stallWarning')).toEqual([0, 'silent']);
    expect(p('flare')).toEqual([0, 'silent']);
    expect(p('circuitHeight')).toEqual([1, 'minimal']);
    expect(p('downwindSpacing')).toEqual([2, 'reduced']);
  });

  it('scaleTol scales every TolRef form', () => {
    expect(scaleTol('speed', 0.7)).toEqual({ key: 'speed', scale: 0.7 });
    expect(scaleTol({ key: 'speed', scale: 2 }, 0.5)).toEqual({ key: 'speed', scale: 1 });
    expect(scaleTol(10, 0.5)).toBe(5);
    expect(scaleTol({ minus: 4, plus: 10 }, 0.5)).toEqual({ minus: 2, plus: 5 });
  });

  it('every preset line is at most 20 words (Chrome cuts long utterances)', () => {
    const ids: CoachPresetId[] = ['speed', 'altitude', 'heading', 'bank', 'ball', 'trim', 'levelOff', 'vs', 'flapLimit', 'stallWarning',
      'rpmRedline', 'approachSpeed', 'centreline', 'glidepath', 'flare', 'crosswindDrift', 'circuitHeight', 'downwindSpacing', 'lookout'];
    const big = { ...CARD, targets: [...CARD.targets, { label: 'BANK', sig: 'aiBankDeg' as const, value: 30, unit: 'deg' }] };
    for (const id of ids) {
      const r = bindPreset(id, big);
      for (const cue of [...(r?.say ?? []), r?.praise]) {
        if (!cue || typeof cue === 'string' || 'id' in cue) continue;
        for (const t of Array.isArray(cue.text) ? cue.text : [cue.text]) expect(t.split(/\s+/).length, `${id}: ${t}`).toBeLessThanOrEqual(20);
      }
    }
  });

  it('gateCoach gates a card-bound preset by the activeWhen of the criteria grading the same target', () => {
    const climbing = lt('altFt', 2850);
    const step = (criteria: TaskStep['criteria'], coach: CoachPresetId[] = ['speed', 'altitude', 'trim']): TaskStep =>
      task({ id: 't', exercise: 'ex', brief: 'x', card: CARD, goal: { const: false }, criteria, coach });
    // Speed graded only while climbing: the speed rule is gated; altitude (ungraded) and trim stay presets.
    const gated = gateCoach(step([hold('ias', 'Climb speed', 'asiKt', 74, 'speedClimbApproach', { required: true, activeWhen: climbing })]));
    expect(gated.coach?.[0]).toMatchObject({ id: 'speed', when: { all: [bindPreset('speed', CARD)?.when, climbing] } });
    expect(gated.coach?.slice(1)).toEqual(['altitude', 'trim']);
    // A criterion on another target, or one sampled all the time, leaves the preset alone.
    expect(gateCoach(step([hold('ias', 'Vx', 'asiKt', 62, 10, { required: true, activeWhen: climbing })])).coach?.[0]).toBe('speed');
    expect(gateCoach(step([
      hold('a', 'Climb speed', 'asiKt', 74, 'speedClimbApproach', { required: true, activeWhen: climbing }),
      hold('b', 'Speed', 'asiKt', 74, 'speedClimbApproach', { required: true }),
    ])).coach?.[0]).toBe('speed');
    // The gated rule is silent outside the window: speed 90 kt above the climb window, then inside it.
    const d = new Drive([]);
    d.coach.beginTask(gated, d.ctx);
    d.set({ asiKt: 90, altFt: 2950 }).run(5);
    expect(d.topics).toEqual([]);
    d.set({ altFt: 2700 }).run(4);
    expect(d.topics).toEqual(['speed']);
  });

  it('presetWhile adds a gate to a bound preset and refuses one that does not bind', () => {
    const r = presetWhile('altitude', CARD, gt('step.t', 10));
    expect(r.when).toEqual({ all: [bindPreset('altitude', CARD)?.when, gt('step.t', 10)] });
    expect(() => presetWhile('bank', CARD, gt('step.t', 10))).toThrow(/does not bind/);
  });

  it('ball, levelOff and circuit presets fire on their conditions with useful variables', () => {
    const ball = new Drive(['ball']).set({ ball: -0.5 });
    ball.run(3.1);
    expect(ball.remarks[0].r.vars).toMatchObject({ side: 'left', Side: 'Left' });

    // levelOff speaks when the rate is more than 14 fpm per foot to go: 600 fpm 30 ft short has not begun
    // levelling; 600 fpm 50 ft short is the 10 % lead point, and 280 fpm 25 ft short is a level-off under way.
    const lo = new Drive(['levelOff']).set({ altFt: 2970, vsiFpm: 600 });
    lo.run(0.4);
    expect(lo.topics).toEqual(['levelOff']);
    expect(lo.remarks[0].r.vars.lead).toBe(60);
    const loDown = new Drive(['levelOff']).set({ altFt: 3035, vsiFpm: -700 });
    loDown.run(0.4);
    expect(loDown.topics).toEqual(['levelOff']);
    expect(new Drive(['levelOff']).set({ altFt: 2950, vsiFpm: 600 }).run(2).topics).toEqual([]);
    expect(new Drive(['levelOff']).set({ altFt: 2975, vsiFpm: 280 }).run(2).topics).toEqual([]);

    const ch = new Drive(['circuitHeight', 'downwindSpacing']).set({ circuitLeg: 'downwind', hafFt: 1200, downwindOffsetNm: 1.4 });
    ch.run(12);
    expect(ch.topics).toEqual(['circuitHeight', 'downwindSpacing']);
    expect(ch.remarks[0].r.vars).toMatchObject({ target: 1000, dev: 200 });
    expect(ch.remarks[1].r.vars.dir).toBe('wide');
  });
});
