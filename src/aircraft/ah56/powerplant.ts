// Lockheed AH-56A Cheyenne: the powerplant as data. Owner: AG (stage 2). One General Electric T64-GE-716 free-turbine
// turboshaft (4330 shp maximum, P ASTA-72 p 1; 4275 shp quoted for the AMCS ship, P AMCS-73 p 20) driving the main
// transmission through an overrunning clutch (INF: a freewheel is implied by autorotation; research-ah56 sect. 8); the
// transmission is limited to 3925 shp = 114 % torque (P). The EngineDef "crank" is the ENGINE OUTPUT SHAFT (gearRatio 1,
// ratedRpm = Nf 100 % = 13,600 rpm, S Jane's for the T64-GE-6), so the whole Nf -> Nr reduction is engineRatio 55.28 (D)
// and EngineState.torque is the output-shaft torque the % gauge reads (100 % = 3435 shp at 100 % Nf, P).
//
// The running line (fuel flow, TIT and gas power against Ng) is NOT an engine deck (none found): a T64-sized version of
// the 250-series shape (md500/powerplant.ts), fitted to these anchors:
//   - 4330 shp at 100 % Ng, TIT about 760 C at sea level ISA (the 716's maximum; 740 C is the continuous limit, P);
//   - 3925 shp (114 % torque, the transmission limit) below 740 C at sea level ISA (plan G12) - about 98 % Ng, 700 C;
//   - ground idle Ng 65 % (P band 58-72 %) at about 330 lb/h (P idle fuel flow band 103-350 pph);
//   - SFC about 0.47-0.49 lb/shp/h near the top (ESTIMATE from the GE T64-100 sheet, 0.487 at 4330 shp).
// docs/ah56-flight-model.md ("Engine") has the derivation. Every number below is an ESTIMATE unless tagged.

import { HP, LB } from '../../core/math';
import { C172_ENGINE, C172_POWERPLANT, C172_PROPELLER } from '../../physics/propulsion/c172Powerplant';
import { JET_A1, type EngineDef, type PowerplantDef } from '../../physics/propulsion/defs';
import { AH56_BUS_DEAD_VOLTS, AH56_ENGINE_RATED_W, AH56_ENGINE_RATIO, AH56_FUEL_LB, AH56_GENERATOR_AMPS, AH56_NF_100_RPM,
  AH56_NG_100_RPM, AH56_NR_100 } from './facts';
import { x, y, z } from './dimensions';

/** kg/s per lb/h. */
const LB_PER_H = LB / 3600;

/** General Electric T64-GE-716 turboshaft. Piston fields the turbine does not read are written 0 or left at the 172's. */
export const T64_GE_716: EngineDef = {
  ...C172_ENGINE,
  name: 'General Electric T64-GE-716',
  kind: 'freeTurbine',
  // P ASTA-72 p 1: 4330 shp maximum, SL std (one value with the sound: facts.ts).
  ratedPower: AH56_ENGINE_RATED_W,
  // S: 13,600 rpm output at 100 % Nf (Jane's 1962-63 for the -6, via Wikipedia). The crank is the output shaft.
  ratedRpm: AH56_NF_100_RPM,
  idleRpm: 0,
  displacement: 0,
  compressionRatio: 0,
  fuel: JET_A1,
  // The intake on the upper fuselage behind the mast (photos): a short duct, little ram recovered. ESTIMATE.
  induction: { ...C172_ENGINE.induction, ramRecovery: 0.5 },
  metering: { kind: 'turbineFcu' },
  ignition: { kind: 'igniters' },
  thermal: {
    ...C172_ENGINE.thermal,
    headHeatFraction: 0,
    oilCapacity: 2.5e4,
    oilCoolerConductance: 900,
    crankcaseConductance: 30,
    // P (1972): engine oil 10-83 psi green, 50 psi minimum at 95 % Ng; on the gas generator. ESTIMATE shape.
    oilPsiPerRpm: 0.0042,
    oilReliefPsi: 80,
    oilColdOverdrivePsi: 20,
    cowlFlapClosedFactor: 1,
    warm: { egt: 420, cht: 15, oilTemp: 70, oilPressure: 70 },
  },
  fmep: [0, 0, 0],
  coldFrictionFactor: 1,
  compressionLossTorque: 0,
  breakawayTorque: 2,
  // The two-stage power turbine and the front-drive shaft at the output shaft: ESTIMATE 0.6 kg m^2.
  rotatingInertia: 0.6,
  gearRatio: 1,
  runningRpm: 0.5 * AH56_NG_100_RPM,
  // A running reset turns the output shaft at the rotor's 100 % (the flight model resets it on governedRpm).
  airStartRpm: AH56_NR_100 * AH56_ENGINE_RATIO,
  groundStartRpm: AH56_NR_100 * AH56_ENGINE_RATIO,
  // The APU's air-turbine start (P ASTA-72 para 78: the APU on its spring-loaded switch, the start button, the condition
  // grip to IDLE at 20 % Ng, automatic thereafter) as the generic series starter on the gas generator, fed by the APU-
  // backed bus (the battery's low source resistance below): about 50 kW near 20 % Ng, where the 14-stage compressor
  // absorbs about 35 kW. ESTIMATE (no starter data; a 24 V battery alone could not turn a T64).
  starter: { k: 2.4e-5, r: 0.001 },
  turbine: {
    kind: 'freeTurbine',
    gasGenerator: {
      referenceRpm: AH56_NG_100_RPM,
      // 14-stage axial compressor and its two-stage turbine: about one second of compressor power stored at 100 % Ng (the
      // 250's ratio). ESTIMATE.
      inertia: 2.4,
      compressorPower: 4.3e6,
      map: {
        ng: [0.58, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95, 0.98, 1.00, 1.015, 1.05, 1.10],
        fuelFlow: [270, 330, 470, 610, 790, 1000, 1260, 1580, 1810, 2050, 2180, 2400, 2550].map((lbh) => lbh * LB_PER_H),
        itt: [440, 430, 440, 455, 480, 515, 560, 625, 690, 760, 785, 840, 900],
        power: [10, 40, 300, 560, 900, 1340, 1890, 2520, 2960, 3229, 3400, 3700, 3900].map((kw) => kw * 1e3),
      },
      // Light-off at 12 % Ng, self-sustaining from 28 % (ESTIMATE, set with the start schedule below so a start with the
      // grip to IDLE at 20 % Ng reaches idle in about 30 s within the P start limits: TIT <= 566 C to 50 % Ng, <= 649 C to
      // idle, APE-I SoF 1.1).
      lightOffNg: 0.12,
      selfSustainingNg: 0.28,
      minFuelNg: 0.08,
      fcu: {
        // P: Ng idle 58 % minimum (red) to 72 %; 100 % maximum continuous, 101.5 % red. The grip's RUN schedule tops at
        // 101.5 % (the red line; the topping governor holds Nf).
        lowIdleNg: 0.65,
        highIdleNg: 0.65,
        maxNg: 1.015,
        // The 250-C20B's proportions: the start schedule about 0.6 of the first steady flow at 20 % Ng, and about 1.35 x the
        // steady flow from idle up. ESTIMATE.
        accelFuel: {
          ng: [0, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.05, 1.1],
          fuelFlow: [100, 105, 120, 135, 170, 210, 270, 390, 635, 1070, 1700, 2770, 3240, 3440].map((lbh) => lbh * LB_PER_H),
        },
        decelFraction: 0.62,
        gain: 2,
      },
      leanBlowout: 0.4,
      ittLag: 1.5,
      warmItt: 420,
    },
    // Power turbine: the stalled-torque law (turbineEngine.ts); windage, the front-drive gearing and the accessories at
    // the output shaft: 5 + 6 N m per 1000 rpm, 87 N m (about 4 % of the rated torque, 124 kW) at 100 % Nf, the MD 500E's
    // proportion less its runaway allowance; fuel topping at 105 % Nf (P: 105 % maximum power-on). ESTIMATE values.
    powerTurbine: { stallTorqueRatio: 3, friction: [5, 6], topping: { np: 1.05, gain: 5 } },
  },
};

/** Usable fuel, kg (ESTIMATE 2,500 lb: capacity not found; facts.ts). */
export const AH56_FUEL_CAPACITY = AH56_FUEL_LB.usable * LB;

export const AH56_POWERPLANT: PowerplantDef = {
  engines: [{
    engine: T64_GE_716,
    // A compatibility carrier for the generic engine module; externalDrive disables its loads.
    propeller: { ...C172_PROPELLER, inertia: 0.01 },
    hub: { x: 0, y: 0, z: 0 },
    rotation: 1,
  }],
  fuel: {
    tanks: [
      // The fuel is in the sponsons (P ASTA-72 App B): one tank at the CG station, low. ESTIMATE position.
      { id: 'main', side: 'left', capacity: AH56_FUEL_CAPACITY, position: { x: x(300), y: y(0), z: z(55) } },
    ],
    feeds: [{
      ...C172_POWERPLANT.fuel.feeds[0],
      positions: { on: [0], both: [0] },
      gravityHeadPsi: 0,
      feedCapacity: 0.4,
      lineCapacity: 4,
      lineUnusable: 0.2,
      enginePump: { psi: 20 },
      auxPump: { psi: 25, minVolts: 18 },
      delivery: { kind: 'commonRail', minPsi: 5 },
      film: { fraction: 0, time: 0 },
    }],
  },
  electrical: {
    ...C172_POWERPLANT.electrical,
    nominalVolts: 28,
    regulatorVolts: 28.5,
    // 24 V battery, ESTIMATE 34 Ah, with the APU's generator behind it during a start: one low-resistance source
    // (ESTIMATE; the APU itself is not modelled).
    battery: { ...C172_POWERPLANT.electrical.battery, capacityAh: 34, rDischarge: 0.0015 },
    alternators: [{ engine: 0, maxAmps: AH56_GENERATOR_AMPS, cutInRpm: 0.55 * AH56_NG_100_RPM,
      fullRpm: 0.62 * AH56_NG_100_RPM, efficiency: 0.6 }],
    loads: { master: 6.0, avionics: 20.0, nav: 3.0, beacon: 3.0, strobe: 4.0, landing: 12.0, taxi: 0, panelFull: 4.0,
      pitotHeat: 10.0, fuelPump: 6.0 },
    lowVoltsLamp: 24.5,
    overVolts: 32,
    busDeadVolts: AH56_BUS_DEAD_VOLTS,
  },
};

/** Installed ratings for the RotorcraftDefinition.systems documentation fields: the transmission's 3925 shp (P). */
export const AH56_TRANSMISSION_POWER = 3925 * HP;
