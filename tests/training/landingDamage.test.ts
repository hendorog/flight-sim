// Landing damage in the Flight School (SimEvents 'damage', physics/damage.ts): lesser damage or an inspection note goes
// to the landing being flown, whose "Landing without damage" safety row then fails (and the L13 gate's safe landing
// and a challenge's landing score go); disabling damage ends the lesson as a crash does, a dual lesson on its own
// crash panel (the generic crash dialog never opens), a solo / check / test lesson straight to its debrief.

import { describe, expect, it, vi } from 'vitest';
import { LandingDetector } from '../../src/training/engine/events';
import { TrainingBus } from '../../src/training/engine/bus';
import { safeLanding } from '../../src/training/engine/runner';
import { gradeLanding } from '../../src/training/grading/landing';
import { STANDARDS } from '../../src/training/grading/standards';
import { scoreChallenge } from '../../src/training/career/challenges';
import { TrainingSystem, type TrainingShell } from '../../src/training/TrainingSystem';
import type { SchoolParams } from '../../src/sim/params';
import type { LandingData, SignalFrame, TouchdownData } from '../../src/training/types';
import type { CrashAction } from '../../src/ui/overlays';

const GOOD: LandingData = {
  sinkFpm: 180, kias: 58, firstWheel: 'left', distAimFt: 150, rwyAcrossM: -1.2, driftDeg: 1.5, bankDeg: 1, pitchDeg: 5,
  onRunway: true, kiasAt50Ft: 67, gpDevFtAt300: 12, bounces: 0, maxBounceFt: 0, floatS: 4, rolloutMaxAcrossM: 2,
  fullStop: true, crashed: false,
};
const grade = (d: LandingData) => Object.fromEntries(gradeLanding(d, { standards: STANDARDS, authority: 'easa', standard: 'test', vrefKt: 65, zone: 'touchdownZoneFt' }).map((r) => [r.id, r]));

describe('the landing row', () => {
  it('fails "Landing without damage" (a safety row) with the damage, and voids the safe-landing gate and the challenge score', () => {
    expect(grade(GOOD)['landing.crash']).toBeUndefined();
    const row = grade({ ...GOOD, damage: 'Hard landing: inspection required' })['landing.crash'];
    expect(row).toMatchObject({ label: 'Landing without damage', safety: true, grade: 1 });
    expect(row.detail).toBe('The landing damaged the aircraft: hard landing: inspection required');
    expect(grade({ ...GOOD, crashed: true })['landing.crash'].detail).toBe('The landing ended in a crash');
    expect(safeLanding(GOOD)).toBe(true);
    expect(safeLanding({ ...GOOD, damage: 'Left main gear bent' })).toBe(false);
    const inputs = { landing: GOOD } as unknown as Parameters<typeof scoreChallenge>[1];
    const damagedInputs = { landing: { ...GOOD, damage: 'Left main gear bent' } } as unknown as Parameters<typeof scoreChallenge>[1];
    expect(scoreChallenge('spotLanding', inputs)).toBeGreaterThan(0);
    expect(scoreChallenge('spotLanding', damagedInputs)).toBe(0);
  });
});

describe('the landing detector', () => {
  const fr = (o: Partial<Record<string, number | boolean>> = {}): SignalFrame =>
    ({ aglFt: 400, onGround: false, crashed: false, gpDevFt: 0, asiKt: 65, gsKt: 60, mainsOnGround: false, noseOnGround: false, onRunway: true, throttle: 0, rwyAcrossM: 0, ...o }) as unknown as SignalFrame;
  const td: TouchdownData = { sinkFpm: 560, kias: 60, firstWheel: 'left', distAimFt: 300, rwyAcrossM: 1, driftDeg: 0, bankDeg: 0, pitchDeg: 4, onRunway: true };

  it('keeps the first damage of the landing being flown; none before it or after it ends', () => {
    const bus = new TrainingBus();
    const landings: LandingData[] = [];
    bus.on('landing', (r) => landings.push(r.data));
    const land = new LandingDetector(bus);
    let t = 0;
    const tick = (f: SignalFrame) => land.update(f, (t += 0.1), 0.1);
    // Damage on the ground before any landing (idle) is not a landing's.
    land.onDamage('Left wingtip scraped');
    for (let h = 400; h >= 10; h -= 10) tick(fr({ aglFt: h }));
    land.onTouchdown(td, t);
    land.onDamage('Hard landing: inspection required');
    land.onDamage('Left main gear bent');
    const roll = fr({ onGround: true, mainsOnGround: true, noseOnGround: true, aglFt: 3.6, gsKt: 40 });
    for (let i = 0; i < 40; i++) tick(roll);
    for (let i = 0; i < 10; i++) tick({ ...roll, gsKt: 2 } as SignalFrame);
    expect(landings).toHaveLength(1);
    expect(landings[0].damage).toBe('Hard landing: inspection required');
    // After the landing ended: not this landing's, and the next landing starts clean.
    land.onDamage('Tail strike');
    for (let h = 400; h >= 10; h -= 10) tick(fr({ aglFt: h }));
    land.onTouchdown({ ...td, sinkFpm: 150 }, t);
    for (let i = 0; i < 40; i++) tick(roll);
    for (let i = 0; i < 10; i++) tick({ ...roll, gsKt: 2 } as SignalFrame);
    expect(landings).toHaveLength(2);
    expect(landings[1].damage).toBeUndefined();
  });
});

describe('TrainingSystem on landing damage', () => {
  function rig(kind: 'dual' | 'solo') {
    const params: SchoolParams = {
      open: null, lesson: null, phase: null, brief: true, voice: false, standard: null, memoryStore: true, unlock: false, autoStudent: false,
    };
    const cards: { reason: string; actions: CrashAction[] }[] = [];
    const shell = { params, ui: { showLessonCard: (reason: string, actions: CrashAction[]) => cards.push({ reason, actions }) } } as unknown as TrainingShell;
    const ts = new TrainingSystem(shell);
    const runner = { phase: 'running', onDamage: vi.fn(), onCrash: vi.fn(), input: vi.fn(), retryPhase: vi.fn() };
    (ts as unknown as { session: unknown }).session = { lesson: { kind, id: 'L10' }, runner };
    const stop = vi.spyOn(ts.copilot, 'stop').mockImplementation(() => {});
    const onDamage = (severity: 'inspection' | 'damage' | 'disabling', text: string) =>
      (ts as unknown as { onDamage(s: string, t: string): void }).onDamage(severity, text);
    return { ts, runner, cards, stop, onDamage };
  }

  it('inspection and damage go to the landing; the lesson goes on', () => {
    const { runner, cards, onDamage } = rig('dual');
    onDamage('inspection', 'Hard landing: inspection required');
    onDamage('damage', 'Left main gear bent');
    expect(runner.onDamage.mock.calls).toEqual([['Hard landing: inspection required'], ['Left main gear bent']]);
    expect(runner.onCrash).not.toHaveBeenCalled();
    expect(cards).toEqual([]);
  });

  it('disabling damage in a dual lesson opens the lesson crash panel (its Debrief ends the lesson as a crash)', () => {
    const { runner, cards, stop, onDamage } = rig('dual');
    onDamage('disabling', 'Nose gear collapsed');
    expect(stop).toHaveBeenCalled();
    expect(runner.onCrash).not.toHaveBeenCalled();
    expect(cards).toHaveLength(1);
    expect(cards[0].reason).toBe('Nose gear collapsed');
    expect(cards[0].actions.map((a) => a.label)).toEqual(['Debrief', 'Try again from checkpoint', 'Restart lesson']);
    // While the panel waits, more damage (the propeller digging in) changes nothing.
    onDamage('disabling', 'Propeller strike: engine stopped');
    expect(cards).toHaveLength(1);
    cards[0].actions[0].run();
    expect(runner.onCrash.mock.calls).toEqual([['Nose gear collapsed']]);
  });

  it('disabling damage in a solo lesson ends it as a crash, no card', () => {
    const { runner, cards, onDamage } = rig('solo');
    onDamage('disabling', 'Nose gear collapsed');
    expect(runner.onCrash.mock.calls).toEqual([['Nose gear collapsed']]);
    expect(cards).toEqual([]);
  });
});
