import { describe, expect, it } from 'vitest';
import { KT } from '../../src/core/math';
import { BemtSolver } from '../../src/physics/propulsion/bemt';
import { activityFactor, PROP_RADIUS } from '../../src/physics/propulsion/bladeGeometry';
import { Propeller } from '../../src/physics/propulsion/propeller';
import { sharedPropellerMap } from '../../src/physics/propulsion/propellerMap';
import { sectionCoefficients } from '../../src/physics/propulsion/airfoil';

const D = 2 * PROP_RADIUS;
const RHO = 1.225;
const A_SL = 340.3;
const solver = new BemtSolver(20);

/** Axial-flow rotor coefficients from the solver at `rpm` and advance ratio J. */
function coefficients(rpm: number, J: number) {
  const n = rpm / 60;
  const v = J * n * D;
  const loads = solver.rotorLoads(v, 0, 2 * Math.PI * n, RHO, A_SL);
  const power = loads.torque * 2 * Math.PI * n;
  return {
    ct: loads.thrust / (RHO * n * n * D ** 4),
    cp: power / (RHO * n ** 3 * D ** 5),
    eta: J > 0 ? (loads.thrust * v) / power : 0,
    thrust: loads.thrust,
    power,
  };
}

describe('blade section', () => {
  it('is continuous over the full angle range and has finite coefficients', () => {
    const c = { cl: 0, cd: 0 };
    let prev = sectionCoefficients(-Math.PI, 0.3, 0.1, 0.1, c).cl;
    for (let deg = -179.5; deg <= 180; deg += 0.5) {
      sectionCoefficients((deg * Math.PI) / 180, 0.3, 0.1, 0.1, c);
      expect(Number.isFinite(c.cl) && Number.isFinite(c.cd)).toBe(true);
      expect(c.cd).toBeGreaterThan(0);
      expect(Math.abs(c.cl - prev)).toBeLessThan(0.12);
      prev = c.cl;
    }
  });

  it('shows the Clark Y zero-lift angle (to the flat face), a stall, and flat-plate drag broadside', () => {
    const c = { cl: 0, cd: 0 };
    // -4.5 deg to the face: the 9 % member of the Clark Y family (propulsion/airfoil.ts).
    expect(sectionCoefficients((-4.5 * Math.PI) / 180, 0.2, 0.1, 0, c).cl).toBeCloseTo(0, 5);
    const clStall = sectionCoefficients((10 * Math.PI) / 180, 0.2, 0.1, 0, c).cl;
    const clPost = sectionCoefficients((25 * Math.PI) / 180, 0.2, 0.1, 0, c).cl;
    expect(clStall).toBeGreaterThan(1.3);
    expect(clPost).toBeLessThan(clStall);
    expect(sectionCoefficients(Math.PI / 2, 0.2, 0.1, 0, c).cd).toBeGreaterThan(1.4);
  });
});

describe('BEMT propeller', () => {
  it('has a realistic planform (activity factor 85-100 per blade)', () => {
    const af = activityFactor(solver.elements);
    console.log(`activity factor ${af.toFixed(1)}`);
    expect(af).toBeGreaterThan(85);
    expect(af).toBeLessThan(100);
  });

  it('solves every operating point: static, normal, windmilling, stopped, reversed flow, inclined inflow', () => {
    for (const va of [-20, -5, 0, 5, 30, 60, 90]) {
      for (const omega of [0, 50, 150, 280]) {
        for (const vip of [0, 10, 40]) {
          const r = solver.rotorLoads(va, vip, omega, RHO, A_SL, 8);
          for (const x of [r.thrust, r.torque, r.forceZ, r.momentZ]) expect(Number.isFinite(x)).toBe(true);
        }
      }
    }
  });

  it('converges each element to the momentum/blade-element balance', () => {
    const omega = (2400 / 60) * 2 * Math.PI;
    for (const va of [0, 30, 60]) {
      for (const e of solver.elements) {
        const s = solver.solveElement(e, va, omega * e.r, RHO, A_SL);
        // Blade-element thrust per unit span must equal the annulus momentum thrust (Prandtl F included).
        const f = (2 / Math.PI) * Math.acos(Math.exp(-(PROP_RADIUS - e.r) / (e.r * Math.abs(Math.sin(s.phi)))));
        const momentum = (4 * Math.PI * e.r * RHO * f * Math.abs(va + s.u) * s.u) / 2; // per blade
        expect(Math.abs(s.normalForce - momentum)).toBeLessThan(1e-4 * Math.max(1, Math.abs(momentum)));
      }
    }
  });

  it('gives POH-consistent static thrust at 2300-2400 rpm', () => {
    const c = coefficients(2350, 0);
    console.log(`static 2350 rpm: T ${c.thrust.toFixed(0)} N, P ${(c.power / 745.7).toFixed(0)} hp, CT ${c.ct.toFixed(4)}, CP ${c.cp.toFixed(4)}`);
    expect(c.thrust).toBeGreaterThan(1900);
    expect(c.thrust).toBeLessThan(2300);
  });

  it('has the fixed-pitch efficiency curve shape: rises with J, peaks 0.8-0.87 near J 0.75, collapses near zero thrust', () => {
    const js = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];
    const etas = js.map((J) => coefficients(2400, J).eta);
    console.log('eta(J) at 2400 rpm: ' + js.map((J, i) => `${J}:${etas[i].toFixed(3)}`).join(' '));
    const peak = Math.max(...etas);
    const jPeak = js[etas.indexOf(peak)];
    expect(peak).toBeGreaterThan(0.8);
    expect(peak).toBeLessThan(0.87);
    expect(jPeak).toBeGreaterThanOrEqual(0.65);
    expect(jPeak).toBeLessThanOrEqual(0.85);
    for (let i = 1; i < js.length && js[i] <= 0.6; i++) expect(etas[i]).toBeGreaterThan(etas[i - 1]);
    // Zero thrust (onset of windmilling) between J 0.9 and 1.05.
    expect(coefficients(2400, 0.9).ct).toBeGreaterThan(0);
    expect(coefficients(2400, 1.05).ct).toBeLessThan(0);
  });

  it('coefficient map reproduces the solver (axial within 1.5 %, inclined within 4 % of static thrust)', () => {
    const prop = new Propeller(sharedPropellerMap());
    const cases: [number, number, number][] = [
      [2350, 0, 0],
      [2700, 0, 0],
      [2500, 60, 0],
      [2650, 115, 0],
      [1200, 65, 0],
      [2400, 70, 0.2],
      [1200, 65, 0.1],
      [2600, 90, -0.1],
    ];
    for (const [rpm, kt, alpha] of cases) {
      const omega = (rpm / 60) * 2 * Math.PI;
      const v = kt * KT;
      const va = v * Math.cos(alpha);
      const vip = v * Math.sin(alpha);
      const map = prop.evaluate({ x: -va, y: 0, z: -vip }, omega, RHO, A_SL);
      const exact = solver.rotorLoads(va, vip, Math.abs(omega), RHO, A_SL, 8);
      const tol = alpha === 0 ? 0.015 : 0.04;
      console.log(
        `map vs solver ${rpm} rpm ${kt} kt alpha ${alpha}: T ${map.thrust.toFixed(0)}/${exact.thrust.toFixed(0)} N, ` +
          `Q ${map.torque.toFixed(1)}/${exact.torque.toFixed(1)} N m, yaw ${map.hubMoment.z.toFixed(1)}/${exact.momentZ.toFixed(1)} N m`,
      );
      expect(Math.abs(map.thrust - exact.thrust)).toBeLessThan(tol * 2200);
      expect(Math.abs(map.torque - exact.torque)).toBeLessThan(tol * Math.max(Math.abs(exact.torque), 300));
      expect(Math.abs(map.hubMoment.z - exact.momentZ)).toBeLessThan(0.2 * Math.abs(exact.momentZ) + 2);
    }
  });
});

describe('P-factor and slipstream', () => {
  const prop = new Propeller(sharedPropellerMap());
  const omega = (2400 / 60) * 2 * Math.PI;
  const v = 65 * KT;

  it('yaws the nose left and lifts the disc when the inflow comes from below (positive alpha)', () => {
    const alpha = 0.2;
    const loads = prop.evaluate({ x: -v * Math.cos(alpha), y: 0, z: -v * Math.sin(alpha) }, omega, RHO, A_SL);
    console.log(`P-factor at 65 kt, 2400 rpm, alpha 11.5 deg: yaw ${loads.hubMoment.z.toFixed(0)} N m, normal force ${loads.inPlaneForce.z.toFixed(0)} N`);
    expect(loads.hubMoment.z).toBeLessThan(-20);
    expect(loads.hubMoment.y).toBeCloseTo(0, 6);
    expect(loads.inPlaneForce.z).toBeLessThan(0);
  });

  it('P-factor yaws the nose left at full power from the climb to cruise, growing with the inflow angle', () => {
    // The annulus induction is solved for the azimuth-averaged loading, so the advancing blade's extra angle of
    // attack is not absorbed by a local induced velocity (which reversed the P-factor below ~35 m/s at 2400 rpm).
    // At 25 m/s (49 kt, the power-on stall) the outer blade is past its maximum lift (tips at M 0.71, where a 6 %
    // section's cl_max is ~0.8): the advancing blade's extra angle of attack adds no lift there, so the P-factor
    // is about nil (the solver gives +-10 N m at 2400 rpm) and the swirl over the fin carries the left yaw.
    for (const speed of [25, 36, 51]) {
      const yaw: number[] = [];
      for (const a of [4, 8, 12, 16]) {
        const r = (a * Math.PI) / 180;
        yaw.push(prop.evaluate({ x: -speed * Math.cos(r), y: 0, z: -speed * Math.sin(r) }, omega, RHO, A_SL).hubMoment.z);
      }
      console.log(`P-factor yaw at ${speed} m/s, 2400 rpm, alpha 4-16 deg: ${yaw.map((y) => y.toFixed(0)).join(' ')} N m`);
      if (speed < 30) {
        for (const y of yaw) expect(Math.abs(y)).toBeLessThan(15);
        continue;
      }
      for (const y of yaw) expect(y).toBeLessThan(0);
      for (let k = 1; k < yaw.length; k++) expect(yaw[k]).toBeLessThan(yaw[k - 1]);
    }
  });

  it('pitches the nose down with air from the right (sideslip), by axisymmetry', () => {
    const b = 0.2;
    const loads = prop.evaluate({ x: -v * Math.cos(b), y: -v * Math.sin(b), z: 0 }, omega, RHO, A_SL);
    expect(loads.hubMoment.y).toBeLessThan(-20);
    expect(loads.hubMoment.z).toBeCloseTo(0, 6);
  });

  it('produces a contracted, accelerated, co-rotating slipstream', () => {
    prop.evaluate({ x: 0, y: 0, z: 0 }, omega, RHO, A_SL);
    const s = prop.slipstream({ x: 1.95, y: 0, z: 0 }, { origin: { x: 0, y: 0, z: 0 }, radius: 0, inducedVelocity: 0, swirlRate: 0 });
    console.log(`static slipstream: u ${s.inducedVelocity.toFixed(1)} m/s, radius ${s.radius.toFixed(3)} m, swirl ${s.swirlRate.toFixed(1)} rad/s`);
    expect(s.inducedVelocity).toBeGreaterThan(12);
    expect(s.radius).toBeCloseTo(PROP_RADIUS / Math.SQRT2, 3);
    expect(s.swirlRate).toBeGreaterThan(0);
  });
});

describe('blade-tip compressibility', () => {
  // Near its design lift a 6 % cambered tip section has a critical Mach number of ~0.70 (Korn's equation for a
  // 6 % section at cl 0.4: M_dd 0.77, M_crit ~0.66-0.70; Mason, "Configuration Aerodynamics" ch. 7), so a climb or
  // cruise tip at a helical Mach number of 0.72 carries almost no wave drag. The suction peak used to be measured
  // from zero lift, as for a symmetric section, which put M_crit at ~0.55 there and cost the climb at altitude.
  it('a 6 % tip section near its design lift has little wave drag at M 0.72', () => {
    const c = { cl: 0, cd: 0 };
    // Angle of attack (to the flat face) for cl ~0.42 at low Mach.
    let alpha = -3.8 * (Math.PI / 180);
    while (sectionCoefficients(alpha, 0.3, 0.06, 0, c).cl < 0.42) alpha += 0.0005;
    const low = sectionCoefficients(alpha, 0.3, 0.06, 0, c).cd;
    const high = sectionCoefficients(alpha, 0.72, 0.06, 0, c).cd;
    console.log(`6 % section at cl 0.42: cd ${low.toFixed(4)} at M 0.3, ${high.toFixed(4)} at M 0.72`);
    expect(high - low).toBeLessThan(0.0015);
  });

  it('a heavily loaded tip section still meets drag rise well below M 0.72', () => {
    const c = { cl: 0, cd: 0 };
    // cl ~1.0, far above the design lift: the leading-edge suction peak is back.
    let alpha = -3.8 * (Math.PI / 180);
    while (sectionCoefficients(alpha, 0.3, 0.06, 0, c).cl < 1.0) alpha += 0.0005;
    const low = sectionCoefficients(alpha, 0.3, 0.06, 0, c).cd;
    const high = sectionCoefficients(alpha, 0.62, 0.06, 0, c).cd;
    console.log(`6 % section at cl 1.0: cd ${low.toFixed(4)} at M 0.3, ${high.toFixed(4)} at M 0.62`);
    expect(high - low).toBeGreaterThan(0.01);
  });
});
