import type { AircraftPresentation } from '../types';
import { C152_PRESENTATION } from '../c152/presentation';
import { HP } from '../../core/math';
import { R22_ROTORCRAFT } from './rotorcraft';
import { R22_VISUAL } from './visual';
import { R22_PANEL, R22_INSTRUMENT_SYSTEMS } from './panel';
import { R22_UI } from './ui';
export { R22_UI } from './ui';

const checklists = { ...C152_PRESENTATION.training.checklists };
for (const id of Object.keys(checklists) as (keyof typeof checklists)[])
  checklists[id] = { ...checklists[id], items: [] };

export const R22_PRESENTATION: AircraftPresentation = {
  ...C152_PRESENTATION, id: 'r22', visual: R22_VISUAL, ui: R22_UI,
  instrumentSystems: R22_INSTRUMENT_SYSTEMS,
  audio: { ...C152_PRESENTATION.audio, flapMotor: false, busPoweredV: 10,
    stallWarner: { kind: 'electric', baseHz: 800, sweepHz: 0, needsBus: true },
    engines: [{ engine: { ...C152_PRESENTATION.audio.engines[0].engine, ratedPowerW: 131 * HP,
      gearRatio: R22_ROTORCRAFT.engineRatio },
      prop: { blades: 2, diameterM: R22_ROTORCRAFT.main.radius * 2, cruiseThrustN: 6000, level: 1 } }] },
  panel: R22_PANEL,
  // Legacy training schema requires airplane fields. No R22 lessons or checklists are published.
  training: { ...C152_PRESENTATION.training, id: 'r22', icaoType: 'R22',
    name: 'Robinson R22 Beta II (experimental)', registration: 'N22FS', registrations: undefined,
    systems: undefined, controls: undefined, flapDetentsDeg: [0], flapLeverForDeg: { 0: 0 },
    vspeeds: { ...C152_PRESENTATION.training.vspeeds, Vs0: 0, Vs1: 0, Vr: 0, Vx: 53, Vy: 53,
      Vglide: 65, Va: 0, Vno: 102, Vne: 102, Vapp: 60, Vref: 0, Vcruise: 80, Vdownwind: 70 },
    checklists,
    school: { syllabus: false, reason: 'Helicopter lessons and checklists are not implemented.' } },
};
export default R22_PRESENTATION;
