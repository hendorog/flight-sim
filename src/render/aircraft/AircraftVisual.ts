// The aircraft's 3D model - exterior and cockpit interior - as a Subsystem. Everything is built procedurally
// at init from an airframe definition (AirframeVisualDef: aircraft/<id>/visual.ts; default the Cessna 172S,
// whose shared geometry comes from core/c172.ts) and animated every frame from ctx.state and ctx.controls.
//
// Model space (children of ctx.aircraftRoot): origin at the type's reference point, nose toward -Z,
// right wing +X, up +Y, metres. Body (FRD) coordinates (x, y, z) map to (y, -z, -x).
//
// Budget: ~200k triangles in ~100 meshes plus ~50k in the merged shadow proxies; the cabin interior
// (~77k triangles: moulded trim, pleated seats) is culled beyond interiorLodDistance unless the camera is in
// cockpit mode. A twin (two nacelles and propellers, retracting gear with doors) stays within 30 draw calls
// and 60 000 triangles of that.
//
// Also owned here: the ground contact shadow (groundShadow.ts, a quad added to ctx.scene under the
// aircraft), the cabin occlusion (cabinLight.ts) and the lights with their glow sprites (lights.ts).
// init() takes ~0.1 s on the main thread; the livery textures and the cabin occlusion are baked in a
// worker (liveryWorker.ts) and swapped in about a second later (see `textureBake`).

import * as THREE from 'three';
import { RotorcraftVisual } from './RotorcraftVisual';
import { C172S_PANEL } from '../../aircraft/c172s/panel';
import { C172S_VISUAL } from '../../aircraft/c172s/visual';
import type { QualityLevel, SimContext, Subsystem } from '../../core/context';
import type { PanelDef } from '../../instruments/panelDef';
import type { AirframeVisualDef } from './airframe/types';
import { CabinBake, cabinLamps, patchCabinMaterial, updateCabinBounce } from './cabinLight';
import { Cockpit } from './cockpit';
import { buildFuselage, buildNacelles, cabinFloorGeometry, createFuselageShapes, type FuselageParts, type NacelleParts } from './fuselage';
import { LandingGear } from './gear';
import { GroundShadow } from './groundShadow';
import { frd } from './geometry';
import { AircraftLights } from './lights';
import type { AircraftBakeRequest, AircraftBakeResult } from './liveryWorker';
import { applyFuselageTextureData, bakeFuselageData, bakeFuselageTextures, placeholderFuselageTextures, type FuselageTextures } from './livery';
import { AircraftMaterials } from './materials';
import { buildOccupants, type Occupants } from './occupants';
import { Propeller } from './propeller';
import { buildShadowProxies } from './shadowProxy';
import { buildTail, type TailParts } from './tail';
import { buildWings, setFlap, type WingParts } from './wings';

export interface AircraftVisualOptions {
  /** Fit wheel fairings (speed pants). Default true. */
  wheelFairings?: boolean;
  /**
   * Multiplier on the exterior light sources (landing/taxi spot lights, strobe and beacon point lights).
   * Their intensities are candela x SCENE_UNITS_PER_LUX (the photometric scale); this is an extra artistic
   * multiplier on top. Default 1.
   */
  lightScale?: number;
  /** Multiplier on the instrument panel's self-illumination. Default 1. */
  panelEmissiveScale?: number;
  /**
   * Beyond this camera distance (m) the cabin interior is hidden, unless in cockpit view. Default 60. Under a
   * canopy (CockpitDef.enclosure) the interior is in plain view, so it is its projected size that counts: the
   * distance is taken at a 60 degree field of view, and a camera zoomed in to 4 degrees still sees the interior
   * at fifteen times that.
   */
  interiorLodDistance?: number;
  /**
   * Bake the fuselage livery textures and the cabin occlusion in a Web Worker (default true): init()
   * returns at once with placeholders (plain white skin, closed windows, uniform cabin occlusion) that are
   * swapped for the baked data about a second later; `textureBake` resolves then. With false the ~1 s
   * bake runs synchronously in init().
   */
  asyncBake?: boolean;
  /**
   * The airframe to build (AircraftPresentation.visual). Default: the Cessna 172S. With asyncBake the worker
   * loads the definition again by its id (aircraft/visualLoader.ts), so it must be a registered type's.
   */
  airframe?: AirframeVisualDef;
  /**
   * The instrument panel shown on the cockpit's panel face (AircraftPresentation.panel): its round gauges are
   * recessed into the face, its rocker switches, key and dimmer knobs stand on it. Default: the Cessna 172S panel.
   */
  panelDef?: PanelDef;
}

/**
 * Whether the cabin interior is large enough on screen to be drawn: it is while the camera is nearer than
 * `lodDistance` at a 60 degree vertical field of view, and at the distance of the same projected size when
 * the camera is zoomed (distance x tan(fov / 2) / tan(30 deg) < lodDistance).
 */
export function interiorInView(distance: number, fovDeg: number, lodDistance: number): boolean {
  if (fovDeg === 60) return distance < lodDistance;
  return (distance * Math.tan((fovDeg * Math.PI) / 360)) / Math.tan(Math.PI / 6) < lodDistance;
}

export class AircraftVisual implements Subsystem {
  /** Everything of the aircraft; added to ctx.aircraftRoot by init(). */
  readonly root = new THREE.Group();
  /** Pilot eye point (left seat) in model space (child space of ctx.aircraftRoot). */
  readonly pilotEye: THREE.Vector3;

  private readonly opts: Required<AircraftVisualOptions>;
  /** The airframe this is the model of. */
  private readonly def: AirframeVisualDef;
  private helicopter: RotorcraftVisual | null = null;
  private materials!: AircraftMaterials;
  private fuselage!: FuselageParts;
  private wings!: WingParts;
  private tail!: TailParts;
  private gear!: LandingGear;
  /** One per engine, in the order of AircraftState.propellers. */
  private propellers: Propeller[] = [];
  private nacelles: NacelleParts | null = null;
  private lights!: AircraftLights;
  private cockpit!: Cockpit;
  private occupants: Occupants | null = null;
  private readonly contactShadow: GroundShadow;
  private pendingPanel: THREE.Texture | null = null;
  private pendingPanelEmissive: THREE.Texture | null = null;
  private readonly camLocal = new THREE.Vector3();
  private readonly rootQuat = new THREE.Quaternion();
  private readonly lampFlux = new THREE.Color();

  constructor(options: AircraftVisualOptions = {}) {
    this.opts = {
      wheelFairings: options.wheelFairings ?? true,
      lightScale: options.lightScale ?? 1,
      panelEmissiveScale: options.panelEmissiveScale ?? 1,
      interiorLodDistance: options.interiorLodDistance ?? 60,
      asyncBake: options.asyncBake ?? true,
      airframe: options.airframe ?? C172S_VISUAL,
      panelDef: options.panelDef ?? C172S_PANEL,
    };
    const def = (this.def = this.opts.airframe);
    this.root.name = def.id === 'c172s' ? 'C172' : def.id;
    const eye = def.cockpit.pilotEye;
    this.pilotEye = frd(eye[0], eye[1], eye[2]);
    this.contactShadow = new GroundShadow(def.shadow, def.gear);
  }

  init(ctx: SimContext): void {
    const def = this.def;
    if (def.rotorcraft) {
      this.helicopter = new RotorcraftVisual(def.rotorcraft);
      this.root.add(this.helicopter.root); ctx.aircraftRoot.add(this.root);
      if (this.pendingPanel) this.helicopter.panel.material.map = this.pendingPanel;
      if (this.pendingPanelEmissive) this.helicopter.panel.material.emissiveMap = this.pendingPanelEmissive;
      return;
    }
    const shapes = createFuselageShapes(def);
    const t0 = performance.now();
    const async = this.opts.asyncBake && typeof Worker !== 'undefined';
    const textures = async ? placeholderFuselageTextures(def.livery.palette.base) : bakeFuselageTextures(shapes.outer, shapes.glass, shapes.lining, def);
    const mat = (this.materials = new AircraftMaterials(textures, def));
    this.fuselage = buildFuselage(shapes, mat, def);
    this.root.add(this.fuselage.skin, this.fuselage.glass, this.fuselage.fittings);
    this.wings = buildWings(mat, this.root, def.wing, shapes.outer);
    this.tail = buildTail(mat, this.root, def.tail, shapes.outer);
    this.gear = new LandingGear(mat, this.opts.wheelFairings, def.gear);
    this.root.add(this.gear.group);
    // The blade materials' opacity follows the rpm: every propeller after the first has its own.
    this.propellers = def.props.map((p, i) => new Propeller(mat, p, i > 0));
    for (const p of this.propellers) this.root.add(p.group);
    if (def.nacelles.length > 0 || (def.fairings?.length ?? 0) > 0) {
      this.nacelles = buildNacelles(mat, this.root, def.nacelles, def.fairings);
      this.root.add(this.nacelles.group);
    }
    this.lights = new AircraftLights(ctx.quality !== 'low', this.opts.lightScale, this.tail.rudder.object, def.lamps, this.gear.noseMount);
    this.quality = ctx.quality;
    this.root.add(this.lights.group);
    const floor = def.cockpit.floor;
    this.cockpit = new Cockpit(mat, cabinFloorGeometry(shapes.lining, floor.z, floor.x0, floor.x1), shapes, def.cockpit, this.opts.panelDef);
    // The lining belongs to the interior so it is culled with it at a distance.
    this.cockpit.group.add(this.fuselage.lining);
    this.occupants = buildOccupants(def.cockpit);
    if (this.occupants) this.cockpit.group.add(this.occupants.group);
    this.root.add(this.cockpit.group);
    if (this.pendingPanelEmissive) this.cockpit.setPanelEmissiveTexture(this.pendingPanelEmissive);
    if (this.pendingPanel) this.cockpit.setPanelTexture(this.pendingPanel);
    const cabin = this.applyCabinOcclusion();
    this.buildShadowCasters();
    if (async) this.textureBake = this.bakeInWorker(textures, shapes, cabin);
    else cabin.bakeNow(def);
    ctx.aircraftRoot.add(this.root);
    ctx.scene.add(this.contactShadow.mesh);
    this.initMs = performance.now() - t0;
  }

  /** Shadow proxies of the cabin interior: they only cast while the camera is in the cockpit. */
  private readonly interiorCasters: THREE.Mesh[] = [];

  /**
   * Merge the shadow casters into one depth-only proxy per rigid part (shadowProxy.ts): ~65 casting meshes
   * become ~16, drawn into each cascade.
   */
  private buildShadowCasters(): void {
    const gear = this.gear.shadowRig();
    const cockpit = this.cockpit.shadowRig();
    const hinges = [...this.wings.surfaces.map((s) => s.hinge), ...this.tail.elevators, ...this.tail.tabs, this.tail.rudder];
    if (this.tail.rudderTab) hinges.push(this.tail.rudderTab);
    // Cowl flaps are small plates close under their nacelles: they do not cast.
    const cowlFlaps: THREE.Mesh[] = [];
    for (const flap of this.nacelles?.cowlFlaps ?? []) cowlFlaps.push(...(flap.hinge.object.children as THREE.Mesh[]));
    const proxies = buildShadowProxies(this.root, {
      moving: [...hinges.map((h) => h.object), ...gear.moving, ...cockpit.moving, ...this.propellers.map((p) => p.group)],
      keep: gear.keep,
      none: [...gear.none, ...cockpit.none, ...cowlFlaps],
    });
    for (const y of cockpit.moving) {
      const p = proxies.get(y);
      if (p) this.interiorCasters.push(p);
    }
  }

  /** Resolves when the fuselage textures and cabin occlusion are baked and in place (AircraftVisualOptions.asyncBake). */
  textureBake: Promise<void> = Promise.resolve();
  /** Main-thread time init() took, ms (diagnostics). */
  initMs = 0;

  private bakeInWorker(textures: FuselageTextures, shapes: ReturnType<typeof createFuselageShapes>, cabin: CabinBake): Promise<void> {
    return new Promise<void>((resolve) => {
      const fallback = (why: unknown): void => {
        console.warn('[aircraft] bake worker failed, baking on the main thread:', why);
        applyFuselageTextureData(textures, bakeFuselageData(shapes.outer, shapes.glass, shapes.lining, this.def));
        cabin.bakeNow(this.def);
        resolve();
      };
      try {
        const worker = new Worker(new URL('./liveryWorker.ts', import.meta.url), { type: 'module', name: 'aircraft-livery' });
        worker.onmessage = (e: MessageEvent<AircraftBakeResult>) => {
          worker.terminate();
          if (this.disposed) return resolve();
          if (e.data.error !== undefined) return fallback(e.data.error);
          applyFuselageTextureData(textures, e.data.textures);
          cabin.apply(e.data.cabinVis);
          resolve();
        };
        worker.onerror = (e) => {
          worker.terminate();
          e.preventDefault();
          fallback(e.message);
        };
        const inputs = cabin.inputs();
        // The worker loads the definition itself, by id (it is plain data, but ~40 kB of it).
        const request: AircraftBakeRequest = { airframeId: this.def.id, cabin: inputs };
        worker.postMessage(request, [inputs.positions.buffer, inputs.normals.buffer, inputs.doubleSided.buffer]);
      } catch (e) {
        fallback(e);
      }
    });
  }

  private disposed = false;
  private quality: QualityLevel | null = null;

  /** Quality-dependent parts: the strobe / beacon point lights (they cost shading on every lit pixel). */
  private applyQuality(q: QualityLevel): void {
    this.quality = q;
    this.lights.setPointLights(q !== 'low');
  }

  /**
   * Per-vertex cabin occlusion (cabinLight.ts) on every interior mesh: everything in the cockpit group plus
   * the cabin-only surfaces merged into the fuselage fittings (baggage bulkhead, firewall face). Materials
   * the interior shares with the exterior (black, chrome, dark metal) get patched interior copies.
   */
  private applyCabinOcclusion(): CabinBake {
    const bake = new CabinBake();
    const cabinOnly = new Set<THREE.Material>([...this.materials.cabin, ...this.cockpit.ownMaterials, ...(this.occupants?.materials ?? [])]);
    const variants = new Map<THREE.Material, THREE.Material>();
    const variant = (m: THREE.Material): THREE.Material => {
      let v = variants.get(m);
      if (!v) {
        if (cabinOnly.has(m)) v = patchCabinMaterial(m as THREE.MeshStandardMaterial);
        else {
          v = patchCabinMaterial((m as THREE.MeshStandardMaterial).clone());
          this.cabinClones.push(v);
        }
        variants.set(m, v);
      }
      return v;
    };
    this.root.updateMatrixWorld(true);
    const inv = this.root.matrixWorld.clone().invert();
    const toModel = new THREE.Matrix4();
    const interior = new Set<THREE.Object3D>();
    this.cockpit.group.traverse((o) => interior.add(o));
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      if (!interior.has(mesh) && !cabinOnly.has(mesh.material)) return;
      if (!(mesh.material instanceof THREE.MeshStandardMaterial)) return;
      toModel.multiplyMatrices(inv, mesh.matrixWorld);
      bake.add(mesh.geometry, toModel, mesh.material.side === THREE.DoubleSide);
      mesh.material = variant(mesh.material);
    });
    return bake;
  }
  private readonly cabinClones: THREE.Material[] = [];

  /**
   * Show the instruments module's panel texture on the panel face (the C172S: 1.04 m x 0.40 m; u to the pilot's
   * right, v up). It is lit by the scene and self-illuminated with ctx.controls.lights.panel and bus power.
   * May be called before init().
   */
  setPanelTexture(texture: THREE.Texture): void {
    if (this.helicopter) { this.helicopter.panel.material.map = texture; this.helicopter.panel.material.needsUpdate = true; }
    else if (this.cockpit) this.cockpit.setPanelTexture(texture);
    else this.pendingPanel = texture;
  }

  /**
   * Use a dedicated self-illumination map for the panel (InstrumentPanel.emissiveTexture), same UVs as the
   * panel texture. Without it the colour texture is masked by texel brightness. May be called before init().
   */
  setPanelEmissiveTexture(texture: THREE.Texture): void {
    if (this.helicopter) { this.helicopter.panel.material.emissiveMap = texture; this.helicopter.panel.material.needsUpdate = true; }
    else if (this.cockpit) this.cockpit.setPanelEmissiveTexture(texture);
    else this.pendingPanelEmissive = texture;
  }

  /** The instrument panel face mesh (for raycasting clicks onto the panel, etc.). Valid after init(). */
  getPanelMesh(): THREE.Mesh {
    return this.helicopter?.panel ?? this.cockpit.panelMesh;
  }

  update(_dt: number, ctx: SimContext): void {
    if (this.helicopter) { this.helicopter.update(ctx); return; }
    if (ctx.quality !== this.quality) this.applyQuality(ctx.quality);
    const st = ctx.state;
    const s = st.surfaces;
    for (const surface of this.wings.surfaces) {
      if (surface.kind === 'flap') setFlap(surface.hinge, s.flaps, this.def.wing.flap);
      else surface.hinge.setAngle(surface.side < 0 ? s.aileronLeft : s.aileronRight);
    }
    this.tail.elevators[0].setAngle(s.elevator);
    this.tail.elevators[1].setAngle(s.elevator);
    // A trim tab shows the trim; an anti-servo tab also follows the surface it rides on, by its gearing.
    for (const tab of this.tail.tabs) tab.setAngle(this.tail.tabGearing * s.elevator + s.elevatorTrim);
    this.tail.rudder.setAngle(s.rudder);
    this.tail.rudderTab?.setAngle(s.rudderTrim);
    this.gear.update(st.wheels, st.gear.extension);
    for (let i = 0; i < this.propellers.length; i++) {
      // A state with fewer propellers than the airframe (a visual shown over a placeholder definition) leaves
      // the others stopped.
      const p = st.propellers[i];
      if (p) this.propellers[i].update(p.rotation, p.rpm, p.bladePitch);
      else this.propellers[i].update(0, 0);
    }
    for (const flap of this.nacelles?.cowlFlaps ?? []) flap.hinge.setAngle(flap.angle * (st.engines[flap.engine]?.cowlFlap ?? 0));
    this.lights.update(ctx.simTime, st, ctx.controls, this.root, ctx.camera, ctx.renderer, ctx.sky);
    this.materials.setSun(ctx.sky.sunDir, ctx.sky.sunColor);

    this.contactShadow.update(ctx);

    // Interior level of detail: only worth drawing when the camera is close or inside.
    this.root.updateWorldMatrix(true, false);
    ctx.camera.getWorldPosition(this.camLocal);
    this.root.worldToLocal(this.camLocal);
    const inside = ctx.cameraMode === 'cockpit';
    // Under a canopy the interior is seen from outside too: nothing in it is hidden or stops casting.
    const canopy = this.def.cockpit.enclosure === 'canopy';
    // Interior shadows (the yokes on the panel) only matter seen from inside.
    for (const p of this.interiorCasters) p.castShadow = inside || canopy;
    this.cockpit.setDetailVisible(inside || canopy);
    this.cockpit.group.visible = inside || interiorInView(this.camLocal.length(), canopy ? ctx.camera.fov : 60, this.opts.interiorLodDistance);
    if (this.occupants) this.occupants.group.visible = !inside;
    if (this.cockpit.group.visible) {
      this.cockpit.update(st, ctx.controls, this.opts.panelEmissiveScale);
      cabinLamps.cabinModelFromWorld.value.copy(this.root.matrixWorld).invert();
      updateCabinBounce(ctx.sky, this.root.getWorldQuaternion(this.rootQuat), this.cockpit.lampFlux(this.lampFlux), this.def.cockpit);
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.helicopter) { this.helicopter.dispose(); this.contactShadow.dispose(); this.root.removeFromParent(); return; }
    this.root.removeFromParent();
    this.contactShadow.mesh.removeFromParent();
    this.contactShadow.dispose();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    for (const p of this.propellers) p.dispose();
    this.lights.dispose();
    this.cockpit.dispose();
    for (const m of this.occupants?.materials ?? []) m.dispose();
    this.materials.dispose();
    for (const m of this.cabinClones) m.dispose();
  }
}
