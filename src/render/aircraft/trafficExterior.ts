// A circuit traffic aircraft's exterior (docs/atc.md): the type's own model, built from the same parts as the
// player's (AircraftVisual.ts) with its occupants, but without the cockpit, the cabin occlusion or the shadow proxies,
// and with no light sources of its own (the nav lights, strobes, beacon and landing light are drawn as their glows
// only: a spot or point light per aircraft would change every material's shader). The livery is baked in the
// livery worker with the aircraft's own registration and swapped in when it arrives. Animated each frame from the
// aircraft's flight model state and controls: surfaces, flaps, gear, propeller, lights.
//
// Model space as the player's: nose -Z, right wing +X, up +Y, metres, origin at the reference point.

import * as THREE from 'three';
import type { AircraftState, ControlInputs, WeatherSettings } from '../../core/types';
import type { SkyState } from '../../core/context';
import type { AirframeVisualDef } from './airframe/types';
import { buildFuselage, buildNacelles, createFuselageShapes, type FuselageParts, type FuselageShapes, type NacelleParts } from './fuselage';
import { LandingGear } from './gear';
import { AircraftLights } from './lights';
import type { ExteriorBakeRequest } from './liveryWorker';
import { applyFuselageTextureData, bakeFuselageData, placeholderFuselageTextures, type FuselageTextureData } from './livery';
import { AircraftMaterials } from './materials';
import { buildOccupants, type Occupants } from './occupants';
import { Propeller } from './propeller';
import { buildTail, type TailParts } from './tail';
import { buildWings, setFlap, type WingParts } from './wings';

/**
 * The fuselage of a type, lofted once and shared by all its traffic exteriors (the loft is most of an exterior's
 * build time): the shapes, and the meshes as first built with the materials they were built with.
 */
const FUSELAGES = new Map<string, { shapes: FuselageShapes; fus: FuselageParts; mat: AircraftMaterials }>();
/** Geometry owned by FUSELAGES, never disposed with an exterior. */
const SHARED_GEOMETRY = new WeakSet<THREE.BufferGeometry>();

/** The type's fuselage for a new exterior: the shared geometry, with this exterior's own materials. */
function fuselageFor(def: AirframeVisualDef, mat: AircraftMaterials): { shapes: FuselageShapes; fus: FuselageParts } {
  const cached = FUSELAGES.get(def.id);
  if (!cached) {
    const shapes = createFuselageShapes(def);
    const fus = buildFuselage(shapes, mat, def);
    for (const o of [fus.skin, fus.glass, fus.lining, fus.fittings]) {
      o.traverse((m) => {
        if ((m as THREE.Mesh).isMesh) SHARED_GEOMETRY.add((m as THREE.Mesh).geometry);
      });
    }
    FUSELAGES.set(def.id, { shapes, fus, mat });
    return { shapes, fus: cloneParts(fus, mat, mat) };
  }
  return { shapes: cached.shapes, fus: cloneParts(cached.fus, cached.mat, mat) };
}

/** Copies of the fuselage meshes (sharing the geometry) with each material swapped for `to`'s of the same role. */
function cloneParts(fus: FuselageParts, from: AircraftMaterials, to: AircraftMaterials): FuselageParts {
  const role = new Map<THREE.Material, THREE.Material>();
  for (const [k, v] of Object.entries(from)) if (v instanceof THREE.Material) role.set(v, (to as unknown as Record<string, THREE.Material>)[k]);
  const copy = <T extends THREE.Object3D>(o: T): T => {
    const c = o.clone(true);
    c.traverse((m) => {
      const mesh = m as THREE.Mesh;
      if (mesh.isMesh && !Array.isArray(mesh.material)) mesh.material = role.get(mesh.material) ?? mesh.material;
    });
    return c;
  };
  return { skin: copy(fus.skin), glass: copy(fus.glass), lining: copy(fus.lining), fittings: copy(fus.fittings) };
}

export class TrafficExterior {
  readonly root = new THREE.Group();
  private readonly materials: AircraftMaterials;
  private readonly wings: WingParts;
  private readonly tail: TailParts;
  private readonly gear: LandingGear;
  private readonly propellers: Propeller[];
  private readonly nacelles: NacelleParts | null = null;
  private readonly lights: AircraftLights;
  private readonly occupants: Occupants | null;
  private readonly textures: ReturnType<typeof placeholderFuselageTextures>;
  private disposed = false;
  /** Bumped by every bake asked for: a late answer for an earlier registration is dropped. */
  private bakeId = 0;
  /** The registration painted on (or being baked). */
  registration: string;
  /** Settles once the livery asked for last is on (or could not be baked). */
  baked: Promise<void> = Promise.resolve();

  /** @param opts.crew false: no one aboard (a parked aircraft's model, trafficModel.ts) */
  constructor(private readonly def: AirframeVisualDef, registration: string, opts: { crew?: boolean } = {}) {
    this.registration = registration;
    this.root.name = `traffic-${def.id}`;
    const textures = (this.textures = placeholderFuselageTextures(def.livery.palette.base));
    const mat = (this.materials = new AircraftMaterials(textures, def, true));
    const { shapes, fus } = fuselageFor(def, mat);
    // The lining closes the cabin behind the glass (there is no interior to see).
    this.root.add(fus.skin, fus.glass, fus.fittings, fus.lining);
    this.wings = buildWings(mat, this.root, def.wing, shapes.outer);
    this.tail = buildTail(mat, this.root, def.tail, shapes.outer);
    this.gear = new LandingGear(mat, true, def.gear);
    this.root.add(this.gear.group);
    this.propellers = def.props.map((p, i) => new Propeller(mat, p, i > 0));
    for (const p of this.propellers) this.root.add(p.group);
    if (def.nacelles.length > 0 || (def.fairings?.length ?? 0) > 0) {
      this.nacelles = buildNacelles(mat, this.root, def.nacelles, def.fairings);
      this.root.add(this.nacelles.group);
    }
    this.lights = new AircraftLights(false, 1, this.tail.rudder.object, def.lamps, this.gear.noseMount, def.nominalVoltage ?? 28);
    const sources: THREE.Light[] = [];
    this.lights.group.traverse((o) => {
      if ((o as THREE.Light).isLight) sources.push(o as THREE.Light);
    });
    for (const l of sources) l.removeFromParent();
    this.root.add(this.lights.group);
    // The crew, seen through the windows (or a canopy).
    this.occupants = opts.crew === false ? null : buildOccupants(def.cockpit);
    if (this.occupants) this.root.add(this.occupants.group);
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.bake(registration);
  }

  /** Repaint with another registration (an exterior handed on to another aircraft of the type). */
  setRegistration(registration: string): void {
    if (registration === this.registration) return;
    this.registration = registration;
    this.bake(registration);
  }

  /** The livery with this registration, off the main thread (on it if no worker can be started). */
  private bake(registration: string): void {
    const id = ++this.bakeId;
    let done!: () => void;
    this.baked = new Promise<void>((res) => (done = res));
    const apply = (d: FuselageTextureData): void => {
      if (!this.disposed && id === this.bakeId) applyFuselageTextureData(this.textures, d);
      done();
    };
    const inline = (): void => {
      try {
        const def = { ...this.def, livery: { ...this.def.livery, registration } };
        const shapes = createFuselageShapes(def);
        apply(bakeFuselageData(shapes.outer, shapes.glass, shapes.lining, def));
      } catch (e) {
        console.warn(`[traffic] no ${this.def.id} livery:`, e);
        done();
      }
    };
    if (typeof Worker === 'undefined') return inline();
    try {
      const worker = new Worker(new URL('./liveryWorker.ts', import.meta.url), { type: 'module', name: 'traffic-livery' });
      worker.onmessage = (e: MessageEvent<{ textures?: FuselageTextureData; error?: string }>) => {
        worker.terminate();
        if (e.data.textures) apply(e.data.textures);
        else inline();
      };
      worker.onerror = (e) => {
        worker.terminate();
        e.preventDefault();
        inline();
      };
      const request: ExteriorBakeRequest = { exterior: true, airframeId: this.def.id, registration };
      worker.postMessage(request);
    } catch {
      inline();
    }
  }

  /** Pose the moving parts and the lights from the flight model. */
  update(time: number, st: AircraftState, controls: ControlInputs, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer, sky: SkyState, weather: WeatherSettings): void {
    const s = st.surfaces;
    for (const surface of this.wings.surfaces) {
      if (surface.kind === 'flap') setFlap(surface.hinge, s.flaps, this.def.wing.flap);
      else surface.hinge.setAngle(surface.side < 0 ? s.aileronLeft : s.aileronRight);
    }
    this.tail.elevators[0].setAngle(s.elevator);
    this.tail.elevators[1].setAngle(s.elevator);
    for (const tab of this.tail.tabs) tab.setAngle(this.tail.tabGearing * s.elevator + s.elevatorTrim);
    this.tail.rudder.setAngle(s.rudder);
    this.tail.rudderTab?.setAngle(s.rudderTrim);
    this.gear.update(st.wheels, st.gear.extension);
    for (let i = 0; i < this.propellers.length; i++) {
      const p = st.propellers[i];
      if (p) this.propellers[i].update(p.rotation, p.rpm, p.bladePitch);
      else this.propellers[i].update(0, 0);
    }
    this.lights.update(time, st, controls, this.root, camera, renderer, sky, weather);
    this.materials.setSun(sky.sunDir, sky.sunColor);
  }

  /** Free the geometry this exterior owns (its fuselage's is the type's, shared); the materials stay. */
  releaseGeometry(): void {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !SHARED_GEOMETRY.has(m.geometry)) m.geometry.dispose();
    });
  }

  dispose(): void {
    this.disposed = true;
    this.root.removeFromParent();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !SHARED_GEOMETRY.has(m.geometry)) m.geometry.dispose();
    });
    for (const p of this.propellers) p.dispose();
    this.lights.dispose();
    for (const m of this.occupants?.materials ?? []) m.dispose();
    this.materials.dispose();
  }
}
