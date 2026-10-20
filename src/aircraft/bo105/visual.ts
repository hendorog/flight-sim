// MBB Bo 105 CB-4: the airframe visual (plain data; the livery worker loads this file). SCAFFOLD STUB (owner after the
// scaffold: BX): the MD 500E's airframe carrying the Bo 105 rotor geometry until BX builds the Bo 105 (rounded pod with
// large glazing, clamshell doors, swept fin with the left TR at the fin top, endplate stabiliser, four-blade hingeless
// head) from dimensions.ts and the frozen panelLayout.ts. `rotorcraft` must deep-equal the physics BO105_ROTORCRAFT.
import type { AirframeVisualDef } from '../../render/aircraft/airframe/types';
import { MD500_VISUAL as base } from '../md500/visual';
import { BO105_ROTORCRAFT as rotor } from './rotorcraft';

const rv = base.rotorcraftVisual!;
export const BO105_VISUAL: AirframeVisualDef = {
  ...base, id: 'bo105', rotorcraft: rotor,
  rotorcraftVisual: { ...rv,
    main: { ...rv.main, radius: rotor.main.radius, root: rotor.main.rootCutout, chord: [rotor.main.chord, rotor.main.chord],
      twist: rotor.main.twist },
    tail: { ...rv.tail, radius: rotor.tail.radius, chord: rotor.tail.chord, twist: rotor.tail.twist } },
  livery: { ...base.livery, registration: 'D-HBOX' },
};

export default BO105_VISUAL;
