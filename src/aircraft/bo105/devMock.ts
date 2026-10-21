// MBB Bo 105 CB-4: extra mock readings for the dev instruments page (src/dev/instruments.ts). Scripts two starts and a flight
// so every gauge, lamp and the OEI cues can be inspected without the physics (BO and TW own those):
//   t <  6 s   battery off: dead panel
//   6 - 26 s   engine 1 start: N1 0 -> 64 %, TOT light-off peak, GEN 1 lamp lit
//  20 - 40 s   engine 2 start, same
//  40 - 46 s   both at ground idle (N1 64.5 %), torque 5 %, NR 60 %; levers rolled up to FLIGHT
//  46 - 200 s  flight at 98 - 102 %: torque 55 -> 75 %, a small split between the engines, TOT 620 -> 730, mast moment 30 - 55 % of LIMIT
// 150 - 156 s  a manoeuvre drives the mast moment into LIMIT (lamp on)
//  > 200 s     engine 2 fails: N1 2 decays, torque 1 climbs to 90 %, RPM light flashes (N1 split), GEN 2 lit
//  with `?split=1` the rotor winds down in autorotation (both engines at IDLE, NR above N2: the needles split)
import type { DevMock } from '../../dev/devMock';
import { setEngineControl } from '../../core/types';
import { BO105_N2_100_RPM, BO105_NR_100, BO105_PCT_PER_NM } from './facts';
import { bo105MastMomentLimit } from './panelMarkings';

const mix = (a: number, b: number, f: number): number => a + (b - a) * Math.min(1, Math.max(0, f));

export const devMock: DevMock = (s, c, t) => {
  const split = typeof location !== 'undefined' && new URLSearchParams(location.search).get('split') === '1';
  const wave = 0.5 - 0.5 * Math.cos(t / 14);
  const oei = t > 200 && !split;
  const auto = t > 200 && split;
  // One engine's figures at mock time t (start from t0), returning N1 %, N2 %, TOT C, torque %.
  const figures = (t0: number, failed: boolean, shareBias: number): { n1: number; n2: number; tot: number; tq: number } => {
    const u = t - t0;
    if (u < 0) return { n1: 0, n2: 0, tot: 20, tq: 0 };
    if (u < 20) { const f = u / 20; return { n1: 64.5 * f, n2: 60 * f * f, tot: 20 + 640 * Math.sin(Math.min(1, f * 1.6) * Math.PI / 2) * (1 - 0.25 * f), tq: 0 }; }
    if (t < 46) return { n1: 64.5, n2: 60, tot: mix(560, 480, (t - t0 - 20) / 6), tq: 5 };
    if (auto) return { n1: mix(92, 64.5, (t - 200) / 3), n2: mix(100, 100, 0), tot: mix(680, 420, (t - 200) / 6), tq: mix(70, 2, (t - 200) / 3) };
    if (failed && oei) { const f = (t - 200) / 6; return { n1: mix(92, 30, f), n2: mix(100, 70, f), tot: mix(690, 300, f), tq: mix(70, 0, (t - 200) / 2) }; }
    const f = Math.min(1, (t - 46) / 30);
    const flight = { n1: mix(64.5, 90 + 4 * wave, f), n2: mix(60, 100, Math.min(1, (t - 46) / 10)), tot: mix(480, 620 + 110 * wave, f), tq: mix(5, 55 + 20 * wave + shareBias, f) };
    if (oei) { const h = Math.min(1, (t - 200) / 3); return { ...flight, tq: mix(flight.tq, 90, h), tot: mix(flight.tot, 790, h), n1: mix(flight.n1, 99, h) }; }
    return flight;
  };
  const a = figures(6, false, 2), b = figures(20, true, -2);
  const engines = [a, b];
  const nr = t < 6 ? 0 : t < 46 ? Math.min(60, 60 * Math.min(1, (t - 12) / 28)) : auto ? mix(100, 104, (t - 200) / 6) : oei ? mix(100, 97, (t - 200) / 6) : mix(60, 100, (t - 46) / 10);
  const on = t >= 6;
  for (let i = 0; i < 2; i++) {
    const e = s.engines[i], f = engines[i];
    e.running = f.n1 > 40; e.lit = f.n1 > 12;
    e.rpm = f.n2 / 100 * BO105_N2_100_RPM; e.propRpm = e.rpm;
    e.ng = f.n1; e.itt = f.tot; e.egt = f.tot;
    e.torque = f.tq / BO105_PCT_PER_NM;
    e.oilPressure = (f.n1 < 10 ? 0 : f.n1 < 55 ? 50 : 100) * (i === 1 ? 0.97 : 1);
    e.oilTemp = mix(20, 85, (t - 6) / 120) + i * 2;
    e.fuelPressure = e.running ? 14 + 2 * i : 0;
    setEngineControl(c, i, 'alternator', t >= 30 + 8 * i);
    setEngineControl(c, i, 'fuelPump', t >= 3);
    setEngineControl(c, i, 'throttle', t < 26 + 14 * i ? 0 : t < 40 + 6 * i ? 0.25 : 1);
  }
  c.masterBattery = on; c.fuelSelector = 'both';
  c.lights.panel = 1;
  s.electrical.busVoltage = on ? 28.2 : 0;
  s.electrical.alternatorAmps = 20 + a.tq * 0.2;
  s.electrical.alternators[0] = t >= 30 && a.n1 > 50 ? 22 + a.tq * 0.15 : 0;
  s.electrical.alternators[1] = t >= 38 && b.n1 > 50 ? 22 + b.tq * 0.15 : 0;
  // Supply tank (S) near full at 70 kg, falling slowly; main tank (M) 300 kg.
  s.fuel.left = 70 - t * 0.02; s.fuel.right = 300 - t * 0.04;
  const r = s.rotorcraft;
  if (!r) return;
  r.rotorRpm = nr / 100 * BO105_NR_100;
  r.omega = r.rotorRpm * Math.PI / 30;
  r.transmission = { oilPressurePsi: nr < 20 ? 0 : 1.1 / 0.070307, oilTemperatureC: mix(25, 72, (t - 6) / 120), tailChips: false };
  const n2Pct = (i: number): number => engines[i].n2;
  const block = (i: number) => ({
    n2SetPct: 100, ptgIntegral: 0, grip: engines[i].n1 < 12 ? 'cutoff' as const : t < 46 ? 'groundIdle' as const : 'fullOpen' as const,
    governorMode: 'governed' as const, n2Pct: n2Pct(i), nrPct: nr, torquePsi: 0, needlesSplit: auto && nr - n2Pct(i) > 1,
    engineOutLight: false, engineOutHorn: false, reignitionLight: false, overTorque: false, overTemp: false, avoidRange: false });
  r.turboshaft = block(0);
  const n1Split = Math.abs(a.n1 - b.n1) >= 12;
  r.twinTurboshaft = { second: block(1), splitPct: mix(0, 1.5, wave), n1SplitLight: n1Split, nrLowLight: nr <= 95 && t > 46, nrLowTone: false,
    nrHighLight: nr >= 103, nrHighTone: nr >= 108, oei, oeiSeconds: oei ? t - 200 : 0 };
  // Mast moment as a fraction of the hub's LIMIT (the dev page has no flight model): steady, with one spike into LIMIT.
  const spike = t >= 150 && t < 156 ? 1.08 : 0;
  r.mastMoment = (spike || (0.3 + 0.25 * (0.5 - 0.5 * Math.cos(t / 11)))) * bo105MastMomentLimit().limit;
};
