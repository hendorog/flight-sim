// The valley scenery (town, farms, roads) placed on the REAL terrain height function.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildValley, findTownSite, TOWN_RADIUS } from '../../src/world/airport/valley';
import { SCENE_UNITS_PER_LUX } from '../../src/core/context';
import { createSharedUniforms } from '../../src/world/airport/shared';
import { LIGHT_COLORS } from '../../src/world/airport/lights';
import { terrainHeight } from '../../src/world/terrain/heightfield';

describe('valley scenery on the real terrain', () => {
  const t0 = performance.now();
  const valley = buildValley(terrainHeight, createSharedUniforms(), new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial());
  const ms = performance.now() - t0;
  const byName = (n: string) => valley.group.children.find((o) => o.name === n) as THREE.Mesh | undefined;

  it('builds a town, farms and roads in reasonable time', () => {
    const walls = byName('valley-walls') as THREE.InstancedMesh;
    expect(walls.count).toBeGreaterThan(300);
    expect(byName('valley-roads')).toBeDefined();
    expect(byName('valley-tracks')).toBeDefined();
    expect(valley.lights.filter((l) => l.colorA === LIGHT_COLORS.sodium).length).toBeGreaterThan(50);
    console.log(`buildValley: ${ms.toFixed(0)} ms, ${walls.count} buildings, ${valley.lights.length} lights`);
    expect(ms).toBeLessThan(4000);
  });

  it('drapes every road vertex just above the terrain', () => {
    for (const name of ['valley-roads', 'valley-tracks']) {
      const pos = byName(name)!.geometry.attributes.position as THREE.BufferAttribute;
      let worst = 0;
      for (let i = 0; i < pos.count; i++) {
        const lift = pos.getY(i) - terrainHeight(-pos.getZ(i), pos.getX(i));
        worst = Math.max(worst, Math.abs(lift - 0.2));
      }
      expect(worst).toBeLessThan(1e-3);
    }
  });

  it('keeps road surfaces close to the terrain between vertices (no floating or buried stretches)', () => {
    const g = byName('valley-roads')!.geometry;
    const pos = g.attributes.position as THREE.BufferAttribute;
    const index = g.index!;
    let above = 0, below = 0, n = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), m = new THREE.Vector3();
    for (let t = 0; t < index.count; t += 3) {
      a.fromBufferAttribute(pos, index.getX(t));
      b.fromBufferAttribute(pos, index.getX(t + 1));
      c.fromBufferAttribute(pos, index.getX(t + 2));
      m.copy(a).add(b).add(c).multiplyScalar(1 / 3);
      const d = m.y - terrainHeight(-m.z, m.x);
      above = Math.max(above, d);
      below = Math.min(below, d);
      n++;
    }
    console.log(`road triangle centroids: ${n}, height above terrain ${below.toFixed(2)} .. ${above.toFixed(2)} m`);
    expect(below).toBeGreaterThan(-0.3);
    expect(above).toBeLessThan(0.8);
  });

  it('seats every building on the ground (walls reach below the lowest corner)', () => {
    const walls = byName('valley-walls') as THREE.InstancedMesh;
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    for (let i = 0; i < walls.count; i++) {
      walls.getMatrixAt(i, m);
      m.decompose(p, q, s);
      const ground = terrainHeight(-p.z, p.x);
      expect(p.y).toBeLessThan(ground);
      expect(ground - p.y).toBeLessThan(4);
    }
  });

  it('lights the town with a hierarchy of street classes, not a uniform grid', () => {
    const street = valley.lights.filter((l) => l.colorA === LIGHT_COLORS.sodium || l.colorA === LIGHT_COLORS.led4000);
    const cds = street.map((l) => l.cd);
    // Main streets (~12 000 cd) far brighter than residential ones (~4 500 cd), with per-street variation.
    expect(Math.max(...cds)).toBeGreaterThan(2 * Math.min(...cds));
    expect(new Set(cds.map((c) => Math.round(c / 100))).size).toBeGreaterThan(10);
    // Both sodium and LED streets.
    expect(street.some((l) => l.colorA === LIGHT_COLORS.led4000)).toBe(true);
    // Brighter area lighting over commercial car parks.
    expect(valley.lights.some((l) => l.colorA === LIGHT_COLORS.metalHalide)).toBe(true);
    // A ground glow over the town, lit only where there are lamps: an illuminance map sampled with bilinear
    // filtering (no cell pattern).
    const glow = byName('valley-town-glow')!;
    const tex = (glow.material as THREE.ShaderMaterial).uniforms.uGlowTex.value as THREE.DataTexture;
    expect(tex.magFilter).toBe(THREE.LinearFilter);
    const { data, width, height } = tex.image as { data: Uint16Array; width: number; height: number };
    const half = (glow.material as THREE.ShaderMaterial).uniforms.uGlowHalf.value as number;
    expect((2 * half) / width).toBeLessThanOrEqual(5); // texels no larger than 5 m
    let lit = 0, peak = 0, dark = 0, inside = 0;
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        const o = (j * width + i) * 4;
        const E = 0.2126 * THREE.DataUtils.fromHalfFloat(data[o]) + 0.7152 * THREE.DataUtils.fromHalfFloat(data[o + 1]) + 0.0722 * THREE.DataUtils.fromHalfFloat(data[o + 2]);
        if (E > 0) lit++;
        peak = Math.max(peak, E);
        const x = ((i + 0.5) / width) * 2 * half - half, y = ((j + 0.5) / height) * 2 * half - half;
        if (Math.hypot(x, y) < 0.5 * TOWN_RADIUS) {
          inside++;
          if (E < 1 * SCENE_UNITS_PER_LUX) dark++;
        }
      }
    }
    expect(lit).toBeGreaterThan(width * height * 0.1);
    // Illuminance under a lamp of 30-80 lux (scene units: lux x 0.1)...
    expect(peak).toBeGreaterThan(3);
    expect(peak).toBeLessThan(8);
    // ... pooled: even in the middle of town a good share of the ground (back yards, parks) is below 1 lux.
    expect(dark / inside).toBeGreaterThan(0.15);
  });

  it('gives the town a ragged edge and thins it out toward the edge', () => {
    const street = valley.lights.filter((l) => l.colorA === LIGHT_COLORS.sodium || l.colorA === LIGHT_COLORS.led4000);
    const site = findTownSite(terrainHeight)!;
    const polar = street.map((l) => {
      const dn = -l.position.z - site.north, de = l.position.x - site.east;
      return { r: Math.hypot(dn, de), b: Math.atan2(de, dn) };
    });
    // Outline: the outermost lamp in each of 24 bearing sectors, excluding the lit arterials (the outer 25 %).
    const SECT = 24;
    const outline = Array.from({ length: SECT }, (_, k) => {
      const rs = polar.filter((p) => Math.floor(((p.b + Math.PI) / (2 * Math.PI)) * SECT) % SECT === k).map((p) => p.r).sort((a, b) => a - b);
      return rs.length ? rs[Math.floor(rs.length * 0.75)] : 0;
    });
    const mean = outline.reduce((a, b) => a + b, 0) / SECT;
    const sd = Math.sqrt(outline.reduce((a, b) => a + (b - mean) ** 2, 0) / SECT);
    expect(sd / mean).toBeGreaterThan(0.15);
    // Lamp density (per km^2) in the outer half of the built-up radius well below the inner half.
    const R = TOWN_RADIUS;
    const inner = polar.filter((p) => p.r < 0.4 * R).length / (Math.PI * (0.4 * R) ** 2);
    const outer = polar.filter((p) => p.r > 0.6 * R && p.r < R).length / (Math.PI * (R ** 2 - (0.6 * R) ** 2));
    expect(outer).toBeLessThan(0.6 * inner);
  });
});
