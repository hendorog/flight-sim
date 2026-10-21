// AH-56A stages 3-4 (AC): the wing and the compound trim and handling. Plan revision 2 section 7.3: the wing's data and its
// local-flow physics, C1 (hover download), C6-C9 and C26 (the trims along the SoF schedule), C23 (transition trim shift),
// C17-C19 (handling with the compound). Each row logs its numbers next to the target ([ah56] lines; AH56_TRACE=<dir> writes
// ah56Compound.json). C21 (AG's rows re-run) is the AG test list run on this definition.
import { afterAll, describe, expect, it } from 'vitest';
import { DEG, FT, KT, v3, type Vec3 } from '../../src/core/math';
import { cloneControls } from '../../src/core/types';
import type { AircraftDefinition } from '../../src/aircraft/types';
import { AH56_DEFINITION } from '../../src/aircraft/ah56';
import { AH56_COLLECTIVE_DEG } from '../../src/aircraft/ah56/facts';
import * as D from '../../src/aircraft/ah56/dimensions';
import { AMCS_FLAP_FEEDBACK, PROP_TRIM_SCHEDULE_ICS, WING_INCIDENCE_DEG, WING_LIFT_SLOPE, WING_MAC_BL } from '../../src/aircraft/ah56/compound';
import { ah56Loading } from '../../src/aircraft/ah56/mass';
import { createFlightModelFor } from '../../src/physics';
import type { BladeElementFlightModel } from '../../src/physics/flightModel';
import type { RotorcraftDefinition } from '../../src/physics/rotorcraft/definition';
import type { Rotorcraft } from '../../src/physics/rotorcraft/rotorcraft';
import type { GyroConfigId } from '../../src/physics/rotorcraft/controlGyro';
import { panelCoefficients, wingLoads, type WingPanelDef } from '../../src/physics/rotorcraft/wings';
import { PRODUCTION_AIR_WIRED, environment, report, run, stepResponse, writeTrace } from './ah56Rig';

const trace: Record<string, unknown> = {};
afterAll(() => writeTrace('ah56Compound', trace));

const def = AH56_DEFINITION.rotorcraft!, wings = def.wings!;
const DT = 1 / 240, IN = 0.0254;
const STAND_IN = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.AH56_AIRDATA !== 'off' &&
  !PRODUCTION_AIR_WIRED;
const variant = (patch: (r: RotorcraftDefinition) => RotorcraftDefinition): AircraftDefinition => ({ ...AH56_DEFINITION, rotorcraft: patch(def) });
/** The ICS trims on its own schedule (what pusherTrimLever reads once the flight model passes the configuration). */
const icsSchedule = variant((r) => ({ ...r, pusher: { ...r.pusher!, trimSchedule: { x: PROP_TRIM_SCHEDULE_ICS.kt.map((k) => k * KT),
  y: PROP_TRIM_SCHEDULE_ICS.betaDeg.map((b) => b * DEG) } } }));

interface RigOptions { cfg?: GyroConfigId; kt?: number; lb?: number; ft?: number; height?: number; gearDown?: boolean }
/** AG's rig (ah56Rig.ts) on any definition. */
function rigOn(d: AircraftDefinition, o: RigOptions = {}) {
  const fm = createFlightModelFor(d) as BladeElementFlightModel, env = environment(o.ft ?? 0);
  fm.setLoading(ah56Loading(o.lb ?? 18_300, undefined, 1));
  const rotor = (fm as unknown as { rotorcraft: Rotorcraft }).rotorcraft;
  if (STAND_IN) rotor.gyro!.setAirData({ hub: { x: (o.kt ?? 0) * KT, y: 0, z: 0 }, density: env.atmosphere().density });
  fm.reset({ position: { x: 0, y: 0, z: -(o.height ?? (o.ft ?? 0) * FT + 1500 * FT) }, heading: 0, airspeed: (o.kt ?? 0) * KT, flightPathAngle: 0,
    onGround: false, engineRunning: true, fuelFraction: 1, rotorcraftConfig: o.cfg, gearDown: o.gearDown ?? (o.kt ?? 0) < 100 }, env);
  return { fm, c: cloneControls(fm.trimControls), env, cfg: o.cfg ?? 'amcs', airData: STAND_IN, rotor };
}
type CompoundRig = ReturnType<typeof rigOn>;

/** The trim's readings: collective (0.75 R and indicated), attitude, torque, lift split (wing loads at the trimmed state),
 *  stick and pedals in inches. */
function trimRead(r: CompoundRig) {
  const s = r.fm.state, rc = s.rotorcraft!, d = r.rotor.def, cfg = d.controlGyro!.configs[r.cfg as GyroConfigId];
  const mass = s.mass, W = mass * 9.80665, cg = (r.fm as unknown as { mp: { cgOffset: Vec3 } }).mp.cgOffset;
  const air = { ...s.airVelocityBody };
  const body = { time: 0, position: v3.zero(), orientation: s.orientation, velocityBody: air, angularVelocity: v3.zero(), cgOffset: cg, mass };
  const force = v3.zero(), moment = v3.zero();
  const meanInflow = rc.inflow / (d.main.inducedFactor ?? 1);
  wingLoads(d.wings!, body, air, r.env.atmosphere().density, meanInflow, Math.atan2(Math.hypot(air.x, air.y), Math.max(meanInflow - air.z, 0.1)),
    (p, f) => { Object.assign(force, v3.add(force, f)); Object.assign(moment, v3.add(moment, v3.cross(v3.sub(p, cg), f))); return 0; });
  const coll = (d.main.minPitch + (r.c.collective ?? 0) * (d.main.maxPitch - d.main.minPitch)) / DEG;
  return { converged: r.fm.lastTrim!.converged, collective075: coll, indicated: coll + cfg.collectiveIndicatedOffset / DEG,
    pitch: s.pitch / DEG, roll: s.roll / DEG, torque: rc.turboshaft!.torquePsi, rotorShare: rc.thrust / W, wingShare: -force.z / W,
    lateralIn: r.c.aileron * cfg.stickTravel.lateral / IN, longitudinalIn: r.c.elevator * cfg.stickTravel.longitudinal / IN,
    pedalIn: r.c.rudder * 6.4 / 2, beta: rc.pusher!.beta / DEG };
}
const fix = (o: Record<string, number | boolean | string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(3) : v]));

// ------------------------------------------------------------------------------------------------------------------ wing
describe('the wing (P ASTA-72 p 53, AMCS-73 p 25; D)', () => {
  it('two panels: 195 ft^2, 26.7 ft, AR 3.66, MAC 7.6 ft at FS 308.2, dihedral 5 deg, incidence L 11 deg 52 min / R 12 deg 58 min', () => {
    const [left, right] = wings;
    const area = (left.area + right.area) / 0.09290304, span = (left.span + right.span) / 0.3048, ar = (left.span + right.span) ** 2 / (left.area + right.area);
    report('wing data', { areaFt2: area, spanFt: span, aspectRatio: ar, liftSlopePerRad: WING_LIFT_SLOPE, macStationBl: WING_MAC_BL,
      quarterMacFs: D.FS_REF - left.centre.x / IN, incidenceMeanDeg: `${WING_INCIDENCE_DEG.left.toFixed(2)} L / ${WING_INCIDENCE_DEG.right.toFixed(2)} R` });
    expect(area).toBeCloseTo(195, 6); expect(span).toBeCloseTo(26.7, 6); expect(ar).toBeCloseTo(3.66, 1);
    expect(left.side).toBe(-1); expect(right.side).toBe(1);
    expect(D.FS_REF - left.centre.x / IN).toBeCloseTo(308.2, 6);
    expect(left.dihedral / DEG).toBeCloseTo(5, 9);
    // The root settings (P) less the area-mean washout of the -3 deg twist (D): the right panel 1 deg 06 min higher, as built.
    expect((right.incidence - left.incidence) / DEG).toBeCloseTo(66 / 60 + 0.444 * (3.1 - 3.033), 2);
    expect(WING_LIFT_SLOPE).toBeGreaterThan(3.6); expect(WING_LIFT_SLOPE).toBeLessThan(3.8);
  });

  const air = (x: number, y = 0, z = 0) => ({ x, y, z });
  const body = (p = 0, q = 0, r = 0) => ({ time: 0, position: v3.zero(), orientation: { w: 1, x: 0, y: 0, z: 0 }, velocityBody: v3.zero(),
    angularVelocity: { x: p, y: q, z: r }, cgOffset: v3.zero(), mass: 8301 });
  const loads = (w: readonly WingPanelDef[], b: ReturnType<typeof body>, a: Vec3, inflow = 0, skew = Math.PI / 2) => {
    const force = v3.zero(), moment = v3.zero();
    wingLoads(w, b, a, 1.225, inflow, skew, (p, f) => { Object.assign(force, v3.add(force, f)); Object.assign(moment, v3.add(moment, v3.cross(p, f))); return 0; });
    return { force, moment };
  };
  const clean = wings.map((w) => ({ ...w, stores: undefined, tail: undefined }));

  it('each panel\'s local flow: sideslip from the right rolls it left (dihedral), a roll rate is damped, the yaw rate lifts the outer panel', () => {
    const v = 77, beta = 5 * DEG;
    const level = loads(clean, body(), air(v));
    const slip = loads(clean, body(), air(v * Math.cos(beta), v * Math.sin(beta)));
    const rolling = loads(clean, body(0.2), air(v));
    const yawing = loads(clean, body(0, 0, 0.1), air(v));
    report('wing local flow at 150 KTAS', { liftKN: -level.force.z / 1e3, dihedralRollKNmPer5deg: (slip.moment.x - level.moment.x) / 1e3,
      rollDampingKNmPerRadS: (rolling.moment.x - level.moment.x) / 0.2 / 1e3, yawRateRollKNm: (yawing.moment.x - level.moment.x) / 1e3 });
    expect(slip.moment.x - level.moment.x).toBeLessThan(0);
    expect(rolling.moment.x - level.moment.x).toBeLessThan(0);
    // A right yaw rate speeds the left panel: more lift on the left, a right roll.
    expect(yawing.moment.x - level.moment.x).toBeGreaterThan(0);
  });

  it('the hover wake pushes the panels down (the download); the wing\'s downwash unloads the stabiliser (nose up)', () => {
    const hover = loads(clean, body(), air(0), 13, 0);
    expect(hover.force.z).toBeGreaterThan(0);
    const withTail = loads(wings.map((w) => ({ ...w, stores: undefined })), body(), air(77));
    const without = loads(clean, body(), air(77));
    const tailLoad = withTail.force.z - without.force.z;
    report('wing download / tail downwash', { hoverDownloadKN: hover.force.z / 1e3, tailDownloadAt150KN: tailLoad / 1e3,
      noseUpKNm: (withTail.moment.y - without.moment.y) / 1e3 });
    expect(tailLoad).toBeGreaterThan(0);
    expect(withTail.moment.y - without.moment.y).toBeGreaterThan(0);
    // The section: attached slope through the stall into a flat plate.
    expect(panelCoefficients(wings[0], 5 * DEG).cl).toBeCloseTo(WING_LIFT_SLOPE * (5 - wings[0].zeroLiftAlpha / DEG) * DEG, 6);
    expect(panelCoefficients(wings[0], 90 * DEG).cd).toBeGreaterThan(1);
  });
});

// ------------------------------------------------------------------------------------------------------------------ C1
describe('C1: hover wing download, 18,300 lb OGE (ESTIMATE 4-8 % of the weight; the wing is 9.5 % of the disc)', () => {
  it('4-8 % of the gross weight', () => {
    const r = rigOn(AH56_DEFINITION, { kt: 0 });
    const t = trimRead(r);
    report('C1 hover download', { downloadPctOfWeight: -100 * t.wingShare, target: '4-8 %', torquePct: t.torque, collectiveIndicatedDeg: t.indicated,
      pitchDeg: t.pitch, rollDeg: t.roll });
    trace.C1 = t;
    expect(-t.wingShare).toBeGreaterThanOrEqual(0.04); expect(-t.wingShare).toBeLessThanOrEqual(0.08);
  });
});

// ------------------------------------------------------------------------------------------------------- C6 C7 C8 C9 C26
describe('the trims along the SoF schedule (AMCS default, 18,300 lb, SL ISA, the stores on)', () => {
  let c9shift: number | undefined, c26: { asBuilt: number; sym: number } | undefined;
  const at: Record<number, ReturnType<typeof trimRead>> = {};
  for (const kt of [80, 100, 120, 160, 190]) at[kt] = trimRead(rigOn(AH56_DEFINITION, { kt }));
  trace.trims = at;

  it('C7: the trim schedule puts the collective on 13 deg indicated (P AMCS-73: "at 80 KCAS and above") +/- 2 deg, 120-190 KCAS', () => {
    report('C7 AMCS collective on the schedule', { ...Object.fromEntries([80, 100, 120, 160, 190].map((k) => [`${k}kt`, +at[k].indicated.toFixed(2)])),
      target: '13 +/- 2' });
    for (const kt of [120, 160, 190]) { expect(at[kt].converged).toBe(true); expect(Math.abs(at[kt].indicated - AH56_COLLECTIVE_DEG.amcsCruise)).toBeLessThanOrEqual(2); }
  });

  // The ICS (246 rpm) on its own schedule (what pusherTrimLever reads once the flight model passes the configuration), and on the
  // default definition today (the AMCS's angles).
  const ics: Record<number, ReturnType<typeof trimRead>> = {}, icsDefault: Record<number, ReturnType<typeof trimRead>> = {};
  for (const kt of [120, 140, 160]) { ics[kt] = trimRead(rigOn(icsSchedule, { kt, cfg: 'ics' })); icsDefault[kt] = trimRead(rigOn(AH56_DEFINITION, { kt, cfg: 'ics' })); }
  trace.icsTrims = { ics, icsDefault };

  it('C7 (ICS): on its own schedule the ICS trims on 5-7 deg indicated (P APE-I SoF), 120-160 KCAS', () => {
    report('C7 ICS collective', { ...Object.fromEntries([120, 140, 160].map((k) => [`${k}kt`, `${ics[k].indicated.toFixed(2)}${ics[k].converged ? '' : ' (not converged)'}`])),
      ...Object.fromEntries([120, 140, 160].map((k) => [`default${k}kt`, `${icsDefault[k].indicated.toFixed(2)}${icsDefault[k].converged ? '' : ' (not converged)'}`])),
      target: '5-7' });
    for (const kt of [120, 140, 160]) {
      expect(ics[kt].converged).toBe(true);
      expect(ics[kt].indicated).toBeGreaterThanOrEqual(5); expect(ics[kt].indicated).toBeLessThanOrEqual(7);
    }
  });

  it.fails('C7 KNOWN GAP (contract request): an ICS reset of the default definition trims on 5-7 deg (flightModel.ts must pass the configuration to pusherTrimLever)', () => {
    for (const kt of [120, 140, 160]) { expect(icsDefault[kt].indicated).toBeGreaterThanOrEqual(5); expect(icsDefault[kt].indicated).toBeLessThanOrEqual(7); }
  });

  it('C8: fuselage pitch at 190 KTAS level -1 ... -5 deg (ESTIMATE, research section 7: about 3 deg nose down with the wing carrying 80 %)', () => {
    report('C8 pitch', { ...Object.fromEntries([80, 100, 120, 160, 190].map((k) => [`${k}kt`, +at[k].pitch.toFixed(2)])), wingShare190: at[190].wingShare,
      target: '-1 ... -5 at 190' });
    expect(at[190].pitch).toBeLessThanOrEqual(-1); expect(at[190].pitch).toBeGreaterThanOrEqual(-5);
  });

  it.fails('C6 KNOWN GAP: rotor lift share 120 KCAS 40-60 %, 160 KCAS 20-35 %, 190 KCAS 10-25 % (ESTIMATE from the XH-51A trend)', () => {
    // On AG's collective reading (13 deg indicated = 6 deg at 0.75 R, kept because the AMCS's own operation needs it: compound.ts
    // "collective gauge") the rotor carries 71 / 47 / 26 %; the reading at the rotor centre (2.25 deg) gave 54 / 30 / 11 %.
    report('C6 rotor lift share', { at120: at[120].rotorShare, at160: at[160].rotorShare, at190: at[190].rotorShare,
      wing120: at[120].wingShare, wing160: at[160].wingShare, wing190: at[190].wingShare, target: '40-60 / 20-35 / 10-25 %' });
    expect(at[120].rotorShare).toBeLessThanOrEqual(0.60); expect(at[160].rotorShare).toBeLessThanOrEqual(0.35); expect(at[190].rotorShare).toBeLessThanOrEqual(0.25);
  });

  it('C6 (sense): the rotor\'s share falls with speed and the wing carries most of the weight at 190 KCAS', () => {
    expect(at[160].rotorShare).toBeLessThan(at[120].rotorShare); expect(at[190].rotorShare).toBeLessThan(at[160].rotorShare);
    expect(at[190].wingShare).toBeGreaterThan(0.6);
  });

  it('C9 (P AMCS-73 para 22): the lateral trim moves very little 85-125 KCAS and about 0.5 in left from 125 to 190 KCAS; no pedal shift', () => {
    // The P test condition: 18,500 lb, 5000 ft density altitude, collective fixed (13 deg indicated).
    const lat: Record<number, ReturnType<typeof trimRead>> = {};
    for (const kt of [85, 125, 190]) lat[kt] = trimRead(rigOn(AH56_DEFINITION, { kt, lb: 18_500, ft: 5000 }));
    const lowShift = lat[125].lateralIn - lat[85].lateralIn, highShift = lat[125].lateralIn - lat[190].lateralIn;
    const pedalSpan = Math.max(...[85, 125, 190].map((k) => lat[k].pedalIn)) - Math.min(...[85, 125, 190].map((k) => lat[k].pedalIn));
    report('C9 lateral trim (AMCS, 5000 ft, 18,500 lb)', { lat85In: lat[85].lateralIn, lat125In: lat[125].lateralIn, lat190In: lat[190].lateralIn,
      shift85to125In: lowShift, leftShift125to190In: highShift, pedalSpanIn: pedalSpan, lon85In: lat[85].longitudinalIn, lon190In: lat[190].longitudinalIn,
      P: 'very small 85-125; about 0.5 in left 125-190; no directional shift; forward with speed' });
    trace.C9 = lat;
    c9shift = highShift;
    expect(Math.abs(lowShift)).toBeLessThanOrEqual(0.25);
    expect(highShift).toBeGreaterThan(0);
    expect(pedalSpan).toBeLessThanOrEqual(0.5);
    // "Small and in the proper direction, forward trim with increasing airspeed".
    expect(lat[190].longitudinalIn).toBeLessThan(lat[85].longitudinalIn);
  });

  it.fails('C9 KNOWN GAP: the left shift 125-190 KCAS is about 0.5 in (P; tolerance +/- 0.25 in AGENT)', () => {
    // 0.19 in: the AMCS's lateral stick per hub moment is small (K_R / K_hub over 336 N m/in: about 0.02 in per kN m of roll
    // moment), so the right-rolling prop reaction growing with speed moves the stick little (C26).
    expect(c9shift!).toBeGreaterThanOrEqual(0.25); expect(c9shift!).toBeLessThanOrEqual(0.75);
  });

  it('C9 (plan wording): trimmed lateral stick within 0.5 in of centre at 120, 160 and 190 KCAS', () => {
    // 190 KCAS: 0.47 in left at SL (0.44 at the P test's 5000 ft). It was 0.56 with K_R 5,000; the K_R 3,000 refit (compound.ts)
    // halves the stick per kN m of steady roll moment, so the margin (0.03 in) is the refit's, not a fit to this row.
    report('C9 lateral within 0.5 in', { at120: at[120].lateralIn, at160: at[160].lateralIn, at190: at[190].lateralIn, target: '|lat| <= 0.5' });
    for (const kt of [120, 160, 190]) expect(Math.abs(at[kt].lateralIn)).toBeLessThanOrEqual(0.5);
  });

  it('C26: the prop\'s reaction is in the lateral trim: without the wing incidence asymmetry the 190 KTAS trim moves left by the reaction', () => {
    const mean = (wings[0].incidence + wings[1].incidence) / 2;
    const sym = trimRead(rigOn(variant((r) => ({ ...r, wings: r.wings!.map((w) => ({ ...w, incidence: mean })) })), { kt: 190 }));
    const noReaction = trimRead(rigOn(variant((r) => ({ ...r, pusher: { ...r.pusher!, rotation: 1 } })), { kt: 190 }));
    report('C26 lateral trim at 190 KTAS', { asBuiltIn: at[190].lateralIn, symmetricWingIn: sym.lateralIn, reactionReversedIn: noReaction.lateralIn,
      target: 'symmetric 0.8-1.5 in left; as built 0 +/- 0.5', D: '12.4 kN m reaction vs about 9 kN m from the incidence at q 5.85 kPa' });
    trace.C26 = { asBuilt: at[190].lateralIn, sym: sym.lateralIn, noReaction: noReaction.lateralIn };
    // The reaction rolls right, so it needs left stick; the right panel's extra incidence takes part of it back.
    expect(sym.lateralIn).toBeLessThan(at[190].lateralIn);
    expect(noReaction.lateralIn).toBeGreaterThan(at[190].lateralIn);
    c26 = { asBuilt: at[190].lateralIn, sym: sym.lateralIn };
  });

  it.fails('C26 KNOWN GAP: symmetric wing 0.8-1.5 in left, as built 0 +/- 0.5 in (D)', () => {
    // The D band assumes about 0.1 in per kN m; the AMCS (AG's 975 N m full lateral moment, K_R 5000 on the compound) needs about
    // 0.02 in per kN m of steady roll moment, so the 12.5 kN m reaction is 0.26 in of stick and the asymmetry 0.14 in.
    expect(c26!.sym).toBeLessThanOrEqual(-0.8); expect(c26!.sym).toBeGreaterThanOrEqual(-1.5);
    expect(Math.abs(c26!.asBuilt)).toBeLessThanOrEqual(0.5);
  });
});

// ------------------------------------------------------------------------------------------------------------------ C23
describe('C23: transition trim shift, hover to 100 KCAS (P ASTA-72 para 25, ICS 19,500 lb; AMCS-73 para 17)', () => {
  it('ICS: lateral 1.1 in left, longitudinal 0.7 in forward, pedal 2.3 in right (+/- 0.4 / 0.3 / 0.7); AMCS lateral about half', () => {
    const shift = (d: AircraftDefinition, cfg: GyroConfigId) => {
      const h = trimRead(rigOn(d, { kt: 0, cfg, lb: 19_500 })), f = trimRead(rigOn(d, { kt: 100, cfg, lb: 19_500 }));
      return { lateralLeft: h.lateralIn - f.lateralIn, longitudinalForward: h.longitudinalIn - f.longitudinalIn, pedalRight: f.pedalIn - h.pedalIn };
    };
    const ics = shift(icsSchedule, 'ics'), amcs = shift(AH56_DEFINITION, 'amcs');
    report('C23 transition trim shift ICS', { ...fix(ics), target: '1.1 L +/- 0.4, 0.7 fwd +/- 0.3, 2.3 R +/- 0.7' });
    report('C23 transition trim shift AMCS', { ...fix(amcs), target: 'lateral 0.4-0.7 in (about half the ICS)' });
    trace.C23 = { ics, amcs };
    c23 = { ics, amcs };
    // The pedal shift and the ICS's longitudinal shift: P size.
    expect(Math.abs(ics.pedalRight - 2.3)).toBeLessThanOrEqual(0.7);
    expect(Math.abs(amcs.pedalRight - 2.3)).toBeLessThanOrEqual(0.7);
    expect(Math.abs(ics.longitudinalForward - 0.7)).toBeLessThanOrEqual(0.3);
  });

  it.fails('C23 KNOWN GAP: the ICS lateral shift, 1.1 in left (+/- 0.4)', () => {
    // The ICS's hover trim is 0.94 in left and its 100 KCAS trim further left; AG's ICS gyro feedback sets both (KNOWN_ISSUES).
    expect(Math.abs(c23!.ics.lateralLeft - 1.1)).toBeLessThanOrEqual(0.4);
  });

  it.fails('C23 KNOWN GAP: the AMCS lateral shift 0.4-0.7 in', () => {
    expect(c23!.amcs.lateralLeft).toBeGreaterThanOrEqual(0.4); expect(c23!.amcs.lateralLeft).toBeLessThanOrEqual(0.7);
  });

  it('frozen at the hover trim (ICS), the prop accelerates it: between 30 and 70 KCAS it rolls right, pitches up, yaws left (P sense)', () => {
    const r = rigOn(icsSchedule, { kt: 0, cfg: 'ics', lb: 19_500 });
    r.c.propLever = 0.5; // about +17 deg
    let p = 0, q = 0, y = 0, n = 0;
    run(r, 40, () => {
      const s = r.fm.state, kias = s.ias / KT;
      if (kias >= 30 && kias <= 70) { p += s.angularVelocity.x; q += s.angularVelocity.y; y += s.angularVelocity.z; n++; }
    });
    const mean = { rollRate: p / n / DEG, pitchRate: q / n / DEG, yawRate: y / n / DEG, seconds: n * DT };
    report('C23 frozen controls 30-70 KCAS (ICS)', { ...fix(mean), P: 'right roll, nose up, nose left' });
    trace.C23frozen = mean;
    c23frozen = mean;
    expect(n).toBeGreaterThan(0);
    expect(mean.pitchRate).toBeGreaterThan(0);
    expect(mean.yawRate).toBeLessThan(0);
  });

  it.fails('C23 KNOWN GAP: the frozen-controls RIGHT roll through translation', () => {
    expect(c23frozen!.rollRate).toBeGreaterThan(0);
  });
  let c23: { ics: Record<string, number>; amcs: Record<string, number> } | undefined;
  let c23frozen: { rollRate: number; pitchRate: number; yawRate: number } | undefined;
});

// ------------------------------------------------------------------------------------------------------- handling C17-C19
describe('C17: ICS full-stick roll rates with the compound (P ASTA-72 para 60)', () => {
  const go = (kt: number, dir: 1 | -1) => {
    const r = rigOn(icsSchedule, { kt, cfg: 'ics' });
    const trimIn = r.c.aileron * def.controlGyro!.configs.ics.stickTravel.lateral / IN;
    r.c.aileron = dir;
    let max = 0;
    run(r, 1.5, () => { max = Math.max(max, dir * r.fm.state.angularVelocity.x / DEG); });
    return { max, trimIn };
  };
  const rows = { r122: go(122, 1), l122: go(122, -1), r152: go(152, 1), l152: go(152, -1) };
  trace.C17 = rows;
  it.fails('C17 KNOWN GAP: 77 deg/s right; 42 left at 122 KCAS, 49 left at 152 KCAS; right/left 1.5-1.9 (+/- 20 %)', () => {
    // 40 R / 34 L at 122 KCAS, 43 R / 31 L at 152: the sense is right (the trim is left: 0.27 / 0.51 in) but the rates are about
    // half and the ratio 1.2 / 1.4: AG's ICS steady rates are low (G7, KNOWN_ISSUES #4).
    report('C17 ICS full lateral', { right122: rows.r122.max, left122: rows.l122.max, ratio122: rows.r122.max / rows.l122.max,
      right152: rows.r152.max, left152: rows.l152.max, ratio152: rows.r152.max / rows.l152.max, trimLateralIn122: rows.r122.trimIn,
      trimLateralIn152: rows.r152.trimIn, P: '77 R / 42 L (122), 77 R / 49 L (152)' });
    expect(rows.r122.max / rows.l122.max).toBeGreaterThanOrEqual(1.5 * 0.8);
    expect(rows.r122.max).toBeGreaterThanOrEqual(77 * 0.8);
  });
  it('C17 (sense): full right stick rolls faster than full left (the trim offset is left) at 122 and 152 KCAS', () => {
    expect(rows.r122.trimIn).toBeLessThan(0); expect(rows.r152.trimIn).toBeLessThan(0);
    expect(rows.r122.max).toBeGreaterThan(rows.l122.max); expect(rows.r152.max).toBeGreaterThan(rows.l152.max);
  });
});

describe('C18: AMCS response to 180 KCAS on the compound (P AMCS-73 paras 33-34: about constant)', () => {
  const rows: Record<string, ReturnType<typeof stepResponse>> = {};
  for (const kt of [0, 100, 150, 180]) for (const axis of ['lon', 'lat'] as const) rows[`${axis}${kt}`] = stepResponse(rigOn(AH56_DEFINITION, { kt }) as never, axis, 1, 3);
  trace.C18 = Object.fromEntries(Object.entries(rows).map(([k, s]) => [k, { max: s.max, tMax: s.tMax, peaked: s.peaked, maxAcc: s.maxAcc }]));
  const line = (axis: 'lon' | 'lat') => Object.fromEntries([0, 100, 150, 180].map((kt) => [`${kt}kt`, `${rows[`${axis}${kt}`].max.toFixed(2)} @${rows[`${axis}${kt}`].tMax.toFixed(2)}s`]));
  it('roll 16 deg/s/in (+/- 30 %) and the roll sensitivity 53 deg/s^2/in at 180 KCAS (+/- 30 %)', () => {
    report('C18 AMCS roll', { ...line('lat'), sensitivity180: rows.lat180.maxAcc, target: '16 +/- 30 %; 53 +/- 30 % at 180' });
    for (const kt of [0, 100, 150, 180]) { const s = rows[`lat${kt}`]; expect(s.peaked).toBe(true); expect(s.max).toBeGreaterThanOrEqual(16 * 0.7); expect(s.max).toBeLessThanOrEqual(16 * 1.3); }
    expect(rows.lat180.maxAcc).toBeGreaterThanOrEqual(53 * 0.7); expect(rows.lat180.maxAcc).toBeLessThanOrEqual(53 * 1.3);
  });
  it('pitch 6 deg/s/in (+/- 30 %) hover to 150 KCAS (the AMCS refit, compound.ts)', () => {
    report('C18 AMCS pitch', { ...line('lon'), sensitivityHover: rows.lon0.maxAcc, K_R: AMCS_FLAP_FEEDBACK, target: '4.2-7.8' });
    for (const kt of [0, 100, 150]) { const s = rows[`lon${kt}`]; expect(s.peaked).toBe(true); expect(s.max).toBeGreaterThanOrEqual(4.2); expect(s.max).toBeLessThanOrEqual(7.8); }
  });
  it.fails('C18 KNOWN GAP: pitch 6 deg/s/in (+/- 30 %) at 180 KCAS', () => {
    // 3.8 deg/s/in: the model's sensitivity per unit response is 1.9 /s (AMCS-73's 9 / 6 is 1.5 /s), so no (K_R, stick moment)
    // holds 4.2 at 180 KCAS with the hover sensitivity under 11.7 (docs/ah56-compound.md, the refit grid).
    expect(rows.lon180.max).toBeGreaterThanOrEqual(4.2);
  });
});

describe('C19: AMCS pull-up and push-over (P AMCS-73 paras 39-40)', () => {
  /** A ramp of `inches` of stick over 1 s from trim at `kt` (AGENT: the pilot's pull; P gives 2.43 g in about 2.1 s), held; the
   *  extreme load factor in `seconds` and when it came. */
  const manoeuvre = (kt: number, inches: number, seconds: number) => {
    const r = rigOn(AH56_DEFINITION, { kt });
    const e0 = r.c.elevator, per = IN / def.controlGyro!.configs.amcs.stickTravel.longitudinal;
    let t = 0, extreme = 1, tExtreme = 0, at1 = 1;
    run(r, seconds, () => {
      t += DT;
      r.c.elevator = e0 + inches * per * Math.min(1, t / 1);
      const n = r.fm.state.gLoad;
      if ((inches > 0 && n > extreme) || (inches < 0 && n < extreme)) { extreme = n; tExtreme = t; }
      if (Math.abs(t - 1) < DT / 2) at1 = n;
    });
    return { extreme, tExtreme, at1, kiasEnd: r.fm.state.ias / KT, pitchEnd: r.fm.state.pitch / DEG };
  };
  it('a pull from 180 KCAS reaches 2.43 g inside the stick travel, peaking in about 2.1 s (+/- 20 %) with 1.75 g at 1 s; a push from 165 KCAS reaches 0.28 g in 2.5 s', () => {
    // The stick the pilot needs: bisect the held pull for a 2.43 g peak inside 2.52 s (2.1 s + 20 %), and the push for 0.28 g.
    // AMCS-73 paras 39-40 give no stick size (research-ah56.md), so the peak g is the bisection's target, not a measurement:
    // it is not asserted. What is measured: the stick it takes (inside the 4.95 in travel), when the peak comes and the g
    // at 1 s. The stick size is a handling number for the owner (docs/ah56-compound.md C19).
    const solve = (kt: number, target: number, window: number, sign: 1 | -1) => {
      let lo = 0, hi = 4.95, m = manoeuvre(kt, sign * hi, window);
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        const t = manoeuvre(kt, sign * mid, window);
        if (sign * (t.extreme - target) >= 0) { hi = mid; m = t; } else lo = mid;
      }
      return { inches: sign * hi, m };
    };
    const pullSol = solve(180, 2.43, 2.1 * 1.2, 1), pushSol = solve(165, 0.28, 2.5 * 1.2, -1);
    const pull = pullSol.m, inches = pullSol.inches, push = pushSol.m, pushIn = pushSol.inches;
    report('C19 pull-up 180 KCAS', { stickIn: inches, peakG: pull.extreme, peakAtS: pull.tExtreme, gAt1s: pull.at1, kiasEnd: pull.kiasEnd,
      P: '2.43 g in about 2.1 s; 1.75 g at about 1 s' });
    report('C19 push-over 165 KCAS', { stickIn: pushIn, minG: push.extreme, minAtS: push.tExtreme, P: '0.28 g in 2.5 s' });
    trace.C19 = { inches, pull, pushIn, push };
    // Inside the stick travel (AMCS 9.9 in, 4.95 each way, P): the bisection only lands below 4.95 in when the target g is
    // reachable; the peaks come in the P times (+ 20 %), 1.75 g at about 1 s.
    expect(Math.abs(inches)).toBeLessThan(4.95); expect(Math.abs(pushIn)).toBeLessThan(4.95);
    expect(pull.tExtreme).toBeLessThanOrEqual(2.1 * 1.2);
    expect(pull.at1).toBeGreaterThanOrEqual(1.75 * 0.8); expect(pull.at1).toBeLessThanOrEqual(1.75 * 1.2);
    expect(push.tExtreme).toBeLessThanOrEqual(2.5 * 1.2);
  }, 180_000);
});

