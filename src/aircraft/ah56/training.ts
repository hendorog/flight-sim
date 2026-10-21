// Lockheed AH-56A Cheyenne: Flight School type data and reference speeds. No syllabus (helicopter lessons are not built) but the
// type's V-speeds, settings and the checklists paraphrased from the safety-of-flight releases are real. Speeds (reference.ts): Vne 195
// KCAS (INF, research-ah56 section 10: the sources give no Vne; pushovers began at 165 "to preclude exceeding Vne"), autorotation
// 85 - 95 KCAS (P ASTA-72 SoF), gear operation 130 KCAS (P). No published Vy: see VY_SLOT.
import type { AircraftTypeDef, ChecklistDef, VSpeedId } from '../../training/types';
import { AH56_CHECKLISTS } from './checklists';
import { AH56_NF_100_RPM } from './facts';
import { AH56_REFERENCE as V } from './reference';

/**
 * The generic Vy slot must be positive for a rotorcraft (tests/training/aircraftTypes.test.ts). A compound has no published best-climb
 * speed: 80 KCAS is where the collective schedule changes from "as required" to the cruise setting (P APE-I SoF 1.1 3b; AMCS-73 SoF 2b).
 * ESTIMATE: it is not a Vy, and no lesson reads it (no syllabus).
 */
const VY_SLOT = 80;
const VSPEEDS: Record<VSpeedId, number> = {
  // Slots with no helicopter meaning (no stall, rotation, flaps or Vno) are 0 = unavailable.
  Vs0: 0, Vs1: 0, Vr: 0, Vx: 0, Vy: VY_SLOT, Vcc: 0,
  // Vdescent: autorotation, the middle of 85 - 95 KCAS. The wheels-down limit speed 130 KCAS is in the checklists and hints.
  Vglide: 0, Va: 0, Vfe10: 0, VfeFull: 0, Vno: 0, Vne: V.vne,
  Vapp: 0, VappFlapsUp: 0, Vref: 0, VshortField: 0, Vcruise: 0, Vslow: 0, VsteepTurn: 0,
  Vdescent: (V.autorotationKcas[0] + V.autorotationKcas[1]) / 2, Vdownwind: 0, Vtaxi: 0,
};
const none = (id: string): ChecklistDef => ({ id, title: 'Procedure not available', items: [] });
const UNAVAILABLE = { hasell: none('hasell'), downwind: none('downwind'), final: none('final'),
  forcedLandingSecurity: none('forcedLandingSecurity'), nightLights: none('nightLights') };

export const AH56_TRAINING: AircraftTypeDef = {
  id: 'ah56', icaoType: 'ZZZZ', name: 'Lockheed AH-56A Cheyenne', registration: '66-8832', classRating: null,
  vspeeds: VSPEEDS,
  unavailableVSpeeds: (Object.keys(VSPEEDS) as VSpeedId[]).filter(id => VSPEEDS[id] === 0),
  // Run-up: Nf at 100 %.
  settings: { patternAglFt: 0, cruiseRpm: 0, descentRpm: 0, circuitRpm: 0,
    runupRpm: AH56_NF_100_RPM, magDropMaxRpm: 0, magDiffMaxRpm: 0,
    approachFlapLever: 0, takeoffFlapLever: 0, shortFieldFlapLever: 0, maxDemoCrosswindKt: 0 },
  flapDetentsDeg: [0], flapLeverForDeg: { 0: 0 },
  // No airplane manoeuvring envelope: these required, inactive legacy fields are not helicopter limits.
  limits: { gPos: 0, gNeg: 0, maxDemoCrosswindKt: 0 },
  envelope: { maxBankDeg: 0, maxPitchUpDeg: 0, maxPitchDownDeg: 0, maxKias: V.vne, maxG: 0, minG: 0,
    minAglFt: 0, lowAndSlow: { aglFt: 0, belowKias: 0 }, maxSinkFpmBelow200: 0, stallAllowed: false, runwayExcursionM: 0 },
  checklists: { ...UNAVAILABLE, ...AH56_CHECKLISTS },
  school: { syllabus: false, reason: 'Helicopter lessons are unavailable. The checklists on F follow the safety-of-flight releases; the control gyro, compound and panel are built in stages.' },
};
