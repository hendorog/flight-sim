// Lockheed AH-56A Cheyenne: the detailed exterior class factory, injected in AircraftVisual (no import cycle:
// importOrder.test.ts). It keeps the shared fuselage loft, glazing, cockpit, lights, figures and panel, hides the generic
// helicopter fittings (boom, mast fairing, skids, the static shadow they baked) and the generic two-blade tail rotor, and
// adds the Cheyenne's own parts: the T64 installation, sponsons, wing, ventral fin, stabilisers and markings
// (exteriorDetails.ts), the weapons and stores (exteriorWeapons.ts), the retractable tail-wheel gear (exteriorGear.ts),
// the hingeless main head with the ICS gyro X, the four-blade tail rotor and the pusher (exteriorRotor.ts) and both crew
// stations (cockpitDetails.ts). The WHOLE rotorcraft state is read through `readRotorcraft`: the per-blade pose
// (state.articulated), state.controlGyro (mode and tilt), state.pusher (blade angle). See docs/ah56-exterior.md.
import * as THREE from 'three';
import type { SimContext } from '../../core/context';
import type { PanelDef } from '../../instruments/panelDef';
import type { RotorcraftState } from '../../physics/rotorcraft/definition';
import type { AirframeVisualDef } from '../../render/aircraft/airframe/types';
import type { RotorcraftVisual } from '../../render/aircraft/RotorcraftVisual';
import type { FuselageShape } from '../../render/aircraft/fuselageShape';
import type { sectionHalfWidth } from '../../render/aircraft/fuselage';
import { buildAH56Cockpit } from './cockpitDetails';
import { buildAH56Exterior } from './exteriorDetails';
import { buildAH56Weapons } from './exteriorWeapons';
import { AH56Gear } from './exteriorGear';
import { ah56Materials } from './exteriorGeometry';
import { AH56MainRotor, AH56Pusher, AH56TailRotor } from './exteriorRotor';

export type Ah56RotorcraftReader = (ctx: SimContext) => RotorcraftState | undefined;

export function ah56ExteriorVisualClass(Base: typeof RotorcraftVisual, Shape: typeof FuselageShape,
  halfWidth: typeof sectionHalfWidth, readRotorcraft?: Ah56RotorcraftReader): typeof RotorcraftVisual {
  return class AH56ExteriorVisual extends Base {
    private readonly detailMaterials = ah56Materials();
    private readonly details: ReturnType<typeof buildAH56Exterior>;
    private readonly cabinDetails: ReturnType<typeof buildAH56Cockpit>;
    readonly head: AH56MainRotor;
    readonly tailRotor: AH56TailRotor;
    readonly pusher: AH56Pusher;
    readonly gear: AH56Gear;
    private readonly rotorDef: NonNullable<AirframeVisualDef['rotorcraft']>;

    constructor(def: AirframeVisualDef, ctx: SimContext,
      options: { lightScale: number; panelEmissiveScale: number; interiorLodDistance: number; panelDef?: PanelDef }) {
      super(def, ctx, options);
      this.rotorDef = def.rotorcraft!;
      // Hide the generic fittings (boom, mast cowl, skids) AND the static shadow they baked; they stay attached for the
      // shared disposer. The generic tail rotor has the stub definition's blade count: the Cheyenne's is drawn instead.
      this.root.getObjectByName('rotorcraftAirframe')!.visible = false;
      const staticProxy = this.root.children.find(o => o.name === 'shadowProxy:rotorcraft');
      if (staticProxy) staticProxy.visible = false;
      this.tail.group.visible = false;
      const skin = new Shape(0, -Infinity, def.fuselage), lining = new Shape(0.03, -Infinity, def.fuselage);
      const section = (x: number) => { const s = skin.section(x); return { zTop: s.zTop, zBot: s.zBot, zMid: s.zMid, hw: s.hw, nTop: s.nTop, nBot: s.nBot }; };
      const m = this.detailMaterials;
      this.details = buildAH56Exterior(def, m, (x, z) => halfWidth(skin, x, z), section);
      this.root.add(this.details.group);
      this.root.add(buildAH56Weapons(m, section).group);
      this.gear = new AH56Gear(m); this.root.add(this.gear.group);
      this.cabinDetails = buildAH56Cockpit(def, this.cockpit, m, (x, z) => halfWidth(lining, x, z));
      this.cockpit.group.add(this.cabinDetails.group);
      if (this.cabinDetails.gunner) this.cockpit.group.add(this.cabinDetails.gunner.group);
      this.head = new AH56MainRotor(this.main, def.rotorcraftVisual!.main, def.rotorcraft!, m);
      this.tailRotor = new AH56TailRotor(m); this.root.add(this.tailRotor.rotor.group);
      this.pusher = new AH56Pusher(m); this.root.add(this.pusher.group);
      // Pre-detail rotor/cyclic shadow proxies contain the generic hardware; the new hardware casts directly.
      for (const anchor of [this.main.spin, this.tail.spin, this.cockpit.cyclic]) for (const child of anchor.children)
        if (child instanceof THREE.Mesh && child.name.startsWith('shadowProxy:')) child.visible = false;
    }

    override update(ctx: SimContext): void {
      super.update(ctx);
      const state = readRotorcraft?.(ctx) ?? ctx.state.rotorcraft;
      this.cabinDetails.update(ctx.controls, ctx.cameraMode === 'cockpit');
      this.gear.update(ctx.state);
      if (!state) return;
      this.head.update(ctx, state);
      const def = this.rotorDef;
      this.tailRotor.update(state, ctx.controls.rudder, def.rotation);
      this.pusher.update(state.pusher?.beta, state.azimuth, state.rotorRpm, def.pusher?.ratio);
    }

    override dispose(): void {
      super.dispose();
      this.tailRotor.dispose(); this.pusher.dispose(); this.head.dispose();
      for (const mat of [...Object.values(this.detailMaterials), ...this.details.materials, ...(this.cabinDetails.gunner?.materials ?? [])]) mat.dispose();
      for (const t of this.details.textures) t.dispose();
    }
  };
}
