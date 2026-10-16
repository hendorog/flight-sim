// MD 500E: the airframe visual (plain data; the livery worker loads this file). SCAFFOLD STUB (owner: M2): the
// Schweizer 300CB's airframe carrying the 500E rotor geometry until M2 builds the 500E (egg fuselage, pointed E nose,
// 5-blade head, T-tail, left tail rotor) from dimensions.ts and panelLayout.ts. `rotorcraft` must deep-equal the
// physics MD500_ROTORCRAFT (consistency).
import type { AirframeVisualDef } from '../../render/aircraft/airframe/types';
import { S269_VISUAL as base } from '../s269/visual';
import { MD500_ROTORCRAFT } from './rotorcraft';

const rv = base.rotorcraftVisual!;
export const MD500_VISUAL: AirframeVisualDef = {
  ...base, id: 'md500', rotorcraft: MD500_ROTORCRAFT,
  rotorcraftVisual: { ...rv,
    main: { ...rv.main, radius: MD500_ROTORCRAFT.main.radius, chord: [MD500_ROTORCRAFT.main.chord, MD500_ROTORCRAFT.main.chord],
      twist: MD500_ROTORCRAFT.main.twist },
    tail: { ...rv.tail, radius: MD500_ROTORCRAFT.tail.radius, chord: MD500_ROTORCRAFT.tail.chord, twist: MD500_ROTORCRAFT.tail.twist } },
};

export default MD500_VISUAL;
