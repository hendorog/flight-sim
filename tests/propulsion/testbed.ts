// Test-bed powerplant pieces: synthetic definitions that each switch on mechanisms the Cessna 172S does not
// have, for the propulsion tests here and for the test-bed aircraft of the assembly (tests/fixtures).
//
//   CARB_POWERPLANT        an O-235-like carburetted engine with a fixed-pitch propeller, gravity fed through
//                          an ON / OFF valve into a float bowl, on a 14 V bus (the Cessna 152 pattern);
//   constantSpeedUnit()    an IO-360 with a two-blade constant-speed, full-feathering propeller of either
//                          rotation: governor, feather, centrifugal latches, unfeathering by the starter;
//   TWIN_CS_POWERPLANT     two of them, counter-rotating, two tanks with crossfeed, 14 V (the PA-34 pattern);
//   TWIN_FP_POWERPLANT     two Cessna 172S units side by side, co-rotating, the same tanks and bus;
//   dieselUnit()           a FADEC turbodiesel with a 1.69 reduction gear and a three-blade constant-speed
//                          propeller unfeathered by an accumulator, the ECU scheduling load and propeller speed;
//   TWIN_DIESEL_POWERPLANT two of them, co-rotating, crossfeed, two alternators on 28 V (the DA42 pattern).
//
// The numbers are handbook figures of the aircraft named (work/aircraft-data) where one exists, and plausible
// stand-ins where none does (blade planforms, inertias, thermal masses, governor gains): these are test-beds of
// MECHANISMS, not definitions of those aircraft. Hubs of the twins are at y = -/+1.9 m.

import { DEG, HP, type Vec3 } from '../../src/core/math';
import { C172_BLADE_SECTION, C172_ENGINE, C172_POWERPLANT, C172_PROPELLER } from '../../src/physics/propulsion/c172Powerplant';
import {
  AVGAS_100LL, JET_A1,
  type BladeSectionDef, type ElectricalDef, type EngineDef, type EngineInstallation, type FuelFeedDef, type PowerplantDef, type PropellerDef,
} from '../../src/physics/propulsion/defs';

const INCH = 0.0254;
/** kg/s per US gal/h of 100LL. */
const GPH = (3.785411784e-3 * AVGAS_100LL.density) / 3600;
const C172_FEED = C172_POWERPLANT.fuel.feeds[0];
const C172_THERMAL = C172_ENGINE.thermal;

/** Lateral position of the twins' hubs, m. */
export const TWIN_HUB_Y = 1.9;
const twinHub = (side: -1 | 1): Vec3 => ({ x: 0.9, y: side * TWIN_HUB_Y, z: 0 });

// ------------------------------------------------------------------------------------------- carburetted single
/**
 * Lycoming O-235-L2C as installed in the Cessna 152: 110 hp at 2550 rpm, 3.82 L, 8.5 : 1, float carburettor
 * with heat from the muffler shroud, idle 600 rpm, about 9.9 US gal/h full rich at take-off (c152.md, section 4). The idle
 * bypass and the full-rich mixture are NOT given: the engine solves them from the idle speed and the take-off
 * fuel flow. Induction and friction are the IO-360's scaled by displacement.
 */
export const O235_ENGINE: EngineDef = {
  ...C172_ENGINE,
  name: 'O-235-like carburetted engine (test-bed)',
  ratedPower: 110 * HP,
  ratedRpm: 2550,
  idleRpm: 600,
  displacement: 3.823e-3,
  compressionRatio: 8.5,
  induction: {
    ...C172_ENGINE.induction,
    throttleBoreArea: Math.PI * 0.0255 * 0.0255,
    idleArea: undefined,
    inletArea: 1.0e-3,
    exhaustCoeff: 4.6e5,
    // A carburettor intake has little ram recovery to lose.
    ramRecovery: 0.3,
    carburettor: {
      // Full heat: air from the muffler shroud, 45 K warmer, through a duct that costs 12 % of the pressure at
      // the rated air flow. Chosen for the handbook's rpm drops (tests/propulsion/carburettor.test.ts); the duct
      // loss is on the high side because the model has no power enrichment at wide-open throttle to help it.
      heatRise: 45,
      heatPressureLoss: 0.12,
      venturiDropIdle: 28,
      venturiDropFull: 17,
      iceRatePerMin: 0.07,
      meltRatePerMin: 0.5,
      iceBlockage: 0.6,
    },
  },
  // 0.54 lb/hp/h in the full-rich climb (c152.md, section 4): 9.9 US gal/h at 110 hp.
  metering: { kind: 'floatCarburettor', takeoffFuelFlow: 9.9 * GPH, leanestFraction: 0.35 },
  thermal: { ...C172_THERMAL, headCapacity: 26e3, headConductance: 150, oilCapacity: 30e3, oilCoolerConductance: 90 },
  compressionLossTorque: 20,
  breakawayTorque: 39,
  rotatingInertia: 0.33,
  airStartRpm: 2200,
  // 12 V starter: about 35 N m at 200 A, cranking near 200 rpm.
  starter: { k: 0.0009, r: 0.03 },
};

/** McCauley 1A103/TCM6958: 69 in, two blades, 58 in geometric pitch (c152.md, section 5); the 172's planform. */
export const O235_PROPELLER: PropellerDef = {
  ...C172_PROPELLER,
  name: 'fixed-pitch 69 x 58 (test-bed)',
  diameter: 69 * INCH,
  hubRadius: 0.13,
  twist: { kind: 'helix', pitch: 58 * INCH },
  inertia: 0.85,
};

/** A 14 V bus with one 60 A alternator on engine 0 (no electric fuel pump on the carburetted single). */
const BUS_14V: ElectricalDef = {
  nominalVolts: 14,
  regulatorVolts: 14.0,
  battery: { capacityAh: 25, ocvEmpty: 11.6, ocvSpan: 1.3, rDischarge: 0.012, rChargeBase: 0.04, rChargeFull: 0.75 },
  alternators: [{ engine: 0, maxAmps: 60, cutInRpm: 500, fullRpm: 1500, efficiency: 0.55 }],
  loads: { ...C172_POWERPLANT.electrical.loads },
  lowVoltsLamp: 12.5,
  overVolts: 16,
  busDeadVolts: 9,
};

/** The carburetted single: both tanks feed together by gravity through an ON / OFF valve into the float bowl; no pumps. */
export const CARB_POWERPLANT: PowerplantDef = {
  engines: [{ engine: O235_ENGINE, propeller: O235_PROPELLER, hub: { x: 1.78, y: 0, z: 0.1 }, rotation: 1 }],
  fuel: {
    tanks: [
      { id: 'left', side: 'left', capacity: 33, position: { x: 0, y: -1.3, z: -0.9 } },
      { id: 'right', side: 'right', capacity: 33, position: { x: 0, y: 1.3, z: -0.9 } },
    ],
    feeds: [
      {
        positions: { on: [0, 1], both: [0, 1] },
        // About 0.7 m of fuel standing above the carburettor of a high-wing aircraft.
        gravityHeadPsi: 0.7,
        feedCapacity: 0.03,
        lineCapacity: 0.1,
        lineUnusable: 0.01,
        delivery: { kind: 'carburettorBowl', capacity: 0.06, minHeadPsi: 0.3 },
        film: { fraction: 0.4, time: 0.4 },
      },
    ],
  },
  electrical: { ...BUS_14V, loads: { ...BUS_14V.loads, fuelPump: 0 } },
};

// ------------------------------------------------------------------------------- constant-speed, feathering unit
/**
 * Lycoming IO-360-C1E6 of the PA-34-200: 200 hp at 2700 rpm, 5.92 L, 8.7 : 1, RSA injection, about 17.5 US gal/h
 * at take-off, alternate air instead of carburettor heat, cowl flaps (pa34.md, section 4). Idle speed and
 * take-off fuel flow are given; the engine solves its idle bypass and full-rich mixture.
 */
export const IO360_ENGINE: EngineDef = {
  ...C172_ENGINE,
  name: 'IO-360-C-like injected engine (test-bed)',
  ratedPower: 200 * HP,
  ratedRpm: 2700,
  idleRpm: 650,
  displacement: 5.92e-3,
  compressionRatio: 8.7,
  induction: { ...C172_ENGINE.induction, idleArea: undefined, alternateAir: { heatRise: 15, pressureLoss: 0.02 } },
  metering: { kind: 'rsaInjection', takeoffFuelFlow: 17.5 * GPH, leanestFraction: 0.35 },
  thermal: { ...C172_THERMAL, cowlFlapClosedFactor: 0.65 },
  rotatingInertia: 0.55,
  airStartRpm: 2300,
  // 12 V starter of a 200 hp engine.
  starter: { k: 0.0011, r: 0.022 },
};

/** Time the Hartzell takes from the fine stop to feather, s (pa34.md, section 5: "about 6 s"). */
export const CS_FEATHER_SECONDS = 6;
const CS_FINE = 13.5 * DEG;
const CS_FEATHER = 80 * DEG;

/**
 * Blade section of the constant-speed test-bed blades: the 172's, with
 *  - the maximum lift a thinner, faster section keeps at high subsonic speed (1.6 falling 1.0 per unit Mach above
 *    0.3, against 1.45 and 1.6). With the 172's, the tips of a 76 in blade at 2700 rpm (tip Mach 0.8) are stalled
 *    at static thrust on a 13.5 degree fine stop: static figure of merit 0.22 and thrust that GREW 34 % to 30 m/s
 *    (review-Bm-propulsion F3). With this one: 0.60, 4.1 kN static (3.5-4 lbf/hp for the class), falling with
 *    speed. The twist was not the cause: a blade with 16 degrees less root pitch than the helix moved static
 *    thrust by under 1 %;
 *  - the broadside drag of a blade of aspect ratio about 12 (Hoerner, "Fluid-Dynamic Drag", flat plates: 1.2 at
 *    AR 5, 1.3 at AR 10), not 1.6. It sets the drag of a STOPPED blade (about 76 degrees to the flow on the fine
 *    stop) and nothing else that matters: windmilling and feathered drag are unchanged (review-Bm-propulsion F5).
 */
const FAST_SECTION: BladeSectionDef = { ...C172_BLADE_SECTION, clMaxLowSpeed: 1.6, clMaxMachLoss: 1.0, cdMax: 1.3 };

/**
 * Hartzell HC-C2YK-2 of the PA-34-200: 76 in, two blades, constant speed, full feathering; blade angles at the
 * 30 in station (0.79 R): low pitch 13.5 degrees, feather 80; latches below 800 rpm; no accumulator, so it is
 * unfeathered with the starter (pa34.md, section 5). Planform of the 172's blade; the twist is that of a blade
 * of constant geometric pitch when set to 22 degrees at the reference station; FAST_SECTION.
 */
export const CS_PROPELLER: PropellerDef = {
  ...C172_PROPELLER,
  name: 'constant-speed feathering propeller, 76 in, two blades (test-bed)',
  diameter: 76 * INCH,
  blades: 2,
  hubRadius: 0.16,
  twist: helixTwist(22 * DEG, 0.79),
  referenceStation: 0.79,
  section: FAST_SECTION,
  inertia: 1.7,
  pitchControl: {
    kind: 'constantSpeed',
    fineStop: CS_FINE,
    coarseStop: CS_FEATHER,
    feather: { angle: CS_FEATHER, latchRpm: 800, latchAngle: 17 * DEG, unfeather: 'starter' },
    rateToFine: 12 * DEG,
    rateToCoarse: (CS_FEATHER - CS_FINE) / CS_FEATHER_SECONDS,
    // Gain: the blades move at the full coarse rate once the speed is about 60 rpm off; the rate sensing damps
    // a lever or power change to an overshoot of a few rpm, settled within a second (tests/propulsion/governor.test.ts).
    governor: { minRpm: 1700, maxRpm: 2700, gain: 0.03, dampingTime: 0.2 },
    failsTo: 'feather',
    // Every 2.5 degrees through the governing range (to 33.5: a dive at low rpm), sparse on the way to feather.
    pitchNodes: [13.5, 16, 18.5, 21, 23.5, 26, 28.5, 31, 33.5, 38, 46, 58, 80].map((deg) => deg * DEG),
  },
};

/** Twist table (angle relative to the reference station against r / R) of a constant-pitch helix that is `design` at `station`. */
function helixTwist(design: number, station: number): PropellerDef['twist'] {
  const x = [0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  return { kind: 'table', x, angle: x.map((xi) => Math.atan((Math.tan(design) * station) / xi) - design) };
}

/** One constant-speed unit: rotation +1 clockwise seen from the cockpit (the left engine of a PA-34), -1 the other way. */
export function constantSpeedUnit(rotation: 1 | -1, hub: Vec3 = twinHub(rotation === 1 ? -1 : 1)): EngineInstallation {
  return { engine: IO360_ENGINE, propeller: CS_PROPELLER, hub, rotation };
}

/** A twin's feed: its own tank ON, the other side's on CROSSFEED; engine-driven and electric pumps, injectors. */
function twinFeed(own: number, other: number, base: FuelFeedDef = C172_FEED): FuelFeedDef {
  return { ...base, positions: { on: [own], crossfeed: [other] }, enginePump: { psi: 25 }, auxPump: { psi: 20, minVolts: 9 } };
}

const TWIN_TANKS: PowerplantDef['fuel']['tanks'] = [
  { id: 'left', side: 'left', capacity: 127, position: { x: 0, y: -2.6, z: 0 } },
  { id: 'right', side: 'right', capacity: 127, position: { x: 0, y: 2.6, z: 0 } },
];

const TWIN_BUS_14V: ElectricalDef = {
  ...BUS_14V,
  alternators: [
    { engine: 0, maxAmps: 60, cutInRpm: 500, fullRpm: 1500, efficiency: 0.55 },
    { engine: 1, maxAmps: 60, cutInRpm: 500, fullRpm: 1500, efficiency: 0.55 },
  ],
};

/** Counter-rotating constant-speed twin, two tanks with crossfeed, 14 V bus with two alternators. Left engine first. */
export const TWIN_CS_POWERPLANT: PowerplantDef = {
  engines: [constantSpeedUnit(1), constantSpeedUnit(-1)],
  fuel: { tanks: TWIN_TANKS, feeds: [twinFeed(0, 1), twinFeed(1, 0)] },
  electrical: TWIN_BUS_14V,
};

/** Co-rotating fixed-pitch twin: two Cessna 172S units (their propeller map is shared), the same tanks and bus. */
export const TWIN_FP_POWERPLANT: PowerplantDef = {
  engines: [
    { ...C172_POWERPLANT.engines[0], hub: twinHub(-1) },
    { ...C172_POWERPLANT.engines[0], hub: twinHub(1) },
  ],
  fuel: { tanks: TWIN_TANKS, feeds: [twinFeed(0, 1), twinFeed(1, 0)] },
  electrical: TWIN_BUS_14V,
};

// --------------------------------------------------------------------------------------------- FADEC diesel unit
/** g/kWh to kg/J. */
const G_PER_KWH = 1e-3 / 3.6e6;

/**
 * Austro AE300 of the DA42 NG: 123.5 kW at 3880 crank rpm (2300 propeller rpm through the 1.69 gear), 1.991 L,
 * 17.5 : 1, FADEC. LOAD is the identity of the power lever; the ECU governs the propeller at 2150 rpm at idle,
 * 1800 at 20 %, 2100 at 92 %, 2300 at 100 %; specific consumption from the handbook's fuel-flow table at
 * 0.80 kg/L; 92 % is available to about 14 000 ft (da42.md, sections 4 and 5; contract 5.5). The full-load
 * torque must reach 305.6 N m at 3550 crank rpm for the 92 % point (113.6 kW at 2100 propeller rpm).
 */
export const DIESEL_ENGINE: EngineDef = {
  name: 'AE300-like FADEC diesel (test-bed)',
  kind: 'dieselFadec',
  cylinders: 4,
  ratedPower: 123_500,
  ratedRpm: 3880,
  idleRpm: 1200,
  displacement: 1.991e-3,
  compressionRatio: 17.5,
  fuel: JET_A1,
  // A diesel reads the ram recovery and the alternate air only.
  induction: { ...C172_ENGINE.induction, ramRecovery: 0.5, alternateAir: { heatRise: 20, pressureLoss: 0.03 } },
  metering: { kind: 'fadecDiesel' },
  ignition: { kind: 'compression', minFiringRpm: 300, glow: { preheatSeconds: 5, amps: 30, neededBelowC: 60 } },
  thermal: {
    ...C172_THERMAL,
    cooling: 'liquid',
    headHeatFraction: 0.25,
    oilCapacity: 30e3,
    oilCoolerConductance: 120,
    // 4 bar at 3000 crank rpm, relief at 4.5 bar.
    oilPsiPerRpm: 0.02,
    oilReliefPsi: 65,
    liquid: { thermostatC: 88, radiatorConductance: 900, coolantCapacity: 60e3, gearboxCapacity: 12e3, gearboxConductance: 35 },
    warm: { egt: 500, cht: 90, oilTemp: 95, oilPressure: 58, coolantTemp: 90, gearboxTemp: 70 },
  },
  fmep: [1.0e5, 0.15e5, 0.05e5],
  coldFrictionFactor: 2,
  compressionLossTorque: 25,
  breakawayTorque: 40,
  rotatingInertia: 0.15,
  gearRatio: 1.69,
  runningRpm: 800,
  airStartRpm: 3380,
  groundStartRpm: 1200,
  starter: { k: 0.0012, r: 0.07 },
  fadec: {
    loadVsLever: [[0, 0], [1, 1]],
    propRpmVsLever: [[0, 2150], [0.2, 1800], [0.92, 2100], [1, 2300]],
    fullLoadTorque: [[800, 120], [1200, 180], [2000, 280], [2500, 300], [3000, 307], [3600, 307], [3880, 304.5], [4300, 270]],
    criticalAltitude: 4000,
    bsfcVsLoad: [[0.3, 237], [0.4, 227], [0.5, 214], [0.6, 211], [0.7, 208], [0.75, 212], [0.85, 217], [0.92, 222], [1, 230]].map(
      ([load, gPerKwh]) => [load, gPerKwh * G_PER_KWH] as const,
    ),
    torqueLag: 0.4,
    minBusVolts: 18,
    backupSeconds: 1800,
    alternatorFed: true,
  },
};

const MT_FINE = 12 * DEG;
const MT_FEATHER = 81 * DEG;

/**
 * MT MTV-6-R-C-F of the DA42 NG: 1.87 m, three blades, angles at 0.75 R: low pitch 12 degrees, feather 81,
 * start lock 15 (the latch angle), latched below 1300 rpm, unfeathered by an accumulator; loss of oil pressure
 * drives the blades toward feather (da42.md, section 5). Three narrower blades of the 172's planform; FAST_SECTION.
 */
export const DIESEL_PROPELLER: PropellerDef = {
  ...C172_PROPELLER,
  name: 'three-blade constant-speed propeller, 1.87 m (test-bed)',
  diameter: 1.87,
  blades: 3,
  hubRadius: 0.15,
  chordOverR: C172_PROPELLER.chordOverR.map((c) => 0.92 * c),
  twist: helixTwist(24 * DEG, 0.75),
  referenceStation: 0.75,
  section: FAST_SECTION,
  inertia: 0.95,
  pitchControl: {
    kind: 'constantSpeed',
    fineStop: MT_FINE,
    coarseStop: MT_FEATHER,
    feather: { angle: MT_FEATHER, latchRpm: 1300, latchAngle: 15 * DEG, unfeather: 'accumulator' },
    rateToFine: 14 * DEG,
    rateToCoarse: 14 * DEG,
    governor: { minRpm: 1800, maxRpm: 2300, gain: 0.03, dampingTime: 0.2 },
    failsTo: 'feather',
    pitchNodes: [12, 14.5, 17, 19.5, 22, 24.5, 27, 29.5, 32, 34.5, 37, 40, 48, 60, 81].map((deg) => deg * DEG),
  },
};

/** One FADEC diesel unit (clockwise, as both of a DA42's are). `fadec`: members to replace in its schedules. */
export function dieselUnit(hub: Vec3 = twinHub(-1), fadec: Partial<NonNullable<EngineDef['fadec']>> = {}): EngineInstallation {
  const engine: EngineDef = { ...DIESEL_ENGINE, fadec: { ...DIESEL_ENGINE.fadec!, ...fadec } };
  return { engine, propeller: DIESEL_PROPELLER, hub, rotation: 1 };
}

/** A diesel's feed: electric low-pressure pumps and the engine-driven pump supply the common rail. */
function dieselFeed(own: number, other: number): FuelFeedDef {
  return {
    positions: { on: [own], crossfeed: [other] },
    gravityHeadPsi: 0,
    feedCapacity: 0.05,
    lineCapacity: 0.12,
    lineUnusable: 0.012,
    enginePump: { psi: 60 },
    auxPump: { psi: 60, minVolts: 16 },
    delivery: { kind: 'commonRail', minPsi: 40 },
    film: { fraction: 0, time: 0 },
  };
}

const DIESEL_BUS: ElectricalDef = {
  ...C172_POWERPLANT.electrical,
  alternators: [
    { engine: 0, maxAmps: 70, cutInRpm: 1000, fullRpm: 2200, efficiency: 0.55 },
    { engine: 1, maxAmps: 70, cutInRpm: 1000, fullRpm: 2200, efficiency: 0.55 },
  ],
  loads: { ...C172_POWERPLANT.electrical.loads, gearPump: 25, glow: 30, ecu: 3 },
};

/** Co-rotating FADEC diesel twin: crossfeed, 28 V bus with two alternators. `fadec`: members to replace in both engines' schedules. */
export function twinDieselPowerplant(fadec: Partial<NonNullable<EngineDef['fadec']>> = {}): PowerplantDef {
  return {
    engines: [dieselUnit(twinHub(-1), fadec), dieselUnit(twinHub(1), fadec)],
    fuel: {
      tanks: [
        { id: 'left', side: 'left', capacity: 76, position: { x: 0, y: -2.6, z: 0 } },
        { id: 'right', side: 'right', capacity: 76, position: { x: 0, y: 2.6, z: 0 } },
      ],
      feeds: [dieselFeed(0, 1), dieselFeed(1, 0)],
    },
    electrical: DIESEL_BUS,
  };
}

export const TWIN_DIESEL_POWERPLANT: PowerplantDef = twinDieselPowerplant();

/** The powerplant of one installation alone on a twin's fuel system and bus (for tests of one unit). */
export function singlePowerplant(install: EngineInstallation, like: PowerplantDef = TWIN_CS_POWERPLANT): PowerplantDef {
  return {
    engines: [{ ...install, hub: { x: 1.6, y: 0, z: 0 } }],
    fuel: { tanks: like.fuel.tanks, feeds: [{ ...like.fuel.feeds[0], positions: { on: [0, 1], both: [0, 1], crossfeed: [1] } }] },
    electrical: { ...like.electrical, alternators: [like.electrical.alternators[0]] },
  };
}
