// Parked general-aviation aircraft and apron vehicles. The aircraft are the AI traffic's own types (Cessna 172S and
// 152, Piper Tomahawk, Diamond DA20), each its real exterior as a static model (render/aircraft/trafficModel.ts):
// instanced per material up close and as the type's far model beyond PARKED_DETAIL, chosen per aircraft from the
// camera's distance (ParkedAircraft.update). Built asynchronously; the vehicles at once.

import * as THREE from 'three';
import type { AircraftId } from '../../core/types';
import { loadAirframeVisual } from '../../aircraft/visualLoader';
import { trafficModel, type ModelPart } from '../../render/aircraft/trafficModel';
import { boxGeo, cylGeo, GeometryBatch, placement } from './geom';
import { BUILDINGS, FUEL_ISLAND, nedToLocal, PARKING, PARKING_SPOTS, type ParkingSpot } from './layout';
import { rng } from './noise';
import type { MaterialSet } from './materials';
import { TAXIWAY_HEIGHT } from './pavement';

export interface ApronProps {
  meshes: THREE.Object3D[];
}

/** The seed of the parked aircraft's choices (createProps and staticParkedSpots must draw the same stream). */
const PARKED_SEED = 172;

/** The spots createProps parks an aircraft on: the same draws, replayed (the AI traffic parks on the others). */
export function staticParkedSpots(): ReadonlySet<string> {
  const r = rng(PARKED_SEED);
  const player = nedToLocal(PARKING.north, PARKING.east);
  const taken = new Set<string>();
  for (const s of PARKING_SPOTS) {
    if (Math.hypot(s.u - player.u, s.v - player.v) < 1) continue;
    if (r() > 0.55) continue;
    taken.add(s.name);
    r(); r(); r(); r();
  }
  return taken;
}

/** Apron vehicles: a fuel truck and a tug (the parked aircraft are ParkedAircraft). */
export function createProps(mats: MaterialSet): ApronProps {
  return { meshes: vehicles(mats) };
}

/** A parked aircraft: its spot, type and heading (local apron frame: nose toward -z at rotY 0). */
export interface ParkedPlacement {
  spot: ParkingSpot;
  type: AircraftId;
  rotY: number;
}

/**
 * The parked aircraft, on about half the apron spots (never the player's), and their types: a high wing (Cessna
 * 172S or 152) or, one in three, a low wing (Tomahawk or DA20). The draws are staticParkedSpots' stream.
 */
export function parkedPlacements(): ParkedPlacement[] {
  const r = rng(PARKED_SEED);
  const player = nedToLocal(PARKING.north, PARKING.east);
  const out: ParkedPlacement[] = [];
  for (const s of PARKING_SPOTS) {
    if (Math.hypot(s.u - player.u, s.v - player.v) < 1) continue;
    if (r() > 0.55) continue;
    const rot = s.facing > 0 ? -Math.PI / 2 : Math.PI / 2;
    const jitter = (r() - 0.5) * 0.08;
    const low = r() < 0.35;
    const which = r() < 0.5;
    r();
    out.push({ spot: s, type: low ? (which ? 'pa38' : 'da20') : which ? 'c172s' : 'c152', rotY: rot + jitter });
  }
  return out;
}

/** Parked aircraft are drawn in full detail within this distance of the camera (scaled by its zoom), m. */
const PARKED_DETAIL = 220;
const TAN_30 = Math.tan(Math.PI / 6);

/** One type's parked aircraft: an instanced mesh per material of its near model, and one of its far model. */
interface ParkedType {
  matrices: THREE.Matrix4[];
  centres: THREE.Vector3[];
  near: THREE.InstancedMesh[];
  far: THREE.InstancedMesh;
  /** Which are drawn in full detail now ('1' per such aircraft), so the instances are only rewritten on a change. */
  split: string;
}

/** The parked aircraft (in the apron's local frame; their models are built asynchronously). */
export class ParkedAircraft {
  readonly group = new THREE.Group();
  private readonly types: ParkedType[] = [];
  private readonly local = new THREE.Vector3();
  private disposed = false;

  constructor(placements: readonly ParkedPlacement[] = parkedPlacements()) {
    this.group.name = 'parked-aircraft';
    const byType = new Map<AircraftId, ParkedPlacement[]>();
    for (const p of placements) byType.set(p.type, [...(byType.get(p.type) ?? []), p]);
    for (const [type, list] of byType) void this.build(type, list);
  }

  private async build(type: AircraftId, list: readonly ParkedPlacement[]): Promise<void> {
    try {
      const model = await trafficModel(await loadAirframeVisual(type));
      if (this.disposed) return;
      const matrices = list.map((p) => placement(p.spot.v, model.restHeight + TAXIWAY_HEIGHT, -p.spot.u, p.rotY));
      const centres = matrices.map((m) => new THREE.Vector3().setFromMatrixPosition(m));
      const instanced = (part: ModelPart, material: THREE.Material, name: string) => {
        const im = new THREE.InstancedMesh(part.geometry, material, list.length);
        im.name = name;
        im.castShadow = im.receiveShadow = true;
        im.count = 0;
        this.group.add(im);
        return im;
      };
      // The far model's material is the traffic's (plain meshes): instanced draws get their own copy.
      const far = instanced(model.far[0], model.far[0].material.clone(), `parked-${type}-far`);
      const near = model.near.map((p) => instanced(p, p.material, `parked-${type}-${p.material.name || 'part'}`));
      this.types.push({ matrices, centres, near, far, split: '' });
    } catch (e) {
      console.warn(`[airport] no parked ${type}:`, e);
    }
  }

  /** Each aircraft in full detail or as its far model for the camera's distance. */
  update(camera: THREE.PerspectiveCamera): void {
    this.group.updateWorldMatrix(true, false);
    const cam = this.group.worldToLocal(camera.getWorldPosition(this.local));
    const zoom = Math.tan((camera.fov * Math.PI) / 360) / camera.zoom / TAN_30;
    for (const t of this.types) {
      const split = t.centres.map((c) => (c.distanceTo(cam) * zoom < PARKED_DETAIL ? '1' : '0')).join('');
      if (split === t.split) continue;
      t.split = split;
      let n = 0;
      let f = 0;
      for (let i = 0; i < t.matrices.length; i++) {
        if (split[i] === '1') {
          for (const im of t.near) im.setMatrixAt(n, t.matrices[i]);
          n++;
        } else t.far.setMatrixAt(f++, t.matrices[i]);
      }
      for (const im of [...t.near, t.far]) {
        im.count = im === t.far ? f : n;
        im.instanceMatrix.needsUpdate = true;
        // Culled by the sphere round the instances drawn.
        im.computeBoundingSphere();
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const t of this.types) {
      for (const im of [...t.near, t.far]) im.dispose();
      (t.far.material as THREE.Material).dispose();
    }
    this.group.removeFromParent();
  }
}

/** Fuel truck by the fuel island and a tow tug by hangar 1. */
function vehicles(mats: MaterialSet): THREE.Mesh[] {
  const paint = new GeometryBatch(), dark = new GeometryBatch();
  // Fuel truck: cab + tank, nose toward +u, parked beside the island.
  const tu = FUEL_ISLAND.u - 1, tv = FUEL_ISLAND.v + 4;
  const tr = placement(tv, TAXIWAY_HEIGHT, -tu, Math.PI);
  const t = (x: number, y: number, z: number, g: THREE.BufferGeometry, color: number, target = paint, rz = 0, rx = 0) =>
    target.add(g, tr.clone().multiply(placement(x, y, z, 0, rx, rz)), color);
  t(0, 1.4, 3.2, boxGeo(2.3, 2.0, 2.0), 0xe8e8e4);
  t(0, 1.8, 2.3, boxGeo(2.2, 0.9, 0.1), 0x20262c, dark);
  t(0, 0.75, -1.0, boxGeo(2.2, 0.35, 7.0), 0x303030, dark);
  t(0, 1.9, -1.4, cylGeo(1.05, 1.05, 5.6, 18), 0x1f4f9f, paint, 0, Math.PI / 2);
  for (const z of [3.1, -0.6, -2.8]) for (const x of [-1.05, 1.05]) t(x, 0.5, z, cylGeo(0.5, 0.5, 0.35, 14), 0x151515, dark, Math.PI / 2);
  // Tug in front of hangar 1.
  const h1 = BUILDINGS.find((b) => b.name === 'Hangar 1')!;
  const gu = (h1.u0 + h1.u1) / 2 + 9, gv = h1.v1 + 6;
  paint.add(boxGeo(1.4, 0.7, 2.2), placement(gv, TAXIWAY_HEIGHT + 0.6, -gu, 0.4), 0xd0a020);
  paint.add(boxGeo(1.0, 0.8, 0.8), placement(gv, TAXIWAY_HEIGHT + 1.3, -gu + 0.3, 0.4), 0x303030);
  for (const [x, z] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) {
    const c = Math.cos(0.4), s = Math.sin(0.4);
    dark.add(cylGeo(0.3, 0.3, 0.25, 12), placement(gv + x * c + z * s, TAXIWAY_HEIGHT + 0.3, -gu - x * s + z * c, 0.4, 0, Math.PI / 2), 0x151515);
  }
  const out = [new THREE.Mesh(paint.build(), mats.paint), new THREE.Mesh(dark.build(), mats.rubber)];
  for (const m of out) m.castShadow = m.receiveShadow = true;
  return out;
}
