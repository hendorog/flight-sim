import { afterAll, describe, expect, it } from 'vitest';
import { R44_DEFINITION as def } from '../../src/aircraft/r44';
import { R44_ENGINE } from '../../src/aircraft/r44/powerplant';
import { r44CgLimits, r44Map } from '../../src/aircraft/r44/limits';
import { r44Occupants } from '../../src/aircraft/r44/mass';
import { createFlightModelFor } from '../../src/physics';
import { atmosphereAt } from '../../src/physics/atmosphere';
import { PistonEngine } from '../../src/physics/propulsion/engine';
import { cloneControls } from '../../src/core/types';
import { DEG, FT, HP, KT, LB, clamp, v3 } from '../../src/core/math';
import { flatEnvironment } from '../fdm/helpers';
import { ScriptedPilot, observePilot } from '../../src/sim/rotorcraft/scriptedPilot';
import { attitudePilot } from './helpers';

const d = def.rotorcraft!, DT = 1 / 240;
// Follow the repository's node-types-free optional trace harness.
interface TraceFs { mkdirSync(path: string, options: { recursive: boolean }): void; writeFileSync(path: string, data: string): void }
const trace = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.R44_TRACE;
const fs = trace ? await import(/* @vite-ignore */ 'node:fs' as string) as TraceFs : undefined;
const report: Record<string, unknown> = {};
afterAll(() => { fs?.mkdirSync('work/r44-fm', { recursive: true }); fs?.writeFileSync('work/r44-fm/performance.json', JSON.stringify(report, null, 2)); });
function environment(ft = 0, celsius = 15) {
  const a = atmosphereAt(ft * FT);
  a.temperature = celsius + 273.15; a.density = a.pressure / (287.05287 * a.temperature);
  a.speedOfSound = Math.sqrt(1.4 * 287.05287 * a.temperature);
  return { ...flatEnvironment(undefined, 0), atmosphere: () => a };
}
function rig(kt: number, gross = true, env = environment()) {
  const fm = createFlightModelFor(def);
  if (gross) fm.setLoading(def.mass.loadings.maxGross);
  fm.reset({ position: { x: 0, y: 0, z: -1500 }, heading: 0,
    airspeed: kt * KT * Math.sqrt(1.225 / env.atmosphere().density), onGround: false,
    engineRunning: true, fuelFraction: gross ? 1 : 0.5 }, env);
  return { fm, c: cloneControls(fm.trimControls) };
}
function enginePower(ft: number, temp: number) {
  const a = environment(ft, temp).atmosphere(), engine = new PistonEngine(R44_ENGINE);
  const limit = r44Map(ft * FT, a.temperature) + 2.8;
  const p = { omega: 2718 * Math.PI / 30, throttle: 1, mixture: 1, magnetos: 3 as const,
    ambientPressure: a.pressure, ambientTemperature: a.temperature, ambientDensity: a.density,
    ramPressure: 0, oilTemperature: 85, accessoryPower: 300 };
  let low = 0, high = 1;
  for (let i = 0; i < 24; i++) {
    p.throttle = (low + high) / 2;
    for (let j = 0; j < 8; j++) engine.breathe(p);
    if (engine.manifoldPressure / 3386.389 > limit) high = p.throttle; else low = p.throttle;
  }
  engine.burn(p, engine.fuelDemand);
  return Math.min(245, (engine.indicatedTorque - engine.lossTorque) * p.omega / HP);
}
function hoverDemand(lb: number, temp: number, ft: number, ige: boolean) {
  const definition = { ...def, rotorcraft: { ...d, nominalRpm: 408 } };
  const fm = createFlightModelFor(definition), env = environment(ft, temp);
  const fuel = def.powerplant.fuel.tanks.reduce((sum, tank) => sum + tank.capacity, 0);
  fm.setLoading({ ...def.mass.loadings.maxGross, payload: lb * LB - def.mass.empty - fuel });
  fm.reset({ position: { x: 0, y: 0, z: -(ige ? d.skids.z + 2 * FT : 100) }, heading: 0,
    airspeed: 0, onGround: false, engineRunning: true }, env);
  expect(fm.lastTrim?.converged).toBe(true);
  return fm.state.rotorcraft!.torque * fm.state.rotorcraft!.omega / d.transmissionEfficiency / HP;
}

describe('R44 Raven II performance acceptance, still air', () => {
  for (const gross of [true, false]) it(`${gross ? '2500 lb' : 'solo'} power curve and control sense`, () => {
    const curve = [0, 20, 40, 60, 90, 108].map(kt => {
      const r = rig(kt, gross), s = r.fm.state;
      expect(r.fm.lastTrim?.converged, `${kt} KIAS`).toBe(true);
      expect(r.fm.lastTrim!.residual).toBeLessThan(0.001);
      return { kt, hp: s.rotorcraft!.torque * s.rotorcraft!.omega / d.transmissionEfficiency / HP,
        collective: r.c.collective!, cyclic: r.c.elevator, pedal: r.c.rudder, pitch: s.pitch / DEG, roll: s.roll / DEG };
    });
    report[gross ? 'grossCurve' : 'soloCurve'] = curve;
    expect(curve[2].hp).toBeLessThan(curve[0].hp * 0.8);
    expect(curve[2].collective).toBeLessThan(curve[0].collective);
    expect(curve[5].collective).toBeGreaterThan(curve[2].collective);
    expect(curve[5].cyclic).toBeLessThan(curve[0].cyclic);
    expect(curve[2].pedal).toBeGreaterThan(curve[0].pedal);
    expect(curve[0].hp).toBeLessThan(245);
    // POH 5-7 later-aircraft noise-test Vh is 108 KTAS, MCP. Model SL/ISA comparison,
    // not a published complete power curve (noise-test atmosphere/loading details are incomplete).
    if (gross) expect(Math.abs(curve[5].hp - 205)).toBeLessThan(15);
  }, 120000);

  it('has trim authority at longitudinal/lateral CG envelope corners, including 60 and 100 KIAS', () => {
    const trims = [], fuel = def.powerplant.fuel.tanks.map(t => t.capacity);
    const fuelMoment = def.powerplant.fuel.tanks.reduce((sum, t) => v3.add(sum, v3.scale(t.position, t.capacity)), v3.zero());
    for (const lb of [2100, 2500]) {
      const limits = r44CgLimits(lb * LB, 100);
      for (const station of [limits.forward, limits.aft]) for (const side of [-1, 1]) for (const kt of [0, 60, 100]) {
        const cg = { x: (100 - station) * 0.0254, y: side * r44CgLimits(lb * LB, station).lateral * 0.0254, z: 0 };
        const payload = lb * LB - def.mass.empty - fuel.reduce((a, b) => a + b, 0);
        // Virtual test ballast places the total CG exactly at each boundary. These are not selectable
        // passenger presets and do not imply every boundary is attainable with four equal occupants.
        const position = v3.scale(v3.sub(v3.sub(v3.scale(cg, lb * LB), fuelMoment),
          v3.scale(def.mass.emptyCg!, def.mass.empty)), 1 / payload);
        const fm = createFlightModelFor(def);
        fm.setLoading({ payload, payloadPosition: position, payloadDistribution: [{ fraction: 1, offset: v3.zero() }] });
        fm.reset({ position: { x: 0, y: 0, z: -1500 }, heading: 0, airspeed: kt * KT,
          onGround: false, engineRunning: true }, environment());
        const c = fm.trimControls;
        trims.push({ lb, station, side, kt, converged: fm.lastTrim?.converged,
          residual: fm.lastTrim?.residual, elevator: c.elevator, aileron: c.aileron, rudder: c.rudder });
      }
    }
    report.cgTrims = trims;
    for (const t of trims) {
      expect(t.converged, JSON.stringify(t)).toBe(true);
      expect(t.residual).toBeLessThan(0.001);
      expect(Math.max(Math.abs(t.elevator), Math.abs(t.aileron), Math.abs(t.rudder))).toBeLessThan(1);
    }
  }, 120000);

  it('compares IGE/OGE chart power balance and reports the remaining ceiling error', () => {
    // Hand-read POH 5-4/5-5, 3 Oct 2002, approximately ±200 ft. The gross/hot OGE knee is
    // a TOP limit, not just an altitude-density curve. No wind; IGE at 2 ft skid height.
    const points = [
      { lb: 2500, temp: -20, oge: 6600, ige: 10000 }, { lb: 2500, temp: 0, oge: 5000, ige: 8800 },
      { lb: 2500, temp: 20, oge: 3000, ige: 7500 }, { lb: 2500, temp: 40, oge: 1000, ige: 6300 },
      { lb: 2300, temp: -20, oge: 8750, ige: 12000 }, { lb: 2300, temp: 0, oge: 7400, ige: 10700 },
      { lb: 2300, temp: 20, oge: 6200, ige: 9400 }, { lb: 2300, temp: 40, oge: 5000, ige: 8150 },
    ];
    const results = points.flatMap(p => [false, true].map(ige => {
      const chart = ige ? p.ige : p.oge;
      const demand = hoverDemand(p.lb, p.temp, chart, ige), available = enginePower(chart, p.temp);
      let low = 0, high = 14000;
      for (let i = 0; i < 9; i++) {
        const ft = (low + high) / 2;
        if (enginePower(ft, p.temp) >= hoverDemand(p.lb, p.temp, ft, ige)) low = ft; else high = ft;
      }
      return { ...p, ige, chart, model: (low + high) / 2, demand, available, relativePowerError: demand / available - 1 };
    }));
    report.hoverCharts = results;
    // 10% is a model power-balance allowance, NOT the chart-reading uncertainty. Root ceilings
    // can differ by >1000 ft, especially near the TOP knee; actual residuals stay in the report.
    for (const p of results) expect(Math.abs(p.relativePowerError), JSON.stringify(p)).toBeLessThan(0.1);
    for (let i = 0; i < results.length; i += 2) expect(results[i+1].model).toBeGreaterThan(results[i].model);
  }, 120000);

  it('checks the MM 10-17 low-collective target at three light loadings', () => {
    const rows = [];
    for (const onboard of [260, 300, 360]) {
      const env = environment(2000, 20), r = rig(50, false, env);
      r.fm.setLoading(r44Occupants([0, Math.min(280, onboard - 20) * LB, Math.max(0, onboard - 300) * LB, 0]));
      r.fm.reset({ position: { x: 0, y: 0, z: -1500 }, heading: 0,
        airspeed: 50 * KT * Math.sqrt(1.225 / env.atmosphere().density), onGround: false,
        engineRunning: true, fuelFraction: 20 / 279 }, env);
      r.c = cloneControls(r.fm.trimControls); r.c.mixture = 0; r.c.collective = 0;
      // IAS feedback, unlike the demonstration pilot's visual forward-speed loop (TAS at altitude).
      const pilot = attitudePilot(r, 50);
      for (let i = 0; i < 65 / DT; i++) {
        pilot(DT);
        r.fm.step(DT, r.c, env);
      }
      const s = r.fm.state, station = 100 - r.fm.massProperties.cgOffset.x / 0.0254;
      // Printed example: 300 lb onboard / 2000 ft / 20 C -> 99%, plus .75% per inch forward
      // of FS100. Adjacent weight lines in the figure are spaced ~3 percentage points/100 lb.
      const target = 99 + 0.03 * (onboard - 300) + 0.75 * Math.max(0, 100 - station);
      rows.push({ onboard, station, target, rpm: s.rotorcraft!.rotorRpm / 4, ias: s.ias / KT, sink: -s.verticalSpeed / 0.00508 });
      expect(s.crashed).toBe(false);
      expect(Math.abs(s.ias / KT - 50)).toBeLessThan(1);
    }
    report.lowStop = rows;
    // Reading/model allowance ±3 points; factory flight rigging itself specifies ±1 point.
    for (const p of rows) expect(Math.abs(p.rpm - p.target), JSON.stringify(p)).toBeLessThan(3);
  }, 120000);

  it('checks POH 3-3 minimum sink and maximum glide configurations at 90% rotor RPM', () => {
    const rows = [];
    for (const kt of [55, 90]) {
      const env = environment(), r = rig(kt), pilot = new ScriptedPilot(observePilot(r.fm.state, d), r.c);
      r.c.mixture = 0; r.c.collective = 0;
      let integral = 0, previous = 101.5, trend = 0;
      for (let i = 0; i < 70 / DT; i++) {
        const s = observePilot(r.fm.state, d), error = s.rotorPercent - 90;
        trend += ((s.rotorPercent - previous) / DT - trend) * (1 - Math.exp(-DT / 0.3));
        previous = s.rotorPercent; integral = clamp(integral + 0.004 * error * DT, 0, 0.5);
        pilot.step(DT, s, r.c, kt, -1, undefined, clamp(integral + 0.02 * error + 0.005 * trend, 0, 0.7), 0.15);
        r.fm.step(DT, r.c, env);
      }
      const s = r.fm.state, rpm = s.rotorcraft!.rotorRpm / 4, sink = -s.verticalSpeed / 0.00508;
      const glide = s.groundSpeed / -s.verticalSpeed;
      rows.push({ kt, rpm, sink, glide, ias: s.ias / KT, collective: r.c.collective });
      expect(s.crashed).toBe(false);
      expect(Math.abs(rpm - 90)).toBeLessThan(1);
      expect(Math.abs(s.ias / KT - kt)).toBeLessThan(2);
      expect(s.rotorcraft!.driveTorque).toBe(0);
      if (kt === 55) expect(Math.abs(sink - 1350)).toBeLessThan(250);
      else expect(Math.abs(glide - 4.7)).toBeLessThan(0.7);
    }
    report.autorotation = rows;
  }, 120000);
});
