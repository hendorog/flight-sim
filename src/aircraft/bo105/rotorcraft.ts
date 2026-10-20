// MBB Bo 105 CB-4: the RotorcraftDefinition. SCAFFOLD STUB (owner after the scaffold: BO; the hingeless hub model is
// RC's, plan revision 2 sections 4 and 6.2).
//
// Until RC lands the hingeless hub and BO the Bo 105 flight model, this is the MD 500E's rotorcraft (articulated hub,
// hub point, skids, airframe, turboshaft governor law, limits in psi) flying the Bo 105 MAIN AND TAIL ROTOR GEOMETRY
// (4 x 4.92 m x 0.27 m, -6.2 deg; 2 x 0.95 m x 0.18 m), the Bo 105 rotor speed and ratios (424.5 rpm = 100 %, 14.17,
// 5.25), a polar inertia of 900 kg m^2 (ESTIMATE, Lock number about the shaft 5.0-5.5), the Bo 105 beep range (98-102 %)
// and the twin installation (systems.twinTurboshaft; the S0 drivetrain stub flies on engine 1 with engine 2 cut). The
// final geometry is dimensions.ts; the exterior (BX) and the sound (AU) build to it and to these rotor numbers.
import { DEG } from '../../core/math';
import type { RotorcraftDefinition } from '../../physics/rotorcraft/definition';
import { MD500_ROTORCRAFT as md } from '../md500/rotorcraft';
import * as D from './dimensions';
import { BO105_ENGINE_RATIO, BO105_N2_BEEP, BO105_NR_100, BO105_TAIL_RATIO } from './facts';
import { BO105_TWIN } from './twin';

const ts = md.systems.turboshaft!;

export const BO105_ROTORCRAFT: RotorcraftDefinition = {
  ...md,
  nominalRpm: BO105_NR_100, referenceRpm: BO105_NR_100,
  engineRatio: BO105_ENGINE_RATIO, tailRatio: BO105_TAIL_RATIO,
  systems: { ...md.systems,
    turboshaft: { ...ts, governor: { ...ts.governor, setRange: BO105_N2_BEEP.range, setDefault: BO105_N2_BEEP.setDefault } },
    twinTurboshaft: BO105_TWIN },
  main: { ...md.main, radius: D.MAIN_ROTOR_RADIUS, rootCutout: D.MAIN_ROTOR_ROOT_CUTOUT, chord: D.MAIN_ROTOR_CHORD,
    blades: D.MAIN_ROTOR_BLADES, twist: D.MAIN_ROTOR_TWIST_DEG * DEG, inertia: 900 },
  tail: { ...md.tail, radius: D.TAIL_ROTOR_RADIUS, chord: D.TAIL_ROTOR_CHORD, blades: D.TAIL_ROTOR_BLADES,
    twist: D.TAIL_ROTOR_TWIST_DEG * DEG },
};
