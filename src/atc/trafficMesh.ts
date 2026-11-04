// A circuit aircraft drawn small (docs/atc.md, step 3): its type's far model (render/aircraft/trafficModel.ts: the
// real exterior reduced to a few thousand vertex-coloured triangles, shared by every aircraft of the type) with
// its navigation lights, beacon and strobes as points at the type's own lamp positions. Drawn when the aircraft
// is a few pixels across, and whenever its own exterior (render/aircraft/trafficExterior.ts) is not drawn; empty
// until the model has been built. Model space as the player's aircraft (render/aircraft/AircraftVisual.ts):
// nose -Z, right wing +X, up +Y, metres, origin at the reference point.

import * as THREE from 'three';
import type { TrafficModel } from '../render/aircraft/trafficModel';

export type TrafficType = 'C152' | 'C172' | 'PA38' | 'DA20';

export interface TrafficMesh {
  root: THREE.Group;
  /** The model is in (it is built asynchronously). */
  readonly ready: boolean;
  /** Put the type's model in. */
  attach(model: TrafficModel): void;
  /** Show the anti-collision lights for this sim time, s (the beacon and the wingtip strobes flash), when `on`. */
  flash(t: number, on: boolean): void;
  /** Free what is this aircraft's own (the model's geometry and material are shared). */
  dispose(): void;
}

function lights(points: THREE.Vector3[], color: number, size: number): THREE.Points {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points.flatMap((p) => [p.x, p.y, p.z]), 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ color, size, sizeAttenuation: false, toneMapped: false, depthWrite: false }));
  p.frustumCulled = false;
  return p;
}

/** An aircraft's far model and lights (empty until attach). */
export function buildTrafficMesh(type: TrafficType): TrafficMesh {
  const root = new THREE.Group();
  root.name = `traffic-${type}`;
  let strobes: THREE.Points | null = null;
  let beacon: THREE.Points | null = null;
  let steady: THREE.Points[] = [];
  let ready = false;
  return {
    root,
    get ready() {
      return ready;
    },
    attach(model: TrafficModel): void {
      if (ready) return;
      ready = true;
      for (const part of model.far) {
        const m = new THREE.Mesh(part.geometry, part.material);
        m.name = 'trafficFar';
        root.add(m);
      }
      const L = model.lamps;
      const at = (...ids: (keyof TrafficModel['lamps'])[]) => ids.map((id) => L[id]).filter((p): p is THREE.Vector3 => !!p);
      steady = [lights(at('navL'), 0xff2a1a, 3), lights(at('navR'), 0x20ff50, 3), lights(at('navTail'), 0xffffff, 2.5)];
      strobes = lights(at('strobeL', 'strobeR'), 0xffffff, 5);
      beacon = lights(at('beacon'), 0xff3020, 4);
      root.add(...steady, strobes, beacon);
    },
    flash(t: number, on: boolean): void {
      if (!strobes || !beacon) return;
      for (const s of steady) s.visible = on;
      const s = t % 1.2;
      strobes.visible = on && (s < 0.06 || (s > 0.16 && s < 0.22));
      beacon.visible = on && (t + 0.5) % 1.0 < 0.12;
    },
    dispose(): void {
      root.traverse((o) => {
        if (o instanceof THREE.Points) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      root.removeFromParent();
    },
  };
}
