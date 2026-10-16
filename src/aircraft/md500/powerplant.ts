// MD 500E (369E): the powerplant as data. One Rolls-Royce (Allison) 250-C20B free-turbine turboshaft (313 kW / 420
// shp bare-engine rating, installed at 375 shp take-off and 350 shp MCP) whose output shaft (N2 100 % = 6016 rpm)
// drives the main transmission through an overrunning clutch (the freewheel, rotorcraft.ts systems.drive); two
// bladder cells under the cabin floor feeding as one tank; a 28 V bus with a 150 A starter-generator on the gas
// producer (N1). Plain data.
//
// The gas-generator model and what each number means: physics/propulsion/gasGenerator.ts and turbineEngine.ts; the
// turboshaft output stage (twist grip, N2 governor, freewheel): docs/turboshaft-model.md. The EngineDef "crank" of a
// turboshaft is the ENGINE OUTPUT SHAFT (gearRatio 1, ratedRpm = N2 100 %), so EngineState.torque is the torquemeter
// torque (md500TorquePsi) and the whole N2 -> Nr reduction is RotorcraftDefinition.engineRatio.
//
// Sources (docs/md500-sources.md): EASA TCDS IM.E.052 Issue 02 (P); FAA TCDS H3WE Rev 21 (P); MD 500E RFM CSP-E-1
// Rev 16 (P). The running line (fuel flow, TOT and gas power against N1) is NOT an engine deck: it is a plausible
// 250-series shape fitted to four anchors, each in docs/md500-flight-model.md ("Engine"):
//   - 313 kW (420 shp) at the 810 C TOT limit at sea level ISA (EASA IM.E.052 p9, p13);
//   - 87.2 psi torque at Hp 1000 ft, 20 C reads a specification TOT of 790 C (RFM 5-24, Fig 5-17);
//   - ground idle 64-65 % N1 (RFM 4-16) with the rotor turning at N2 55-70 % (below the 75-88 % avoid band);
//   - the snap deceleration from 103 % N2 at flat pitch passes 65 % N1 no sooner than 2.0 s (RFM 4-19, 4-28).
// Fuel flow is shaped to the 250-C20B's published specific consumption class (about 0.65 lb/shp/h at the rating)
// and the MD operating-cost figure of about 27 US gal/h in cruise (spec p37, M); it is an ESTIMATE.

import { HP, LB } from '../../core/math';
import { C172_ENGINE, C172_POWERPLANT, C172_PROPELLER } from '../../physics/propulsion/c172Powerplant';
import { JET_A1, type EngineDef, type PowerplantDef } from '../../physics/propulsion/defs';
import { MD500_ENGINE_RATED_W, MD500_FUEL, MD500_GENERATOR_AMPS, MD500_N1_100_RPM, MD500_N2_100_RPM,
  MD500_BUS_DEAD_VOLTS, MD500_ENGINE_RATIO, MD500_NR_NOMINAL } from './facts';

/** kg/s per lb/h. */
const LB_PER_H = LB / 3600;
const IN = 0.0254;

/**
 * Rolls-Royce (Allison) 250-C20B. Piston fields the turbine does not read are written 0 or left at the 172's
 * (EngineDef 'freeTurbine': only induction.ramRecovery and the oil part of `thermal` are used).
 */
export const ALLISON_250_C20B: EngineDef = {
  ...C172_ENGINE,
  name: 'Rolls-Royce (Allison) 250-C20B',
  kind: 'freeTurbine',
  // EASA IM.E.052 p9: 313 kW take-off and maximum continuous (one value with the sound: facts.ts).
  ratedPower: MD500_ENGINE_RATED_W,
  // EASA IM.E.052 p15: output shaft 6016 rpm at 100 % N2. The "crank" is the output shaft (gearRatio 1).
  ratedRpm: MD500_N2_100_RPM,
  idleRpm: 0,
  displacement: 0,
  compressionRatio: 0,
  fuel: JET_A1,
  // The plenum behind the cabin, fed from the inlets in the fairing above it: little ram is recovered. ESTIMATE.
  induction: { ...C172_ENGINE.induction, ramRecovery: 0.4 },
  metering: { kind: 'turbineFcu' },
  ignition: { kind: 'igniters' },
  thermal: {
    ...C172_ENGINE.thermal,
    headHeatFraction: 0,
    // RFM 1-13: 3.0 US qt in the tank plus the cooler and lines. ESTIMATE capacities.
    oilCapacity: 9e3,
    oilCoolerConductance: 220,
    crankcaseConductance: 10,
    // RFM 2-6 / 4-16: 115-130 psi at 94 % N1 and above, 50-130 below 79 %: on the gas producer.
    oilPsiPerRpm: 0.0026,
    oilReliefPsi: 122,
    oilColdOverdrivePsi: 25,
    cowlFlapClosedFactor: 1,
    warm: { egt: 470, cht: 15, oilTemp: 65, oilPressure: 110 },
  },
  fmep: [0, 0, 0],
  coldFrictionFactor: 1,
  compressionLossTorque: 0,
  breakawayTorque: 0.2,
  // The power turbine (2 stages, 33 290 rpm at 100 % N2) reflected through its 5.53:1 reduction to the output
  // shaft, plus the output gears and the freewheel's inner race: ESTIMATE 0.1 kg m^2 at the output shaft.
  rotatingInertia: 0.1,
  gearRatio: 1,
  // "Running" (EngineState.running) from the self-sustaining speed on the gas producer.
  runningRpm: 0.5 * MD500_N1_100_RPM,
  // A running reset turns the output shaft at the governed 103 % (492 rpm rotor).
  airStartRpm: MD500_NR_NOMINAL * MD500_ENGINE_RATIO,
  groundStartRpm: MD500_NR_NOMINAL * MD500_ENGINE_RATIO,
  // Starter-generator on the gas-producer pad (ratio 0.2361, EASA IM.E.052 p10), referred to the N1 shaft: about
  // 16 N m stalled through the battery's resistance. Calibrated to the start trace (RFM 4-15..4-17): light-off at
  // 12-15 % N1, self-sustaining near 50 %, release at 58-60 %. ESTIMATE motor constants.
  starter: { k: 3e-5, r: 0.01 },
  turbine: {
    kind: 'freeTurbine',
    gasGenerator: {
      // EASA IM.E.052 p15: N1 100 % = 50 970 rpm.
      referenceRpm: MD500_N1_100_RPM,
      // Compressor (4 or 6 axial + 1 centrifugal stage) and the 2-stage gas-producer turbine: 0.43 MJ at 100 % N1,
      // about one second of compressor power. ESTIMATE, set with decelFraction between two rows: the snap
      // deceleration from flat pitch (RFM 4-19/4-28: N1 passes 65 % no sooner than 2.0 s; 2.2 s) and the 1 s
      // collective dump from 87 psi (N2 peak at most 106 %, Fig 2-2; 105.0 %). docs/turboshaft-model.md.
      inertia: 0.03,
      // About 1.56 kg/s at a 7.2 pressure ratio and 80 % efficiency: 430 kW at 100 % N1. ESTIMATE.
      compressorPower: 430e3,
      map: {
        ng: [0.60, 0.645, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95, 1.00, 1.05, 1.08, 1.10],
        fuelFlow: [55, 62, 75, 90, 110, 137, 170, 207, 250, 290, 310, 320].map((lbh) => lbh * LB_PER_H),
        itt: [470, 468, 466, 475, 495, 530, 570, 638, 761, 854, 893, 925],
        power: [14, 16, 32, 56, 89, 134, 189, 252, 323, 376, 395, 400].map((kw) => kw * 1e3),
      },
      // RFM 4-15 / placard 2-18: the grip is opened to ground idle at 12-15 % N1 with the igniter on.
      lightOffNg: 0.11,
      selfSustainingNg: 0.4,
      minFuelNg: 0.06,
      fcu: {
        // RFM 4-16: ground idle 64-65 % N1 (one Ng for both "idle" stops: the twist grip, not a condition lever,
        // selects cut-off). EASA IM.E.052 p15: 105 % N1 maximum continuous (the grip's full-open N1 schedule).
        lowIdleNg: 0.645,
        highIdleNg: 0.645,
        maxNg: 1.05,
        accelFuel: {
          ng: [0, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.05, 1.1],
          fuelFlow: [24, 25, 29, 33, 41, 51, 64, 82, 112, 158, 228, 330, 390, 440].map((lbh) => lbh * LB_PER_H),
        },
        // The Bendix control's deceleration schedule (minimum flow over the steady flow), with the inertia above:
        // slow enough for the RFM 4-28 snap check, fast enough to hold the dump overshoot; clear of lean blow-out.
        decelFraction: 0.62,
        gain: 2,
      },
      leanBlowout: 0.4,
      ittLag: 1.2,
      warmItt: 470,
    },
    // Power turbine: the stalled-torque law of turbineEngine.ts. friction = the power turbine's windage, its 5.53:1
    // reduction gearing and the accessory drives at the output shaft: about 4 kW at 100 % N2 is the gear train's
    // loss; the rest stands in for the low runaway speed of a lightly loaded power turbine, which the fixed
    // stall-torque law cannot make (docs/turboshaft-model.md, "Unloaded power turbine"). Fuel topping at 108 % N2
    // (EASA IM.E.052 p15: 108 % continuous). ESTIMATE values.
    powerTurbine: { stallTorqueRatio: 3, friction: [0.2, 4.8], topping: { np: 1.08, gain: 5 } },
  },
};

/** RFM 1-13: 421.9 lb usable Jet A (two interconnected bladder cells, fed as one tank). */
export const MD500_FUEL_CAPACITY = MD500_FUEL.usableLb * LB;

export const MD500_POWERPLANT: PowerplantDef = {
  engines: [{
    engine: ALLISON_250_C20B,
    // A compatibility carrier for the generic engine module; externalDrive disables its loads (as the R22's).
    propeller: { ...C172_PROPELLER, inertia: 0.01 },
    hub: { x: 0, y: 0, z: 0 },
    rotation: 1,
  }],
  fuel: {
    tanks: [
      // RFM 6-17 Fig 6-7: full usable fuel arm STA 97.7 (41 229 in lb / 422 lb); under the cabin floor, centred.
      // Height ESTIMATE WL 6 (z from dimensions.ts: SKID_Z 1.2 m above the skid soles, ground WL -15.2).
      { id: 'main', side: 'left', capacity: MD500_FUEL_CAPACITY,
        position: { x: (100 - 97.7) * IN, y: 0, z: 1.2 - (6 + 15.2) * IN } },
    ],
    feeds: [{
      ...C172_POWERPLANT.fuel.feeds[0],
      positions: { on: [0], both: [0] },
      // The cells sit below the engine: the engine-driven pump draws; the start (boost) pump is optional (RFM 2-9).
      gravityHeadPsi: 0,
      feedCapacity: 0.1,
      lineCapacity: 1.5,
      lineUnusable: 0.05,
      enginePump: { psi: 15 },
      auxPump: { psi: 20, minVolts: 18 },
      delivery: { kind: 'commonRail', minPsi: 5 },
      film: { fraction: 0, time: 0 },
    }],
  },
  electrical: {
    ...C172_POWERPLANT.electrical,
    nominalVolts: 28,
    regulatorVolts: 28.5,
    // RFM 1-11: 24 V battery (ESTIMATE 17 Ah lead-acid, the common 500E fit).
    battery: { ...C172_POWERPLANT.electrical.battery, capacityAh: 17, rDischarge: 0.018 },
    // RFM 1-11, EASA IM.E.052 p12: 150 A starter-generator on the gas producer, on line from about 55 % N1 (the
    // RFM 4-17 note: GEN OFF below 60 % N1). Cut-in ESTIMATE.
    alternators: [{ engine: 0, maxAmps: MD500_GENERATOR_AMPS, cutInRpm: 0.52 * MD500_N1_100_RPM,
      fullRpm: 0.6 * MD500_N1_100_RPM, efficiency: 0.6 }],
    loads: {
      // Relays, engine instruments, annunciators, the engine-out/reignition unit. ESTIMATES.
      master: 3.0,
      avionics: 6.0,
      nav: 2.0,
      beacon: 2.1,
      strobe: 3.0,
      landing: 9.0,
      taxi: 0,
      panelFull: 2.0,
      pitotHeat: 6.0,
      fuelPump: 4.0,
    },
    lowVoltsLamp: 24.5,
    overVolts: 32,
    busDeadVolts: MD500_BUS_DEAD_VOLTS,
  },
};

/** Installed ratings for the RotorcraftDefinition.systems documentation fields (TCDS p12): 375 / 350 shp. */
export const MD500_TAKEOFF_POWER = 375 * HP;
export const MD500_CONTINUOUS_POWER = 350 * HP;
