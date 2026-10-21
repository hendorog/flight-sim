// AH-56A control gyro modes (AG, plan revision 2 section 7.2, G2): the coupled gyro + flap system of one step
// (ControlGyro.linearize, the matrix advanceCoupled exponentiates) on the AH-56A rotor, fixed shaft, against rotor
// speed; the stability the exact step relies on at 240 Hz and at settle's 0.05 s; the sense checks of the residual
// rotations. The CR-114362 rig's low-rpm instability is not a target (a constant-speed gyro and a feathering DOF).
import { describe, expect, it } from 'vitest';
import { AH56_ROTORCRAFT } from '../../src/aircraft/ah56/rotorcraft';
import { AH56_DEFINITION } from '../../src/aircraft/ah56';
import { Rotorcraft } from '../../src/physics/rotorcraft/rotorcraft';
import type { ControlGyroConfig, FlapSystem, GyroBladeMoments, GyroConfigId } from '../../src/physics/rotorcraft/controlGyro';
import type { RotorcraftDefinition } from '../../src/physics/rotorcraft/definition';
import { cloneControls, defaultControls } from '../../src/core/types';
import { DEG, KT, quat, v3 } from '../../src/core/math';
import { DT, report } from './ah56Rig';

type C = [number, number];
/** Eigenvalues of a real 4x4 (row-major): Faddeev-LeVerrier polynomial, Durand-Kerner roots. */
export function eigenvalues4(m: ArrayLike<number>): C[] {
  const n = 4, c = [1];
  let mk = new Array<number>(16).fill(0);
  for (let k = 1; k <= n; k++) {
    const prev = mk.slice();
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      let s = 0;
      for (let l = 0; l < n; l++) s += m[i * n + l] * prev[l * n + j];
      mk[i * n + j] = s + (i === j ? c[k - 1] : 0);
    }
    let tr = 0;
    for (let i = 0; i < n; i++) { let s = 0; for (let l = 0; l < n; l++) s += m[i * n + l] * mk[l * n + i]; tr += s; }
    c.push(-tr / k);
  }
  const mul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
  const div = (a: C, b: C): C => { const q = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / q, (a[1] * b[0] - a[0] * b[1]) / q]; };
  const poly = (z: C): C => { let r: C = [1, 0]; for (let k = 1; k <= n; k++) { const t = mul(r, z); r = [t[0] + c[k], t[1]]; } return r; };
  let z: C[] = [[12, 27], [-27, 12], [9, -21], [-18, -24]];
  for (let it = 0; it < 800; it++) z = z.map((zi, i) => {
    let d: C = [1, 0];
    z.forEach((zj, j) => { if (j !== i) d = mul(d, [zi[0] - zj[0], zi[1] - zj[1]]); });
    const step = div(poly(zi), d);
    return [zi[0] - step[0], zi[1] - step[1]] as C;
  });
  return z.sort((a, b) => a[0] - b[0]);
}

function patched(cfg: GyroConfigId, patch: Partial<ControlGyroConfig>): RotorcraftDefinition {
  const g = AH56_ROTORCRAFT.controlGyro!;
  return { ...AH56_ROTORCRAFT, controlGyro: { ...g, configs: { ...g.configs, [cfg]: { ...g.configs[cfg], ...patch } } } };
}

/** The coupled matrix at a rotor speed (fraction of the configuration's governed speed), fixed shaft, at `kt`. */
function coupled(def: RotorcraftDefinition, cfg: GyroConfigId, fraction: number, kt = 0) {
  const rc = new Rotorcraft(def);
  rc.reset(true, cfg);
  rc.state.omega *= fraction; rc.state.rotorRpm *= fraction;
  const c = cloneControls(defaultControls(AH56_DEFINITION)); c.collective = 0.62;
  const b = { time: 0, position: { x: 0, y: 0, z: -1000 }, orientation: quat.fromEuler(0, 0, 0), velocityBody: { x: kt * KT, y: 0, z: 0 },
    angularVelocity: v3.zero(), cgOffset: v3.zero(), mass: 8301 };
  rc.settle(b, v3.zero(), 1.225, 1000, c);
  let sys: FlapSystem | undefined, blade: GyroBladeMoments | undefined;
  const g = rc.gyro!, orig = g.advanceCoupled.bind(g);
  (g as unknown as { advanceCoupled: typeof orig }).advanceCoupled = (dt, cc, rate, s, f, bl, air) => { sys = s; blade = bl; return orig(dt, cc, rate, s, f, bl, air); };
  rc.compute(b, v3.zero(), 1.225, 1000, c, DT);
  const cfgData = def.controlGyro!.configs[cfg];
  const h = cfgData.inertia * cfgData.spinRatio * rc.state.omega;
  const loop = cfgData.feedback.mode === 'featheringMoment' ? Math.tan(cfgData.feedback.sweep) * sys!.hub[1] / h : cfgData.feedback.gain / h;
  return { m: g.linearize(c, v3.zero(), sys!, blade).m, omega: rc.state.omega, loop, rc, c, b };
}

describe('G2: mode structure against rotor speed (ICS, fixed shaft, hover)', () => {
  const FRACTIONS = [0.7, 0.83, 0.9, 1.0, 1.1];
  const rows = FRACTIONS.map((f) => ({ f, ...coupled(AH56_ROTORCRAFT, 'ics', f) }));

  it('every mode is stable at 83 % Nr and above (P: APE-I take-off at 83 % with high shaft moments, no instability)', () => {
    for (const r of rows) {
      const ev = eigenvalues4(r.m);
      report(`G2 ICS ${(r.f * 100).toFixed(0)} % Nr`, { eigen: ev.map(([a, b]) => `${a.toFixed(2)}${b >= 0 ? '+' : '-'}${Math.abs(b).toFixed(2)}i`).join(' '),
        loopGainPerSec: r.loop, loopOverOmega: r.loop / r.omega });
      if (r.f >= 0.83) for (const [re] of ev) expect(re).toBeLessThan(0);
    }
  });

  it.fails('G2 (i) KNOWN GAP: the auto-trim loop gain Lambda K_hub / H scales as Omega within 10 % (70-110 % Nr)', () => {
    // The hingeless hub's moment per rad of flap is (B/2)(e M_beta Omega^2 + K_beta): the spring half of it does not grow
    // with Omega, so Lambda K_hub / H (H proportional to Omega) is nearly flat instead of proportional to Omega.
    const at100 = rows.find((r) => r.f === 1)!;
    for (const r of rows) expect((r.loop / r.omega) / (at100.loop / at100.omega)).toBeCloseTo(1, 1);
  });

  it('the loop gain is of the plan\'s order (tens of rad/s): no sequential coupling could step it at 240 Hz', () => {
    const at100 = rows.find((r) => r.f === 1)!;
    report('G2 loop gain at 100 %', { perSec: at100.loop, planEstimate: 49, perStepAt240Hz: at100.loop * DT, perStepAtSettle: at100.loop * 0.05 });
    expect(at100.loop).toBeGreaterThan(20);
    expect(at100.loop).toBeLessThan(60);
  });
});

describe('stability of the exact step and the senses', () => {
  it('the AMCS modes are stable at 83 % Nr and above, hover and 100 KTAS', () => {
    for (const kt of [0, 100]) for (const f of [0.83, 1.0, 1.1]) {
      const ev = eigenvalues4(coupled(AH56_ROTORCRAFT, 'amcs', f, kt).m);
      for (const [re] of ev) expect(re).toBeLessThan(0);
    }
  });

  it('settle converges the gyro with the flap (0.05 s exact steps): repeated settles agree', () => {
    for (const cfg of ['amcs', 'ics'] as const) {
      const { rc, c, b } = coupled(AH56_ROTORCRAFT, cfg, 1, 100);
      rc.settle(b, v3.zero(), 1.225, 1000, c);
      const first = { ...rc.state.controlGyro! };
      rc.settle(b, v3.zero(), 1.225, 1000, c);
      expect(rc.state.controlGyro!.pitch).toBeCloseTo(first.pitch, 6);
      expect(rc.state.controlGyro!.roll).toBeCloseTo(first.roll, 6);
    }
  });

  it('the feedback sense: the published 33 deg cant "advanced" is stable and well inside the damped band; the other sense diverges', () => {
    // FEEDBACK_SENSE = -1: a positive angle turns the feedback in the rotation direction ("advanced"). The same 33 deg in
    // the opposite sense puts a pair of roots in the right half plane. The model's best-damped phase is about 20 deg (the
    // AMCS flies it, ESTIMATE); the ICS keeps the P 33 deg, within the plan's +/-15 deg (G8).
    const worst = (deg: number) => Math.max(...eigenvalues4(coupled(patched('ics', { feedbackRotation: deg * DEG }), 'ics', 1).m).map(([re]) => re));
    const rows = [-33, 0, 10, 15, 20, 25, 30, 33, 40, 50].map((deg) => ({ deg, worst: worst(deg) }));
    report('feedback sense (ICS hover, least-damped real part, 1/s)', Object.fromEntries(rows.map((r) => [`${r.deg}deg`, r.worst])));
    expect(rows.find((r) => r.deg === -33)!.worst).toBeGreaterThan(0);
    const best = rows.reduce((a, b) => (b.worst < a.worst ? b : a));
    expect(Math.abs(best.deg - 33)).toBeLessThanOrEqual(15);
    expect(rows.find((r) => r.deg === 33)!.worst).toBeLessThan(0.5 * best.worst);
  });
});
