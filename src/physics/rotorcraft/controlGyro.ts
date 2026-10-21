// Lockheed rigid-rotor control gyro (AH-56A, ICS 1972 and AMCS 1973). Owner: AG (stage 2). Plan revision 2, section 7.2;
// docs/control-gyro-model.md has the derivation, the sources and every fitted number.
//
// The gyro is a disc spinning with (ICS) or geared to (AMCS) the rotor shaft, gimballed so it can tilt relative to the
// shaft. Its tilt IS the swashplate (ICS: the gyro X drives the blade pitch links; AMCS: the sliding spatial lever
// follows it through an irreversible servo), so the blade cyclic is the tilt times the SSL gain (gyroBladeCyclic). The
// pilot cannot position it: the stick strains a spring that puts a MOMENT on it, and the rotor feeds hub moments back
// as moments (ICS: the blade feathering moments through the forward sweep, CR-114362; AMCS: the first-harmonic flap
// through springs, Hohenemser AGARDograph 197 sect. 6.1).
//
// EQUATION (precession only; NASA CR-114362 Appendix A, the stationary-axis gyro terms: the antisymmetric
// 2 Omega_G I_G term, diagonal swashplate springs and dampers; nutation neglected). Tilt phi = (roll, pitch) relative to
// the shaft, rad, labelled by the disc tilt it commands (roll + = disc right, pitch + = disc aft: gyroBladeCyclic's
// convention). With the gyro's spin momentum h = rotation x I_g x spinRatio x Omega along the shaft's up axis and
// J (a, b) = (-b, a) the 90 deg turn:
//   h J (phi' + w) + C phi' + C_R (phi' + rotation Omega_g J phi) = M_pilot - K_net phi - M_feedback - M_extra
// w = body (p, q) in shaft axes: the gyro holds its plane in space (the stabiliser-bar effect). A moment precesses the
// gyro 90 deg away from its own axis; the linkages are built so that the pilot's moment and the rotor's feedback
// arrive turned by that 90 deg (sgn(h) J) and then by the residual azimuth angles inputRotation / feedbackRotation:
//   M_pilot = sgn(h) J R(input) m_stick,   M_feedback = sgn(h) J R(feedback) F x
// so with nothing else acting phi' = R(input) m_stick / |h| (a rate command) and the feedback alone gives
// phi' = -R(feedback) F x / |h| (the auto-trim: the gyro precesses until the hub moment is gone). The springs and
// dampers act in the physical axes: a fixed spring makes the gyro PRECESS about M/K at the rate K/h (CR-114362 App C,
// "the swashplate restrained by springs"), it does not lag it first-order. A damper on the rotating gimbal (C_R) seen
// from the shaft adds C_R Omega_g J phi, which aligns the gyro with the shaft (Hohenemser's 1/tau).
//
// INTEGRATION (binding, plan 7.2 / C1.4): the ICS loop gain Lambda K_hub / H is tens of rad/s, so the gyro tilt (2) and
// the flap harmonics (2) advance as ONE constant-coefficient 4x4 exact exponential step (the 5x5 augmented matrix of
// the constant forcing), with RC's FlapSystem (dx/dt = a x + f + b (theta - theta0), hub moment = hub x) inside the
// matrix. Stable at 240 Hz and at settle's 0.05 s. The stops clamp the tilt after the step (no wind-up: the tilt is the
// only state) and the flap is re-stepped with the cyclic held at the stop.
//
// Plain data only in the definition types (codemap rule 4: no closures; tables as arrays).
import { v3, type Vec3 } from '../../core/math';
import type { ControlInputs } from '../../core/types';
import type { RotorcraftDefinition, RotorcraftState } from './definition';
import { hingelessBlade, hingelessSpring } from './hingeless';
import { toBody } from './shaftFrame';

export type GyroConfigId = 'amcs' | 'ics';

/** Piecewise-linear table y(x), x ascending; clamped at the ends. */
export interface Table1D { readonly x: readonly number[]; readonly y: readonly number[] }

/** Linear interpolation in a Table1D, clamped to the end values. */
export function lookup(t: Table1D, x: number): number {
  const xs = t.x, ys = t.y, n = xs.length;
  if (n === 0) return 0;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let i = 1;
  while (xs[i] < x) i++;
  const u = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
  return ys[i - 1] + u * (ys[i] - ys[i - 1]);
}

/**
 * Augmentation, all as stick offsets (m of stick travel at the grip) added before the stick-to-moment law, scheduled on
 * calibrated airspeed (KCAS). P ASTA-72 App C paras 2-3 (ICS), AMCS-73 App C paras 2-3 (AMCS); the gains not printed
 * are ESTIMATES (docs/control-gyro-model.md).
 */
export interface GyroAugmentation {
  /** ICS pitch desensitizer: stick-to-moment gain on the longitudinal stick vs KCAS (1 = none, 0.5 = twice the stick per
   *  response): 1 at <= 100 kt, 0.5 at >= 170 kt (P); its piston's authority, m (+/-0.757 in, P). */
  pitchDesensitizer?: { gainByKcas: Table1D; authority: number };
  /** ICS pitch/roll decoupler: gain vs KCAS (0 at 110 kt -> 1 at 200 kt, P); the roll-rate signal saturates at
   *  rollRateLimit, rad/s (30 deg/s, P), and full gain at the limit puts the whole authority, m (0.757 in, P, the same
   *  piston) into the longitudinal stick against the roll-with-pitch coupling. */
  decoupler?: { gainByKcas: Table1D; rollRateLimit: number; authority: number };
  /** ICS roll compensator: a roll-rate damper on the lateral stick, hover to 80 KCAS (P), gain vs KCAS (1 = full),
   *  stick m per rad/s (ESTIMATE), authority m (+/-0.329 in, P). */
  rollCompensator?: { gainByKcas: Table1D; stickPerRate: number; authority: number };
  /** AMCS longitudinal stability augmentor: the trim motor moves the stick's trim aft as speed rises and forward as it
   *  falls (P sense), offset m (aft +) vs KCAS (ESTIMATE amounts). */
  trimSchedule?: { offsetByKcas: Table1D };
  /** AMCS lateral sideslip SAS: gain vs KCAS (0 to 40 kt, 1 from 60 kt, P); lateral stick m per rad of sideslip (0.5 in at
   *  12.5 deg, P), authority m (0.5 in, P). */
  sideslipSas?: { gainByKcas: Table1D; stickPerRad: number; authority: number };
}

export type GyroFeedback =
  /** ICS: the blade feathering moments reach the gyro through the pitch links (CR-114362: about tan(sweep) x the hub
   *  flap moment), plus the blade in-plane moments through the droop and the blade pitching moments (x
   *  pitchingMomentGain; Cm0 now, moment stall with stage 5's section). Angles rad. frictionMoment: the feather-bearing
   *  friction, N m (28 ft-lb = 38 N m, P), recorded as data and flown as its describing-function equivalent rotating
   *  damping (ControlGyroConfig.rotatingDamping; CR-114362 App A treats feathering friction as rotating damping C_R): a
   *  Coulomb dead band would make the trimmed tilt non-unique. */
  | { mode: 'featheringMoment'; sweep: number; droop: number; pitchingMomentGain: number; frictionMoment: number }
  /** AMCS: N m on the gyro per rad of first-harmonic flap (K_R), through springs. ESTIMATE, fitted (plan 7.2). */
  | { mode: 'flapping'; gain: number };

export interface ControlGyroConfig {
  /** Polar inertia, kg m^2, and spin relative to the rotor. ICS 61.0 kg m^2 (45 slug-ft^2), rotor-driven (spinRatio 1),
   *  P/INF. AMCS: H fixed at the ICS value, about 1,570 kg m^2/s (inertia x spinRatio x Omega), ESTIMATE (plan 7.2). */
  inertia: number; spinRatio: number;
  /** Tilt stops relative to the shaft, rad (ICS +/-15 deg P; AMCS up 10.11, down 18.05, right 12.27, left 18.08 deg P).
   *  up = pitch + (disc aft), right = roll + (disc right). */
  maxTilt: { up: number; down: number; left: number; right: number };
  /** Stick travel centre-to-stop, m (ICS 5.5 / 3.75 in; AMCS 4.95 / 2.9 in, P). */
  stickTravel: { longitudinal: number; lateral: number };
  /** Moment on the gyro at full stick, N m (ICS 278 ft-lb/in x 5.5 in, 337 x 3.75 in, P/D; AMCS fitted to G5). */
  stickMoment: { longitudinal: number; lateral: number };
  /** Positive spring gyro-to-fuselage, N m/rad (ICS 4100 ft-lb/rad = 5559 net, P); the AMCS negative spring that
   *  partly cancels it (Hohenemser), N m/rad. Both act in the physical axes. */
  spring: number; negativeSpring?: number;
  /** Non-rotating (swashplate) damping per axis, N m s/rad (ICS 2 x 44 in-lb/(rad/s) = 9.94, P); damping on the
   *  rotating gimbal axes (feathering friction as viscous), N m s/rad. */
  damping: number; rotatingDamping?: number;
  /** Residual azimuth turns of the pilot's moment input and of the rotor feedback beyond the linkages' 90 deg, rad
   *  (advanced = in the rotation direction). P: ICS input rotation 36.0 deg "advanced", gyro cant 33 deg; the angles the
   *  model uses and their reading are in docs/control-gyro-model.md (G8). */
  inputRotation: number; feedbackRotation: number;
  /** Blade cyclic per rad of gyro tilt (the SSL gain G). ICS 1 (the gyro is the swashplate). AMCS 1: the labelled stops
   *  read as cyclic (forward > aft, left > right) give +/-8 deg and more; G 10 would give 100-180 deg (plan 7.2, G5a). */
  cyclicPerTilt: number;
  feedback: GyroFeedback;
  augmentation?: GyroAugmentation;
  /** Governed rotor speed of this configuration, fraction of nominalRpm (ICS 1.00, AMCS 0.975 P). */
  nominalRpmFraction: number;
  /** Collective indicator offset for the gauge, rad (AMCS +7 deg D from "13 deg = 6 deg ICS"; ICS 0). */
  collectiveIndicatedOffset: number;
}
export interface ControlGyroDef { default: GyroConfigId; configs: { amcs: ControlGyroConfig; ics: ControlGyroConfig } }

/** RotorcraftState.controlGyro: gyro tilt relative to the shaft, rad, and its rates, rad/s. Created in reset for a type
 *  with `controlGyro`, never lazily. `mode` is read on every call (never cached: a restore overwrites it). The rates
 *  are those of the last real step (diagnostics). */
export interface ControlGyroState { mode: GyroConfigId; pitch: number; roll: number; pitchRate: number; rollRate: number }

/** Row-major 2x2 [m00, m01, m10, m11]. */
export type Mat2 = readonly [number, number, number, number];
/**
 * RC's slow-amplitude first-harmonic flap system for one real step (shaft axes; the rotor's rotation sign folded in;
 * the same harmonics as RotorcraftState: x = [cosine, sine] = [-flapForward, flapRight], rad):
 *   dx/dt = a.x + f + b.(theta - theta0)
 * constant over the step. theta = [pitchCos, pitchSin] is the blade cyclic in flapForcing's convention (rad); theta0
 * is the cyclic f was formed with; b = df/dtheta (exact: the forcing is linear in cyclic). The shaft hub moment
 * [Mx, My] (N m) = hub.x. RC exports `flapSystem(...)` from articulated.ts (stage 1).
 */
export interface FlapSystem { a: Mat2; f: readonly [number, number]; b: Mat2; theta0: readonly [number, number]; hub: Mat2 }
/** First-harmonic blade moments RC returns (only when `controlGyro` exists) for the feathering-moment feedback, shaft
 *  axes: per-blade pitching moment about the feathering axis and in-plane moment, N m, cos/sin of azimuth. */
export interface GyroBladeMoments { pitching: { cos: number; sin: number }; inPlane: { cos: number; sin: number } }
/** Air data for the augmentation: the hub's air velocity, shaft axes, m/s (Rotorcraft.compute's hubAir) and the
 *  density, kg/m^3. Absent: the speed-scheduled augmentation is dormant (KNOWN_ISSUES.md). */
export interface GyroAir { hub: Readonly<Vec3>; density: number }

/** Blade cyclic commanded by a gyro tilt, rad, for readers without a ControlGyro instance (swashplate.ts, exteriors).
 *  aft + = disc aft; right + = disc right (cyclicAngles' convention). */
export function gyroBladeCyclic(d: RotorcraftDefinition, g: ControlGyroState): { aft: number; right: number } {
  const k = d.controlGyro?.configs[g.mode].cyclicPerTilt ?? 1;
  return { aft: k * g.pitch, right: k * g.roll };
}

/**
 * Sense of the residual rotations (+1: a positive angle turns the moment in the rotor's rotation direction). Chosen
 * from the fixed-shaft checks (docs/control-gyro-model.md, "Senses"): the feedback sense is the one whose auto-trim
 * decays (G3), the input sense the one that keeps a pure longitudinal stick's roll rate smallest (G8).
 */
export const INPUT_SENSE = -1;
export const FEEDBACK_SENSE = -1;

const KT = 1852 / 3600;
const SEA_LEVEL_DENSITY = 1.225;

/** The linear gyro + flap system of one step: dz/dt = m z + c, z = [roll, pitch, cosine, sine]. */
export interface CoupledSystem { m: Float64Array; c: Float64Array }

/**
 * The control gyro of one aircraft (RotorcraftDefinition.controlGyro), stepped with the flap harmonics by
 * Rotorcraft.compute (RC wires advanceCoupled in place of advanceFlap's harmonics, plan 4 item 1).
 */
export class ControlGyro {
  /** Gyro spin momentum, body axes, N m s (added to the rotor's H before w x H; plan 3.5). */
  readonly h: Vec3 = v3.zero();
  /** The last air data the augmentation used: from advanceCoupled's `air`, else setAirData; null = dormant. */
  private air: { kcas: number; sideslip: number } | null = null;
  private readonly sys: CoupledSystem = { m: new Float64Array(16), c: new Float64Array(4) };
  private readonly aug = new Float64Array(25);
  private readonly expo = new Float64Array(25);
  private readonly scratch = [new Float64Array(25), new Float64Array(25), new Float64Array(25)];
  constructor(readonly def: RotorcraftDefinition, readonly state: RotorcraftState) {}

  /** The active configuration, read from state on every call. */
  config(): ControlGyroConfig {
    const g = this.def.controlGyro!;
    return g.configs[this.state.controlGyro?.mode ?? g.default];
  }

  /** Create RotorcraftState.controlGyro (config: ICS/AMCS selector from InitialConditions.rotorcraftConfig). */
  reset(_running: boolean, config?: GyroConfigId): void {
    this.state.controlGyro = { mode: config ?? this.def.controlGyro!.default, pitch: 0, roll: 0, pitchRate: 0, rollRate: 0 };
    // The air data is an input, not state: kept across a reset so the trim that follows sees the augmentation the flight
    // will. With the requested wiring (advanceCoupled's `air` on every compute) it is replaced on the first compute.
    this.updateMomentum();
  }

  /**
   * Air data for the speed-scheduled augmentation (KCAS, sideslip) when the caller of advanceCoupled passes none: the
   * production wiring is RC's (contract request: rotorcraft.ts passes { hub: hubAir, density }); test rigs set it from
   * the flight state. null: dormant.
   */
  setAirData(air: GyroAir | null): void {
    this.air = air ? airData(air) : null;
  }

  /**
   * Trim seed before settle()'s relaxation: the tilt at which the gyro is in equilibrium with no body rate, the flap
   * taken to follow the cyclic and the hub moment to be its static spring moment. settle()'s coupled exact steps then
   * converge the rest.
   */
  seed(c: ControlInputs): void {
    const g = this.state.controlGyro;
    if (!g) return;
    const cfg = this.config(), rot = this.def.rotation, omega = this.state.omega;
    const sg = rot * cfg.spinRatio * omega >= 0 ? 1 : -1;
    const G = cfg.cyclicPerTilt;
    // Feedback per rad of tilt in tilt-space moments (flap = G x tilt, disc axes = tilt axes).
    const f = cfg.feedback.mode === 'featheringMoment'
      ? Math.tan(cfg.feedback.sweep) * this.staticHubStiffness(omega) * G : cfg.feedback.gain * G;
    const fb = rotation(FEEDBACK_SENSE * rot * cfg.feedbackRotation), inp = rotation(INPUT_SENSE * rot * cfg.inputRotation);
    const stick = this.stickMoment(c, cfg, null);
    // sg J R_in m = (K_net I + q J + sg f J R_fb) phi, q = C_R rotation Omega_g; J R_fb = [[-fb2, -fb3], [fb0, fb1]].
    const kNet = cfg.spring - (cfg.negativeSpring ?? 0), q = (cfg.rotatingDamping ?? 0) * rot * cfg.spinRatio * omega;
    const a00 = kNet - sg * f * fb[2], a01 = -q - sg * f * fb[3];
    const a10 = q + sg * f * fb[0], a11 = kNet + sg * f * fb[1];
    const m0 = inp[0] * stick.roll + inp[1] * stick.pitch, m1 = inp[2] * stick.roll + inp[3] * stick.pitch;
    const r0 = -sg * m1, r1 = sg * m0;
    const det = a00 * a11 - a01 * a10;
    if (!(Math.abs(det) > 1e-9)) return;
    const cl = clampTilt(cfg, (a11 * r0 - a01 * r1) / det, (a00 * r1 - a10 * r0) / det);
    g.roll = cl.roll; g.pitch = cl.pitch; g.rollRate = 0; g.pitchRate = 0;
    this.updateMomentum();
  }

  /** Blade cyclic now, rad (aft, right): the gyro tilt through the SSL gain (gyroBladeCyclic; RC's contract). */
  cyclic(_c: ControlInputs): { aft: number; right: number } {
    const g = this.state.controlGyro;
    return g ? gyroBladeCyclic(this.def, g) : { aft: 0, right: 0 };
  }

  /**
   * The linear coupled system of one step, without advancing it (tests, mode analysis): z = [roll, pitch, cosine, sine]
   * with dz/dt = m z + c. The same arithmetic advanceCoupled exponentiates.
   */
  linearize(c: ControlInputs, rateShaft: Vec3, system: FlapSystem, blade?: GyroBladeMoments, air?: GyroAir): CoupledSystem {
    if (air) this.air = airData(air);
    this.assemble(c, rateShaft, system, blade);
    return { m: Float64Array.from(this.sys.m), c: Float64Array.from(this.sys.c) };
  }

  /**
   * Advance gyro tilt and the flap harmonics together over dt > 0 (one 4x4 exact step) and return the new flap
   * harmonics. rateShaft: body rates in shaft axes, rad/s. blade: the feathering-moment inputs (ICS). air: the hub air
   * velocity and density for the augmentation (absent: the last setAirData, else dormant).
   */
  advanceCoupled(dt: number, c: ControlInputs, rateShaft: Vec3, system: FlapSystem,
    flap: { cosine: number; sine: number }, blade?: GyroBladeMoments, air?: GyroAir): { cosine: number; sine: number } {
    const g = this.state.controlGyro;
    if (!g || !(dt > 0)) return { cosine: flap.cosine, sine: flap.sine };
    if (air) this.air = airData(air);
    const cfg = this.config();
    this.assemble(c, rateShaft, system, blade);
    const z = this.step(this.sys.m, this.sys.c, 4, [g.roll, g.pitch, flap.cosine, flap.sine], dt);
    let roll = z[0], pitch = z[1], cosine = z[2], sine = z[3];
    const cl = clampTilt(cfg, roll, pitch);
    if (cl.roll !== roll || cl.pitch !== pitch) {
      // At a stop: the tilt holds there (no wind-up) and the flap is re-stepped with the cyclic frozen at the stop.
      roll = cl.roll; pitch = cl.pitch;
      const x = this.flapOnly(system, roll, pitch, flap, dt);
      cosine = x[0]; sine = x[1];
    }
    g.rollRate = (roll - g.roll) / dt; g.pitchRate = (pitch - g.pitch) / dt;
    g.roll = roll; g.pitch = pitch;
    this.updateMomentum();
    return { cosine, sine };
  }

  // ------------------------------------------------------------------------------------------------- internals

  /** Hub moment per rad of first-harmonic flap, N m/rad: (B/2)(e M_beta Omega^2 + K_beta) (RC's hingeMoment). */
  private staticHubStiffness(omega: number): number {
    const d = this.def;
    if (d.hubModel?.kind !== 'hingeless') return 0;
    const b = hingelessBlade(d), e = d.hubModel.equivalentHingeOffset;
    return d.main.blades / 2 * (e * b.flapFirst * omega * omega + hingelessSpring(d));
  }

  /** The stick's moment command in tilt-rate space (before the linkages' 90 deg turn), N m: roll, pitch. */
  private stickMoment(c: ControlInputs, cfg: ControlGyroConfig, rate: Vec3 | null): { roll: number; pitch: number } {
    const t = cfg.stickTravel;
    let lon = clampUnit(c.elevator) * t.longitudinal, lat = clampUnit(c.aileron) * t.lateral;
    const a = cfg.augmentation, air = this.air;
    if (a && air) {
      const kcas = air.kcas;
      if (a.pitchDesensitizer) {
        const p = a.pitchDesensitizer;
        lon += clampAbs(-(1 - lookup(p.gainByKcas, kcas)) * lon, p.authority);
      }
      if (a.decoupler && rate) {
        const p = a.decoupler, roll = clampAbs(rate.x, p.rollRateLimit);
        lon += clampAbs(-lookup(p.gainByKcas, kcas) * roll / p.rollRateLimit * p.authority, p.authority);
      }
      if (a.rollCompensator && rate) {
        const p = a.rollCompensator;
        lat += clampAbs(-lookup(p.gainByKcas, kcas) * p.stickPerRate * rate.x, p.authority);
      }
      if (a.trimSchedule) lon += lookup(a.trimSchedule.offsetByKcas, kcas);
      if (a.sideslipSas) {
        const p = a.sideslipSas;
        lat += clampAbs(-lookup(p.gainByKcas, kcas) * p.stickPerRad * air.sideslip, p.authority);
      }
    }
    return { roll: cfg.stickMoment.lateral * lat / t.lateral, pitch: cfg.stickMoment.longitudinal * lon / t.longitudinal };
  }

  /** Build sys.m / sys.c for this step (see the file header for the equation). */
  private assemble(c: ControlInputs, rateShaft: Vec3, system: FlapSystem, blade?: GyroBladeMoments): void {
    const cfg = this.config(), d = this.def, rot = d.rotation;
    const spin = cfg.spinRatio * this.state.omega;
    const hs = rot * cfg.inertia * spin, sg = hs >= 0 ? 1 : -1;
    const cr = cfg.rotatingDamping ?? 0, ct = Math.max(cfg.damping + cr, 1e-6);
    const kNet = cfg.spring - (cfg.negativeSpring ?? 0);
    // D = hs J + ct I = [[ct, -hs], [hs, ct]]; D^-1 = [[ct, hs], [-hs, ct]] / (ct^2 + hs^2).
    const det = ct * ct + hs * hs;
    const di = [ct / det, hs / det, -hs / det, ct / det];
    // Tilt stiffness in physical moments: -K_net I - C_R rotation Omega_g J.
    const q = cr * rot * spin;
    const rp = [-kNet, q, -q, -kNet];
    // Feedback map F: flap x -> tilt-space moment (roll, pitch); the gyro sees sg J R_fb F x.
    const fb = rotation(FEEDBACK_SENSE * rot * cfg.feedbackRotation);
    let f: [number, number, number, number];
    if (cfg.feedback.mode === 'featheringMoment') {
      const lam = Math.tan(cfg.feedback.sweep), h = system.hub;
      f = [lam * h[0], lam * h[1], lam * h[2], lam * h[3]];
    } else {
      // The flap in tilt order (right, aft) = (sine, cosine).
      const k = cfg.feedback.gain;
      f = [0, k, k, 0];
    }
    const jr = mul2(sgJ(sg), fb);
    const jrf = mul2(jr, f);
    const rx = [-jrf[0], -jrf[1], -jrf[2], -jrf[3]];
    // Constant moments: pilot, the precession the body rate demands and the ICS extra feathering moments.
    const stick = this.stickMoment(c, cfg, rateShaft);
    const inp = rotation(INPUT_SENSE * rot * cfg.inputRotation);
    const mIn = [inp[0] * stick.roll + inp[1] * stick.pitch, inp[2] * stick.roll + inp[3] * stick.pitch];
    const pilot = [-sg * mIn[1], sg * mIn[0]];
    // -hs J w with J (p, q) = (-q, p).
    const precession = [hs * rateShaft.y, -hs * rateShaft.x];
    let extra0 = 0, extra1 = 0;
    if (cfg.feedback.mode === 'featheringMoment') {
      const fbk = cfg.feedback, half = d.main.blades / 2;
      if (blade) {
        // Per-blade feathering-moment harmonics (nose up +) in tilt order (sin, cos), like the hub moment.
        const e0 = half * (fbk.pitchingMomentGain * blade.pitching.sin + fbk.droop * blade.inPlane.sin);
        const e1 = half * (fbk.pitchingMomentGain * blade.pitching.cos + fbk.droop * blade.inPlane.cos);
        extra0 += jr[0] * e0 + jr[1] * e1; extra1 += jr[2] * e0 + jr[3] * e1;
      }
    }
    const r0 = [pilot[0] + precession[0] - extra0, pilot[1] + precession[1] - extra1];
    const m = this.sys.m, cv = this.sys.c;
    // Gyro rows: phi' = D^-1 (r0 + rp phi + rx x).
    const dp = mul2(di, rp), dx = mul2(di, rx);
    m[0] = dp[0]; m[1] = dp[1]; m[2] = dx[0]; m[3] = dx[1];
    m[4] = dp[2]; m[5] = dp[3]; m[6] = dx[2]; m[7] = dx[3];
    cv[0] = di[0] * r0[0] + di[1] * r0[1]; cv[1] = di[2] * r0[0] + di[3] * r0[1];
    // Flap rows: x' = a x + (f - b theta0) + b G P phi, P = diag(rot, -rot) (theta = [rot right, -rot aft]).
    const a = system.a, b = system.b, G = cfg.cyclicPerTilt;
    m[8] = b[0] * G * rot; m[9] = -b[1] * G * rot; m[10] = a[0]; m[11] = a[1];
    m[12] = b[2] * G * rot; m[13] = -b[3] * G * rot; m[14] = a[2]; m[15] = a[3];
    const t0 = system.theta0;
    cv[2] = system.f[0] - (b[0] * t0[0] + b[1] * t0[1]);
    cv[3] = system.f[1] - (b[2] * t0[0] + b[3] * t0[1]);
  }

  /** Exact step of dz/dt = m z + c over dt (the augmented exponential), n = 2 or 4. */
  private step(m: ArrayLike<number>, c: ArrayLike<number>, n: number, z0: readonly number[], dt: number): number[] {
    const N = n + 1, aug = this.aug;
    aug.fill(0, 0, N * N);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) aug[i * N + j] = m[i * n + j] * dt;
      aug[i * N + n] = c[i] * dt;
    }
    expm(aug, N, this.expo, this.scratch);
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      let s = this.expo[i * N + n];
      for (let j = 0; j < n; j++) s += this.expo[i * N + j] * z0[j];
      out.push(s);
    }
    return out;
  }

  /** The flap harmonics alone over dt with the cyclic held at the gyro tilt (roll, pitch). */
  private flapOnly(system: FlapSystem, roll: number, pitch: number, flap: { cosine: number; sine: number }, dt: number): number[] {
    const cfg = this.config(), rot = this.def.rotation, G = cfg.cyclicPerTilt;
    const theta = [rot * G * roll, -rot * G * pitch], t0 = system.theta0, b = system.b;
    const c = [system.f[0] + b[0] * (theta[0] - t0[0]) + b[1] * (theta[1] - t0[1]),
      system.f[1] + b[2] * (theta[0] - t0[0]) + b[3] * (theta[1] - t0[1])];
    return this.step(system.a, c, 2, [flap.cosine, flap.sine], dt);
  }

  /** The gyro's spin momentum in body axes: h along its tilted spin axis (the rotor's sign convention). */
  private updateMomentum(): void {
    const g = this.state.controlGyro;
    if (!g) { this.h.x = this.h.y = this.h.z = 0; return; }
    const cfg = this.config(), hs = this.def.rotation * cfg.inertia * cfg.spinRatio * this.state.omega;
    const axis = v3.normalize({ x: -g.pitch, y: g.roll, z: -1 });
    const tilt = this.def.shaftTilt ?? 0;
    Object.assign(this.h, v3.scale(tilt ? toBody(axis, tilt) : axis, hs));
  }
}

// ---------------------------------------------------------------------------------------------------- helpers

function clampUnit(x: number): number { return x < -1 ? -1 : x > 1 ? 1 : x; }
function clampAbs(x: number, limit: number): number { return x < -limit ? -limit : x > limit ? limit : x; }

function airData(a: GyroAir): { kcas: number; sideslip: number } {
  const tas = Math.hypot(a.hub.x, a.hub.y, a.hub.z);
  return { kcas: tas * Math.sqrt(Math.max(a.density, 0) / SEA_LEVEL_DENSITY) / KT,
    sideslip: tas > 1 ? Math.asin(Math.max(-1, Math.min(1, a.hub.y / tas))) : 0 };
}

/** Tilt clamped to the configuration's stops. */
function clampTilt(cfg: ControlGyroConfig, roll: number, pitch: number): { roll: number; pitch: number } {
  const t = cfg.maxTilt;
  return { roll: roll < -t.left ? -t.left : roll > t.right ? t.right : roll,
    pitch: pitch < -t.down ? -t.down : pitch > t.up ? t.up : pitch };
}

/** Rotation matrix by angle a in the (roll, pitch) tilt plane, row-major. */
function rotation(a: number): [number, number, number, number] {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, -s, s, c];
}
/** sgn(h) J with J = [[0, -1], [1, 0]]. */
function sgJ(sg: number): [number, number, number, number] { return [0, -sg, sg, 0]; }
function mul2(a: ArrayLike<number>, b: ArrayLike<number>): [number, number, number, number] {
  return [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3]];
}

/**
 * Matrix exponential of a small dense n x n matrix (row-major), by scaling and squaring of the Taylor series: scaled to
 * a 1-norm of at most 1/4, 14 terms (truncation below 1e-19), then squared back. Plenty for n <= 5 at the step sizes
 * used (|m dt| up to a few at settle's 0.05 s).
 */
export function expm(a: ArrayLike<number>, n: number, out: Float64Array, scratch: Float64Array[]): void {
  let norm = 0;
  for (let j = 0; j < n; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += Math.abs(a[i * n + j]);
    norm = Math.max(norm, s);
  }
  const squarings = norm > 0.25 ? Math.min(60, Math.ceil(Math.log2(norm / 0.25))) : 0;
  const scale = 1 / 2 ** squarings;
  const term = scratch[0], next = scratch[1], tmp = scratch[2];
  for (let i = 0; i < n * n; i++) { term[i] = a[i] * scale; out[i] = term[i]; }
  for (let i = 0; i < n; i++) out[i * n + i] += 1;
  for (let k = 2; k <= 14; k++) {
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      let s = 0;
      for (let l = 0; l < n; l++) s += term[i * n + l] * a[l * n + j];
      next[i * n + j] = s * scale / k;
    }
    for (let i = 0; i < n * n; i++) { term[i] = next[i]; out[i] += next[i]; }
  }
  for (let q = 0; q < squarings; q++) {
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      let s = 0;
      for (let l = 0; l < n; l++) s += out[i * n + l] * out[l * n + j];
      tmp[i * n + j] = s;
    }
    for (let i = 0; i < n * n; i++) out[i] = tmp[i];
  }
}
