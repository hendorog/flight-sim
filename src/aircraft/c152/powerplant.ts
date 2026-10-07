// Cessna 152 (1978 model): the powerplant as data. One Lycoming O-235-L2C (110 hp at 2550 rpm, float carburettor
// with heat from the muffler shroud, no accelerator pump, direct drive) driving a McCauley 1A103/TCM6958 (69 in
// diameter, 58 in geometric pitch, two blades); two wing tanks feeding together by gravity through an ON / OFF
// shut-off valve into the carburettor's float bowl, no pumps of any kind; the 28 V bus. Plain data.
//
// Figures from the type's engineering data sheet (aircraft-data/c152.md in the design work folder; "s.N" is its
// section N). Where the sheet has nothing (induction areas, friction, thermal masses, the blade's planform) the
// numbers are those of the Cessna 172S's IO-360 (physics/propulsion/c172Powerplant.ts), scaled by displacement
// where the size matters, and say so.

import { DEG, HP, LB } from '../../core/math';
import { C172_BLADE_SECTION, C172_ENGINE, C172_POWERPLANT, C172_PROPELLER } from '../../physics/propulsion/c172Powerplant';
import { AVGAS_100LL, type BladeSectionDef, type EngineDef, type PowerplantDef, type PropellerDef } from '../../physics/propulsion/defs';
import { C152_GEOMETRY } from './geometry';

const INCH = 0.0254;
/** kg/s per US gal/h of 100LL. */
const GPH = (3.785411784e-3 * AVGAS_100LL.density) / 3600;
const PROP = C152_GEOMETRY.propellers[0];

/**
 * Lycoming O-235-L2C as installed (TCDS 3A19: 110 hp at 2550 rpm for all operations; s.4): 3.823 L, 8.5 : 1,
 * Marvel-Schebler MA-3A updraught float carburettor, idle 600 rpm (SM 11-49). The idle bypass and the full-rich
 * mixture are not given: the engine solves them from the idle speed and the take-off fuel flow.
 */
export const C152_ENGINE: EngineDef = {
  ...C172_ENGINE,
  name: 'Lycoming O-235-L2C',
  ratedPower: 110 * HP,
  ratedRpm: 2550,
  // The idle bypass is solved for this speed; on the ground, warm, with the alternator's load and the propeller in
  // still air, the engine then idles at about 625 rpm: SM 11-49's 600 +/-25 at its top, inside the school's 600-700.
  idleRpm: 655,
  displacement: 3.823e-3,
  compressionRatio: 8.5,
  induction: {
    ...C172_ENGINE.induction,
    // MA-3A throttle bore, about 2 in.
    throttleBoreArea: Math.PI * 0.0255 * 0.0255,
    idleArea: undefined,
    // Air box and filter of the smaller engine, and its exhaust (the IO-360's scaled by the air flow).
    inletArea: 1.0e-3,
    exhaustCoeff: 4.6e5,
    // An updraught carburettor fed through the filter in the lower cowl has little ram recovery to lose.
    ramRecovery: 0.3,
    carburettor: {
      // Full heat: unfiltered air from the muffler shroud, 45 K warmer, through a duct that costs 12 % of the
      // pressure at the rated air flow. Set for the handbook's rpm drops (POH sect. 7: 150-200 rpm at full
      // throttle; about 50-100 at the 1700 rpm run-up, s.4); the duct loss is on the high side because the model
      // has no power enrichment at wide-open throttle to help it.
      heatRise: 45,
      heatPressureLoss: 0.12,
      venturiDropIdle: 28,
      venturiDropFull: 17,
      iceRatePerMin: 0.07,
      meltRatePerMin: 0.5,
      iceBlockage: 0.6,
    },
  },
  // About 9 US gal/h full rich at take-off power (s.4, ESTIMATE from the POH climb fuel: 1.2 gal in 8 min to
  // 5000 ft), 0.49 lb/hp/h.
  metering: { kind: 'floatCarburettor', takeoffFuelFlow: 9.0 * GPH, leanestFraction: 0.35 },
  // The IO-360's heat paths with the smaller engine's thermal masses (head and oil capacities about 2/3).
  thermal: { ...C172_ENGINE.thermal, headCapacity: 26e3, headConductance: 150, oilCapacity: 30e3, oilCoolerConductance: 90 },
  compressionLossTorque: 20,
  breakawayTorque: 39,
  // Crankshaft, rods and ring gear of the 3.8 L engine; with the propeller's 0.85 the assembly is 1.18 kg m^2.
  rotatingInertia: 0.33,
  airStartRpm: 2200,
  // The starter is the 172's 24 V series motor (the same Prestolite family on a smaller engine).
};

/**
 * The blade section: the 172's Clark-Y-like section (c172Powerplant.ts), CALIBRATED on two handbook figures the
 * blade's own section (not published) must give with the 58 in face pitch: 2280-2380 static rpm (POH sect. 2)
 * and 75 % power at 2550 rpm in the 8000 ft cruise (POH fig 5-7). With the 172's section the propeller turned
 * 2498 rpm statically and absorbed 75 % at 2460 rpm in the cruise: too little power on the stalled static blade,
 * too much at cruise advance ratios.
 *  - alpha0 -3.5 deg to the flat face: the Clark Y family at the thickness ratio of a thinner blade, about 0.07
 *    (-5.9 x 0.07 / 0.117), where the 172's blade is 0.09 (-4.5). It sets the aerodynamic pitch at cruise.
 *  - the maximum lift of a thinner section that keeps it at high subsonic speed (1.8 falling 1.0 per unit Mach
 *    above 0.3, the constant-speed test-bed blades' law): the static blade is less deeply stalled, so it carries
 *    its load with more induced inflow and absorbs more power. Tip Mach number 0.67 at 2550 rpm (s.5).
 *  - the negative lift limit of the less cambered section, -1.0 (the 172's -0.75 is a well-cambered Clark Y's;
 *    a symmetric section reaches -1.2 or more): a windmilling blade works at negative lift, and with -0.75 the
 *    dead engine's propeller stopped at 58 KIAS, above the POH's best glide (60 KIAS, "propeller windmilling",
 *    POH fig 3-1). Now it windmills down to about 52 KIAS; slowed toward the stall it still stops.
 * The 172's broadside drag (1.6) is kept: it sets the drag of a stopped blade.
 */
const C152_BLADE_SECTION: BladeSectionDef = { ...C172_BLADE_SECTION, alpha0: -3.5 * DEG, clMaxLowSpeed: 1.8, clMaxMachLoss: 1.0, clMin: -1.0 };

/**
 * McCauley 1A103/TCM6958 (TCDS 3A19; s.5): one-piece forged aluminium, 69 in, two blades, 58 in geometric pitch at
 * 0.75 R (19.6 degrees). The planform of McCauley's fixed-pitch blades (the 172's chord and thickness
 * distributions over the radius).
 */
export const C152_PROPELLER: PropellerDef = {
  ...C172_PROPELLER,
  name: 'McCauley 1A103/TCM6958',
  diameter: PROP.diameter,
  blades: PROP.blades,
  hubRadius: 0.13,
  twist: { kind: 'helix', pitch: 58 * INCH },
  section: C152_BLADE_SECTION,
  // Propeller (10.5 kg) and spinner.
  inertia: 0.85,
  pitchControl: { kind: 'fixed' },
};

/** Usable fuel per tank: 24.5 US gal usable of the 26 standard (s.6), 6.0 lb/gal. */
const TANK_USABLE = (24.5 / 2) * 6.0 * LB;

export const C152_POWERPLANT: PowerplantDef = {
  engines: [{ engine: C152_ENGINE, propeller: C152_PROPELLER, hub: PROP.hub, rotation: PROP.rotation }],
  fuel: {
    // Two 13 gal tanks between the spars of the inboard wing panels, arm FS 42 (x = -0.22), centroid about
    // 1.25 m out, just above the wing chord plane (s.2.5, s.6).
    tanks: [
      { id: 'left', side: 'left', capacity: TANK_USABLE, position: { x: -0.22, y: -1.25, z: -0.64 } },
      { id: 'right', side: 'right', capacity: TANK_USABLE, position: { x: -0.22, y: 1.25, z: -0.64 } },
    ],
    feeds: [
      {
        // One ON / OFF shut-off valve: both tanks feed together (s.9). 'both' is the generic default of the
        // controls, which the definition replaces by 'on'.
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
  electrical: {
    ...C172_POWERPLANT.electrical,
    nominalVolts: 28,
    regulatorVolts: 28.5,
    // 24 V, 14 Ah battery (s.9).
    battery: { ...C172_POWERPLANT.electrical.battery, capacityAh: 14 },
    // 60 A belt-driven alternator (s.9).
    alternators: [{ engine: 0, maxAmps: 60, cutInRpm: 400, fullRpm: 1400, efficiency: 0.55 }],
    // Nominal load currents at 28 V, A: no fuel pump; one nav / com and a transponder, no avionics master.
    loads: {
      master: 1.5,
      avionics: 4.0,
      nav: 2.8,
      beacon: 2.1,
      strobe: 3.5,
      landing: 3.6,
      // The optional second (taxi) lamp of the nose cowl, fitted to most trainers.
      taxi: 3.6,
      panelFull: 1.5,
      pitotHeat: 9.0,
      fuelPump: 0,
    },
    // The high-voltage warning light trips the alternator at about 31.5 V (s.9); the bus-powered instruments die below 18 V.
    lowVoltsLamp: 24.5,
    overVolts: 32,
    busDeadVolts: 18,
  },
};

