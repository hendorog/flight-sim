// MBB Bo 105 CB-4: the twin turboshaft installation data (systems.twinTurboshaft). Owner after the scaffold: TW (the
// drivetrain package that implements src/physics/rotorcraft/twinTurboshaft.ts). S0 values; tags as facts.ts. Plan
// revision 2, sections 3.2 and 5.
import type { TwinTurboshaftDef } from '../../physics/rotorcraft/twinTurboshaft';
import { BO105_TORQUE_PCT, BO105_TOT_C, BO105_WARNINGS } from './facts';

export const BO105_TWIN: TwinTurboshaftDef = {
  engines: 2,
  /** ENGINE TRIM left/right on the collective (P5 FM 7-12): differential set-point rate and authority. ESTIMATE. */
  splitTrim: { rate: 0.01, range: 0.03 },
  /** Engine 2 governor rig mismatch: a 4 +/- 2 % torque split at hover until the pilot synchronises (FM 4-16 "Torque -
   *  synchronize"). AGENT choice (remove it if the owner dislikes it); S0 value ESTIMATE. */
  rigMismatch: 0.004,
  oei: { mcpPct: BO105_TORQUE_PCT.oei, mcpTotC: BO105_TOT_C.mcp, emergencyPct: BO105_TORQUE_PCT.oei,
    emergencyTotC: BO105_TOT_C.takeoff, emergencySeconds: BO105_TORQUE_PCT.oeiEmergencySeconds },
  warnings: { n1SplitPct: BO105_WARNINGS.n1SplitPct, nrLowPct: BO105_WARNINGS.nrLowPct, nrHighPct: BO105_WARNINGS.nrHighPct,
    nrHighTonePct: BO105_WARNINGS.nrHighTonePct },
};
