// MD 500E: Flight School type data and reference speeds. No syllabus (helicopter lessons are not built) but the type's
// V-speeds, settings and RFM checklists are real. Speeds: RFM 2-2 Vne 152 KIAS (placard Fig 2-6 by weight, OAT, Hp),
// 5-7 Fig 5-3 Vy 62 KIAS, 3-3/4-24 autorotation minimum descent 60 / maximum glide 80 KIAS.
import type { AircraftTypeDef, ChecklistDef, VSpeedId } from '../../training/types';
import { MD500_CHECKLISTS } from './checklists';
import { MD500_N2_100_RPM } from './facts';
import { MD500_REFERENCE as V } from './reference';

const VSPEEDS: Record<VSpeedId, number> = {
  // Slots with no helicopter meaning (no stall, rotation, flaps or Vno) are 0 = unavailable.
  Vs0: 0, Vs1: 0, Vr: 0, Vx: 0, Vy: V.vy, Vcc: 0,
  // Vglide: maximum glide (80 KIAS, Nr 410). The minimum-descent 60 KIAS rides in Vdescent (the slot's only helicopter use).
  Vglide: V.maxGlideKias, Va: 0, Vfe10: 0, VfeFull: 0, Vno: 0, Vne: V.vne,
  Vapp: 0, VappFlapsUp: 0, Vref: 0, VshortField: 0, Vcruise: 0, Vslow: 0, VsteepTurn: 0,
  Vdescent: V.autorotationKias, Vdownwind: 0, Vtaxi: 0,
};
const none = (id: string): ChecklistDef => ({ id, title: 'Procedure not available', items: [] });
const UNAVAILABLE = { hasell: none('hasell'), downwind: none('downwind'), final: none('final'),
  forcedLandingSecurity: none('forcedLandingSecurity'), nightLights: none('nightLights') };

export const MD500_TRAINING: AircraftTypeDef = {
  id: 'md500', icaoType: 'H500', name: 'MD Helicopters MD 500E', registration: 'N500EA', classRating: null,
  vspeeds: VSPEEDS,
  unavailableVSpeeds: (Object.keys(VSPEEDS) as VSpeedId[]).filter(id => VSPEEDS[id] === 0),
  // Run-up: N2 102 % for the rigging and warning checks (RFM 4-19); the airplane magneto fields have no meaning.
  settings: { patternAglFt: 0, cruiseRpm: 0, descentRpm: 0, circuitRpm: 0,
    runupRpm: 1.02 * MD500_N2_100_RPM, magDropMaxRpm: 0, magDiffMaxRpm: 0,
    approachFlapLever: 0, takeoffFlapLever: 0, shortFieldFlapLever: 0, maxDemoCrosswindKt: 0 },
  flapDetentsDeg: [0], flapLeverForDeg: { 0: 0 },
  // No airplane manoeuvring envelope: these required, inactive legacy fields are not helicopter limits.
  limits: { gPos: 0, gNeg: 0, maxDemoCrosswindKt: 0 },
  envelope: { maxBankDeg: 0, maxPitchUpDeg: 0, maxPitchDownDeg: 0, maxKias: V.vne, maxG: 0, minG: 0,
    minAglFt: 0, lowAndSlow: { aglFt: 0, belowKias: 0 }, maxSinkFpmBelow200: 0, stallAllowed: false, runwayExcursionM: 0 },
  checklists: { ...UNAVAILABLE, ...MD500_CHECKLISTS },
  school: { syllabus: false, reason: 'Helicopter lessons are unavailable. RFM checklists are on F; the turboshaft start and shutdown are modelled.' },
};
