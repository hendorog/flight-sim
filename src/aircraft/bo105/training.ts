// MBB Bo 105 CB-4: Flight School type data. SCAFFOLD STUB (owner after the scaffold: PN): the MD 500E's metadata under the
// Bo 105 identity until PN writes the Bo 105's (Vne 145, Vy 60, autorotation 75/60/100 KIAS). No syllabus.
import type { AircraftTypeDef } from '../../training/types';
import { MD500_TRAINING } from '../md500/training';

export const BO105_TRAINING: AircraftTypeDef = {
  ...MD500_TRAINING,
  id: 'bo105', icaoType: 'B105', name: 'MBB Bo 105 CB-4', registration: 'D-HBOX',
  school: { syllabus: false, reason: 'Bo 105 in development: hingeless rotor, twin drivetrain and panel are being built; no lessons.' },
};
