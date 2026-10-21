// Twin turboshaft drivetrain (TW, plan revision 2 section 5): the joint freewheel impulse and the coupling rows T2-T4.
// T2 and T3 run the Rotorcraft's drive seam alone with two engine shafts driven by known torques (so the work put in
// is exact); T4 flies the twin rig (twinRig.ts). TWIN_TRACE=<dir> writes the report.
import { afterAll, describe, expect, it } from 'vitest';
import { defaultControls } from '../../src/core/types';
import { Rotorcraft } from '../../src/physics/rotorcraft/rotorcraft';
import { jointFreewheelImpulse } from '../../src/physics/rotorcraft/twinTurboshaft';
import type { EngineUnit } from '../../src/physics/propulsion/engineUnit';
import { DT, TWIN_DEF, attitudePilot, d, gauges, lever, LEVER, rig, run, writeTrace } from './twinRig';

const report: Record<string, unknown> = {};
afterAll(() => writeTrace('twinDrive', report));

/** An engine output shaft: speed, inertia and the fields the turboshaft's gauges read. Not a turbine (N1 reads 0). */
function shaft(omega: number) {
  const e = { omega, inertia: 0.11, gearRatio: 1, engine: {}, install: { engine: { ratedRpm: 6016 } },
    state: { rpm: 0, torque: 0 }, get rpm() { return this.omega * 30 / Math.PI; } };
  return e;
}
type Shaft = ReturnType<typeof shaft>;

/**
 * Drive the rotor for `seconds` with engine torques `torque(t, i)` (N m at each output shaft) and the aerodynamic load
 * `load(t)` (N m at the rotor); `order` says which engine goes to drive() first. Returns the rotor speed trace and the
 * energy terms.
 */
function drivetrain(seconds: number, torque: (t: number, i: number, e: Shaft) => number, load: (t: number) => number, order: [0, 1] | [1, 0], dt = DT) {
  const rotor = new Rotorcraft(d);
  rotor.reset(true);
  const c = defaultControls(TWIN_DEF);
  const r = d.engineRatio, omega0 = rotor.state.omega * r;
  const engines = [shaft(omega0 * 0.999), shaft(omega0 * 0.98)];
  const inertia = d.main.inertia + d.tail.inertia * d.tailRatio ** 2;
  const trace: number[] = [];
  let shaftWork = 0, aeroWork = 0;
  const ke = () => 0.5 * inertia * rotor.state.omega ** 2;
  const keEngines = () => engines.reduce((sum, e) => sum + 0.5 * e.inertia * e.omega ** 2, 0);
  const rotorKe0 = ke(), engineKe0 = keEngines();
  for (let k = 0, n = Math.round(seconds / dt); k < n; k++) {
    const t = k * dt;
    for (let i = 0; i < 2; i++) {
      const e = engines[i], q = torque(t, i, e), before = e.omega;
      e.omega = Math.max(0, e.omega + q / e.inertia * dt);
      e.state.torque = q;
      // Work at the shaft speed the step starts from: the coupled speed (the engine's own acceleration over the step,
      // taken back by the freewheel's impulse, is the split integration's, not the coupled shaft's).
      shaftWork += q * dt * before;
    }
    rotor.state.torque = load(t);
    aeroWork += rotor.state.torque * rotor.state.omega * dt;
    const [a, b] = order.map((i) => engines[i] as unknown as EngineUnit);
    rotor.drive(dt, c, a, undefined, undefined, 28, false, [b]);
    trace.push(rotor.state.omega);
  }
  return { trace, shaftWork, aeroWork, rotorGain: ke() - rotorKe0, engineGain: keEngines() - engineKe0, engines };
}

/** A 20 s manoeuvre: both engines governed on N2 by a proportional law (engine 2 rigged 2 % richer); engine 2 cut at
 *  6 s (its friction only) and relit at 12 s; the load swings and steps down as a collective would. */
const ratedOmega = 6016 * Math.PI / 30;
const load = (t: number): number => 5200 + 1400 * Math.sin(0.6 * t) + (t > 15 ? -2500 : 0);
const torque = (t: number, i: number, e: Shaft): number => {
  if (i === 1 && t > 6 && t < 12) return -20;
  return Math.max(0, 210 + 4000 * (ratedOmega - e.omega) / ratedOmega) * (i === 0 ? 1 : 1.02);
};

describe('the joint freewheel impulse (closed form)', () => {
  it('one engine and no cap: the legacy single-engine impulse excess / (1/I_e + eta r^2 / I), to 1e-12', () => {
    const inertia = 909, ratio = d.engineRatio, eta = d.transmissionEfficiency;
    for (const [omega, we] of [[44, 625], [44.4, 629.3], [40, 700], [44, 600]]) {
      const excess = we - omega * ratio;
      const legacy = excess > 0 ? excess / (1 / 0.11 + eta * ratio ** 2 / inertia) : 0;
      expect(Math.abs(jointFreewheelImpulse(omega, inertia, [{ omega: we, inertia: 0.11 }], ratio, eta, Infinity, DT)[0] - legacy)).toBeLessThan(1e-12);
    }
  });

  it('both engaged: they end at the one shaft speed; a slower engine stays out; the cap holds each engine', () => {
    const inertia = 909, ratio = d.engineRatio, eta = d.transmissionEfficiency, omega = 44;
    const engines = [{ omega: 625, inertia: 0.11 }, { omega: 624.5, inertia: 0.12 }];
    const j = jointFreewheelImpulse(omega, inertia, engines, ratio, eta, Infinity, DT);
    const after = omega + (j[0] + j[1]) * ratio * eta / inertia;
    expect(j[0]).toBeGreaterThan(0); expect(j[1]).toBeGreaterThan(0);
    for (let i = 0; i < 2; i++) expect(Math.abs(engines[i].omega - j[i] / engines[i].inertia - after * ratio)).toBeLessThan(1e-9);
    const slow = jointFreewheelImpulse(omega, inertia, [{ omega: 625, inertia: 0.11 }, { omega: 600, inertia: 0.11 }], ratio, eta, Infinity, DT);
    expect(slow[1]).toBe(0);
    // A second engine just above the first's post-impulse speed but below its pre-impulse one: it drops out.
    const mid = jointFreewheelImpulse(omega, inertia, [{ omega: 640, inertia: 0.11 }, { omega: omega * ratio + 1e-6, inertia: 0.11 }], ratio, eta, Infinity, DT);
    expect(mid[1]).toBe(0);
    const capped = jointFreewheelImpulse(omega, inertia, engines, ratio, eta, 100, DT);
    expect(capped[0]).toBeLessThanOrEqual(100 * DT + 1e-15); expect(capped[1]).toBeLessThanOrEqual(100 * DT + 1e-15);
  });

  it('the fixed point over a sweep of caps: v = r omega + a sum J and every J_i = clamp(I_i (omega_i - v), 0, cap), including a capped engine that must come off the cap when a marginal engine drops out', () => {
    const inertia = 909, ratio = d.engineRatio, eta = d.transmissionEfficiency, omega = 44, a = eta * ratio ** 2 / inertia;
    const base = omega * ratio;
    // A: far above the rotor (reaches the cap at the low caps); B: just above it with a large inertia, so it pulls the
    // joint speed down while it is counted and then drops out; C: below the rotor.
    const sets = [
      [{ omega: base + 100, inertia: 0.11 }, { omega: base + 0.2, inertia: 5 }],
      [{ omega: base + 0.2, inertia: 5 }, { omega: base + 100, inertia: 0.11 }, { omega: base - 3, inertia: 0.11 }],
      [{ omega: base + 40, inertia: 0.11 }, { omega: base + 30, inertia: 0.12 }],
    ];
    let worst = 0, checked = 0;
    for (const engines of sets) {
      for (let k = 0; k <= 400; k++) {
        const capNm = k === 400 ? Infinity : 50 + 15 * k, cap = capNm * DT;
        const j = jointFreewheelImpulse(omega, inertia, engines, ratio, eta, capNm, DT);
        const v = base + a * j.reduce((sum, x) => sum + x, 0);
        engines.forEach((e, i) => {
          worst = Math.max(worst, Math.abs(j[i] - Math.min(cap, Math.max(0, e.inertia * (e.omega - v)))));
          checked++;
        });
      }
    }
    report.fixedPoint = { checked, worstNms: worst };
    // Rounding only (impulses up to about 3000 N m s on the 5 kg m^2 shaft); the active-set solver it replaced was 0.46 off.
    expect(worst).toBeLessThan(1e-9);
  });
});

describe('twin drivetrain (T2-T4)', () => {
  it('T2 order independence: engine indices swapped, the rotor speed is identical over 10 s (<= 1e-12 rad/s)', () => {
    const a = drivetrain(10, torque, load, [0, 1]).trace, b = drivetrain(10, torque, load, [1, 0]).trace;
    let worst = 0;
    for (let k = 0; k < a.length; k++) worst = Math.max(worst, Math.abs(a[k] - b[k]));
    report.T2 = { steps: a.length, maxDifferenceRadS: worst, omegaEnd: a[a.length - 1] };
    expect(worst).toBeLessThanOrEqual(1e-12);
  });

  it('T3 energy: engine shaft work - transmission loss = rotor energy gained + aerodynamic work over a 20 s manoeuvre (+/- 0.5 %)', () => {
    const r = drivetrain(20, torque, load, [0, 1]);
    const delivered = r.shaftWork - r.engineGain;
    const loss = (1 - d.transmissionEfficiency) * delivered;
    const lhs = r.shaftWork - r.engineGain - loss, rhs = r.rotorGain + r.aeroWork;
    report.T3 = { shaftWorkJ: r.shaftWork, engineSpoolJ: r.engineGain, transmissionLossJ: loss, rotorGainJ: r.rotorGain,
      aeroWorkJ: r.aeroWork, errorPct: 100 * (lhs - rhs) / r.shaftWork };
    expect(Math.abs(lhs - rhs) / r.shaftWork).toBeLessThanOrEqual(0.005);
  });

  it('T4 freewheel: engine 2 at IDLE with engine 1 driving reads torque 0 and needles split, Nr governed by engine 1; collective down in autorotation splits both', () => {
    const r = rig({ kg: 2200, kt: 60 });
    lever(r.c, 1, LEVER.idle);
    run(r, 20);
    const g = gauges(r);
    report.T4 = { idle: { nr: g.nr, tq: g.tq, n2: g.n2, split: g.split, n1: g.n1 } };
    expect(g.split).toEqual([false, true]);
    expect(Math.abs(g.tq[1])).toBeLessThan(0.5);
    expect(g.tq[0]).toBeGreaterThan(40);
    expect(g.nr).toBeGreaterThanOrEqual(98); expect(g.nr).toBeLessThanOrEqual(102);
    // Practice autorotation at 60 KIAS: both levers to IDLE, collective full down, attitude held; the rotor overruns both
    // freewheels.
    const hold = attitudePilot(r, true);
    lever(r.c, 0, LEVER.idle);
    r.c.collective = 0;
    run(r, 8, () => hold(DT));
    const auto = gauges(r);
    (report.T4 as Record<string, unknown>).autorotation = { nr: auto.nr, n2: auto.n2, split: auto.split, tq: auto.tq };
    expect(auto.split).toEqual([true, true]);
    expect(Math.abs(auto.tq[0]) + Math.abs(auto.tq[1])).toBeLessThan(1);
  }, 30_000);
});

