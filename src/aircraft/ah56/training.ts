// Lockheed AH-56A Cheyenne: Flight School type data. SCAFFOLD STUB (owner after the scaffold: PN): the MD 500E's metadata
// under the AH-56A identity. No syllabus.
import type { AircraftTypeDef } from '../../training/types';
import { MD500_TRAINING } from '../md500/training';

export const AH56_TRAINING: AircraftTypeDef = {
  ...MD500_TRAINING,
  id: 'ah56', icaoType: 'ZZZZ', name: 'Lockheed AH-56A Cheyenne', registration: '66-8832',
  school: { syllabus: false, reason: 'AH-56A in development: control gyro, compound and panel are being built in stages; no lessons.' },
};
