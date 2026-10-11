import { describe, expect, it } from 'vitest';
import { BLADE_BLUR, bladeBlur } from '../../src/render/aircraft/bladeBlur';

describe('perceived blade blur', () => {
  it('keeps a stopped or followable blade opaque, with no trail or disc', () => {
    for (const blades of [2, 3, 4]) for (const rpm of [0, 0.1, 1, 30, 60, 100]) {
      expect(bladeBlur(rpm, blades)).toEqual({ solid: 1, trail: 0, disc: 0, sweep: 0 });
    }
  });

  it('loses solid coverage monotonically, grows the sweep and disc, and keeps weights bounded', () => {
    for (const blades of [2, 3, 4]) {
      let previous = bladeBlur(0, blades);
      for (let rpm = 0.5; rpm <= 4000; rpm += 0.5) {
        const b = bladeBlur(rpm, blades);
        expect(b.solid).toBeLessThanOrEqual(previous.solid);
        expect(b.disc).toBeGreaterThanOrEqual(previous.disc);
        expect(b.sweep).toBeGreaterThanOrEqual(previous.sweep);
        for (const weight of [b.solid, b.trail, b.disc]) {
          expect(weight).toBeGreaterThanOrEqual(0);
          expect(weight).toBeLessThanOrEqual(1);
        }
        expect(b.solid + b.trail + b.disc).toBeCloseTo(1, 14);
        expect(b.sweep).toBeLessThanOrEqual(2 * Math.PI / blades * 0.8);
        previous = b;
      }
    }
  });

  it('has no jumps across pursuit, passage, or sweep-cap boundaries', () => {
    for (const blades of [2, 3, 4]) {
      const boundaries = [0,
        BLADE_BLUR.pursuitStartDegPerSec / BLADE_BLUR.apparentRadiusDeg * 30 / Math.PI,
        BLADE_BLUR.pursuitEndDegPerSec / BLADE_BLUR.apparentRadiusDeg * 30 / Math.PI,
        BLADE_BLUR.discStartPassagesPerSec * 60 / blades,
        BLADE_BLUR.discEndPassagesPerSec * 60 / blades,
        0.8 * 60 / blades / BLADE_BLUR.persistenceSeconds];
      for (const rpm of boundaries) {
        const lo = bladeBlur(rpm - 1e-5, blades), hi = bladeBlur(rpm + 1e-5, blades);
        for (const key of ['solid', 'trail', 'disc', 'sweep'] as const) {
          expect(Math.abs(hi[key] - lo[key])).toBeLessThan(1e-6);
        }
      }
      // Also bound the complete acceleration curve; catch any internal discontinuity.
      for (let rpm = 0; rpm < 700; rpm += 0.1) {
        const a = bladeBlur(rpm, blades), b = bladeBlur(rpm + 0.1, blades);
        for (const key of ['solid', 'trail', 'disc', 'sweep'] as const)
          expect(Math.abs(b[key] - a[key])).toBeLessThan(0.004);
      }
    }
  });

  it('gives identical states on shutdown, startup and either rotation direction', () => {
    const rpms = [0, 30, 60, 100, 120, 180, 215, 250, 300, 406, 530, 650, 2400];
    const startup = rpms.map(rpm => bladeBlur(rpm, 2));
    expect([...rpms].reverse().map(rpm => bladeBlur(rpm, 2)).reverse()).toEqual(startup);
    expect(rpms.map(rpm => bladeBlur(-rpm, 2))).toEqual(startup);
  });

  it('preserves the full-speed disc for both helicopters, tail rotors, and two/three-blade props', () => {
    for (const [rpm, blades] of [[406, 2], [530, 2], [2400, 2], [2400, 3], [3400, 2]]) {
      expect(bladeBlur(rpm, blades)).toMatchObject({ solid: 0, trail: 0, disc: 1 });
    }
    expect(bladeBlur(200, 3).disc).toBeGreaterThan(bladeBlur(200, 2).disc);
    expect(bladeBlur(60 * 6.4, 2).disc).toBe(1); // Tail shaft RPM, not main-rotor RPM.
  });

});
