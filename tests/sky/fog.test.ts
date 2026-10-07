// In low visibility the terrain must fade into the sky with no visible horizon: the sky just above the
// horizon (sky-view integration, what the dome draws) must equal the saturated air light that fully
// fogged-out terrain converges to (the aerial perspective's flat integration), and fog must be a neutral
// grey, not a brown smog.
import { describe, expect, it } from 'vitest';
import { CpuSky } from '../../src/render/sky/cpuSky';
import { atmosphereParams, hazeDryness, SUN_ILLUMINANCE_TOA } from '../../src/render/sky/params';

const RB = 6360;
const E = [SUN_ILLUMINANCE_TOA, SUN_ILLUMINANCE_TOA, SUN_ILLUMINANCE_TOA];

type Tables = { transmittance(r: number, mu: number, out: Float64Array): Float64Array; multiScatter(r: number, mu: number, out: Float64Array): Float64Array };

/** Port of FLAT_SCATTERING_GLSL (post/AerialPerspectiveEffect.ts) with many steps: the terrain's haze. */
function flatAirLight(sky: CpuSky, altKm: number, rd: number[], l: number[], tMax: number): number[] {
  const p = sky.params!;
  const t = sky as unknown as Tables;
  const out = [0, 0, 0];
  const thr = [1, 1, 1];
  const t3 = new Float64Array(3);
  const m3 = new Float64Array(3);
  const c = rd[0] * l[0] + rd[1] * l[1] + rd[2] * l[2];
  const pr = (3 / (16 * Math.PI)) * (1 + c * c);
  const g = p.mieG;
  const pm = (((3 / (8 * Math.PI)) * (1 - g * g)) / (2 + g * g)) * (1 + c * c) / Math.pow(1 + g * g - 2 * g * c, 1.5);
  const steps = 400;
  let tPrev = 0;
  for (let i = 0; i < steps; i++) {
    const u = (i + 1) / steps;
    const tn = tMax * u * u;
    const dt = tn - tPrev;
    const h = Math.max(altKm + (tPrev + 0.5 * dt) * rd[1], 0);
    tPrev = tn;
    t.transmittance(RB + h, l[1], t3);
    t.multiScatter(RB + h, l[1], m3);
    const dR = Math.exp(-h / p.rayleighScaleHeight);
    const dM = Math.exp(-h / p.mieScaleHeight);
    for (let k = 0; k < 3; k++) {
      const sR = p.rayleighScattering[k] * dR;
      const sM = p.mieScattering[k] * dM;
      const ext = sR + p.mieExtinction[k] * dM;
      const s = E[k] * (t3[k] * (sR * pr + sM * pm) + m3[k] * (sR + sM));
      const st = Math.exp(-ext * dt);
      out[k] += (thr[k] * (s - s * st)) / ext;
      thr[k] *= st;
    }
  }
  return out;
}

const lum = (v: ArrayLike<number>): number => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];

describe('fog: sky and fogged-out terrain meet without a horizon', () => {
  for (const vis of [800, 3000]) {
    it(`visibility ${vis} m: sky 0.5 deg above the horizon matches the terrain's saturated air light`, () => {
      const sky = new CpuSky();
      sky.setParams(atmosphereParams(vis));
      const el = (40 * Math.PI) / 180;
      const l = [Math.cos(el), Math.sin(el), 0];
      for (const az of [0, 90, 180]) {
        const a = (az * Math.PI) / 180;
        const terrain = flatAirLight(sky, 0.125, [Math.cos(a), 0, Math.sin(a)], l, 30);
        const e = (0.5 * Math.PI) / 180;
        const dome = sky.radiance(0.125, [Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)], l as [number, number, number], E, new Float64Array(3));
        // Before the sky-view integration used quadratic segments the dome was 1.6-2x brighter at 800 m.
        expect(Math.abs(lum(dome) / lum(terrain) - 1)).toBeLessThan(0.08);
      }
    });
  }

  it('fog is neutral grey and brighter toward the zenith, like an overcast sky', () => {
    const sky = new CpuSky();
    sky.setParams(atmosphereParams(800));
    const el = (40 * Math.PI) / 180;
    const l: [number, number, number] = [Math.cos(el), Math.sin(el), 0];
    const horizon = sky.radiance(0.125, [0, 0.01, 1], l, E, new Float64Array(3));
    const up = sky.radiance(0.125, [0, Math.sin(Math.PI / 4), Math.cos(Math.PI / 4)], l, E, new Float64Array(3));
    for (const v of [horizon, up]) {
      expect(v[2] / v[0]).toBeGreaterThan(0.95);
      expect(v[2] / v[0]).toBeLessThan(1.3);
    }
    // CIE overcast: the horizon is about a third as bright as the zenith; here 45 deg up vs the horizon.
    expect(lum(up) / lum(horizon)).toBeGreaterThan(1.4);
    expect(lum(up) / lum(horizon)).toBeLessThan(3.5);
  });

  it('aerosol optics go from dry haze to fog droplets with visibility', () => {
    expect(hazeDryness(0.5)).toBe(0);
    expect(hazeDryness(60)).toBe(1);
    const haze = atmosphereParams(60_000);
    const fog = atmosphereParams(800);
    // Angstrom ~1: blue extinction 1.35x red for haze; fog droplets are grey.
    expect(haze.mieExtinction[2] / haze.mieExtinction[0]).toBeGreaterThan(1.3);
    expect(fog.mieExtinction[2] / fog.mieExtinction[0]).toBeLessThan(1.05);
    // Single-scattering albedo: 0.9 for haze, ~0.99 for fog.
    expect(haze.mieScattering[1] / haze.mieExtinction[1]).toBeCloseTo(0.9, 3);
    expect(fog.mieScattering[1] / fog.mieExtinction[1]).toBeGreaterThan(0.985);
  });
});
