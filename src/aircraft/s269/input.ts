import type { InputProfile } from '../../input/profile';
import { R22_INPUT } from '../r22/input';
// Position-controlled hardware; the keyboard centre follows powered spring-trim anchors.
// Trim motor speed/force calibration remains estimated.
export const S269_INPUT: InputProfile = { ...R22_INPUT, rotorGovernor: false, threePositionClutch: true, springTrim: true,
  labels: { ...R22_INPUT.labels, trimNoseUp: 'Longitudinal spring trim aft (hold)',
    trimNoseDown: 'Longitudinal spring trim forward (hold)', rudderTrimLeft: 'Lateral spring trim left (hold)',
    rudderTrimRight: 'Lateral spring trim right (hold)', rotorClutch: 'Clutch ENGAGE / HOLD / RELEASE (guard open)' } };
