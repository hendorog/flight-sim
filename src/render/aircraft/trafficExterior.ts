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
import { buildFuselage, buildNacelles, createFuselageShapes, type NacelleParts } from './fuselage';
import { LandingGear } from './gear';
import { AircraftLights } from './lights';
import type { ExteriorBakeRequest } from './liveryWorker';
import { applyFuselageTextureData, bakeFuselageData, placeholderFuselageTextures, type FuselageTextureData } from './livery';
import { AircraftMaterials } from './materials';
import { buildOccupants, type Occupants } from './occupants';
import { Propeller } from './propeller';
import { buildTail, type TailParts } from './tail';
import { buildWings, setFlap, type WingParts } from './wings';

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
  private disposed = false;

  constructor(private readonly def: AirframeVisualDef, registration: string) {
    this.root.name = `traffic-${def.id}`;
    const shapes = createFuselageShapes(def);
    const textures = placeholderFuselageTextures(def.livery.palette.base);
    const mat = (this.materials = new AircraftMaterials(textures, def));
    const fus = buildFuselage(shapes, mat, def);
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
    this.occupants = buildOccupants(def.cockpit);
    if (this.occupants) this.root.add(this.occupants.group);
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.bake(registration, textures);
  }

  /** The livery with this registration, off the main thread (on it if no worker can be started). */
  private bake(registration: string, textures: ReturnType<typeof placeholderFuselageTextures>): void {
    const apply = (d: FuselageTextureData): void => {
      if (!this.disposed) applyFuselageTextureData(textures, d);
    };
    const inline = (): void => {
      const def = { ...this.def, livery: { ...this.def.livery, registration } };
      const shapes = createFuselageShapes(def);
      apply(bakeFuselageData(shapes.outer, shapes.glass, shapes.lining, def));
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

  dispose(): void {
    this.disposed = true;
    this.root.removeFromParent();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    for (const p of this.propellers) p.dispose();
    this.lights.dispose();
    for (const m of this.occupants?.materials ?? []) m.dispose();
    this.materials.dispose();
  }
}
