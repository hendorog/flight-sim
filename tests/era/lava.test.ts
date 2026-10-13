// Deep Time, increment 2 (WP5): the volcano's lava (world/terrain/volcano.ts).
//   - uLava.w is the night ramp of the sun's elevation (0 at +20 deg, faint at the safari's dusk start, > 0.5 at
//     sunset, 1 at -6 deg);
//   - the CPU mask twin is non-zero only in the crater and along the lobes' fall lines (and is there along each);
//   - the brightest emission at night, under the measured night exposure, stays below Bloom's FIREFLY_MAX.

import { afterAll, describe, expect, it } from 'vitest';
import { SCENE_UNITS_PER_LUX } from '../../src/core/context';
import { sunDirectionNED } from '../../src/core/world';
import { setEra } from '../../src/world/era/eraState';
import { CRETACEOUS } from '../../src/world/era/cretaceous';
import { SAFARI } from '../../src/world/era/cretaceousAnchors';
import {
  LAVA_CRATER_FLOOR,
  LAVA_FIREFLY_MAX,
  LAVA_GAIN_GLSL,
  LAVA_LOBES,
  LAVA_MEANDER_AMP,
  LAVA_NIGHT_LOG_L,
  LAVA_PEAK_FACTOR,
  VOLCANO_LAVA_GLSL,
  VOLCANO_LAVA_HEAD_GLSL,
  lavaGain,
  lavaMask,
  makeLavaMask,
  volcanoLavaState,
} from '../../src/world/terrain/volcano';
import { PLUME_GLOW_K } from '../../src/render/post/VolcanoPlumeEffect';

const V = CRETACEOUS.terrain.volcano!;
const DEG = Math.PI / 180;
const sky = (elDeg: number) => ({ sunDir: { y: Math.sin(elDeg * DEG) } });
const w = (elDeg: number): number => volcanoLavaState(sky(elDeg), 0, { x: 0, y: 0, z: 0, w: 0 }).w;

afterAll(() => setEra('present'));

describe('uLava', () => {
  it('w follows the night ramp: 0 at 20 deg, faint at the safari start, > 0.5 at 0 deg, 1 at -6 deg', () => {
    setEra('cretaceous');
    // The safari's start elevation, from its time of day (midsummer, the field's latitude).
    const startEl = Math.asin(-sunDirectionNED(SAFARI.tod, 172).z) / DEG;
    expect(startEl).toBeGreaterThan(0);
    expect(w(20)).toBe(0);
    expect(w(startEl)).toBeGreaterThan(0.15);
    expect(w(0)).toBeGreaterThan(0.5);
    expect(w(-6)).toBe(1);
    expect(w(-30)).toBe(1);
  });

  it('the position is the crater floor; nothing outside an era with a volcano', () => {
    setEra('cretaceous');
    const s = volcanoLavaState(sky(-10), 5, { x: 0, y: 0, z: 0, w: 0 });
    expect([s.x, s.y, s.z]).toEqual([V.east, V.north, V.summit - V.craterDepth]);
    setEra('present');
    expect(volcanoLavaState(sky(-10), 5, { x: 1, y: 1, z: 1, w: 1 })).toEqual({ x: 0, y: 0, z: 0, w: 0 });
  });

  it('lavaGain: none in daylight, bright at the dusk start, dimmer (exposure-tracking) at night', () => {
    expect(lavaGain(0)).toBe(0);
    expect(lavaGain(0.31)).toBeGreaterThan(100);
    expect(lavaGain(1)).toBeLessThan(lavaGain(0.5));
    expect(LAVA_GAIN_GLSL).toContain('float lavaGain(float w)');
    expect(VOLCANO_LAVA_HEAD_GLSL).toContain(LAVA_GAIN_GLSL);
  });
});

describe('the lava masks (CPU twin)', () => {
  const m = makeLavaMask();
  const at = (r: number, bearingDeg: number) => {
    const b = bearingDeg * DEG;
    return lavaMask(V.north + r * Math.cos(b), V.east + r * Math.sin(b), V, m);
  };

  it('is non-zero only in the crater and along the lobes', () => {
    let hits = 0;
    for (let dn = -2600; dn <= 2600; dn += 20)
      for (let de = -2600; de <= 2600; de += 20) {
        lavaMask(V.north + dn, V.east + de, V, m);
        if (m.crater <= 0 && m.lobe <= 0) continue;
        hits++;
        const r = Math.hypot(dn, de);
        if (m.crater > 0) expect(r).toBeLessThanOrEqual(LAVA_CRATER_FLOOR * V.craterRadius + 1e-6);
        if (m.lobe > 0) {
          const theta = Math.atan2(de, dn);
          const near = LAVA_LOBES.some((L) => {
            const b = L.bearingDeg * DEG;
            const s = r - V.craterRadius;
            const lateral = Math.abs(r * Math.sin(theta - b));
            return Math.cos(theta - b) > 0 && s >= -20 && s <= L.lengthM + L.halfWidthM && lateral <= 1.15 * L.halfWidthM + 1.5 * LAVA_MEANDER_AMP * L.wiggle;
          });
          expect(near, `lobe mask at dn ${dn} de ${de}`).toBe(true);
        }
      }
    expect(hits).toBeGreaterThan(100);
  });

  it('covers the crater floor and each lobe on its fall line; the east flank (toward the field) is bare', () => {
    expect(at(0, 0).crater).toBe(1);
    expect(at(0.5 * V.craterRadius, 90).crater).toBe(1);
    for (const L of LAVA_LOBES) {
      let found = 0;
      // Near the centre line a little below the rim and at mid-length (allowing for the meander).
      for (const s of [80, L.lengthM / 2])
        for (let off = -3; off <= 3; off += 0.25) if (at(V.craterRadius + s, L.bearingDeg + off).lobe > 0.5) { found++; break; }
      expect(found).toBe(2);
      expect(at(V.craterRadius + L.lengthM + 2 * L.halfWidthM, L.bearingDeg).lobe).toBe(0);
    }
    for (let b = 30; b <= 150; b += 10) for (const r of [500, 1000, 1500]) expect(at(r, b).lobe + at(r, b).crater).toBe(0);
  });

  it('the GLSL lobes carry the same constants', () => {
    for (const L of LAVA_LOBES) {
      expect(VOLCANO_LAVA_HEAD_GLSL).toContain(((L.bearingDeg * Math.PI) / 180).toFixed(6));
      expect(VOLCANO_LAVA_HEAD_GLSL).toContain(`${L.lengthM}.0`);
    }
    expect(VOLCANO_LAVA_GLSL).toContain('outgoingLight += lvEm;');
    expect(VOLCANO_LAVA_GLSL).toContain('uLava.w > 0.0');
  });
});

describe('brightness', () => {
  it('the night-maximum exposed luminance is below FIREFLY_MAX', () => {
    // EXPOSURE_GLSL (render/post/AutoExposure.ts) at the measured night adaptation.
    const logL = LAVA_NIGHT_LOG_L;
    const ev = logL - Math.log2(SCENE_UNITS_PER_LUX);
    const keyBias = Math.max(-0.2 * Math.max(0, 11 - ev), -4.5);
    const exposure = 0.18 * Math.pow(2, keyBias - logL);
    expect(exposure).toBeGreaterThan(10); // a night exposure, not a daylight one
    // Full night (w = 1): the exposure above belongs to it. Twilight's brighter gain meets a far lower exposure
    // (the dusk start's adapted log2 luminance is +5.1: see volcano.ts).
    const peak = lavaGain(1);
    const crater = peak * LAVA_PEAK_FACTOR * exposure;
    const underglow = peak * PLUME_GLOW_K * (0.35 + 0.6) * exposure;
    expect(crater).toBeLessThan(LAVA_FIREFLY_MAX);
    expect(underglow).toBeLessThan(LAVA_FIREFLY_MAX);
    expect(LAVA_FIREFLY_MAX).toBe(64); // render/post/Bloom.ts FIREFLY_MAX
  });
});
