import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { airfoilWing } from '../../src/world/airport/props';

/** Signed volume of a closed triangle mesh: positive when the faces wind outward (front faces visible). */
function signedVolume(g: THREE.BufferGeometry): number {
  const p = g.attributes.position as THREE.BufferAttribute;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let v = 0;
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    v += a.dot(b.clone().cross(c)) / 6;
  }
  return v;
}

describe('parked aircraft geometry', () => {
  it('builds closed, outward-facing airfoil wing panels on both sides', () => {
    for (const side of [-1, 1]) {
      const g = airfoilWing(new THREE.Vector3(side * 0.5, 0.8, -0.4), new THREE.Vector3(side * 5.5, 0.9, -0.3), 1.6, 1.1);
      const vol = signedVolume(g);
      // NACA 2412 section area 0.082 c^2, lofted: 0.082 * span * (c0^2 + c0 c1 + c1^2) / 3 = 0.755 m^3.
      expect(vol).toBeGreaterThan(0.7);
      expect(vol).toBeLessThan(0.8);
      // Closed: the signed volume does not change when the mesh is moved.
      g.translate(10, 20, 30);
      expect(signedVolume(g)).toBeCloseTo(vol, 4);
    }
  });
});
