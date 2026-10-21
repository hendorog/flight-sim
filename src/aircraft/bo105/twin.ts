// MBB Bo 105 CB-4: the twin turboshaft installation data (systems.twinTurboshaft) and the Bo 105 engine indication
// block in the units of its gauges. Owner: TW (src/physics/rotorcraft/twinTurboshaft.ts implements it). Tags as
// facts.ts: P = EASA TCDS R.011 (page), P5 = BO 105 CB-5/CBS-5 Flight Manual used for the CB-4, P TM = BO 105 Training
// Manual, D = derived, ESTIMATE = no source. The calibration of each ESTIMATE: docs/twin-turboshaft.md.
import type { EngineDef } from '../../physics/propulsion/defs';
import type { TurboshaftControlDef } from '../../physics/rotorcraft/definition';
import { ALLISON_250_C20B } from '../md500/powerplant';
import type { TwinTurboshaftDef } from '../../physics/rotorcraft/twinTurboshaft';
import { BO105_N1_PCT, BO105_N2_BEEP, BO105_PCT_PER_NM, BO105_TORQUE_PCT, BO105_TOT_C, BO105_WARNINGS } from './facts';

export const BO105_TWIN: TwinTurboshaftDef = {
  engines: 2,
  /**
   * ENGINE TRIM left/right on the collective (P5 FM 7-12: raises one engine's torque while lowering the other's). Rate
   * and authority are not published. ESTIMATE: the split between the two governors' datums moves at 0.7 % N1/s, which
   * at hover (about 2.75 % torque per % N1 on the installed map) trades torque at about 2 %/s (T5: 1.5-3 %/s);
   * authority +/- 6 % N1 (about +/- 16 % torque split).
   */
  splitTrim: { rate: 0.007, range: 0.06 },
  /**
   * Engine 2's droop-compensator datum offset, N1 fraction: the rigging difference between the two governors that
   * leaves a torque split of about 4 % at hover after a run-up until the pilot synchronises with ENGINE TRIM left/right
   * (FM 4-16 "Torque - synchronize"; T5: 4 +/- 2 %). AGENT choice (set it to 0 to remove the effect); ESTIMATE value.
   */
  rigMismatch: 0.013,
  oei: { mcpPct: BO105_TORQUE_PCT.oei, mcpTotC: BO105_TOT_C.mcp, emergencyPct: BO105_TORQUE_PCT.oei,
    emergencyTotC: BO105_TOT_C.takeoff, emergencySeconds: BO105_TORQUE_PCT.oeiEmergencySeconds },
  warnings: { n1SplitPct: BO105_WARNINGS.n1SplitPct, nrLowPct: BO105_WARNINGS.nrLowPct, nrHighPct: BO105_WARNINGS.nrHighPct,
    nrHighTonePct: BO105_WARNINGS.nrHighTonePct,
    /** P TM 00-44 (warning box K-DW02/01; the table is partly garbled): the low-rotor light and 650 Hz tone cover NR
     *  75-95 %. The floor applies on the ground only (AGENT reading), so the unit is quiet at ground idle (about 60 %
     *  NR) but stays on in flight however low NR falls (P5 FM 3-16: "NR 95 % or less"). */
    nrLowFloorPct: 75 },
};

/**
 * The Bo 105's engine indication and limits for systems.turboshaft (spread over the single-engine control data): the
 * dual torque gauge in percent (100 % = 298 kW at 100 % N2, D), the per-engine AEO limits of P TCDS p9 / P5 FM 2-9 in
 * that unit, and the ENGINE OUT test that the twin's OEI flag uses. BO adopts it in rotorcraft.ts; the twin test rig
 * (tests/rotorcraft/twinRig.ts) flies it.
 */
export const BO105_TURBOSHAFT_INDICATION: Pick<TurboshaftControlDef, 'torqueGauge' | 'psiPerNm' | 'limits' | 'engineOut' | 'governor'> = {
  torqueGauge: 'percent',
  /**
   * Each engine's N2 governor and droop compensator. The law, gains, droop and beep rate are the MD 500E's 250-C20B
   * calibration (md500/rotorcraft.ts, F: the same engine and fuel control; docs/turboshaft-model.md); the beep range is
   * the Bo 105's (P5 FM 4-16). The compensator is re-rigged for two engines: on the MD 500E one engine carries the whole
   * torque, so its anticipation (0.65 N1 per unit collective) put the datum about 11 % N1 above each twin engine's
   * governed N1 at the hover and N2 sat 0.6-0.8 % above the set point. Here the datum meets the governed N1 at two
   * points on the twin rig (tests/rotorcraft/twinRig.ts, the S0 stub's rotor, sea level ISA, split synchronised):
   *   - flat pitch on the ground at 100 % NR: N1 77.3 % per engine (datumNg);
   *   - the 2200 kg hover: collective 0.490 of travel, N1 96.5 % per engine (anticipation = (0.965 - 0.773) / 0.490).
   * ESTIMATE (the Bo 105's compensator rigging is not published). BO re-fits both numbers on the real rotor by the same
   * two readings (docs/twin-turboshaft.md section 8).
   */
  governor: {
    setRange: BO105_N2_BEEP.range, setDefault: BO105_N2_BEEP.setDefault,
    beepRate: 0.01, droop: 0.05, anticipation: 0.39, datumNg: 0.773, gain: 4, integralGain: 1.5, lead: 0.15,
  },
  psiPerNm: BO105_PCT_PER_NM,
  limits: {
    // AEO: 86 % per engine for take-off (5 min, TOT to 810 C) and as MCP (TOT to 779 C) (P TCDS p9, P5 FM 2-9).
    mcpPsi: BO105_TORQUE_PCT.aeo, mcpPsiAboveTot: { psi: BO105_TORQUE_PCT.aeo, totC: BO105_TOT_C.mcp },
    takeoffPsi: BO105_TORQUE_PCT.aeo, takeoffSeconds: BO105_TORQUE_PCT.aeoTakeoffSeconds,
    // No transient torque rating is published for the FS 72B (P5 FM 2-9): the AEO limit stands for both.
    transientPsi: [BO105_TORQUE_PCT.aeo, BO105_TORQUE_PCT.aeo],
    totC: { mcp: BO105_TOT_C.mcp, takeoff: BO105_TOT_C.takeoff, transient6s: BO105_TOT_C.transient6s, start1s: BO105_TOT_C.start },
    n1Pct: { continuous: BO105_N1_PCT.continuous, transient15s: BO105_N1_PCT.transient15s },
    // The Bo 105 has no N2 avoid band: an empty range.
    n2AvoidPct: [0, 0],
  },
  // An engine is "out" below 55 % N1 (the 250-C20B's ENGINE OUT threshold on the MD 500E, F; below the 59-65 % idle, P5
  // FM 2-10); the per-engine low-rotor half follows the warning unit's 95 % NR (P5 FM 3-16).
  engineOut: { n1Below: 0.55, nrBelow: BO105_WARNINGS.nrLowPct / 100 },
};

/**
 * The freewheel coupling cap for systems.transmissionTorqueLimit, N m at each engine's output shaft: twice the OEI
 * rating, 2 x 95 % of 473 N m = 899 N m (plan 5: "2 x the 95 % torque, never binding"; D from P TCDS p9). A numerical
 * guard, not a pilot limit: the survivor tops at about 105 % (497 N m) at its N1 stop. Proposed for bo105/rotorcraft.ts
 * (BO); the S0 stub inherits the MD 500E's 965 N m (204 % of 298 kW) through its spread of the MD 500E's systems.
 */
export const BO105_TRANSMISSION_TORQUE_LIMIT_NM = 2 * BO105_TORQUE_PCT.oei / BO105_PCT_PER_NM;

const C20B_GG = ALLISON_250_C20B.turbine!.gasGenerator;

/**
 * The Allison 250-C20B as installed in the Bo 105 (proposed for bo105/powerplant.ts; BO owns the powerplant). On the MD
 * 500E map (md500/powerplant.ts) the twin rig reads 82 % Bo 105 torque at 95.8 % N1 / 657 C and 95 % at 98.5 % N1 /
 * 724 C, and one engine tops above 115 % torque at its 105 % N1 stop; the Bo 105's own sources pin its installed running
 * line lower:
 *   - P5 FM 4-17: the recommended cruise maximum is 82 % torque at 738 C TOT;
 *   - P TCDS p9: the OEI emergency rating is 283 kW (95 %) with N1 104 % and TOT 810 C (taken here as one running-line
 *     point at the 105 % N1 stop, FM red line, at sea level ISA and 100 % N2).
 * The map above 85 % N1 is re-drawn through those two anchors (gas power = shaft power + 18.6 kW, the power turbine's
 * friction and the accessories at 100 % N2, measured on the twin rig at 45 % torque); TOT is linear in gas power between
 * them (1.86 C/kW). On this map the rig reads 82 % at 99.6 % N1 / 737 C and 95 % at 104.9 % N1 / 809 C. The fuel flow
 * keeps the MD 500E map's specific consumption at each N1 (the consumption class, research-md500). Everything at and below
 * 85 % N1 (idle 64.5 %, light-off, the start, the snap deceleration) and the fuel control are the MD 500E's. ESTIMATE
 * (the interpolation; the two anchors are P5 and P). Consequence: the engine's 313 kW type rating (EASA IM.E.052) is not
 * reached in this installation (95 % = 283 kW at the N1 stop), so one engine cannot hold 100 % NR above about 100 % of
 * the twin's power: plan T7b.
 */
const MAP_NG = [0.60, 0.645, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95, 1.00, 1.05, 1.08, 1.10];
const MAP_POWER_KW = [14, 16, 32, 56, 89, 134, 180, 225, 266, 302, 318, 326];
const MAP_ITT_C = [470, 468, 466, 475, 495, 530, 570, 655, 744, 810, 845, 870];
export const BO105_INSTALLED_C20B: EngineDef = {
  ...ALLISON_250_C20B,
  name: 'Rolls-Royce (Allison) 250-C20B (Bo 105 installation)',
  turbine: { ...ALLISON_250_C20B.turbine!, gasGenerator: { ...C20B_GG, map: {
    ng: MAP_NG,
    // The MD 500E's fuel flow at the same N1 scaled with the gas power (its specific consumption kept).
    fuelFlow: C20B_GG.map.fuelFlow.map((flow, i) => flow * MAP_POWER_KW[i] * 1e3 / C20B_GG.map.power[i]),
    itt: MAP_ITT_C,
    power: MAP_POWER_KW.map((kw) => kw * 1e3),
  } } },
};
