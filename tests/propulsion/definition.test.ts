// The powerplant is built from its definition (src/physics/propulsion/defs.ts), with the Cessna 172S as the
// default. Three things are checked here:
//  - the pieces: one EngineUnit inside a Powerplant, the PropulsionSystem facade over it, and the propeller
//    characteristics that are shared per definition;
//  - that the Cessna 172S built this way is the Cessna 172S: its whole propeller map, bit for bit;
//  - that the numbers really come from the definition: a second single-engine type made of different numbers
//    behaves by ITS numbers, and a definition that needs a mechanism that is not built yet is refused.

import { describe, expect, it } from 'vitest';
import { DEG, HP } from '../../src/core/math';
import { clearEngineControl, setEngineControl } from '../../src/core/types';
import { EngineUnit, Powerplant, PropulsionSystem, ROTOR_INERTIA } from '../../src/physics/propulsion';
import { sectionCoefficients } from '../../src/physics/propulsion/airfoil';
import { BemtSolver } from '../../src/physics/propulsion/bemt';
import { C172_BLADE_SECTION, C172_ENGINE, C172_POWERPLANT, C172_PROPELLER } from '../../src/physics/propulsion/c172Powerplant';
import type { PowerplantDef } from '../../src/physics/propulsion/defs';
import { DieselEngine } from '../../src/physics/propulsion/dieselEngine';
import { ElectricalSystem } from '../../src/physics/propulsion/electrical';
import { PistonEngine } from '../../src/physics/propulsion/engine';
import { EngineThermal } from '../../src/physics/propulsion/engineThermal';
import { shaftInertia } from '../../src/physics/propulsion/engineUnit';
import { FuelSystem } from '../../src/physics/propulsion/fuelSystem';
import { Propeller } from '../../src/physics/propulsion/propeller';
import { PropellerCharacteristics, PropellerMap, propellerCharacteristicsFor, sharedPropellerMap } from '../../src/physics/propulsion/propellerMap';
import { DT, makeInput, run, runningSystem } from './helpers';

const RPM = Math.PI / 30;
const C172_FEED = C172_POWERPLANT.fuel.feeds[0];

/**
 * A second single-engine type: the Cessna 172S definition with every number that the propulsion classes used to
 * hold as a constant of their own replaced by another (a smaller engine, a three-blade propeller of another
 * size and pitch at another hub, unequal tanks, a 14 V bus).
 */
const SMALL: PowerplantDef = {
  engines: [
    {
      engine: {
        ...C172_ENGINE,
        name: 'test engine, 120 hp',
        ratedPower: 120 * HP,
        ratedRpm: 2500,
        displacement: 4.0e-3,
        breakawayTorque: 40,
        rotatingInertia: 0.3,
        runningRpm: 300,
        groundStartRpm: 900,
        thermal: { ...C172_ENGINE.thermal, warm: { egt: 600, cht: 150, oilTemp: 75, oilPressure: 55 } },
      },
      propeller: {
        ...C172_PROPELLER,
        name: 'test propeller, 1.75 m, three blades',
        diameter: 1.75,
        blades: 3,
        hubRadius: 0.12,
        twist: { kind: 'helix', pitch: 1.3 },
        inertia: 0.9,
      },
      hub: { x: 1.6, y: 0, z: -0.1 },
      rotation: 1,
    },
  ],
  fuel: {
    tanks: [
      { id: 'left', side: 'left', capacity: 40, position: { x: 0, y: -1.2, z: 0.3 } },
      { id: 'right', side: 'right', capacity: 55, position: { x: 0, y: 1.2, z: 0.3 } },
    ],
    feeds: [{ ...C172_FEED, auxPump: { psi: 6, minVolts: 9 } }],
  },
  electrical: {
    nominalVolts: 14,
    regulatorVolts: 14.2,
    battery: { capacityAh: 25, ocvEmpty: 11.6, ocvSpan: 1.3, rDischarge: 0.012, rChargeBase: 0.04, rChargeFull: 0.75 },
    alternators: [{ engine: 0, maxAmps: 60, cutInRpm: 400, fullRpm: 1400, efficiency: 0.55 }],
    loads: { ...C172_POWERPLANT.electrical.loads },
    lowVoltsLamp: 12.5,
    overVolts: 16,
    busDeadVolts: 9,
  },
};

/** FNV-1a (64 bit) of the bytes of an array of doubles, with its length. */
function digest(values: Float64Array): string {
  let h = 0xcbf29ce484222325n;
  for (const byte of new Uint8Array(values.buffer, values.byteOffset, values.byteLength)) h = BigInt.asUintN(64, (h ^ BigInt(byte)) * 0x100000001b3n);
  return `${values.length}:${h.toString(16).padStart(16, '0')}`;
}

describe('the pieces of the powerplant', () => {
  it('is one engine unit in a powerplant, and PropulsionSystem names the unit\'s parts', () => {
    const sys = new PropulsionSystem();
    expect(sys).toBeInstanceOf(Powerplant);
    expect(sys.def).toBe(C172_POWERPLANT);
    expect(sys.engineCount).toBe(1);
    expect(sys.units).toHaveLength(1);
    const unit = sys.units[0];
    expect(unit).toBeInstanceOf(EngineUnit);
    expect(unit.install).toBe(C172_POWERPLANT.engines[0]);
    expect(unit.index).toBe(0);
    expect(sys.engine).toBe(unit.engine);
    expect(sys.engine.def).toBe(C172_ENGINE);
    expect(sys.propeller).toBe(unit.propeller);
    expect(sys.thermal).toBe(unit.thermal);
    expect(sys.hubs).toEqual([C172_POWERPLANT.engines[0].hub]);
    expect(sys.tankCapacities).toEqual([72, 72]);
    expect(sys.fuelCapacityEach).toBe(72);

    // The shaft speed is the unit's, read and written through the system.
    sys.omega = 2000 * RPM;
    expect(unit.omega).toBe(2000 * RPM);
    expect(sys.rpm).toBe(unit.rpm);
    expect(sys.rpm).toBeCloseTo(2000, 9);

    // The output is made of the unit's own state objects.
    const out = sys.step(makeInput({ ktas: 80 }));
    expect(out.engine).toBe(unit.state);
    expect(out.propeller).toBe(unit.propState);
    expect(out.slipstream).toBe(unit.slipstream);
    expect(out.force).toEqual(unit.force);
    expect(out.moment).toEqual(unit.moment);
    expect(out.angularMomentum).toEqual(unit.angularMomentum);
  });

  it('keeps the live tank contents and the battery charge where the assembly reads them', () => {
    const sys = runningSystem(2300);
    run(sys, { ktas: 100, controls: { fuelSelector: 'left' } }, 30);
    expect(sys.fuelLeft).toBeLessThan(72);
    expect(Array.from(sys.tankQuantities)).toEqual([sys.fuelLeft, sys.fuelRight]);
    sys.batteryCharge = 0.4;
    expect(sys.batteryCharge).toBe(0.4);
    expect(sys.electrical.charge).toBe(0.4);
    // settle() restores both, and the list with them.
    const before = [sys.fuelLeft, sys.fuelRight];
    sys.settle(makeInput({ ktas: 100 }));
    expect(Array.from(sys.tankQuantities)).toEqual(before);
    expect(sys.batteryCharge).toBe(0.4);
  });

  it('resets in the two-tank form (1000 rpm when running) and in the powerplant\'s own (the ground start speed)', () => {
    const sys = new PropulsionSystem();
    sys.reset({ running: true, fuelLeft: 10, fuelRight: 20 });
    expect(sys.rpm).toBeCloseTo(1000, 9);
    expect(Array.from(sys.tankQuantities)).toEqual([10, 20]);
    sys.reset({ running: true, tanks: [30, 40] });
    expect(sys.rpm).toBeCloseTo(C172_ENGINE.groundStartRpm, 9);
    expect([sys.fuelLeft, sys.fuelRight]).toEqual([30, 40]);
    expect(sys.thermal.cht).toBe(C172_ENGINE.thermal.warm.cht);
    sys.reset({ running: [false], tanks: [30, 40], rpm: [1500], oat: 280, batteryCharge: 0.7 });
    expect(sys.rpm).toBeCloseTo(1500, 9);
    expect(sys.thermal.cht).toBeCloseTo(280 - 273.15, 9);
    expect(sys.batteryCharge).toBe(0.7);
    // An engine that has just stopped is still warm.
    sys.reset({ running: false, tanks: [30, 40], warm: true });
    expect(sys.rpm).toBe(0);
    expect(sys.thermal.oilTemp).toBe(C172_ENGINE.thermal.warm.oilTemp);
  });

  it('reads the levers and switches of its engine through the per-engine controls', () => {
    const sys = runningSystem(2300);
    const input = makeInput({ ktas: 100, controls: { throttle: 0.8 } });
    for (let i = 0; i < 240; i++) sys.step(input);
    expect(sys.units[0].state.running).toBe(true);
    // Engine 0's own mixture lever at cut-off while the common one stays rich.
    setEngineControl(input.controls, 0, 'mixture', 0);
    for (let i = 0; i < 5 * 240; i++) sys.step(input);
    expect(input.controls.mixture).toBe(1);
    expect(sys.engine.firing).toBe(false);
    clearEngineControl(input.controls, 'mixture', 0);
    for (let i = 0; i < 5 * 240; i++) sys.step(input);
    expect(sys.engine.firing).toBe(true);

    // The same for a switch: engine 0's starter.
    const parked = new PropulsionSystem();
    const crank = makeInput({ controls: { throttle: 0.1 } });
    parked.step(crank);
    expect(parked.electrical.state.starterAmps).toBe(0);
    setEngineControl(crank.controls, 0, 'starter', true);
    parked.step(crank);
    expect(parked.electrical.state.starterAmps).toBeGreaterThan(100);
  });
});

describe('shaft inertia', () => {
  it('is ONE number per unit: the propeller\'s plus the crank side\'s through the gear ratio squared', () => {
    const install = C172_POWERPLANT.engines[0];
    expect(shaftInertia(install)).toBe(1.7);
    expect(ROTOR_INERTIA).toBe(1.7);
    expect(new PropulsionSystem().units[0].inertia).toBe(ROTOR_INERTIA);
    expect(shaftInertia(SMALL.engines[0])).toBe(0.9 + 0.3);
    expect(shaftInertia({ ...install, engine: { ...install.engine, gearRatio: 2 } })).toBe(1.2 + 4 * 0.5);
  });

  it('is what the shaft equation, the torque reaction and the angular momentum all use', () => {
    // The same engine and propeller with twice the propeller inertia, started from the same state.
    const install = C172_POWERPLANT.engines[0];
    const heavyDef: PowerplantDef = { ...C172_POWERPLANT, engines: [{ ...install, propeller: { ...install.propeller, inertia: 2.9 } }] };
    const light = new PropulsionSystem();
    // The blade is the same: the heavy system takes the Cessna's propeller (no second map).
    const heavy = new PropulsionSystem(new Propeller(), heavyDef);
    expect(heavy.units[0].inertia).toBe(2.9 + 0.5);
    for (const sys of [light, heavy]) sys.reset({ running: true, fuelLeft: 72, fuelRight: 72, rpm: 1800 });
    const input = makeInput({ ktas: 60 });
    const start = light.omega;
    const a = light.step(input);
    const b = heavy.step(input);
    // Same net torque on the first step: the speed gained is inversely proportional to the inertia, the
    // reaction on the engine block is the same, and each reports its own inertia times its own speed.
    expect(light.omega).toBeGreaterThan(start);
    expect((light.omega - start) / (heavy.omega - start)).toBeCloseTo(3.4 / 1.7, 9);
    expect(b.moment.x).toBeCloseTo(a.moment.x, 9);
    expect(a.angularMomentum.x).toBe(1.7 * light.omega);
    expect(b.angularMomentum.x).toBe((2.9 + 0.5) * heavy.omega);
  });
});

describe('propeller characteristics', () => {
  it('are shared per definition object; the Cessna 172S map is their one slice', () => {
    const c = propellerCharacteristicsFor(C172_PROPELLER);
    expect(c).toBeInstanceOf(PropellerCharacteristics);
    expect(propellerCharacteristicsFor(C172_PROPELLER)).toBe(c);
    expect(c.def).toBe(C172_PROPELLER);
    expect(c.sliceCount).toBe(1);
    const map = sharedPropellerMap();
    expect(map).toBeInstanceOf(PropellerMap);
    expect(c.slice(0)).toBe(map);
    expect(sharedPropellerMap()).toBe(map);
    expect(c.radius).toBe(C172_PROPELLER.diameter / 2);
    expect(map.radius).toBe(c.radius);
    expect(map.discArea).toBe(c.discArea);
    // Every propeller of the definition uses that slice: a second powerplant builds no second map.
    const internals = (p: Propeller) => (p as unknown as { map: PropellerMap }).map;
    expect(internals(new Propeller())).toBe(map);
    expect(internals(new Propeller(c))).toBe(map);
    expect(internals(new Propeller(map))).toBe(map);
    expect(internals(new PropulsionSystem().propeller)).toBe(map);
    // Another definition object is another propeller, whatever it holds.
    expect(propellerCharacteristicsFor({ ...C172_PROPELLER })).not.toBe(c);
  });

  // The whole table of the Cessna 172S propeller, not samples of it: 59 x 7 x 14 operating points x 4
  // coefficients and the 59 x 10 swirl profiles, as the untouched code built them (captured before the classes
  // took definitions). The numbers come out of Math.sin / atan2 / exp / pow, so a digest that moves with nothing
  // changed here means another JavaScript engine; with a deliberate change to the blade or the solver, the
  // goldens in tests/golden move as well and this one is to be replaced by the value the failure prints.
  it('the Cessna 172S slice is the map of the untouched code, bit for bit', () => {
    const map = sharedPropellerMap() as unknown as { table: Float64Array; swirl: Float64Array };
    expect(digest(map.table)).toBe('23128:01b039ee948fa01d');
    expect(digest(map.swirl)).toBe('590:20cfb332deeb1144');
  });
});

describe('a second type: the numbers are the definition\'s', () => {
  it('the engine is rated as its definition says', () => {
    const def = SMALL.engines[0].engine;
    const engine = new PistonEngine(def);
    const input = {
      omega: def.ratedRpm * RPM,
      throttle: 1,
      mixture: 1,
      magnetos: 3 as const,
      ambientPressure: 101325,
      ambientTemperature: 288.15,
      ambientDensity: 1.225,
      ramPressure: 0,
      oilTemperature: 85,
      accessoryPower: 0,
    };
    for (let i = 0; i < 3; i++) engine.breathe(input);
    engine.burn(input, engine.fuelDemand);
    expect(((engine.indicatedTorque - engine.lossTorque) * input.omega) / HP).toBeCloseTo(120, 0);
    // A smaller engine swallows less air than the IO-360 at its rating.
    expect(engine.ratedAirFlow).toBeLessThan(new PistonEngine().ratedAirFlow * 0.75);
  });

  it('the propeller has its radius, blade count and blade angles', () => {
    const def = SMALL.engines[0].propeller;
    const solver = new BemtSolver(14, def);
    expect(solver.radius).toBe(0.875);
    expect(solver.blades).toBe(3);
    const first = solver.elements[0], last = solver.elements[solver.elements.length - 1];
    expect(first.r - 0.5 * first.dr).toBeCloseTo(0.12, 12);
    expect(last.r + 0.5 * last.dr).toBeCloseTo(0.875, 12);
    for (const e of solver.elements) expect(e.theta).toBe(Math.atan(1.3 / (2 * Math.PI * e.r)));
    // Three blades of the same planform at the same tip speed pull harder than two would.
    const three = solver.rotorLoads(0, 0, 2400 * RPM, 1.225, 340);
    const two = new BemtSolver(14, { ...def, blades: 2 }).rotorLoads(0, 0, 2400 * RPM, 1.225, 340);
    expect(three.thrust).toBeGreaterThan(two.thrust * 1.1);
    expect(three.torque).toBeGreaterThan(two.torque * 1.2);
  });

  it('the blade section is the propeller\'s (the McCauley\'s when the definition names none)', () => {
    const flatter = { ...C172_BLADE_SECTION, alpha0: -2 * DEG };
    const c = { cl: 0, cd: 0 };
    expect(sectionCoefficients(-2 * DEG, 0.2, 0.1, 0, c, flatter).cl).toBeCloseTo(0, 9);
    expect(sectionCoefficients(-2 * DEG, 0.2, 0.1, 0, c).cl).toBeGreaterThan(0.2);
    // Less camber on the same blade: less thrust and less torque at the same speed, in axial and in inclined flow.
    for (const inPlane of [0, 6]) {
      const loads = (section?: typeof flatter) => new BemtSolver(14, { ...C172_PROPELLER, section }).rotorLoads(40, inPlane, 2400 * RPM, 1.225, 340);
      const named = loads(C172_BLADE_SECTION), none = loads(), flat = loads(flatter);
      expect(none).toEqual(named);
      expect(flat.thrust).toBeLessThan(named.thrust * 0.9);
      expect(flat.torque).toBeLessThan(named.torque * 0.95);
    }
  });

  it('the powerplant runs by them: hub, disc, inertia, rating, start speed, tanks', () => {
    const sys = runningSystem(2000, SMALL);
    const unit = sys.units[0];
    expect(sys.def).toBe(SMALL);
    expect(sys.hubs).toEqual([{ x: 1.6, y: 0, z: -0.1 }]);
    expect(sys.tankCapacities).toEqual([40, 55]);
    expect([sys.fuelLeft, sys.fuelRight]).toEqual([40, 55]);
    expect(sys.fuelCapacityEach).toBe(40);
    expect(sys.propeller.radius).toBe(0.875);
    expect(unit.inertia).toBe(0.9 + 0.3);
    expect(sys.thermal.cht).toBe(150);
    expect(sys.engine.def).toBe(SMALL.engines[0].engine);
    expect(sys.engine.ratedAirFlow).toBe(new PistonEngine(SMALL.engines[0].engine).ratedAirFlow);

    const input = makeInput({ ktas: 70 });
    input.body.cgOffset = { x: -0.05, y: 0, z: -0.2 };
    let out = sys.step(input);
    for (let i = 0; i < 20 * 240; i++) out = sys.step(input);
    expect(out.engine.running).toBe(true);
    expect(out.engine.rpm).toBeGreaterThan(1500);
    expect(out.engine.rpm).toBeLessThan(3200);
    expect(out.engine.loadPercent).toBe((100 * out.engine.power) / (120 * HP));
    expect(out.propeller.bladePitch).toBe(Math.atan(1.3 / (2 * Math.PI * 0.75 * 0.875)));
    expect(out.slipstream.origin).toEqual({ x: 1.6, y: 0, z: -0.1 });
    expect(out.slipstream.radius).toBeLessThanOrEqual(0.875);
    expect(out.slipstream.radius).toBeGreaterThan(0.875 / Math.sqrt(2) - 1e-9);
    expect(out.angularMomentum.x).toBe((0.9 + 0.3) * sys.omega);
    // The thrust acts at THIS hub: its pitching moment about the CG.
    expect(out.moment.y).toBeCloseTo((-0.1 + 0.2) * out.force.x - (1.6 + 0.05) * out.force.z, 6);

    sys.reset({ running: true, tanks: [100, 100] });
    expect(sys.rpm).toBeCloseTo(900, 9);
    expect(Array.from(sys.tankQuantities)).toEqual([40, 55]);
    // "Running" is judged against this engine's speed, 300 rpm.
    const idle = runningSystem(330, SMALL);
    expect(idle.step(makeInput({ controls: { throttle: 0.3 } })).engine.running).toBe(true);
    expect(runningSystem(330).step(makeInput({ controls: { throttle: 0.3 } })).engine.running).toBe(false);
  });

  it('the selector positions draw from the tanks the feed names', () => {
    // Crossed on purpose, and no BOTH position.
    const crossed: PowerplantDef = { ...SMALL, fuel: { ...SMALL.fuel, feeds: [{ ...SMALL.fuel.feeds[0], positions: { left: [1], right: [0] } }] } };
    const drawn = (selector: 'left' | 'right' | 'both' | 'off'): boolean[] => {
      // The definition's own propeller would be a second map; the blade is not what is tested here.
      const sys = new PropulsionSystem(new Propeller(), crossed);
      sys.reset({ running: true, fuelLeft: 40, fuelRight: 40, rpm: 2300 });
      const input = makeInput({ ktas: 100, controls: { fuelSelector: selector } });
      for (let k = 0; k < Math.round(1 / DT); k++) sys.step(input);
      return [sys.fuelLeft < 40, sys.fuelRight < 40];
    };
    expect(drawn('left')).toEqual([false, true]);
    expect(drawn('right')).toEqual([true, false]);
    expect(drawn('both')).toEqual([false, false]);
    expect(drawn('off')).toEqual([false, false]);
  });

  it('the fuel pumps are the feed\'s', () => {
    const pressure = (fuel: FuelSystem, pump: boolean, volts: number): number => fuel.step(DT, 0, 'both', 0, pump, volts).pressurePsi;
    // Engine stopped: only the electric pump makes pressure, and only above its own voltage.
    expect(pressure(new FuelSystem(), true, 24)).toBe(22);
    expect(pressure(new FuelSystem(), true, 17)).toBe(0);
    expect(pressure(new FuelSystem(SMALL.fuel), true, 12)).toBe(6);
    expect(pressure(new FuelSystem(SMALL.fuel), true, 8.5)).toBe(0);
    const noAux = new FuelSystem({ ...SMALL.fuel, feeds: [{ ...SMALL.fuel.feeds[0], auxPump: undefined }] });
    expect(pressure(noAux, true, 12)).toBe(0);
    // Engine turning: the engine-driven pump, toward its own regulated pressure.
    const weak = new FuelSystem({ ...SMALL.fuel, feeds: [{ ...SMALL.fuel.feeds[0], enginePump: { psi: 12 } }] });
    expect(weak.step(DT, 0, 'both', 2400, false, 0).pressurePsi).toBeCloseTo(12 * (1 - Math.exp(-4)), 9);
    expect(new FuelSystem().step(DT, 0, 'both', 2400, false, 0).pressurePsi).toBeCloseTo(30 * (1 - Math.exp(-4)), 9);
  });

  it('the bus has the definition\'s voltages: a 14 V system regulates at 14.2 V and cranks from 12 V', () => {
    const charging = run(runningSystem(2000, SMALL), { ktas: 70, controls: { throttle: 0.6 } }, 30);
    expect(charging.electrical.busVoltage).toBeGreaterThan(13.8);
    expect(charging.electrical.busVoltage).toBeLessThanOrEqual(14.2);
    expect(charging.electrical.alternatorAmps).toBeGreaterThan(10);

    const controls = makeInput({}).controls;
    const el = new ElectricalSystem(SMALL.electrical, SMALL.engines[0].engine.starter);
    // Battery alone, engine stopped: below its open-circuit 12.9 V; the same switches draw twice the current
    // they draw from 28 V (the loads are amperes at the nominal voltage).
    const battery = { ...el.step(DT, { ...controls, alternator: false }, 0, 0) };
    expect(battery.busVoltage).toBeGreaterThan(12);
    expect(battery.busVoltage).toBeLessThan(12.9);
    const c172 = { ...new ElectricalSystem().step(DT, { ...controls, alternator: false }, 0, 0) };
    expect(c172.busVoltage).toBeGreaterThan(24);
    expect(battery.batteryAmps / battery.busVoltage).toBeCloseTo((2 * c172.batteryAmps) / c172.busVoltage, 8);
    // The search for the bus voltage ends at the definition's over-voltage threshold.
    const high = new ElectricalSystem({ ...SMALL.electrical, regulatorVolts: 40 }, SMALL.engines[0].engine.starter);
    expect(high.step(DT, controls, 2500, 2500 * RPM).busVoltage).toBeCloseTo(16, 6);
  });
});

describe('a definition that does not hold together', () => {
  // Each mechanism the refactor refused is built now (the mechanism tests: variablePitch, governor, carburettor,
  // diesel, network); what is still refused is a definition that contradicts itself.
  it('is refused where it is inconsistent, not run as something else', () => {
    const install = C172_POWERPLANT.engines[0];
    const feed = C172_FEED;
    expect(() => new Powerplant({ ...C172_POWERPLANT, engines: [install, install] })).toThrow(/2 fuel feeds/);
    expect(() => new Powerplant({ ...C172_POWERPLANT, engines: [] })).toThrow(/at least one engine/);
    const constantSpeed = {
      kind: 'constantSpeed' as const,
      fineStop: 0.25,
      coarseStop: 0.6,
      rateToFine: 0.1,
      rateToCoarse: 0.1,
      governor: { minRpm: 1800, maxRpm: 2700, gain: 0.02 },
      failsTo: 'fine' as const,
    };
    expect(() => propellerCharacteristicsFor({ ...C172_PROPELLER, pitchControl: { ...constantSpeed, pitchNodes: [0.25, 0.5] } })).toThrow(/span/);
    expect(() => new PistonEngine({ ...C172_ENGINE, kind: 'dieselFadec' })).toThrow(/spark engine/);
    expect(() => new PistonEngine({ ...C172_ENGINE, metering: { kind: 'fadecDiesel' } })).toThrow(/mixture lever/);
    expect(() => new PistonEngine({ ...C172_ENGINE, metering: { kind: 'rsaInjection', leanestFraction: 0.35 } })).toThrow(/fullRichPhi or takeoffFuelFlow/);
    const glow = { preheatSeconds: 5, amps: 40, neededBelowC: 60 };
    expect(() => new PistonEngine({ ...C172_ENGINE, ignition: { kind: 'compression', minFiringRpm: 150, glow } })).toThrow(/magnetos/);
    expect(() => new DieselEngine({ ...C172_ENGINE, kind: 'dieselFadec' })).toThrow(/FADEC diesel/);
    expect(() => new EngineThermal({ ...C172_ENGINE.thermal, cooling: 'liquid' })).toThrow(/ThermalDef.liquid/);
    expect(() => new FuelSystem({ ...C172_POWERPLANT.fuel, feeds: [{ ...feed, positions: { ...feed.positions, left: [2] } }] })).toThrow(/tank 2 of 2/);
    expect(() => new FuelSystem({ ...C172_POWERPLANT.fuel, tanks: [] })).toThrow(/at least one tank/);
    const alternator = C172_POWERPLANT.electrical.alternators[0];
    expect(() => new ElectricalSystem({ ...C172_POWERPLANT.electrical, alternators: [alternator, { ...alternator, engine: 1 }] })).toThrow(/engine 1 of 1/);
  });
});
