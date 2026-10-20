// Lockheed AH-56A Cheyenne: the airframe visual (plain data; the livery worker loads this file). SCAFFOLD STUB (owner
// after the scaffold: AX): the MD 500E's airframe carrying the stub rotor (base.ts) until AX builds the Cheyenne
// (tandem fuselage, stepped canopy, sponsons, low wing, ventral fin, bobtailed left stabiliser with the TR, pusher,
// retractable gear, AMCS head / ICS gyro X) from dimensions.ts and the frozen panelLayout.ts. AX hides the generic skid
// group and leaves `shadow.skids` out (plan revision 2, section 7.5). `rotorcraft` deep-equals AH56_ROTORCRAFT.
import type { AirframeVisualDef } from '../../render/aircraft/airframe/types';
import { MD500_VISUAL as base } from '../md500/visual';
import { AH56_ROTORCRAFT as rotor } from './rotorcraft';

const rv = base.rotorcraftVisual!;
export const AH56_VISUAL: AirframeVisualDef = {
  ...base, id: 'ah56', rotorcraft: rotor,
  rotorcraftVisual: { ...rv,
    main: { ...rv.main, radius: rotor.main.radius, root: rotor.main.rootCutout, chord: [rotor.main.chord, rotor.main.chord],
      twist: rotor.main.twist },
    tail: { ...rv.tail, radius: rotor.tail.radius, chord: rotor.tail.chord, twist: rotor.tail.twist } },
  livery: { ...base.livery, registration: '66-8832' },
};

export default AH56_VISUAL;
