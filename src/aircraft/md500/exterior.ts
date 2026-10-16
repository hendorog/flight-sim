// MD 500E: the detailed exterior class factory, injected in AircraftVisual (the S269 / R44 pattern, so no import
// cycle: importOrder.test.ts). It keeps the shared fuselage loft, glazing, cockpit, lights, figures, panel and
// rotor builders, hides the generic Robinson fittings (and the static shadow they baked), and adds the 500E's own
// engine fairing, static mast, boom, T-tail, left tail rotor gearbox, skid gear, frames (exteriorDetails.ts), the
// five-blade articulated head posed from the published articulated state (exteriorRotor.ts) and the LH-command
// crew compartment (cockpitDetails.ts). See docs/md500-exterior.md.
import * as THREE from 'three';
import type { SimContext } from '../../core/context';
import type { PanelDef } from '../../instruments/panelDef';
import type { RotorcraftState } from '../../physics/rotorcraft/definition';
import type { AirframeVisualDef } from '../../render/aircraft/airframe/types';
import type { RotorcraftVisual } from '../../render/aircraft/RotorcraftVisual';
import type { FuselageShape } from '../../render/aircraft/fuselageShape';
import type { sectionHalfWidth } from '../../render/aircraft/fuselage';
import { buildMD500Cockpit } from './cockpitDetails';
import { buildMD500Exterior } from './exteriorDetails';
import { md500Materials } from './exteriorGeometry';
import { MD500MainRotor, buildMD500TailHead } from './exteriorRotor';

export type MD500RotorPoseReader = (ctx: SimContext) => RotorcraftState['articulated'];

export function md500ExteriorVisualClass(Base: typeof RotorcraftVisual, Shape: typeof FuselageShape,
  halfWidth: typeof sectionHalfWidth, readRotorPose?: MD500RotorPoseReader): typeof RotorcraftVisual {
  return class MD500ExteriorVisual extends Base {
    private readonly detailMaterials = md500Materials();
    private readonly details: ReturnType<typeof buildMD500Exterior>;
    private readonly cabinDetails: ReturnType<typeof buildMD500Cockpit>;
    readonly articulatedHead: MD500MainRotor;
    private readonly updateTailHead: () => void;

    constructor(def: AirframeVisualDef, ctx: SimContext,
      options: { lightScale: number; panelEmissiveScale: number; interiorLodDistance: number; panelDef?: PanelDef }) {
      super(def, ctx, options);
      // Hide the generic fittings AND the static shadow they baked; they stay attached for the shared disposer.
      this.root.getObjectByName('rotorcraftAirframe')!.visible = false;
      const staticProxy = this.root.children.find(o => o.name === 'shadowProxy:rotorcraft');
      if (staticProxy) staticProxy.visible = false;
      const skin = new Shape(0, -Infinity, def.fuselage), lining = new Shape(0.026, -Infinity, def.fuselage);
      const section = (x: number) => { const s = skin.section(x); return { zTop: s.zTop, zBot: s.zBot, zMid: s.zMid, hw: s.hw, nTop: s.nTop, nBot: s.nBot }; };
      this.details = buildMD500Exterior(def, this.detailMaterials, (x, z) => halfWidth(skin, x, z), section);
      this.root.add(this.details.group);
      this.cabinDetails = buildMD500Cockpit(def, this.cockpit, this.detailMaterials, (x, z) => halfWidth(lining, x, z));
      this.cockpit.group.add(this.cabinDetails.group);
      this.articulatedHead = new MD500MainRotor(this.main, def.rotorcraftVisual!.main, def.rotorcraft!, this.detailMaterials);
      this.updateTailHead = buildMD500TailHead(this.tail, this.detailMaterials);
      // Pre-detail rotor/cyclic shadow proxies contain the generic hardware; the new hardware casts directly.
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
