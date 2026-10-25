// Cessna 208 Caravan 675: the powerplant as data. One Pratt & Whitney Canada PT6A-114A free turbine (675 shp flat
// rated, power turbine 33 000 rpm geared to a 1900 rpm propeller) driving a Hartzell three-blade 106 in constant-
// speed, full-feathering propeller; two wing tanks feeding through their selectors to the engine-driven and
// electric boost pumps; a 28 V bus with a starter-generator on the gas generator. Plain data.
//
// The gas-generator model and what each number means: physics/propulsion/gasGenerator.ts, turbineEngine.ts and
// docs/turbine-model.md. Limits (POH sect. 2): 1865 ft lbf torque, 805 C ITT (1090 C for 2 s starting), 101.6 %
// Ng, 1900 rpm Np, oil 85-105 psi and 10-99 C. The running line (fuel flow, ITT and gas power against Ng at sea
// level) is a plausible PT6A shape fitted to the POH's take-off and cruise figures, not a P&WC engine deck. The
// engine is flat rated: 675 shp at about 97 % Ng at sea level ISA and nearly 800 shp thermodynamically at 101.6 %,
// so it is torque that limits it low down and ITT that limits it high and hot (it still makes about 675 shp at
// 10 000 ft ISA, near the ITT limit), as on the aircraft.

import { DEG, HP, LB } from '../../core/math';
import { C172_BLADE_SECTION, C172_ENGINE, C172_POWERPLANT, C172_PROPELLER } from '../../physics/propulsion/c172Powerplant';
import { JET_A1, type BetaDef, type BladeSectionDef, type EngineDef, type PowerplantDef, type PropellerDef } from '../../physics/propulsion/defs';
import { C208_GEOMETRY, C208_THRUST_Z } from './geometry';

const PROP = C208_GEOMETRY.propellers[0];
/** kg/s per lb/h. */
const LB_PER_H = LB / 3600;
/** Gas-generator speed at 100 % Ng, rpm, and the power turbine's design speed (propeller 1900 rpm), rpm. */
export const PT6A_NG_RPM = 37_500;
const PT_RPM = 33_000;
/** Propeller speed at the governor's high setting, rpm (POH: 1900). */
export const C208_MAX_NP = 1900;
/** Ng at full reverse (the reversing cam's top; ESTIMATE, see PT6A_114A.turbine.reversingCam). */
const REVERSE_NG = 0.85;

/**
 * PT6A-114A. Piston fields the turbine does not read are written 0 or left at the 172's (EngineDef 'freeTurbine':
 * only induction.ramRecovery and the oil part of `thermal` are used).
 */
export const PT6A_114A: EngineDef = {
  ...C172_ENGINE,
  name: 'Pratt & Whitney Canada PT6A-114A',
  kind: 'freeTurbine',
  ratedPower: 675 * HP,
  ratedRpm: PT_RPM,
  idleRpm: 0,
  displacement: 0,
  compressionRatio: 0,
  fuel: JET_A1,
  // The annular inlet behind the propeller, fed through the inertial separator's duct: most of the ram is recovered.
  induction: { ...C172_ENGINE.induction, ramRecovery: 0.8 },
  metering: { kind: 'turbineFcu' },
  ignition: { kind: 'igniters' },
  thermal: {
    ...C172_ENGINE.thermal,
    headHeatFraction: 0,
    // About 14 kg of oil and its tank.
    oilCapacity: 25e3,
    oilCoolerConductance: 450,
    crankcaseConductance: 20,
    // 85-105 psi from about 72 % Ng; the pump is on the gas generator.
    oilPsiPerRpm: 0.0038,
    oilReliefPsi: 100,
    oilColdOverdrivePsi: 15,
    cowlFlapClosedFactor: 1,
    warm: { egt: 560, cht: 15, oilTemp: 70, oilPressure: 95 },
  },
  fmep: [0, 0, 0],
  coldFrictionFactor: 1,
  compressionLossTorque: 0,
  breakawayTorque: 0.5,
  // Power turbine, its shaft and the first reduction stage.
  rotatingInertia: 0.012,
  gearRatio: PT_RPM / C208_MAX_NP,
  // Gas-generator rpm: "running" from 45 % Ng.
  runningRpm: 0.45 * PT6A_NG_RPM,
  airStartRpm: PT_RPM,
  groundStartRpm: 17_000,
  // Starter-generator through its gear, at the gas-generator shaft: about 30 N m stalled, 2.7 N m at 30 % Ng.
  starter: { k: 6e-5, r: 0.02 },
  turbine: {
    kind: 'freeTurbine',
    gasGenerator: {
      referenceRpm: PT6A_NG_RPM,
      inertia: 0.08,
      compressorPower: 860e3,
      map: {
        ng: [0.5, 0.52, 0.6, 0.65, 0.7, 0.75, 0.8, 0.9, 0.95, 0.97, 1.0, 1.05, 1.1],
        fuelFlow: [81, 85, 115, 137, 160, 192, 225, 310, 365, 395, 445, 550, 650].map((lbh) => lbh * LB_PER_H),
        itt: [565, 560, 530, 535, 540, 560, 580, 640, 680, 700, 735, 835, 920],
        // The idle end (ESTIMATE, calibrated 2026-10-26 with the low-pitch stop moved to the TCDS's station, below):
        // LOW IDLE (52 % Ng) 25 shp and HIGH IDLE (65 %) 40 shp of gas power. Before, 40 and about 120 shp (65 % lay
        // between 70 shp at 60 % and 170 at 70 %): at HIGH IDLE on the gate the propeller pulled 3.5 kN at a standstill
        // and +1.8 kN at 70 kt, so an unbraked landing roll at idle levelled off at 55 kt, and in an idle glide it
        // pulled +1.2 kN at 95 KIAS (L/D 21 at idle against 12.7 feathered). Real ones: feathering at idle makes the
        // aircraft surge forward and below about 500 ft lbf the flattened blades are "a giant, drag-producing disc"
        // (AOPA Pilot, Turbine Pilot: Cessna Caravan, March 2009); "a fair amount of breakaway power" is needed to start
        // a loaded Caravan taxiing from LOW IDLE (same). Now, maximum gross, level, unbraked: LOW IDLE on the gate
        // about 8 kt, HIGH IDLE on the gate about 27 kt, and at idle 95 KIAS clean the propeller drags (about -0.35 kN).
        // 0.7-0.8 refaired to the new idle (110 / 210 / 320 shp; 170 at 70 % before); 80 % Ng and above unchanged.
        power: [15, 25, 33, 40, 110, 210, 320, 510, 620, 675, 780, 1000, 1200].map((shp) => shp * HP),
      },
      lightOffNg: 0.09,
      selfSustainingNg: 0.35,
      minFuelNg: 0.03,
      fcu: {
        // POH: low idle 52 % Ng minimum, high idle 65 %, 101.6 % maximum.
        lowIdleNg: 0.52,
        highIdleNg: 0.65,
        maxNg: 1.016,
        accelFuel: {
          ng: [0, 0.1, 0.13, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.05, 1.1],
          fuelFlow: [23.5, 24.3, 30, 41.3, 55.1, 71.3, 97.2, 143.8, 200, 281, 388, 556, 688, 812].map((lbh) => lbh * LB_PER_H),
        },
        decelFraction: 0.6,
        gain: 2,
      },
      leanBlowout: 0.35,
      ittLag: 1,
      warmItt: 560,
    },
    // The fuel topping governor at 106 % Np (POH sect. 7: it limits the propeller to about 2016 rpm).
    powerTurbine: { stallTorqueRatio: 2, friction: [0.5, 0.07], topping: { np: 1.06, gain: 5 } },
    // Reverse (C208_BETA): aft of the pitch-only travel the cam raises Ng to REVERSE_NG at full reverse, and the
    // fuel topping governor's set point drops to 95 % Np (1805 rpm), under the TCDS's 1825 rpm limit in reverse.
    // ESTIMATE: the PT6's Nf governor is reset to about 95 % in reverse; the cam's top Ng is set so that full reverse
    // on a static run stays inside the TCDS's reverse limits (675 shp, 1865 ft lbf, 1825 rpm, 805 C for 1 min).
    reversingCam: { maxReverseNg: REVERSE_NG, reverseNp: 0.95 },
  },
};

/** Thin, fast blade section of a turboprop's propeller (tip Mach about 0.8 at 1900 rpm): as the constant-speed test-bed blades. */
const BLADE_SECTION: BladeSectionDef = { ...C172_BLADE_SECTION, clMaxLowSpeed: 1.6, clMaxMachLoss: 1.0, cdMax: 1.3 };
/** Reference station of the blade angles, r / R. */
const STATION = 0.75;
/** Pitch of the constant-pitch helix the blades are twisted to: the blade angle at STATION when the twist is zero there, rad. */
const HELIX_DESIGN = 26 * DEG;
/** Twist of that helix at r / R = x relative to STATION, rad (the blade there sits this much coarser than at STATION). */
function helixTwistAt(x: number): number {
  return Math.atan((Math.tan(HELIX_DESIGN) * STATION) / x) - HELIX_DESIGN;
}
/** The TCDS's blade-angle station: 30 in out on the 106 in propeller, r / R. */
const TCDS_STATION = 30 / (106 / 2);
/**
 * Low-pitch stop (beta pickup), rad at 0.75 R: the TCDS's +15.6 deg at the 30 in station (IM.A.226 sect. 6.2) carried
 * out to 0.75 R along the blade's twist (helixTwistAt: 6.9 deg finer there), 8.7 deg. Until 2026-10-26 the TCDS
 * angle stood at 0.75 R itself (15 deg): a blade that coarse at idle pulled the aircraft along instead of dragging
 * (see the gas-generator map's idle end). The twist is the model's helix, not McCauley's blade drawing, so the
 * angle at 0.75 R is as good as that assumption (ESTIMATE).
 */
const FINE = 15.6 * DEG - helixTwistAt(TCDS_STATION);
const FEATHER = 88 * DEG;
/** Ground fine, deg at 0.75 R: about zero static thrust at LOW IDLE (calibrated: tests/conformance/targets/c208.ts idle taxi). */
const GROUND_FINE_DEG = -5.5;
/** Full reverse, deg at 0.75 R: the TCDS's 29.6 deg (15.6 - -14) below the low-pitch stop. */
const REVERSE_DEG = FINE / DEG - (15.6 - -14);
/** Blade angles of the beta slices, deg: full reverse, one between it and ground fine, ground fine, two between ground fine and the stop. */
const BETA_NODES_DEG = [REVERSE_DEG, -13, GROUND_FINE_DEG, -1.5, 3];
/** Twist table of the constant-pitch helix (HELIX_DESIGN at the reference station). */
function helixTwist(): PropellerDef['twist'] {
  const x = [0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  return { kind: 'table', x, angle: x.map(helixTwistAt) };
}

/**
 * Beta and reverse (EASA TCDS IM.A.226 issue 15, sect. 6.2: McCauley 3GFR34C703/106GA-0, blade angles at the 30 in
 * station: low pitch (beta pickup) +15.6, feathered +88, maximum reverse -14 deg). The blade turns as a rigid body,
 * so the TCDS's angle DIFFERENCES hold at any station: maximum reverse is 29.6 deg below the low-pitch stop and
 * feather 72.4 deg above it. The low-pitch stop is the TCDS's, carried to 0.75 R along the twist (FINE, 8.7 deg), and
 * reverse sits the TCDS's 29.6 deg below it (-20.9 deg). Feather stays at 88 deg at 0.75 R (the TCDS's 72.4 deg above
 * the stop would be 81 deg; the feathered glide hardly differs: 12.8 against 12.7 at 95 KIAS). Ground fine (the end
 * of the pitch-only travel) is a calibration: the angle at which the propeller makes about zero static thrust at LOW
 * IDLE. How much of the lever's aft travel moves the blades only
 * (Ng at idle), and the beta valve's slew, are ESTIMATES (the C208 POH describes the beta range from the idle gate
 * to the start of the reversing cam, without a number): about 40 % of the aft travel, and the gate to full reverse
 * in about 1.5 s.
 */
export const C208_BETA: BetaDef = {
  groundFine: GROUND_FINE_DEG * DEG,
  reverse: REVERSE_DEG * DEG,
  pitchOnlyTravel: 0.4,
  rate: 20 * DEG,
  // The blade angle is linear in the lever over the pitch-only travel (no cam). Until 2026-10-26 a cam put half
  // travel 73 % of the way from the old 15 deg stop to ground fine (about 0 deg), because a linear 4.75 deg there
  // pulled as hard as the stop. From the 8.7 deg stop, half travel is 1.6 deg: at LOW IDLE, maximum gross, unbraked,
  // the gate creeps at about 8 kt, half travel about 3 kt and ground fine stands still (tests/conformance/targets/c208.ts
  // C208_BETA_TAXI); at HIGH IDLE half travel is about 18 kt against 25-27 on the gate.
};

/**
 * McCauley 3GFR34C703/106GA-0 (106 in, three aluminium blades: TCDS IM.A.226 sect. 6.2, the propeller of the 675 shp
 * airframes), constant speed, full feathering and reversing. Oil from the engine drives the blades fine against
 * counterweights and a spring; there are no feather latches, so the propeller feathers whenever the engine stops
 * (it is parked feathered) and comes out of feather as the gas generator's oil pressure builds. Governed
 * 1600-1900 rpm. Aft of the power lever's idle gate the beta valve sets the blade angle below the low-pitch stop
 * (C208_BETA; physics/propulsion/governor.ts).
 */
export const C208_PROPELLER: PropellerDef = {
  ...C172_PROPELLER,
  name: 'McCauley 3GFR34C703/106GA-0 (106 in, three blades, reversing)',
  diameter: PROP.diameter,
  blades: PROP.blades,
  hubRadius: 0.2,
  chordOverR: C172_PROPELLER.chordOverR.map((c) => 0.95 * c),
  twist: helixTwist(),
  referenceStation: STATION,
  section: BLADE_SECTION,
  // Three 106 in aluminium blades, hub and spinner.
  inertia: 9,
  pitchControl: {
    kind: 'constantSpeed',
    fineStop: FINE,
    coarseStop: FEATHER,
    feather: { angle: FEATHER, latchRpm: 0, latchAngle: 0, unfeather: 'starter' },
    rateToFine: 12 * DEG,
    rateToCoarse: 12 * DEG,
    governor: { minRpm: 1600, maxRpm: C208_MAX_NP, gain: 0.03, dampingTime: 0.2 },
    failsTo: 'feather',
    beta: C208_BETA,
    // Five beta slices (full reverse, one between it and ground fine, ground fine, two below the low-pitch stop)
    // ahead of the fifteen of the governing and feather range from the stop: PROP_MAX_SLICES (20) in all.
    pitchNodes: [...BETA_NODES_DEG.map((deg) => deg * DEG), FINE, ...[11.5, 14.5, 17.5, 20.5, 23.5, 26.5, 29.5, 32.5, 36, 40, 46, 54, 68, 88].map((deg) => deg * DEG)],
  },
};

/** Usable fuel per tank: 332 US gal usable in all (POH sect. 2), Jet A at 6.7 lb/gal. */
const TANK_USABLE = (332 / 2) * 6.7 * LB;

export const C208_POWERPLANT: PowerplantDef = {
  engines: [{ engine: PT6A_114A, propeller: C208_PROPELLER, hub: PROP.hub, rotation: PROP.rotation }],
  fuel: {
    // Two integral tanks in the wings between the spars, centroid about 3.1 m out, in the wing (3V ESTIMATE).
    tanks: [
      { id: 'left', side: 'left', capacity: TANK_USABLE, position: { x: -0.05, y: -3.1, z: C208_THRUST_Z - 1.12 } },
      { id: 'right', side: 'right', capacity: TANK_USABLE, position: { x: -0.05, y: 3.1, z: C208_THRUST_Z - 1.12 } },
    ],
    feeds: [
      {
        // Two tank selectors (LEFT ON / OFF, RIGHT ON / OFF) feeding the reservoir under the cabin floor: the
        // generic selector's 'on' / 'both' is both open, 'left' / 'right' one of them, 'off' both shut.
        positions: { on: [0, 1], both: [0, 1], left: [0], right: [1] },
        // About 1.8 m of fuel standing above the reservoir and the boost pump.
        gravityHeadPsi: 1.9,
        feedCapacity: 0.3,
        // The reservoir (about 9 US gal) and its lines.
        lineCapacity: 25,
        lineUnusable: 0.1,
        // Engine-driven low-pressure pump ahead of the FCU's high-pressure pump.
        enginePump: { psi: 40 },
        // Electric boost pump (FUEL BOOST switch).
        auxPump: { psi: 30, minVolts: 18 },
        delivery: { kind: 'commonRail', minPsi: 10 },
        film: { fraction: 0, time: 0 },
      },
    ],
  },
  electrical: {
    ...C172_POWERPLANT.electrical,
    nominalVolts: 28,
    regulatorVolts: 28.5,
    // 24 V, 45 Ah lead-acid battery (POH sect. 7).
    battery: { ...C172_POWERPLANT.electrical.battery, capacityAh: 45, rDischarge: 0.012 },
    // 200 A starter-generator on the gas generator, on line from about 52 % Ng.
    alternators: [{ engine: 0, maxAmps: 200, cutInRpm: 0.5 * PT6A_NG_RPM, fullRpm: 0.56 * PT6A_NG_RPM, efficiency: 0.6 }],
    loads: {
      // Relays, engine instruments, annunciators, the standby gyros' inverter.
      master: 4.0,
      // Two nav / coms, transponder, ADF, autopilot, avionics fans.
      avionics: 12.0,
      nav: 2.8,
      beacon: 2.1,
      strobe: 3.5,
      // Two landing lamps and two taxi / recognition lamps in the wing leading edges.
      landing: 7.2,
      taxi: 7.2,
      panelFull: 3.0,
      pitotHeat: 10.0,
      fuelPump: 5.0,
    },
    lowVoltsLamp: 24.5,
    overVolts: 32,
    busDeadVolts: 18,
  },
};
