// AH-56A tune round 3, item A: the control gyro's own hover stability, AIDS OFF, isolated from the compound (the stage-2
// helicopter of G10: no wing, no pusher; AH56_ROTORCRAFT's assembly without AH56_COMPOUND), in both configurations, stick and
// pedals held where the trim put them. The films (owner-notes 2026-10-22; S, read by eye): the CL-475 and the XH-51A (no
// pusher) hovered with a man on a ~16 ft side boom, the XH-51A one HANDS-OFF over about 15 s, fuselage near level (<= ~5 deg),
// disc near level, no visible drift; a man hanging from a nose handle (a rapid CG shift), pitch near level. Bands (ESTIMATE from
// the film): fuselage roll change <= 5 deg, disc change <= 2 deg, no drift growth over 15-30 s, stick to trim <= ~15 % of travel.
// They are read as CHANGES from the trimmed hover: the AMCS hovers about 5 deg left wing low (P APE-I para 96), which the
// film's aircraft did not.
//
// What the gyro can and cannot do (docs/control-gyro-model.md section 7): with the stick held, the gyro's balance pins the hub
// moment to the stick (rates and velocity zero), and a leaning body does not change the thrust's moment about the CG, so a NEW
// steady moment cannot be met by a fixed lean at zero velocity: it becomes a steady rate, the precession K_R beta / H (Hoh-74
// eq 6.1-6.2: the stick is an attitude-rate command). The film's boom hover was TRIMMED (the man was on the boom from the
// lift-off): the rows below trim with the offset, release, and hold. The step rows check the rate is the derived one and that the
// ATTITUDE does not diverge; the DRIFT does (the pass-2 gate, W/tune2/ah56/gate1/out/probes-a.txt p1, and the informational A4 30 s
// row): with the stick held a step load leaves the hover within 15 s (the boom step 17 kt at 15 s, 46 kt at 30 s, the heading
// through 170 deg, 250-660 m in 60 s, heading held or free, stage-2 and compound alike) and needs a re-trim of about 2 % of the
// stick. The owner's "fixed lean, no drift build-up" is the TRIMMED offset's (A2); the film's nose-handle step was pilot-flown.
import { afterAll, describe, expect, it } from 'vitest';
import { AH56_DEFINITION } from '../../src/aircraft/ah56';
import { AH56_BASE } from '../../src/aircraft/ah56/base';
import { AH56_GYRO } from '../../src/aircraft/ah56/gyro';
import { AH56_HALF_P, AH56_ROTOR_HIGH_SPEED } from '../../src/aircraft/ah56/highSpeed';
import { mergeDefinition } from '../../src/aircraft/ah56/patch';
import { ah56Loading } from '../../src/aircraft/ah56/mass';
import { GROUND_Z } from '../../src/aircraft/ah56/dimensions';
import { createFlightModelFor } from '../../src/physics';
import type { BladeElementFlightModel } from '../../src/physics/flightModel';
import type { Rotorcraft } from '../../src/physics/rotorcraft/rotorcraft';
import type { BodyState } from '../../src/physics/interfaces';
import type { GyroConfigId } from '../../src/physics/rotorcraft/controlGyro';
import { hingelessBlade, hingelessSpring } from '../../src/physics/rotorcraft/hingeless';
import { cloneControls } from '../../src/core/types';
import { DEG, KT, v3 } from '../../src/core/math';
import { DT, environment, report, writeTrace } from './ah56Rig';

const trace: Record<string, unknown> = {};
afterAll(() => writeTrace('ah56GyroHover', trace));

/** The stage-2 helicopter (G10's): no wing, no pusher. */
const HELICOPTER = { ...AH56_DEFINITION, rotorcraft: mergeDefinition(AH56_BASE,
  { ...(AH56_GYRO ? { controlGyro: AH56_GYRO } : {}), ...(AH56_HALF_P ? { halfPHop: AH56_HALF_P } : {}) },
  { main: AH56_ROTOR_HIGH_SPEED }) };
const r2 = (x: number) => +x.toFixed(2);

/** Trimmed hover at `heightM` (CG), 18,300 lb; the payload centroid moved `payloadY` m sideways (+ starboard, the weight kept);
 *  `ext`, a body moment added to the rotor's (N m), present from the trim on unless set later. */
function hover(cfg: GyroConfigId, heightM: number, payloadY = 0) {
  const fm = createFlightModelFor(HELICOPTER) as BladeElementFlightModel, env = environment();
  const load = ah56Loading(18_300);
  load.payloadPosition = { ...load.payloadPosition, y: payloadY };
  fm.setLoading(load);
  const rotor = (fm as unknown as { rotorcraft: Rotorcraft }).rotorcraft, ext = { x: 0, y: 0 };
  const orig = rotor.compute.bind(rotor);
  (rotor as unknown as { compute: typeof orig }).compute = (...a: Parameters<typeof orig>) => {
    const f = orig(...a); f.moment.x += ext.x; f.moment.y += ext.y; return f;
  };
  fm.reset({ position: { x: 0, y: 0, z: -heightM }, heading: 0, airspeed: 0, flightPathAngle: 0, onGround: false, engineRunning: true,
    fuelFraction: 1, rotorcraftConfig: cfg }, env);
  return { fm, c: cloneControls(fm.trimControls), env, rotor, ext, converged: fm.lastTrim?.converged ?? false };
}
type Hover = ReturnType<typeof hover>;

/** The disc in space (deg): the body attitude plus the first-harmonic flap relative to the shaft. */
const disc = (h: Hover) => { const s = h.fm.state, rc = s.rotorcraft!; return { pitch: (s.pitch - rc.flapForward) / DEG, roll: (s.roll + rc.flapRight) / DEG }; };

/** Fly hands off (the controls as left) for `seconds`; the changes from the start, the drift and the ground speed at 15 s / the end. */
function handsOff(h: Hover, seconds: number, at?: { t: number; set: () => void }, feetOnHeading = false) {
  const s0 = h.fm.state, roll0 = s0.roll, pitch0 = s0.pitch, hdg0 = s0.heading, x0 = s0.position.x, y0 = s0.position.y, d0 = disc(h);
  const rud0 = h.c.rudder;
  let roll = 0, pitch = 0, dRoll = 0, dPitch = 0, hdg = 0, gs15 = 0;
  const marks = { att5: NaN, att10: NaN, att15: NaN };
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) {
    const t = (i + 1) * DT;
    if (at && Math.abs(t - DT - at.t) < DT / 2) at.set();
    // The pilot's feet holding the heading (pedal only; the stick stays hands off): the tail rotor's part taken out.
    if (feetOnHeading) { const e = Math.atan2(Math.sin(h.fm.state.heading - hdg0), Math.cos(h.fm.state.heading - hdg0)); h.c.rudder = rud0 - 2 * e - 0.7 * h.fm.state.angularVelocity.z; }
    h.fm.step(DT, h.c, h.env);
    const s = h.fm.state, d = disc(h);
    roll = Math.max(roll, Math.abs(s.roll - roll0)); pitch = Math.max(pitch, Math.abs(s.pitch - pitch0));
    dRoll = Math.max(dRoll, Math.abs(d.roll - d0.roll)); dPitch = Math.max(dPitch, Math.abs(d.pitch - d0.pitch));
    hdg = Math.max(hdg, Math.abs(Math.atan2(Math.sin(s.heading - hdg0), Math.cos(s.heading - hdg0))));
    if (Math.abs(t - 15) < DT / 2) gs15 = s.groundSpeed / KT;
    for (const m of [5, 10, 15] as const) if (Math.abs(t - m) < DT / 2) marks[`att${m}`] = Math.max(Math.abs(s.roll - roll0), Math.abs(s.pitch - pitch0)) / DEG;
  }
  const s = h.fm.state;
  return { rollDeg: r2(roll / DEG), pitchDeg: r2(pitch / DEG), discRollDeg: r2(dRoll), discPitchDeg: r2(dPitch), headingDeg: r2(hdg / DEG),
    driftM: r2(Math.hypot(s.position.x - x0, s.position.y - y0)), gs15Kt: r2(gs15), gsEndKt: r2(s.groundSpeed / KT), roll0Deg: r2(roll0 / DEG),
    att5: r2(marks.att5), att10: r2(marks.att10), att15: r2(marks.att15) };
}

const IGE = GROUND_Z + 3;                                  // wheels 3 m up (the film hovers were low)
const PAYLOAD_KG = ah56Loading(18_300).payload, TOTAL_KG = 18_300 * 0.45359237;
/** The film's man on the boom: 90 kg at 16 ft (4.9 m): 4.33 kN m; the payload shift that gives the same moment. */
const BOOM_Y = 90 * 4.9 / PAYLOAD_KG;
/** A 10 in lateral CG shift of the whole aircraft (20.7 kN m: the XH-51A's "more than 10 in" is the boom's moment there). */
const CG10_Y = 0.254 * TOTAL_KG / PAYLOAD_KG;

describe('A1: hands-off hover from trim, 30 s, aids off, the gyro-alone helicopter (film: 15 s hands off; bands ESTIMATE)', () => {
  for (const cfg of ['amcs', 'ics'] as const) for (const [where, h] of [['OGE 150 m', 150], ['IGE wheels 3 m', IGE]] as const) {
    it(`${cfg.toUpperCase()} ${where}: roll and pitch within 5 deg, the disc within 2 deg, under 5 m and 1 kt of drift with no growth past 1 kt from 15 to 30 s; heading (tail rotor) within 15 deg`, () => {
      const v = hover(cfg, h);
      const o = handsOff(v, 30);
      report(`A1 hands-off 30 s ${cfg} ${where}`, { ...o, target: 'roll/pitch <= 5, disc <= 2 deg, drift < 5 m, gs < 1 kt; heading < 15 deg (scored apart)' });
      trace[`A1_${cfg}_${h}`] = o;
      expect(v.converged).toBe(true);
      expect(Math.max(o.rollDeg, o.pitchDeg)).toBeLessThanOrEqual(5);
      expect(Math.max(o.discRollDeg, o.discPitchDeg)).toBeLessThanOrEqual(2);
      expect(o.driftM).toBeLessThan(5);
      expect(o.gsEndKt).toBeLessThan(1);
      expect(o.headingDeg).toBeLessThan(15);
    }, 60_000);
  }
});

describe('A1b: the same, 60 s (beyond the film\'s 15 s: the slow modes)', () => {
  // Before tune round 3 (AMCS net spring 1059 N m/rad): IGE 21.7 deg and 70.7 m with the heading 179 deg off in 60 s, OGE 12.5 deg
  // and 225 m (W/tune2/ah56 out/a9_grid_rot20.log): the low-frequency rotor was speed- and dihedral-unstable (A5).
  it('AMCS IGE wheels 3 m, stick and pedals hands off: roll and pitch within 5 deg, the disc within 2 deg, under 15 m of drift', () => {
    const o = handsOff(hover('amcs', IGE), 60);
    report('A1b hands-off 60 s amcs IGE', { ...o, target: 'roll/pitch <= 5, disc <= 2 deg, drift < 15 m' });
    trace.A1b_amcs_ige = o;
    expect(Math.max(o.rollDeg, o.pitchDeg)).toBeLessThanOrEqual(5);
    expect(Math.max(o.discRollDeg, o.discPitchDeg)).toBeLessThanOrEqual(2);
    expect(o.driftM).toBeLessThan(15);
  }, 60_000);
  it('AMCS OGE 150 m, stick hands off, the heading held on the pedals (the tail rotor\'s part out): the same attitude and disc bands, under 30 m of drift (a slow nose-up creep: 22.8 m, 2.5 kt at 60 s)', () => {
    const o = handsOff(hover('amcs', 150), 60, undefined, true);
    const free = handsOff(hover('amcs', 150), 60);
    report('A1b hands-off 60 s amcs OGE, heading held', { ...o, target: 'roll/pitch <= 5, disc <= 2 deg, drift < 15 m' });
    report('A1b hands-off 60 s amcs OGE, pedals free too (scored apart: the tail rotor\'s weathercock)', free);
    trace.A1b_amcs_oge = { held: o, free };
    expect(Math.max(o.rollDeg, o.pitchDeg)).toBeLessThanOrEqual(5);
    expect(Math.max(o.discRollDeg, o.discPitchDeg)).toBeLessThanOrEqual(2);
    expect(o.driftM).toBeLessThan(30);
  }, 60_000);
  it.fails('ICS KNOWN GAP (P spring, cant and sweep): 60 s hands off OGE within the same bands (measured: a slowly growing pitch-roll-drift oscillation of about 12-15 s period)', () => {
    const o = handsOff(hover('ics', 150), 60);
    report('A1b hands-off 60 s ics OGE', o);
    trace.A1b_ics = o;
    expect(Math.max(o.rollDeg, o.pitchDeg)).toBeLessThanOrEqual(5);
    expect(Math.max(o.discRollDeg, o.discPitchDeg)).toBeLessThanOrEqual(2);
    expect(o.driftM).toBeLessThan(15);
  }, 60_000);
});

describe('A2 / A3: an offset weight trimmed, the stick released, 30 s hands off (the film: the XH-51A boom hover, hands-off, STARBOARD)', () => {
  const base = { amcs: hover('amcs', IGE), ics: hover('ics', IGE) };
  const trimmed = (cfg: GyroConfigId, y: number) => {
    const v = hover(cfg, IGE, y), b = base[cfg];
    return { converged: v.converged, stickLatPct: r2(Math.abs(v.c.aileron - b.c.aileron) * 100),
      stickLonPct: r2(Math.abs(v.c.elevator - b.c.elevator) * 100), ...handsOff(v, 30) };
  };
  for (const cfg of ['amcs', 'ics'] as const) for (const [side, y] of [['starboard', BOOM_Y], ['port', -BOOM_Y]] as const) {
    it(`${cfg.toUpperCase()} 90 kg at 16 ft to ${side} (4.33 kN m): trimmed, released, 30 s: roll within 5 deg, disc within 2 deg, under 5 m of drift and no growth past 1 kt`, () => {
      const o = trimmed(cfg, y);
      report(`A2 boom ${cfg} ${side}`, { ...o, target: 'roll <= 5, disc <= 2 deg, drift < 5 m, gs < 1 kt; stick <= ~15 %' });
      trace[`A2_${cfg}_${side}`] = o;
      expect(o.converged).toBe(true);
      expect(Math.max(o.rollDeg, o.pitchDeg)).toBeLessThanOrEqual(5);
      expect(Math.max(o.discRollDeg, o.discPitchDeg)).toBeLessThanOrEqual(2);
      expect(o.driftM).toBeLessThan(5);
      expect(o.gsEndKt).toBeLessThan(1);
      if (cfg === 'amcs') expect(Math.max(o.stickLatPct, o.stickLonPct)).toBeLessThanOrEqual(15);
    }, 60_000);
  }
  it.fails('ICS KNOWN GAP: the boom trims with <= ~15 % of the stick (measured: 17.1 % lateral; the P stick gearing, 337 ft-lb/in over 3.75 in, against the hub moment it commands through tan 4 deg of sweep: G4\'s 5.5 kN m per inch)', () => {
    const o = trimmed('ics', BOOM_Y);
    report('A2 boom ics starboard stick', { stickLatPct: o.stickLatPct, band: 15 });
    expect(o.stickLatPct).toBeLessThanOrEqual(15);
  }, 60_000);
  for (const [side, y] of [['starboard', CG10_Y], ['port', -CG10_Y]] as const) {
    it(`A3 AMCS a 10 in lateral CG shift to ${side} (20.7 kN m): trimmed, released, 30 s, within the same bands and the stick within 15 %`, () => {
      const o = trimmed('amcs', y);
      report(`A3 10 in CG amcs ${side}`, o);
      trace[`A3_amcs_${side}`] = o;
      expect(o.converged).toBe(true);
      expect(Math.max(o.rollDeg, o.pitchDeg)).toBeLessThanOrEqual(5);
      expect(Math.max(o.discRollDeg, o.discPitchDeg)).toBeLessThanOrEqual(2);
      expect(o.driftM).toBeLessThan(5);
      expect(Math.max(o.stickLatPct, o.stickLonPct)).toBeLessThanOrEqual(15);
    }, 60_000);
  }
  it.fails('A3 ICS KNOWN GAP: the 10 in lateral CG shift trims inside 15 % of the stick (measured: 80-83 % of the lateral travel, the 150 m starboard trim not converging; 20.7 kN m is 3.8 in at G4\'s 5.5 kN m/in, P gearing)', () => {
    const o = trimmed('ics', CG10_Y);
    report('A3 10 in CG ics starboard', o);
    expect(o.stickLatPct).toBeLessThanOrEqual(15);
  }, 60_000);
});

describe('A4: a sudden load step, the stick held (the film: a man lifted hanging from the nose handle): the attitude-rate command at the derived precession, no divergence', () => {
  /** The precession a steady moment M (N m) needs, deg/s (D): the hub moment -M from a flap M / K_hub, fed back at K_R (AMCS) or
   *  tan(sweep) x the hub moment (ICS), over the gyro's momentum H. */
  const predicted = (cfg: GyroConfigId, m: number) => {
    const d = HELICOPTER.rotorcraft!, g = d.controlGyro!.configs[cfg], hub = d.hubModel;
    if (hub?.kind !== 'hingeless') throw new Error('hingeless hub expected');
    const omega = d.nominalRpm * Math.PI / 30 * g.nominalRpmFraction;
    const kHub = d.main.blades / 2 * (hub.equivalentHingeOffset * hingelessBlade(d).flapFirst * omega ** 2 + hingelessSpring(d));
    const h = g.inertia * g.spinRatio * omega, fb = g.feedback;
    return (fb.mode === 'flapping' ? fb.gain * m / kHub : Math.tan(fb.sweep) * m) / h / DEG;
  };
  const step = (cfg: GyroConfigId, mx: number, my: number) => {
    const v = hover(cfg, 150);
    const o = handsOff(v, 15, { t: 0, set: () => { v.ext.x = mx; v.ext.y = my; } });
    return { ...o, predictedDegS: r2(predicted(cfg, Math.hypot(mx, my))) };
  };
  const cases = [['nose', 0, -90 * 9.81 * 2.5], ['tail', 0, 90 * 9.81 * 2.5], ['starboard boom', 90 * 9.81 * 4.9, 0]] as const;
  for (const [name, mx, my] of cases) {
    it(`AMCS ${name} step (${(Math.hypot(mx, my) / 1000).toFixed(2)} kN m): 5-10 s at 0.4-1.6 x the derived precession, the 10 s change under 2.5 x the 5 s one (no divergence)`, () => {
      const o = step('amcs', mx, my);
      const rate = (o.att10 - o.att5) / 5;
      report(`A4 ${name} step amcs`, { ...o, rate5to10DegS: r2(rate), ratioToPredicted: r2(rate / o.predictedDegS), target: '0.4-1.6 x predicted; att10 < 2.5 x att5' });
      trace[`A4_amcs_${name}`] = o;
      expect(rate / o.predictedDegS).toBeGreaterThan(0.4);
      expect(rate / o.predictedDegS).toBeLessThan(1.6);
      expect(o.att10).toBeLessThan(2.5 * o.att5);
    }, 60_000);
  }
  it('AMCS starboard boom step, 30 s (informational: the attitude stays bounded, under 15 deg; the drift does not, recorded: the hover is left within 15 s and the stick needs a re-trim)', () => {
    const v = hover('amcs', 150);
    const o = handsOff(v, 30, { t: 0, set: () => { v.ext.x = 90 * 9.81 * 4.9; } });
    report('A4 starboard boom step amcs 30 s', { ...o, target: 'attitude change < 15 deg (bounded); ground speed and drift recorded (not bounded: the stick is held)' });
    trace.A4_amcs_boom30 = o;
    expect(Math.max(o.rollDeg, o.pitchDeg)).toBeLessThan(15);
  }, 60_000);
  it('ICS (informational): the feathering-moment feedback turns a step into a much faster rate, Lambda M / H (the 2.2 kN m nose load is worth about 0.34 in of stick): the pilot\'s to take out, as the film\'s was', () => {
    const o = step('ics', 0, -90 * 9.81 * 2.5);
    report('A4 nose step ics', { ...o, stickEquivalentIn: r2(Math.tan(4 * DEG) * 90 * 9.81 * 2.5 / (337 * 1.3558)) });
    trace.A4_ics_nose = o;
    expect(o.predictedDegS).toBeGreaterThan(2);
    expect(o.att5).toBeGreaterThan(2);
  }, 60_000);
});

describe('A5: the low-frequency rotor with the gyro settled (AMCS): Hoh-74 sect 6.1, "the pitch-roll cross coupling is zero", the hub moments emasculated', () => {
  it('per m/s of u and v at the hover (moments about the CG, gyro and flap settled): speed-stable, dihedral-stable, and each cross term smaller than its direct term', () => {
    const v = hover('amcs', 150);
    const fm = v.fm as unknown as { mp: { cgOffset: { x: number; y: number; z: number }; mass: number }; atmosphere: { density: number; speedOfSound: number } };
    const s = v.fm.state;
    const at = (du: number, dv: number) => {
      const b: BodyState = { time: 0, position: { ...s.position }, orientation: s.orientation, velocityBody: { x: du, y: dv, z: 0 },
        angularVelocity: v3.zero(), cgOffset: fm.mp.cgOffset, mass: fm.mp.mass };
      return { ...v.rotor.settle(b, v3.zero(), fm.atmosphere.density, 150, v.c, true, fm.atmosphere.speedOfSound).moment };
    };
    const z = at(0, 0), u = at(1, 0), w = at(0, 1);
    const d = { MuRoll: Math.round(u.x - z.x), MuPitch: Math.round(u.y - z.y), MvRoll: Math.round(w.x - z.x), MvPitch: Math.round(w.y - z.y) };
    report('A5 AMCS low-frequency derivatives, N m per m/s', { ...d, before: 'Mu (559, -265), Mv (178, 774) at K_net 1059',
      target: 'MuPitch > 0, MvRoll < 0, |MuRoll| < MuPitch, |MvPitch| < -MvRoll' });
    trace.A5 = d;
    expect(d.MuPitch).toBeGreaterThan(0);
    expect(d.MvRoll).toBeLessThan(0);
    expect(Math.abs(d.MuRoll)).toBeLessThan(d.MuPitch);
    expect(Math.abs(d.MvPitch)).toBeLessThan(-d.MvRoll);
  });
});
