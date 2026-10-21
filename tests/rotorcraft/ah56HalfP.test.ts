// AH-56A stage 5 (AH): the scripted half-P hop (H7; owner note O1: scripted, not emergent). Plan revision 2 section 7.4 and
// section 0 item 10; docs/ah56-high-speed.md section 4. ICS at 160 KCAS, 18,300 lb, sea level, the collective on the ICS
// cruise schedule. Stick scripts in inches about the trim point. Each row logs its numbers next to the target ([ah56] lines);
// AH56_TRACE=<dir> writes ah56HalfP.json.
import { afterAll, describe, expect, it } from 'vitest';
import { DEG, KT, quat } from '../../src/core/math';
import { cloneControls } from '../../src/core/types';
import { AH56_DEFINITION } from '../../src/aircraft/ah56';
import { AH56_HALF_P } from '../../src/aircraft/ah56/highSpeed';
import { ah56Loading } from '../../src/aircraft/ah56/mass';
import { createFlightModelFor } from '../../src/physics';
import type { BladeElementFlightModel } from '../../src/physics/flightModel';
import type { Rotorcraft } from '../../src/physics/rotorcraft/rotorcraft';
import type { GyroConfigId } from '../../src/physics/rotorcraft/controlGyro';
import { environment, gyroDef, report, writeTrace } from './ah56Rig';

const trace: Record<string, unknown> = {};
afterAll(() => writeTrace('ah56HalfP', trace));

const IN = 0.0254, DT = 1 / 240;
const H = AH56_HALF_P!;
const def = AH56_DEFINITION.rotorcraft!;

function rigAt(o: { cfg?: GyroConfigId; kt?: number; force?: boolean } = {}) {
  const fm = createFlightModelFor(AH56_DEFINITION) as BladeElementFlightModel, env = environment(0);
  fm.setLoading(ah56Loading(18_300, undefined, 1));
  const rotor = (fm as unknown as { rotorcraft: Rotorcraft }).rotorcraft, kt = o.kt ?? 160;
  rotor.gyro!.setAirData({ hub: { x: kt * KT, y: 0, z: 0 }, density: env.atmosphere().density });
  fm.reset({ position: { x: 0, y: 0, z: -460 }, heading: 0, airspeed: kt * KT, flightPathAngle: 0, onGround: false, engineRunning: true,
    fuelFraction: 1, rotorcraftConfig: o.cfg ?? 'ics', gearDown: false, ...(o.force ? { forceHalfPHop: true } : {}) }, env);
  return { fm, rotor, env, c: cloneControls(fm.trimControls), cfg: o.cfg ?? 'ics' as GyroConfigId };
}
type Rig = ReturnType<typeof rigAt>;
interface Sample { t: number; amplitude: number; active: boolean; phase: number; p: number; roll: number; nz: number; strike: boolean }
/** Fly `seconds` with the stick at trim + script(t) inches (lateral right +, longitudinal aft +); null = hands still at trim. */
function fly(r: Rig, seconds: number, script: (t: number) => [number, number] | null) {
  const travel = gyroDef.configs[r.cfg].stickTravel, e0 = r.c.elevator, a0 = r.c.aileron, rc = r.fm.state.rotorcraft!;
  const log: Sample[] = [];
  let onset: number | undefined, strike: number | undefined;
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) {
    const t = i * DT, s = script(t), st = r.fm.state;
    r.c.aileron = a0 + (s ? s[0] * IN / travel.lateral : 0);
    r.c.elevator = e0 + (s ? s[1] * IN / travel.longitudinal : 0);
    r.rotor.gyro!.setAirData({ hub: quat.rotateInv(st.orientation, st.velocity), density: r.env.atmosphere().density });
    r.fm.step(DT, r.c, r.env);
    const e = rc.events!.halfPHop!;
    if (onset === undefined && e.active) onset = t + DT;
    if (strike === undefined && e.strike) strike = t + DT;
    log.push({ t: t + DT, amplitude: e.amplitude, active: e.active, phase: e.phase, p: st.angularVelocity.x / DEG, roll: st.roll / DEG, nz: st.gLoad, strike: e.strike });
  }
  return { log, onset, strike, crash: (r.fm as unknown as { crashReason: string }).crashReason };
}
/** A circular stir of `radius` inches at `hz`, faded in over 0.25 s from the trim point. */
const stir = (radius: number, hz: number, until = Infinity) => (t: number): [number, number] | null => {
  if (t >= until) return null;
  const k = radius * Math.min(1, t / 0.25);
  return [k * Math.sin(2 * Math.PI * hz * t), k * Math.cos(2 * Math.PI * hz * t)];
};
/** The amplitude of a logged quantity at the forcing frequency (projection on the forcing phase) over [t0, t1). */
function atForcing(log: Sample[], t0: number, t1: number, key: 'roll' | 'nz' | 'p') {
  const w = log.filter((l) => l.t >= t0 && l.t < t1), mean = w.reduce((x, l) => x + l[key], 0) / w.length;
  const s = w.reduce((x, l) => x + (l[key] - mean) * Math.sin(l.phase), 0) / w.length, c = w.reduce((x, l) => x + (l[key] - mean) * Math.cos(l.phase), 0) / w.length;
  return 2 * Math.hypot(s, c);
}

let stirRun: ReturnType<typeof fly> | undefined;
describe('H7: the half-P hop (ICS only; P frequency and stir limit, ESTIMATE amplitudes and times)', () => {
  it('3 cycles of 0.8 in circular stirs at 1.0 Hz at 160 KCAS: active within 2 cycles of the third', () => {
    const r = rigAt();
    expect(r.fm.lastTrim!.converged).toBe(true);
    const coll = def.main.minPitch + (r.c.collective ?? 0) * (def.main.maxPitch - def.main.minPitch);
    stirRun = fly(r, 14, stir(0.8, 1.0));
    report('H7 stir trigger', { onsetS: stirRun.onset ?? 'none', collectiveDeg: coll / DEG, maxCollectiveDeg: H.trigger.maxCollective / DEG,
      kcas: r.fm.state.ias / KT, target: 'active within 2 cycles after 3 cycles (3-5 s)' });
    trace.stirTrigger = { onset: stirRun.onset, collective: coll / DEG };
    expect(coll).toBeLessThanOrEqual(H.trigger.maxCollective);
    expect(stirRun.onset).toBeDefined();
    expect(stirRun.onset!).toBeGreaterThanOrEqual(2.9); expect(stirRun.onset!).toBeLessThanOrEqual(5);
  }, 300_000);
  it('the forcing frequency is 0.5 P: 2.05 Hz +/- 2 %; the onset cue is about +/-3 deg of roll and +/-0.15 g (ESTIMATE)', () => {
    const { log, onset } = stirRun!;
    const w = log.filter((l) => l.t >= onset! && l.t < onset! + 3);
    const hz = (w[w.length - 1].phase - w[0].phase) / (w[w.length - 1].t - w[0].t) / (2 * Math.PI);
    const roll = atForcing(log, onset! + 1.2, onset! + 3, 'roll'), nz = atForcing(log, onset! + 1.2, onset! + 3, 'nz');
    report('H7 frequency and cue', { hz, rollAmplitudeDeg: roll, nzAmplitudeG: nz, target: '2.05 Hz +/- 2 % (P); +/-3 deg, +/-0.15 g (ESTIMATE)' });
    trace.cue = { hz, roll, nz };
    expect(Math.abs(hz / 2.05 - 1)).toBeLessThanOrEqual(0.02);
    expect(roll).toBeGreaterThan(2.4); expect(roll).toBeLessThan(3.6);
    expect(nz).toBeGreaterThan(0.1); expect(nz).toBeLessThan(0.25);
  });
  it('the cue runs >= 3 s before growth can strike; continued stirring strikes in 4-10 s ("Main rotor struck the fuselage (half-P hop)")', () => {
    const { log, onset, strike, crash } = stirRun!;
    const cue = log.filter((l) => l.t > onset! && l.t < onset! + H.cueSeconds);
    report('H7 growth and strike', { strikeAfterOnsetS: strike !== undefined ? strike - onset! : 'none', maxAmplitudeInCue: Math.max(...cue.map((l) => l.amplitude)),
      crash, target: 'strike 4-10 s after onset; cue >= 3 s' });
    trace.strike = { onset, strike, crash };
    expect(Math.max(...cue.map((l) => l.amplitude))).toBeLessThanOrEqual(1);
    expect(strike).toBeDefined();
    expect(strike! - onset!).toBeGreaterThanOrEqual(4); expect(strike! - onset!).toBeLessThanOrEqual(10);
    expect(crash).toBe('Main rotor struck the fuselage (half-P hop)');
  });
  it('hands still after the onset: the amplitude halves within 3 s and the event ends', () => {
    const r = rigAt(), release = 4.0;
    const run = fly(r, 14, stir(0.8, 1.0, release));
    const half = run.log.find((l) => l.t > release && l.amplitude <= 0.5);
    const end = run.log.find((l) => l.t > release && !l.active);
    report('H7 hands still', { onsetS: run.onset ?? 'none', releaseS: release, halfAfterReleaseS: half ? half.t - release : 'never',
      endsAfterReleaseS: end ? end.t - release : 'never', target: 'halves in <= 3 s' });
    trace.handsStill = { onset: run.onset, half: half?.t, end: end?.t };
    expect(run.onset).toBeDefined(); expect(run.onset!).toBeLessThan(release);
    expect(half).toBeDefined(); expect(half!.t - release).toBeLessThanOrEqual(3);
    expect(end).toBeDefined(); expect(run.strike).toBeUndefined(); expect(run.crash).toBe('');
  }, 300_000);
  it('negatives: a single 2 cps stir, single-axis 0.6 in lateral reversals before 4 cycles, AMCS, below 150 KCAS', () => {
    const single = fly(rigAt(), 8, stir(0.8, 2.0, 0.5));
    const doublet = fly(rigAt(), 8, (t) => [0.6 * Math.sin(2 * Math.PI * t), 0]);
    const amcs = fly(rigAt({ cfg: 'amcs' }), 12, stir(0.8, 1.0));
    const slow = fly(rigAt({ kt: 135 }), 8, stir(0.8, 1.0));
    report('H7 negatives', { singleStir: single.onset ?? 'none', lateralReversalsOnsetS: doublet.onset ?? 'none', amcs: amcs.onset ?? 'none',
      kcas135: slow.onset ?? 'none', target: 'none; reversals not before 4 cycles (4 s)' });
    trace.negatives = { single: single.onset, doublet: doublet.onset, amcs: amcs.onset, slow: slow.onset };
    expect(single.onset).toBeUndefined();
    if (doublet.onset !== undefined) expect(doublet.onset).toBeGreaterThanOrEqual(4);
    expect(amcs.onset).toBeUndefined(); expect(amcs.log.every((l) => l.amplitude === 0)).toBe(true);
    expect(slow.onset).toBeUndefined();
  }, 300_000);
  it('ordinary mouse corrections (random single-axis 0.3-0.6 in at 0.3-1 Hz for 60 s at 160 KCAS): none', () => {
    // A seeded generator: half-cycles on a random axis with a random amplitude and frequency.
    let seed = 20261021;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
    const segments: { t0: number; t1: number; axis: number; amp: number; sign: number }[] = [];
    for (let t = 0, sign = 1; t < 60; sign = -sign) {
      const hz = 0.3 + 0.7 * rnd(), half = 0.5 / hz;
      segments.push({ t0: t, t1: t + half, axis: rnd() < 0.5 ? 0 : 1, amp: 0.3 + 0.3 * rnd(), sign });
      t += half;
    }
    let k = 0;
    const run = fly(rigAt(), 60, (t) => {
      while (k < segments.length - 1 && t >= segments[k].t1) k++;
      const s = segments[k], v = s.sign * s.amp * Math.sin(Math.PI * (t - s.t0) / (s.t1 - s.t0));
      return s.axis === 0 ? [v, 0] : [0, v];
    });
    report('H7 mouse corrections', { onsetS: run.onset ?? 'none', segments: segments.length, target: 'none' });
    trace.mouse = { onset: run.onset, segments: segments.length };
    expect(run.onset).toBeUndefined();
  }, 600_000);
  it('the forcing phase is perRev x the rotor\'s unwrapped azimuth: continuous over 10 revolutions (no flip per revolution)', () => {
    const r = rigAt({ force: true }), rc = r.fm.state.rotorcraft!;
    // The event's clock starts with the flight's (BodyState.time > 0): two steps in, then the phase follows the azimuth.
    for (let i = 0; i < 2; i++) r.fm.step(DT, r.c, r.env);
    let unwrapped = 0, last = rc.azimuth, worst = 0, prevPhase = rc.events!.halfPHop!.phase, prevSin = Math.sin(prevPhase), jump = 0;
    const phase0 = prevPhase;
    for (let i = 0; i < Math.round(10 * 60 / 246 / DT); i++) {
      r.fm.step(DT, r.c, r.env);
      const az = rc.azimuth, d = Math.atan2(Math.sin(az - last), Math.cos(az - last));
      unwrapped += Math.abs(d); last = az;
      const ph = rc.events!.halfPHop!.phase;
      worst = Math.max(worst, Math.abs(ph - phase0 - H.perRev * unwrapped));
      jump = Math.max(jump, Math.abs(Math.sin(ph) - prevSin));
      prevSin = Math.sin(ph); prevPhase = ph;
    }
    report('H7 phase', { revolutions: unwrapped / (2 * Math.PI), maxPhaseError: worst, maxSinStep: jump, target: 'continuous' });
    trace.phase = { revolutions: unwrapped / (2 * Math.PI), worst, jump };
    expect(unwrapped / (2 * Math.PI)).toBeGreaterThan(9.9);
    expect(worst).toBeLessThan(1e-9);
    // 0.5 x 25.76 rad/s / 240 Hz = 0.054 rad per step: no step of sin(phase) larger than that.
    expect(jump).toBeLessThan(0.06);
  });
  it('save and restore: the phase continues, the amplitude keeps its saved value and decays, halfp=1 does not re-arm it', () => {
    // A: a forced event, 1 s hands off. B: a new flight with halfp=1 restored from A's snapshot the way SimPhysics does it.
    const a = rigAt({ force: true });
    for (let i = 0; i < 240; i++) a.fm.step(DT, a.c, a.env);
    const sys = a.fm.captureSystems(), st = a.fm.state, saved = { ...st.rotorcraft!.events!.halfPHop! };
    const b = rigAt({ force: true });
    b.fm.restoreSystems(sys, b.c, 0.5 * st.airDensity * st.tas * st.tas);
    b.fm.setClock(st.time);
    b.fm.setKinematics({ position: { ...st.position }, orientation: { ...st.orientation }, velocity: { ...st.velocity }, angularVelocity: { ...st.angularVelocity } });
    const ea = a.fm.state.rotorcraft!.events!.halfPHop!, eb = b.fm.state.rotorcraft!.events!.halfPHop!;
    expect(eb.phase).toBe(saved.phase); expect(eb.amplitude).toBe(saved.amplitude);
    let worstPhase = 0;
    for (let i = 0; i < 240; i++) {
      a.fm.step(DT, a.c, a.env); b.fm.step(DT, b.c, b.env);
      worstPhase = Math.max(worstPhase, Math.abs(ea.phase - eb.phase));
    }
    report('H7 restore', { savedPhase: saved.phase, savedAmplitude: saved.amplitude, phaseGapAfter1s: worstPhase, amplitudeA: ea.amplitude,
      amplitudeB: eb.amplitude, activeB: eb.active });
    trace.restore = { saved, worstPhase, a: ea.amplitude, b: eb.amplitude };
    expect(saved.active).toBe(true);
    // The restored flight's first step is on the flight clock (setClock) and takes the rotor's turn: no step of the phase (0.054 rad)
    // is lost. What remains is the two flights' own drift: B's private onset fade restarts, so its body motion and rotor speed
    // differ slightly from A's.
    expect(worstPhase).toBeLessThan(0.02);
    // Decaying from the saved amplitude (hands off), not restarted at 1.
    expect(eb.amplitude).toBeLessThan(saved.amplitude);
    expect(Math.abs(eb.amplitude - ea.amplitude)).toBeLessThan(0.05);
  });
  it('halfp=1 (InitialConditions.forceHalfPHop) starts the event at the first clocked step, ICS only, and leaves the trim unchanged', () => {
    const plain = rigAt(), forced = rigAt({ force: true }), amcs = rigAt({ cfg: 'amcs', force: true });
    expect(forced.fm.lastTrim!.pitch).toBe(plain.fm.lastTrim!.pitch);
    expect(forced.fm.lastTrim!.aileron).toBe(plain.fm.lastTrim!.aileron);
    expect(forced.fm.state.rotorcraft!.events!.halfPHop!.active).toBe(false);
    for (let i = 0; i < 4; i++) { forced.fm.step(DT, forced.c, forced.env); amcs.fm.step(DT, amcs.c, amcs.env); }
    expect(forced.fm.state.rotorcraft!.events!.halfPHop!.active).toBe(true);
    expect(amcs.fm.state.rotorcraft!.events!.halfPHop!.active).toBe(false);
  });
  it('halfp=1 waits for flight: no forcing in an ICS hover (rotor at speed, below 60 KCAS)', () => {
    const hover = rigAt({ kt: 0, force: true }), e = hover.fm.state.rotorcraft!.events!.halfPHop!;
    let worstRoll = 0;
    for (let i = 0; i < 480; i++) { hover.fm.step(DT, hover.c, hover.env); worstRoll = Math.max(worstRoll, Math.abs(hover.fm.state.roll / DEG)); }
    report('H7 halfp=1 in the hover', { active: e.active, amplitude: e.amplitude, rotorRpm: hover.fm.state.rotorcraft!.rotorRpm, maxRollDeg: worstRoll,
      target: 'not active below 60 KCAS' });
    expect(e.active).toBe(false); expect(e.amplitude).toBe(0);
    expect(hover.fm.state.rotorcraft!.rotorRpm).toBeGreaterThan(0.9 * 246);
  });
});
