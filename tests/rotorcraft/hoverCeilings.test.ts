import { describe, expect, it } from 'vitest';
import { R22_DEFINITION } from '../../src/aircraft/r22';
import { r22Map } from '../../src/aircraft/r22/limits';
import { FT, HP, LB } from '../../src/core/math';
import { createFlightModelFor } from '../../src/physics';
import { atmosphereAt } from '../../src/physics/atmosphere';
import { PistonEngine } from '../../src/physics/propulsion/engine';
import { flatEnvironment } from '../fdm/helpers';
import { writeTrace } from './scriptedPilot';

// POH 5-6 (IGE at 2 ft skid clearance) / 5-10 (OGE), Beta II, zero wind. Hand-read to ~200 ft.
// Compare at the charts' 104% RPM, not the governor's 103.5% target. These are approximate chart
// checks: the remaining ~1000 ft gross-weight OGE error is documented, not certified accuracy.
const points = [
  { lb: 1370, temp: -20, oge: 7500, ige: 10400 },
  { lb: 1370, temp: 0, oge: 5500, ige: 9200 },
  { lb: 1370, temp: 20, oge: 3700, ige: 8150 },
  { lb: 1370, temp: 40, oge: 2200, ige: 7150 },
  { lb: 1300, temp: -20, oge: 9000, ige: 11600 },
  { lb: 1300, temp: 0, oge: 7900, ige: 10500 },
  { lb: 1300, temp: 20, oge: 6900, ige: 9350 },
  { lb: 1300, temp: 40, oge: 6000, ige: 8400 },
];

export function hoverCeiling(lb: number, temp: number, ige: boolean) {
  const definition = { ...R22_DEFINITION, rotorcraft: { ...R22_DEFINITION.rotorcraft!, nominalRpm: 510 * 1.04 } };
  const fm = createFlightModelFor(definition), d = definition.rotorcraft;
  const fuel = definition.powerplant.fuel.tanks.reduce((sum, tank) => sum + tank.capacity, 0);
  fm.setLoading({ ...definition.mass.loadings.maxGross, payload: lb * LB - definition.mass.empty - fuel });
  const engine = new PistonEngine(definition.powerplant.engines[0].engine);
  let low = 0, high = 14000, demandHp = 0, availableHp = 0, map = 0;
  for (let step = 0; step < 13; step++) {
    const ft = (low + high) / 2, a = atmosphereAt(ft * FT);
    a.temperature = temp + 273.15;
    a.density = a.pressure / (287.05287 * a.temperature);
    a.speedOfSound = Math.sqrt(1.4 * 287.05287 * a.temperature);
    const env = { ...flatEnvironment(undefined, ft * FT), atmosphere: () => a };
    fm.reset({ position: { x: 0, y: 0, z: -(ft * FT + (ige ? d.skids.z + 2 * FT : 100)) },
      heading: 0, airspeed: 0, onGround: false, engineRunning: true }, env);
    expect(fm.lastTrim?.converged).toBe(true);
    const p = { omega: d.nominalRpm * d.engineRatio * Math.PI / 30, throttle: 1, mixture: 1, magnetos: 3 as const,
      ambientPressure: a.pressure, ambientTemperature: a.temperature, ambientDensity: a.density,
      ramPressure: 0, oilTemperature: 85, accessoryPower: 300 };
    const placard = r22Map(ft * FT, a.temperature) + 0.9;
    let closed = 0, open = 1;
    for (let j = 0; j < 22; j++) {
      p.throttle = (closed + open) / 2;
      for (let k = 0; k < 5; k++) engine.breathe(p);
      if (engine.manifoldPressure / 3386.389 > placard) open = p.throttle; else closed = p.throttle;
    }
    engine.burn(p, engine.fuelDemand);
    availableHp = Math.min(d.systems.takeoffPower / HP, (engine.indicatedTorque - engine.lossTorque) * p.omega / HP);
    const r = fm.state.rotorcraft!;
    demandHp = r.torque * r.omega / d.transmissionEfficiency / HP;
    map = engine.manifoldPressure / 3386.389;
    if (availableHp >= demandHp) low = ft; else high = ft;
  }
  return { ft: (low + high) / 2, demandHp, availableHp, map };
}

describe('R22 Beta II hover charts, MAP-limited warm engine, full rich', () => {
  it('checks gross/lighter weights and cold/hot conditions in and out of ground effect', () => {
    const report = points.map(p => ({ ...p, modelOge: hoverCeiling(p.lb, p.temp, false), modelIge: hoverCeiling(p.lb, p.temp, true) }));
    writeTrace('ceilings', report);
    for (const p of report) {
      expect(Math.abs(p.modelOge.ft - p.oge), `${p.lb} lb, ${p.temp} C OGE`).toBeLessThan(1500);
      expect(Math.abs(p.modelIge.ft - p.ige), `${p.lb} lb, ${p.temp} C IGE`).toBeLessThan(750);
      expect(p.modelIge.ft).toBeGreaterThan(p.modelOge.ft);
      expect(p.modelOge.availableHp).toBeLessThanOrEqual(131);
    }
    for (const lb of [1370, 1300]) {
      const temperatures = report.filter(p => p.lb === lb);
      for (let i = 1; i < temperatures.length; i++) {
        expect(temperatures[i].modelOge.ft).toBeLessThan(temperatures[i - 1].modelOge.ft);
        expect(temperatures[i].modelIge.ft).toBeLessThan(temperatures[i - 1].modelIge.ft);
      }
    }
    for (let i = 0; i < 4; i++) expect(report[i + 4].modelOge.ft).toBeGreaterThan(report[i].modelOge.ft);
  }, 120000);
});
