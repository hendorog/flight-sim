// AH-56A control gyro (AG, plan revision 2 section 7.2): the gyro block alone (G1), on a fixed shaft with the real rotor
// (G3 auto-trim, G4 steady hub moment per inch), the AMCS cyclic authority (G5a), and the contracts RC and the exteriors
// read (cyclic() is gyroBladeCyclic(state), the mode is read on every call, the exact step, the stops, the augmentation).
// Numbers are logged with their targets ([ah56] lines); docs/control-gyro-model.md has the derivations.
import { describe, expect, it } from 'vitest';
import { AH56_ROTORCRAFT } from '../../src/aircraft/ah56/rotorcraft';
import { AH56_DEFINITION } from '../../src/aircraft/ah56';
import { ControlGyro, DROOP_SENSE, expm, featheringMoment, gyroBladeCyclic, lookup, type ControlGyroConfig, type FlapSystem,
  type GyroBladeMoments, type GyroConfigId } from '../../src/physics/rotorcraft/controlGyro';
import { swashplateCyclic } from '../../src/physics/rotorcraft/swashplate';
import { Rotorcraft } from '../../src/physics/rotorcraft/rotorcraft';
import type { RotorcraftDefinition, RotorcraftState } from '../../src/physics/rotorcraft/definition';
import { cloneControls, defaultControls } from '../../src/core/types';
import { DEG, KT, quat, v3 } from '../../src/core/math';
import { DT, IN, gyroOf, report, rig, run, stick } from './ah56Rig';

const FT_LB = 1.3558179483314004;
const ics = AH56_ROTORCRAFT.controlGyro!.configs.ics, amcs = AH56_ROTORCRAFT.controlGyro!.configs.amcs;

/** The definition with one configuration patched. */
function patched(cfg: GyroConfigId, patch: Partial<ControlGyroConfig>, base: RotorcraftDefinition = AH56_ROTORCRAFT): RotorcraftDefinition {
  const g = base.controlGyro!;
  return { ...base, controlGyro: { ...g, configs: { ...g.configs, [cfg]: { ...g.configs[cfg], ...patch } } } };
}
/** The rotor on the stage-5 section with its stall removed (Cl max 9 at every Mach number): a DIAGNOSTIC only. G3 and G5a assert on
 *  the flown section at a collective where no element stalls (stalledFraction 0); at 10.5-11.2 deg (level at 100 KTAS; the hover
 *  with full aft stick) the stage-5 section stalls part of the disc and stalled elements do not answer the cyclic (reported beside). */
const SECTION = AH56_ROTORCRAFT.main.section;
const NO_STALL: RotorcraftDefinition = SECTION?.polar ? { ...AH56_ROTORCRAFT, main: { ...AH56_ROTORCRAFT.main, section: { ...SECTION,
  polar: { ...SECTION.polar, clMax: { ...SECTION.polar.clMax, value: SECTION.polar.clMax.value.map(() => 9) } } } } } : AH56_ROTORCRAFT;
const controls = () => cloneControls(defaultControls(AH56_DEFINITION));

describe('the gyro block alone (G1: ICS, feedback off, rotor locked)', () => {
  // A gyro on a spinning shaft with the flap held (no feedback): a stable flap system that never moves and no hub moment.
  const LOCKED: FlapSystem = { a: [-50, 0, 0, -50], f: [0, 0], b: [0, 0, 0, 0], theta0: [0, 0], hub: [0, 0, 0, 0] };
  function block(cfg: ControlGyroConfig) {
    const def = patched('ics', cfg);
    const state = { omega: 246 * Math.PI / 30 } as RotorcraftState;
    const g = new ControlGyro(def, state);
    g.reset(true, 'ics');
    return { g, state };
  }
  // Rotor locked: no feathering motion, so no feathering friction (the rotating damping); no augmentation.
  const noFriction: ControlGyroConfig = { ...ics, rotatingDamping: 0, augmentation: undefined };
  const H = ics.inertia * 246 * Math.PI / 30;

  for (const axis of ['lon', 'lat'] as const) it(`${axis}: initial precession M/H, precession rate K/H about the centre M/K`, () => {
    const { g, state } = block(noFriction);
    const c = controls();
    const perInch = axis === 'lon' ? 278 * FT_LB : 337 * FT_LB;
    if (axis === 'lon') c.elevator = IN / ics.stickTravel.longitudinal; else c.aileron = IN / ics.stickTravel.lateral;
    const path: { roll: number; pitch: number }[] = [];
    for (let i = 0; i < 240 * 2; i++) {
      g.advanceCoupled(DT, c, v3.zero(), LOCKED, { cosine: 0, sine: 0 });
      path.push({ roll: state.controlGyro!.roll, pitch: state.controlGyro!.pitch });
    }
    const initial = Math.hypot(path[0].roll, path[0].pitch) / DT / DEG;
    // The trajectory is a circle through the origin about the centre M/K; fit the centre as the mean over whole turns.
    const period = 2 * Math.PI * H / ics.spring, n = Math.round(period / DT);
    const centre = path.slice(0, n).reduce((s, p) => ({ roll: s.roll + p.roll / n, pitch: s.pitch + p.pitch / n }), { roll: 0, pitch: 0 });
    const centreDeg = Math.hypot(centre.roll, centre.pitch) / DEG;
    // Angle swept about the centre in the first quarter period, against K/H.
    const k = Math.round(period / 4 / DT);
    const a0 = Math.atan2(-centre.pitch, -centre.roll), a1 = Math.atan2(path[k].pitch - centre.pitch, path[k].roll - centre.roll);
    const swept = Math.abs(Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)));
    const rate = swept / (k * DT);
    report(`G1 ${axis}`, { initialDegPerSecPerIn: initial, target: perInch / H / DEG, precessionRadPerSec: rate, K_over_H: ics.spring / H,
      timeConstantH_over_K: H / ics.spring, centreDegPerIn: centreDeg, targetCentre: perInch / ics.spring / DEG });
    // D from ASTA-72 App C: 13.7 (long) / 16.7 (lat) deg/s per inch; H/K = 0.283 s; M/K = 3.9 / 4.7 deg/in.
    expect(initial).toBeCloseTo(perInch / H / DEG, 0);
    expect(initial).toBeGreaterThan((axis === 'lon' ? 13.7 : 16.7) * 0.95);
    expect(initial).toBeLessThan((axis === 'lon' ? 13.7 : 16.7) * 1.05);
    expect(rate * H / ics.spring).toBeGreaterThan(0.95);
    expect(rate * H / ics.spring).toBeLessThan(1.05);
    expect(H / ics.spring).toBeCloseTo(0.283, 2);
    expect(centreDeg).toBeGreaterThan((axis === 'lon' ? 3.9 : 4.7) * 0.95);
    expect(centreDeg).toBeLessThan((axis === 'lon' ? 3.9 : 4.7) * 1.05);
  });

  it('clamps at the +/-15 deg stops with no wind-up', () => {
    const { g, state } = block(noFriction);
    const c = controls();
    c.elevator = 1; c.aileron = 1;
    let maxPitch = 0, maxRoll = 0;
    for (let i = 0; i < 240 * 3; i++) {
      g.advanceCoupled(DT, c, v3.zero(), LOCKED, { cosine: 0, sine: 0 });
      maxPitch = Math.max(maxPitch, Math.abs(state.controlGyro!.pitch)); maxRoll = Math.max(maxRoll, Math.abs(state.controlGyro!.roll));
    }
    report('G1 clamp', { maxPitchDeg: maxPitch / DEG, maxRollDeg: maxRoll / DEG, stopDeg: 15 });
    expect(maxPitch).toBeLessThanOrEqual(15 * DEG + 1e-12);
    expect(maxRoll).toBeLessThanOrEqual(15 * DEG + 1e-12);
    // No wind-up: releasing the stick, the tilt leaves the stop on the very next steps (it is the only state).
    c.elevator = 0; c.aileron = 0;
    const before = { ...state.controlGyro! };
    for (let i = 0; i < 24; i++) g.advanceCoupled(DT, c, v3.zero(), LOCKED, { cosine: 0, sine: 0 });
    expect(Math.hypot(state.controlGyro!.pitch - before.pitch, state.controlGyro!.roll - before.roll)).toBeGreaterThan(0.5 * DEG);
  });

  it('a damper on the rotating gimbal aligns the gyro with the shaft (Hohenemser 1/tau; C_R sign)', () => {
    const { g, state } = block({ ...noFriction, spring: 0, damping: 1e-6, rotatingDamping: 20 });
    state.controlGyro!.pitch = 5 * DEG; state.controlGyro!.roll = 2 * DEG;
    const c = controls();
    let last = Math.hypot(5, 2) * DEG, monotone = true;
    for (let i = 0; i < 240 * 4; i++) {
      g.advanceCoupled(DT, c, v3.zero(), LOCKED, { cosine: 0, sine: 0 });
      const now = Math.hypot(state.controlGyro!.pitch, state.controlGyro!.roll);
      if (now > last + 1e-15) monotone = false;
      last = now;
    }
    // Decay rate C_R / I_g with the gyro spinning with the shaft.
    const expected = Math.hypot(5, 2) * DEG * Math.exp(-20 / ics.inertia * 4);
    report('C_R alignment', { tiltAfter4sDeg: last / DEG, expectedDeg: expected / DEG });
    expect(monotone).toBe(true);
    expect(last).toBeCloseTo(expected, 4);
  });
});

/** A rotor alone on a fixed shaft (no airframe): settle at a speed, then step. */
function fixedShaft(def: RotorcraftDefinition, cfg: GyroConfigId, kt: number, collective = 0.62) {
  const rc = new Rotorcraft(def);
  rc.reset(true, cfg);
  const c = controls(); c.collective = collective;
  const b = { time: 0, position: { x: 0, y: 0, z: -1000 }, orientation: quat.fromEuler(0, 0, 0), velocityBody: { x: kt * KT, y: 0, z: 0 },
    angularVelocity: v3.zero(), cgOffset: v3.zero(), mass: 8301 };
  rc.settle(b, v3.zero(), 1.225, 1000, c);
  for (let i = 0; i < 240; i++) rc.compute(b, v3.zero(), 1.225, 1000, c, DT);
  return { rc, c, b };
}
/** Shaft hub moment, N m (RC's hingeMoment through the flap harmonics). */
function hubMoment(rc: Rotorcraft): { x: number; y: number } {
  let k = 0;
  const g = rc.gyro!;
  const orig = g.advanceCoupled.bind(g);
  (g as unknown as { advanceCoupled: typeof orig }).advanceCoupled = (dt, c, rate, s, f, bl, air) => { k = s.hub[1]; return orig(dt, c, rate, s, f, bl, air); };
  return { get x() { return k * rc.state.flapRight; }, get y() { return k * -rc.state.flapForward; } } as { x: number; y: number };
}

describe('the gyro on the AH-56A rotor, fixed shaft', () => {
  it('G3 auto-trim: a 3 m/s vertical gust at 100 KTAS, stick centred (ICS; the flown section, at a collective where no element stalls)', () => {
    const icsFeedback = ics.feedback as Extract<ControlGyroConfig['feedback'], { mode: 'featheringMoment' }>;
    const runAll = (base: RotorcraftDefinition, collective: number) => {
    const lockedDef = patched('ics', { inertia: ics.inertia * 1e6 }, base);
    const clean = patched('ics', { feedback: { ...icsFeedback, droop: 0, pitchingMomentGain: 0, frictionMoment: 0 } }, base);
    const result: Record<string, number[]> = {};
    let stalled = 0;
    for (const [name, def] of [['locked', lockedDef], ['ics', base], ['clean', clean]] as const) {
      const { rc, c, b } = fixedShaft(def, 'ics', 100, collective);
      const h = hubMoment(rc);
      rc.compute(b, v3.zero(), 1.225, 1000, c, DT);
      const h0 = { x: h.x, y: h.y };
      const series: number[] = [];
      for (let i = 1; i <= 240; i++) {
        rc.compute(b, { x: 0, y: 0, z: -3 }, 1.225, 1000, c, DT);
        series.push(Math.hypot(h.x - h0.x, h.y - h0.y));
        stalled = Math.max(stalled, rc.state.stalledFraction);
      }
      result[name] = series;
    }
    return { ...result, stalled } as Record<string, number[]> & { stalled: number };
    };
    // The flown section (AH56_ROTORCRAFT) at the highest collective, in 0.04 steps down from the level-flight 0.62, where its stall
    // takes no part: the locked-gyro gust response (the rotor's own aerodynamics) equals the section-without-stall's within 1 % at
    // every sample. (RotorcraftState.stalledFraction counts the attached-slope measure, which the reverse-flow region at 100 KTAS
    // always trips, so it cannot say this.) The section without stall at 0.62 stays a diagnostic.
    const sameAero = (a: Record<string, number[]>, b: Record<string, number[]>) =>
      a.locked.every((x, i) => Math.abs(x - b.locked[i]) <= 0.01 * b.locked[239]);
    let collective = 0.62, flown = runAll(AH56_ROTORCRAFT, collective), reference = runAll(NO_STALL, collective);
    while (!sameAero(flown, reference) && collective > 0.2) {
      collective = +(collective - 0.04).toFixed(2); flown = runAll(AH56_ROTORCRAFT, collective); reference = runAll(NO_STALL, collective);
    }
    const noStall = runAll(NO_STALL, 0.62), stalling = runAll(AH56_ROTORCRAFT, 0.62);
    const ratio = (r: Record<string, number[]>, name: string, t: number) => r[name][Math.round(t / DT) - 1] / r.locked[239];
    report('G3 gust 100 KTAS', { collective, collective075Deg: (AH56_ROTORCRAFT.main.minPitch + collective * (AH56_ROTORCRAFT.main.maxPitch -
      AH56_ROTORCRAFT.main.minPitch)) / DEG, lockedKNm: flown.locked[239] / 1e3,
      cleanAt0_2s: ratio(flown, 'clean', 0.2), cleanAt0_5s: ratio(flown, 'clean', 0.5), icsAt0_5s: ratio(flown, 'ics', 0.5),
      icsAt1s: ratio(flown, 'ics', 1), target: '< 0.10 within 0.5 s',
      noStallAt062CleanAt0_5s: ratio(noStall, 'clean', 0.5), at062StalledFraction: stalling.stalled, at062CleanAt0_5s: ratio(stalling, 'clean', 0.5) });
    expect(sameAero(flown, reference)).toBe(true);
    // The feathering-moment auto-trim (sweep x hub moment, CR-114362) trims the gust moment out within 0.5 s.
    expect(ratio(flown, 'clean', 0.5)).toBeLessThan(0.10);
  });

  it.fails('G3 KNOWN GAP: the full ICS feedback (droop x in-plane, Cm0) leaves most of the gust moment', () => {
    // The blade in-plane moments reach the gyro through the 3 deg 10 min droop (ASTA-72 App C; Hohenemser: "corrupted by
    // ... lead-lag moments"); the gust changes them, so the gyro's equilibrium hub moment moves with the gust.
    const lockedDef = patched('ics', { inertia: ics.inertia * 1e6 });
    const runGust = (def: RotorcraftDefinition) => {
      const { rc, c, b } = fixedShaft(def, 'ics', 100);
      const h = hubMoment(rc);
      rc.compute(b, v3.zero(), 1.225, 1000, c, DT);
      const h0 = { x: h.x, y: h.y };
      for (let i = 1; i <= 120; i++) rc.compute(b, { x: 0, y: 0, z: -3 }, 1.225, 1000, c, DT);
      return Math.hypot(h.x - h0.x, h.y - h0.y);
    };
    expect(runGust(AH56_ROTORCRAFT) / runGust(lockedDef)).toBeLessThan(0.10);
  });

  it('G4 steady hub moment per inch (ICS, hover): about M_stick / tan(sweep); the flap-frozen prediction is much larger', () => {
    const out: Record<string, number> = {};
    for (const axis of ['lon', 'lat'] as const) {
      const { rc, c, b } = fixedShaft(AH56_ROTORCRAFT, 'ics', 0);
      const h = hubMoment(rc);
      rc.compute(b, v3.zero(), 1.225, 1000, c, DT);
      const h0 = { x: h.x, y: h.y };
      if (axis === 'lon') c.elevator += IN / ics.stickTravel.longitudinal; else c.aileron += IN / ics.stickTravel.lateral;
      for (let i = 0; i < 240 * 3; i++) rc.compute(b, v3.zero(), 1.225, 1000, c, DT);
      const dm = Math.hypot(h.x - h0.x, h.y - h0.y);
      out[axis] = dm;
      // The flap-frozen prediction: the steady tilt without feedback (M/K) times the rotor's hub moment per rad of cyclic.
      const tiltDef = patched('ics', { inertia: ics.inertia * 1e6 });
      const t = fixedShaft(tiltDef, 'ics', 0), ht = hubMoment(t.rc);
      t.rc.compute(t.b, v3.zero(), 1.225, 1000, t.c, DT);
      const m0 = { x: ht.x, y: ht.y };
      t.rc.state.controlGyro!.pitch += 1 * DEG;
      for (let i = 0; i < 240 * 2; i++) t.rc.compute(t.b, v3.zero(), 1.225, 1000, t.c, DT);
      const perRad = Math.hypot(ht.x - m0.x, ht.y - m0.y) / DEG;
      const perInch = axis === 'lon' ? 278 * FT_LB : 337 * FT_LB;
      out[`${axis}Frozen`] = perInch / ics.spring * perRad;
    }
    report('G4 hub moment per inch (ICS hover)', { lonKNm: out.lon / 1e3, targetLon: 5.39, latKNm: out.lat / 1e3, targetLat: 6.54,
      frozenLonKNm: out.lonFrozen / 1e3, frozenLatKNm: out.latFrozen / 1e3, frozenRatioLon: out.lonFrozen / out.lon });
    expect(out.lon / 1e3).toBeGreaterThan(5.39 * 0.8); expect(out.lon / 1e3).toBeLessThan(5.39 * 1.2);
    expect(out.lat / 1e3).toBeGreaterThan(6.54 * 0.8); expect(out.lat / 1e3).toBeLessThan(6.54 * 1.2);
    expect(out.lonFrozen / out.lon).toBeGreaterThanOrEqual(5);
    expect(out.latFrozen / out.lat).toBeGreaterThanOrEqual(5);
  });
});

describe('the AMCS cyclic authority (G5a)', () => {
  it('the labelled stops give at least +/-8 deg of blade cyclic (SSL gain 1); full stick commands flap, not the stop', () => {
    const s = amcs.maxTilt;
    const cyclic = { up: amcs.cyclicPerTilt * s.up, down: amcs.cyclicPerTilt * s.down, left: amcs.cyclicPerTilt * s.left, right: amcs.cyclicPerTilt * s.right };
    for (const v of Object.values(cyclic)) expect(v).toBeGreaterThanOrEqual(8 * DEG);
    // On a fixed shaft full stick is balanced by the flapping feedback (K_R x flap = the stick moment): the gyro settles
    // inside its stops with the full-stick hub moment, so the stops never cut the pilot's authority.
    // Asserted on the flown section at the highest hover collective (0.04 steps down from 0.62) at which its stall takes no part in
    // the full-aft step (the gyro pitch equals the section-without-stall's within 2 %); at 0.62 full aft stick stalls part of the disc
    // and the flap stops short of the stick moment / K_R (reported, with the section without stall at 0.62 as the diagnostic).
    const fullAft = (def: RotorcraftDefinition, collective: number) => {
      const { rc, c, b } = fixedShaft(def, 'amcs', 0, collective);
      const h = hubMoment(rc);
      rc.compute(b, v3.zero(), 1.225, 1000, c, DT);
      const h0 = { x: h.x, y: h.y };
      c.elevator = 1;
      let stalled = 0;
      for (let i = 0; i < 240 * 2; i++) { rc.compute(b, v3.zero(), 1.225, 1000, c, DT); stalled = Math.max(stalled, rc.state.stalledFraction); }
      return { rc, h, h0, stalled };
    };
    const samePitch = (a: Rotorcraft, b: Rotorcraft) => Math.abs(a.state.controlGyro!.pitch / b.state.controlGyro!.pitch - 1) <= 0.02;
    let collective = 0.62, flown = fullAft(AH56_ROTORCRAFT, collective), reference = fullAft(NO_STALL, collective);
    while (!samePitch(flown.rc, reference.rc) && collective > 0.2) {
      collective = +(collective - 0.04).toFixed(2); flown = fullAft(AH56_ROTORCRAFT, collective); reference = fullAft(NO_STALL, collective);
    }
    const { rc, h, h0 } = flown, noStall = fullAft(NO_STALL, 0.62).rc.state, stalling = fullAft(AH56_ROTORCRAFT, 0.62);
    const g = rc.state.controlGyro!;
    report('G5a AMCS authority', { upDeg: cyclic.up / DEG, downDeg: cyclic.down / DEG, leftDeg: cyclic.left / DEG, rightDeg: cyclic.right / DEG,
      required: 8, collective, noStallGyroPitchDeg: reference.rc.state.controlGyro!.pitch / DEG, fullAftGyroPitchDeg: g.pitch / DEG,
      fullAftHubMomentKNm: Math.hypot(h.x - h0.x, h.y - h0.y) / 1e3, flapDeg: Math.hypot(rc.state.flapForward, rc.state.flapRight) / DEG,
      stickMomentOverKR_deg: amcs.stickMoment.longitudinal / (amcs.feedback as { gain: number }).gain / DEG,
      noStallAt062GyroPitchDeg: noStall.controlGyro!.pitch / DEG,
      at062GyroPitchDeg: stalling.rc.state.controlGyro!.pitch / DEG, at062FlapDeg: Math.hypot(stalling.rc.state.flapForward, stalling.rc.state.flapRight) / DEG });
    expect(samePitch(flown.rc, reference.rc)).toBe(true);
    expect(g.pitch).toBeLessThan(s.up);
  });

  it('the highest stage-2 trims sit inside the stops (150 KCAS; 180 KCAS is the compound\'s, stage 4 C18)', () => {
    for (const cfg of ['amcs', 'ics'] as const) {
      const r = rig({ cfg, kt: 150 });
      const g = r.fm.state.rotorcraft!.controlGyro!, t = AH56_ROTORCRAFT.controlGyro!.configs[cfg].maxTilt;
      report(`G5a trim 150 KCAS ${cfg}`, { converged: r.fm.lastTrim!.converged, gyroPitchDeg: g.pitch / DEG, gyroRollDeg: g.roll / DEG,
        upDeg: t.up / DEG, downDeg: t.down / DEG, leftDeg: t.left / DEG, rightDeg: t.right / DEG });
      expect(r.fm.lastTrim!.converged).toBe(true);
      expect(g.pitch).toBeLessThan(t.up); expect(g.pitch).toBeGreaterThan(-t.down);
      expect(g.roll).toBeLessThan(t.right); expect(g.roll).toBeGreaterThan(-t.left);
    }
  });
});

describe('contracts', () => {
  it('cyclic() is gyroBladeCyclic(state) and swashplateCyclic agrees (RC contract request)', () => {
    const r = rig({ cfg: 'ics', kt: 60 });
    r.c.elevator += stick(r, 'lon', 1);
    run(r, 0.5);
    const s = r.fm.state.rotorcraft!, g = gyroOf(r);
    expect(g.cyclic(r.c)).toEqual(gyroBladeCyclic(AH56_ROTORCRAFT, s.controlGyro!));
    expect(swashplateCyclic(AH56_ROTORCRAFT, r.c, s)).toEqual(g.cyclic(r.c));
  });

  it('reads the configuration from state on every call (a restore that changes the mode takes effect)', () => {
    const state = { omega: 25 } as RotorcraftState;
    const g = new ControlGyro(AH56_ROTORCRAFT, state);
    g.reset(true, 'amcs');
    expect(g.config()).toBe(amcs);
    state.controlGyro!.mode = 'ics';
    expect(g.config()).toBe(ics);
  });

  it('dt = 0 is pure: the state and the returned harmonics are untouched', () => {
    const state = { omega: 25 } as RotorcraftState;
    const g = new ControlGyro(AH56_ROTORCRAFT, state);
    g.reset(true, 'ics');
    state.controlGyro!.pitch = 0.01;
    const before = { ...state.controlGyro! };
    const sys: FlapSystem = { a: [-10, -3, 3, -10], f: [0.1, 0.2], b: [5, 1, -1, 5], theta0: [0, 0], hub: [0, 7e5, 7e5, 0] };
    expect(g.advanceCoupled(0, controls(), v3.zero(), sys, { cosine: 0.3, sine: 0.4 })).toEqual({ cosine: 0.3, sine: 0.4 });
    expect(state.controlGyro).toEqual(before);
  });

  it('the exact step: one step equals ten tenth-steps (no explicit coupling), and the exponential matches the analytic 2x2', () => {
    const sys: FlapSystem = { a: [-9.6, -3.4, 3.4, -9.6], f: [0.02, -0.01], b: [8, 2, -2, 8], theta0: [0, 0], hub: [0, 7.2e5, 7.2e5, 0] };
    // The AMCS (no Coulomb friction: the ICS's friction is taken from the last step's rate, an explicit term).
    const make = () => { const s = { omega: 25.11 } as RotorcraftState; const g = new ControlGyro(AH56_ROTORCRAFT, s); g.reset(true, 'amcs'); return { g, s }; };
    const c = controls(); c.elevator = 0.2;
    const one = make(), ten = make();
    const x1 = one.g.advanceCoupled(0.05, c, v3.zero(), sys, { cosine: 0, sine: 0 });
    let x = { cosine: 0, sine: 0 };
    for (let i = 0; i < 10; i++) x = ten.g.advanceCoupled(0.005, c, v3.zero(), sys, x);
    expect(x1.cosine).toBeCloseTo(x.cosine, 7); expect(x1.sine).toBeCloseTo(x.sine, 7);
    expect(one.s.controlGyro!.pitch).toBeCloseTo(ten.s.controlGyro!.pitch, 8);
    // expm against exp of a rotation-decay 2x2: [[-a, -w], [w, -a]] t.
    const a = 3, w = 20, t = 0.3, out = new Float64Array(4), scratch = [new Float64Array(4), new Float64Array(4), new Float64Array(4)];
    expm([-a * t, -w * t, w * t, -a * t], 2, out, scratch);
    const e = Math.exp(-a * t);
    expect(out[0]).toBeCloseTo(e * Math.cos(w * t), 12); expect(out[1]).toBeCloseTo(-e * Math.sin(w * t), 12);
  });

  it('the augmentation tables (unit level, through the explicit air data): ICS desensitizer halves the pitch moment at 170 KCAS within its authority', () => {
    const state = { omega: 25.76 } as RotorcraftState;
    const g = new ControlGyro(AH56_ROTORCRAFT, state);
    g.reset(true, 'ics');
    const sys: FlapSystem = { a: [-10, 0, 0, -10], f: [0, 0], b: [0, 0, 0, 0], theta0: [0, 0], hub: [0, 0, 0, 0] };
    const c = controls(); c.elevator = IN / ics.stickTravel.longitudinal;   // 1 in aft: inside the 0.757 in authority x 2
    const tiltRate = (kt: number) => {
      const lin = g.linearize(c, v3.zero(), sys, undefined, { hub: { x: kt * KT, y: 0, z: 0 }, density: 1.225 });
      return Math.hypot(lin.c[0], lin.c[1]);
    };
    const hover = tiltRate(0), at120 = tiltRate(120), at170 = tiltRate(170);
    report('G7b desensitizer (gyro block)', { at120OverHover: at120 / hover, at170OverHover: at170 / hover, expect120: lookup(ics.augmentation!.pitchDesensitizer!.gainByKcas, 120), expect170: 0.5 });
    expect(at170 / hover).toBeCloseTo(0.5, 2);
    expect(at120 / hover).toBeCloseTo(lookup(ics.augmentation!.pitchDesensitizer!.gainByKcas, 120), 2);
    // Without air data (today's production wiring): dormant.
    g.setAirData(null);
    const dormant = Math.hypot(...Array.from(g.linearize(c, v3.zero(), sys).c.slice(0, 2)) as [number, number]);
    expect(dormant).toBeCloseTo(hover, 9);
  });

  it('the ICS feathering feedback reads the blade moments RC returns (pitching moment and in-plane through the droop)', () => {
    const state = { omega: 25.76 } as RotorcraftState;
    const g = new ControlGyro(AH56_ROTORCRAFT, state);
    g.reset(true, 'ics');
    const sys: FlapSystem = { a: [-10, 0, 0, -10], f: [0, 0], b: [0, 0, 0, 0], theta0: [0, 0], hub: [0, 0, 0, 0] };
    const none = g.linearize(controls(), v3.zero(), sys).c;
    const blade: GyroBladeMoments = { pitching: { cos: 300, sin: 0 }, inPlane: { cos: 0, sin: 0 } };
    const withPm = g.linearize(controls(), v3.zero(), sys, blade).c;
    expect(Math.hypot(withPm[0] - none[0], withPm[1] - none[1])).toBeGreaterThan(0);
    // The AMCS's irreversible servos: no feathering-moment path.
    const sa = { omega: 25.11 } as RotorcraftState, ga = new ControlGyro(AH56_ROTORCRAFT, sa);
    ga.reset(true, 'amcs');
    expect(Array.from(ga.linearize(controls(), v3.zero(), sys, blade).c)).toEqual(Array.from(ga.linearize(controls(), v3.zero(), sys).c));
  });
});

describe('feathering-moment signs (ICS): one blade element against the geometry', () => {
  // Blade frame: r outboard along the feathering axis, t the direction of motion (leading edge), n = r x t up. A rotation
  // about +r turns t toward n: the leading edge up, NOSE UP. The feathering moment is the r component of P x F.
  const fb = ics.feedback as Extract<ControlGyroConfig['feedback'], { mode: 'featheringMoment' }>;
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const r = 5;

  it('forward sweep: lift ahead of the feathering axis is nose up, tan(sweep) per unit flap moment (CR-114362)', () => {
    const lift = 1000, P = [r, r * Math.tan(fb.sweep), 0], F = [0, 0, lift];
    const geometric = cross(P, F)[0], flapMoment = lift * r;
    expect(geometric).toBeGreaterThan(0);
    expect(featheringMoment({ ...fb, pitchingMomentGain: 0, droop: 0 }, flapMoment, 0, 0)).toBeCloseTo(geometric, 9);
  });

  it('the section pitching moment (cm0, + nose up) enters nose up at gain 1 (INF Hoh-74: "the entire blade feathering moments")', () => {
    expect(fb.pitchingMomentGain).toBe(1);
    expect(featheringMoment({ ...fb, droop: 0 }, 0, 37, 0)).toBe(37);
  });

  it('droop: the geometry gives nose DOWN for drag below the axis; the model flies the opposite sense (DROOP_SENSE +1, documented)', () => {
    const drag = 100, P = [r, 0, -r * Math.tan(fb.droop)], F = [0, -drag, 0];
    const geometric = cross(P, F)[0], inPlane = drag * r, model = featheringMoment({ ...fb, pitchingMomentGain: 0 }, 0, 0, inPlane);
    report('droop sense', { geometricNm: geometric, modelNm: model, droopDeg: fb.droop / DEG, DROOP_SENSE });
    expect(geometric).toBeLessThan(0);
    expect(Math.abs(model / geometric)).toBeCloseTo(fb.droop / Math.tan(fb.droop), 6);
    // The inversion, visible: the model's sign is opposite to the geometry's.
    expect(Math.sign(model)).toBe(-Math.sign(geometric));
    expect(DROOP_SENSE).toBe(1);
  });

  it('why: the derived (nose-down) droop sense at the P droop is a limit cycle in the hover on a fixed shaft; half of it is stable', () => {
    const settleAndKick = (droop: number) => {
      const def = patched('ics', { feedback: { ...fb, droop } });
      const { rc, c, b } = fixedShaft(def, 'ics', 0);
      rc.state.controlGyro!.pitch += 0.5 * DEG;
      for (let i = 0; i < 240 * 6; i++) rc.compute(b, v3.zero(), 1.225, 1000, c, DT);
      return Math.hypot(rc.state.controlGyro!.pitch, rc.state.controlGyro!.roll) / DEG;
    };
    const flown = settleAndKick(fb.droop), derived = settleAndKick(-fb.droop), half = settleAndKick(-fb.droop / 2);
    report('droop sense stability (gyro tilt 6 s after a 0.5 deg kick, hover, fixed shaft)', { flownDeg: flown, derivedDeg: derived, derivedHalfDeg: half });
    expect(flown).toBeLessThan(0.1);
    expect(derived).toBeGreaterThan(5);
    droopHalf = half;
  });
  let droopHalf = NaN;
  it('half the derived droop decays under 0.1 deg within 6 s of the 0.5 deg kick (was KNOWN GAP at stage 5)', () => {
    // Integrator, at the AH merge: AH's handover proposed widening this bound to 0.25 deg; the bound was kept and the miss recorded
    // (0.125 deg at 6 s: the Prandtl-Glauert lift slope of the M 0.56 hover tip slowed the decay). Final fix round: with the blade's
    // flap-rate velocity in the gyro's blade moments (articulated.ts hubForcing) it reads 0.009 deg at 6 s.
    expect(droopHalf).toBeLessThan(0.1);
  });
});
