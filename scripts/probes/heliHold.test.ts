// Fixed gains vs matrix-pencil adaptation on the helicopter hold (research probe, not a regression test).
// env: AC=r22|r44|s269, OUT=file.jsonl, SEEDS=1,2,3, LOADS=typical,maxGross, CASES=hover,seq
import { it, vi } from 'vitest';

vi.mock('../../src/sim/worldEnvironment', async (orig) => {
  const m = await orig<typeof import('../../src/sim/worldEnvironment')>();
  return { ...m, createWorldEnvironment: (w: Parameters<typeof m.createWorldEnvironment>[0], s?: number) =>
    m.createWorldEnvironment(w, (globalThis as { __seed?: number }).__seed ?? s) };
});

import { R22_DEFINITION } from '../../src/aircraft/r22';
import { R44_DEFINITION } from '../../src/aircraft/r44';
import { S269_DEFINITION } from '../../src/aircraft/s269';
import { DEG, KT, wrapPi } from '../../src/core/math';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { hoverScenario } from '../../src/sim/rotorcraft/starts';
import { calmWeather } from '../../tests/fdm/helpers';
import { DT } from '../../tests/rotorcraft/helpers';

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const fs = (await import('node:fs' as string)) as { appendFileSync(p: string, d: string): void };
const DEFS = { r22: R22_DEFINITION, r44: R44_DEFINITION, s269: S269_DEFINITION };
const def = DEFS[(env.AC ?? 'r22') as keyof typeof DEFS];
const SEEDS = (env.SEEDS ?? '1,2,3').split(',').map(Number);
const LOADS = (env.LOADS ?? 'typical,maxGross').split(',') as ('typical' | 'maxGross')[];
const CASES = (env.CASES ?? 'hover,seq').split(',');
const OUT = env.OUT ?? 'work/results.jsonl';

const rms = (xs: number[]) => (xs.length ? Math.sqrt(xs.reduce((a, b) => a + b * b, 0) / xs.length) : NaN);
const maxAbs = (xs: number[]) => (xs.length ? Math.max(...xs.map(Math.abs)) : NaN);

/** Overshoot past the final target (in the command's direction) and settling time into ±band, from t0. */
function stepMetrics(ts: number[], err: number[], t0: number, t1: number, sign: number, band: number) {
  let over = 0, settle = 0;
  for (let i = 0; i < ts.length; i++) {
    if (ts[i] < t0 || ts[i] >= t1) continue;
    over = Math.max(over, -sign * err[i]);
    if (Math.abs(err[i]) > band) settle = ts[i] - t0;
  }
  return { over, settle };
}

type Mode = 'fixed' | 'adaptive' | 'pin0.8' | 'pin1.2';
function fly(caseName: string, load: 'typical' | 'maxGross', windy: boolean, seed: number, mode: Mode) {
  const adaptive = mode === 'adaptive';
  (globalThis as { __seed?: number }).__seed = seed;
  const weather = windy ? calmWeather({ windSpeedKt: 8, windDirectionDeg: 270, gustKt: 3, turbulence: 0.1 }) : calmWeather();
  const sim = new SimPhysics({ aircraft: def, weather });
  sim.autoflightOnReset = true;
  sim.resetTo({ ...hoverScenario(sim.env, def.rotorcraft!), payload: load });
  if (!sim.autoflight.engaged) return { error: 'not engaged' };
  const ap = sim.autoflight.helicopter!;
  ap.adaptive = adaptive;
  if (mode.startsWith('pin')) { const k = Number(mode.slice(3)); for (const m of [ap.rollModel, ap.pitchModel]) Object.defineProperty(m, 'scale', { get: () => k, set: () => {} }); }
  const st = sim.autoflight.autopilot.settings;
  const start = { ...sim.state.position }, alt0 = sim.state.altitudeMSL, hdg0 = sim.controls.headingBugDeg;
  const T = caseName === 'hover' ? 60 : 110;
  const governed = def.rotorcraft!.systems.governorInstalled !== false;
  let oldRpm = sim.state.engine.rpm, rpmTrend = 0;
  const ts: number[] = [], hdgE: number[] = [], altE: number[] = [], posE: number[] = [], spdE: number[] = [];
  const roll: number[] = [], pitch: number[] = [], rates: Record<string, number[]> = { lat: [], lon: [], ped: [], col: [] };
  let sat = 0, steps = 0, rpmMin = Infinity, rpmMax = 0, disconnect = -1;
  const statusCount: Record<string, number> = {};
  let adaptingTime = 0, scaleMin = [1, 1], scaleMax = [1, 1];
  let prev = { a: sim.controls.aileron, e: sim.controls.elevator, r: sim.controls.rudder, c: sim.controls.collective ?? 0 };
  let altTarget = alt0, spdTarget = 0;
  for (let i = 0; i < Math.round(T / DT); i++) {
    const t = i * DT;
    if (caseName === 'seq') {
      if (Math.abs(t - 10) < DT / 2) { st.airspeed = 40 * KT; spdTarget = 40; }
      if (Math.abs(t - 40) < DT / 2) { sim.controls.headingBugDeg = (hdg0 + 45) % 360; sim.autoflight.adjustAltitude(10); altTarget = alt0 + 10; }
      if (Math.abs(t - 70) < DT / 2) { st.airspeed = 0; spdTarget = 0; }
    }
    if (!governed) {
      const rpm = sim.state.engine.rpm;
      rpmTrend += ((rpm - oldRpm) / DT - rpmTrend) * (1 - Math.exp(-DT / 0.3)); oldRpm = rpm;
      sim.controls.throttle = Math.max(0, Math.min(1, sim.controls.throttle + Math.max(-0.1, Math.min(0.1, 0.0003 * (2650 - rpm) - 0.0004 * rpmTrend)) * DT));
    }
    sim.step(DT);
    const s = sim.state, c = sim.controls;
    if (s.crashed || !sim.autoflight.engaged) { disconnect = t; break; }
    steps++;
    const rr = s.rotorcraft!.rotorRpm / def.rotorcraft!.referenceRpm;
    rpmMin = Math.min(rpmMin, rr); rpmMax = Math.max(rpmMax, rr);
    if (Math.abs(c.aileron) > 0.98 || Math.abs(c.elevator) > 0.98 || Math.abs(c.rudder) > 0.98 || (c.collective ?? 0.5) > 0.98 || (c.collective ?? 0.5) < 0.02) sat++;
    rates.lat.push((c.aileron - prev.a) / DT); rates.lon.push((c.elevator - prev.e) / DT);
    rates.ped.push((c.rudder - prev.r) / DT); rates.col.push(((c.collective ?? 0) - prev.c) / DT);
    prev = { a: c.aileron, e: c.elevator, r: c.rudder, c: c.collective ?? 0 };
    if (i % 24 === 0) {
      ts.push(t);
      hdgE.push(wrapPi(st.heading - s.heading) / DEG);
      altE.push(altTarget - s.altitudeMSL);
      posE.push(Math.hypot(s.position.x - start.x, s.position.y - start.y));
      spdE.push(spdTarget - s.groundSpeed / KT);
      roll.push(s.roll / DEG); pitch.push(s.pitch / DEG);
    }
    if (i % 240 === 0) {
      for (const [k, m] of [['roll', ap.rollModel], ['pitch', ap.pitchModel]] as const) statusCount[`${k}:${m.status}`] = (statusCount[`${k}:${m.status}`] ?? 0) + 1;
    }
    const rs = ap.rollModel.scale, ps = ap.pitchModel.scale;
    if (Math.abs(rs - 1) > 0.005 || Math.abs(ps - 1) > 0.005) adaptingTime += DT;
    scaleMin = [Math.min(scaleMin[0], rs), Math.min(scaleMin[1], ps)]; scaleMax = [Math.max(scaleMax[0], rs), Math.max(scaleMax[1], ps)];
  }
  const win = (t0: number, t1: number, xs: number[]) => xs.filter((_, k) => ts[k] >= t0 && ts[k] < t1);
  const r3 = (x: number) => +x.toFixed(3);
  const base = { ac: def.id, case: caseName, load, windy, seed, mode, disconnect: r3(disconnect),
    rpmMin: r3(rpmMin), rpmMax: r3(rpmMax), satPct: r3((100 * sat) / Math.max(1, steps)),
    rateRms: { lat: r3(rms(rates.lat)), lon: r3(rms(rates.lon)), ped: r3(rms(rates.ped)), col: r3(rms(rates.col)) },
    rollRms: r3(rms(roll)), pitchRms: r3(rms(pitch.map((p) => p - pitch.reduce((a, b) => a + b, 0) / pitch.length))),
    adaptingPct: r3((100 * adaptingTime) / T), scaleRange: { roll: scaleMin[0].toFixed(3) + '-' + scaleMax[0].toFixed(3), pitch: scaleMin[1].toFixed(3) + '-' + scaleMax[1].toFixed(3) },
    status: statusCount };
  if (caseName === 'hover') {
    const w = (xs: number[]) => win(5, 60, xs);
    return { ...base, posRms: r3(rms(w(posE))), posMax: r3(maxAbs(w(posE))), altRms: r3(rms(w(altE))), altMax: r3(maxAbs(w(altE))),
      hdgRms: r3(rms(w(hdgE))), hdgMax: r3(maxAbs(w(hdgE))) };
  }
  const spd = stepMetrics(ts, spdE, 10, 40, 1, 2);
  const hdg = stepMetrics(ts, hdgE, 40, 70, 1, 2);
  const altm = stepMetrics(ts, altE, 40, 70, 1, 0.5);
  const back = stepMetrics(ts, spdE, 70, 110, -1, 1);
  return { ...base, cruiseSpdRms: r3(rms(win(28, 40, spdE))), spdOver: r3(spd.over), spdSettle: r3(spd.settle),
    hdgOver: r3(hdg.over), hdgSettle: r3(hdg.settle), altOver: r3(altm.over), altSettle: r3(altm.settle),
    hoverBackSettle: r3(back.settle), altRms: r3(rms(altE)), hdgRmsSteady: r3(rms(win(60, 110, hdgE))),
    finalPos: r3(posE[posE.length - 1] ?? NaN) };
}

it('fixed vs adaptive', () => {
  for (const caseName of CASES) for (const load of LOADS) {
    const conds: [boolean, number][] = [[false, 1], ...SEEDS.map((s) => [true, s] as [boolean, number])];
    for (const [windy, seed] of conds) for (const mode of ((env.MODES ?? 'fixed,adaptive').split(',') as Mode[])) {
      const r = fly(caseName, load, windy, seed, mode);
      fs.appendFileSync(OUT, JSON.stringify(r) + '\n');
    }
  }
}, 7_200_000);
