// The cumulus layer around the storm cells (render/clouds/cloudModel.ts): the clearing uniforms come from the
// frame's shared selection at the camera (render/weather/stormSelection.ts), the same cells the storm effect draws;
// with no cell the count is 0 and the GLSL term is skipped. The convective activity deepens the drawn layer
// (layerTowerExt, layerTypeBias) and is 0 for the default weather, whose uniforms keep their values.

import * as THREE from 'three';
import { describe, expect, test } from 'vitest';
import type { SimContext } from '../../src/core/context';
import { defaultWeather, type WeatherSettings } from '../../src/core/types';
import { CLOUD_TYPE_PROFILES, MAX_STORMS, stormCentreAt } from '../../src/core/weatherFields';
import { stormShare } from '../../src/physics/weather/stormField';
import { CLOUD_MODEL_GLSL, CLOUD_TYPE_SHAPE, CloudModel, extendedLayerTopM, layerActivity, layerTowerExt, layerTypeBias } from '../../src/render/clouds/cloudModel';
import { StormCellEffect } from '../../src/render/weather/StormCellEffect';
import { cameraStormsAt } from '../../src/render/weather/stormSelection';
import { applyWeatherPreset, weatherPresetById } from '../../src/sim/weatherPresets';

const thunderstorm = (): WeatherSettings => applyWeatherPreset(defaultWeather(), weatherPresetById('thunderstorm')!);

/** A context whose camera looks straight down from 150 km over NED (north, east) with a 170 degree field. */
function ctxAt(weather: WeatherSettings, north = 0, east = 0, simTime = 0): SimContext {
  const camera = new THREE.PerspectiveCamera(170, 1, 1, 400_000);
  camera.position.set(east, 150_000, -north);
  camera.lookAt(east, 0, -north);
  camera.updateMatrixWorld();
  return { weather, simTime, camera } as unknown as SimContext;
}

describe('storm clearing uniforms', () => {
  test('none for the default weather: count 0 and the type uniforms of the cloud type', () => {
    const w = defaultWeather();
    const m = new CloudModel();
    m.update(ctxAt(w), 0.016);
    const u = m.uniforms;
    expect(u.uStormClearCount.value).toBe(0);
    expect(u.uStormClear.value).toHaveLength(MAX_STORMS);
    expect(layerActivity(w)).toBe(0);
    expect(u.uTopFrac.value).toBe(1 / CLOUD_TYPE_PROFILES.auto.towerExt);
    expect(u.uLayer.value.y).toBe(1500 + 1100 * CLOUD_TYPE_PROFILES.auto.towerExt);
    expect(u.uCloudShape.value.w).toBe(CLOUD_TYPE_SHAPE.auto.typeBias);
  });

  test('the Thunderstorm cells with a core share, as the storm effect draws them', () => {
    const w = thunderstorm();
    const ctx = ctxAt(w);
    const m = new CloudModel();
    m.update(ctx, 0.016);
    const effect = new StormCellEffect();
    const drawn = effect.updateCells(ctx);
    // One selection per frame and context: the effect read the array the clouds read.
    const cells = cameraStormsAt(ctx);
    expect(cameraStormsAt(ctx)).toBe(cells);
    const withCore = cells.filter((c) => stormShare(c, 'core') > 0);
    const u = m.uniforms;
    expect(withCore.length).toBeGreaterThan(0);
    expect(u.uStormClearCount.value).toBe(withCore.length);
    expect(drawn).toBe(cells.length);
    let k = 0;
    for (let i = 0; i < cells.length; i++) {
      if (!(stormShare(cells[i], 'core') > 0)) continue;
      const v = u.uStormClear.value[k++];
      const g = effect.cells[i];
      const p = stormCentreAt(cells[i], 0, { north: 0, east: 0 });
      expect(v.x).toBeCloseTo(p.east, 6);
      expect(v.y).toBeCloseTo(-p.north, 6);
      expect([v.x, v.y, v.z, v.w]).toEqual([g.x, g.z, g.radius, g.core]);
    }
    console.log(`[stormClearing] Thunderstorm at the airport: ${cells.length} cells, ${withCore.length} with a core share; ${[...u.uStormClear.value].slice(0, k).map((v) => `${(Math.hypot(v.x, v.y) / 1000).toFixed(1)} km R ${Math.round(v.z)} m core ${v.w.toFixed(2)}`).join(', ')}`);
  });

  test('an explicit cell clears with share 1; cb=none clears nothing', () => {
    const cell = { northM: 12_000, eastM: 4000, radiusM: 3000, topM: 11_000, intensity: 0.8, motionDeg: 0, motionKt: 0 };
    const m = new CloudModel();
    m.update(ctxAt({ ...thunderstorm(), storms: [cell] }), 0.016);
    expect(m.uniforms.uStormClearCount.value).toBe(1);
    expect(m.uniforms.uStormClear.value[0].toArray()).toEqual([4000, -12_000, 3000, 1]);
    m.update(ctxAt({ ...thunderstorm(), storms: [] }), 0.016);
    expect(m.uniforms.uStormClearCount.value).toBe(0);
  });

  test('the GLSL multiplies the lateral coverage only while a cell is set', () => {
    expect(CLOUD_MODEL_GLSL).toContain('if (uStormClearCount > 0) wt.x *= stormClearing(xz);');
    expect(CLOUD_MODEL_GLSL).toContain(`uniform vec4 uStormClear[${MAX_STORMS}];`);
  });
});

describe('the convective activity deepens the drawn layer', () => {
  test('tower extension and type bias from the type toward towering', () => {
    expect(layerTowerExt('auto', 0)).toBe(CLOUD_TYPE_PROFILES.auto.towerExt);
    expect(layerTowerExt('auto', 1)).toBe(CLOUD_TYPE_PROFILES.towering.towerExt);
    expect(layerTowerExt('cumulus', 0.5)).toBeCloseTo(0.5 * (CLOUD_TYPE_PROFILES.cumulus.towerExt + CLOUD_TYPE_PROFILES.towering.towerExt), 12);
    expect(layerTypeBias('auto', 1)).toBe(CLOUD_TYPE_SHAPE.towering.typeBias);
    expect(layerTypeBias('auto', 0)).toBe(CLOUD_TYPE_SHAPE.auto.typeBias);
  });

  test("Thunderstorm conditions with an 'auto' layer draw it deeper; extendedLayerTopM agrees with the march", () => {
    const w = { ...thunderstorm(), cloudType: 'auto' as const };
    const a = layerActivity(w);
    const m = new CloudModel();
    m.update(ctxAt(w), 0.016);
    const plain = w.cloudBaseM + (w.cloudTopM - w.cloudBaseM) * CLOUD_TYPE_PROFILES.auto.towerExt;
    console.log(`[stormClearing] auto layer at Thunderstorm conditions: activity ${a.toFixed(3)}, top ${m.uniforms.uLayer.value.y.toFixed(0)} m (type alone ${plain.toFixed(0)} m)`);
    expect(a).toBeGreaterThan(0);
    expect(m.uniforms.uLayer.value.y).toBeGreaterThan(plain);
    expect(extendedLayerTopM(w)).toBe(m.uniforms.uLayer.value.y);
    expect(m.uniforms.uTopFrac.value).toBe(1 / layerTowerExt('auto', a));
  });
});
