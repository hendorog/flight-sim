import { afterAll, describe, expect, it } from 'vitest';
import { S269_DEFINITION as def } from '../../src/aircraft/s269';
import { S269_ENGINE } from '../../src/aircraft/s269/powerplant';
import { S269_CG_LIMITS } from '../../src/aircraft/s269/limits';
import { createFlightModelFor } from '../../src/physics';
import { atmosphereAt } from '../../src/physics/atmosphere';
import { PistonEngine } from '../../src/physics/propulsion/engine';
import { DEG, FT, HP, KT, LB, v3 } from '../../src/core/math';
import { flatEnvironment } from '../fdm/helpers';
const d = def.rotorcraft!;
interface TraceFs { mkdirSync(path: string, options: { recursive: boolean }): void; writeFileSync(path: string, data: string): void }
const trace = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.S269_TRACE;
const fs = trace ? await import(/* @vite-ignore */ 'node:fs' as string) as TraceFs : undefined;
const report: Record<string, unknown> = {};
afterAll(() => { fs?.mkdirSync('work/s269-fm', { recursive: true }); fs?.writeFileSync('work/s269-fm/performance.json', JSON.stringify(report, null, 2)); });
function environment(ft = 0, temp = 15) {
  const a = atmosphereAt(ft * FT);
  a.temperature = temp + 273.15; a.density = a.pressure / (287.05287 * a.temperature);
  a.speedOfSound = Math.sqrt(1.4 * 287.05287 * a.temperature);
  return { ...flatEnvironment(undefined, 0), atmosphere: () => a };
}
function enginePower(ft: number, temp: number, mixture = 1, rpm = 2700, throttle = 1) {
  const a = environment(ft, temp).atmosphere(), engine = new PistonEngine(S269_ENGINE);
  const input = { omega: rpm * Math.PI / 30, throttle, mixture, magnetos: 3 as const,
    ambientPressure: a.pressure, ambientTemperature: a.temperature, ambientDensity: a.density,
    ramPressure: 0, oilTemperature: 85, accessoryPower: 300 };
  for (let i = 0; i < 30; i++) engine.breathe(input);
  engine.burn(input, engine.fuelDemand);
  return { hp: (engine.indicatedTorque - engine.lossTorque) * input.omega / HP,
    phi: engine.phi, gph: engine.fuelDemand * 3600 / (6 * LB), map: engine.manifoldPressure / 3386.389 };
}
function hoverDemand(lb: number, temp: number, ft: number, ige: boolean) {
  const definition = { ...def, rotorcraft: { ...d, nominalRpm: 471 } };
  const fm = createFlightModelFor(definition), env = environment(ft, temp);
  const fuel = def.powerplant.fuel.tanks.reduce((sum, t) => sum + t.capacity, 0);
  fm.setLoading({ ...def.mass.loadings.maxGross, payload: lb * LB - def.mass.empty - fuel });
  fm.reset({ position: { x: 0, y: 0, z: -(ige ? d.skids.z + 2 * FT : 100) }, heading: 0,
    airspeed: 0, onGround: false, engineRunning: true }, env);
  expect(fm.lastTrim?.converged).toBe(true);
  return fm.state.rotorcraft!.torque * fm.state.rotorcraft!.omega / d.transmissionEfficiency / HP;
}
function bestPower(ft: number, temp: number, leaned: boolean) {
  // Chart says leaned but supplies no lever position; optimize the model's mixture at each condition.
  return Math.max(...(leaned ? [0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1] : [1]).map(m => enginePower(ft, temp, m).hp));
}

describe('269C-1 carburetted performance evidence', () => {
  it('delivers the published 180 hp WOT rating and a monotonic part-throttle power curve', () => {
    const curve = [0.3, 0.4, 0.6, 0.8, 1].map(throttle => ({ throttle, ...enginePower(0, 15, 1, 2700, throttle) }));
    report.engine = curve;
    // Published rating is whole horsepower; compare pre-accessory brake power at that precision.
    // The trace retains the unrounded result and the independently sourced fuel-flow anchor.
    expect(curve.at(-1)!.hp + 300 / HP).toBeCloseTo(180, 0);
    for (let i = 1; i < curve.length; i++) expect(curve[i].hp).toBeGreaterThan(curve[i-1].hp);
    expect(S269_ENGINE.metering.kind).toBe('floatCarburettor');
    expect(bestPower(6000, 15, true)).toBeGreaterThan(bestPower(6000, 15, false));
  });
  for (const gross of [true, false]) it(`${gross ? '1750 lb' : 'solo'} power curve and trim authority`, () => {
    const curve = [0, 20, 40, 60, 90].map(kt => {
      const fm = createFlightModelFor(def); if (gross) fm.setLoading(def.mass.loadings.maxGross);
      fm.reset({ position: { x: 0, y: 0, z: -100 }, heading: 0, airspeed: kt * KT,
        onGround: false, engineRunning: true, fuelFraction: gross ? 1 : 0.5 }, environment());
      const r = fm.state.rotorcraft!;
      expect(fm.lastTrim?.converged, `${kt} KIAS`).toBe(true);
      expect(fm.lastTrim!.residual).toBeLessThan(1e-4);
      return { kt, hp: r.torque * r.omega / d.transmissionEfficiency / HP, collective: fm.trimControls.collective,
        elevator: fm.trimControls.elevator, aileron: fm.trimControls.aileron, rudder: fm.trimControls.rudder,
        pitch: fm.state.pitch / DEG, roll: fm.state.roll / DEG };
    });
    report[gross ? 'grossPower' : 'soloPower'] = curve;
    expect(curve[2].hp).toBeLessThan(curve[0].hp);
    expect(curve[4].hp).toBeGreaterThan(curve[2].hp);
    expect(curve[0].hp).toBeLessThan(180);
    expect(curve[4].elevator).toBeLessThan(curve[0].elevator);
  });
  it('trims all 24 longitudinal/lateral CG corner cases at 1400/1750 lb and 0/41/90 KIAS', () => {
    const rows = [], fuelMoment = def.powerplant.fuel.tanks.reduce((sum, t) => v3.add(sum, v3.scale(t.position, t.capacity)), v3.zero());
    const fuel = def.powerplant.fuel.tanks.reduce((sum, t) => sum + t.capacity, 0);
    for (const lb of [1400, 1750]) for (const station of [S269_CG_LIMITS.forward, S269_CG_LIMITS.aft])
      for (const lateral of [S269_CG_LIMITS.left, S269_CG_LIMITS.right]) for (const kt of [0, 41, 90]) {
        const mass = lb * LB, payload = mass - def.mass.empty - fuel;
        const cg = { x: (100 - station) * 0.0254, y: lateral * 0.0254, z: 0 };
        // Explicit virtual ballast tests the envelope; it is not a passenger/loading preset.
        const position = v3.scale(v3.sub(v3.sub(v3.scale(cg, mass), fuelMoment),
          v3.scale(def.mass.emptyCg!, def.mass.empty)), 1 / payload);
        const fm = createFlightModelFor(def); fm.setLoading({ payload, payloadPosition: position });
        fm.reset({ position: { x: 0, y: 0, z: -100 }, heading: 0, airspeed: kt * KT,
          onGround: false, engineRunning: true }, environment());
        rows.push({ lb, station, lateral, kt, converged: fm.lastTrim?.converged, residual: fm.lastTrim?.residual,
          elevator: fm.trimControls.elevator, aileron: fm.trimControls.aileron, rudder: fm.trimControls.rudder });
      }
    report.cgTrims = rows;
    for (const row of rows) {
      expect(row.converged, JSON.stringify(row)).toBe(true);
      expect(row.residual).toBeLessThan(1e-4);
      expect(Math.max(Math.abs(row.elevator), Math.abs(row.aileron), Math.abs(row.rudder))).toBeLessThan(1);
    }
  }, 120000);
  it('records RFM 5-3/5-4 IGE residuals and unvalidated OGE predictions without concealing chart error', () => {
    // Viewed cached carburetted charts, printed 5-4/5-4.1. Hand reading ±200 ft.
    // These are full-rich/leaned respectively, NOT doors-on/off or CBi charts.
    const points = [
      { lb: 1750, fahrenheit: 0, rich: 6300, lean: 6800 },
      { lb: 1750, fahrenheit: 40, rich: 4100, lean: 4500 },
      { lb: 1750, fahrenheit: 80, rich: 1900, lean: 2500 },
      { lb: 1600, fahrenheit: 0, rich: 8000, lean: 8600 },
      { lb: 1600, fahrenheit: 40, rich: 5800, lean: 6300 },
      { lb: 1600, fahrenheit: 80, rich: 3500, lean: 4300 },
    ];
    const rows = points.flatMap(p => [false, true].map(leaned => {
      const temp = (p.fahrenheit - 32) * 5 / 9, chart = leaned ? p.lean : p.rich;
      const demand = hoverDemand(p.lb, temp, chart, true), available = bestPower(chart, temp, leaned);
      const ceilings = [false, true].map(ige => {
        let low = 0, high = 12000;
        for (let i = 0; i < 8; i++) {
          const ft = (low + high) / 2;
          if (bestPower(ft, temp, leaned) >= hoverDemand(p.lb, temp, ft, ige)) low = ft; else high = ft;
        }
        return (low + high) / 2;
      });
      return { ...p, leaned, temp, chart, demand, available, relativePowerError: demand / available - 1,
        ogePrediction: ceilings[0], igePrediction: ceilings[1], errorFt: ceilings[1] - chart };
    }));
    report.hover = rows;
    // Numerical/physical ordering check only. Strict chart agreement is reported separately;
    // no model-error allowance is disguised as the ±200-ft digitization uncertainty.
    for (const row of rows) {
      expect(Number.isFinite(row.relativePowerError)).toBe(true);
      expect(row.igePrediction).toBeGreaterThan(row.ogePrediction);
    }
  }, 120000);
});
