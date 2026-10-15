import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BRIGHT_LEVEL, DARK_LEVEL, NightLook, STAR_GAIN, nightDarkness, nightGains, outdoorGreyCard } from '../../src/render/sky/NightLook';
import { SCENE_UNITS_PER_LUX } from '../../src/render/sky/params';
import type { SimContext } from '../../src/core/context';
import type { Atmosphere } from '../../src/render/sky/Atmosphere';

const gainsAt = (cdm2: number) => nightGains(nightDarkness(cdm2));

describe('night presentation gains', () => {
  it('calibrate point sources below photometric on a dark night (a magnitude ladder, not one white dot)', () => {
    expect(STAR_GAIN).toBeGreaterThan(0);
    expect(STAR_GAIN).toBeLessThan(1);
  });

  it('keep the stars and the diffuse light photometric in daylight, twilight and under a full Moon', () => {
    // Noon grey card ~1e3 cd/m^2; civil twilight ~1; winter full Moon at 60 deg ~1.2e-2; June full Moon at ~16 deg ~2.6e-3.
    for (const level of [1e3, 1, 1.2e-2, 2.6e-3, BRIGHT_LEVEL]) {
      const g = gainsAt(level);
      expect(g.star).toBe(1);
      expect(g.diffuse).toBe(1);
      expect(g.airglow).toBe(1);
    }
  });

  it('brighten the Milky Way and darken the airglow on a moonless night', () => {
    for (const level of [5.7e-5, DARK_LEVEL]) {
      const g = gainsAt(level);
      expect(nightDarkness(level)).toBe(1);
      expect(g.star).toBe(STAR_GAIN);
      expect(g.diffuse).toBeGreaterThan(1);
      expect(g.airglow).toBeLessThan(1);
    }
  });

  it('change monotonically with the light level', () => {
    let prev = gainsAt(1e-6);
    for (let lg = -6; lg <= 3; lg += 0.05) {
      const g = gainsAt(10 ** lg);
      expect(g.star).toBeGreaterThanOrEqual(prev.star);
      expect(g.diffuse).toBeLessThanOrEqual(prev.diffuse);
      expect(g.airglow).toBeGreaterThanOrEqual(prev.airglow);
      prev = g;
    }
  });

  it('reads the outdoor light (not the cockpit lamps) and writes the shared uniforms', () => {
    const sky = {
      sunColor: new THREE.Color(0, 0, 0),
      skyColor: new THREE.Color(2.6e-7, 2.6e-7, 2.6e-7),
      sunDir: new THREE.Vector3(0, -0.35, 0.94),
      moonDir: new THREE.Vector3(0, -0.35, 0.94),
    };
    const ctx = { sky, cameraMode: 'cockpit' } as unknown as SimContext;
    const atmosphere = { moonIlluminance: new THREE.Vector3(0.026, 0.026, 0.026), cloudSky: { directCamera: 1 } } as unknown as Atmosphere;
    // Moon down: 0.18 * (1e-3 lux / pi) + 0.18 * sky ~ 5.8e-5 cd/m^2.
    expect(outdoorGreyCard(ctx, atmosphere)).toBeCloseTo(0.18 * (1e-3 / Math.PI + 2.6e-7 / SCENE_UNITS_PER_LUX), 9);
    const look = new NightLook();
    const uniforms = look.uniforms;
    look.update(ctx, atmosphere);
    expect(look.uniforms).toBe(uniforms);
    expect(uniforms.uStarGain.value).toBe(STAR_GAIN);
    expect(uniforms.uDiffuseGain.value).toBeGreaterThan(1);
    expect(uniforms.uAirglowGain.value).toBeLessThan(1);
    // A full Moon 60 deg up: back to photometric.
    sky.moonDir.set(0, 0.87, 0.5);
    look.update(ctx, atmosphere);
    expect(uniforms.uStarGain.value).toBe(1);
    expect(uniforms.uDiffuseGain.value).toBe(1);
    expect(uniforms.uAirglowGain.value).toBe(1);
  });
});
