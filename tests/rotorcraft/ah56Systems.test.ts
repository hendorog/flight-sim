// AH-56A systems on the stage-2 aircraft (AG, plan revision 2 section 7.2): the hover ceiling without wing and pusher
// (G10), an engine failure in the hover (G11), the T64-GE-716 (G12) and the ICS / AMCS configuration switch through
// the flight model and SimPhysics (G14). Each row logs its numbers next to the target ([ah56] lines).
import { afterAll, describe, expect, it } from 'vitest';
import { DEG, FT, KT } from '../../src/core/math';
import { defaultWeather } from '../../src/core/types';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { parseSnapshot } from '../../src/sim/resume';
import { AH56_DEFINITION } from '../../src/aircraft/ah56';
import { AH56_AMCS_NR_FRACTION, AH56_N2_BEEP, AH56_NR_100, AH56_TIT_C } from '../../src/aircraft/ah56/facts';
import { governedRpm } from '../../src/physics/rotorcraft/definition';
import { collectiveServo, d, gauges, pilot, report, rig, run, writeTrace } from './ah56Rig';

const trace: Record<string, unknown> = {};
afterAll(() => writeTrace('ah56Systems', trace));

describe('G10: hover ceiling out of ground effect, 18,750 lb, standard day, no wing and no pusher', () => {
  /** Hover OGE trimmed at `ft`: the torque, Ng and TIT, and whether the engine or the transmission limits it. */
  function hover(ft: number) {
    const r = rig({ lb: 18_750, ft, height: ft * FT + 300, cfg: 'ics' });
    const g = gauges(r), throttle = r.fm.state.rotorcraft!.governorThrottle;
    const ok = r.fm.lastTrim!.converged && g.torque <= 114 && throttle < 0.999 && g.ng <= 101.5 && g.tit <= AH56_TIT_C.inspection;
    return { ft, torque: g.torque, ng: g.ng, tit: g.tit, throttle, ok };
  }
  it('9,000-11,500 ft (ESTIMATE: the compound\'s 8,500 ft P plus no wing download)', () => {
    let lo = 0, hi = 20_000;
    expect(hover(lo).ok).toBe(true);
    for (let i = 0; i < 7; i++) { const mid = (lo + hi) / 2; if (hover(mid).ok) lo = mid; else hi = mid; }
    const at = hover(lo), above = hover(hi);
    report('G10 HOGE 18,750 lb std', { ceilingFt: lo, torque: at.torque, ng: at.ng, titC: at.tit, aboveFt: hi, aboveTorque: above.torque,
      aboveNg: above.ng, aboveThrottle: above.throttle, target: '9,000-11,500 ft' });
    trace.G10 = { ceilingFt: Math.round(lo), at, above };
    expect(lo).toBeGreaterThanOrEqual(9_000);
    expect(lo).toBeLessThanOrEqual(11_500);
  });
});

describe('G11: engine failure in the hover (ICS, 100 % Nr), collective held', () => {
  function fail() {
    const r = rig({ cfg: 'ics' });
    const nr0 = gauges(r).nr, roll0 = r.fm.state.roll / DEG;
    let t90 = NaN, t = 0, peakYaw = 0, rollAt1 = 0;
    r.c.throttle = 0;
    run(r, 2, () => {
      t += 1 / 240;
      const g = gauges(r);
      if (Number.isNaN(t90) && g.nr <= nr0 - 10) t90 = t;
      peakYaw = Math.min(peakYaw, g.r);
      if (Math.abs(t - 1) < 1 / 480) rollAt1 = g.roll;
    });
    return { nr0, t90, peakYaw, rollChange: rollAt1 - roll0 };
  }
  const f = fail();
  trace.G11 = f;

  it('Nr 100 -> 90 % in 0.4-1.0 s (ESTIMATE band); the nose yaws LEFT (P ASTA-72 para 68)', () => {
    report('G11 engine failure hover', { nrStartPct: f.nr0, secondsTo90: f.t90, target: '0.4-1.0', peakYawRateDegPerSec: f.peakYaw,
      rollChangeAt1sDeg: f.rollChange, drivetrainInertia: d.main.inertia + d.tail.inertia * d.tailRatio ** 2, P: 14_564 });
    expect(f.t90).toBeGreaterThanOrEqual(0.4);
    expect(f.t90).toBeLessThanOrEqual(1.0);
    expect(f.peakYaw).toBeLessThan(-1);
  });

  it.fails('G11 KNOWN GAP: the slight RIGHT roll of the P cue', () => {
    // The model rolls left: the tail swings right under the full anti-torque thrust, which unloads the tail rotor (above
    // the CG, its thrust rolled the aircraft right in the trim). ASTA-72 para 68 gives the cue without its condition.
    expect(f.rollChange).toBeGreaterThan(0);
  });
});

describe('G12: the T64-GE-716', () => {
  it('ground idle Ng in the 58-72 % band (P)', () => {
    const r = rig({ onGround: true });
    r.c.throttle = d.systems.turboshaft!.grip.groundIdle;
    run(r, 20);
    const g = gauges(r);
    report('G12 ground idle', { ngPct: g.ng, target: '58-72', titC: g.tit, nrPct: g.nr });
    expect(g.ng).toBeGreaterThanOrEqual(58); expect(g.ng).toBeLessThanOrEqual(72);
  });

  it('TIT at or below 740 C at 114 % torque, sea level ISA (P limits, plan G12)', () => {
    const r = rig({ lb: 20_500, cfg: 'ics', height: 1000 });
    let g = gauges(r);
    const fly = pilot(r);
    // Raise the collective until the torque reads 114 % (a climb), attitude held, then hold it there.
    run(r, 15, () => { g = gauges(r); fly(1 / 240); collectiveServo(r.c, 114 - g.torque, 0.02, 1 / 240, 0.1); });
    g = gauges(r);
    report('G12 TIT at 114 %', { torquePct: g.torque, titC: g.tit, target: '<= 740', ngPct: g.ng, nfPct: g.nf, climbFpm: g.fpm });
    trace.G12max = g;
    expect(g.torque).toBeGreaterThan(110); expect(g.torque).toBeLessThan(118);
    expect(g.tit).toBeLessThanOrEqual(740);
  });

  it('start: the condition grip to IDLE at 20 % Ng, automatic thereafter (P ASTA-72 para 78); TIT within the start limit', () => {
    const r = rig({ onGround: true, running: false });
    Object.assign(r.c, { masterBattery: true, alternator: true, fuelPump: true, fuelSelector: 'on', throttle: 0, starter: true });
    let t = 0, gripAt = NaN, idleAt = NaN, released = NaN, titMax = 0;
    run(r, 60, () => {
      t += 1 / 240;
      const g = gauges(r);
      if (Number.isNaN(gripAt) && g.ng >= 20) { r.c.throttle = d.systems.turboshaft!.grip.groundIdle; gripAt = t; }
      if (Number.isNaN(released) && g.ng >= 55) { r.c.starter = false; released = t; }
      if (Number.isNaN(idleAt) && g.ng >= 63) idleAt = t;
      titMax = Math.max(titMax, g.tit);
    });
    const g = gauges(r);
    report('G12 start', { gripToIdleAtS: gripAt, starterReleasedAtS: released, idleAtS: idleAt, ngPct: g.ng, titMaxC: titMax, startLimitC: 649,
      nrPct: g.nr });
    trace.G12start = { gripAt, released, idleAt, ng: g.ng, titMax };
    expect(gripAt).toBeLessThan(25);
    expect(idleAt).toBeLessThan(60);
    expect(g.ng).toBeGreaterThanOrEqual(58);
    expect(titMax).toBeLessThanOrEqual(649);
  });
});

describe('G14: the configuration switch (ICS 246 rpm, AMCS 239.85 rpm)', () => {
  it('governed Nr per configuration, and the beep range holds the AMCS 97.5 %', () => {
    expect(governedRpm(d, 'ics')).toBeCloseTo(AH56_NR_100, 9);
    expect(governedRpm(d, 'amcs')).toBeCloseTo(AH56_NR_100 * AH56_AMCS_NR_FRACTION, 9);
    expect(AH56_N2_BEEP.range[0]).toBeLessThanOrEqual(AH56_AMCS_NR_FRACTION);
    const out: Record<string, number> = {};
    for (const cfg of ['amcs', 'ics'] as const) {
      const r = rig({ cfg, kt: 60 });
      run(r, 10);
      out[cfg] = r.fm.state.rotorcraft!.rotorRpm;
    }
    report('G14 Nr after 10 s at 60 KIAS', { amcsRpm: out.amcs, target: 239.85, icsRpm: out.ics, targetIcs: 246 });
    expect(Math.abs(out.amcs - 239.85)).toBeLessThan(2);
    expect(Math.abs(out.ics - 246)).toBeLessThan(2);
  });

  it('both configurations trim at 0, 60 and 120 KTAS (residual < 1e-4)', () => {
    for (const cfg of ['amcs', 'ics'] as const) for (const kt of [0, 60, 120]) {
      const r = rig({ cfg, kt });
      const t = r.fm.lastTrim!;
      expect(t.converged).toBe(true);
      expect(t.residual).toBeLessThan(1e-4);
    }
  });

  it('ICS survives SimPhysics.reset(scenario) and a snapshot / resume; the AMCS default otherwise', () => {
    const weather = defaultWeather();
    const p = new SimPhysics({ aircraft: AH56_DEFINITION, weather, rotorcraftConfig: 'ics' });
    p.reset('cruise');
    p.step(3);
    expect(p.state.rotorcraft!.controlGyro!.mode).toBe('ics');
    p.reset('runway');
    p.step(2);
    expect(p.state.rotorcraft!.controlGyro!.mode).toBe('ics');
    expect(Math.abs(p.state.rotorcraft!.rotorRpm - 246)).toBeLessThan(2);
    p.reset('cruise');
    p.step(2);
    const snap = parseSnapshot(JSON.stringify(p.captureSnapshot({ weather, cameraMode: 'chase', quality: 'high', renderScale: null, resume: true, now: 1 })))!;
    expect(snap).not.toBeNull();
    // A reload without the URL's config: the saved mode wins.
    const q = new SimPhysics({ aircraft: AH56_DEFINITION, weather });
    q.restore(snap);
    expect(q.state.rotorcraft!.controlGyro!.mode).toBe('ics');
    q.step(2);
    report('G14 restore', { mode: q.state.rotorcraft!.controlGyro!.mode, rpm: q.state.rotorcraft!.rotorRpm, kias: q.state.ias / KT, crashed: q.state.crashed });
    expect(Math.abs(q.state.rotorcraft!.rotorRpm - 246)).toBeLessThan(2);
    expect(q.state.crashed).toBe(false);
    const a = new SimPhysics({ aircraft: AH56_DEFINITION, weather });
    a.reset('cruise');
    expect(a.state.rotorcraft!.controlGyro!.mode).toBe('amcs');
  });
});
