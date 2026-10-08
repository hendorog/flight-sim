// Rotorcraft assembly. The cabin shares the aeroplanes' loft, texture bake, materials, lights and figures;
// rotors and helicopter controls live in rotorcraft/. Render geometry never reads aerodynamic hub offsets.
import * as THREE from 'three';
import type { SimContext } from '../../core/context';
import type { AirframeVisualDef } from './airframe/types';
import { buildFuselage, cabinFloorGeometry, createFuselageShapes } from './fuselage';
import { frd } from './geometry';
import { AircraftLights } from './lights';
import { bakeFuselageTextures } from './livery';
import { AircraftMaterials } from './materials';
import { buildOccupants, type Occupants } from './occupants';
import { buildShadowProxies } from './shadowProxy';
import { buildRotorcraftAirframe, type RotorcraftAirframe } from './rotorcraft/airframe';
import { RotorcraftCockpit } from './rotorcraft/cockpit';
import { TeeteringRotor } from './rotorcraft/rotor';

export class RotorcraftVisual {
  readonly root = new THREE.Group();
  readonly main: TeeteringRotor;
  readonly tail: TeeteringRotor;
  readonly cockpit: RotorcraftCockpit;
  readonly panel: RotorcraftCockpit['panel'];
  private readonly materials: AircraftMaterials;
  private readonly fittings: RotorcraftAirframe;
  private readonly occupants: Occupants | null;
  private readonly lights: AircraftLights;
  private readonly camLocal = new THREE.Vector3();
  private readonly tilt = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private quality: string;

  constructor(private readonly def: AirframeVisualDef, ctx: SimContext,
    private readonly options: { lightScale: number; panelEmissiveScale: number; interiorLodDistance: number }) {
    const d = def.rotorcraftVisual;
    if (!d) throw new Error('Rotorcraft airframe has no visual geometry');
    this.root.name = 'rotorcraft';
    const shapes = createFuselageShapes(def);
    const textures = bakeFuselageTextures(shapes.outer, shapes.glass, shapes.lining, def);
    this.materials = new AircraftMaterials(textures, def);
    const mat = this.materials;
    const fuselage = buildFuselage(shapes, mat, def);
    this.root.add(fuselage.skin, fuselage.glass, fuselage.fittings);
    this.fittings = buildRotorcraftAirframe(def, mat, shapes.outer); this.root.add(this.fittings.group);
    const floor = def.cockpit.floor;
    this.cockpit = new RotorcraftCockpit(def, mat, cabinFloorGeometry(shapes.lining, floor.z, floor.x0, floor.x1));
    this.cockpit.group.add(fuselage.lining); this.root.add(this.cockpit.group);
    this.panel = this.cockpit.panel;
    this.occupants = buildOccupants(def.cockpit, true); if (this.occupants) this.cockpit.group.add(this.occupants.group);
    this.main = new TeeteringRotor(d.main, mat); this.main.group.position.copy(frd(...d.main.hub)); this.root.add(this.main.group);
    this.tail = new TeeteringRotor({ ...d.tail, chord: [d.tail.chord, d.tail.chord], twist: 0, tail: true }, mat);
    this.tail.group.position.copy(frd(...d.tail.hub)); this.tail.group.rotation.z = Math.PI / 2; this.root.add(this.tail.group);
    this.lights = new AircraftLights(ctx.quality !== 'low', options.lightScale, new THREE.Group(), def.lamps, undefined, 14);
    this.quality = ctx.quality; this.root.add(this.lights.group);
    buildShadowProxies(this.root, { moving: [this.cockpit.group, ...this.cockpit.moving, this.main.spin, this.tail.spin, this.main.swashplate],
      keep: [this.main.blades, this.tail.blades], none: [this.panel] });
  }

  setPanelTexture(texture: THREE.Texture): void { this.cockpit.setPanelTexture(texture); }
  setPanelEmissiveTexture(texture: THREE.Texture): void { this.cockpit.setPanelEmissiveTexture(texture); }

  update(ctx: SimContext): void {
    const r = ctx.state.rotorcraft, c = ctx.controls, d = this.def.rotorcraft!, v = this.def.rotorcraftVisual!;
    if (r) {
      // The flight model uses small-angle disc slopes: FRD [forward, right, -1].
      this.tilt.set(r.flapRight, 1, -r.flapForward).normalize();
      this.main.group.quaternion.setFromUnitVectors(this.up, this.tilt);
      const spin = Math.min(1, Math.max(0, r.rotorRpm / d.nominalRpm));
      // Visual estimate: about 2.5 deg coning at gross-weight hover, drooping 2 deg when stopped.
      const cone = THREE.MathUtils.lerp(-2 * Math.PI / 180, Math.min(5, Math.max(0, r.thrust) / 6000 * 2.5) * Math.PI / 180, spin * spin);
      const pitch = THREE.MathUtils.lerp(d.main.minPitch, d.main.maxPitch, c.collective ?? 0);
      this.main.update(r.azimuth, r.rotorRpm, pitch, cone);
      this.tail.update(-r.azimuth * d.tailRatio, r.rotorRpm * d.tailRatio, THREE.MathUtils.lerp(d.tail.minPitch, d.tail.maxPitch, (1 - c.rudder) / 2), -v.tail.precone);
    }
    if (ctx.quality !== this.quality) { this.quality = ctx.quality; this.lights.setPointLights(ctx.quality !== 'low'); }
    this.lights.update(ctx.simTime, ctx.state, c, this.root, ctx.camera, ctx.renderer, ctx.sky);
    this.materials.setSun(ctx.sky.sunDir, ctx.sky.sunColor);
    this.root.updateWorldMatrix(true, false); ctx.camera.getWorldPosition(this.camLocal); this.root.worldToLocal(this.camLocal);
    const inside = ctx.cameraMode === 'cockpit';
    this.cockpit.group.visible = inside || this.camLocal.length() * Math.tan(ctx.camera.fov * Math.PI / 360) / Math.tan(Math.PI / 6) < this.options.interiorLodDistance;
    if (this.occupants) this.occupants.group.visible = !inside;
    this.cockpit.update(c, ctx.state.electrical.busVoltage, this.options.panelEmissiveScale);
  }

  dispose(): void {
    this.root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    this.main.dispose(); this.tail.dispose(); this.cockpit.dispose(); this.lights.dispose();
    for (const m of this.occupants?.materials ?? []) m.dispose();
    for (const m of this.fittings.materials) m.dispose();
    for (const t of this.fittings.textures) t.dispose();
    this.materials.dispose(); this.root.removeFromParent();
  }
}
