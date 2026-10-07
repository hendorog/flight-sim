// What the engines of an aircraft share: the fuel network (tanks, one feed per engine, selector positions,
// crossfeed, and what delivers the fuel: a float bowl at gravity head, injectors, a common rail) and the bus
// (N alternators, N starters). And the cost of the new mechanisms against the Cessna 172S, in one run.

import { describe, expect, it } from 'vitest';
import { setEngineControl } from '../../src/core/types';
import { Powerplant } from '../../src/physics/propulsion';
import { C172_POWERPLANT } from '../../src/physics/propulsion/c172Powerplant';
import type { PowerplantDef } from '../../src/physics/propulsion/defs';
import { advance, makeInput } from './helpers';
import { CARB_POWERPLANT, TWIN_CS_POWERPLANT, TWIN_DIESEL_POWERPLANT, constantSpeedUnit, singlePowerplant } from './testbed';

/** Engine `dead` of a twin failed (mixture cut-off, or a FADEC engine's fuel off with its master still on). */
function failEngine(def: PowerplantDef, controls: Parameters<typeof setEngineControl>[0], dead: number): void {
  if (def.engines[dead].engine.kind === 'dieselFadec') setEngineControl(controls, dead, 'engineMaster', false);
  else setEngineControl(controls, dead, 'mixture', 0);
  setEngineControl(controls, dead, 'fuelSelector', 'off');
}

describe('the fuel network', () => {
  // PA-34 / DA42 (pa34.md, da42.md): each engine has its own tank (ON) and can draw from the other side's
  // (CROSSFEED); with one engine failed, crossfeed is how the live engine uses the dead side's fuel.
  it('feeds the live engine from either tank through crossfeed, and from that tank only', () => {
    for (const def of [TWIN_CS_POWERPLANT, TWIN_DIESEL_POWERPLANT]) {
      for (const live of [0, 1]) {
        const dead = 1 - live, own = live, other = dead;
        for (const position of ['on', 'crossfeed'] as const) {
          const sys = new Powerplant(def);
          const airStart = def.engines[0].engine.airStartRpm;
          sys.reset({ running: true, tanks: [60, 60], rpm: [airStart, airStart] });
          const input = makeInput({ ktas: 110, altitudeFt: 3000, engines: 2, controls: { fuelSelector: 'on', throttle: 0.8, propeller: 0.9 } });
          failEngine(def, input.controls, dead);
          setEngineControl(input.controls, live, 'fuelSelector', position);
          sys.settle(input);
          advance(sys, input, 10);
          const before = Array.from(sys.tankQuantities);
          const out = advance(sys, input, 60);
          const after = Array.from(sys.tankQuantities);
          const drawn = position === 'on' ? own : other;
          expect(out.engines[live].running).toBe(true);
          expect(out.engines[dead].running).toBe(false);
          // A minute's fuel at 80 % of 150-200 hp is about 0.5-0.8 kg: all of it from the selected tank.
          expect(before[drawn] - after[drawn]).toBeGreaterThan(0.3);
          expect(after[1 - drawn]).toBe(before[1 - drawn]);
          // The legacy per-step figures are the side sums: the left wing is tank 0.
          expect(drawn === 0 ? out.fuelUsed.left : out.fuelUsed.right).toBeGreaterThan(0);
          expect(drawn === 0 ? out.fuelUsed.right : out.fuelUsed.left).toBe(0);
        }
        // The tank crossfeed draws on runs dry: the live engine starves (it really was fed from there).
        const sys = new Powerplant(def);
        const airStart = def.engines[0].engine.airStartRpm;
        const tanks = [60, 60];
        tanks[other] = 0.05;
        sys.reset({ running: true, tanks, rpm: [airStart, airStart] });
        const input = makeInput({ ktas: 110, altitudeFt: 3000, engines: 2, controls: { fuelSelector: 'on', throttle: 0.8, propeller: 0.9 } });
        failEngine(def, input.controls, dead);
        setEngineControl(input.controls, live, 'fuelSelector', 'crossfeed');
        advance(sys, input, 60);
        expect(sys.units[live].state.running).toBe(false);
        expect(sys.tankQuantities[own]).toBe(60);
      }
    }
  }, 60_000);

  it('a float bowl runs on gravity alone; below the bowl\'s head it starves', () => {
    // c152.md: no pumps; both tanks feed together through the ON / OFF valve.
    const sys = new Powerplant(CARB_POWERPLANT);
    sys.reset({ running: true, tanks: [30, 30], rpm: 2300 });
    const input = makeInput({ ktas: 90, altitudeFt: 3000, controls: { fuelSelector: 'on', throttle: 1, fuelPump: false } });
    const out = advance(sys, input, 60);
    expect(out.engine.running).toBe(true);
    expect(out.engine.fuelPressure).toBeCloseTo(CARB_POWERPLANT.fuel.feeds[0].gravityHeadPsi, 2);
    // Equal shares from both wings.
    expect(sys.tankQuantities[0]).toBeCloseTo(sys.tankQuantities[1], 9);
    expect(sys.tankQuantities[0]).toBeLessThan(30);
    // The same aircraft with too little head to open the float valve (0.1 psi; the bowl needs 0.3 for full flow
    // and nothing passes below half of that).
    const low: PowerplantDef = { ...CARB_POWERPLANT, fuel: { ...CARB_POWERPLANT.fuel, feeds: [{ ...CARB_POWERPLANT.fuel.feeds[0], gravityHeadPsi: 0.1 }] } };
    const starved = new Powerplant(low);
    starved.reset({ running: true, tanks: [30, 30], rpm: 2300 });
    expect(advance(starved, input, 60).engine.running).toBe(false);
    // OFF shuts the feed: the bowl empties, the engine stops.
    input.controls.fuelSelector = 'off';
    expect(advance(sys, input, 90).engine.running).toBe(false);
  }, 30_000);

  it('a common rail needs a pump: the engine-driven one, or the electric pump when it has none', () => {
    const noEnginePump: PowerplantDef = {
      ...TWIN_DIESEL_POWERPLANT,
      fuel: { ...TWIN_DIESEL_POWERPLANT.fuel, feeds: TWIN_DIESEL_POWERPLANT.fuel.feeds.map((feed) => ({ ...feed, enginePump: undefined })) },
    };
    for (const [def, auxPump, runs] of [[TWIN_DIESEL_POWERPLANT, false, true], [noEnginePump, false, false], [noEnginePump, true, true]] as const) {
      const sys = new Powerplant(def);
      sys.reset({ running: true, tanks: [60, 60], rpm: [3380, 3380] });
      const input = makeInput({ ktas: 110, altitudeFt: 3000, engines: 2, controls: { fuelSelector: 'on', throttle: 0.7, fuelPump: auxPump } });
      const out = advance(sys, input, 30);
      expect(out.engines[0].running).toBe(runs);
      expect(out.engines[1].running).toBe(runs);
    }
  }, 30_000);
});

describe('the bus with two alternators', () => {
  const DROOP = 0.005;
  it('a 14 V system settles at its regulator volts; two alternators share the load, one carries it alone', () => {
    // The carburetted single first: one alternator, the 14.0 V regulator.
    const single = new Powerplant(CARB_POWERPLANT);
    single.reset({ running: true, tanks: [30, 30], rpm: 2300, batteryCharge: 1 });
    const one = advance(single, makeInput({ ktas: 90, controls: { fuelSelector: 'on', throttle: 0.8 } }), 120);
    // At the regulator's set point less its droop (0.005 V per ampere it delivers, electrical.ts): the alternator,
    // not the battery (12.9 V open-circuit), holds the bus.
    expect(one.electrical.busVoltage + DROOP * one.electrical.alternatorAmps).toBeCloseTo(CARB_POWERPLANT.electrical.regulatorVolts, 6);
    expect(one.electrical.busVoltage).toBeGreaterThan(0.99 * CARB_POWERPLANT.electrical.regulatorVolts);
    expect(one.electrical.busVoltage).toBeLessThanOrEqual(CARB_POWERPLANT.electrical.overVolts);

    const sys = new Powerplant(TWIN_CS_POWERPLANT);
    sys.reset({ running: true, tanks: [60, 60], rpm: [2300, 2300], batteryCharge: 1 });
    const input = makeInput({ ktas: 120, altitudeFt: 3000, engines: 2, controls: { fuelSelector: 'on', throttle: 0.75, propeller: 0.85 } });
    input.controls.lights = { ...input.controls.lights, landing: true, nav: true, strobe: true };
    const both = advance(sys, input, 120);
    const regulator = TWIN_CS_POWERPLANT.electrical.regulatorVolts;
    expect(both.electrical.busVoltage + DROOP * both.electrical.alternators![0]).toBeCloseTo(regulator, 6);
    const [a0, a1] = both.electrical.alternators!;
    expect(a0).toBeGreaterThan(3);
    expect(a0).toBeCloseTo(a1, 6);
    expect(a0 + a1).toBeCloseTo(both.electrical.alternatorAmps, 9);
    const shared = a0 + a1;

    // Engine 0 shut down and feathered: its alternator stops; the other carries the whole load at the same volts.
    setEngineControl(input.controls, 0, 'mixture', 0);
    setEngineControl(input.controls, 0, 'propeller', 0);
    const alone = advance(sys, input, 60);
    expect(alone.engines[0].propRpm).toBe(0);
    expect(alone.electrical.alternators![0]).toBe(0);
    expect(alone.electrical.alternators![1]).toBeCloseTo(shared, 0);
    expect(alone.electrical.busVoltage + DROOP * alone.electrical.alternators![1]).toBeCloseTo(regulator, 6);
  }, 30_000);

  it('cranks each engine with its own starter; both at once draw both starters\' current', () => {
    const sys = new Powerplant(TWIN_CS_POWERPLANT);
    const input = makeInput({ engines: 2, controls: { fuelSelector: 'on', throttle: 0.1, mixture: 0 } });
    const crank = (which: boolean[]): { amps: number; rpm: number[] } => {
      sys.reset({ running: false, tanks: [60, 60], rpm: [0, 0] });
      which.forEach((on, i) => setEngineControl(input.controls, i, 'starter', on));
      const out = advance(sys, input, 2);
      return { amps: out.electrical.batteryAmps, rpm: out.engines.map((e) => e.rpm) };
    };
    const left = crank([true, false]), right = crank([false, true]), both = crank([true, true]);
    expect(left.rpm[0]).toBeGreaterThan(100);
    expect(left.rpm[1]).toBe(0);
    expect(right.rpm[1]).toBeGreaterThan(100);
    expect(right.rpm[0]).toBe(0);
    expect(left.rpm[0]).toBeCloseTo(right.rpm[1], 6);
    // Both at once: more current from the battery (it discharges: negative), each engine a little slower.
    expect(both.amps).toBeLessThan(1.5 * left.amps);
    expect(both.rpm[0]).toBeLessThan(left.rpm[0]);
  }, 30_000);
});

describe('cost', () => {
  /** Minimum over five repetitions of the time per step of `steps` steps, us. */
  function stepCost(sys: Powerplant, input: ReturnType<typeof makeInput>, steps = 4000): number {
    let best = Infinity;
    for (let rep = 0; rep < 5; rep++) {
      const t0 = performance.now();
      for (let i = 0; i < steps; i++) sys.step(input);
      best = Math.min(best, ((performance.now() - t0) * 1000) / steps);
    }
    return best;
  }

  function settleCost(sys: Powerplant, input: ReturnType<typeof makeInput>, rpm: number[], reps = 20): number {
    let best = Infinity;
    for (let rep = 0; rep < 5; rep++) {
      const t0 = performance.now();
      for (let i = 0; i < reps; i++) {
        sys.reset({ running: true, tanks: [60, 60], rpm });
        sys.settle(input);
      }
      best = Math.min(best, (performance.now() - t0) / reps);
    }
    return best;
  }

  it('a constant-speed unit step costs at most 3 x the Cessna 172S unit step; a twin settle() at most 4 x', () => {
    const c172 = new Powerplant(C172_POWERPLANT);
    c172.reset({ running: true, tanks: [70, 70], rpm: 2300 });
    const c172Input = makeInput({ ktas: 110, altitudeFt: 3000, controls: { throttle: 0.75 } });
    const cs = new Powerplant(singlePowerplant(constantSpeedUnit(1)));
    cs.reset({ running: true, tanks: [70, 70], rpm: 2300 });
    const csInput = makeInput({ ktas: 110, altitudeFt: 3000, controls: { fuelSelector: 'on', throttle: 0.75, propeller: 0.85 } });
    const twin = new Powerplant(TWIN_CS_POWERPLANT);
    const twinInput = makeInput({ ktas: 110, altitudeFt: 3000, engines: 2, controls: { fuelSelector: 'on', throttle: 0.75, propeller: 0.85 } });
    // Warm up both (slices built, code optimised), then measure alternately.
    cs.settle(csInput);
    c172.settle(c172Input);
    stepCost(c172, c172Input);
    stepCost(cs, csInput);
    const c172Step = stepCost(c172, c172Input), csStep = stepCost(cs, csInput);
    const c172Settle = settleCost(c172, c172Input, [2300]), twinSettle = settleCost(twin, twinInput, [2300, 2300]);
    console.log(
      `cost: C172S step ${c172Step.toFixed(2)} us, constant-speed step ${csStep.toFixed(2)} us (${(csStep / c172Step).toFixed(2)} x); ` +
        `C172S settle ${c172Settle.toFixed(3)} ms, constant-speed twin settle ${twinSettle.toFixed(3)} ms (${(twinSettle / c172Settle).toFixed(2)} x)`,
    );
    expect(csStep / c172Step).toBeLessThanOrEqual(3);
    expect(twinSettle / c172Settle).toBeLessThanOrEqual(4);
  }, 60_000);
});
