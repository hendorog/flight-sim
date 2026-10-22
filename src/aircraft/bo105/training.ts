// MBB Bo 105 CB-4: Flight School type data and reference speeds. No syllabus (helicopter lessons are not built) but the
// type's V-speeds, settings and FM checklists are real. Speeds (reference.ts): Vne 145 KIAS to 2400 kg (P TCDS p10), Vy 60
// (P5 FM 5), autorotation 75 KIAS recommended (P5 FM 3-34; minimum descent 60 and maximum glide 100 at 85 % NR are in the
// checklist text and the docs: the shared V-speed slots have one helicopter descent slot and one glide slot). Run-up: N2 trimmed
// to 98 % before take-off (P5 FM 4-16).
import type { AircraftTypeDef, ChecklistDef, VSpeedId } from '../../training/types';
import { BO105_CHECKLISTS } from './checklists';
import { BO105_N2_100_RPM } from './facts';
import { BO105_REFERENCE as V } from './reference';

const VSPEEDS: Record<VSpeedId, number> = {
  // Slots with no helicopter meaning (no stall, rotation, flaps or Vno) are 0 = unavailable.
  Vs0: 0, Vs1: 0, Vr: 0, Vx: 0, Vy: V.vy, Vcc: 0,
  // Vglide: maximum glide (100 KIAS at 85 % NR). Vdescent: the recommended autorotation speed (75 KIAS).
  Vglide: V.maxGlideKias, Va: 0, Vfe10: 0, VfeFull: 0, Vno: 0, Vne: V.vne,
  Vapp: 0, VappFlapsUp: 0, Vref: 0, VshortField: 0, Vcruise: 0, Vslow: 0, VsteepTurn: 0,
  Vdescent: V.autorotationKias, Vdownwind: 0, Vtaxi: 0,
};
const none = (id: string): ChecklistDef => ({ id, title: 'Procedure not available', items: [] });
const UNAVAILABLE = { hasell: none('hasell'), downwind: none('downwind'), final: none('final'),
  forcedLandingSecurity: none('forcedLandingSecurity'), nightLights: none('nightLights') };

export const BO105_TRAINING: AircraftTypeDef = {
  id: 'bo105', icaoType: 'B105', name: 'MBB Bo 105 CB-4', registration: 'D-HBOX',
  // A twin-engine helicopter has no aeroplane class rating (tests/training/aircraftTypes.test.ts).
  classRating: null,
  vspeeds: VSPEEDS,
  unavailableVSpeeds: (Object.keys(VSPEEDS) as VSpeedId[]).filter(id => VSPEEDS[id] === 0),
  settings: { patternAglFt: 0, cruiseRpm: 0, descentRpm: 0, circuitRpm: 0,
    runupRpm: 0.98 * BO105_N2_100_RPM, magDropMaxRpm: 0, magDiffMaxRpm: 0,
    approachFlapLever: 0, takeoffFlapLever: 0, shortFieldFlapLever: 0, maxDemoCrosswindKt: 0 },
  flapDetentsDeg: [0], flapLeverForDeg: { 0: 0 },
  // No airplane manoeuvring envelope: these required, inactive legacy fields are not helicopter limits.
  limits: { gPos: 0, gNeg: 0, maxDemoCrosswindKt: 0 },
  envelope: { maxBankDeg: 0, maxPitchUpDeg: 0, maxPitchDownDeg: 0, maxKias: V.vne, maxG: 0, minG: 0,
    minAglFt: 0, lowAndSlow: { aglFt: 0, belowKias: 0 }, maxSinkFpmBelow200: 0, stallAllowed: false, runwayExcursionM: 0 },
  checklists: { ...UNAVAILABLE, ...BO105_CHECKLISTS },
  school: { syllabus: false, reason: 'Helicopter lessons are unavailable. The FM checklists are on F; the twin start, ENGINE TRIM and OEI procedures are modelled.' },
};
