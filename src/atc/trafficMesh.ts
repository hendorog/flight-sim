// The circuit traffic's stand-in model (docs/atc.md, step 3): a light aircraft from a dozen boxes, high-winged for a
// Cessna and low-winged for a Piper, with a propeller disc and its navigation lights, beacon and strobes. A proper
// exterior replaces it later. Model space as the player's aircraft (render/aircraft/AircraftVisual.ts): nose -Z,
// right wing +X, up +Y, metres; the origin is where the main wheels touch the ground.

import * as THREE from 'three';

export type TrafficType = 'C152' | 'C172' | 'PA28';

export interface TrafficMesh {
  root: THREE.Group;
  /** Show the anti-collision lights for this sim time, s (the beacon and the wingtip strobes flash). */
  flash(t: number): void;
}

const SIZES: Record<TrafficType, { span: number; length: number; highWing: boolean }> = {
  C152: { span: 10.1, length: 7.3, highWing: true },
  C172: { span: 11.0, length: 8.3, highWing: true },
  PA28: { span: 10.7, length: 7.3, highWing: false },
};

function box(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function lights(points: [number, number, number][], color: number, size: number): THREE.Points {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ color, size, sizeAttenuation: false, toneMapped: false, depthWrite: false }));
  p.frustumCulled = false;
  return p;
}

/** Build one aircraft: white with a coloured fin and cheat line. */
export function buildTrafficMesh(type: TrafficType, trim: number): TrafficMesh {
  const { span, length, highWing } = SIZES[type];
  const white = new THREE.MeshStandardMaterial({ color: 0xf1f1ee, roughness: 0.45, metalness: 0.05 });
  const colour = new THREE.MeshStandardMaterial({ color: trim, roughness: 0.5, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.7 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x24303a, roughness: 0.15, metalness: 0.3 });
  const root = new THREE.Group();
  root.name = `traffic-${type}`;
  const nose = -length * 0.36;
  const tail = length * 0.6;
  const body = 1.35;
  // Cabin and engine, then the tail cone to the fin.
  root.add(box(white, 1.1, 1.25, length * 0.5, 0, body, nose + length * 0.25));
  root.add(box(glass, 1.12, 0.5, 1.2, 0, body + 0.38, nose + 1.7));
  root.add(box(colour, 1.13, 0.12, length * 0.5, 0, body - 0.15, nose + length * 0.25));
  root.add(box(white, 0.55, 0.65, length * 0.5, 0, body + 0.15, nose + length * 0.75));
  const wingY = highWing ? body + 0.7 : body - 0.6;
  root.add(box(white, span, 0.14, 1.5, 0, wingY, nose + 2.0));
  // Tailplane and fin.
  root.add(box(white, 3.4, 0.08, 0.9, 0, body + 0.25, tail - 0.4));
  root.add(box(colour, 0.08, 1.4, 1.1, 0, body + 0.95, tail - 0.5));
  // Gear: the mains under the wing's leading edge region, the nose wheel ahead.
  root.add(box(dark, 0.18, 0.55, 0.55, -1.2, 0.28, nose + 2.4));
  root.add(box(dark, 0.18, 0.55, 0.55, 1.2, 0.28, nose + 2.4));
  root.add(box(dark, 0.16, 0.45, 0.45, 0, 0.23, nose + 0.5));
  // The propeller disc.
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.95, 20), new THREE.MeshBasicMaterial({ color: 0x404040, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
  disc.position.set(0, body, nose - 0.05);
  root.add(disc);
  // Navigation lights: red left tip, green right tip, white tail; strobes on the tips, beacon on the fin.
  const tip = span / 2;
  root.add(lights([[-tip, wingY, nose + 2.0]], 0xff2a1a, 3));
  root.add(lights([[tip, wingY, nose + 2.0]], 0x20ff50, 3));
  root.add(lights([[0, body + 0.4, tail]], 0xffffff, 2.5));
  const strobes = lights([[-tip, wingY, nose + 2.1], [tip, wingY, nose + 2.1]], 0xffffff, 5);
  const beacon = lights([[0, body + 1.7, tail - 0.4]], 0xff3020, 4);
  root.add(strobes, beacon);
  return {
    root,
    flash(t: number): void {
      const s = t % 1.2;
      strobes.visible = s < 0.06 || (s > 0.16 && s < 0.22);
      beacon.visible = (t + 0.5) % 1.0 < 0.12;
    },
  };
}
