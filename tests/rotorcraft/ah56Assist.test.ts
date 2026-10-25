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

  // Round 3 (KNOWN_ISSUES T11): this row's premise was "without the assist the beginner loses the heading" (round 2: 72.6 deg in
  // 60 s with the non-centring pedal keys). With the re-centring pedal keys (InputProfile.centringPedals) a tap is a turn while held,
  // not a new pedal position, and the raw aircraft keeps the tapper's heading by itself: the row now states that.
  it('without it (the raw aircraft) the same beginner on the re-centring pedal keys holds the heading within 20 deg and the hover within 10 m (round 2, non-centring keys: the heading 72.6 deg off)', () => {
    const r = keyRig({ start: 'hover15', dd: AH56_DEFINITION, assist: false });
    const keys = new Keys(r);
    const res = flyHover(r, keys, 60, hoverBeginner(r, keys, 0.8, 0.3));
    report('keyboard beginner hover, assist off, hover15', { lostS: res.lostS, driftM: res.driftM, maxAttDeg: res.maxAttDeg, maxHdgDeg: res.maxHdgDeg });
    expect(res.lostS).toBeNull();
    expect(res.maxHdgDeg).toBeLessThan(20);
    expect(res.driftM).toBeLessThan(10);
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
  it.fails('KNOWN GAP: the same lift-off with the Bo 105 helper\'s tapper (its 0.1-0.6 s taps cannot hold this aircraft): no crash, the heading within 30 deg, under 15 m of drift (measured: round 2 no crash, 38 deg, 85 m; round 3 no crash, 180 deg, 35 m: its pedal taps are timed for the Bo 105)', () => {
    const f = liftOff('tapper');
    report('lift-off then the Bo 105 tapper', f);
    expect(f.crashed).toBe(false);
    expect(f.maxHdgDeg).toBeLessThan(30);
    expect(f.driftM).toBeLessThan(15);
  }, 120_000);

  // Round 3: passes because of the PROP SCHEDULE aid (30.1 s); the speed-stable rotor of T10 without it settles at 42-50 KIAS (49.8
  // at most) on these pushes (KNOWN_ISSUES T11).
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
      p.pitchRef = s0.pitch; p.rollRef = s0.roll;
      const back = new Extremes(r, s0.hdg);
      const b = fly(r, 90, p, back, (s) => s.gs < 3);
      Object.assign(out, { backWhy: b.why, backS: b.t, hdgDeg: Math.max(accel.maxHdgErr, back.maxHdgErr), minAgl: Math.min(accel.minAgl, back.minAgl) });
    }
    return out;
  };
  const transitions = PACES.map(([iv, lag]) => ({ iv, f: transition(iv, lag) }));
  for (const { iv, f } of transitions) {
    it(`the watching beginner (every ${iv} s, feet off) leaves the hover: 38 KIAS within 40 s, no crash (round 1's profile: 34-44 s, the heading 50-95 deg off)`, () => {
      report(`hover to 40 KIAS, every ${iv} s`, f);
      expect(f.accelWhy).toBe('done');
      expect(f.accelS).toBeLessThan(40);
    });
  }
  // Round 3: the way back works at 0.8 s (stopped in 36.7 s) but feet off the heading wanders 44 deg (the hold takes whatever heading
  // the nose has when the speed falls through 20 KIAS), and at 1.2 s the stop takes longer than 90 s; the whole flight with the circuit
  // and the landing is tests/rotorcraft/ah56KeyMission.test.ts.
  it.fails('KNOWN GAP: hover -> 40 KIAS -> hover on keys, no crash, the heading within 30 deg (round 3 measured: out in 27.6 / 29.7 s; back in 36.7 s / not stopped in 90 s, the heading 44 / 57 deg off; round 2: crashed at 68 s / not stopped, 68 / 164 deg; KNOWN_ISSUES T9, T11)', () => {
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

  // Tune round 3: a passing row (KNOWN_ISSUES T10, T11). Before (round 2): 320 fpm, the hover's 4.2 deg of left roll on the left main
  // alone, 140 kN, collapsed. Now 451 fpm and 145 kN against the main leg's 180 kN (gear.ts, the one-wheel touchdown at the P sink)
  // with Shift+F6 taking the whole travel (its 80 % stop is off with the engine out). Sensitive to the height of the pull: from 1.6 m
  // or 2.5 m the left main still collapses (542 / 481 fpm, 184 / 183 kN; W/tune2/ah56 out/fin_d4c7.log); round 4 (W/tune2/ah56/r4/
  // out/ige.log) hands off holds from 2.0 and 2.25 m (317 / 315 fpm, 145 / 175 kN) and collapses from 1.75 m (416 fpm, 181 kN). The
  // hint's technique (level the wings) has the wider window: the rows after this one.
  it('the IGE engine failure on keys, hands off (Shift+F1, Shift+F6 held from 2 m of wheel height): the gear holds (round 2: 320 fpm on the left main, 140 kN, collapsed; KNOWN_ISSUES T7, T10)', () => {
    const r = ah56('ige3'), wheels0 = see(r).agl - 1.9;
    r.input.keyDown('F1', true);
    let pulled = false, sink = 0, peak = 0, rollTouch = NaN;
    while (r.t < 8) {
      if (r.t >= 0.2 - FRAME / 2) r.input.keyUp('F1');
      if (!pulled && see(r).agl - 1.9 < 2) { pulled = true; r.input.keyDown('F6', true); }
      frame(r);
      const s = r.physics.state;
      if (!s.onGround) sink = Math.max(sink, -see(r).climb * 196.85);
      else if (Number.isNaN(rollTouch)) rollTouch = s.roll / DEG;
      peak = Math.max(peak, ...s.wheels.map((w) => w.load));
    }
    report('IGE engine failure on keys', { wheelHeightM: wheels0, crashed: r.physics.state.crashed, sinkFpm: sink, peakWheelKN: peak / 1000, rollAtTouchDeg: rollTouch });
    expect(r.physics.state.crashed).toBe(false);
  }, 60_000);
  // Round 4 (the pass-2 gate: the hint said Shift+F6 "from about 1.5 m", where its own technique collapses a main at one lag of
  // two; KNOWN_ISSUES T11). The hint's technique: the wings levelled on the arrow keys (the roll seen 0.3 or 0.5 s late, a key held
  // while it is more than 1 deg off), the collective held, Shift+F6 held from the cushion height. The window on the record, both
  // lags (W/tune2/ah56/r4/out/ige.log; this row reads the touchdown a frame later): 1.75 m 361-406 fpm, 96 kN; 2.0 m 309-323 fpm, 70
  // kN; 2.25 m 315-335 fpm, 93 kN a main. Outside
  // it, 1.5 m and 2.5 m hold at one lag and collapse a main at the other (181 / 183 kN); 1.0 m collapses at both (the gate's p9).
  const igeLevelWings = (cushionM: number, lag: number) => {
    const r = ah56('ige3'), nLag = Math.round(lag / FRAME), seen: number[] = [];
    let pulled = false, rollKey: string | null = null, touchFpm = NaN, peak = 0;
    r.input.keyDown('F1', true);
    while (r.t < 8 && !r.physics.state.crashed) {
      if (r.t >= 0.2 - FRAME / 2) r.input.keyUp('F1');
      const now = see(r);
      seen.push(now.roll);
      const roll = seen.length > nLag ? seen[seen.length - 1 - nLag] : seen[0];
      if (r.t > 0.3) {
        const want = roll < -1 ? 'ArrowRight' : roll > 1 ? 'ArrowLeft' : null;
        if (rollKey && rollKey !== want) { r.input.keyUp(rollKey); rollKey = null; }
        if (want && !rollKey) { r.input.keyDown(want); rollKey = want; }
      }
      if (!pulled && now.agl - 1.9 < cushionM) { pulled = true; r.input.keyDown('F6', true); }
      frame(r);
      const s = r.physics.state;
      if (s.onGround && Number.isNaN(touchFpm) && r.t > 0.3) touchFpm = -now.climb * 196.85;
      peak = Math.max(peak, ...s.wheels.map((w) => w.load));
    }
    for (const k of [rollKey, 'F6']) if (k) r.input.keyUp(k);
    return { crashed: r.physics.state.crashed, touchFpm, peakWheelKN: peak / 1000 };
  };
  for (const cushionM of [1.75, 2.0, 2.25]) {
    it(`the IGE engine failure on keys as the hint says (wings level, Shift+F6 from ${cushionM} m of wheel height), 0.3 and 0.5 s late: the gear holds, the touchdown inside the P 9.5 ft/s (570 fpm) and each main under 150 kN of its 180`, () => {
      for (const lag of [0.3, 0.5]) {
        const f = igeLevelWings(cushionM, lag);
        report(`IGE engine failure on keys, wings level, Shift+F6 from ${cushionM} m, ${lag} s late`, f);
        expect(f.crashed).toBe(false);
        expect(f.touchFpm).toBeLessThan(570);
        expect(f.peakWheelKN).toBeLessThan(150);
      }
    }, 120_000);
  }
});

// Round 3 (the round-2 gate's other issues, KNOWN_ISSUES T11): the presses a first-day pilot makes on the collective, flown on the
// shipped profile (the STAB ASSIST's height hold: a held F5 / F6 airborne is a sink / climb command, the keys at rest hold the
// height; Shift+F6 stops at 80 % with the engine running). Before round 3 in brackets (the gate's out/a_lift.log, b_dump.log).
describe('STAB ASSIST round 3: the collective presses', () => {
  /** Runway start, F6 held to the first unload and `extraS` more, then the watching beginner 30 s at 3 m, feet off. */
  const liftPast = (extraS: number, iv: number, lag: number) => {
    const r = ah56('runway'), s0 = see(r);
    liftToUnload(r);
    r.input.keyDown('F6');
    const t1 = r.t;
    while (r.t - t1 < extraS - FRAME / 2) frame(r);
    r.input.keyUp('F6');
    const e = new Extremes(r, s0.hdg);
    const res = fly(r, 30, new WatchingBeginner(r, { holdPos: true, hdg: s0.hdg, agl: s0.agl + 3, feetOff: true }, iv, lag), e);
    return { crashed: res.why === 'crash', maxSinkFpm: e.maxSinkFpm, maxAglM: e.maxAgl, driftM: e.drift, maxHdgDeg: e.maxHdgErr };
  };
  for (const extraS of [1, 2]) for (const [iv, lag] of PACES) {
    it(`F6 held ${extraS} s past the first unload, then the watching beginner (every ${iv} s): no crash, the sink under 200 fpm (round 2: ${extraS === 1 ? 'the slow pace crashed, left main at 420 fpm' : 'both paces crashed, 549 / 699 fpm'})`, () => {
      const f = liftPast(extraS, iv, lag);
      report(`F6 held ${extraS} s past the unload, every ${iv} s`, f);
      expect(f.crashed).toBe(false);
      expect(f.maxSinkFpm).toBeLessThan(200);
    }, 120_000);
  }
  /** F5 held 2 s in the 15 m hover, then `after` 20 s. */
  const dump = (after: 'beginner' | 'shiftF6', iv: number, lag: number) => {
    const r = ah56('hover15'), s0 = see(r);
    r.input.keyDown('F5');
    while (r.t < 2 - FRAME / 2) frame(r);
    r.input.keyUp('F5');
    const e = new Extremes(r, s0.hdg);
    let res;
    if (after === 'beginner') res = fly(r, 20, new WatchingBeginner(r, { holdPos: true, hdg: s0.hdg, agl: s0.agl, feetOff: true }, iv, lag), e);
    else {
      // Sees the sink `lag` s late, decides every `iv` s: Shift+F6 held while the seen sink is over 1 m/s (the gate's balloon case).
      const buf: number[] = [], nLag = Math.round(lag / FRAME);
      let next = r.t + iv, down = false;
      const p = new WatchingBeginner(r, { holdPos: true, hdg: s0.hdg, feetOff: true }, iv, lag);
      res = fly(r, 20, { step: () => {
        buf.push(see(r).climb);
        const seen = buf.length > nLag ? buf[buf.length - 1 - nLag] : buf[0];
        if (r.t >= next - FRAME / 2) { next += iv; if (!down && seen < -1) { r.input.keyDown('F6', true); down = true; } }
        if (down && seen > -0.3) { r.input.keyUp('F6'); down = false; }
        p.step();
      } } as unknown as WatchingBeginner, e);
      if (down) r.input.keyUp('F6');
    }
    return { crashed: res.why === 'crash', minAglM: e.minAgl, maxAglM: e.maxAgl, maxSinkFpm: e.maxSinkFpm, maxHdgDeg: e.maxHdgErr };
  };
  for (const [iv, lag] of PACES) {
    it(`F5 held 2 s in the 15 m hover, then the watching beginner (every ${iv} s): no crash, above 10 m, the sink under 500 fpm (round 2: 960 fpm, a crash at the slow pace)`, () => {
      const f = dump('beginner', iv, lag);
      report(`F5 2 s in the hover, every ${iv} s`, f);
      expect(f.crashed).toBe(false);
      expect(f.minAglM).toBeGreaterThan(10);
      expect(f.maxSinkFpm).toBeLessThan(500);
    }, 120_000);
    it(`F5 held 2 s, then Shift+F6 held until the sink stops (every ${iv} s): the balloon under 40 m, the heading within 45 deg (round 2: 200 m, the heading 180 deg off)`, () => {
      const f = dump('shiftF6', iv, lag);
      report(`Shift+F6 sink recovery, every ${iv} s`, f);
      expect(f.crashed).toBe(false);
      expect(f.maxAglM).toBeLessThan(40);
      expect(f.maxHdgDeg).toBeLessThan(45);
    }, 120_000);
  }
  // Round 4 (the pass-2 gate's should; collectiveFastRate.downGate): with the engine running below 30 kt of forward air speed Shift+F5
  // acts as bare F5, the height hold's sink command. Before (round 3, a KNOWN GAP row): 1 s in the 15 m hover hit the ground at about
  // 2,640 fpm every time. Now (W/tune2/ah56/r4/out/shiftf5.log): 1 s 14.8 m minimum, 194 fpm; 2 s 12.7 m, 337 fpm; held 6 s 5.4 m,
  // 408 fpm; from the 3 m IGE hover 58-91 fpm. In forward flight and with the engine stopped it keeps the hand speed (rows below).
  for (const holdS of [1, 2]) {
    it(`Shift+F5 for ${holdS} s in the 15 m hover, engine running, hands off: acts as F5, no crash, above 10 m, the sink under 500 fpm (round 3: about 2,640 fpm into the ground)`, () => {
      const r = ah56('hover15'), s0 = see(r), e = new Extremes(r, s0.hdg);
      r.input.keyDown('F5', true);
      while (r.t < holdS - FRAME / 2) { frame(r); e.see(); }
      r.input.keyUp('F5');
      const res = fly(r, 12, null, e);
      report(`Shift+F5 ${holdS} s in the hover`, { why: res.why, minAglM: e.minAgl, maxSinkFpm: e.maxSinkFpm });
      expect(res.why).not.toBe('crash');
      expect(e.minAgl).toBeGreaterThan(10);
      expect(e.maxSinkFpm).toBeLessThan(500);
    }, 60_000);
  }
  it('Shift+F5 keeps the hand speed where it is the autorotation entry: at 90 KIAS (to the 15 % stop in 0.5 s) and in the hover with the engine stopped', () => {
    const fwd = keyRig({ start: 'level', kias: 90, heightM: 300, dd: AH56_DEFINITION, assist: true });
    for (let i = 0; i < 60; i++) frame(fwd);
    fwd.input.keyDown('F5', true);
    for (let t = 0; t < 0.5 - FRAME / 2; t += FRAME) frame(fwd);
    fwd.input.keyUp('F5');
    const cutoff = ah56('hover15');
    cutoff.input.keyDown('F1', true); for (let i = 0; i < 12; i++) frame(cutoff); cutoff.input.keyUp('F1');
    for (let i = 0; i < 30; i++) frame(cutoff);
    const c0 = cutoff.c.collective ?? 0;
    cutoff.input.keyDown('F5', true);
    for (let t = 0; t < 0.3 - FRAME / 2; t += FRAME) frame(cutoff);
    cutoff.input.keyUp('F5');
    report('Shift+F5 at hand speed', { at90KiasAfter05s: fwd.c.collective ?? NaN, engineOutDrop03s: c0 - (cutoff.c.collective ?? 0) });
    expect(fwd.c.collective).toBeCloseTo(AH56_INPUT.collectiveFastRate!.downStop!, 2);
    expect(cutoff.physics.state.engines.every((x) => x.running)).toBe(false);
    expect(c0 - (cutoff.c.collective ?? 0)).toBeGreaterThan(0.2);
  }, 60_000);
  it.fails('KNOWN GAP: the run-on landing from a trimmed 45 KIAS approach, feet off, F5 and the brakes on the wheels (both paces): no crash and the roll-out heading within 30 deg (measured: 289 fpm, the roll-out turning 140 deg; 547 fpm, the right main collapsed at 181 kN)', () => {
    for (const [iv, lag] of PACES) {
      const r = keyRig({ start: 'level', kias: 45, heightM: 45, dd: AH56_DEFINITION, assist: true });
      for (let i = 0; i < 120; i++) frame(r);
      r.c.tailWheelLock = true; r.c.gearLever = 'down';
      const s0 = see(r), p = new WatchingBeginner(r, { kias: 45, hdg: s0.hdg, climb: -2, feetOff: true }, iv, lag);
      fly(r, 60, p, undefined, (s) => s.agl <= 12);
      p.cmd = { kias: 40, hdg: s0.hdg, climb: -1, feetOff: true };
      const touch = fly(r, 60, p, undefined, (s) => s.onGround);
      const fpm = -see(r).climb * 196.85;
      p.releaseAll(); r.input.keyDown('F5'); r.input.keyDown('KeyB');
      let maxHdg = 0;
      for (let t = 0; t < 30 && !r.physics.state.crashed; t += FRAME) { frame(r); maxHdg = Math.max(maxHdg, Math.abs(wrapDeg(see(r).hdg - s0.hdg))); if (see(r).gs < 0.5 && t > 3) break; }
      r.input.keyUp('F5'); r.input.keyUp('KeyB');
      report(`run-on landing every ${iv} s`, { touch: touch.why, touchFpm: fpm, rollOutHdgDeg: maxHdg, crashed: r.physics.state.crashed });
      expect(r.physics.state.crashed).toBe(false);
      expect(maxHdg).toBeLessThan(30);
    }
  }, 180_000);
});
