// The parametric yokes and stick grip (src/render/aircraft/yoke.ts): every style builds finite, symmetric geometry
// within its triangle budget, at the spans the references give, with its switches on the outboard horn.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cleanAttributes } from '../../src/render/aircraft/geometry';
import { DIAMOND_STICK, stickGeometry, YOKE_STYLES, yokeGeometry } from '../../src/render/aircraft/yoke';

const tris = (gs: THREE.BufferGeometry[]): number => gs.reduce((n, g) => n + (g.index ? g.index.count : g.getAttribute('position').count) / 3, 0);
const bounds = (gs: THREE.BufferGeometry[]): THREE.Box3 => {
  const b = new THREE.Box3();
  for (const g of gs) { g.computeBoundingBox(); b.union(g.boundingBox!); }
  return b;
};
const finite = (gs: THREE.BufferGeometry[]): boolean => gs.every((g) => (g.getAttribute('position').array as Float32Array).every(Number.isFinite));

describe('yoke styles', () => {
  /** Horn span outside to outside, m (work/cockpit-refs/dimensions.md, +/-15 %). */
  const SPAN: Record<string, number> = { cessnaSingle: 0.33, cessna152: 0.31, piperSeneca: 0.31, piperTomahawk: 0.3, cessna208: 0.37, pilatus: 0.31 };
  for (const [name, style] of Object.entries(YOKE_STYLES)) {
    it(name, () => {
      const pilot = yokeGeometry(style, -1);
      const bare = yokeGeometry(style, 0);
      const all = [...pilot.plastic, pilot.tube];
      expect(finite(all)).toBe(true);
      // 2-4k triangles a yoke.
      expect(tris(all)).toBeGreaterThan(2000);
      expect(tris(all)).toBeLessThan(4000);
      // Merges with the material's attribute set (MeshBatch).
      expect(mergeGeometries(pilot.plastic.map((g) => cleanAttributes(g)), false)).not.toBeNull();
      const wheel = bounds(bare.plastic);
      expect(wheel.max.x - wheel.min.x).toBeGreaterThan(SPAN[name] * 0.85);
      expect(wheel.max.x - wheel.min.x).toBeLessThan(SPAN[name] * 1.15);
      // Symmetric without fittings; the pilot's fittings on the left horn.
      expect(wheel.max.x + wheel.min.x).toBeCloseTo(0, 4);
      const fittings = pilot.plastic.slice(2, 2 + style.fittings.length);
      if (fittings.length) expect(bounds(fittings).max.x).toBeLessThan(0);
      // The column axis (y = 0) passes through the hub, and the tube reaches 0.3 m forward of it.
      const hub = bounds([bare.plastic[2]]);
      expect(hub.min.y).toBeLessThan(0);
      expect(hub.max.y).toBeGreaterThan(0);
      expect(bounds([pilot.tube]).min.z).toBeLessThan(-0.3);
    });
  }

  it('the DA20 stick grip stands on its tube at the stick height', () => {
    const s = stickGeometry(DIAMOND_STICK, 0.35);
    const all = [...s.plastic, s.tube];
    expect(finite(all)).toBe(true);
    expect(tris(all)).toBeLessThan(2500);
    const b = bounds(all);
    expect(b.max.y).toBeGreaterThan(0.34);
    expect(b.max.y).toBeLessThan(0.37);
  });
});
