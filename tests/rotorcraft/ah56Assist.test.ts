// AH-56A: the STAB ASSIST sim aid and the keyboard gearing for the laptop pilot (tuning round 2026-10-22, KNOWN_ISSUES T5, T8 and
// T9). The keyboard beginner is the Bo 105 lane's (tests/rotorcraft/bo105KeyPilot.ts): the REAL SimPhysics and InputSystem at
// 60 Hz, taps 0.3-0.6 s late every 0.8-1.6 s on the arrow keys, Z / X on a heading error and F5 / F6 on height. The assist is the
// shared law (src/sim/rotorcraft/stabilityAssist.ts) with the AH-56A's own input profile (src/aircraft/ah56/input.ts); the
// physics is the sourced aircraft. Measured before the profile carried it (W/tune/ah56/probes ah56key.test.ts, out/key-off.log):
// the AMCS beginner drifted 27-30 m in 60 s (lost at 58-60 s in three of six runs) with the heading wandering 72-180 deg.
import { describe, expect, it } from 'vitest';
import { AH56_DEFINITION } from '../../src/aircraft/ah56';
import { AH56_INPUT } from '../../src/aircraft/ah56/input';
import { DEG } from '../../src/core/math';
import { FRAME, Keys, flyHover, frame, hoverBeginner, keyRig } from './bo105KeyPilot';
import { Extremes, WatchingBeginner, fly, liftToUnload, see, wrapDeg } from './ah56KeyPilot';

const report = (label: string, values: Record<string, number | string | boolean | null>) =>
  console.log(`[ah56] ${label}: ${Object.entries(values).map(([k, v]) => `${k}=${typeof v === 'number' ? +v.toPrecision(4) : v}`).join('  ')}`);

describe('STAB ASSIST on the AH-56A (a sim aid; AMCS default)', () => {
  it('the profile carries it, ON by default, with a label', () => {
    expect(AH56_INPUT.stabilityAssist?.default).toBe(true);
    expect(AH56_INPUT.labels?.stabilityAssist).toMatch(/sim aid/);
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

// Round 2 (the Fable pilot gate's beginner side, KNOWN_ISSUES T9; probes W/tune/ah56/r2). The Bo 105 helper's 0.1-0.6 s taps do not
// move this aircraft (a 0.3 s arrow tap is 0.03 of the axis on the AH-56A's 0.1 per second cyclic keys), so beyond the hover the
// beginner is the WATCHING one of tests/rotorcraft/ah56KeyPilot.ts: presses a key every 0.8 s (0.3 s late) or 1.2 s (0.5 s late) and
// holds it until the nose, wings, climb look right, at most 2 s (1 s on the collective). Feet off the pedals at low speed: the STAB
// ASSIST holds the heading while they rest, and the hint card says so (the beginner's own pedal work, a non-centring key on a 53
// deg/s-per-inch pedal, spun the heading 90-180 deg in every lift-off and transition: r2 out/bat-H30.log WL / WT, feet on).
const PACES = [[0.8, 0.3], [1.2, 0.5]] as const;
const ah56 = (start: 'hover15' | 'ige3' | 'runway', assist = true) => keyRig({ start, dd: AH56_DEFINITION, assist });

describe('STAB ASSIST round 2: the keyboard beginner beyond the hover', () => {
  /** Runway start, F6 held to the first unload, then `pilot` for 30 s from there. */
  const liftOff = (pilot: 'watching' | 'tapper', iv = 0.8, lag = 0.3) => {
    const r = ah56('runway'), s0 = see(r);
    const liftS = liftToUnload(r);
    const e = new Extremes(r, s0.hdg);
    let res;
    if (pilot === 'watching') res = fly(r, 30, new WatchingBeginner(r, { holdPos: true, hdg: s0.hdg, agl: s0.agl + 3, feetOff: true }, iv, lag), e);
    else {
      const keys = new Keys(r), step = hoverBeginner(r, keys, 0.8, 0.3);
      res = fly(r, 30, { step: () => { step(); keys.update(); } } as unknown as WatchingBeginner, e);
      keys.releaseAll();
    }
    return { liftS, crashed: res.why === 'crash', driftM: e.drift, maxHdgDeg: e.maxHdgErr, maxAttDeg: e.maxAtt, maxKias: e.maxKias };
  };
  for (const [iv, lag] of PACES) {
    it(`lift-off on keys: F6 held to the first unload, then the watching beginner (every ${iv} s, ${lag} s late, feet off) hovers 3 m up for 30 s: no crash, the heading within 30 deg, under 15 m of drift`, () => {
      const f = liftOff('watching', iv, lag);
      report(`lift-off then the watching beginner, every ${iv} s`, f);
      expect(f.crashed).toBe(false);
      expect(f.maxHdgDeg).toBeLessThan(30);
      expect(f.driftM).toBeLessThan(15);
    }, 120_000);
  }
  it.fails('KNOWN GAP: the same lift-off with the Bo 105 helper\'s tapper (its 0.1-0.6 s taps cannot hold this aircraft): no crash, the heading within 30 deg, under 15 m of drift (measured: no crash, 38 deg, 85 m)', () => {
    const f = liftOff('tapper');
    report('lift-off then the Bo 105 tapper', f);
    expect(f.crashed).toBe(false);
    expect(f.maxHdgDeg).toBeLessThan(30);
    expect(f.driftM).toBeLessThan(15);
  }, 120_000);

  it('out of the hover: ArrowUp held 1.5 s every 4 s (the collective written for 30 m) reaches 60 KIAS within 60 s (round 1: never, 46.9 KIAS at most)', () => {
    const r = ah56('hover15'), c0 = r.c.collective ?? 0;
    let next = 1, t60 = NaN, crashed = false, held = false;
    while (r.t < 60) {
      const s = see(r);
      if (r.t >= next && s.kias < 55) { r.input.keyDown('ArrowUp'); held = true; next += 4; }
      if (held && r.t >= next - 4 + 1.5 - FRAME / 2) { r.input.keyUp('ArrowUp'); held = false; }
      r.input.update(FRAME, r.ctx);
      r.c.collective = Math.max(0, Math.min(1, c0 + 0.02 * (30 - s.agl) - 0.08 * s.climb));
      r.physics.advance(FRAME); r.t += FRAME;
      if (r.physics.state.crashed) { crashed = true; break; }
      if (see(r).kias >= 60) { t60 = r.t; break; }
    }
    report('pushes to 60 KIAS', { t60S: t60, crashed });
    expect(crashed).toBe(false);
    expect(t60).toBeLessThan(60);
  }, 120_000);

  const transition = (iv: number, lag: number) => {
    const r = ah56('hover15'), s0 = see(r);
    let p = new WatchingBeginner(r, { kias: 40, hdg: s0.hdg, agl: 30, feetOff: true }, iv, lag);
    const accel = new Extremes(r, s0.hdg);
    const a = fly(r, 60, p, accel, (s) => s.kias >= 38);
    const out = { accelWhy: a.why, accelS: a.t, accelHdgDeg: accel.maxHdgErr, backWhy: 'not flown', backS: NaN, hdgDeg: accel.maxHdgErr, minAgl: accel.minAgl };
    if (a.why === 'done') {
      fly(r, 10, p, accel);
      p.releaseAll();
      p = new WatchingBeginner(r, { stop: true, hdg: s0.hdg, agl: 30, feetOff: true }, iv, lag);
      p.pitchRef = s0.pitch;
      const back = new Extremes(r, s0.hdg);
      const b = fly(r, 90, p, back, (s) => s.gs < 3);
      Object.assign(out, { backWhy: b.why, backS: b.t, hdgDeg: Math.max(accel.maxHdgErr, back.maxHdgErr), minAgl: Math.min(accel.minAgl, back.minAgl) });
    }
    return out;
  };
  const transitions = PACES.map(([iv, lag]) => ({ iv, f: transition(iv, lag) }));
  for (const { iv, f } of transitions) {
    it(`the watching beginner (every ${iv} s, feet off) leaves the hover: 38 KIAS within 40 s, no crash (round 1: 39-44 s with the heading lost)`, () => {
      report(`hover to 40 KIAS, every ${iv} s`, f);
      expect(f.accelWhy).toBe('done');
      expect(f.accelS).toBeLessThan(40);
    });
  }
  it.fails('KNOWN GAP: hover -> 40 KIAS -> hover on keys, no crash, the heading within 30 deg (measured: out in 22 / 24 s with the heading 30 / 27 deg off; the way back crashed at 68 s / was not stopped in 90 s, the heading 68 / 164 deg off; KNOWN_ISSUES T9)', () => {
    for (const { f } of transitions) {
      expect(f.backWhy).toBe('done');
      expect(f.hdgDeg).toBeLessThan(30);
    }
  });

  /** After `code` held `hold` s from the hover: the yaw rate and the heading against the hold's datum from 6 s after the release. */
  const yawAfter = (code: string, hold: number) => {
    const r = ah56('hover15'), sa = r.physics.stabilityAssist!, h0 = see(r).hdg;
    r.input.keyDown(code);
    let datum = NaN, peak = 0, worstErr = 0, worstRate = 0, released = false;
    while (r.t < hold + 10) {
      if (!released && r.t >= hold - FRAME / 2) { r.input.keyUp(code); released = true; }
      frame(r);
      const s = see(r);
      peak = Math.max(peak, Math.abs(s.r));
      // The datum the hold took when the pedal came to rest (its lead: 0.8 s of the yaw rate in the pedal's direction).
      if (released && Number.isNaN(datum) && sa.holdingHeading) datum = s.hdg + (code === 'KeyX' && s.r > 0 ? 0.8 * s.r : 0);
      if (r.t >= hold + 6) { worstRate = Math.max(worstRate, Math.abs(s.r)); worstErr = Math.max(worstErr, Math.abs(wrapDeg(s.hdg - (Number.isNaN(datum) ? h0 : datum)))); }
    }
    return { peakDegS: peak, rateAfter6DegS: worstRate, errAfter6Deg: worstErr, datumOffDeg: wrapDeg(datum - h0) };
  };
  it('a 0.5 s F6 tap in the hover: the yaw under 8 deg/s, the heading within 10 deg of the hold (round 1: 8.7 deg/s, 8.5 deg)', () => {
    const f = yawAfter('F6', 0.5);
    report('F6 0.5 s tap, yaw', f);
    expect(f.peakDegS).toBeLessThan(8);
    expect(f.errAfter6Deg).toBeLessThan(10);
  }, 60_000);
  it('a 2 s right pedal hold in the hover: from 6 s after the release the yaw under 8 deg/s and the heading within 10 deg of the datum the hold took (round 1: 14.3 deg/s)', () => {
    const f = yawAfter('KeyX', 2);
    report('KeyX 2 s hold, yaw', f);
    expect(f.rateAfter6DegS).toBeLessThan(8);
    expect(f.errAfter6Deg).toBeLessThan(10);
  }, 60_000);

  it('held arrow keys in the hover: 1 s moves the nose at least 1 deg; 3 s stays under 15 deg of pitch and 20 deg of roll (round 1: 33.7 / 51.7 deg)', () => {
    const peak = (code: string, hold: number) => {
      const r = ah56('hover15'), s0 = see(r);
      let m = 0;
      r.input.keyDown(code);
      while (r.t < hold + 4) {
        if (r.t >= hold - FRAME / 2) r.input.keyUp(code);
        frame(r);
        const s = see(r);
        m = Math.max(m, Math.abs(code === 'ArrowUp' ? s.pitch - s0.pitch : s.roll - s0.roll));
      }
      return m;
    };
    const f = { pitch1: peak('ArrowUp', 1), pitch3: peak('ArrowUp', 3), roll3: peak('ArrowRight', 3) };
    report('held arrow keys', f);
    expect(f.pitch1).toBeGreaterThanOrEqual(1);
    expect(f.pitch3).toBeLessThan(15);
    expect(f.roll3).toBeLessThan(20);
  }, 60_000);

  it('F5 held 1 s from the 15 m hover, then hands off: no crash, the sink under 800 fpm (round 1: the ground at 1,057 fpm, a crash)', () => {
    const r = ah56('hover15');
    let maxSink = 0;
    r.input.keyDown('F5');
    while (r.t < 12) {
      if (r.t >= 1 - FRAME / 2) r.input.keyUp('F5');
      frame(r);
      maxSink = Math.max(maxSink, -see(r).climb * 196.85);
      if (r.physics.state.crashed) break;
    }
    report('F5 1 s from 15 m', { maxSinkFpm: maxSink, crashed: r.physics.state.crashed, onGround: r.physics.state.onGround });
    expect(r.physics.state.crashed).toBe(false);
    expect(maxSink).toBeLessThan(800);
  }, 60_000);

  it.fails('KNOWN GAP: the IGE engine failure on keys, hands off (Shift+F1, Shift+F6 held from 2 m of wheel height): the gear holds (measured: 320 fpm, the hover\'s 4.2 deg of left roll puts it on the left main, 140 kN, collapsed; KNOWN_ISSUES T7)', () => {
    const r = ah56('ige3'), wheels0 = see(r).agl - 1.9;
    r.input.keyDown('F1', true);
    let pulled = false;
    while (r.t < 8) {
      if (r.t >= 0.2 - FRAME / 2) r.input.keyUp('F1');
      if (!pulled && see(r).agl - 1.9 < 2) { pulled = true; r.input.keyDown('F6', true); }
      frame(r);
    }
    report('IGE engine failure on keys', { wheelHeightM: wheels0, crashed: r.physics.state.crashed });
    expect(r.physics.state.crashed).toBe(false);
  }, 60_000);
});
