// Dynamic stability modes from perturbation responses (typical loading, 3000 ft, still air), and roll
// performance.

import { describe, expect, it } from 'vitest';
import { DEG, FT, KT } from '../../src/core/math';
import { Autopilot } from '../../src/physics';
import { ELEVATION, FRAME, at, makeRig, oscillation, report, resetTo, secondOrderFit, type Rig } from './helpers';

const ALT = ELEVATION + 3000 * FT;

function trimmedRig(ktas: number): Rig {
  const rig = makeRig();
  resetTo(rig, { airspeed: ktas * KT, position: at(ALT) });
  return rig;
}

describe('longitudinal modes', () => {
  it('phugoid: period 25-35 s, lightly damped (105 KTAS)', () => {
    const rig = trimmedRig(105);
    const s = rig.fm.state;
    // Hold the wings level with the ailerons only; the longitudinal controls stay fixed.
    const ap = new Autopilot();
    ap.settings = { ...ap.settings, lateral: 'wingLeveler', vertical: 'off', yawDamper: false, autoTrim: false };
    const e0 = rig.controls.elevator;
    rig.controls.elevator = e0 + 0.1;
    rig.run(1, () => ap.update(FRAME, s, rig.controls));
    rig.controls.elevator = e0;
    const tas: number[] = [];
    rig.run(150, () => {
      ap.update(FRAME, s, rig.controls);
      tas.push(s.tas);
    });
    const m = oscillation(tas, FRAME);
    report('phugoid period', m.period, '25-35', 's');
    report('phugoid damping ratio', m.zeta, '0.02-0.2', '');
    expect(m.period).toBeGreaterThan(25);
    expect(m.period).toBeLessThan(35);
    expect(m.zeta).toBeGreaterThan(0);
    expect(m.zeta).toBeLessThan(0.2);
  }, 60000);

  it('short period: well damped (105 KTAS)', () => {
    // Free response of the angle of attack after a short elevator pulse, fitted as a second-order system
    // (the phugoid is far slower and barely moves in 3 s).
    const rig = trimmedRig(105);
    const s = rig.fm.state;
    const e0 = rig.controls.elevator;
    rig.controls.elevator = e0 + 0.2;
    rig.run(0.15);
    rig.controls.elevator = e0;
    const alpha: number[] = [];
    rig.run(3, () => {
      alpha.push(s.alpha);
    });
    const m = secondOrderFit(alpha, FRAME);
    report('short-period natural frequency', m.wn, '3-7', 'rad/s');
    report('short-period undamped period 2 pi / wn', (2 * Math.PI) / m.wn, '1.5-3', 's');
    report('short-period damped period', (2 * Math.PI) / (m.wn * Math.sqrt(1 - Math.min(m.zeta, 0.99) ** 2)), '1.5-3', 's');
    report('short-period damping ratio', m.zeta, '0.4-1', '');
    expect(m.zeta).toBeGreaterThan(0.4);
    expect((2 * Math.PI) / m.wn).toBeGreaterThan(0.8);
    expect((2 * Math.PI) / m.wn).toBeLessThan(3);
  }, 30000);
});

describe('lateral-directional modes', () => {
  for (const ktas of [75, 105]) {
    it(`Dutch roll: stable, period 2-4 s (${ktas} KTAS)`, () => {
      const rig = trimmedRig(ktas);
      const s = rig.fm.state;
      const r0 = rig.controls.rudder;
      rig.controls.rudder = r0 + 0.4;
      rig.run(0.5);
      rig.controls.rudder = r0 - 0.4;
      rig.run(0.5);
      rig.controls.rudder = r0;
      // The free response only: the extremum at the release belongs to the doublet (with the swirl's push on the
      // fin fading as the jet drifts off it, the forced swing is lopsided and was read as a long first half-cycle).
      rig.run(0.3);
      const beta: number[] = [];
      rig.run(10, () => {
        beta.push(s.beta);
      });
      // Period and damping from a second-order fit of the first 6 s of the free response: at low speed the mode is
      // well damped (zeta ~0.4) and counting its two or three visible extrema misread the period by up to 20 %.
      const m = secondOrderFit(beta.slice(0, Math.round(6 / FRAME)), FRAME);
      const peaks = oscillation(beta, FRAME);
      report(`Dutch roll period ${ktas} KTAS`, m.dampedPeriod, `2.5-4 (from the extrema: ${peaks.period.toFixed(2)})`, 's');
      report(`Dutch roll damping ratio ${ktas} KTAS`, m.zeta, '> 0.08', '');
      expect(m.dampedPeriod).toBeGreaterThan(2);
      expect(m.dampedPeriod).toBeLessThan(4);
      expect(m.zeta).toBeGreaterThan(0.08);
    }, 30000);
  }

  it('roll mode: time constant well under 1 s (105 KTAS)', () => {
    const rig = trimmedRig(105);
    const s = rig.fm.state;
    rig.controls.aileron += 0.3;
    const p: number[] = [];
    rig.run(2, () => {
      p.push(s.angularVelocity.x);
    });
    const pMax = Math.max(...p);
    const tau = p.findIndex((v) => v > (1 - Math.exp(-1)) * pMax) * FRAME;
    report('roll mode time constant', tau, '< 1', 's');
    expect(tau).toBeGreaterThan(0.02);
    expect(tau).toBeLessThan(0.5);
  }, 30000);

  it('spiral mode: slow, time to double or halve > 20 s (105 KTAS)', () => {
    const rig = trimmedRig(105);
    const s = rig.fm.state;
    // Roll into a 10 degree bank, then release the controls at their trimmed positions.
    const a0 = rig.controls.aileron;
    rig.controls.aileron = a0 + 0.15;
    rig.run(5, () => s.roll > 10 * DEG);
    rig.controls.aileron = a0;
    rig.run(5); // let the Dutch roll die out
    const phi0 = s.roll;
    rig.run(30);
    const phi1 = s.roll;
    const rate = Math.log(Math.abs(phi1 / phi0)) / 30;
    const t2 = Math.LN2 / Math.abs(rate);
    report(`spiral time to ${rate > 0 ? 'double' : 'halve'}`, t2, '> 20', 's');
    expect(t2).toBeGreaterThan(20);
  }, 30000);

  it('rolls 45 to 45 degrees in under 5 s at approach speed with full aileron', () => {
    const rig = trimmedRig(65);
    const s = rig.fm.state;
    const ap = new Autopilot();
    ap.settings = { ...ap.settings, lateral: 'bank', bank: -45 * DEG, maxBank: 50 * DEG, vertical: 'airspeed', airspeed: 65 * KT, autoTrim: false };
    rig.run(12, () => ap.update(FRAME, s, rig.controls));
    expect(s.roll).toBeLessThan(-43 * DEG);
    // Full right aileron, pedals and yoke held.
    const t0 = s.time;
    rig.controls.aileron = 1;
    rig.run(8, () => s.roll > 45 * DEG);
    const t = s.time - t0;
    report('roll 45 to 45 deg at 65 KTAS, full aileron', t, '<= 5', 's');
    expect(s.roll).toBeGreaterThan(45 * DEG);
    expect(t).toBeLessThan(5);
  }, 30000);

  it('full aileron alone yaws the nose against the roll (adverse yaw)', () => {
    // From wings level at 65 KTAS, full right aileron with the pedals held: the nose first yaws left and
    // the relative wind comes from the right (beta > 0).
    const rig = trimmedRig(65);
    const s = rig.fm.state;
    rig.controls.aileron = 1;
    let minR = 0, maxBeta = 0;
    rig.run(1, () => {
      minR = Math.min(minR, s.angularVelocity.z);
      maxBeta = Math.max(maxBeta, s.beta);
    });
    report('adverse yaw: initial yaw rate, full right aileron', minR / DEG, '< 0', 'deg/s');
    report('adverse yaw: sideslip within 1 s', maxBeta / DEG, '2-12', 'deg');
    expect(minR).toBeLessThan(-0.5 * DEG);
    // Present and noticeable (the ball swings), but not the 13-20 deg of an over-powerful aileron.
    expect(maxBeta).toBeGreaterThan(2 * DEG);
    expect(maxBeta).toBeLessThan(12 * DEG);
  }, 30000);

  it('full aileron rolls at 40-60 deg/s at 100 KTAS (pb/2V ~0.08-0.1), and half aileron keeps the slip moderate', () => {
    const rig = trimmedRig(100);
    const s = rig.fm.state;
    rig.controls.aileron = 1;
    let maxP = 0;
    rig.run(3, () => {
      maxP = Math.max(maxP, s.angularVelocity.x);
      return s.roll > 60 * DEG;
    });
    report('peak roll rate, full aileron at 100 KTAS', maxP / DEG, '40-60 (Cl_da ~0.19 per rad)', 'deg/s');
    expect(maxP).toBeGreaterThan(40 * DEG);
    expect(maxP).toBeLessThan(60 * DEG);
    const slow = trimmedRig(65);
    const t = slow.fm.state;
    slow.controls.aileron = 0.5;
    let maxBeta = 0;
    slow.run(4, () => {
      maxBeta = Math.max(maxBeta, t.beta);
      return t.roll > 60 * DEG;
    });
    report('largest sideslip rolling to 60 deg with half aileron at 65 KTAS, pedals held', maxBeta / DEG, '< 15 (was ~17)', 'deg');
    expect(maxBeta).toBeLessThan(15 * DEG);
  }, 30000);
});
