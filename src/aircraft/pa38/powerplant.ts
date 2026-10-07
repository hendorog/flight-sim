// Piper PA-38-112 Tomahawk II: the powerplant as data. One Lycoming O-235-L2C (112 hp at 2600 rpm in this
// installation, float carburettor with heat from the muffler shroud, no accelerator pump, direct drive) driving a
// Sensenich 72CK-0-56 (72 in diameter, 56 in pitch, two blades); two wing tanks in the inboard leading edges of a
// LOW wing feeding one at a time through a LEFT / RIGHT / OFF selector, so the fuel is lifted to the carburettor's
// float bowl by the engine-driven pump, with the electric pump beside it for take-off, landing and tank changes
// (no gravity head); the 14 V bus. Plain data.
//
// Figures from the type's engineering data sheet (aircraft-data/pa38.md in the design work folder; "s.N" is its
// section N). The engine is the Cessna 152's O-235-L2C (aircraft/c152/powerplant.ts, where the numbers the sheets
// do not give are derived from the Cessna 172S's IO-360), at the Tomahawk's rating.

import { DEG, HP, LB } from '../../core/math';
import { C172_BLADE_SECTION, C172_ENGINE, C172_PROPELLER } from '../../physics/propulsion/c172Powerplant';
import { AVGAS_100LL, type BladeSectionDef, type EngineDef, type PowerplantDef, type PropellerDef } from '../../physics/propulsion/defs';
import { PA38_GEOMETRY } from './geometry';

const INCH = 0.0254;
/** kg/s per US gal/h of 100LL. */
const GPH = (3.785411784e-3 * AVGAS_100LL.density) / 3600;
const PROP = PA38_GEOMETRY.propellers[0];

/**
 * Lycoming O-235-L2C as installed (POH 1.3, 2.7, TCDS A18SO: 112 hp at 2600 rpm for all operations; the engine's
 * own rating is 118 hp at 2800; s.4): 3.82 L, 8.5 : 1, Marvel-Schebler MA-3 family float carburettor, idle
 * 550-650 rpm (POH 4.19, MM 73-10-00). The idle bypass and the full-rich mixture are not given: the engine solves
 * them from the idle speed and the take-off fuel flow. Induction, carburettor, thermal paths and the rotating
 * parts are the C152's (the same engine).
 */
export const PA38_ENGINE: EngineDef = {
  ...C172_ENGINE,
  name: 'Lycoming O-235-L2C',
  ratedPower: 112 * HP,
  ratedRpm: 2600,
  // The idle bypass is solved for this speed; on the ground, warm, with the alternator's load and the propeller in
  // still air, the engine then idles near the middle of the handbook's 550-650 rpm.
  idleRpm: 630,
  displacement: 3.823e-3,
  compressionRatio: 8.5,
  induction: {
    ...C172_ENGINE.induction,
    // MA-3 throttle bore, about 2 in.
    throttleBoreArea: Math.PI * 0.0255 * 0.0255,
    idleArea: undefined,
    // Air box and filter of the smaller engine, and its exhaust (the IO-360's scaled by the air flow).
    inletArea: 1.0e-3,
    exhaustCoeff: 4.6e5,
    // The carburettor air comes in through a chin scoop under the spinner (s.12) and a filter: little ram recovery.
    ramRecovery: 0.3,
    carburettor: {
      // Full heat: unfiltered air from the muffler shroud (POH 7.11), 45 K warmer, through a duct that costs 12 % of
      // the pressure at the rated air flow: the C152's, whose rpm drops it was set for. The Tomahawk's drop is not
      // published (s.4: ESTIMATE 50-100 rpm at 1800-2000 rpm).
      heatRise: 45,
      heatPressureLoss: 0.12,
      venturiDropIdle: 28,
      venturiDropFull: 17,
      iceRatePerMin: 0.07,
      meltRatePerMin: 0.5,
      iceBlockage: 0.6,
    },
  },
  // About 9.3 US gal/h full rich at take-off power (s.4, ESTIMATE: 112 hp at 0.50 lb/hp/h).
  metering: { kind: 'floatCarburettor', takeoffFuelFlow: 9.3 * GPH, leanestFraction: 0.35 },
  thermal: { ...C172_ENGINE.thermal, headCapacity: 26e3, headConductance: 150, oilCapacity: 30e3, oilCoolerConductance: 90 },
  compressionLossTorque: 20,
  breakawayTorque: 39,
  // Crankshaft, rods and ring gear of the 3.8 L engine; with the propeller's 0.95 the assembly is 1.28 kg m^2.
  rotatingInertia: 0.33,
  airStartRpm: 2200,
  // Prestolite 12 V starter (POH 6.9): about 35 N m at 200 A, cranking near 200 rpm.
  starter: { k: 0.0009, r: 0.03 },
};

/**
 * The blade section: the C152's (the 172's Clark-Y-like section with a thinner blade's zero-lift angle and maximum
 * lift; aircraft/c152/powerplant.ts explains each number), calibrated there on the same engine's handbook static
 * rpm and cruise power with McCauley's blade.
 */
const PA38_BLADE_SECTION: BladeSectionDef = { ...C172_BLADE_SECTION, alpha0: -3.5 * DEG, clMaxLowSpeed: 1.62, clMaxMachLoss: 1.0, clMin: -1.0 };

/**
 * Sensenich 72CK-0-56 (POH 1.5, 7.5; s.5): one-piece aluminium, 72 in (70 in minimum after repair), two blades, 56 in
 * pitch at 0.75 R (18.3 degrees). The planform of a fixed-pitch metal blade (the 172's chord and thickness
 * distributions over the radius).
 */
export const PA38_PROPELLER: PropellerDef = {
  ...C172_PROPELLER,
  name: 'Sensenich 72CK-0-56',
  diameter: PROP.diameter,
  blades: PROP.blades,
  hubRadius: 0.13,
  twist: { kind: 'helix', pitch: 56 * INCH },
  section: PA38_BLADE_SECTION,
  // Propeller (11.3 kg) and spinner with its plates (2.3 kg) (POH 6.9).
  inertia: 0.95,
  pitchControl: { kind: 'fixed' },
};

/** Usable fuel per tank: 15 US gal of the 16 (s.6), 6.0 lb/gal. */
const TANK_USABLE = 15 * 6.0 * LB;

export const PA38_POWERPLANT: PowerplantDef = {
  engines: [{ engine: PA38_ENGINE, propeller: PA38_PROPELLER, hub: PROP.hub, rotation: PROP.rotation }],
  fuel: {
    // Two 16 gal tanks forming the inboard leading edge of each wing, arm STA 75.4 (x = +0.047), spanwise centroid
    // about 1.1 m out, at the low wing's chord plane (about WL 25) (s.6).
    tanks: [
      { id: 'left', side: 'left', capacity: TANK_USABLE, position: { x: 0.047, y: -1.1, z: 0.29 } },
      { id: 'right', side: 'right', capacity: TANK_USABLE, position: { x: 0.047, y: 1.1, z: 0.29 } },
    ],
    feeds: [
      {
        // LEFT, RIGHT and OFF (no BOTH; s.9): one tank at a time.
        positions: { left: [0], right: [1] },
        // The tanks are below the carburettor: no head of fuel.
        gravityHeadPsi: 0,
        feedCapacity: 0.03,
        lineCapacity: 0.1,
        lineUnusable: 0.01,
        // The engine-driven diaphragm pump and the electric auxiliary pump each hold about 4-5 psi (the gauge's
        // green arc is 0.5-8 psi, POH 2.9); the electric pump works down to a flat battery's 9 V.
        enginePump: { psi: 4.5 },
        auxPump: { psi: 5, minVolts: 9 },
        delivery: { kind: 'carburettorBowl', capacity: 0.06, minHeadPsi: 0.3 },
        film: { fraction: 0.4, time: 0.4 },
      },
    ],
  },
  electrical: {
    nominalVolts: 14,
    regulatorVolts: 14.2,
    // 12 V, 25 Ah battery on the firewall (POH 7.15, s.9).
    battery: { capacityAh: 25, ocvEmpty: 11.6, ocvSpan: 1.3, rDischarge: 0.012, rChargeBase: 0.04, rChargeFull: 0.75 },
    // 60 A belt-driven alternator (s.9).
    alternators: [{ engine: 0, maxAmps: 60, cutInRpm: 500, fullRpm: 1500, efficiency: 0.55 }],
    // Nominal load currents at 14 V, A (the 28 V figures of the C152 doubled): one nav / com and a transponder, no
    // avionics master's own load; the night package's landing light in the nose cowl (no taxi light), nav lights,
    // wingtip strobes and no beacon; the electric fuel pump. About 30 A at night with the radios (s.9).
    loads: {
      master: 3.0,
      avionics: 8.0,
      nav: 5.6,
      beacon: 0,
      strobe: 7.0,
      landing: 7.2,
      taxi: 0,
      panelFull: 3.0,
      pitotHeat: 10.0,
      fuelPump: 1.5,
    },
    // The alternator light comes on as the bus falls toward the battery's 12.5 V; the over-voltage relay trips at
    // about 16.5 V (s.9); the bus-powered instruments die below 9 V.
    lowVoltsLamp: 12.5,
    overVolts: 16.5,
    busDeadVolts: 9,
  },
};
