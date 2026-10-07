// The suite's own rules: how a measured value meets a Band or Range, and how `blockedBy` turns an item into a
// skipped one while its request is open and back into a judged one when it is closed.

import { describe, expect, it } from 'vitest';
import { twinBlocks } from './plan';
import { describeLimit, item, judge, within } from './suite';
import { above, band, below, pct, range, type TwinTargets } from './targets';

describe('conformance limits', () => {
  it('a band is target +- tol, a range min .. max, both inclusive; NaN meets neither', () => {
    expect(within(55, band(53, 2, 'x'))).toBe(true);
    expect(within(55.01, band(53, 2, 'x'))).toBe(false);
    expect(within(126 * 1.049, pct(126, 5, 'x'))).toBe(true);
    expect(within(0.2, range(0.2, 0.35, 'x'))).toBe(true);
    expect(within(-1e9, below(3, 'x'))).toBe(true);
    expect(within(3.01, below(3, 'x'))).toBe(false);
    expect(within(301, above(300, 'x'))).toBe(true);
    expect(within(NaN, band(0, 1, 'x'))).toBe(false);
    expect(within(NaN, above(0, 'x'))).toBe(false);
  });

  it('describes a limit with its source and the request that blocks it', () => {
    expect(describeLimit(band(53, 2, 'POH'), 'KCAS')).toBe('target 53.00 +- 2.00 KCAS (POH)');
    expect(describeLimit(below(5, 'ground.test.ts', 'D-x-01'), 'mm')).toBe('< 5.00 mm (ground.test.ts; blocked by D-x-01)');
    expect(describeLimit(range(0.2, 0.35, 'owner'))).toBe('0.20 .. 0.35 (owner)');
  });

  it('blockedBy: skipped while the request is open, met or not; judged again once it is closed', () => {
    const blocked = band(53, 2, 'POH', 'D-x-01');
    expect(judge(60, blocked, ['D-x-01'])).toBe('skip');
    expect(judge(53, blocked, ['D-x-01'])).toBe('skip');
    expect(judge(60, blocked, [])).toBe('fail');
    expect(judge(53, blocked, [])).toBe('pass');
    expect(judge(60, band(53, 2, 'POH'), ['D-x-01'])).toBe('fail');
  });
});

// One item through the real reporting path: a band that is NOT met, blocked by an open request. It is reported as
// skipped (not passed, not failed), with the request id and the measured value in the skip note.
describe('conformance item blocked by an open request (reported as skipped)', () => {
  item('example', 'stall speed (a blocked band that is not met)', () => 60, band(53, 2, 'POH', 'D-example-01'), 'KCAS', 5000, ['D-example-01']);
});

// The twin block's optional judgements (D-D-pa34-phys-01, -02), read off the plan without flying: a blocked
// zero-thrust band, and an engine cut judged on the type's own windmilling capability instead of "recovered".
describe('twin block options', () => {
  const t: TwinTargets = {
    criticalEngine: 'none', vmcaKcas: 69, vyseKcas: 91,
    pedalAt110Vmca: range(0.5, 0.9, 'x'), pedalAtVyse: range(0.3, 0.7, 'x'), vmca: band(69, 5, 'x'),
    sides: { vmcaKt: 1, pedal: 0.03, source: 'x' },
    oeiClimb: [{ altitudeFt: 0, fpm: band(190, 70, 'x') }], windmillingLossFpm: range(150, 450, 'x'),
    zeroThrust: { controls: { throttle: 0.2 }, withinFpm: 60, source: 'x', blockedBy: 'D-x-01' },
    engineCut: { maxHeadingChangeDeg: below(30, 'x'), source: 'x' },
  };
  const items = (w: TwinTargets, block: string) => twinBlocks('T', w, () => { throw new Error('not flown'); }).find((b) => b.name === block)!.items;

  it('zeroThrust.blockedBy reaches both zero-thrust items', () => {
    const z = items(t, 'twin: one-engine climb').filter((i) => i.label.startsWith('zero-thrust'));
    expect(z).toHaveLength(2);
    for (const i of z) expect(i.kind === 'value' && typeof i.limit !== 'function' && i.limit.blockedBy).toBe('D-x-01');
  });

  it('engineCut.minVerticalSpeedFpm: a vertical-speed value and a crash flag instead of "recovered"; absent, as before', () => {
    const before = items(t, 'twin: engine cut').map((i) => `${i.kind} ${i.label}`);
    expect(before.filter((l) => l.endsWith('recovered, no crash'))).toHaveLength(2);
    const after = items({ ...t, engineCut: { ...t.engineCut, minVerticalSpeedFpm: above(-300, 'x') } }, 'twin: engine cut');
    const vs = after.filter((i) => i.label.endsWith('vertical speed at the end, windmilling'));
    expect(vs).toHaveLength(2);
    for (const i of vs) expect(i.kind === 'value' && typeof i.limit !== 'function' && i.limit).toEqual(above(-300, 'x'));
    expect(after.filter((i) => i.kind === 'flag' && i.label.endsWith(': no crash'))).toHaveLength(2);
    expect(after.some((i) => i.label.includes('recovered'))).toBe(false);
  });
});
