// MD 500E (369E, 250-C20B): the RFM numbers the definition, limits and training read. Plain data; owner after the
// scaffold: T2. P = RFM CSP-E-1 Rev 16 / TCDS H3WE Rev 21 (page in the comment); M = MD marketing; D = derived.
import { HP, LB } from '../../core/math';

export const MD500_REFERENCE = {
  /** RFM 2-3: maximum gross weight (internal) and minimum flying weight. P */
  maxGrossLb: 3000, minFlyingLb: 1538,
  /** RFM 6-1: CG fwd 99.0 in at all weights; aft 103.0 at 3000 lb, linear to 107.4 at 1538 lb; lateral +/-3.0 in. P */
  cg: { forwardIn: 99.0, aftAtMaxIn: 103.0, aftAtMinIn: 107.4, lateralIn: 3.0 },
  /** RFM 6-7: sample basic weight 1510.0 lb at STA 109.0 (1982 sample report). P (sample aircraft) */
  sampleEmpty: { lb: 1510, stationIn: 109.0 },
  /** RFM 2-2: Vne 152 KIAS (placard Fig 2-6 by weight, OAT and Hp); autorotation 130; doors off 130; below 35 lb fuel 130. P */
  vne: 152, autorotationVne: 130, doorsOffVne: 130,
  /** RFM 5-7 Fig 5-3: Vy 62 KIAS from SL to about 5500 ft DA. P */
  vy: 62,
  /** RFM 3-3, 4-24: minimum rate of descent 60 KIAS, maximum glide 80 KIAS (both at 410 Nr). P */
  autorotationKias: 60, maxGlideKias: 80,
  /** RFM 4-25: collective full down, 2250 lb, SL, 60 kt: 485 +/- 5 rpm; -10 rpm per 100 lb less; +6.5 rpm per 1000 ft DA. P */
  autorotationRpm: { rpm: 485, tol: 5, atLb: 2250, perHundredLb: 10, perThousandFtDa: 6.5 },
  /** Installed power for the RotorcraftDefinition.systems documentation fields (TCDS p12). P */
  continuousPower: 350 * HP, takeoffPower: 375 * HP, takeoffSeconds: 300,
  /** RFM 1-13: usable fuel, kg. P */
  usableFuelKg: 421.9 * LB,
  /** M (spec p7): max rate of climb 1770 ft/min at "design gross weight"; max cruise 135 kt SL; fuel flow about 27 US gal/h (184 lb/h). */
  marketing: { rocFpm: 1770, cruiseKtas: 135, fuelFlowLbPerHour: 184 },
  /** RFM 2-2: maximum operating density altitude, ft. P */
  maxDensityAltitudeFt: 16_000,
} as const;
