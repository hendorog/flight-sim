// The propeller chain with a blade angle: blade geometry turned about its pitch axis, the slices of a
// constant-speed propeller against the solver they are tabulated from, the feathered blade, and the rotation
// sense. The two constant-speed test-bed propellers stand for the PA-34's and the DA42's (testbed.ts).

import { describe, expect, it } from 'vitest';
import { DEG, HP, KT, type Vec3 } from '../../src/core/math';
import type { Slipstream } from '../../src/physics/interfaces';
import { Powerplant } from '../../src/physics/propulsion';
import { BemtSolver } from '../../src/physics/propulsion/bemt';
import { bladeAngleAt, bladeElements } from '../../src/physics/propulsion/bladeGeometry';
import { C172_PROPELLER } from '../../src/physics/propulsion/c172Powerplant';
import type { PropellerDef } from '../../src/physics/propulsion/defs';
import { Propeller } from '../../src/physics/propulsion/propeller';
import { PROP_MAX_SLICES, PropellerCharacteristics, propellerCharacteristicsFor, sliceGrid } from '../../src/physics/propulsion/propellerMap';
import { isa, makeInput } from './helpers';
import { CS_PROPELLER, DIESEL_PROPELLER, TWIN_CS_POWERPLANT, TWIN_DIESEL_POWERPLANT, constantSpeedUnit, dieselUnit, singlePowerplant } from './testbed';

const RPM = Math.PI / 30;
const SEA_LEVEL = isa(0);

function slipstreamOf(p: Propeller): Slipstream {
  return p.slipstream({ x: 0, y: 0, z: 0 }, { origin: { x: 0, y: 0, z: 0 }, radius: 0, inducedVelocity: 0, swirlRate: 0 });
}

describe('a blade that turns about its pitch axis', () => {
  it('has the blade angle asked for at the reference station, and every station moves by the same angle', () => {
    // Hartzell quotes blade angles at the 30 in station: 0.79 R of a 76 in propeller (pa34.md, section 5).
    expect(CS_PROPELLER.referenceStation).toBe(0.79);
    for (const pitch of [13.5 * DEG, 25 * DEG, 80 * DEG]) {
      expect(bladeAngleAt(CS_PROPELLER, 0.79, pitch)).toBeCloseTo(pitch, 12);
      // The twist of the test-bed blade is that of a helix set to 22 degrees: root coarser, tip finer.
      expect(bladeAngleAt(CS_PROPELLER, 0.3, pitch)).toBeGreaterThan(pitch + 10 * DEG);
      expect(bladeAngleAt(CS_PROPELLER, 1.0, pitch)).toBeLessThan(pitch - 3 * DEG);
    }
    const fine = bladeElements(14, CS_PROPELLER, 13.5 * DEG);
    const coarse = bladeElements(14, CS_PROPELLER, 30 * DEG);
    for (let i = 0; i < fine.length; i++) {
      expect(coarse[i].theta - fine[i].theta).toBeCloseTo(16.5 * DEG, 12);
      // The planform does not turn with the blade.
      expect(coarse[i].chord).toBe(fine[i].chord);
      expect(coarse[i].r).toBe(fine[i].r);
    }
    // Set to its design angle the table gives back the helix it was made from: tan(theta) r = constant.
    const design = bladeElements(14, CS_PROPELLER, 22 * DEG);
    for (const e of design) expect(Math.tan(e.theta) * e.r).toBeCloseTo(Math.tan(22 * DEG) * 0.79 * (CS_PROPELLER.diameter / 2), 2);
  });

  it('leaves a fixed-pitch blade as it was, and turns a helix blade as a whole when given an angle', () => {
    const asBuilt = bladeElements(14, C172_PROPELLER);
    const station = 0.75;
    const builtAngle = bladeAngleAt(C172_PROPELLER, station);
    // The Cessna 172S blade: 60 in of pitch at 0.75 of a 38 in radius is atan(60 / (2 pi 28.5)) = 18.53 degrees.
    expect(builtAngle / DEG).toBeCloseTo(18.53, 2);
    const same = bladeElements(14, C172_PROPELLER, builtAngle);
    const turned = bladeElements(14, C172_PROPELLER, builtAngle + 5 * DEG);
    for (let i = 0; i < asBuilt.length; i++) {
      expect(same[i].theta).toBeCloseTo(asBuilt[i].theta, 12);
      expect(turned[i].theta - asBuilt[i].theta).toBeCloseTo(5 * DEG, 12);
    }
    // A coarser blade takes more torque at the same speed (40 m/s, 2400 rpm): 5 degrees more is about a quarter more.
    const q = (pitch?: number): number => new BemtSolver(14, C172_PROPELLER, pitch).rotorLoads(40, 0, 2400 * RPM, 1.225, 340).torque;
    expect(q(builtAngle)).toBeCloseTo(q(), 9);
    expect(q(builtAngle + 5 * DEG)).toBeGreaterThan(1.2 * q());
  });
});

describe('the slices of a constant-speed propeller', () => {
  it('are one map per pitch node on a grid laid round the blade angle, within the budget', () => {
    for (const def of [CS_PROPELLER, DIESEL_PROPELLER]) {
      const c = propellerCharacteristicsFor(def);
      const control = def.pitchControl as Extract<PropellerDef['pitchControl'], { kind: 'constantSpeed' }>;
      expect(c.variablePitch).toBe(true);
      expect(c.sliceCount).toBe(control.pitchNodes.length);
      expect(c.sliceCount).toBeLessThanOrEqual(PROP_MAX_SLICES);
      expect(c.pitchNodes[0]).toBe(control.fineStop);
      expect(c.pitchNodes[c.sliceCount - 1]).toBe(control.feather!.angle);
    }
    for (const angle of [12, 13.5, 22, 31, 46, 80, 81]) {
      const grid = sliceGrid(angle * DEG);
      const beta = grid.beta.map((b) => Math.round((b / DEG) * 1e6) / 1e6);
      // -20 .. +90 degrees, with the static propeller (0) and the stopped one (90) on nodes.
      expect(beta[0]).toBe(-20);
      expect(beta[beta.length - 1]).toBe(90);
      expect(beta).toContain(0);
      for (let i = 1; i < beta.length; i++) {
        const step = beta[i] - beta[i - 1];
        expect(step).toBeGreaterThan(0);
        // 2 degrees within 20 degrees of the blade angle, never more than 5 anywhere.
        const inBand = Math.abs(0.5 * (beta[i] + beta[i - 1]) - angle) < 19;
        expect(step).toBeLessThanOrEqual(inBand ? 2 + 1e-9 : 5 + 1e-9);
      }
      expect(beta.length * grid.eta.length * grid.mach.length).toBeLessThanOrEqual(2000);
      expect(grid.single).toBe(true);
    }
    const slice = propellerCharacteristicsFor(CS_PROPELLER).slice(0);
    expect(slice.points).toBeLessThanOrEqual(2000);
    expect((slice as unknown as { table: unknown }).table).toBeInstanceOf(Float32Array);
  });

  it('are refused when the pitch nodes do not describe the blade\'s travel', () => {
    const control = CS_PROPELLER.pitchControl as Extract<PropellerDef['pitchControl'], { kind: 'constantSpeed' }>;
    const withNodes = (pitchNodes: number[]): PropellerDef => ({ ...CS_PROPELLER, pitchControl: { ...control, pitchNodes } });
    expect(() => new PropellerCharacteristics(withNodes([0.3]))).toThrow(/pitch nodes/);
    expect(() => new PropellerCharacteristics(withNodes(Array.from({ length: 17 }, (_, i) => control.fineStop + i * 0.07)))).toThrow(/pitch nodes/);
    expect(() => new PropellerCharacteristics(withNodes([control.fineStop, 0.8, 0.6, control.coarseStop]))).toThrow(/ascend/);
    expect(() => new PropellerCharacteristics(withNodes([control.fineStop, 1.0]))).toThrow(/span/);
    expect(() => new PropellerCharacteristics(withNodes([control.fineStop + 0.05, control.coarseStop]))).toThrow(/span/);
  });

  // Twelve operating points a governed unit actually reaches (take-off roll, climb, cruise, descent; its speed
  // and blade angle from settle(), so the angle lies between two slices as it happens to), each compared with
  // the blade-element solver the slices were tabulated from, run at that very blade angle. The interpolation
  // error in thrust and in torque is to stay within 3 %.
  it('reproduce the live solver within 3 % of thrust and torque at twelve operating points', () => {
    const report: string[] = [];
    let points = 0;
    for (const [pp, conditions] of [
      [singlePowerplant(constantSpeedUnit(1)), [[0, 0, 1, 1], [50, 0, 1, 1], [90, 0, 1, 1], [100, 3000, 1, 0.8], [140, 6000, 1, 0.75], [120, 4000, 0.45, 0.6]]],
      [singlePowerplant(dieselUnit(), TWIN_DIESEL_POWERPLANT), [[0, 0, 1, 1], [50, 0, 1, 1], [85, 0, 0.92, 1], [120, 6000, 0.92, 1], [150, 10000, 0.75, 1], [100, 3000, 0.3, 1]]],
    ] as const) {
      const install = pp.engines[0];
      const sys = new Powerplant(pp);
      const prop = new Propeller(propellerCharacteristicsFor(install.propeller));
      for (const [ktas, altitudeFt, throttle, propeller] of conditions) {
        sys.reset({ running: true, tanks: [70, 70], rpm: install.engine.airStartRpm });
        const out = sys.settle(makeInput({ ktas, altitudeFt, controls: { fuelSelector: 'on', throttle, propeller } }));
        const omega = sys.units[0].omega;
        const pitch = out.propeller.bladePitch;
        const atm = isa(altitudeFt * 0.3048);
        const v = ktas * KT;
        const live = new BemtSolver(14, install.propeller, pitch).rotorLoads(v, 0, omega, atm.density, atm.speedOfSound);
        const map = prop.evaluate({ x: -v, y: 0, z: 0 }, omega, atm.density, atm.speedOfSound, pitch);
        report.push(
          `${ktas} kt ${altitudeFt} ft: ${(omega / RPM).toFixed(0)} rpm, ${(pitch / DEG).toFixed(2)} deg, ${((live.torque * omega) / HP).toFixed(0)} hp: ` +
            `thrust ${live.thrust.toFixed(0)} N (${((map.thrust / live.thrust - 1) * 100).toFixed(2)} %), torque ${live.torque.toFixed(0)} N m (${((map.torque / live.torque - 1) * 100).toFixed(2)} %)`,
        );
        // Every point is a loaded propeller: the relative error means something.
        expect(live.thrust).toBeGreaterThan(500);
        expect(live.torque).toBeGreaterThan(150);
        expect(Math.abs(map.thrust / live.thrust - 1)).toBeLessThan(0.03);
        expect(Math.abs(map.torque / live.torque - 1)).toBeLessThan(0.03);
        points++;
      }
    }
    console.log(`slices against the live solver:\n  ${report.join('\n  ')}`);
    expect(points).toBe(12);
  }, 60_000);

  // review-Bm-propulsion F2: the twelve points above all lay close to a node or away from the stall of the inboard
  // sections; between nodes at low advance ratio the slices blended at the same advance angle were 7-13 % off.
  // Here every midpoint between two nodes up to 45 degrees, at three speeds of rotation and from static to
  // 85 m/s (the loaded points only: thrust > 300 N, torque > 100 N m).
  it('reproduce the live solver within 5 % between every pair of nodes, static to 85 m/s', () => {
    const atm = isa(0);
    const report: string[] = [];
    for (const [def, rpms] of [[CS_PROPELLER, [1800, 2300, 2700]], [DIESEL_PROPELLER, [1800, 2100, 2300]]] as const) {
      const c = propellerCharacteristicsFor(def);
      const prop = new Propeller(c);
      let worst = 0, where = '', count = 0;
      for (let k = 0; k + 1 < c.sliceCount && c.pitchNodes[k] < 45 * DEG; k++) {
        const pitch = 0.5 * (c.pitchNodes[k] + c.pitchNodes[k + 1]);
        for (const rpm of rpms) {
          for (const v of [0, 10, 20, 25, 30, 40, 55, 70, 85]) {
            const live = new BemtSolver(14, def, pitch).rotorLoads(v, 0, rpm * RPM, atm.density, atm.speedOfSound);
            if (!(live.thrust > 300 && live.torque > 100)) continue;
            const map = prop.evaluate({ x: -v, y: 0, z: 0 }, rpm * RPM, atm.density, atm.speedOfSound, pitch);
            const error = Math.max(Math.abs(map.thrust / live.thrust - 1), Math.abs(map.torque / live.torque - 1));
            count++;
            if (error > worst) {
              worst = error;
              where = `${(pitch / DEG).toFixed(2)} deg, ${rpm} rpm, ${v} m/s`;
            }
          }
        }
      }
      report.push(`${def.name}: ${count} points, worst ${(worst * 100).toFixed(2)} % at ${where}`);
      expect(count).toBeGreaterThan(100);
      expect(worst).toBeLessThan(0.05);
    }
    console.log(`slices between nodes against the live solver:\n  ${report.join('\n  ')}`);
  }, 60_000);

  // review-Bm-propulsion F3: on its fine stop a constant-speed propeller is unstalled and its thrust falls with
  // speed (NACA TR 640, blade angles below 20 degrees); static figure of merit 0.5-0.7 for the class. The CS
  // test-bed blade with the 172's section had 0.22 and gained 34 % thrust by 30 m/s: its tips, at Mach 0.8, were
  // stalled. A definition's blade must pass the same check before its airframe drag is tuned (Stage D).
  it('on the fine stop at full rpm the test-bed propellers lose thrust as speed rises, from a sound static figure of merit', () => {
    const atm = isa(0);
    const rows: string[] = [];
    for (const [def, rpm] of [[CS_PROPELLER, 2700], [DIESEL_PROPELLER, 2300]] as const) {
      const prop = new Propeller(propellerCharacteristicsFor(def));
      const fine = (def.pitchControl as Extract<PropellerDef['pitchControl'], { kind: 'constantSpeed' }>).fineStop;
      const omega = rpm * RPM;
      const thrust: number[] = [];
      let staticTorque = 0;
      for (let v = 0; v <= 30; v += 2.5) {
        const loads = prop.evaluate({ x: -v, y: 0, z: 0 }, omega, atm.density, atm.speedOfSound, fine);
        thrust.push(loads.thrust);
        if (v === 0) staticTorque = loads.torque;
      }
      const R = def.diameter / 2;
      const merit = Math.pow(thrust[0], 1.5) / (staticTorque * omega * Math.sqrt(2 * atm.density * Math.PI * R * R));
      rows.push(`${def.name}: static ${thrust[0].toFixed(0)} N, ${((staticTorque * omega) / 1000).toFixed(0)} kW, figure of merit ${merit.toFixed(2)}; ${thrust.map((t) => t.toFixed(0)).join(' ')} N to 30 m/s`);
      expect(merit).toBeGreaterThan(0.5);
      expect(merit).toBeLessThan(0.85);
      for (const t of thrust) expect(t).toBeLessThan(1.02 * thrust[0]);
      for (let i = 1; i < thrust.length; i++) expect(thrust[i]).toBeLessThan(thrust[i - 1] * 1.01);
      expect(thrust[thrust.length - 1]).toBeLessThan(0.9 * thrust[0]);
    }
    console.log(rows.join('\n'));
  });

  it('blend two slices linearly in blade angle at the same angle of attack, and hold the end slices beyond the stops', () => {
    const c = propellerCharacteristicsFor(CS_PROPELLER);
    const [a, b] = [c.pitchNodes[2], c.pitchNodes[3]];
    const zero = () => ({ ct: 0, cq: 0, cf: 0, cm: 0 });
    const at = (pitch: number, beta = 12 * DEG) => ({ ...c.sample(beta, 0.03, 0.5, pitch, zero()) });
    // A quarter of the way from a to b: slice a read 0.75 of the spacing lower in advance angle, slice b 0.25 higher.
    const lo = c.slice(2).sample(12 * DEG - 0.75 * (b - a), 0.03, 0.5, zero());
    const hi = c.slice(3).sample(12 * DEG + 0.25 * (b - a), 0.03, 0.5, zero());
    const mid = at(0.25 * a + 0.75 * b);
    for (const k of ['ct', 'cq', 'cf', 'cm'] as const) expect(mid[k]).toBeCloseTo(0.25 * lo[k] + 0.75 * hi[k], 12);
    // Toward the stopped propeller (beta 90 degrees) the shift fades: there both are read at the same angle.
    const stopA = c.slice(2).sample(90 * DEG, 0.03, 0.5, zero()), stopB = c.slice(3).sample(90 * DEG, 0.03, 0.5, zero());
    const stopped = at(0.25 * a + 0.75 * b, 90 * DEG);
    for (const k of ['ct', 'cq', 'cf', 'cm'] as const) expect(stopped[k]).toBeCloseTo(0.25 * stopA[k] + 0.75 * stopB[k], 12);
    expect(at(a)).toEqual({ ...c.slice(2).sample(12 * DEG, 0.03, 0.5, { ct: 0, cq: 0, cf: 0, cm: 0 }) });
    expect(at(c.pitchNodes[0] - 0.1)).toEqual(at(c.pitchNodes[0]));
    expect(at(c.pitchNodes[c.sliceCount - 1] + 0.1).cq).toBeCloseTo(at(c.pitchNodes[c.sliceCount - 1]).cq, 5);
  });

  it('prebuild() tabulates every slice once; both propellers of a twin share them', () => {
    // A copy of the definition: its own characteristics, nothing tabulated yet.
    const fresh = propellerCharacteristicsFor({ ...DIESEL_PROPELLER });
    const t0 = performance.now();
    expect(fresh.prebuild()).toBe(fresh.sliceCount);
    const ms = performance.now() - t0;
    expect(fresh.prebuild()).toBe(0);
    let points = 0;
    for (let i = 0; i < fresh.sliceCount; i++) points += fresh.slice(i).points;
    console.log(`prebuild of a constant-speed propeller: ${fresh.sliceCount} slices, ${points} operating points, ${ms.toFixed(0)} ms (target < 1000 ms on an idle machine)`);
    // About 0.4 MB of single-precision coefficients.
    expect(points * 4 * 4).toBeLessThan(0.5 * 1024 * 1024);
    // Judged at the gate; here only that it is not seconds per slice.
    expect(ms).toBeLessThan(15_000);

    for (const def of [TWIN_CS_POWERPLANT, TWIN_DIESEL_POWERPLANT]) {
      const twin = new Powerplant(def);
      expect(def.engines[0].propeller).toBe(def.engines[1].propeller);
      const maps = twin.units.map((u) => (u.propeller as unknown as { characteristics: PropellerCharacteristics }).characteristics);
      expect(maps[0]).toBe(maps[1]);
      expect(maps[0]).toBe(propellerCharacteristicsFor(def.engines[0].propeller));
      expect(twin.prebuild()).toBeGreaterThanOrEqual(0);
      expect(twin.prebuild()).toBe(0);
    }
  }, 60_000);
});

describe('a feathered propeller', () => {
  // The contract's concern (3.2): the torque of a feathered blade decides whether the propeller stops or creeps,
  // and it passes through zero near zero rpm, where the advance angle is 90 degrees.
  it('is not driven by the airstream: its torque passes through zero near zero rpm and resists any turning', () => {
    for (const def of [CS_PROPELLER, DIESEL_PROPELLER]) {
      const control = def.pitchControl as Extract<PropellerDef['pitchControl'], { kind: 'constantSpeed' }>;
      const feather = control.feather!.angle;
      const prop = new Propeller(propellerCharacteristicsFor(def));
      const air: Vec3 = { x: -45, y: 0, z: 0 };
      const torque = (rpm: number): number => prop.evaluate(air, rpm * RPM, 1.225, 340.3, feather).torque;
      // At rest in a 45 m/s stream (blue line of a light twin) the torque is a small fraction of the 60 N m a
      // stopped engine holds against: the propeller stays stopped.
      expect(Math.abs(torque(0))).toBeLessThan(15);
      // Turned forward it resists (positive torque), more the faster it turns: no speed at which the air drives it.
      expect(torque(60)).toBeGreaterThan(torque(0));
      expect(torque(150)).toBeGreaterThan(5);
      expect(torque(300)).toBeGreaterThan(torque(150));
      // The map agrees with the solver for the stopped blade (the 90 degree node).
      const live = new BemtSolver(14, def, feather).rotorLoads(45, 0, 0, 1.225, 340.3);
      expect(torque(0)).toBeCloseTo(live.torque, 0);
      // Its drag is a few per cent of what the same propeller makes windmilling on its fine stop at 1500 rpm.
      const featheredDrag = -prop.evaluate(air, 0, 1.225, 340.3, feather).thrust;
      const windmillingDrag = -prop.evaluate(air, 1500 * RPM, 1.225, 340.3, control.fineStop).thrust;
      expect(featheredDrag).toBeGreaterThan(0);
      expect(windmillingDrag).toBeGreaterThan(8 * featheredDrag);
    }
  });
});

describe('rotation sense', () => {
  // A counter-clockwise propeller is the mirror image, in the aircraft's plane of symmetry (x-z), of a clockwise
  // one in the mirrored inflow. Forces mirror as vectors (y changes sign); moments and rotation rates as axial
  // vectors (x and z change sign).
  const inflows: Vec3[] = [
    { x: -50, y: 0, z: -6 },
    { x: -50, y: 5, z: -6 },
    { x: -30, y: -4, z: 3 },
    { x: 0, y: 2, z: -1 },
  ];

  it('mirrors the hub moment and the swirl; thrust and in-plane force are those of the mirrored inflow', () => {
    for (const source of [propellerCharacteristicsFor(C172_PROPELLER), propellerCharacteristicsFor(CS_PROPELLER)]) {
      const right = new Propeller(source, 1);
      const left = new Propeller(source, -1);
      expect(right.rotation).toBe(1);
      expect(left.rotation).toBe(-1);
      for (const air of inflows) {
        const a = { ...right.evaluate(air, 2400 * RPM, SEA_LEVEL.density, SEA_LEVEL.speedOfSound, 18 * DEG) };
        const aForce = { ...a.inPlaneForce }, aMoment = { ...a.hubMoment };
        const aSlip = { ...slipstreamOf(right) };
        const b = left.evaluate({ x: air.x, y: -air.y, z: air.z }, 2400 * RPM, SEA_LEVEL.density, SEA_LEVEL.speedOfSound, 18 * DEG);
        const bSlip = slipstreamOf(left);
        expect(b.thrust).toBe(a.thrust);
        expect(b.torque).toBe(a.torque);
        expect(b.inPlaneForce.y).toBeCloseTo(-aForce.y, 9);
        expect(b.inPlaneForce.z).toBeCloseTo(aForce.z, 9);
        expect(b.hubMoment.y).toBeCloseTo(aMoment.y, 9);
        expect(b.hubMoment.z).toBeCloseTo(-aMoment.z, 9);
        expect(bSlip.swirlRate).toBe(-aSlip.swirlRate);
        expect(bSlip.inducedVelocity).toBe(aSlip.inducedVelocity);
        expect(Math.abs(aSlip.swirlRate)).toBeGreaterThan(1);
      }
      // The P-factor of a clockwise propeller at a positive angle of attack yaws the nose LEFT (the down-going
      // blade on the right pulls harder); the counter-clockwise one yaws it right.
      const climb: Vec3 = { x: -40, y: 0, z: -5 };
      expect(right.evaluate(climb, 2500 * RPM, 1.225, 340.3, 16 * DEG).hubMoment.z).toBeLessThan(-5);
      expect(left.evaluate(climb, 2500 * RPM, 1.225, 340.3, 16 * DEG).hubMoment.z).toBeGreaterThan(5);
    }
  });

  it('a counter-rotating unit is the mirror image of a clockwise one: loads, torque reaction, angular momentum', () => {
    // One unit of each sense at mirrored hubs, each alone on the same fuel system and bus.
    const at = (rotation: 1 | -1): Powerplant => {
      const pp = singlePowerplant(constantSpeedUnit(rotation));
      const sys = new Powerplant({ ...pp, engines: [{ ...pp.engines[0], hub: { x: 0.9, y: -rotation * 1.9, z: 0.1 } }] });
      sys.reset({ running: true, tanks: [100, 100], rpm: 2300 });
      return sys;
    };
    const right = at(1), left = at(-1);
    for (const air of inflows.slice(0, 3)) {
      for (const dynamic of [false, true]) {
        const inputR = makeInput({ controls: { fuelSelector: 'on', throttle: 0.8, propeller: 0.8 } });
        const inputL = makeInput({ controls: { fuelSelector: 'on', throttle: 0.8, propeller: 0.8 } });
        inputR.airVelocityBody = air;
        inputL.airVelocityBody = { x: air.x, y: -air.y, z: air.z };
        inputR.body.cgOffset = { x: -0.05, y: 0.02, z: -0.1 };
        inputL.body.cgOffset = { x: -0.05, y: -0.02, z: -0.1 };
        let a = right.settle(inputR), b = left.settle(inputL);
        if (dynamic) {
          // In a transient as well: the shafts are accelerating, so the reaction carries the inertia term.
          inputR.controls.throttle = inputL.controls.throttle = 0.3;
          for (let i = 0; i < 30; i++) {
            a = right.step(inputR);
            b = left.step(inputL);
          }
        }
        expect(b.propeller.direction).toBe(-1);
        expect(b.engine.rpm).toBeCloseTo(a.engine.rpm, 6);
        expect(b.force.x).toBeCloseTo(a.force.x, 6);
        expect(b.force.y).toBeCloseTo(-a.force.y, 6);
        expect(b.force.z).toBeCloseTo(a.force.z, 6);
        expect(b.moment.x).toBeCloseTo(-a.moment.x, 6);
        expect(b.moment.y).toBeCloseTo(a.moment.y, 6);
        expect(b.moment.z).toBeCloseTo(-a.moment.z, 6);
        expect(b.angularMomentum.x).toBeCloseTo(-a.angularMomentum.x, 9);
        expect(b.slipstream.swirlRate).toBeCloseTo(-a.slipstream.swirlRate, 9);
        expect(b.slipstream.origin.y).toBe(-a.slipstream.origin.y);
        // The four reversed quantities are not zero, so the mirror is not satisfied trivially.
        expect(a.angularMomentum.x).toBeGreaterThan(300);
        expect(Math.abs(a.moment.x)).toBeGreaterThan(50);
        expect(Math.abs(a.slipstream.swirlRate)).toBeGreaterThan(0.5);
      }
    }
    // The blade angle shown turns the other way round on the counter-rotating propeller.
    const spin = makeInput({ ktas: 80, controls: { fuelSelector: 'on' } });
    const r0 = right.step(spin).propeller.rotation, l0 = left.step(spin).propeller.rotation;
    const r1 = right.step(spin).propeller.rotation, l1 = left.step(spin).propeller.rotation;
    expect(r1 - r0).toBeGreaterThan(0);
    expect(l1 - l0).toBeCloseTo(-(r1 - r0), 9);
  });

  it('a tilted thrust line turns thrust and angular momentum with the shaft, and changes neither\'s size', () => {
    // Standing still (no inflow), so the propeller sees the same air on either shaft: its loads in shaft axes
    // are equal, and the body-axis vectors are the shaft's x axis, turned up (z is down) and right, times them.
    const up = 3 * DEG, right = 2 * DEG;
    const pp = singlePowerplant(constantSpeedUnit(1));
    const straight = new Powerplant(pp);
    const tilted = new Powerplant({ ...pp, engines: [{ ...pp.engines[0], tilt: { up, right } }] });
    for (const sys of [straight, tilted]) sys.reset({ running: true, tanks: [100, 100], rpm: 2300 });
    const input = makeInput({ controls: { fuelSelector: 'on', throttle: 1, propeller: 1 } });
    const a = { ...straight.settle(input).force }, ha = { ...straight.step(input).angularMomentum };
    const b = { ...tilted.settle(input).force }, hb = tilted.step(input).angularMomentum;
    const thrust = a.x;
    expect(thrust).toBeGreaterThan(2000);
    expect(b.x).toBeCloseTo(thrust * Math.cos(up) * Math.cos(right), 6);
    expect(b.y).toBeCloseTo(thrust * Math.cos(up) * Math.sin(right), 6);
    expect(b.z).toBeCloseTo(-thrust * Math.sin(up), 6);
    expect(Math.hypot(hb.x, hb.y, hb.z)).toBeCloseTo(Math.hypot(ha.x, ha.y, ha.z), 6);
    expect(hb.z / hb.x).toBeCloseTo(-Math.tan(up) / Math.cos(right), 9);
  });

  it('refuses a supplied propeller of the wrong sense', () => {
    const pp = singlePowerplant(constantSpeedUnit(-1));
    expect(() => new Powerplant(pp, [new Propeller(propellerCharacteristicsFor(CS_PROPELLER), 1)])).toThrow(/other way/);
  });
});
