// R22 reference metadata and POH checklists. No fixed-wing Flight School procedures, limits or lesson speeds
// are inherited. The legacy school schema requires numeric slots; zero explicitly means unavailable.
// Published speeds: POH 4-1 (Vy 53, approach 60), 3-3 (maximum-distance autorotation 75 at 90% NR), 2-1 (Vne).
// A normal autorotation is 65 KIAS at 97–110% (3-2), distinct from maximum-distance configuration.
import { R22_CHECKLISTS } from './checklists';
import type { AircraftTypeDef, ChecklistDef, VSpeedId } from '../../training/types';
import { R22_INSTRUMENT_REFERENCE as V } from './reference';

const VSPEEDS: Record<VSpeedId, number> = {
  Vs0: 0, Vs1: 0, Vr: 0, Vx: 0, Vy: 53, Vcc: 0, Vglide: 75, Va: 0,
  Vfe10: 0, VfeFull: 0, Vno: 0, Vne: V.vne, Vapp: 60, VappFlapsUp: 0, Vref: 0,
  VshortField: 0, Vcruise: 0, Vslow: 0, VsteepTurn: 0, Vdescent: 0, Vdownwind: 0, Vtaxi: 0,
};
// Retain inactive fixed-wing registry slots. Empty lists are omitted from the reference panel.
const UNAVAILABLE = {
  hasell: { id: 'hasell', title: 'Procedure not available', items: [] },
  downwind: { id: 'downwind', title: 'Procedure not available', items: [] },
  forcedLandingSecurity: { id: 'forcedLandingSecurity', title: 'Procedure not available', items: [] },
  nightLights: { id: 'nightLights', title: 'Procedure not available', items: [] },
} satisfies Record<string, ChecklistDef>;

export const R22_TRAINING: AircraftTypeDef = {
  id: 'r22', icaoType: 'R22', name: 'Robinson R22 Beta II', registration: 'N22FS', classRating: null,
  vspeeds: VSPEEDS,
  unavailableVSpeeds: (Object.keys(VSPEEDS) as VSpeedId[]).filter(id => VSPEEDS[id] === 0),
  // Only the POH run-up and magnetic drop figures have a meaning in these legacy settings.
  settings: { patternAglFt: 0, cruiseRpm: 0, descentRpm: 0, circuitRpm: 0,
    runupRpm: 0.75 * V.engineRpm100, magDropMaxRpm: 0.07 * V.engineRpm100, magDiffMaxRpm: 0,
    approachFlapLever: 0, takeoffFlapLever: 0, shortFieldFlapLever: 0, maxDemoCrosswindKt: 0 },
  flapDetentsDeg: [0], flapLeverForDeg: { 0: 0 },
  // No airplane manoeuvring envelope: these required, inactive legacy fields are not helicopter limits.
  limits: { gPos: 0, gNeg: 0, maxDemoCrosswindKt: 0 },
  envelope: { maxBankDeg: 0, maxPitchUpDeg: 0, maxPitchDownDeg: 0, maxKias: V.vne, maxG: 0, minG: 0,
    minAglFt: 0, lowAndSlow: { aglFt: 0, belowKias: 0 }, maxSinkFpmBelow200: 0, stallAllowed: false, runwayExcursionM: 0 },
  checklists: { ...UNAVAILABLE, ...R22_CHECKLISTS },
  school: { syllabus: false, reason: 'Helicopter lessons are not implemented; use the in-flight checklist (F).' },
};
