// Passenger comfort (src/career/runtime/comfort.ts, COMFORT_RULES) on synthetic streams: smooth flight keeps 100;
// each factor costs its documented points per second (vertical g divided by 1 + 2 x turbulence, lateral g, bank,
// pitch, a descent past 1,000 fpm only after 5 s and only unpressurised, the stall warning only above 50 ft AGL);
// a flared trainer landing with 2 s of stall horn below 50 ft costs nothing; a landing costs (sink - 360) / 15 and 5
// per bounce; taxiing below 30 kt never counts; the 1 s filter keeps a one-frame spike from being a bump; the
// score clamps at 0; and the state round-trips through export and restore.

import { describe, expect, it } from 'vitest';
import { ComfortMeter, comfortSample, type ComfortSample } from '../../src/career/runtime/comfort';
import { DEG, KT } from '../../src/core/math';
import { makeMockState } from '../../src/core/mockState';

const DT = 1 / 30;

/** Level cruise at 2,000 ft AGL. */
const CRUISE: ComfortSample = {
  specificForce: { y: 0, z: -1 }, bankDeg: 0, pitchDeg: 2, vsFpm: 0, aglFt: 2000, onGround: false, gsKt: 100, warning: false, turbulence: 0,
};

/** Feed `x` for `seconds` (whole frames). */
function feed(m: ComfortMeter, x: Partial<ComfortSample>, seconds: number): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) m.update({ ...CRUISE, ...x }, DT);
}

describe('comfort', () => {
  it('stays at 100 in smooth flight', () => {
    const m = new ComfortMeter();
    feed(m, {}, 600);
    expect(m.score).toBe(100);
  });

  it('charges vertical g by band, relieved by turbulence', () => {
    const m = new ComfortMeter();
    feed(m, { specificForce: { y: 0, z: -1.35 } }, 20); // the filter settles within the first few seconds
    const settled = m.summary().deductions.vertical;
    feed(m, { specificForce: { y: 0, z: -1.35 } }, 10);
    expect(m.summary().deductions.vertical - settled).toBeCloseTo(15, 6);
    const rough = new ComfortMeter();
    feed(rough, { specificForce: { y: 0, z: -1.6 }, turbulence: 0.5 }, 20);
    const r0 = rough.summary().deductions.vertical;
    feed(rough, { specificForce: { y: 0, z: -1.6 }, turbulence: 0.5 }, 10);
    expect(rough.summary().deductions.vertical - r0).toBeCloseTo(50 / 2, 6);
  });

  it('charges lateral g, bank and pitch by band', () => {
    const m = new ComfortMeter();
    feed(m, { specificForce: { y: 0.3, z: -1 } }, 20);
    const l0 = m.summary().deductions.lateral;
    feed(m, { specificForce: { y: 0.3, z: -1 } }, 10);
    expect(m.summary().deductions.lateral - l0).toBeCloseTo(30, 6);
    const b = new ComfortMeter();
    feed(b, { bankDeg: 35 }, 10);
    feed(b, { bankDeg: -50 }, 10);
    expect(b.summary().deductions.bank).toBeCloseTo(5 + 30, 6);
    const p = new ComfortMeter();
    feed(p, { pitchDeg: 18 }, 4);
    feed(p, { pitchDeg: -12 }, 6);
    feed(p, { pitchDeg: 10 }, 6);
    expect(p.summary().deductions.pitch).toBeCloseTo(10, 6);
  });

  it('charges a fast descent only after 5 s, and never in a pressurised cabin', () => {
    const m = new ComfortMeter(false);
    feed(m, { vsFpm: -1200 }, 4);
    expect(m.summary().deductions.descent).toBe(0);
    feed(m, { vsFpm: -1200 }, 11);
    expect(m.summary().deductions.descent).toBeCloseTo(0.3 * 10, 6);
    feed(m, { vsFpm: -500 }, 1);
    feed(m, { vsFpm: -1200 }, 3);
    expect(m.summary().deductions.descent).toBeCloseTo(3, 6);
    const pc12 = new ComfortMeter(true);
    feed(pc12, { vsFpm: -2000 }, 60);
    expect(pc12.score).toBe(100);
  });

  it('charges the stall warning above 50 ft, and nothing for a flared landing with 2 s of horn below 50 ft', () => {
    const m = new ComfortMeter();
    feed(m, { warning: true, aglFt: 400 }, 2);
    expect(m.summary().deductions.stall).toBeCloseTo(6, 6);
    const flare = new ComfortMeter();
    feed(flare, { aglFt: 300, vsFpm: -500 }, 30);
    feed(flare, { aglFt: 20, vsFpm: -300, gsKt: 55 }, 2);
    feed(flare, { aglFt: 4, vsFpm: -150, gsKt: 50, warning: true, pitchDeg: 9 }, 2);
    flare.landing(150, 0);
    feed(flare, { aglFt: 4, onGround: true, gsKt: 35 }, 3);
    expect(flare.summary().deductions.stall).toBe(0);
    expect(flare.score).toBe(100);
  });

  it('charges a landing (sink - 360) / 15 and 5 per bounce', () => {
    const m = new ComfortMeter();
    m.landing(510, 0);
    expect(m.score).toBeCloseTo(90, 9);
    m.landing(300, 2);
    expect(m.score).toBeCloseTo(80, 9);
    expect(m.summary().deductions.landing).toBeCloseTo(20, 9);
  });

  it('counts nothing taxiing below 30 kt, but a fast take-off roll counts', () => {
    const m = new ComfortMeter();
    feed(m, { onGround: true, gsKt: 12, bankDeg: 0, specificForce: { y: 0.4, z: -1 }, aglFt: 4 }, 30);
    expect(m.score).toBe(100);
    feed(m, { onGround: true, gsKt: 45, specificForce: { y: 0.4, z: -1 }, aglFt: 4 }, 5);
    expect(m.summary().deductions.lateral).toBeGreaterThan(0);
  });

  it('filters a one-frame spike', () => {
    const m = new ComfortMeter();
    feed(m, {}, 5);
    m.update({ ...CRUISE, specificForce: { y: 0, z: -2.5 } }, DT);
    feed(m, {}, 5);
    expect(m.score).toBe(100);
  });

  it('clamps the score at 0 and keeps the deductions per factor', () => {
    const m = new ComfortMeter();
    feed(m, { bankDeg: 60 }, 60);
    expect(m.score).toBe(0);
    expect(m.summary().deductions.bank).toBeCloseTo(180, 6);
  });

  it('round-trips its state and carries on identically', () => {
    const a = new ComfortMeter();
    feed(a, { specificForce: { y: 0.2, z: -1.4 }, bankDeg: 40, vsFpm: -1500 }, 7);
    const b = new ComfortMeter();
    expect(b.restoreState(JSON.parse(JSON.stringify(a.exportState())))).toBe(true);
    feed(a, { vsFpm: -1500, bankDeg: 50 }, 3);
    feed(b, { vsFpm: -1500, bankDeg: 50 }, 3);
    expect(b.summary()).toEqual(a.summary());
    expect(new ComfortMeter().restoreState({ nz: 1 })).toBe(false);
  });

  it('samples the stall warning, or a helicopter its low rotor RPM horn', () => {
    const s = makeMockState({ heading: 0, roll: 20 * DEG });
    s.stallWarning = true;
    expect(comfortSample(s, 0.1, false).warning).toBe(true);
    expect(comfortSample(s, 0.1, true).warning).toBe(false);
    expect(comfortSample(s, 0.1, false).bankDeg).toBeCloseTo(20, 9);
    expect(comfortSample(s, 0.1, false).gsKt).toBeCloseTo(s.groundSpeed / KT, 9);
  });
});
