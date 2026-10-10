// Placeholder metadata; RFM 5-1 Vy, 3-1 autorotation and 2-3 Vne. No training acceptance.
import type { AircraftTypeDef, ChecklistDef, VSpeedId } from '../../training/types';
import { S269_REFERENCE as V } from './reference';

const VSPEEDS: Record<VSpeedId, number> = {
  Vs0: 0, Vs1: 0, Vr: 0, Vx: 0, Vy: V.vy, Vcc: 0, Vglide: V.autorotationKias, Va: 0,
  Vfe10: 0, VfeFull: 0, Vno: 0, Vne: V.vne, Vapp: 0, VappFlapsUp: 0, Vref: 0,
  VshortField: 0, Vcruise: 0, Vslow: 0, VsteepTurn: 0, Vdescent: 0, Vdownwind: 0, Vtaxi: 0,
};
// Empty slots preserve the legacy registry contract without publishing airplane checklists under S269.
const CHECKLISTS = Object.fromEntries([
  'beforeStart', 'engineStart', 'afterStart', 'runup', 'beforeTakeoff', 'afterTakeoff', 'hasell', 'downwind',
  'final', 'afterLanding', 'shutdown', 'engineFailure', 'forcedLandingSecurity', 'nightLights',
].map(id => [id, { id, title: 'S269 — checklist unavailable', items: [] }])) as Record<string, ChecklistDef>;

export const S269_TRAINING: AircraftTypeDef = {
  id: 's269', icaoType: 'H269', name: 'Schweizer 269C-1 / 300CB (placeholder)', registration: 'N269FS', classRating: null,
  vspeeds: VSPEEDS,
  unavailableVSpeeds: (Object.keys(VSPEEDS) as VSpeedId[]).filter(id => VSPEEDS[id] === 0),
  // RFM 4-16/4-17: 2000 RPM, 125 RPM maximum drop; no startup checklist is published here.
  settings: { patternAglFt: 0, cruiseRpm: 0, descentRpm: 0, circuitRpm: 0,
    runupRpm: 2000, magDropMaxRpm: 125, magDiffMaxRpm: 0,
    approachFlapLever: 0, takeoffFlapLever: 0, shortFieldFlapLever: 0, maxDemoCrosswindKt: 0 },
  flapDetentsDeg: [0], flapLeverForDeg: { 0: 0 },
  // No airplane manoeuvring envelope: these required, inactive legacy fields are not helicopter limits.
  limits: { gPos: 0, gNeg: 0, maxDemoCrosswindKt: 0 },
  envelope: { maxBankDeg: 0, maxPitchUpDeg: 0, maxPitchDownDeg: 0, maxKias: V.vne, maxG: 0, minG: 0,
    minAglFt: 0, lowAndSlow: { aglFt: 0, belowKias: 0 }, maxSinkFpmBelow200: 0, stallAllowed: false, runwayExcursionM: 0 },
  checklists: CHECKLISTS,
  school: { syllabus: false, reason: '300CB scaffold: articulated dynamics and clutch/trim systems await validation; panel integration is incomplete; no lessons or guided checklists.' },
};
