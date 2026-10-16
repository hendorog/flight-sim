// Pilatus PC-12/47: Flight School type data. SCAFFOLD STUB (owner: P3): the Cessna 208's data under the PC-12's
// identity until P3 writes the PC-12 V-speeds, settings and checklists. No syllabus (the school teaches in the C172S).
import { C208 } from '../c208/training';
import type { AircraftTypeDef } from '../../training/types';

export const PC12: AircraftTypeDef = {
  ...C208,
  id: 'pc12',
  icaoType: 'PC12',
  name: 'Pilatus PC-12/47',
  registration: 'N47PC',
  registrations: { faa: 'N47PC', easa: 'HB-FSP' },
  school: { syllabus: false, reason: 'Lessons are flown in the Cessna 172S.' },
};
