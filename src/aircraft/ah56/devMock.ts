// Lockheed AH-56A Cheyenne: extra mock readings for the dev instruments page (src/dev/instruments.ts). Scripts one start and a
// compound flight so the tapes, indicators, lamps, gyro placard, gear and the propeller angle can be inspected without the physics
// (AG, AC own those). `?config=ics` shows the 1972 ICS aircraft (placard, ICS buttons, collective indication 7 deg lower, Nr 100 %).
//   t <  6 s    battery off: dead panel
//   6 - 26 s    start: Ng 0 -> 64 %, TIT light-off peak
//  26 - 40 s    ground idle: Ng 64 %, Nf 60 %, torque 6 %
//  40 - 60 s    hover: collective 11 deg indicated (AMCS), prop beta at the -2.2 deg detent
//  60 - 200 s   acceleration: beta 8 -> 22 deg, collective 13 deg (AMCS), torque 70 -> 98 %, TIT 640 -> 710, Nr 97.5 % (ICS 100 %), g 1.0 - 1.3
//               gear: lever UP at 70 s, in transit 70 - 78 s (GEAR UNSAFE lit), up and locked 78 - 185 s; lever DOWN at 185 s, in transit
//               185 - 193 s, down and locked from 193 s (ahead of the 130 KCAS gear limit in the real procedure; the mock has no airspeed)
//  > 200 s      engine failure: torque to 0, the delta-beta cut to +18 deg, Nr to 90 %, then autorotation at beta +8
import type { DevMock } from '../../dev/devMock';
import { DEG } from '../../core/math';
import { AH56_AMCS_NR_FRACTION, AH56_NF_100_RPM, AH56_NR_100 } from './facts';
import { AH56_TORQUE_100_NM } from './panelMarkings';
import { AH56_ROTORCRAFT } from './rotorcraft';

/** The collective lever for an AMCS-indicated angle on the definition's physical range (the panel reads physical + 7 deg, AMCS). */
const leverFor = (amcsIndicatedDeg: number): number => {
  const m = AH56_ROTORCRAFT.main;
  return ((amcsIndicatedDeg - 7) * DEG - m.minPitch) / (m.maxPitch - m.minPitch);
};
const mix = (a: number, b: number, f: number): number => a + (b - a) * Math.min(1, Math.max(0, f));
/** Gear script, s: retraction and extension each take TRANSIT seconds (ESTIMATE). */
const GEAR = { up: 70, down: 185, transit: 8 } as const;

export const devMock: DevMock = (s, c, t) => {
  const ics = typeof location !== 'undefined' && new URLSearchParams(location.search).get('config') === 'ics';
  const nrFlight = (ics ? 1 : AH56_AMCS_NR_FRACTION) * 100;
  const failed = t > 200;
  let ng = 0, nf = 0, nr = 0, tit = 20, tq = 0;
  if (t >= 26 && t < 40) { ng = 64; nf = 60; nr = 60; tit = mix(520, 440, (t - 26) / 8); tq = 6; }
  else if (t >= 6 && t < 26) {
    const f = (t - 6) / 20;
    ng = 64 * f; nf = 60 * f * f; nr = nf; tit = 20 + 560 * Math.sin(Math.min(1, f * 1.5) * Math.PI / 2) * (1 - 0.25 * f);
  } else if (t >= 40 && !failed) {
    const f = Math.min(1, (t - 40) / 15), g = Math.min(1, Math.max(0, (t - 60) / 90));
    ng = mix(64, 88 + 6 * g, f); nf = mix(60, nrFlight, f); nr = nf; tit = mix(440, 560 + 150 * g, f); tq = mix(6, 62 + 36 * g, f);
  } else if (failed) {
    const f = Math.min(1, (t - 200) / 6);
    ng = mix(94, 60, f); nf = mix(nrFlight, 90, Math.min(1, (t - 200) / 3)); nr = mix(nrFlight, 90, Math.min(1, (t - 200) / 3)); tit = mix(710, 320, f); tq = mix(98, 0, Math.min(1, (t - 200) / 1.5));
  }
  const on = t >= 6;
  const e = s.engine;
  e.running = ng > 40; e.lit = ng > 12;
  e.rpm = nf / 100 * AH56_NF_100_RPM; e.propRpm = e.rpm;
  e.ng = ng; e.itt = tit; e.egt = tit;
  e.torque = tq / 100 * AH56_TORQUE_100_NM;
  e.oilPressure = ng < 10 ? 0 : ng < 55 ? 25 : 62;
  e.oilTemp = mix(20, 82, (t - 6) / 120);
  s.electrical.busVoltage = on ? 28.2 : 0;
  s.electrical.alternatorAmps = on && ng > 55 ? 40 : 0;
  s.electrical.alternators[0] = s.electrical.alternatorAmps;
  c.masterBattery = on; c.alternator = t >= 30; c.fuelPump = t >= 3; c.fuelSelector = 'both';
  c.lights.panel = 1;
  // Collective: hover 11 deg indicated on the AMCS scale, cruise 13 deg; the panel maps the lever on the definition's range
  // (integrator, at the AG merge: the fixed levers 0.38 / 0.5 assumed the stub's 4.5-21.5 deg indicated range).
  c.collective = t < 40 ? 0 : t < 60 ? leverFor(11) : failed ? 0 : leverFor(13);
  s.fuel.left = 520; s.fuel.right = 480 - t * 0.05;
  s.gLoad = t < 60 || failed ? 1 : 1 + 0.3 * (0.5 - 0.5 * Math.cos(t / 9));
  // Retractable gear (tail wheel in slot 0): retract after take-off, extend again before the engine-failure phase.
  const lever = t >= GEAR.up && t < GEAR.down ? 'up' : 'down';
  const ext = lever === 'up' ? 1 - Math.min(1, (t - GEAR.up) / GEAR.transit) : t >= GEAR.down ? Math.min(1, (t - GEAR.down) / GEAR.transit) : 1;
  const down = ext >= 1, inTransit = ext > 0 && ext < 1;
  c.gearLever = lever;
  s.gear = { retractable: true, lever, extension: [ext, ext, ext], locked: [down, down, down], inTransit, warning: false };
  const r = s.rotorcraft;
  if (!r) return;
  r.rotorRpm = nr / 100 * AH56_NR_100;
  r.omega = r.rotorRpm * Math.PI / 30;
  r.transmission = { oilPressurePsi: nr < 20 ? 0 : t < 40 ? 55 : 88, oilTemperatureC: mix(25, 78, (t - 6) / 120), tailChips: false };
  r.controlGyro = { mode: ics ? 'ics' : 'amcs', pitch: 0, roll: 0, pitchRate: 0, rollRate: 0 };
  const beta = failed ? (t < 203 ? mix(22, 18, (t - 200) / 3) : 8) : t < 60 ? -2.2 : mix(8, 22, (t - 60) / 90);
  r.pusher = { lever: 0.5, beta: beta * DEG, betaCommand: beta * DEG, deltaBeta: failed && t < 210, rpm: nr / 100 * 1717, thrust: 0, torque: 0 };
  r.turboshaft = { n2SetPct: nrFlight, ptgIntegral: 0, grip: ng < 12 ? 'cutoff' : t < 40 ? 'groundIdle' : 'fullOpen', governorMode: 'governed',
    n2Pct: nf, nrPct: nr, torquePsi: tq, needlesSplit: failed && t > 203, engineOutLight: failed, engineOutHorn: failed, reignitionLight: false,
    overTorque: false, overTemp: false, avoidRange: false };
};
