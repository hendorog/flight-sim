// MD 500E: extra mock readings for the dev instruments page (src/dev/instruments.ts). Scripts one start and flight so
// every gauge, lamp and the needle split can be inspected without the physics (which T2 owns):
//   t <  6 s   battery off: dead panel
//   6 - 26 s   START held: N1 0 -> 64 %, TOT light-off peak, ENGINE OUT and XMSN OIL PRESS lit, GEN OUT lit
//  26 - 40 s   ground idle 64.5 % N1: lights out (RE-IGN latched until pressed), needles superimposed at idle
//  40 - 200 s  flight, grip full open: N2 = Nr = 103 %, torque 55 -> 80 psi, TOT 620 -> 730, N1 ~ 93 %
//  > 200 s     autorotation, grip full open (governor holds the beep set point): Nr 104.5 %, N2 101.5 %: needles split by the overrunning rotor
//  with `?split=1` the grip is rolled to IDLE: N2 follows N1 down, Nr stays high (RFM 4-26 freewheel check)
import type { DevMock } from '../../dev/devMock';
import { MD500_N2_100_RPM, MD500_NR_100, MD500_PSI_PER_NM } from './facts';

const mix = (a: number, b: number, f: number): number => a + (b - a) * Math.min(1, Math.max(0, f));

export const devMock: DevMock = (s, c, t) => {
  const e = s.engines[0];
  const split = typeof location !== 'undefined' && new URLSearchParams(location.search).get('split') === '1';
  let n1 = 0, n2 = 0, nr = 0, tot = 20, psi = 0;
  if (t >= 26 && t < 40) { n1 = 64.5; n2 = 64; nr = 64; tot = mix(560, 480, (t - 26) / 8); }
  else if (t >= 6 && t < 26) {
    const f = (t - 6) / 20;
    n1 = 64.5 * f; n2 = 64 * f * f; nr = n2; tot = 20 + 640 * Math.sin(Math.min(1, f * 1.6) * Math.PI / 2) * (1 - 0.25 * f);
  } else if (t >= 40 && t <= 200) {
    const f = Math.min(1, (t - 40) / 30), wave = 0.5 - 0.5 * Math.cos(t / 14);
    n1 = mix(64.5, 90 + 5 * wave, f); n2 = mix(64, 103, f); nr = n2; psi = mix(8, 55 + 25 * wave, f); tot = mix(480, 620 + 110 * wave, f);
  } else if (t > 200) {
    n1 = split ? 64.5 : 66; n2 = split ? mix(103, 66, (t - 200) / 6) : 101.5; nr = split ? mix(103, 100, (t - 200) / 6) : 104.5; psi = 2; tot = 400;
  }
  const on = t >= 6;
  e.running = n1 > 40;
  e.lit = n1 > 12;
  e.rpm = n2 / 100 * MD500_N2_100_RPM;
  e.propRpm = e.rpm;
  e.ng = n1;
  e.itt = tot; e.egt = tot;
  e.torque = psi / MD500_PSI_PER_NM;
  e.oilPressure = n1 < 10 ? 0 : n1 < 55 ? 60 : 105;
  e.oilTemp = mix(20, 82, (t - 6) / 120);
  const bus = on ? 28 : 0;
  s.electrical.busVoltage = bus;
  const gen = e.running && t >= 30;
  c.alternator = t >= 30; c.masterBattery = on; c.fuelSelector = 'both';
  c.lights.panel = 1;
  s.fuel.left = 95; s.fuel.right = 92;
  const r = s.rotorcraft;
  if (!r) return;
  r.rotorRpm = nr / 100 * MD500_NR_100;
  r.omega = r.rotorRpm * Math.PI / 30;
  r.transmission = { ...(r.transmission ?? { oilTemperatureC: 0, tailChips: false }), oilPressurePsi: n1 < 40 ? 0 : t < 40 ? 22 : 38,
    oilTemperatureC: mix(25, 78, (t - 6) / 120) } as NonNullable<typeof r.transmission>;
  // The Nr < 468 rpm half of the warning cannot apply at ground idle (Nr about 65 %, lights out per RFM 4-16): armed in flight only.
  const engineOut = on && (n1 < 55 || (n1 > 80 && r.rotorRpm < 468));
  r.turboshaft = {
    n2SetPct: 103, ptgIntegral: 0, grip: n1 < 12 ? 'cutoff' : t < 40 ? 'groundIdle' : split && t > 200 ? 'groundIdle' : 'fullOpen',
    governorMode: split && t > 200 ? 'manual' : 'governed', n2Pct: n2, nrPct: nr, torquePsi: psi,
    needlesSplit: nr - n2 > 1, engineOutLight: engineOut, engineOutHorn: engineOut && c.alternator,
    reignitionLight: t >= 20 && t < 32 && n1 > 30, overTorque: false, overTemp: false, avoidRange: n2 > 75 && n2 < 88,
  };
  s.electrical.alternatorAmps = gen ? 28 + psi * 0.1 : 0;
  s.electrical.alternators[0] = s.electrical.alternatorAmps;
};
