// MBB Bo 105 CB-4: airspeed limits as data (the rotor-limit reader's placard, src/physics/rotorcraft/limits.ts). Owner:
// BO. Tags: P = EASA TCDS EASA.R.011 Issue 3 (page); P5 = BO 105 CB-5/CBS-5 Flight Manual used for the CB-4 (Section 2
// matches the CB-4 TCDS limits, docs/bo105-sources.md); D = derived; ESTIMATE = no source.
import { FT } from '../../core/math';
import type { SpeedCorrections, SpeedPlacard } from '../../physics/rotorcraft/limits';
import { BO105_REFERENCE as V } from './reference';

/** FM Fig 2-2 columns: OAT, C (non-uniform: -45, then -30 to +50 in tens, then +54). P5 */
export const BO105_VNE_OAT_C = [-45, -30, -20, -10, 0, 10, 20, 30, 40, 50, 54] as const;
/** FM Fig 2-2 rows: pressure altitude, ft (2000 ft steps to 16,000, then the 17,000 ft maximum, P TCDS p10). P5 */
export const BO105_VNE_PA_FT = [0, 2000, 4000, 6000, 8000, 10_000, 12_000, 14_000, 16_000, 17_000] as const;

/**
 * FM Fig 2-2 (P5 FM 2-4, Rev 0), Vne KIAS, transcribed cell for cell from the page's text layer (research-bo105 section 3):
 * rows = pressure altitude (BO105_VNE_PA_FT), columns = OAT (BO105_VNE_OAT_C); 0 = "-" on the chart (outside the
 * operating envelope: no flight). The CB-5 chart is printed for gross mass up to 2300 kg; for the CB-4 the TCDS weight
 * break applies instead: this table up to 2400 kg (P TCDS p10: 145 KIAS up to 2400 kg), BO105_VNE_HEAVY_REDUCTION above.
 */
export const BO105_VNE_TABLE: readonly (readonly number[])[] = [
  [145, 145, 145, 145, 145, 145, 145, 140, 140, 135, 135],
  [140, 145, 145, 145, 145, 140, 140, 135, 135, 130, 130],
  [135, 145, 145, 140, 140, 135, 135, 130, 130, 125, 0],
  [130, 140, 140, 135, 135, 130, 130, 125, 120, 115, 0],
  [125, 135, 135, 130, 130, 125, 120, 115, 110, 0, 0],
  [120, 130, 130, 125, 120, 115, 110, 105, 100, 0, 0],
  [115, 125, 120, 115, 110, 105, 100, 95, 90, 0, 0],
  [110, 115, 110, 105, 100, 95, 90, 85, 0, 0, 0],
  [105, 105, 100, 95, 90, 85, 80, 80, 0, 0, 0],
  [100, 100, 95, 90, 85, 80, 80, 0, 0, 0, 0],
];
/**
 * Above 2400 kg the CB-4's Vne is 130 KIAS at sea level instead of 145 (P TCDS p10): the whole chart less 15 KIAS
 * (ESTIMATE: the CB-5 FM's own heavy rule is "-10 KIAS above 2300 kg"; 15 matches the TCDS 145/130 pair).
 */
export const BO105_VNE_HEAVY_REDUCTION = 15;
export const BO105_VNE_HEAVY_MASS_KG = V.vneWeightBreakKg;

/**
 * The reader's grid needs a uniform altitude step: 1000 ft rows, the FM's rows at the even thousands and each odd row
 * the mean of its neighbours (D: what a bilinear read of the 2000 ft chart gives there; a row next to a "-" cell is
 * "-"), up to 17,000 ft (the FM's last row). Columns = OAT (BO105_VNE_OAT_C, in K for the reader).
 */
function placardGrid(table: readonly (readonly number[])[], reduction = 0): number[][] {
  const at = (ft: number): number[] => {
    const i = BO105_VNE_PA_FT.indexOf(ft as typeof BO105_VNE_PA_FT[number]);
    if (i >= 0) return table[i].map((v) => (v > 0 ? v - reduction : 0));
    const below = at(ft - 1000), above = at(ft + 1000);
    return below.map((v, j) => (v > 0 && above[j] > 0 ? (v + above[j]) / 2 : 0));
  };
  const rows: number[][] = [];
  for (let ft = 0; ft <= 17_000; ft += 1000) rows.push(at(ft));
  // Transposed to the reader's kias[altitude][temperature]: already in that order (rows = altitude).
  return rows;
}

/** FM Fig 2-2 as the rotor-limit reader's grid, with the CB-4 weight break (P TCDS p10). */
export const BO105_VNE: SpeedPlacard = {
  altitudeStep: 1000 * FT, temperatureMin: 273.15 - 45, temperatureStep: 10,
  temperatures: BO105_VNE_OAT_C.map((c) => c + 273.15),
  kias: placardGrid(BO105_VNE_TABLE),
  massBands: [{ aboveMass: BO105_VNE_HEAVY_MASS_KG, kias: placardGrid(BO105_VNE_TABLE, BO105_VNE_HEAVY_REDUCTION) }],
};

/**
 * P5 FM 2-4: in autorotation (and OEI) the maximum is 100 KIAS or the chart, whichever is less (the ASI's blue radial at
 * 100 kt, P5 FM 2-18). No doors-off, heavy or high-power reduction is published (the weight break is the placard's mass
 * band). The OEI 100 KIAS limit is not read by the limit reader (KNOWN_ISSUES).
 */
export const BO105_SPEED_CORRECTIONS: SpeedCorrections = {
  heavyMass: Infinity, heavyReduction: 0, powerOffReduction: 0, highPowerCap: Infinity, doorsOffCap: Infinity,
  powerOffFloor: [0, 0], powerOffCap: V.autorotationVne,
};
