// MBB Bo 105 CB-4: the detailed exterior class factory, injected in AircraftVisual (the S269 / MD 500E pattern, so no
// import cycle: importOrder.test.ts). It keeps the shared fuselage loft, glazing, cockpit, lights, figures, panel and
// rotor builders, hides the generic Robinson fittings (and the static shadow they baked), and adds the Bo 105's own
// deck fairing, boom, fin, stabiliser, gearboxes, skid gear and frames (exteriorDetails.ts), the four-blade HINGELESS
// head posed from the WHOLE rotorcraft state read through `readRotorcraft` (exteriorRotor.ts: the published blade flap,
// bent at the root, and the swashplate from swashplateCyclic()), and the right-seat crew compartment with the pedestal,
// overhead console and power levers (cockpitDetails.ts). See docs/bo105-exterior.md.
import * as THREE from 'three';
import type { SimContext } from '../../core/context';
import type { PanelDef } from '../../instruments/panelDef';
import type { RotorcraftState } from '../../physics/rotorcraft/definition';
import type { AirframeVisualDef } from '../../render/aircraft/airframe/types';
import type { RotorcraftVisual } from '../../render/aircraft/RotorcraftVisual';
import type { FuselageShape } from '../../render/aircraft/fuselageShape';
import type { sectionHalfWidth } from '../../render/aircraft/fuselage';
import { buildBo105Cockpit } from './cockpitDetails';
import { buildBo105Exterior } from './exteriorDetails';
import { bo105Materials } from './exteriorGeometry';
import { Bo105MainRotor, buildBo105TailHead } from './exteriorRotor';

export type Bo105RotorcraftReader = (ctx: SimContext) => RotorcraftState | undefined;

export function bo105ExteriorVisualClass(Base: typeof RotorcraftVisual, Shape: typeof FuselageShape,
  halfWidth: typeof sectionHalfWidth, readRotorcraft?: Bo105RotorcraftReader): typeof RotorcraftVisual {
  return class Bo105ExteriorVisual extends Base {
    private readonly detailMaterials = bo105Materials();
    private readonly details: ReturnType<typeof buildBo105Exterior>;
    private readonly cabinDetails: ReturnType<typeof buildBo105Cockpit>;
    readonly hingelessHead: Bo105MainRotor;
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
      this.details = buildBo105Exterior(def, this.detailMaterials, (x, z) => halfWidth(skin, x, z), section);
      this.root.add(this.details.group);
      this.cabinDetails = buildBo105Cockpit(def, this.cockpit, this.detailMaterials, (x, z) => halfWidth(lining, x, z));
      this.cockpit.group.add(this.cabinDetails.group);
      this.hingelessHead = new Bo105MainRotor(this.main, def.rotorcraftVisual!.main, def.rotorcraft!, this.detailMaterials);
      this.updateTailHead = buildBo105TailHead(this.tail, this.detailMaterials);
      // Pre-detail rotor/cyclic shadow proxies contain the generic hardware; the new hardware casts directly.
      for (const anchor of [this.main.spin, this.tail.spin, this.cockpit.cyclic]) for (const child of anchor.children)
        if (child instanceof THREE.Mesh && child.name.startsWith('shadowProxy:')) child.visible = false;
    }
    override update(ctx: SimContext): void {
      super.update(ctx); this.cabinDetails.update(ctx.controls);
      this.hingelessHead.update(ctx, readRotorcraft ? readRotorcraft(ctx) : ctx.state.rotorcraft); this.updateTailHead();
    }
    override dispose(): void {
      super.dispose();
      for (const m of [...Object.values(this.detailMaterials), ...this.details.materials]) m.dispose();
      for (const t of this.details.textures) t.dispose();
    }
  };
}
