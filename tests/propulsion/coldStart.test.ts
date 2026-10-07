// Starting a cold engine (FuelMeteringDef.primeFlow, FuelFeedDef.film.cold, ThermalDef.oilGauge and
// oilColdOverdrivePsi), on the PA-34, the first type that has them: the servo primes with the electric pump on and
// shows it on the fuel-flow gauge; a cold engine needs that prime (pa34.md s.10) and too much floods it; the oil
// pressure gauge comes up over a few seconds with cold oil and reads in the green. The Cessna 172S has none of
// these members and starts as it always has (its goldens pin that).

import { describe, expect, it } from 'vitest';
import { setEngineControl, type ControlInputs } from '../../src/core/types';
import { Powerplant } from '../../src/physics/propulsion';
import { C172_POWERPLANT } from '../../src/physics/propulsion/c172Powerplant';
import type { PowerplantDef } from '../../src/physics/propulsion/defs';
import { PA34_POWERPLANT } from '../../src/aircraft/pa34/powerplant';
import { DT, GPH_PER_KG_S, makeInput } from './helpers';

/** A cold-soaked aircraft at `oat` (K): master on, magnetos on, throttle cracked, everything else off. */
function coldAndDark(def: PowerplantDef, oat = 288.15) {
  const sys = new Powerplant(def);
  const n = def.engines.length;
  sys.reset({ running: false, tanks: sys.tankCapacities, oat });
  const input = makeInput({ engines: n, controls: { masterBattery: true, throttle: 0.07, propeller: 1, mixture: 0 } });
  input.atmosphere.temperature = oat;
  for (let i = 0; i < n; i++) {
    setEngineControl(input.controls, i, 'magnetos', 3);
    setEngineControl(input.controls, i, 'mixture', 0);
  }
  return { sys, input, c: input.controls };
}

/** Step until engine 0 runs or `seconds` pass; returns the time it took (NaN: it did not start). */
function crank(sys: Powerplant, input: ReturnType<typeof makeInput>, seconds: number, onFire?: (c: ControlInputs) => void): number {
  setEngineControl(input.controls, 0, 'starter', true);
  const steps = Math.round(seconds / DT);
  for (let k = 1; k <= steps; k++) {
    sys.step(input);
    if (sys.units[0].state.running) {
      setEngineControl(input.controls, 0, 'starter', false);
      onFire?.(input.controls);
      return k * DT;
    }
  }
  setEngineControl(input.controls, 0, 'starter', false);
  return NaN;
}

function hold(sys: Powerplant, input: ReturnType<typeof makeInput>, seconds: number): void {
  for (let k = Math.round(seconds / DT); k > 0; k--) sys.step(input);
}

/** Prime engine 0 for `seconds`: electric pump on and the mixture rich, then both back off. */
function prime(sys: Powerplant, input: ReturnType<typeof makeInput>, seconds: number): number {
  setEngineControl(input.controls, 0, 'fuelPump', true);
  setEngineControl(input.controls, 0, 'mixture', 1);
  hold(sys, input, seconds);
  const flow = sys.units[0].state.fuelFlow;
  setEngineControl(input.controls, 0, 'fuelPump', false);
  setEngineControl(input.controls, 0, 'mixture', 0);
  return flow;
}

describe('starting a cold engine', () => {
  it('the servo primes with the electric pump on and the mixture rich, and the fuel-flow gauge shows it', () => {
    const { sys, input } = coldAndDark(PA34_POWERPLANT);
    const flow = prime(sys, input, 2) * GPH_PER_KG_S;
    // pa34.md s.10: "Mixture — rich until fuel flow shows" (about 5 gal/h, ESTIMATE).
    expect(flow).toBeGreaterThan(4);
    expect(flow).toBeLessThan(6);
    // Pump off (no pressure at rest), or the mixture in cut-off: nothing flows.
    setEngineControl(input.controls, 0, 'mixture', 1);
    hold(sys, input, 1);
    expect(sys.units[0].state.fuelFlow).toBe(0);
    setEngineControl(input.controls, 0, 'mixture', 0);
    setEngineControl(input.controls, 0, 'fuelPump', true);
    hold(sys, input, 1);
    expect(sys.units[0].state.fuelFlow).toBe(0);
    // The other engine, its pump off, got none of it.
    expect(sys.units[1].state.fuelFlow).toBe(0);
  });

  it('needs the prime when cold, fires at once with it, and floods with far too much', () => {
    // No prime, cranked with the mixture rich at 15 C: the spray wets the cold ports and it takes seconds of
    // cranking to build enough vapour; at -11 C close to the 30 s starter limit.
    let t = coldAndDark(PA34_POWERPLANT);
    const unprimed = crank(t.sys, t.input, 10);
    t = coldAndDark(PA34_POWERPLANT);
    setEngineControl(t.c, 0, 'mixture', 1);
    const unprimedRich = crank(t.sys, t.input, 30);
    expect(unprimed).toBeNaN(); // mixture in cut-off and no prime: nothing to burn
    expect(unprimedRich).toBeGreaterThan(3);
    expect(unprimedRich).toBeLessThan(12);
    t = coldAndDark(PA34_POWERPLANT, 262);
    setEngineControl(t.c, 0, 'mixture', 1);
    expect(crank(t.sys, t.input, 30)).toBeGreaterThan(12);

    // The handbook start: primed 4 s, cranked in idle cut-off, the mixture advanced as it fires; it keeps running.
    t = coldAndDark(PA34_POWERPLANT);
    prime(t.sys, t.input, 4);
    const primed = crank(t.sys, t.input, 10, (c) => setEngineControl(c, 0, 'mixture', 1));
    expect(primed).toBeLessThan(1.5);
    hold(t.sys, t.input, 20);
    expect(t.sys.units[0].state.running).toBe(true);

    // A minute of pump with the mixture rich on a warmer day floods it: several seconds of cranking before it fires.
    t = coldAndDark(PA34_POWERPLANT, 301);
    prime(t.sys, t.input, 60);
    setEngineControl(t.c, 0, 'mixture', 1);
    expect(crank(t.sys, t.input, 30)).toBeGreaterThan(5);

    // A warm engine (just shut down) needs no prime.
    const warm = new Powerplant(PA34_POWERPLANT);
    warm.reset({ running: false, warm: true, tanks: warm.tankCapacities });
    const input = makeInput({ engines: 2, controls: { masterBattery: true, throttle: 0.07, propeller: 1 } });
    setEngineControl(input.controls, 0, 'magnetos', 3);
    setEngineControl(input.controls, 0, 'mixture', 1);
    expect(crank(warm, input, 10)).toBeLessThan(1.5);
  });

  it('the oil-pressure gauge comes up over a few seconds with cold oil, in the green at 15 C', () => {
    const { sys, input } = coldAndDark(PA34_POWERPLANT);
    prime(sys, input, 4);
    crank(sys, input, 10, (c) => setEngineControl(c, 0, 'mixture', 1));
    const th = sys.units[0].thermal;
    expect(th.oilGaugePsi).toBeLessThan(th.oilPressure - 5);
    const gauge: number[] = [];
    for (let s = 0; s < 30; s++) {
      hold(sys, input, 1);
      gauge.push(sys.units[0].state.oilPressure);
    }
    // s.10: "Oil pressure — rising within 30 s"; s.7: green 60-90 psi, red line 90.
    expect(gauge[0]).toBeGreaterThan(5);
    expect(gauge[0]).toBeLessThan(60);
    expect(gauge[29]).toBeGreaterThan(60);
    expect(Math.max(...gauge)).toBeLessThan(90);
  });

  it('leaves an engine without the members as it was: the 172S fires unprimed, and its gauge reads the pressure', () => {
    const { sys, input, c } = coldAndDark(C172_POWERPLANT);
    c.fuelPump = true;
    setEngineControl(c, 0, 'fuelPump', true);
    setEngineControl(c, 0, 'mixture', 1);
    hold(sys, input, 2);
    expect(sys.units[0].state.fuelFlow).toBe(0);
    setEngineControl(c, 0, 'fuelPump', false);
    c.fuelPump = false;
    expect(crank(sys, input, 10)).toBeLessThan(1.5);
    hold(sys, input, 1);
    expect(sys.units[0].state.oilPressure).toBe(sys.units[0].thermal.oilPressure);
  });
});
