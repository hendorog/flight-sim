// Cloud cover must change the sky's light: no direct sun and a grey ~5-20 klux sky under 8/8 overcast, a
// near-neutral (not sky-blue) ambient under broken cumulus, and nothing at all under a clear sky.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CpuSky, createSkyBands, SUMMARY_BANDS } from '../../src/render/sky/cpuSky';
import { CloudSky, apparentCover, diffuseTransmission, smoothstep, type CloudSkyInput } from '../../src/render/sky/cloudSky';
import { atmosphereParams, fitHaze, GROUND_ALBEDO, SUN_ILLUMINANCE_TOA, SCENE_UNITS_PER_LUX } from '../../src/render/sky/params';
import { transmittanceToSpace } from '../../src/render/sky/transmittance';

const p = atmosphereParams(60_000);
const cpu = new CpuSky();
cpu.setParams(p);
const haze = fitHaze(p, new THREE.Vector2());
const GROUND_ALBEDO_Y = 0.2126 * GROUND_ALBEDO[0] + 0.7152 * GROUND_ALBEDO[1] + 0.0722 * GROUND_ALBEDO[2];
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

// The optional inputs (cloud type extinction scale, mid-level sheet): absent, every output must be exactly what
// the update computed before they existed. referenceUpdate is that update, copied from the code it replaced.
const LAYER_EXTINCTION = 0.04;
function referenceUpdate(input: CloudSkyInput, bands: ReturnType<typeof createSkyBands>) {
  const c = Math.min(Math.max(input.cover, 0), 1);
  const thickness = Math.max(input.topM - input.baseM, 50);
  const tau = LAYER_EXTINCTION * thickness;
  const alt = input.cameraAltitudeM;
  const above = smoothstep(input.baseM, input.topM, alt);
  const mu0 = Math.max(input.lightMu, 0);
  const tSun = diffuseTransmission(tau, mu0);
  const tSky = diffuseTransmission(tau, 2 / 3);
  const tDirect = Math.exp(-tau / Math.max(mu0, 0.05));
  const sky = [0, 0, 0];
  for (let i = 0; i < SUMMARY_BANDS; i++) for (let k = 0; k < 3; k++) sky[k] += bands.weight[i] * bands.band[3 * i + k];
  const interReflect = 1 / (1 - GROUND_ALBEDO_Y * (1 - tSky));
  const shade = apparentCover(c, mu0);
  const directGround = 1 - shade * (1 - tDirect);
  const directCamera = directGround + (1 - directGround) * above;
  const deckDirect = 1 - smoothstep(0.8, 1.0, c) * (1 - tDirect) * (1 - above);
  const base = [0, 0, 0], top = [0, 0, 0], sideToward = [0, 0, 0], sideAway = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const eSun = input.lightE[k] * mu0;
    const eSky = Math.PI * sky[k];
    base[k] = ((tSun * eSun + tSky * eSky) / Math.PI) * interReflect;
    top[k] = ((1 - tSun) * eSun + (1 - tSky) * eSky) / Math.PI;
    const side = (0.8 * eSky) / (2 * Math.PI);
    sideToward[k] = (0.15 * input.lightE[k]) / Math.PI + side;
    sideAway[k] = (0.6 * input.lightE[k]) / Math.PI + side;
  }
  const lumA = (v: ArrayLike<number>): number => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  const clearGlobal = lumA(input.lightE) * mu0 + Math.PI * lumA(sky);
  const cloudy = apparentCover(c, 0.5);
  const diffuseUnder = Math.PI * ((1 - cloudy) * lumA(sky) + cloudy * lumA(base));
  const ratio = clearGlobal > 0 ? (directGround * lumA(input.lightE) * mu0 + diffuseUnder) / clearGlobal : 1;
  const airGrey = 0.7 * (1 - directGround) * (1 - above);
  const airScale = 1 + (Math.min(ratio, 1) - 1) * (1 - above);
  return { tau, above, directGround, directCamera, deckDirect, base, top, sideToward, sideAway, airGrey, airScale };
}

function skyInput(elevationDeg: number, cover: number, altitudeM: number, extra: Partial<CloudSkyInput> = {}) {
  const mu = Math.sin((elevationDeg * Math.PI) / 180);
  const bands = createSkyBands();
  cpu.addSummary(altitudeM / 1000, mu, [SUN_ILLUMINANCE_TOA, SUN_ILLUMINANCE_TOA, SUN_ILLUMINANCE_TOA], bands);
  const sunLayer = transmittanceToSpace(p, 2.05, mu, new THREE.Color()).multiplyScalar(SUN_ILLUMINANCE_TOA);
  const input: CloudSkyInput = {
    cover, baseM: 1500, topM: 2600, cameraAltitudeM: altitudeM, lightMu: mu, lightX: Math.cos(mu), lightZ: 0,
    lightE: [sunLayer.r, sunLayer.g, sunLayer.b], hazeExtinction: haze.x, hazeScaleHeight: haze.y, ...extra,
  };
  return { input, bands };
}

describe('CloudSky optional inputs', () => {
  it('computes exactly the outputs of the update before them when they are absent, 0 or 1', () => {
    for (const extra of [{}, { midCover: 0, midAltM: 5000, midTau: 6 }, { extinctionScale: 1 }, { midCover: undefined }]) {
      for (const el of [-3, 5, 25, 60]) {
        for (const cover of [0, 0.3, 0.5, 0.85, 1]) {
          for (const alt of [125, 2000, 3500]) {
            const { input, bands } = skyInput(el, cover, alt, extra);
            const c = new CloudSky();
            c.update(input, bands);
            const r = referenceUpdate(input, bands);
            expect(c.tau).toBe(r.tau);
            expect(c.above).toBe(r.above);
            expect(c.directGround).toBe(r.directGround);
            expect(c.directCamera).toBe(r.directCamera);
            expect(c.deckDirect).toBe(r.deckDirect);
            expect(c.airGrey).toBe(r.airGrey);
            expect(c.airScale).toBe(r.airScale);
            expect(c.midDirect).toBe(1);
            for (let k = 0; k < 3; k++) {
              expect(c.base[k]).toBe(r.base[k]);
              expect(c.top[k]).toBe(r.top[k]);
              expect(c.sideToward[k]).toBe(r.sideToward[k]);
              expect(c.sideAway[k]).toBe(r.sideAway[k]);
            }
          }
        }
      }
    }
  });

  it('scales the layer optical depth by the cloud type extinction', () => {
    const { input, bands } = skyInput(40, 1, 125, { extinctionScale: 2 });
    const c = new CloudSky();
    c.update(input, bands);
    expect(c.tau).toBeCloseTo(LAYER_EXTINCTION * 1100 * 2, 9);
  });

  it('dims the direct sun and the air light under an altostratus of cover 0.9 and optical depth 6', () => {
    for (const cover of [0, 0.5]) {
      const clear = skyInput(40, cover, 125);
      const ref = new CloudSky();
      ref.update(clear.input, clear.bands);
      const { input, bands } = skyInput(40, cover, 125, { midCover: 0.9, midAltM: 4500, midTau: 6 });
      const c = new CloudSky();
      c.update(input, bands);
      expect(c.midDirect).toBeLessThan(0.2);
      expect(c.directGround).toBeLessThan(ref.directGround * 0.2);
      expect(c.deckDirect).toBeLessThan(ref.deckDirect * 0.2 + 1e-12);
      expect(c.directCamera).toBeLessThan(ref.directCamera * 0.2);
      expect(c.airScale).toBeLessThanOrEqual(1);
      expect(c.airScale).toBeLessThan(ref.airScale);
      expect(c.airScale).toBeGreaterThan(0.2);
    }
  });

  it('keeps the sheet off the camera and the shadow light once the camera is above it', () => {
    const { input, bands } = skyInput(40, 0.5, 6000, { midCover: 0.9, midAltM: 4500, midTau: 6 });
    const c = new CloudSky();
    c.update(input, bands);
    expect(c.directCamera).toBeCloseTo(1, 9);
    expect(c.deckDirect).toBeCloseTo(1, 9);
    expect(c.airScale).toBeCloseTo(1, 9);
    // The ground stays under the sheet.
    expect(c.directGround).toBeLessThan(0.2);
  });

  it('dims the air above the low layer but below the sheet', () => {
    const { input, bands } = skyInput(40, 1, 3500, { midCover: 1, midAltM: 4500, midTau: 6 });
    const c = new CloudSky();
    c.update(input, bands);
    expect(c.directCamera).toBeLessThan(0.1);
    expect(c.airScale).toBeLessThan(0.95);
  });
});
