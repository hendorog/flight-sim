// The CPU sky summary (ctx.sky.skyColor / hazeColor) replaces a GPU read-back that stalled the main thread;
// it must match the GPU sky it summarises, and the staged refresh must converge to the direct result.
import { describe, expect, it } from 'vitest';
import { CpuSky, SUMMARY_BANDS, createSkyBands, type SkyBands } from '../../src/render/sky/cpuSky';
import { SkySummary } from '../../src/render/sky/SkySummary';
import { atmosphereParams, SUN_ILLUMINANCE_TOA, SCENE_UNITS_PER_LUX } from '../../src/render/sky/params';

const E = [SUN_ILLUMINANCE_TOA, SUN_ILLUMINANCE_TOA, SUN_ILLUMINANCE_TOA];
const p = atmosphereParams(60_000);
const sky = new CpuSky();
sky.setParams(p);

function hemisphere(b: SkyBands): number[] {
  const out = [0, 0, 0];
  for (let i = 0; i < SUMMARY_BANDS; i++) for (let k = 0; k < 3; k++) out[k] += b.weight[i] * b.band[3 * i + k];
  return out;
}

describe('CpuSky', () => {
  // GPU reference: SKY_SUMMARY_FRAG evaluated on the live LUTs in the real app (src/dev/skyProbe.ts; runway,
  // 60 km visibility, camera ~120 m MSL), after the LUT integrations moved to quadratic segments.
  const gpu: [number, number[], number[]][] = [
    [0.92009, [311.23, 450.17, 715.09], [482.23, 613.16, 693.82]],
    [0.73512, [293.05, 415.42, 652.31], [513.41, 616.88, 680.5]],
    [0.15724, [155.39, 182.71, 253.88], [1112.1, 688.4, 353.1]],
    [0.12509, [140.33, 156.25, 210.12], [1098.36, 601.86, 261.96]],
  ];
  for (const [mu, skyRef, hazeRef] of gpu) {
    it(`matches the GPU sky summary at sun sine ${mu}`, () => {
      const b = createSkyBands();
      sky.addSummary(0.12, mu, E, b);
      const s = hemisphere(b);
      for (let k = 0; k < 3; k++) {
        expect(Math.abs(s[k] / skyRef[k] - 1)).toBeLessThan(0.06);
        expect(Math.abs(b.horizon[k] / hazeRef[k] - 1)).toBeLessThan(0.06);
      }
    });
  }

  it('gives a blue clear-sky irradiance of 10-25 klux at 60 deg sun', () => {
    const b = createSkyBands();
    sky.addSummary(0.12, Math.sin(Math.PI / 3), E, b);
    const s = hemisphere(b);
    const lux = (Math.PI * (0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2])) / SCENE_UNITS_PER_LUX;
    expect(lux).toBeGreaterThan(10_000);
    expect(lux).toBeLessThan(25_000);
    expect(s[2]).toBeGreaterThan(1.5 * s[0]);
  });
});

describe('SkySummary', () => {
  it('computes the first summary at once and converges to the direct result when staged', () => {
    const s = new SkySummary();
    expect(s.update(p, 0.12, 0.6, -0.5)).toBe(true);
    expect(s.version).toBe(1);
    // A small move is spread over frames.
    let frames = 0;
    while (!s.update(p, 0.13, 0.61, -0.5)) frames++;
    expect(frames).toBeGreaterThan(0);
    const staged = s.combine(E, [0, 0, 0], createSkyBands());
    const direct = createSkyBands();
    sky.addSummary(0.13, 0.61, E, direct);
    for (let i = 0; i < 3 * SUMMARY_BANDS; i++) expect(staged.band[i]).toBeCloseTo(direct.band[i], 6);
    // Nothing to do while nothing changes.
    expect(s.update(p, 0.13, 0.61, -0.5)).toBe(false);
  });
});
