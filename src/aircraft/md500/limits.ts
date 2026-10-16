// MD 500E (369E, 250-C20B): airspeed and rotor/engine limits as data. Owner: T2.
import { FT, LB } from '../../core/math';
import type { SpeedCorrections, SpeedPlacard } from '../../physics/rotorcraft/limits';
import { MD500_REFERENCE as V } from './reference';

/** RFM Fig 2-6 columns: pressure altitude x 1000 ft. */
const ALTITUDES_KFT = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18] as const;
/** RFM Fig 2-6 rows: OAT, C (note the last step is 5 C, not 10). */
export const MD500_VNE_OAT_C = [-30, -20, -10, 0, 10, 20, 30, 40, 45] as const;

/**
 * RFM Fig 2-6 (CSP-E-1 pp 2-15/2-16, Rev 14), 250-C20B, transcribed cell for cell from the rendered sheets:
 * rows = OAT (MD500_VNE_OAT_C), columns = Hp 0..18 thousand ft; 0 = NO FLIGHT; the merged "152" block written out.
 * P. Rows as printed (OAT across the page down); the placard grid below is the transpose the reader wants.
 */
export const MD500_VNE_TABLES = {
  /** GROSS WT = 2000 LB OR LESS. */
  light: [
    [141, 136, 131, 127, 122, 118, 113, 109, 104, 0],
    [149, 144, 139, 134, 129, 124, 119, 115, 101, 0],
    [152, 151, 145, 140, 135, 130, 125, 110, 0, 0],
    [152, 152, 152, 146, 141, 136, 121, 102, 0, 0],
    [152, 152, 152, 152, 146, 137, 111, 0, 0, 0],
    [152, 152, 152, 151, 143, 123, 104, 0, 0, 0],
    [152, 152, 152, 148, 140, 114, 0, 0, 0, 0],
    [152, 152, 152, 144, 127, 106, 0, 0, 0, 0],
    [152, 152, 150, 143, 122, 103, 0, 0, 0, 0],
  ],
  /** GROSS WT = 2001 TO 2500 LB. */
  medium: [
    [141, 136, 131, 127, 122, 118, 113, 104, 90, 0],
    [149, 144, 139, 134, 129, 124, 113, 96, 84, 0],
    [152, 151, 145, 140, 135, 123, 104, 90, 0, 0],
    [152, 152, 152, 146, 138, 113, 97, 85, 0, 0],
    [152, 152, 152, 152, 124, 105, 91, 0, 0, 0],
    [152, 152, 152, 143, 115, 98, 86, 0, 0, 0],
    [152, 152, 152, 127, 107, 93, 0, 0, 0, 0],
    [152, 152, 152, 117, 100, 88, 0, 0, 0, 0],
    [152, 152, 137, 113, 98, 85, 0, 0, 0, 0],
  ],
  /** GROSS WT = 2501 TO 3000 LB. */
  heavy: [
    [141, 136, 131, 127, 122, 115, 100, 85, 73, 0],
    [149, 144, 139, 134, 125, 106, 92, 79, 67, 0],
    [152, 151, 145, 139, 115, 99, 85, 73, 0, 0],
    [152, 152, 152, 125, 107, 93, 80, 68, 0, 0],
    [152, 152, 140, 116, 100, 86, 74, 0, 0, 0],
    [152, 152, 126, 108, 94, 81, 69, 0, 0, 0],
    [152, 144, 117, 102, 88, 76, 0, 0, 0, 0],
    [152, 129, 110, 95, 82, 71, 0, 0, 0, 0],
    [152, 124, 106, 93, 80, 69, 0, 0, 0, 0],
  ],
} as const;

const transpose = (rows: readonly (readonly number[])[]): number[][] =>
  ALTITUDES_KFT.map((_, j) => rows.map((r) => r[j]));

/** The Fig 2-6 placards as the rotor-limit reader's grid: kias[altitude][temperature], three weight bands. */
export const MD500_VNE: SpeedPlacard = {
  altitudeStep: 2000 * FT, temperatureMin: 273.15 - 30, temperatureStep: 10,
  temperatures: MD500_VNE_OAT_C.map((c) => c + 273.15),
  kias: transpose(MD500_VNE_TABLES.light),
  massBands: [
    { aboveMass: 2000 * LB, kias: transpose(MD500_VNE_TABLES.medium) },
    { aboveMass: 2500 * LB, kias: transpose(MD500_VNE_TABLES.heavy) },
  ],
};

/**
 * RFM Fig 2-6 notes and RFM 2-1/2-2: autorotation Vne = chart - 22 kt, not below 85 / 90 / 95 kt by weight band,
 * never above the chart, at most 130 KIAS; doors off 130 KIAS. (MAX 130 below 35 lb fuel is not applied: the limit
 * reader does not see the fuel; the panel's FUEL LEVEL LOW caution carries it.) No heavy or high-power reduction.
 */
export const MD500_SPEED_CORRECTIONS: SpeedCorrections = {
  heavyMass: Infinity, heavyReduction: 0, powerOffReduction: 22, highPowerCap: Infinity,
  doorsOffCap: V.doorsOffVne, powerOffFloor: [85, 90, 95], powerOffCap: V.autorotationVne,
};
