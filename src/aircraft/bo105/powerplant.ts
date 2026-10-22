// MBB Bo 105 CB-4: the powerplant. Owner: BO. Tags: P = EASA TCDS EASA.R.011 Issue 3 (page); P5 = BO 105 CB-5/CBS-5
// Flight Manual used for the CB-4; P MM = Maintenance Manual; D = derived; F = family; ESTIMATE = no source.
//
// Two Allison (Rolls-Royce) 250-C20B (P TCDS p9) on the ZF FS 72B through two freewheels (the twin drivetrain is TW's,
// src/physics/rotorcraft/twinTurboshaft.ts; data bo105/twin.ts). Each engine is the 250-C20B as installed in the Bo 105
// (BO105_ENGINE, below). Two fuel feeds and two 150 A starter-generators (engine 0 = engine 1 on the panel, the LEFT
// power lever; engine 1 = engine 2). Two fuel tanks under the cabin floor: the supply tank (index 0, `fuel.left`) and
// the main tank (index 1, `fuel.right`), as the panel reads them (PN).
import type { EngineDef, PowerplantDef } from '../../physics/propulsion/defs';
import { MD500_POWERPLANT } from '../md500/powerplant';
import { BO105_INSTALLED_C20B } from './twin';
import { BO105_BUS_DEAD_VOLTS, BO105_FUEL, BO105_GENERATOR_AMPS, BO105_N1_100_RPM, BO105_NOMINAL_VOLTS } from './facts';
import { x, z } from './dimensions';

const md = MD500_POWERPLANT;

/**
 * The 250-C20B as installed in the Bo 105: TW's installed map (BO105_INSTALLED_C20B, twin.ts), the MD 500E's 250-C20B
 * re-drawn above 85 % N1 through the Bo 105's two anchors, 82 % torque at 738 C (P5 FM 4-17) and 95 % (283 kW) at the
 * 105 % N1 stop and 810 C (P TCDS p9); its power-turbine law is the MD 500E's (stallTorqueRatio 3, ESTIMATE). A law of 2
 * was tried (the repo's PT6A types) and rejected: it cut the engines' torque at low N2 so that both levers at IDLE held
 * the rotor at 52 % NR on the ground against the FM's "about 60 %" (P5 FM 4-11; 3 gives 59 %), while on this rotor the
 * law of 3 no longer breaks the OEI torque bound TW found on the scaffold's rotor (a survivor at its N1 stop reads 103 %
 * at 96.5 % NR here, docs/bo105-flight-model.md "Engines").
 */
export const BO105_ENGINE: EngineDef = BO105_INSTALLED_C20B;

/**
 * Transfer: the main tank's two pumps keep the supply tank full until the main tank is empty (P5 FM 7-14; LOW FUEL at
 * 60 kg in the supply tank then means about 60 kg left in all, P5 FM 3-13). The fuel system draws equal shares from
 * the listed tanks that hold fuel (fuelSystem.ts), so each feed lists the main tank fifty times and the supply tank
 * once: the supply tank gives 1/51 of the flow while the main tank holds fuel (74 -> 66.5 kg by the time the main tank
 * is empty), then all of it. An approximation of the transfer pumps (ESTIMATE; a sequential draw is requested from the
 * fuel system's owner in PR text). Pump failures are not modelled.
 */
const SUPPLY = 0, MAIN = 1;
const MAIN_THEN_SUPPLY: readonly number[] = [...Array.from({ length: 50 }, () => MAIN), SUPPLY];

const feed = {
  ...md.fuel.feeds[0],
  // The EMERG FUEL VALVE (guarded, centre console, P5 FM Fig 7-4) is the per-engine fuel selector: open (on / both)
  // or closed (off).
  positions: { on: MAIN_THEN_SUPPLY, both: MAIN_THEN_SUPPLY },
};

export const BO105_POWERPLANT: PowerplantDef = {
  ...md,
  engines: [0, 1].map(() => ({ ...md.engines[0], engine: BO105_ENGINE })),
  fuel: {
    tanks: [
      // Three underfloor bladder cells forming two tanks (P5 FM 7-14; P TM 00-6). Supply 74 kg usable aft of the front
      // cross tube; main 382 kg in two cells fore and aft of the rear cross tube (P TCDS p9, P MM ch 06 p6; 0.8 kg/l).
      // Centroids 3V ESTIMATE: under the cabin floor (0.62 m above the soles), about 0.50 m above the soles.
      { id: 'supply', side: 'left', capacity: BO105_FUEL.supplyKg, position: { x: x(2.55), y: 0, z: z(0.50) } },
      { id: 'main', side: 'right', capacity: BO105_FUEL.mainKg, position: { x: x(3.65), y: 0, z: z(0.50) } },
    ],
    feeds: [feed, feed],
  },
  electrical: {
    ...md.electrical,
    nominalVolts: BO105_NOMINAL_VOLTS,
    // 24 V NiCd battery in the nose compartment (P5 FM 7-31); capacity not found: the FM's residual-endurance table
    // assumes at least 15 Ah (P5 FM 3-8). ESTIMATE 25 Ah.
    battery: { ...md.electrical.battery, capacityAh: 25 },
    // Two 150 A starter-generators (P5 FM 2-11, 7-31), on line from about 52 % N1 (the 250-C20B's, F md500). ESTIMATE cut-in.
    alternators: [0, 1].map((engine) => ({ engine, maxAmps: BO105_GENERATOR_AMPS, cutInRpm: 0.52 * BO105_N1_100_RPM,
      fullRpm: 0.6 * BO105_N1_100_RPM, efficiency: 0.6 })),
    // The MD 500E's loads with two engines' fuel pumps (four electric pumps, P5 FM 7-14). ESTIMATES.
    loads: { ...md.electrical.loads, fuelPump: 8.0 },
    busDeadVolts: BO105_BUS_DEAD_VOLTS,
  },
};
