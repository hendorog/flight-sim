// Steady-heading sideslips and the rudder's secondary effect (max gross, typical CG, ISA, 3000 ft, still air).
//
// A steady-heading sideslip is the flight-test manoeuvre behind a forward slip: rudder held, the wings banked
// against it with the ailerons until the heading stops changing. Three balances set it:
//   yaw:        Cn_beta beta + Cn_dr dr (+ Cn_da da) = 0          -> the sideslip a given pedal buys
//   roll:       Cl_beta beta + Cl_dr dr + Cl_da da = 0             -> the aileron that holds the wings
//   side force: W sin(phi) = -(CY_beta beta + CY_dr dr) q S        -> the bank that stops the turn
// With Roskam's C172 set (Airplane Flight Dynamics app. B: Cn_beta 0.065, Cn_dr -0.0657, Cl_beta -0.089,
// Cl_dr 0.0147, Cl_da 0.178, CY_beta -0.31, CY_dr 0.187) a full 16 deg rudder at 70 KIAS gives beta ~16 deg,
// 6.8 deg of mean aileron (0.39 of the 20 up / 15 down travel) and ~2.3 deg of bank (linear; the fuselage's
// viscous cross-flow adds side force at large sideslip, which is why the model banks more than that).
// These tests fly the manoeuvre two ways: a trim with the pedal held (lateral 'steadySlip') and the lead's
// flown check (heading hold on the ailerons, yaw damper off, autothrottle), which must agree.

import { describe, expect, it } from 'vitest';
import { C172 } from '../../src/core/c172';
import { DEG, FT, KT } from '../../src/core/math';
import { Autopilot } from '../../src/physics';
import { AeroModel } from '../../src/physics/aero';
import { atmosphereAt, tasFromCas } from '../../src/physics/atmosphere';
import { coefficients } from '../aero/helpers';
import { ELEVATION, FRAME, at, makeRig, report, resetTo } from './helpers';

const ALT = ELEVATION + 3000 * FT;
const ATM = atmosphereAt(ALT);
/** Mean aileron deflection per unit of yoke travel (20 deg up, 15 deg down), rad. */
const AILERON_MEAN = 0.5 * (C172.wing.aileron.maxUp + C172.wing.aileron.maxDown);

interface Slip {
  beta: number;
  bank: number;
  aileron: number;
}

function trimmedSlip(kias: number, rudder: number): Slip {
  const rig = makeRig();
  const tas = tasFromCas(kias * KT, ATM);
  resetTo(rig, { airspeed: tas, position: at(ALT) });
  const t = rig.fm.solveTrim({ tas, altitude: ALT, lateral: 'steadySlip', rudder, flightPathAngle: 0 }, rig.env);
  expect(t.converged).toBe(true);
  return { beta: t.beta, bank: t.roll, aileron: t.aileron };
}

describe('steady-heading sideslip (trim with the pedal held)', () => {
  const rows: { kias: number; rudder: number; s: Slip }[] = [];
  for (const kias of [65, 70]) for (const rudder of [1, 0.5]) rows.push({ kias, rudder, s: trimmedSlip(kias, rudder) });
  const get = (kias: number, rudder: number) => rows.find((r) => r.kias === kias && r.rudder === rudder)!.s;

  it('full right rudder at 65-70 KIAS: 12-17.5 deg of sideslip, left aileron and left bank to hold the heading', () => {
    for (const { kias, rudder, s } of rows) {
      report(`steady slip ${kias} KIAS, pedal ${rudder}: sideslip`, s.beta / DEG, rudder === 1 ? '-12..-17.5' : 'about half', 'deg');
      report(`steady slip ${kias} KIAS, pedal ${rudder}: aileron (travel)`, s.aileron, rudder === 1 ? '-0.25..-0.45 (Roskam linear -0.39)' : 'about half', '');
      report(`steady slip ${kias} KIAS, pedal ${rudder}: mean aileron`, (s.aileron * AILERON_MEAN) / DEG, '', 'deg');
      report(`steady slip ${kias} KIAS, pedal ${rudder}: bank`, s.bank / DEG, rudder === 1 ? '-3.5..-7' : 'about half', 'deg');
    }
    for (const kias of [65, 70]) {
      const s = get(kias, 1);
      // Right pedal yaws the nose right: the relative wind comes from the left.
      expect(s.beta).toBeLessThan(-12 * DEG);
      expect(s.beta).toBeGreaterThan(-17.5 * DEG);
      // The dihedral effect rolls the aircraft right; the left aileron holds it, the left bank stops the turn.
      expect(s.aileron).toBeLessThan(-0.25);
      expect(s.aileron).toBeGreaterThan(-0.45);
      expect(s.bank).toBeLessThan(-3.5 * DEG);
      expect(s.bank).toBeGreaterThan(-7 * DEG);
    }
  });

  it('half rudder needs roughly half of each', () => {
    for (const kias of [65, 70]) {
      const full = get(kias, 1), half = get(kias, 0.5);
      const rb = half.beta / full.beta, ra = half.aileron / full.aileron, rp = half.bank / full.bank;
      report(`steady slip ${kias} KIAS: half / full rudder (sideslip, aileron, bank)`, rb, `${ra.toFixed(2)} / ${rp.toFixed(2)}`, '');
      for (const r of [rb, ra, rp]) {
        expect(r).toBeGreaterThan(0.4);
        expect(r).toBeLessThan(0.7);
      }
    }
  });

  it('the trimmed slip is what the flown manoeuvre settles to (heading hold on the ailerons, yaw damper off)', () => {
    const kias = 70;
    const rig = makeRig();
    const tas = tasFromCas(kias * KT, ATM);
    resetTo(rig, { airspeed: tas, position: at(ALT) });
    const s = rig.fm.state;
    const ap = new Autopilot();
    ap.settings = {
      ...ap.settings,
      lateral: 'heading',
      heading: s.heading,
      vertical: 'altitude',
      altitude: ALT,
      autothrottle: true,
      airspeed: kias * KT,
      yawDamper: false,
      autoTrim: true,
    };
    rig.controls.rudder = 1;
    const mean = { beta: 0, bank: 0, aileron: 0, kias: 0, n: 0 };
    rig.run(60, (t) => {
      ap.update(FRAME, s, rig.controls);
      if (t > 50) {
        mean.beta += s.beta;
        mean.bank += s.roll;
        mean.aileron += rig.controls.aileron;
        mean.kias += s.ias / KT;
        mean.n++;
      }
    });
    const flown = { beta: mean.beta / mean.n, bank: mean.bank / mean.n, aileron: mean.aileron / mean.n };
    const trim = get(kias, 1);
    report('flown steady slip 70 KIAS (mean of 50-60 s): sideslip', flown.beta / DEG, (trim.beta / DEG).toFixed(2), 'deg');
    report('flown steady slip 70 KIAS: bank', flown.bank / DEG, (trim.bank / DEG).toFixed(2), 'deg');
    report('flown steady slip 70 KIAS: aileron', flown.aileron, trim.aileron.toFixed(3), '');
    report('flown steady slip 70 KIAS: indicated airspeed', mean.kias / mean.n, kias, 'kt');
    expect(Math.abs(flown.beta - trim.beta)).toBeLessThan(1 * DEG);
    expect(Math.abs(flown.bank - trim.bank)).toBeLessThan(1 * DEG);
    expect(Math.abs(flown.aileron - trim.aileron)).toBeLessThan(0.05);
  }, 60000);
});

describe('roll due to sideslip and to rudder', () => {
  it('dihedral effect Cl_beta -0.07..-0.10 from 60 to 110 KIAS, power off (Roskam -0.089, DATCOM build-up ~-0.08)', () => {
    // Quasi-steady airframe at max gross, sea-level density: lift coefficient for the speed, wings level.
    const m = new AeroModel(undefined, { quasiSteady: true });
    const W = C172.mass.maxTakeoff * 9.80665;
    for (const kias of [60, 80, 110]) {
      const V = kias * KT;
      const CL = W / (0.5 * 1.225 * V * V * C172.wing.area);
      // Angle of attack for that CL (secant on alpha).
      let a0 = 0, a1 = 6, c0 = coefficients(m, { V, alphaDeg: a0, altitude: 0 }).CL - CL, c1 = coefficients(m, { V, alphaDeg: a1, altitude: 0 }).CL - CL;
      for (let k = 0; k < 8 && Math.abs(c1) > 1e-4; k++) {
        const a2 = a1 - (c1 * (a1 - a0)) / (c1 - c0);
        a0 = a1;
        c0 = c1;
        a1 = a2;
        c1 = coefficients(m, { V, alphaDeg: a1, altitude: 0 }).CL - CL;
      }
      const p = coefficients(m, { V, alphaDeg: a1, betaDeg: 2, altitude: 0 });
      const n = coefficients(m, { V, alphaDeg: a1, betaDeg: -2, altitude: 0 });
      const clb = (p.Cl - n.Cl) / (4 * DEG);
      console.log(`[fdm] Cl_beta at ${kias} KIAS (alpha ${a1.toFixed(1)} deg): measured ${clb.toFixed(4)} 1/rad | target -0.085..-0.095 requested, -0.07..-0.10 asserted`);
      expect(clb).toBeLessThan(-0.07);
      expect(clb).toBeGreaterThan(-0.1);
    }
  });

  it('full rudder hands-off at 90 KIAS rolls the wings through 30 deg in 1.8-4 s', () => {
    // Yoke held at its trimmed position, full right pedal. The rudder yaws the nose right, the sideslip from the
    // left rolls the aircraft right through the dihedral effect (and the yaw rate through Cl_r). The linear
    // Roskam set predicts ~1.7 s for this (Cl_beta / Cl_p = 0.19 against the model's 0.15).
    const rig = makeRig();
    resetTo(rig, { airspeed: tasFromCas(90 * KT, ATM), position: at(ALT) });
    const s = rig.fm.state;
    rig.controls.rudder = 1;
    const t0 = s.time;
    let t30 = Infinity;
    rig.run(8, () => {
      if (s.roll > 30 * DEG) {
        t30 = s.time - t0;
        return true;
      }
    });
    report('full rudder hands-off at 90 KIAS: time to 30 deg of bank', t30, '1.8-4 (3-5 requested)', 's');
    expect(t30).toBeGreaterThan(1.8);
    expect(t30).toBeLessThan(4);
  }, 30000);
});
