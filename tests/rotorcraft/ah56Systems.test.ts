// AH-56A systems on the stage-2 aircraft (AG, plan revision 2 section 7.2): the hover ceiling without wing and pusher
// (G10), an engine failure in the hover (G11), the T64-GE-716 (G12) and the ICS / AMCS configuration switch through
// the flight model and SimPhysics (G14). Each row logs its numbers next to the target ([ah56] lines).
import { afterAll, describe, expect, it } from 'vitest';
import { DEG, FT, KT, interp1 } from '../../src/core/math';
import { defaultWeather } from '../../src/core/types';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { parseSnapshot } from '../../src/sim/resume';
import { AH56_DEFINITION } from '../../src/aircraft/ah56';
import { AH56_AMCS_NR_FRACTION, AH56_N2_BEEP, AH56_NR_100, AH56_TIT_C } from '../../src/aircraft/ah56/facts';
import { governedRpm } from '../../src/physics/rotorcraft/definition';
import { collectiveServo, d, gauges, pilot, report, rig, run, writeTrace } from './ah56Rig';
import { AH56_BASE } from '../../src/aircraft/ah56/base';
import { AH56_GYRO } from '../../src/aircraft/ah56/gyro';
import { AH56_HALF_P, AH56_ROTOR_HIGH_SPEED } from '../../src/aircraft/ah56/highSpeed';
import { mergeDefinition } from '../../src/aircraft/ah56/patch';
import { FRAME, keyRig } from './bo105KeyPilot';

/** The AH-56A without the compound (no wing, no pusher, no compound airframe patch): AH56_ROTORCRAFT's assembly without
 *  AH56_COMPOUND (integrator, at the AH merge: AC's request (b), so G10 keeps its "no wing, no pusher" meaning; the stage-5
 *  rotor section is in). */
const HELICOPTER = { ...AH56_DEFINITION, rotorcraft: mergeDefinition(AH56_BASE,
  { ...(AH56_GYRO ? { controlGyro: AH56_GYRO } : {}), ...(AH56_HALF_P ? { halfPHop: AH56_HALF_P } : {}) },
  { main: AH56_ROTOR_HIGH_SPEED }) };

const trace: Record<string, unknown> = {};
afterAll(() => writeTrace('ah56Systems', trace));

describe('G10: hover ceiling out of ground effect, 18,750 lb, standard day, no wing and no pusher', () => {
  /** Hover OGE trimmed at `ft`: the torque, Ng and TIT, whether it is within the ratings and which limit binds. The
   *  ceiling is set at the engine's 10-minute (take-off) rating, TIT 780 C (P; 740 C is the continuous rating), the
   *  transmission's 114 % torque and Ng 101.5 % (P), as a hover-ceiling chart uses the maximum rating. */
  function hover(ft: number) {
    const r = rig({ lb: 18_750, ft, height: ft * FT + 300, cfg: 'ics', definition: HELICOPTER });
    const g = gauges(r), throttle = r.fm.state.rotorcraft!.governorThrottle;
    const limits = { trim: !r.fm.lastTrim!.converged, torque: g.torque > 114, throttle: throttle >= 0.999, ng: g.ng > 101.5,
      tit10min: g.tit > AH56_TIT_C.yellow10min };
    const binding = Object.entries(limits).filter(([, v]) => v).map(([k]) => k).join('+') || 'none';
    return { ft, torque: g.torque, ng: g.ng, tit: g.tit, throttle, ok: binding === 'none', binding };
  }
  it('9,000-11,500 ft (ESTIMATE: the compound\'s 8,500 ft P plus no wing download)', () => {
    let lo = 0, hi = 20_000;
    expect(hover(lo).ok).toBe(true);
    for (let i = 0; i < 7; i++) { const mid = (lo + hi) / 2; if (hover(mid).ok) lo = mid; else hi = mid; }
    const at = hover(lo), above = hover(hi);
    report('G10 HOGE 18,750 lb std', { ceilingFt: lo, torque: at.torque, ng: at.ng, titC: at.tit, aboveFt: hi, aboveTorque: above.torque,
      aboveNg: above.ng, aboveTitC: above.tit, aboveThrottle: above.throttle, limitedBy: above.binding,
      rating: 'engine 10-min (TIT 780 C), transmission 114 %', target: '9,000-11,500 ft' });
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

describe('G11b: engine failure at 63 KCAS level flight (ICS, P ASTA-72 para 67: a 2 s delay of the collective went 3 % below the 85 % minimum transient)', () => {
  // ASTA-72 paras 66-67 (P): failures simulated by the overspeed fuel cut, the controls held, the collective delayed 2 s; at the
  // 63 KCAS level entry the rotor went 3 % below the 85 % minimum transient rotor speed (about 82 %). The ICS aircraft (100 % = 246
  // rpm), about 19,700 lb, aft CG, 2,700 ft (the para 69 conditions; table 8 not in the text read). The model: the condition grip
  // OFF, the test pilot holding the attitude, after 2 s the collective to 0.5 deg in 0.3 s and the prop to +8 deg (para 66). The
  // drivetrain inertia is P (10,742 slug-ft^2 referred to the rotor, facts.ts). Tuning round (KNOWN_ISSUES T7): the reviews' 77 %
  // was the AMCS from its 97.5 % against this ICS point; the ICS reads 80.7 % with a 0.3 s dump (79.2-79.6 % over 1 s).
  function fail63() {
    const r = rig({ cfg: 'ics', kt: 63, lb: 19_700, ft: 2700, gearDown: true });
    const hold = pilot(r, 63), c0 = r.c.collective ?? 0, target = (0.5 * DEG - d.main.minPitch) / (d.main.maxPitch - d.main.minPitch);
    const p = d.pusher!, autoLever = interp1(p.beta.angle, p.beta.lever, 8 * DEG);
    const trimTq = gauges(r).torque;
    r.c.throttle = 0;
    let t = 0, nrMin = Infinity, tMin = 0, nrAt2 = 0;
    run(r, 12, () => {
      t += 1 / 240; hold(1 / 240);
      if (t > 2) { r.c.collective = Math.max(target, c0 - (c0 - target) * Math.min(1, (t - 2) / 0.3)); r.c.propLever = autoLever; }
      const g = gauges(r);
      if (g.nr < nrMin) { nrMin = g.nr; tMin = t; }
      if (Math.abs(t - 2) < 1 / 480) nrAt2 = g.nr;
    });
    return { trimTorquePct: trimTq, nrAt2, nrMin, tMin, nrAt12: gauges(r).nr, crashed: r.fm.state.crashed };
  }
  const f = fail63();
  trace.G11b = f;
  it('the rotor recovers inside the power-off band by 12 s and nothing crashes; Nr at the 2 s delay and the minimum reported', () => {
    report('G11b engine failure 63 KCAS (ICS), 2 s delay', { ...f, P: 'about 82 % (3 % below 85 %)' });
    expect(f.crashed).toBe(false);
    expect(f.nrMin).toBeGreaterThan(75);
    expect(f.nrAt12).toBeGreaterThanOrEqual(85); expect(f.nrAt12).toBeLessThanOrEqual(110);
  });
  it.fails('KNOWN GAP: the Nr minimum is 82 +/- 1 % (P; measured 80.7 %)', () => {
    expect(f.nrMin).toBeGreaterThanOrEqual(81); expect(f.nrMin).toBeLessThanOrEqual(83);
  });
});

describe('G11c: engine failure in the IGE hover (AMCS, wheels 3 m up), the written pilot: wings level, yaw damped, the collective held then raised at the hand rate from 1.5 m', () => {
  // Tuning round 2 (the pilot gate's should 7, KNOWN_ISSUES T7): the H-V envelope's low corner. From the 15 m hover no technique
  // tried survives (Nr 97 -> 45 % in 4.8 s, 1,800-2,000 fpm: the P inertia against the hover torque), so the engine-failure lesson
  // starts here. The pilot: the condition grip OFF, the attitude held with the wings levelled (the hover's 4.8 deg of left roll would
  // put the touchdown on the left main), the pedal damping the yaw, the collective held until the wheels are 1.5 m up and then raised
  // at 1.0 of the travel per second (the hand rate, Shift+F6 is 0.5). W/tune/ah56/r2 out/p8_igefail2.log: 282 fpm, no damage; from 1 m
  // at 0.5 per second, or with the wings left at the hover roll, the left main collapses (140 kN) at 450-660 fpm.
  function igeFail() {
    const r = keyRig({ start: 'ige3', dd: AH56_DEFINITION, assist: false }), c = r.c, s = r.physics.state;
    const pitch0 = s.pitch, e0 = c.elevator, a0 = c.aileron, r0 = c.rudder, wheels0 = s.altitudeAGL - 1.9;
    let pulled = false, touchFpm = NaN, nrMin = Infinity;
    for (let t = 0; t < 8; t += FRAME) {
      r.input.update(FRAME, r.ctx);
      c.throttle = 0;
      c.elevator = Math.max(-1, Math.min(1, e0 + 1.5 * (pitch0 - s.pitch) - 0.6 * s.angularVelocity.y));
      c.aileron = Math.max(-1, Math.min(1, a0 + 1.2 * (0 - s.roll) - 0.3 * s.angularVelocity.x));
      c.rudder = Math.max(-1, Math.min(1, r0 - 0.3 * s.angularVelocity.z)); c.pedalWorked = true;
      if (s.altitudeAGL - 1.9 < 1.5) pulled = true;
      if (pulled) c.collective = Math.min(1, (c.collective ?? 0) + 1.0 * FRAME);
      r.physics.advance(FRAME); r.t += FRAME;
      if (s.rotorcraft) nrMin = Math.min(nrMin, s.rotorcraft.turboshaft?.nrPct ?? Infinity);
      if (Number.isNaN(touchFpm) && s.onGround) touchFpm = s.velocity.z * 196.85;
    }
    return { wheelHeightM: wheels0, touchdownFpm: touchFpm, nrMinPctAfterTouch: nrMin, crashed: s.crashed };
  }
  const f = igeFail();
  trace.G11c = f;
  it('touchdown under 800 fpm and no damage', () => {
    report('G11c engine failure IGE hover', { ...f, target: '< 800 fpm, no crash' });
    expect(f.crashed).toBe(false);
    expect(f.touchdownFpm).toBeLessThan(800);
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
