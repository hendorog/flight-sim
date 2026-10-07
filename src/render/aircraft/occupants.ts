// Seated figures for the external views of a cockpit that is seen from outside (a bubble canopy over empty
// seats reads as an abandoned aircraft). One low-polygon figure per entry of CockpitDef.occupants: about 300
// flat-shaded triangles, no face, hands in the lap. They are hidden in the cockpit view.

import * as THREE from 'three';
import type { CockpitDef } from './airframe/types';
import { frd, MeshBatch } from './geometry';

/** A tapered six-sided limb between two model-space points. */
function limb(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, sides = 6): THREE.BufferGeometry {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r1, r0, d.length(), sides);
  g.translate(0, d.length() / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}

export interface Occupants {
  /** All the figures (two meshes: clothes and skin). */
  group: THREE.Group;
  materials: THREE.MeshStandardMaterial[];
}

/**
 * The figures of a cockpit definition, sitting on the seats its `occupants` name (a bench seats its figure in the
 * left place). Null when it has none.
 */
export function buildOccupants(def: CockpitDef): Occupants | null {
  const list = def.occupants ?? [];
  if (list.length === 0) return null;
  const clothes = new THREE.MeshStandardMaterial({ name: 'occupantClothes', color: new THREE.Color().setRGB(0.07, 0.09, 0.13), roughness: 0.9, flatShading: true });
  const skin = new THREE.MeshStandardMaterial({ name: 'occupantSkin', color: new THREE.Color().setRGB(0.42, 0.29, 0.22), roughness: 0.8, flatShading: true });
  const batch = new MeshBatch();
  for (const o of list) {
    const seat = def.seats[o.seat];
    if (!seat) throw new Error(`occupants: the cockpit has no seat ${o.seat}`);
    const y = seat.kind === 'bench' ? seat.y - seat.width / 4 : seat.y;
    const top = seat.z ?? def.floor.z - 0.265;
    const recline = ((seat.reclineDeg ?? 12) * Math.PI) / 180;
    // Hip point on the cushion ahead of the seat back; the spine leans back with the seat.
    const hip = frd(seat.x - seat.depth + 0.14, y, top - 0.1);
    const up = new THREE.Vector3(0, Math.cos(recline), Math.sin(recline));
    const at = (along: number, side = 0, fwd = 0): THREE.Vector3 => hip.clone().addScaledVector(up, along).add(new THREE.Vector3(side, 0, -fwd));
    const shoulder = 0.5;
    batch.add(clothes, limb(at(-0.05), at(shoulder), 0.15, 0.17, 8));
    batch.add(skin, limb(at(shoulder), at(shoulder + 0.08), 0.05, 0.05));
    batch.add(skin, new THREE.IcosahedronGeometry(0.105, 1).translate(...at(shoulder + 0.17, 0, 0.02).toArray()));
    for (const s of [-1, 1]) {
      // Thigh along the cushion to the knee, shin down to the floor ahead of the seat.
      const knee = frd(seat.x + 0.06, y + s * 0.1, top - 0.14);
      const foot = frd(seat.x + 0.34, y + s * 0.11, def.floor.z - 0.05);
      batch.add(clothes, limb(at(0, s * 0.09), knee, 0.085, 0.065));
      batch.add(clothes, limb(knee, foot, 0.06, 0.045));
      // Upper arm down from the shoulder, forearm forward to the lap.
      const elbow = at(shoulder - 0.27, s * 0.22, 0.03);
      const hand = at(0.1, s * 0.1, 0.32);
      batch.add(clothes, limb(at(shoulder - 0.03, s * 0.19), elbow, 0.05, 0.042));
      batch.add(clothes, limb(elbow, hand, 0.042, 0.035));
    }
  }
  const group = batch.build('occupants', { cast: false, receive: true });
  return { group, materials: [clothes, skin] };
}
