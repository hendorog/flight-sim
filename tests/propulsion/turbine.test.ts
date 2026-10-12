// The free-turbine turboprop of the PT6A-like test-bed (testbed.ts): the gas generator's running line on
// corrected parameters, the power turbine's torque against its speed, the fuel control's acceleration and
// governing, starting (light-off, self-sustaining speed, hung and hot starts), shutdown, flame-out and relight,
// and the shafts the starter, generator and oil pump hang on.

import { describe, expect, it } from 'vitest';

import { HP, interp1 } from '../../src/core/math';
import { setEngineControl } from '../../src/core/types';
import type { PropulsionInput, PropulsionOutput } from '../../src/physics/interfaces';
import { Powerplant } from '../../src/physics/propulsion';
import type { EngineDef, GasGeneratorDef } from '../../src/physics/propulsion/defs';
import type { EngineInput } from '../../src/physics/propulsion/engine';
import { GasGenerator } from '../../src/physics/propulsion/gasGenerator';
import { CUTOFF_BELOW, TurbineEngine } from '../../src/physics/propulsion/turbineEngine';
import { DT, advance, makeInput } from './helpers';
import { PT6_ENGINE, PT6_NG_RPM, TURBOPROP_POWERPLANT } from './testbed';

const GG = PT6_ENGINE.turbine!.gasGenerator;
const MAP = GG.map;
const GEAR = PT6_ENGINE.gearRatio;
/** Condition lever at LOW IDLE. */
const LOW_IDLE = CUTOFF_BELOW;
const RPM = Math.PI / 30;
/** ITT limits of the type: maximum continuous / take-off, and starting. */
const ITT_MAX = 805;
const ITT_START_MAX = 1090;

function running(): Powerplant {
  const sys = new Powerplant(TURBOPROP_POWERPLANT);
  sys.reset({ running: true, tanks: [400, 400], rpm: PT6_ENGINE.airStartRpm });
  return sys;
}

function stopped(): Powerplant {
  const sys = new Powerplant(TURBOPROP_POWERPLANT);
  sys.reset({ running: false, tanks: [400, 400], feathered: [true] });
  return sys;
}

/** Step until `until` holds or `seconds` pass; returns the time taken (NaN if it never held) and the extremes seen. */
function fly(sys: Powerplant, input: PropulsionInput, seconds: number, each?: (out: PropulsionOutput, t: number) => boolean | void) {
  let peakItt = -Infinity;
  let peakNg = -Infinity;
  for (let t = DT; t <= seconds + 1e-9; t += DT) {
    const out = sys.step(input);
    peakItt = Math.max(peakItt, out.engine.itt!);
    peakNg = Math.max(peakNg, out.engine.ng!);
    if (each?.(out, t) === true) return { t, peakItt, peakNg };
  }
  return { t: NaN, peakItt, peakNg };
}

interface StartOptions {
  /** Ng, %, at which the condition lever goes to LOW IDLE. */
  fuelAtNg?: number;
  /** Ng, %, at which the starter is released. */
  starterOffNg?: number;
  /** Ignition switch (the magnetos control): 0 = OFF, a dry motoring run. */
  ignition?: 0 | 3;
}

/** The ground start from a stopped, feathered engine: starter on, fuel at fuelAtNg, starter off at starterOffNg. */
function start(sys: Powerplant, o: StartOptions = {}, seconds = 60) {
  const input = makeInput({ controls: { throttle: 0, mixture: 0, magnetos: o.ignition ?? 3 } });
  setEngineControl(input.controls, 0, 'starter', true);
  let lightOff = NaN;
  const result = fly(sys, input, seconds, (out, t) => {
    const ng = out.engine.ng!;
    if (input.controls.mixture < CUTOFF_BELOW && ng >= (o.fuelAtNg ?? 13)) input.controls.mixture = LOW_IDLE;
    if (input.controls.engines[0].starter && ng >= (o.starterOffNg ?? 50)) setEngineControl(input.controls, 0, 'starter', false);
    if (Number.isNaN(lightOff) && sys.units[0].engine.firing) lightOff = t;
  });
  return { ...result, input, lightOff };
}

describe('the running line', () => {
  it('governs Ng to the power lever and burns the map\'s fuel at sea level; the propeller takes the power at its governed speed', () => {
    const sys = running();
    for (const lever of [0.5, 0.75, 0.9]) {
      const input = makeInput({ ktas: 120, controls: { throttle: lever, mixture: LOW_IDLE } });
      const out = sys.settle(input);
      const ng = GG.fcu.lowIdleNg + (GG.fcu.maxNg - GG.fcu.lowIdleNg) * lever;
      // Ram at 120 kt: the corrected speed sits a little below the physical one; read the map there.
      const unit = sys.units[0];
      const engine = unit.engine as TurbineEngine;
      expect(out.engine.ng! / 100).toBeCloseTo(ng, 6);
      const theta = engine.chargeTemperature / 288.15;
      const delta = engine.manifoldPressure / 101325;
      const nc = ng / Math.sqrt(theta);
      const scale = delta * Math.sqrt(theta);
      expect(out.engine.fuelFlow / (interp1(MAP.ng, MAP.fuelFlow, nc) * scale)).toBeCloseTo(1, 3);
      expect(out.engine.propRpm).toBeCloseTo(1900, 0);
      // At the design power-turbine speed the shaft power is the map's gas power less the gearbox friction.
      expect(out.engine.rpm).toBeCloseTo(PT6_ENGINE.ratedRpm, -1);
      const gas = interp1(MAP.ng, MAP.power, nc) * scale;
      const friction = engine.frictionTorque * unit.omega * GEAR;
      expect(Math.abs(out.engine.power - (gas - friction)) / gas).toBeLessThan(0.005);
      // Flown from the solution: it stays there.
      const after = advance(sys, input, 5);
      expect(Math.abs(after.engine.ng! / 100 - ng)).toBeLessThan(0.002);
      expect(Math.abs(after.engine.propRpm - 1900)).toBeLessThan(3);
      // Steady: the propeller absorbs the shaft power.
      expect((unit.propeller.loads.torque * unit.omega) / after.engine.power).toBeCloseTo(1, 2);
    }
  }, 30_000);

  it('reports Ng, ITT (also as EGT), torque on the propeller shaft, oil pressure in the green; the starter, generator and pumps turn with Ng', () => {
    const sys = running();
    const out = sys.settle(makeInput({ ktas: 150, controls: { throttle: 0.85, mixture: 1 } }));
    const e = out.engine;
    expect(e.ng).toBeGreaterThan(90);
    expect(e.itt).toBe(e.egt);
    expect(e.itt).toBeGreaterThan(600);
    expect(e.itt).toBeLessThan(ITT_MAX);
    // Torque at the propeller shaft, ft lbf: the 114A's 1865 limit is in reach, not exceeded, at 85 %.
    const ftlb = (e.torque * GEAR) / 1.3558;
    expect(ftlb).toBeGreaterThan(1300);
    expect(ftlb).toBeLessThan(1865);
    expect(e.oilPressure).toBeGreaterThan(85);
    expect(e.oilPressure).toBeLessThan(115);
    expect(e.running).toBe(true);
    expect(sys.units[0].driveRpm).toBeCloseTo((e.ng! / 100) * PT6_NG_RPM, 6);
    expect(out.electrical.busVoltage).toBeGreaterThan(27);
  }, 30_000);

  it('loses power and runs hotter on a hot day and at altitude at the same Ng: ITT, not Ng, limits it there', () => {
    const sys = running();
    const at = (altitudeFt: number, isaDeviation: number) => {
      const input = makeInput({ ktas: 0, altitudeFt, controls: { throttle: 1, mixture: 1 } });
      input.atmosphere.temperature += isaDeviation;
      input.atmosphere.density = input.atmosphere.pressure / (287.053 * input.atmosphere.temperature);
      input.atmosphere.speedOfSound = Math.sqrt(1.4 * 287.053 * input.atmosphere.temperature);
      sys.reset({ running: true, tanks: [400, 400], rpm: PT6_ENGINE.airStartRpm });
      const e = sys.settle(input).engine;
      // Power at the design power-turbine speed, from the gas generator (the propeller's speed is not the subject).
      const gg = (sys.units[0].engine as TurbineEngine).gasGenerator;
      return { ng: e.ng!, itt: e.itt!, power: gg.gasPower };
    };
    const isa = at(0, 0);
    const hot = at(0, 30);
    const high = at(10_000, 0);
    expect(hot.ng).toBeCloseTo(isa.ng, 6);
    expect(hot.power).toBeLessThan(0.9 * isa.power);
    expect(hot.itt).toBeGreaterThan(isa.itt + 30);
    // Hot: near the ITT limit at maximum Ng (the pilot sets power by ITT there).
    expect(hot.itt).toBeGreaterThan(ITT_MAX - 20);
    expect(high.power).toBeLessThan(0.85 * isa.power);
    expect(high.power).toBeGreaterThan(0.6 * isa.power);
  }, 30_000);
});

describe('the gas generator on corrected parameters', () => {
  it('scales fuel, gas power and ITT with delta sqrt(theta) and theta at the same corrected speed', () => {
    const gg = new GasGenerator(GG, PT6_ENGINE.fuel.lhv);
    const steady = (pressure: number, temperature: number, ngDemand: number) => {
      const input = { inletPressure: pressure, inletTemperature: temperature, ngDemand, cutoff: false, igniters: false, accessoryPower: 0, starterTorque: 0, dt: 0, steady: true };
      gg.reset(temperature, true);
      const fuel = gg.breathe(input);
      gg.burn(input, fuel);
      return { fuel, power: gg.gasPower, itt: gg.itt };
    };
    const sl = steady(101325, 288.15, 0.9);
    const theta = 250 / 288.15;
    const delta = 0.5;
    const cold = steady(delta * 101325, 250, 0.9 * Math.sqrt(theta));
    expect(cold.fuel / (delta * Math.sqrt(theta))).toBeCloseTo(sl.fuel, 9);
    expect(cold.power / (delta * Math.sqrt(theta))).toBeCloseTo(sl.power, 3);
    expect(cold.itt / theta).toBeCloseTo(sl.itt, 6);
    expect(sl.itt - 273.15).toBeCloseTo(interp1(MAP.ng, MAP.itt, 0.9), 6);
  });

  it('solves the start region so that the acceleration schedule just holds the spool at the self-sustaining speed', () => {
    const gg = new GasGenerator(GG, PT6_ENGINE.fuel.lhv);
    const net = (ng: number) => gg.efficiency(ng) * PT6_ENGINE.fuel.lhv * gg.accelFuel(ng) - GG.compressorPower * ng ** 3;
    expect(net(GG.selfSustainingNg) / (GG.compressorPower * GG.selfSustainingNg ** 3)).toBeCloseTo(0, 9);
    // Below it the starter must help; above it the engine accelerates alone, all the way to the map.
    for (const ng of [0.15, 0.2, 0.25, 0.3, 0.33]) expect(net(ng)).toBeLessThan(0);
    for (const ng of [0.37, 0.4, 0.45, 0.5, 0.6, 0.8, 1]) expect(net(ng)).toBeGreaterThan(0);
  });

  it('refuses a definition whose schedule cannot reach the self-sustaining speed', () => {
    const lean: GasGeneratorDef = { ...GG, fcu: { ...GG.fcu, accelFuel: { ng: [0, 1.1], fuelFlow: [0.0005, 0.0006] } } };
    expect(() => new GasGenerator(lean, PT6_ENGINE.fuel.lhv)).toThrow(/self/);
    expect(() => new GasGenerator({ ...GG, selfSustainingNg: 0.6 }, PT6_ENGINE.fuel.lhv)).toThrow();
  });
});

describe('the power turbine', () => {
  const probe = (omega: number): EngineInput => ({
    omega, throttle: 0.8, mixture: 1, magnetos: 3, ambientPressure: 101325, ambientTemperature: 288.15, ambientDensity: 1.225,
    ramPressure: 0, oilTemperature: 70, accessoryPower: 0, dt: 0, steady: true,
  });

  it('gives stallTorqueRatio times the design-speed torque held still, the map power at its design speed, none beyond runaway', () => {
    const engine = new TurbineEngine(PT6_ENGINE);
    engine.light();
    const torqueAt = (omega: number): number => {
      const input = probe(omega);
      engine.breathe(input);
      engine.burn(input, engine.fuelDemand);
      return engine.indicatedTorque;
    };
    const design = PT6_ENGINE.ratedRpm * RPM;
    const qDesign = torqueAt(design);
    expect(qDesign * design).toBeCloseTo(engine.gasGenerator.gasPower, 3);
    expect(torqueAt(0) / qDesign).toBeCloseTo(PT6_ENGINE.turbine!.powerTurbine.stallTorqueRatio, 9);
    expect(torqueAt(0.5 * design) / qDesign).toBeCloseTo(1.5, 9);
    expect(torqueAt(2.5 * design)).toBe(0);
  });

  it('the topping governor takes Ng off when the power turbine overspeeds', () => {
    const engine = new TurbineEngine(PT6_ENGINE);
    engine.light();
    const design = PT6_ENGINE.ratedRpm * RPM;
    const demandAt = (omega: number): number => {
      engine.breathe({ ...probe(omega), throttle: 1 });
      return engine.ngDemand;
    };
    const normal = demandAt(design);
    expect(normal).toBeCloseTo(GG.fcu.maxNg, 9);
    expect(demandAt(1.05 * design)).toBeCloseTo(normal, 9);
    expect(demandAt(1.08 * design)).toBeCloseTo(normal - 0.02 * PT6_ENGINE.turbine!.powerTurbine.topping.gain, 9);
  });
});

describe('the fuel control', () => {
  it('accelerates from flight idle to take-off Ng in 3-6 s without overshooting Ng or the ITT, and back without a flame-out', () => {
    const sys = running();
    const input = makeInput({ ktas: 100, controls: { throttle: 0, mixture: LOW_IDLE } });
    sys.settle(input);
    expect(sys.units[0].state.ng! / 100).toBeCloseTo(GG.fcu.lowIdleNg, 6);
    input.controls.throttle = 1;
    const up = fly(sys, input, 10, (out) => out.engine.ng! >= 95);
    expect(up.t).toBeGreaterThan(3);
    expect(up.t).toBeLessThan(6);
    const settled = fly(sys, input, 8);
    expect(settled.peakNg).toBeLessThan(100 * GG.fcu.maxNg + 0.2);
    expect(Math.max(up.peakItt, settled.peakItt)).toBeLessThan(ITT_MAX);
    // Chop: down to idle within 5 s, alight throughout.
    input.controls.throttle = 0;
    const down = fly(sys, input, 10, (out) => {
      expect(out.engine.running).toBe(true);
      return out.engine.ng! <= 100 * GG.fcu.lowIdleNg + 0.5;
    });
    expect(down.t).toBeLessThan(5);
  }, 30_000);

  it('the condition lever sets the idle: low idle 52 %, high idle 65 %', () => {
    const sys = running();
    for (const [condition, ng] of [[LOW_IDLE, GG.fcu.lowIdleNg], [1, GG.fcu.highIdleNg]]) {
      const out = sys.settle(makeInput({ controls: { throttle: 0, mixture: condition } }));
      expect(out.engine.ng! / 100).toBeCloseTo(ng, 2);
    }
  }, 30_000);
});

describe('starting', () => {
  it('lights at 13 % Ng, stays within the starting ITT, self-sustains and stabilises at low idle; the propeller unfeathers and the generator comes on line', () => {
    const sys = stopped();
    expect(sys.units[0].feathered).toBe(true);
    const s = start(sys);
    expect(s.lightOff).toBeGreaterThan(1);
    expect(s.peakItt).toBeGreaterThan(600);
    expect(s.peakItt).toBeLessThan(ITT_START_MAX);
    const e = sys.units[0].state;
    expect(e.ng! / 100).toBeCloseTo(GG.fcu.lowIdleNg, 2);
    expect(e.running).toBe(true);
    expect(e.itt).toBeLessThan(700);
    expect(e.oilPressure).toBeGreaterThan(60);
    expect(sys.units[0].feathered).toBe(false);
    expect(e.propRpm).toBeGreaterThan(300);
    // Starter-generator on line: the battery is charging.
    const out = sys.step(s.input);
    expect(out.electrical.alternatorAmps).toBeGreaterThan(0);
    expect(out.electrical.batteryAmps).toBeGreaterThan(0);
  }, 30_000);

  it('takes 20-50 s from the starter to stabilised low idle', () => {
    const sys = stopped();
    const input = makeInput({ controls: { throttle: 0, mixture: 0 } });
    setEngineControl(input.controls, 0, 'starter', true);
    const idle = fly(sys, input, 80, (out) => {
      if (input.controls.mixture < CUTOFF_BELOW && out.engine.ng! >= 13) input.controls.mixture = LOW_IDLE;
      if (out.engine.ng! >= 50) setEngineControl(input.controls, 0, 'starter', false);
      return out.engine.ng! >= 100 * GG.fcu.lowIdleNg - 0.5;
    });
    expect(idle.t).toBeGreaterThan(20);
    expect(idle.t).toBeLessThan(50);
  }, 30_000);

  it('hangs if the starter is released below the self-sustaining speed, and not above it', () => {
    const hung = stopped();
    start(hung, { starterOffNg: 100 * GG.selfSustainingNg - 5 }, 60);
    expect(hung.units[0].state.ng!).toBeLessThan(100 * GG.selfSustainingNg - 5);
    const ok = stopped();
    start(ok, { starterOffNg: 100 * GG.selfSustainingNg + 3 }, 80);
    expect(ok.units[0].state.ng! / 100).toBeCloseTo(GG.fcu.lowIdleNg, 2);
  }, 30_000);

  it('fuel in before the flame is lit (ignition off) pools, and torches into a hot start when it lights', () => {
    const sys = stopped();
    // Motoring with fuel on and the ignition OFF: no light-off, the fuel collects in the combustor.
    const wet = start(sys, { fuelAtNg: 5, starterOffNg: 100, ignition: 0 }, 8);
    expect(wet.lightOff).toBeNaN();
    const gg = (sys.units[0].engine as TurbineEngine).gasGenerator;
    expect(gg.pooled).toBeGreaterThan(0.01);
    // Ignition on.
    wet.input.controls.magnetos = 3;
    const hot = fly(sys, wet.input, 10);
    expect(hot.peakItt).toBeGreaterThan(ITT_START_MAX);
  }, 30_000);

  it('a dry motoring run (ignition off, fuel cut off) blows the pooled fuel out within a minute', () => {
    const sys = stopped();
    const wet = start(sys, { fuelAtNg: 5, starterOffNg: 100, ignition: 0 }, 8);
    const gg = (sys.units[0].engine as TurbineEngine).gasGenerator;
    const pooled = gg.pooled;
    wet.input.controls.mixture = 0;
    fly(sys, wet.input, 60);
    expect(gg.pooled).toBeLessThan(0.05 * pooled);
  }, 30_000);
});

describe('shutdown, flame-out and relight', () => {
  it('cut-off on the ground: the flame goes out at once, the gas generator runs down, the propeller feathers', () => {
    const sys = running();
    const input = makeInput({ controls: { throttle: 0, mixture: LOW_IDLE } });
    sys.settle(input);
    input.controls.mixture = 0;
    sys.step(input);
    expect(sys.units[0].engine.firing).toBe(false);
    const down = fly(sys, input, 120, (out) => out.engine.ng! < 1 && sys.units[0].feathered);
    expect(down.t).toBeLessThan(120);
    expect(sys.units[0].state.running).toBe(false);
  }, 30_000);

  it('starved of fuel in flight it flames out, the propeller windmills, and it relights only with the starter (igniters) above light-off', () => {
    const sys = running();
    const input = makeInput({ ktas: 140, altitudeFt: 5000, controls: { throttle: 0.8, mixture: 1 } });
    sys.settle(input);
    input.controls.fuelSelector = 'off';
    const out = fly(sys, input, 30, () => !sys.units[0].engine.firing);
    expect(out.t).toBeLessThan(30);
    fly(sys, input, 10);
    expect(sys.units[0].state.propRpm).toBeGreaterThan(500);
    // Fuel back on, no igniters: it stays out.
    input.controls.fuelSelector = 'both';
    input.controls.throttle = 0;
    fly(sys, input, 5);
    expect(sys.units[0].engine.firing).toBe(false);
    // Starter-assisted air start.
    setEngineControl(input.controls, 0, 'starter', true);
    const lit = fly(sys, input, 30, () => sys.units[0].engine.firing);
    expect(lit.t).toBeLessThan(30);
    const idle = fly(sys, input, 60, (o) => {
      if (o.engine.ng! >= 50) setEngineControl(input.controls, 0, 'starter', false);
      return o.engine.ng! >= 100 * GG.fcu.highIdleNg - 1;
    });
    expect(idle.t).toBeLessThan(60);
  }, 30_000);
});

describe('resume', () => {
  it('capture and restore give the same next step', () => {
    const a = running();
    const input = makeInput({ ktas: 130, altitudeFt: 3000, controls: { throttle: 0.7, mixture: 1 } });
    a.settle(input);
    input.controls.throttle = 1;
    advance(a, input, 1.3);
    const snap = a.capture();
    expect(snap[0].gasGenerator?.lit).toBe(true);
    const b = new Powerplant(TURBOPROP_POWERPLANT);
    b.reset({ running: true, tanks: [400, 400], rpm: 0 });
    b.restore(snap);
    const ea = a.step(input).engine;
    const ngA = ea.ng!, ittA = ea.itt!;
    const eb = b.step(input).engine;
    expect(eb.ng!).toBeCloseTo(ngA, 9);
    expect(eb.itt!).toBeCloseTo(ittA, 9);
  }, 30_000);
});

describe('definition', () => {
  it('needs turbine data on a free turbine', () => {
    const bare: EngineDef = { ...PT6_ENGINE, turbine: undefined };
    expect(() => new TurbineEngine(bare)).toThrow(/free turbine/);
    // Shaft power at the rated point is the flat rating, in reach of the map.
    expect(interp1(MAP.ng, MAP.power, 1)).toBeGreaterThan(PT6_ENGINE.ratedPower);
    expect(PT6_ENGINE.ratedPower / HP).toBe(675);
  });
});
