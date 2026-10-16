// Pilatus PC-12/47: the powerplant as data. One Pratt & Whitney Canada PT6A-67B free turbine (1200 shp take-off,
// flat rated; power turbine 29 894 rpm geared to a 1700 rpm propeller) driving a Hartzell HC-E4A-3D four-blade
// 2.67 m constant-speed, full-feathering, reversing propeller; two wing tanks; a 28 V bus with GEN 1 (a 300 A
// starter-generator on the gas generator) and GEN 2 (115 A). Plain data.
//
// The quadrant (47E-PROXY 7-10; plan sect. 0, owner-notes clarification): a POWER CONTROL LEVER (PCL: the throttle
// forward of the idle gate, ControlInputs.reverse aft of it: beta, then reverse), a CONDITION lever (the mixture:
// CUT-OFF/FEATHER below CUTOFF_BELOW, GROUND IDLE at CUTOFF_BELOW, FLIGHT IDLE at 1) and a MANUAL OVERRIDE lever
// (not modelled: notModelled). There is NO propeller lever: the propeller governor holds 1700 rpm whatever
// ControlInputs.propeller says, and the condition lever at CUT-OFF/FEATHER feathers it (selectedBy 'conditionLever').
//
// Tags (docs/pc12-sources.md): TCDS = EASA A.089 sect. C; ETCDS = EASA IM.E.008 (PT6A-67); 47E-PROXY = PC-12/47E POH
// 02277 (PT6A-67P: same family); DERIVED = arithmetic shown; ESTIMATE = no source. The running line (fuel flow,
// ITT and gas power against corrected Ng at sea level) is a plausible PT6 shape FITTED to the 47E maximum-cruise rows
// (torque-limited at 36.9 psi, so valid for the /47), the take-off torque and the hot-and-high example; it is not a
// P&WC deck (docs/pc12-flight-model.md has the derivation).

import { DEG, HP, LB } from '../../core/math';
import { C172_BLADE_SECTION, C172_ENGINE, C172_POWERPLANT, C172_PROPELLER } from '../../physics/propulsion/c172Powerplant';
import { JET_A1, type BladeSectionDef, type EngineDef, type PowerplantDef, type PropellerDef } from '../../physics/propulsion/defs';
import {
  PC12_GEAR_RATIO, PC12_GEN_AMPS, PC12_IDLE, PC12_NG_100_RPM, PC12_NG_MAX, PC12_NOMINAL_VOLTS, PC12_NP_GOVERNED,
  PC12_NP_OVERSPEED_GOVERNOR, PC12_NP_TOPPING, PC12_PSI_PER_NM, PC12_START, PC12_TORQUE_LIMITER, PT6A_67B_RATED_W,
} from './facts';
import { PC12_PROP } from './geometry';

/** kg/s per lb/h. */
const LB_PER_H = LB / 3600;
/** Power turbine at 100 % Np, rpm (POH 2-6 note 8: 1700 propeller rpm = 29 894). */
export const PC12_PT_RPM = PC12_NP_GOVERNED * PC12_GEAR_RATIO;

/**
 * Corrected-speed running line at sea level, static (gasGenerator.ts: anywhere else the fuel and the gas power scale
 * with delta sqrt(theta), the ITT in kelvin with theta). FITTED (docs/pc12-flight-model.md):
 *  - power: about 130 shp at flight idle (64.5 % Ng; ESTIMATE, the idle descents); 1200 shp at about 94.5 % Ng static at sea level (the torque limiter holds 44.3 psi there); 1000 shp at the
 *    47E maximum-cruise rows (sea level, 8000 and 12 000 ft ISA at 36.9 psi) inside 104 % Ng; the limiter's 41.6 psi at
 *    10 000 ft and 150 KIAS below the 102 % Ng taper;
 *  - fuel: 634 / 564 / 541 lb/h at those cruise rows (47E Fig 5-2-31, 8000 lb); about 175 lb/h at ground idle (55 %
 *    Ng; ESTIMATE): the 47E's 90 lb/h minimum flow holds only about 35 % Ng on the ground (7-10: a failed Py), below the
 *    map, which starts at 50 %;
 *  - ITT: the 47E example, 34.1 psi at 8000 ft / 26 C at its 850 C limit, carried to the /47's 800 C (about 32 psi);
 *    about 770 C static take-off at sea level; at most 760 C at 12 000 ft cruise (TCDS MCP ITT).
 */
const MAP = {
  ng: [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.15],
  fuelFlowLbH: [195, 205, 225, 260, 320, 395, 470, 540, 610, 703, 790, 880, 975, 1075],
  ittC: [560, 530, 520, 525, 545, 575, 615, 665, 725, 775, 822, 875, 932, 995],
  // 60-65 % Ng (flight idle 64.5 %): 90 / 130 shp (was 110 / 165; pilot review 2026-10-17: 4.9 psi at
  // FLIGHT IDLE in an idle descent, -500 fpm at 120 KIAS, 4.3 kN at a standstill on the gate). The reviewer's 95 shp
  // at flight idle puts FLIGHT IDLE on the gate at Np 1364, below the ESTIMATE band 1500-1730 (targets/pc12.ts
  // idleRpm); 130 shp is the lowest inside it (Np about 1525). ESTIMATE; docs/pc12-flight-model.md "Flight idle".
  powerShp: [18, 48, 90, 130, 255, 390, 600, 790, 1000, 1240, 1530, 1830, 2140, 2460],
};

/**
 * PT6A-67B. Piston fields the turbine does not read are written 0 or left at the 172's (EngineDef 'freeTurbine':
 * only induction.ramRecovery and the oil part of `thermal` are used).
 */
export const PT6A_67B: EngineDef = {
  ...C172_ENGINE,
  name: 'Pratt & Whitney Canada PT6A-67B',
  kind: 'freeTurbine',
  ratedPower: PT6A_67B_RATED_W,
  ratedRpm: PC12_PT_RPM,
  idleRpm: 0,
  displacement: 0,
  compressionRatio: 0,
  fuel: JET_A1,
  // The annular plenum behind the chin inlet (inertial separator closed): most of the ram is recovered. ESTIMATE.
  induction: { ...C172_ENGINE.induction, ramRecovery: 0.8 },
  metering: { kind: 'turbineFcu' },
  ignition: { kind: 'igniters' },
  thermal: {
    ...C172_ENGINE.thermal,
    headHeatFraction: 0,
    // 13.6 L of oil (TCDS C.III.8.2) and its tank.
    oilCapacity: 30e3,
    oilCoolerConductance: 600,
    crankcaseConductance: 25,
    // 90-135 psi above 72 % Ng (ETCDS IV.4.2): the pump is on the gas generator.
    oilPsiPerRpm: 0.0042,
    oilReliefPsi: 115,
    oilColdOverdrivePsi: 20,
    warm: { egt: 560, cht: 15, oilTemp: 70, oilPressure: 110 },
  },
  fmep: [0, 0, 0],
  coldFrictionFactor: 1,
  compressionLossTorque: 0,
  breakawayTorque: 0.5,
  // Power turbine (two stages), its shaft and the first reduction stage. ESTIMATE.
  rotatingInertia: 0.02,
  gearRatio: PC12_GEAR_RATIO,
  // Gas-generator rpm: "running" from 45 % Ng.
  runningRpm: 0.45 * PC12_NG_100_RPM,
  airStartRpm: PC12_PT_RPM,
  groundStartRpm: 17_000,
  // GEN 1 is the starter-generator (ESTIMATE on the /47: FAA N 8900.428 gives GEN 1 300 A): the C208's motor scaled
  // to the larger spool (3.5 x its torque at the same speed: CALIBRATED on the start, 50 % Ng in about 30 s).
  starter: { k: 6e-5 / 3.5, r: 0.02 / 3.5 },
  // One press of STARTER latches it until 50 % Ng or 80 s (47E-PROXY 4.5, 7-10; PC12_START).
  starterLatch: { cutoutNg: PC12_START.starterCutoutNg, cutoutSeconds: PC12_START.starterCutoutSeconds },
  turbine: {
    kind: 'freeTurbine',
    gasGenerator: {
      referenceRpm: PC12_NG_100_RPM,
      // ESTIMATE: the -67's spool (4 axial + 1 centrifugal stage) against the -114A's 0.08.
      inertia: 0.12,
      // ESTIMATE: the compressor's power at 100 % Ng, which with the running line sets the spool's efficiency (about
      // 0.45 at 100 %) and so its acceleration.
      compressorPower: 2.15e6,
      map: {
        ng: MAP.ng,
        fuelFlow: MAP.fuelFlowLbH.map((lbh) => lbh * LB_PER_H),
        itt: MAP.ittC,
        power: MAP.powerShp.map((shp) => shp * HP),
      },
      lightOffNg: 0.09,
      selfSustainingNg: 0.32,
      minFuelNg: 0.03,
      fcu: {
        // Condition lever GROUND IDLE: about 55 % Ng (47E-PROXY 2-6: 50.7-61.4 %); FLIGHT IDLE: at least 64 % (66 %
        // ESTIMATE, for the cabin's bleed and the go-around response, 47E-PROXY 7-10); 104 % maximum (TCDS).
        lowIdleNg: 0.55,
        highIdleNg: 0.645,
        maxNg: PC12_NG_MAX,
        // Start schedule (a minimum-flow stop that makes early fuel a hot start), then about 25 % over the running line.
        accelFuel: {
          ng: [0, 0.1, 0.13, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.05, 1.1],
          fuelFlow: [59, 61, 75, 103, 138, 178, 243, 290, 400, 588, 762, 988, 1100, 1220].map((lbh) => lbh * LB_PER_H),
        },
        decelFraction: 0.6,
        gain: 2,
      },
      leanBlowout: 0.35,
      ittLag: 1,
      warmItt: 560,
    },
    // Nf (fuel topping) governor at 109 % Np, 1853 rpm (47E-PROXY 7-11 p. 704).
    powerTurbine: { stallTorqueRatio: 2, friction: [0.8, 0.1], topping: { np: PC12_NP_TOPPING / PC12_NP_GOVERNED, gain: 5 } },
    // Aft of the pitch-only travel the cam raises Ng to about 85 % at full reverse (CALIBRATED on the 47E maximum
    // reverse, 900 shp / 34.25 psi at Np 1650: ESTIMATE for the /47), the topping governor reset to 1650 rpm (47E 2-6).
    reversingCam: { maxReverseNg: 0.86, reverseNp: 1650 / PC12_NP_GOVERNED },
    // The PCL torque limiter (47E-PROXY 7-10 p. 689; believed fitted to the /47: ESTIMATE): 44.3 psi at sea level.
    torqueLimiter: { ...PC12_TORQUE_LIMITER, psiPerNm: PC12_PSI_PER_NM },
  },
};

/**
 * Blade section: thin, lightly cambered turboprop blade (NACA 16-series-like), zero lift 2 deg below the face, a
 * negative stall at cl -1.0: a reversing blade works on that side (the PT6A-67 test-bed's, T1a). ESTIMATE.
 */
const BLADE_SECTION: BladeSectionDef = { ...C172_BLADE_SECTION, alpha0: -2 * DEG, clMin: -1.0, clMaxLowSpeed: 1.6, clMaxMachLoss: 1.0, cdMax: 1.3 };
/** Reference station of the blade angles, r / R: the 42 in station of the TCDS (geometry.ts PC12_PROP.STATION). */
const STATION = PC12_PROP.STATION;
/**
 * Flight low-pitch stop at the reference station, rad: THE CALIBRATED UNKNOWN (plan 5.1; docs/pc12-flight-model.md
 * "Blade angles"). The TCDS gives at the 42 in station fine pitch 19 deg, minimum on ground 17 deg, minimum in flight
 * 6 deg; a 6 deg blade at 0.80 R at 1700 rpm and 85 KIAS sits about 7 deg negative to the flow, so 6 and 19 cannot
 * both be flight angles there. Started at 17 deg and calibrated on (a) the static ground-idle Np on the gate,
 * 1060 +/- 60 rpm (47E 7-11), and (b) 8-18 psi on a 3 deg approach at Vref, flaps 40.
 */
export const PC12_FLIGHT_IDLE_STOP = 5.5 * DEG;
/** Feather 79.6 deg, full reverse -17.5 deg at 0.80 R (TCDS C.III.6.6). */
const FEATHER = 79.6 * DEG;
const REVERSE = -17.5 * DEG;
/** Ground fine: about zero static thrust (this blade: CALIBRATED, |static thrust| < 500 N at reverse = pitchOnlyTravel). */
const GROUND_FINE = -4.5 * DEG;

/** Twist table of a constant-pitch helix that is `design` at the reference station. */
function helixTwist(design: number): PropellerDef['twist'] {
  const x = [0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  return { kind: 'table', x, angle: x.map((xi) => Math.atan((Math.tan(design) * STATION) / xi) - design) };
}

/**
 * Hartzell HC-E4A-3D/E10477K (TCDS C.III.6): four aluminium blades, 2.67 m, constant speed, full feathering,
 * reversible, clockwise seen from behind. Governed at one speed, 1700 rpm (the CSU; no propeller lever), with the
 * overspeed governor at 1802 rpm (106 %, 47E 7-11) and the Nf topping governor at 1853. The condition lever at
 * CUT-OFF/FEATHER feathers it (47E 7-10: the overspeed governor's feather solenoid). No feather latches: it feathers
 * whenever the engine stops and comes out of feather as the gas generator's oil pressure builds. Wide blades (1.4 x
 * the 172's chord, activity factor about 125 a blade: ESTIMATE) of a 25 deg helix at 0.80 R (ESTIMATE).
 */
export const PC12_PROPELLER: PropellerDef = {
  ...C172_PROPELLER,
  name: 'Hartzell HC-E4A-3D/E10477K (2.67 m, four blades, reversing)',
  diameter: PC12_PROP.diameter,
  blades: PC12_PROP.blades,
  hubRadius: 0.22,
  chordOverR: C172_PROPELLER.chordOverR.map((c) => 1.1 * c),
  twist: helixTwist(25 * DEG),
  referenceStation: STATION,
  section: BLADE_SECTION,
  // Four 2.67 m aluminium blades, the hub and the spinner. ESTIMATE.
  inertia: 12,
  pitchControl: {
    kind: 'constantSpeed',
    fineStop: PC12_FLIGHT_IDLE_STOP,
    coarseStop: FEATHER,
    feather: { angle: FEATHER, latchRpm: 0, latchAngle: 0, unfeather: 'starter' },
    rateToFine: 12 * DEG,
    rateToCoarse: 12 * DEG,
    governor: { minRpm: PC12_NP_GOVERNED, maxRpm: PC12_NP_GOVERNED, gain: 0.03, dampingTime: 0.2, overspeedRpm: PC12_NP_OVERSPEED_GOVERNOR },
    failsTo: 'feather',
    selectedBy: 'conditionLever',
    // The PCL's aft travel (47E 7-10): the first 45 % moves the blades only (Ng at idle, the taxi range), the rest
    // reverses them and raises Ng. Slew ESTIMATE.
    beta: {
      groundFine: GROUND_FINE,
      reverse: REVERSE,
      pitchOnlyTravel: 0.45,
      rate: 30 * DEG,
      // 47E-PROXY sect. 1 p. 83, 7-10 p. 677: forward of the detent the PCL sets the minimum blade angle "6 to 12
      // deg"; read as the span of the schedule above the flight-idle stop (ESTIMATE), reached at mid travel.
      lowPitchSchedule: { lever: [0, 0.5, 1], angle: [PC12_FLIGHT_IDLE_STOP, PC12_FLIGHT_IDLE_STOP + 6 * DEG, PC12_FLIGHT_IDLE_STOP + 6 * DEG] },
    },
    // 19 slices from full reverse to feather (PROP_MAX_SLICES 20).
    pitchNodes: [-17.5, -11, -4.5, 0, 3, 5.5, 10, 14, 18, 22, 26, 30, 34, 38, 43, 50, 58, 68, 79.6].map((deg) => deg * DEG),
  },
};

/** Usable fuel: 1522 L (TCDS C.III.8.1), Jet A at 0.80 kg/L, half a side. */
const TANK_USABLE = (1522 / 2) * 0.8;

export const PC12_POWERPLANT: PowerplantDef = {
  engines: [{ engine: PT6A_67B, propeller: PC12_PROPELLER, hub: PC12_PROP.hub, rotation: PC12_PROP.rotation }],
  fuel: {
    // One integral main and collector tank a side, as one tank each (the collector and the motive-flow jet pumps
    // are not modelled; nor the automatic balance: notModelled). Centroid about 3.0 m out, at the fuel arm of
    // 47E-PROXY Fig 6-16 (230.6 in = station 5.86), in the low wing about 1.24 m up (3V ESTIMATE).
    tanks: [
      { id: 'left', side: 'left', capacity: TANK_USABLE, position: { x: 0.14, y: -3.0, z: 0.3 } },
      { id: 'right', side: 'right', capacity: TANK_USABLE, position: { x: 0.14, y: 3.0, z: 0.3 } },
    ],
    feeds: [
      {
        // Both wings feed the engine; the fuel emergency shut-off (FUEL EMERG SHUT OFF) is 'off'.
        positions: { on: [0, 1], both: [0, 1], left: [0], right: [1] },
        // The collectors sit in the wing roots at the engine's level: little head.
        gravityHeadPsi: 0.5,
        feedCapacity: 0.3,
        lineCapacity: 15,
        lineUnusable: 0.1,
        // Engine-driven low-pressure pump (43.5 psig relief) ahead of the FCU's high-pressure pump (47E 7-12).
        enginePump: { psi: 40 },
        // Electric boost pumps in the collectors (FUEL PUMPS ON/AUTO).
        auxPump: { psi: 30, minVolts: 18 },
        delivery: { kind: 'commonRail', minPsi: 10 },
        film: { fraction: 0, time: 0 },
      },
    ],
  },
  electrical: {
    ...C172_POWERPLANT.electrical,
    nominalVolts: PC12_NOMINAL_VOLTS,
    regulatorVolts: 28.5,
    // One 24 V lead-acid main battery (legacy; capacity not confirmed: the 47E's 42 Ah, ESTIMATE).
    battery: { ...C172_POWERPLANT.electrical.battery, capacityAh: 42, rDischarge: 0.012 },
    // GEN 1: the 300 A starter-generator, on line above the starter's cut-out; GEN 2: 115 A on the accessory gearbox
    // (FAA N 8900.428). Both on the gas generator.
    alternators: [
      { engine: 0, maxAmps: PC12_GEN_AMPS[0], cutInRpm: 0.5 * PC12_NG_100_RPM, fullRpm: 0.56 * PC12_NG_100_RPM, efficiency: 0.6 },
      { engine: 0, maxAmps: PC12_GEN_AMPS[1], cutInRpm: 0.5 * PC12_NG_100_RPM, fullRpm: 0.6 * PC12_NG_100_RPM, efficiency: 0.6 },
    ],
    loads: {
      // Relays, the EIS and CAWS, the standby instruments' inverter, the ECS controls.
      master: 6.0,
      // Two nav / coms, transponder, ADF, GNS, the EFIS, the autopilot, avionics fans.
      avionics: 18.0,
      nav: 3.0,
      beacon: 2.1,
      strobe: 4.0,
      landing: 9.0,
      taxi: 7.2,
      panelFull: 4.0,
      // Pitot, static and AOA-vane heat.
      pitotHeat: 14.0,
      fuelPump: 6.0,
      // The gear's hydraulic power pack while it runs.
      gearPump: 40.0,
    },
    lowVoltsLamp: 24.5,
    overVolts: 32,
    busDeadVolts: 18,
  },
};

/** Ground idle as the 47E gives it (re-exported for the tests and the panel). */
export { PC12_IDLE };
/** psi per power-turbine N m (the stick pusher's torque input, StickPusherDef.psiPerPtNm). */
export const PC12_PSI_PER_PT_NM = PC12_GEAR_RATIO * PC12_PSI_PER_NM;
