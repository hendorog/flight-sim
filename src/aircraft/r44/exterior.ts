// R44 detail assembly. Supervisor connection: select this class in AircraftVisual's rotorcraft branch.
// Kept separate from visual.ts so the worker's plain-data import never pulls in three.js or a DOM.
// Until connected, the ordinary dev/sim pages show the data-only exterior. See docs/r44-exterior.md.
import type { SimContext } from '../../core/context';
import type { PanelDef } from '../../instruments/panelDef';
import type { AirframeVisualDef } from '../../render/aircraft/airframe/types';
import type { RotorcraftVisual } from '../../render/aircraft/RotorcraftVisual';
import type { FuselageShape } from '../../render/aircraft/fuselageShape';
import type { sectionHalfWidth } from '../../render/aircraft/fuselage';
import { buildR44CockpitDetails } from './cockpitDetails';
import { buildR44ExteriorDetails } from './exteriorDetails';
import { r44DetailMaterials } from './exteriorGeometry';
import { R44RotorHead } from './exteriorRotor';

// Inject these shared implementations: their legacy default imports reach C172 aircraft data and
// must not form value-import edges from an aircraft leaf. No helper implementation is duplicated.
export function r44ExteriorVisualClass(Base: typeof RotorcraftVisual,
  Shape: typeof FuselageShape, halfWidth: typeof sectionHalfWidth) {
  return class R44ExteriorVisual extends Base {
    private readonly detailMaterials = r44DetailMaterials();
    private readonly details: ReturnType<typeof buildR44ExteriorDetails>;
    private readonly mainHead: R44RotorHead;
    private readonly tailHead: R44RotorHead;

    constructor(def: AirframeVisualDef, ctx: SimContext,
      options: { lightScale: number; panelEmissiveScale: number; interiorLodDistance: number; panelDef?: PanelDef }) {
      super(def, ctx, options);
      const skin = new Shape(0, -Infinity, def.fuselage), lining = new Shape(0.026, -Infinity, def.fuselage);
      this.details = buildR44ExteriorDetails(def, this.detailMaterials, (x, z) => halfWidth(skin, x, z));
      this.root.add(this.details.group);
      this.cockpit.group.add(buildR44CockpitDetails(def, this.cockpit, this.detailMaterials, (x, z) => halfWidth(lining, x, z)));
      this.mainHead = new R44RotorHead(this.main, this.detailMaterials);
      this.tailHead = new R44RotorHead(this.tail, this.detailMaterials, true);
    }

    override update(ctx: SimContext): void {
      super.update(ctx); this.mainHead.update(); this.tailHead.update();
    }

    override dispose(): void {
      super.dispose();
      for (const material of [...Object.values(this.detailMaterials), ...this.details.materials]) material.dispose();
      for (const texture of this.details.textures) texture.dispose();
    }
  };
}
