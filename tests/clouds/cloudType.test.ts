// Cloud types and the mid-level sheet in the cloud model's uniforms. Without the optional weather fields (and
// with cloudType 'auto') CloudModel must hand the shaders exactly the uniforms it did before the types existed:
// the layer extended by TOWER_EXTENSION, the extinction 0.1 /m, the top fraction 1 / 1.6, and neutral type
// terms. Each other type must hand over its CLOUD_TYPE_PROFILES / CLOUD_TYPE_SHAPE row, and a mid-level sheet
// its cover, altitude, kind and optical depth.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { defaultWeather, type CloudType, type WeatherSettings } from '../../src/core/types';
import { CLOUD_TYPE_PROFILES } from '../../src/core/weatherFields';
import { coverageParams } from '../../src/render/clouds/coverage';
import { KT } from '../../src/core/math';
import {
  CLOUD_TYPE_SHAPE,
  CLOUD_WIND_FACTOR,
  CloudModel,
  extendedLayerTopM,
  MID_TAU_MAX,
  MID_WIND_FACTOR,
  midSheetTau,
  TOWER_EXTENSION,
} from '../../src/render/clouds/cloudModel';
import { midSheetTransmission } from '../../src/render/sky/cloudSky';
import type { SimContext } from '../../src/core/context';

const ctxFor = (weather: WeatherSettings, simTime = 0): SimContext => ({ weather, simTime }) as unknown as SimContext;
const TYPES = Object.keys(CLOUD_TYPE_PROFILES) as CloudType[];

describe('CloudModel without a cloud type', () => {
  it('sets the layer, coverage, extinction and top fraction it set before the types existed', () => {
    const expected = new THREE.Vector2();
    for (const extra of [{}, { cloudType: 'auto' }, { cloudType: 'cirrocumulus' }, { cloudType: 3 }]) {
      for (const cloudCover of [0, 0.2, 0.35, 0.6, 1]) {
        const w = { ...defaultWeather(), cloudCover, ...extra } as WeatherSettings;
        const m = new CloudModel();
        m.update(ctxFor(w), 0.016);
        const base = Math.min(w.cloudBaseM, w.cloudTopM - 100);
        const nominalTop = Math.max(w.cloudTopM, base + 100);
        const top = base + (nominalTop - base) * 1.6;
        const u = m.uniforms;
        expect(u.uLayer.value.x).toBe(base);
        expect(u.uLayer.value.y).toBe(top);
        expect(u.uLayer.value.z).toBe(1 / (top - base));
        expect(u.uLayer.value.w).toBe(cloudCover);
        coverageParams(cloudCover, expected);
        expect(u.uCoverage.value.x).toBe(expected.x);
        expect(u.uCoverage.value.y).toBe(expected.y);
        expect(u.uExtinction.value).toBe(0.1);
        expect(u.uTopFrac.value).toBe(1 / 1.6);
        // Neutral type terms: weight 0 on the deck override, scales 1, no raggedness, no type bias.
        expect(u.uCloudType.value.toArray()).toEqual([0, 0, 1, 1]);
        expect(u.uCloudShape.value.toArray()).toEqual([1, 0, 1, 0]);
        expect(u.uMid.value.x).toBe(0);
      }
    }
  });

  it("has an 'auto' profile equal to the clouds module's own constants", () => {
    expect(CLOUD_TYPE_PROFILES.auto.towerExt).toBe(TOWER_EXTENSION);
    expect(CLOUD_TYPE_PROFILES.auto.extinctionScale).toBe(1);
    expect(CLOUD_TYPE_PROFILES.auto.shapeFreqScale).toBe(1);
    expect(CLOUD_TYPE_PROFILES.auto.deckWeight).toBe(0);
    expect(CLOUD_TYPE_SHAPE.auto).toEqual({ deckTopScale: 1, baseRagged: 0, erosionScale: 1, typeBias: 0 });
  });
});

describe('CloudModel with a cloud type', () => {
  it('hands the shaders the profile and shape rows of the type', () => {
    for (const type of TYPES) {
      const w: WeatherSettings = { ...defaultWeather(), cloudCover: 0.7, cloudBaseM: 900, cloudTopM: 2100, cloudType: type };
      const m = new CloudModel();
      m.update(ctxFor(w), 0.016);
      const p = CLOUD_TYPE_PROFILES[type];
      const s = CLOUD_TYPE_SHAPE[type];
      const u = m.uniforms;
      expect(u.uLayer.value.x).toBe(900);
      expect(u.uLayer.value.y).toBe(900 + 1200 * p.towerExt);
      expect(u.uTopFrac.value).toBe(1 / p.towerExt);
      expect(u.uExtinction.value).toBeCloseTo(0.1 * p.extinctionScale, 12);
      expect(u.uCloudType.value.toArray()).toEqual([p.deckOverride, p.deckWeight, p.extinctionScale, p.shapeFreqScale]);
      expect(u.uCloudShape.value.toArray()).toEqual([s.deckTopScale, s.baseRagged, s.erosionScale, s.typeBias]);
    }
  });

  it('gives every type except auto full weight on its deck shape, and towering cumulus the tallest layer', () => {
    for (const type of TYPES) expect(CLOUD_TYPE_PROFILES[type].deckWeight).toBe(type === 'auto' ? 0 : 1);
    const ext = TYPES.map((t) => CLOUD_TYPE_PROFILES[t].towerExt);
    expect(CLOUD_TYPE_PROFILES.towering.towerExt).toBe(Math.max(...ext));
    expect(CLOUD_TYPE_PROFILES.nimbostratus.extinctionScale).toBeGreaterThan(CLOUD_TYPE_PROFILES.stratus.extinctionScale);
  });
});

describe('CloudModel mid-level sheet', () => {
  it('hands over cover, altitude, kind and the optical depth at full cover', () => {
    const m = new CloudModel();
    m.update(ctxFor({ ...defaultWeather(), midCover: 0.6, midType: 'altocumulus', midAltM: 5200 }), 0.016);
    expect(m.uniforms.uMid.value.toArray()).toEqual([0.6, 5200, 1, MID_TAU_MAX.altocumulus]);
    m.update(ctxFor({ ...defaultWeather(), cloudBaseM: 3600, cloudTopM: 4200, midCover: 2 }), 0.016);
    // Cover clamped to 1, altostratus by default, altitude max(4500, top + 1000), above the extended top 4560 m.
    expect(m.uniforms.uMid.value.toArray()).toEqual([1, 5200, 0, MID_TAU_MAX.altostratus]);
  });

  it('drifts the sheet downwind along its axis, wrapped to 30 km', () => {
    const m = new CloudModel();
    const w: WeatherSettings = { ...defaultWeather(), windDirectionDeg: 270, windSpeedKt: 20, midCover: 0.5 };
    let prev = m.uniforms.uMidOffset.value.x;
    for (let i = 0; i < 200; i++) {
      m.update(ctxFor(w, i * 0.5), 0.5);
      const o = m.uniforms.uMidOffset.value;
      expect(o.y).toBe(0);
      expect(o.x).toBeGreaterThanOrEqual(0);
      expect(o.x).toBeLessThan(30_000);
      // Wind from 270 blows toward +x (the sheet axis is (1, 0)): each step lowers the offset by
      // speed * MID_WIND_FACTOR * dt, modulo the 30 km wrap.
      const back = (((prev - o.x) % 30_000) + 30_000) % 30_000;
      expect(back).toBeCloseTo(20 * KT * CLOUD_WIND_FACTOR * MID_WIND_FACTOR * 0.5, 6);
      prev = o.x;
    }
  });

  it('applies the sheet only above the extended layer top, the same test the sky model uses', () => {
    // Base 1500, top 3500, no midAltM: the sheet defaults to 4500 m, below the 'auto' extended top 4700 m.
    const w: WeatherSettings = { ...defaultWeather(), cloudCover: 0.5, cloudBaseM: 1500, cloudTopM: 3500, midCover: 0.8 };
    const m = new CloudModel();
    m.update(ctxFor(w), 0.016);
    expect(m.uniforms.uLayer.value.y).toBe(4700);
    expect(extendedLayerTopM(w)).toBe(m.uniforms.uLayer.value.y);
    expect(m.mid.altM).toBe(4500);
    expect(m.midAboveLayer).toBe(false);
    expect(m.uniforms.uMid.value.x).toBe(0);
    // Raised to 4800 m the sheet is above the layer.
    m.update(ctxFor({ ...w, midAltM: 4800 }), 0.016);
    expect(m.midAboveLayer).toBe(true);
    expect(m.uniforms.uMid.value.x).toBe(0.8);
    // The extended top of every type is the march's uLayer.y.
    for (const cloudType of TYPES) {
      const wt: WeatherSettings = { ...w, cloudType };
      m.update(ctxFor(wt), 0.016);
      expect(extendedLayerTopM(wt)).toBe(m.uniforms.uLayer.value.y);
      expect(m.midAboveLayer).toBe(4500 > m.uniforms.uLayer.value.y);
    }
  });

  it('has a mean optical depth from the minimum at no cover to MID_TAU_MAX at full cover', () => {
    expect(midSheetTau(1, 'altostratus')).toBe(MID_TAU_MAX.altostratus);
    expect(midSheetTau(1, 'altocumulus')).toBe(MID_TAU_MAX.altocumulus);
    expect(midSheetTau(0, 'altostratus')).toBeLessThan(midSheetTau(0.5, 'altostratus'));
  });

  it('lets through less direct beam than total light, and all of it without cover', () => {
    const out: [number, number] = [0, 0];
    expect(midSheetTransmission(0, 6, 0.5, out)).toEqual([1, 1]);
    for (const mu0 of [0.1, 0.4, 0.8]) {
      const [direct, total] = midSheetTransmission(0.9, 6, mu0, out);
      expect(direct).toBeLessThan(total);
      expect(total).toBeLessThanOrEqual(1);
      expect(direct).toBeGreaterThan(0.1 - 1e-9);
    }
  });
});
