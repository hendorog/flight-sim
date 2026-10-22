// Lockheed AH-56A Cheyenne: airspeed limits as data. Owner: AG (stage 2).
//
// No V_NE number is printed in the safety-of-flight releases read (research-ah56 sect. 10, gap 7): the AMCS push-overs had
// to begin at or below 165 KCAS "to preclude exceeding V_NE", and the ICS envelope reached 190 KCAS, so V_NE is about
// 195 KCAS (INF / ESTIMATE, reference.ts). The placard below is that one value at every pressure altitude up to the
// 10,500 ft density-altitude release (P 1972) and every temperature; there is no weight band (none published). Power
// off: the autorotation airspeed band is 85-95 KCAS (P) and recovery is required; the power-off limit is held at the gear
// limit, 130 KCAS (ESTIMATE). This is the compound's placard; at stage 2 (no wing, no pusher) the aircraft cannot reach it.
import { FT } from '../../core/math';
import type { SpeedCorrections, SpeedPlacard } from '../../physics/rotorcraft/limits';
import { AH56_REFERENCE as V } from './reference';

const COLUMNS = 6;
const row = (kias: number): number[] => Array.from({ length: COLUMNS }, () => kias);

/** Pressure altitude 0-12,000 ft in 2,000 ft steps (rows), OAT -40..+60 C in 20 C steps (columns): V_NE everywhere. */
export const AH56_VNE: SpeedPlacard = {
  altitudeStep: 2000 * FT, temperatureMin: 273.15 - 40, temperatureStep: 20,
  kias: Array.from({ length: 7 }, () => row(V.vne)),
};

/** Power off: 130 KCAS (ESTIMATE); no heavy, high-power or doors-off reductions (none published). */
export const AH56_SPEED_CORRECTIONS: SpeedCorrections = {
  heavyMass: Infinity, heavyReduction: 0, powerOffReduction: V.vne - V.gearKcas, highPowerCap: Infinity,
  doorsOffCap: Infinity, powerOffCap: V.gearKcas, powerOffFloor: [V.gearKcas],
};
