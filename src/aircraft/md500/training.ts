// MD 500E: Flight School type data. SCAFFOLD STUB (owner: M3): the Schweizer 300CB's metadata under the MD 500E
// identity until M3 writes the 500E's (RFM V-speeds, settings, checklists). No syllabus.
import type { AircraftTypeDef } from '../../training/types';
import { S269_TRAINING } from '../s269/training';

export const MD500_TRAINING: AircraftTypeDef = {
  ...S269_TRAINING,
  id: 'md500', icaoType: 'H500', name: 'MD Helicopters MD 500E', registration: 'N500EA',
  school: { syllabus: false, reason: 'MD 500E in development: turboshaft, freewheel and panel are being built; no lessons or guided checklists.' },
};
