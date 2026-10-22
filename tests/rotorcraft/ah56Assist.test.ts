// AH-56A: the STAB ASSIST sim aid and the keyboard pedal gearing for the laptop pilot (tuning round 2026-10-22, KNOWN_ISSUES T5
// and T8). The keyboard beginner is the Bo 105 lane's (tests/rotorcraft/bo105KeyPilot.ts): the REAL SimPhysics and InputSystem at
// 60 Hz, taps 0.3-0.6 s late every 0.8-1.6 s on the arrow keys, Z / X on a heading error and F5 / F6 on height. The assist is the
// shared law (src/sim/rotorcraft/stabilityAssist.ts) with the AH-56A's own input profile (src/aircraft/ah56/input.ts); the
// physics is the sourced aircraft. Measured before the profile carried it (W/tune/ah56/probes ah56key.test.ts, out/key-off.log):
// the AMCS beginner drifted 27-30 m in 60 s (lost at 58-60 s in three of six runs) with the heading wandering 72-180 deg.
import { describe, expect, it } from 'vitest';
import { AH56_DEFINITION } from '../../src/aircraft/ah56';
import { AH56_INPUT } from '../../src/aircraft/ah56/input';
import { DEG } from '../../src/core/math';
import { FRAME, Keys, flyHover, hoverBeginner, keyRig } from './bo105KeyPilot';

const report = (label: string, values: Record<string, number | string | boolean | null>) =>
  console.log(`[ah56] ${label}: ${Object.entries(values).map(([k, v]) => `${k}=${typeof v === 'number' ? +v.toPrecision(4) : v}`).join('  ')}`);

describe('STAB ASSIST on the AH-56A (a sim aid; AMCS default)', () => {
  it('the profile carries it, ON by default, with a label', () => {
    expect(AH56_INPUT.stabilityAssist?.default).toBe(true);
    expect(AH56_INPUT.labels.stabilityAssist).toMatch(/sim aid/);
  });

  for (const [interval, lag] of [[0.8, 0.3], [1.6, 0.6]] as const) for (const start of ['hover15', 'ige3'] as const) {
    it(`the keyboard beginner (taps every ${interval} s, ${lag} s late) holds the ${start === 'hover15' ? '15 m' : '3 ft'} hover for 60 s: under 10 m of drift, the heading within 10 deg`, () => {
      const r = keyRig({ start, dd: AH56_DEFINITION, assist: true });
      const keys = new Keys(r);
      const res = flyHover(r, keys, 60, hoverBeginner(r, keys, interval, lag));
      report(`keyboard beginner hover, assist on, ${start}, every ${interval} s, ${lag} s late`, { lostS: res.lostS, driftM: res.driftM,
        maxAttDeg: res.maxAttDeg, maxHdgDeg: res.maxHdgDeg });
      expect(res.lostS).toBeNull();
      expect(res.driftM).toBeLessThan(10);
      expect(res.maxHdgDeg).toBeLessThan(10);
    }, 120_000);
  }

  it('without it the same beginner loses the heading (the raw aircraft; the assist is what the row above adds)', () => {
    const r = keyRig({ start: 'hover15', dd: AH56_DEFINITION, assist: false });
    const keys = new Keys(r);
    const res = flyHover(r, keys, 60, hoverBeginner(r, keys, 0.8, 0.3));
    report('keyboard beginner hover, assist off, hover15', { lostS: res.lostS, driftM: res.driftM, maxAttDeg: res.maxAttDeg, maxHdgDeg: res.maxHdgDeg });
    expect(res.maxHdgDeg).toBeGreaterThan(45);
  }, 120_000);

  it('keyboard pedal: a 1 s tap of right pedal turns the hover under 15 deg/s and the heading settles within 15 deg', () => {
    const r = keyRig({ start: 'hover15', dd: AH56_DEFINITION, assist: true });
    const keys = new Keys(r), h0 = r.physics.state.heading;
    let peak = 0, worst = 0;
    keys.tap('KeyX', 1);
    while (r.t < 7) {
      keys.update(); r.input.update(FRAME, r.ctx); r.physics.advance(FRAME); r.t += FRAME;
      const s = r.physics.state;
      peak = Math.max(peak, Math.abs(s.angularVelocity.z) / DEG);
      if (r.t > 5) worst = Math.max(worst, Math.abs(Math.atan2(Math.sin(s.heading - h0), Math.cos(s.heading - h0))) / DEG);
    }
    report('keyboard pedal 1 s tap, assist on', { peakDegS: peak, headingAfter5to7sDeg: worst, pedalIn: r.c.rudder * 3.2 });
    expect(peak).toBeLessThan(15);
    expect(worst).toBeLessThan(15);
  }, 60_000);
});
