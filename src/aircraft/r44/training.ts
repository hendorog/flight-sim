// R44 reference metadata and POH checklists; no lessons or validated cold-start simulation.
// POH 3-3: 90 KIAS maximum glide; 4-13: 60 KIAS initial approach.
// Vy 60 is retained scaffold metadata, not a validated best-climb result.
import { R44_CHECKLISTS } from './checklists';
import type { AircraftTypeDef, ChecklistDef, VSpeedId } from '../../training/types';
import { R44_REFERENCE as V } from './reference';

const VSPEEDS: Record<VSpeedId, number> = {
  Vs0: 0, Vs1: 0, Vr: 0, Vx: 0, Vy: 60, Vcc: 0, Vglide: 90, Va: 0,
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

export const R44_TRAINING: AircraftTypeDef = {
  id: 'r44', icaoType: 'R44', name: 'Robinson R44 Raven II', registration: 'N44FS', classRating: null,
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
  checklists: { ...UNAVAILABLE, ...R44_CHECKLISTS },
  school: { syllabus: false, reason: 'Helicopter lessons are unavailable. POH checklists are on F; exact closed-throttle starting and cold-start validation remain unfinished.' },
};
