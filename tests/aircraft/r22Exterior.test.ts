import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { R22_VISUAL } from '../../src/aircraft/r22/visual';
import { rotorBladeGeometry, type RotorSpec } from '../../src/render/aircraft/rotorcraft/rotor';

const d = R22_VISUAL.rotorcraftVisual!;
const rotors: RotorSpec[] = [d.main, { ...d.tail, chord: [d.tail.chord, d.tail.chord], twist: 0, tail: true }];

describe('R22 exterior rotor surfaces', () => {
  it.each(rotors)('closes the blade ends and faces the airfoil skin outward (tail=$tail)', spec => {
    const g = rotorBladeGeometry({ ...spec, twist: 0 });
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    let volume = 0, upper = 0, tipThickness = 0;
    const index = g.index!;
    for (let i = 0; i < index.count; i += 3) {
      a.fromBufferAttribute(p, index.getX(i)); b.fromBufferAttribute(p, index.getX(i + 1)); c.fromBufferAttribute(p, index.getX(i + 2));
      volume += a.dot(b.cross(c)) / 6;
    }
    // An inverted closed mesh has negative signed volume, even when DoubleSide conceals the error.
    expect(volume).toBeGreaterThan(0);
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > spec.chord[0] * 0.035 && Math.abs(n.getX(i)) < 0.5) {
        expect(n.getY(i)).toBeGreaterThan(0); upper++;
      }
      if (Math.abs(p.getX(i) - spec.radius) < 1e-6) tipThickness = Math.max(tipThickness, Math.abs(p.getY(i)) * 2);
    }
    expect(upper).toBeGreaterThan(20);
    expect(tipThickness).toBeGreaterThan(spec.chord[1] * 0.10);
    // End caps have normals along the span, independently of the upper/lower skin normals.
    expect(Array.from({ length: p.count }, (_, i) => Math.abs(p.getX(i) - spec.radius) < 1e-6 && n.getX(i) > 0.99).some(Boolean)).toBe(true);
    expect(Array.from({ length: p.count }, (_, i) => Math.abs(p.getX(i) - spec.root) < 1e-6 && n.getX(i) < -0.99).some(Boolean)).toBe(true);
    g.dispose();
  });

  it('preserves the POH main-blade twist and constant tail-blade twist', () => {
    for (const spec of rotors) {
      const g = rotorBladeGeometry(spec), p = g.getAttribute('position');
      const section = (r: number): number => {
        let min = new THREE.Vector3(0, 0, Infinity), max = new THREE.Vector3(0, 0, -Infinity);
        for (let i = 0; i < p.count; i++) {
          if (Math.abs(p.getX(i) - r) > 1e-6) continue;
          if (p.getZ(i) < min.z) min.fromBufferAttribute(p, i);
          if (p.getZ(i) > max.z) max.fromBufferAttribute(p, i);
        }
        return Math.atan2((spec.tail ? -1 : 1) * (min.y - max.y), max.z - min.z);
      };
      expect(section(spec.radius) - section(spec.root)).toBeCloseTo(spec.twist, 4);
      g.dispose();
    }
  });
});
