// Aircraft-specific detailed assembly. The supervisor connects this factory in AircraftVisual, as R44.
// Inject legacy builders whose value imports reach C172 defaults; aircraft leaf imports remain acyclic.
import * as THREE from 'three';
import type { SimContext } from '../../core/context';
import type { PanelDef } from '../../instruments/panelDef';
import type { AirframeVisualDef } from '../../render/aircraft/airframe/types';
import type { RotorcraftVisual } from '../../render/aircraft/RotorcraftVisual';
import type { FuselageShape } from '../../render/aircraft/fuselageShape';
import type { sectionHalfWidth } from '../../render/aircraft/fuselage';
import { buildS269Cockpit } from './cockpitDetails';
import { buildS269Exterior } from './exteriorDetails';
import { s269Materials } from './exteriorGeometry';
import { S269MainRotor, buildS269TailHead, type S269RotorPoseReader } from './exteriorRotor';

export function s269ExteriorVisualClass(Base: typeof RotorcraftVisual, Shape: typeof FuselageShape,
  halfWidth: typeof sectionHalfWidth, readRotorPose?: S269RotorPoseReader) {
  return class S269ExteriorVisual extends Base {
    private readonly detailMaterials = s269Materials();
    private readonly details: ReturnType<typeof buildS269Exterior>;
    private readonly cabinDetails: ReturnType<typeof buildS269Cockpit>;
    readonly articulatedHead: S269MainRotor;
    private readonly updateTailHead: () => void;

    constructor(def: AirframeVisualDef, ctx: SimContext,
      options: { lightScale: number; panelEmissiveScale: number; interiorLodDistance: number; panelDef?: PanelDef }) {
      super(def, ctx, options);
      // Hide the generic Robinson fittings AND the static shadow they baked. Keep attached for disposal.
      this.root.getObjectByName('rotorcraftAirframe')!.visible = false;
      const staticProxy = this.root.children.find(o => o.name === 'shadowProxy:rotorcraft');
      if (staticProxy) staticProxy.visible = false;
      const skin = new Shape(0, -Infinity, def.fuselage), lining = new Shape(0.026, -Infinity, def.fuselage);
      this.details = buildS269Exterior(def, this.detailMaterials, (x, z) => halfWidth(skin, x, z)); this.root.add(this.details.group);
      this.cabinDetails = buildS269Cockpit(def, this.cockpit, this.detailMaterials, (x, z) => halfWidth(lining, x, z));
      this.cockpit.group.add(this.cabinDetails.group);
      this.articulatedHead = new S269MainRotor(this.main, def.rotorcraftVisual!.main, def.rotorcraft!, this.detailMaterials);
      this.updateTailHead = buildS269TailHead(this.tail, def.rotorcraftVisual!.tail, this.detailMaterials);
      // Hide pre-detail rotor/cyclic shadow proxies, which contain the generic hardware. New hardware
      // casts directly; cabin furniture/skin retains the shared alpha-tested and moving proxies.
      for (const anchor of [this.main.spin, this.tail.spin, this.cockpit.cyclic]) for (const child of anchor.children)
        if (child instanceof THREE.Mesh && child.name.startsWith('shadowProxy:')) child.visible = false;
    }
    override update(ctx: SimContext): void {
      super.update(ctx); this.cabinDetails.update(ctx.controls);
      this.articulatedHead.update(ctx, readRotorPose?.(ctx)); this.updateTailHead();
    }
    override dispose(): void {
      super.dispose();
      for (const m of [...Object.values(this.detailMaterials), ...this.details.materials]) m.dispose();
      for (const t of this.details.textures) t.dispose();
    }
  };
}
