// AH-56A tune round 3 (item C, KNOWN_ISSUES T11): the keyboard beginner's whole flight on the shipped profile, aids on: the real
// SimPhysics and InputSystem (tests/rotorcraft/bo105KeyPilot.ts keyRig, 60 Hz) and the WATCHING beginner of ah56KeyPilot.ts, feet
// off the pedal keys (the STAB ASSIST holds the heading below 20 KIAS and the sideslip above it), the prop grip left to the PROP
// SCHEDULE aid. The flight: runway lift-off (F6 held to the first unload) -> a 3 m hover 20 s -> climb-out at 60 KIAS to 90 m -> a
// circuit of four 90 deg left turns by bank (leg 20 s, downwind 30 s, base at 50 KIAS) -> descent at 40 KIAS to 30 m -> the stop
// (the nose 6 deg above the hover attitude, 2 deg below 10 kt, the sideways drift stopped by the wings) until under 3 kt for 2 s
// running -> 30 s of hover over the new spot -> a vertical landing holding F5 (the height hold slows the descent near the ground).
// Before round 3 (the round-2 gate): the circuit's legs wandered 92-128 deg with 15-40 kt of sideslip and the way back crashed or
// never stopped. Two paces (0.8 s / 0.3 s late and 1.2 s / 0.5 s late); the outcome is sensitive to the path (one frame of a key
// moves it), so a pace's miss is recorded with its number rather than tuned away: at the four paces of W/tune2/ah56 out/fin_c1_*.log
// every flight landed, and 3 of 4 stopped inside the 90 s.
import { describe, expect, it } from 'vitest';
import { AH56_DEFINITION } from '../../src/aircraft/ah56';
import { FRAME, frame, keyRig } from './bo105KeyPilot';
import { Extremes, WatchingBeginner, fly, liftToUnload, see, wrapDeg, type Seen } from './ah56KeyPilot';

const report = (label: string, values: Record<string, number | string | boolean | null>) =>
  console.log(`[ah56] ${label}: ${Object.entries(values).map(([k, v]) => `${k}=${typeof v === 'number' ? +v.toPrecision(4) : v}`).join('  ')}`);
const f1 = (x: number) => +x.toFixed(1);

interface Phase { why: string; t: number; maxAtt: number; maxHdgErr: number; minAgl: number; maxKias: number; drift: number }
function mission(iv: number, lag: number) {
  const r = keyRig({ start: 'runway', dd: AH56_DEFINITION, assist: true }), s0 = see(r), agl = 90;
  const out: { phases: Record<string, Phase>; end: string; touchFpm: number; touchGs: number; touchRoll: number; crashed: boolean; reason: string } =
    { phases: {}, end: '', touchFpm: NaN, touchGs: NaN, touchRoll: NaN, crashed: false, reason: '' };
  const lift = liftToUnload(r);
  let p = new WatchingBeginner(r, { holdPos: true, hdg: s0.hdg, agl: s0.agl + 3, feetOff: true }, iv, lag);
  const phase = (name: string, cmd: WatchingBeginner['cmd'], maxS: number, until?: (s: Seen) => boolean): boolean => {
    p.cmd = cmd;
    const e = new Extremes(r, s0.hdg), res = fly(r, maxS, p, e, until);
    out.phases[name] = { why: res.why, t: f1(res.t), maxAtt: f1(e.maxAtt), maxHdgErr: f1(e.maxHdgErr), minAgl: f1(e.minAgl), maxKias: f1(e.maxKias), drift: f1(e.drift) };
    return res.why !== 'crash';
  };
  const go = (): string => {
    if (Number.isNaN(lift)) return 'no lift-off';
    if (!phase('hover', { holdPos: true, hdg: s0.hdg, agl: s0.agl + 3, feetOff: true }, 20)) return 'hover';
    const sh = see(r);
    if (!phase('climbOut', { kias: 60, hdg: s0.hdg, climb: 3, feetOff: true }, 90, (s) => s.agl >= agl)) return 'climbOut';
    const h = [s0.hdg - 90, s0.hdg - 180, s0.hdg - 270, s0.hdg];
    if (!phase('leg1', { kias: 60, hdg: s0.hdg, agl, feetOff: true }, 20)) return 'leg1';
    for (const [i, [leg, s]] of ([['leg2', 20], ['downwind', 30], ['base', 20]] as const).entries()) {
      if (!phase(`turn${i + 1}`, { kias: i === 2 ? 50 : 60, hdg: h[i], agl, feetOff: true }, 60, (q) => Math.abs(wrapDeg(q.hdg - h[i])) < 5)) return `turn${i + 1}`;
      if (!phase(leg, { kias: i === 2 ? 50 : 60, hdg: h[i], agl, feetOff: true }, s)) return leg;
    }
    if (!phase('turn4', { kias: 45, hdg: h[3], agl, feetOff: true }, 60, (q) => Math.abs(wrapDeg(q.hdg - h[3])) < 5)) return 'turn4';
    if (!phase('descend', { kias: 40, hdg: h[3], climb: -2.5, feetOff: true }, 90, (q) => q.agl <= 30)) return 'descend';
    p.pitchRef = sh.pitch; p.rollRef = sh.roll;
    let slowFor = 0;
    if (!phase('stop', { stop: true, hdg: h[3], agl: 15, feetOff: true }, 90, (q) => { slowFor = q.gs < 3 ? slowFor + FRAME : 0; return slowFor >= 2; })) return 'stop';
    p.releaseAll();
    p = new WatchingBeginner(r, { holdPos: true, hdg: h[3], agl: 10, feetOff: true }, iv, lag);
    if (!phase('hover2', { holdPos: true, hdg: h[3], agl: 10, feetOff: true }, 30)) return 'hover2';
    if (!phase('land', { holdPos: true, hdg: h[3], climb: -1, feetOff: true }, 90, (q) => q.onGround)) return 'land';
    const st = see(r);
    out.touchFpm = Math.round(-st.climb * 196.85); out.touchGs = f1(st.gs); out.touchRoll = f1(st.roll);
    p.releaseAll();
    r.input.keyDown('F5');
    for (let t = 0; t < 8 && !r.physics.state.crashed; t += FRAME) frame(r);
    r.input.keyUp('F5');
    return r.physics.state.crashed ? 'after touchdown' : 'landed';
  };
  out.end = go();
  out.crashed = r.physics.state.crashed;
  out.reason = (r.physics as unknown as { fm: { crashReason?: string } }).fm.crashReason ?? '';
  return out;
}

describe('the keyboard beginner\'s whole flight (aids on, feet off): lift-off, circuit, back to a hover, landing', () => {
  const flights = ([[0.8, 0.3], [1.2, 0.5]] as const).map(([iv, lag]) => ({ iv, m: mission(iv, lag) }));
  for (const { iv, m } of flights) {
    const ph = m.phases;
    it(`every ${iv} s: lifts off, flies the four-turn circuit at 60 KIAS (the turns complete) and lands, no crash anywhere`, () => {
      report(`mission every ${iv} s`, { end: m.end, reason: m.reason, climbOutKias: ph.climbOut?.maxKias ?? NaN, circuitHdgTurn1: ph.turn1?.maxHdgErr ?? NaN,
        stopS: ph.stop?.t ?? NaN, stopWhy: ph.stop?.why ?? '-', hover2DriftM: ph.hover2?.drift ?? NaN, touchFpm: m.touchFpm, touchGsKt: m.touchGs, touchRollDeg: m.touchRoll });
      for (const t of ['turn1', 'turn2', 'turn3', 'turn4']) expect(ph[t]?.why).toBe('done');
      expect(ph.climbOut.maxKias).toBeGreaterThan(55);
      expect(m.crashed).toBe(false);
      expect(m.end).toBe('landed');
    });
  }
  const [a, b] = flights;
  it('every 0.8 s: the stop reaches the hover (under 3 kt for 2 s) within 90 s, the hover over the new spot holds within 15 m, the touchdown under 300 fpm and 5 kt', () => {
    expect(a.m.phases.stop.why).toBe('done');
    expect(a.m.phases.hover2.drift).toBeLessThan(15);
    expect(a.m.touchFpm).toBeLessThan(300);
    expect(a.m.touchGs).toBeLessThan(5);
  });
  // Measured (this file): every 0.8 s stopped in 71.8 s, the hover 8.0 m, the touchdown 51 fpm at 1.0 kt.
  it.fails('KNOWN GAP every 1.2 s (0.5 s late): the same stop, hover and touchdown (measured: not stopped in 90 s; the hover 18.8 m; 40 fpm at 9.5 kt, no crash; KNOWN_ISSUES T11)', () => {
    expect(b.m.phases.stop.why).toBe('done');
    expect(b.m.phases.hover2.drift).toBeLessThan(15);
    expect(b.m.touchFpm).toBeLessThan(300);
    expect(b.m.touchGs).toBeLessThan(5);
  });
});
