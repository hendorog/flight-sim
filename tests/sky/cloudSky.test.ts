// Cloud cover must change the sky's light: no direct sun and a grey ~5-20 klux sky under 8/8 overcast, a
// near-neutral (not sky-blue) ambient under broken cumulus, and nothing at all under a clear sky.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CpuSky, createSkyBands } from '../../src/render/sky/cpuSky';
import { CloudSky, apparentCover } from '../../src/render/sky/cloudSky';
import { atmosphereParams, fitHaze, SUN_ILLUMINANCE_TOA, SCENE_UNITS_PER_LUX } from '../../src/render/sky/params';
import { transmittanceToSpace } from '../../src/render/sky/transmittance';

const p = atmosphereParams(60_000);
const cpu = new CpuSky();
cpu.setParams(p);
const haze = fitHaze(p, new THREE.Vector2());
const lum = (c: { r: number; g: number; b: number }) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

function light(elevationDeg: number, cover: number, altitudeM = 125) {
  const mu = Math.sin((elevationDeg * Math.PI) / 180);
  const bands = createSkyBands();
  cpu.addSummary(altitudeM / 1000, mu, [SUN_ILLUMINANCE_TOA, SUN_ILLUMINANCE_TOA, SUN_ILLUMINANCE_TOA], bands);
  const sunLayer = transmittanceToSpace(p, 2.05, mu, new THREE.Color()).multiplyScalar(SUN_ILLUMINANCE_TOA);
  const sunGround = transmittanceToSpace(p, 0.125, mu, new THREE.Color()).multiplyScalar(SUN_ILLUMINANCE_TOA);
  const c = new CloudSky();
  c.update(
    { cover, baseM: 1500, topM: 2600, cameraAltitudeM: altitudeM, lightMu: mu, lightX: Math.cos(mu), lightZ: 0, lightE: [sunLayer.r, sunLayer.g, sunLayer.b], hazeExtinction: haze.x, hazeScaleHeight: haze.y },
    bands,
  );
  const sky = new THREE.Color();
  const horizon = new THREE.Color();
  c.summarize(bands, sky, horizon);
  const direct = sunGround.clone().multiplyScalar(mu * c.directGround);
  const global = direct.clone().add(sky.clone().multiplyScalar(Math.PI));
  return { c, sky, horizon, global, bands };
}

describe('CloudSky', () => {
  it('leaves a clear sky untouched', () => {
    const { c, sky, bands } = light(40, 0);
    expect(c.directGround).toBe(1);
    expect(c.deckDirect).toBe(1);
    expect(c.airScale).toBe(1);
    let clear = 0;
    for (let i = 0; i < bands.weight.length; i++) clear += bands.weight[i] * bands.band[3 * i + 1];
    expect(sky.g).toBeCloseTo(clear, 9);
  });

  it('removes the direct sun and gives a grey 5-25 klux sky under overcast', () => {
    for (const el of [25, 40, 60]) {
      const { c, sky, global } = light(el, 1);
      expect(c.deckDirect).toBeLessThan(1e-6);
      expect(c.directGround).toBeLessThan(1e-6);
      const lux = lum(global) / SCENE_UNITS_PER_LUX;
      expect(lux).toBeGreaterThan(5_000);
      expect(lux).toBeLessThan(25_000);
      // Near neutral: channels within 15 % of each other.
      expect(Math.max(sky.r, sky.g, sky.b) / Math.min(sky.r, sky.g, sky.b)).toBeLessThan(1.15);
    }
  });

  it('keeps the direct sun for broken cloud (the local shadow map handles it) and neutralises the ambient', () => {
    const clear = light(40, 0).sky;
    const { c, sky } = light(40, 0.5);
    expect(c.deckDirect).toBe(1);
    expect(c.directGround).toBeGreaterThan(0.2);
    expect(c.directGround).toBeLessThan(0.8);
    // Blue/red of the ambient under scattered cumulus is much closer to 1 than the clear sky's (~2).
    expect(clear.b / clear.r).toBeGreaterThan(1.8);
    expect(sky.b / sky.r).toBeLessThan(1.3);
  });

  it('lights the camera above the deck with the clear sky and the sun', () => {
    const { c, sky } = light(40, 1, 3500);
    expect(c.directCamera).toBeCloseTo(1, 9);
    expect(c.airScale).toBeCloseTo(1, 9);
    expect(sky.b).toBeGreaterThan(sky.r);
  });

  it('has an apparent cover that grows toward the horizon', () => {
    expect(apparentCover(0.3, 1)).toBeCloseTo(0.3, 9);
    expect(apparentCover(0.3, 0.2)).toBeGreaterThan(0.6);
    expect(apparentCover(1, 0.5)).toBe(1);
    expect(apparentCover(0, 0.5)).toBe(0);
  });
});
