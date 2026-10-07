// Piper PA-34-200 Seneca I: the powerplant as data. Two Lycoming IO-360-C1E6 (left) and LIO-360-C1E6 (right, the
// opposite crank rotation), 200 hp at 2700 rpm each, Bendix RSA-5 injection, alternate air instead of carburettor
// heat, three-position cowl flaps; Hartzell HC-C2YK-2 two-blade constant-speed full-feathering propellers turning
// the two ways (left clockwise, right counter-clockwise from the cockpit), unfeathered with the starter; one
// combined tank a side, each engine on its own side with an ON / OFF / CROSSFEED selector, engine-driven and
// electric pumps, no gravity head (low wing); one 14 V bus with a 35 Ah battery and an alternator on each engine.
// Plain data.
//
// Figures from the type's engineering data sheet (aircraft-data/pa34.md in the design work folder; "s.N" is its
// section N). The engine is the Cessna 172S's IO-360 family (physics/propulsion/c172Powerplant.ts explains every
// number not repeated here) at the Seneca's rating and compression.

import { DEG, HP, LB } from '../../core/math';
import { C172_BLADE_SECTION, C172_ENGINE, C172_POWERPLANT, C172_PROPELLER } from '../../physics/propulsion/c172Powerplant';
import { AVGAS_100LL, type BladeSectionDef, type ColdFilmDef, type EngineDef, type FuelFeedDef, type PowerplantDef, type PropellerDef } from '../../physics/propulsion/defs';
import { PA34_GEOMETRY, pa34HeightZ, pa34StationX } from './geometry';

/** kg/s per US gal/h of 100LL. */
const GPH = (3.785411784e-3 * AVGAS_100LL.density) / 3600;
const [LEFT_PROP, RIGHT_PROP] = PA34_GEOMETRY.propellers;

/**
 * Lycoming IO-360-C1E6 (s.4; TCDS A7SO): 200 hp at 2700 rpm for all operations, 5.92 L, 8.7 : 1, angle-valve
 * heads, RSA-5 injection, normally aspirated. The idle speed is the sheet's estimate (600-700 rpm); the idle bypass
 * and the full-rich mixture are solved from it and from the take-off fuel flow, 15.8 US gal/h full rich at sea
 * level (s.4: extrapolated from the handbook's leaned targets). CALIBRATED on the OH-8 power table, a best-power
 * table: with it full rich is about 3 % below best power at sea level, the table's 75 % settings give 150-157 hp at
 * best power and 10.4-10.7 US gal/h (OH-1: 10.3), bsfc 0.41 (s.8). The sheet's other estimate, 17.5, metered full
 * rich 9 % below best power at sea level and 18 % at 6000 ft (166 hp at the "75 %" settings, bsfc 0.38).
 */
export const PA34_ENGINE: EngineDef = {
  ...C172_ENGINE,
  name: 'Lycoming IO-360-C1E6',
  ratedPower: 200 * HP,
  ratedRpm: 2700,
  idleRpm: 650,
  displacement: 5.92e-3,
  compressionRatio: 8.7,
  induction: {
    ...C172_ENGINE.induction,
    idleArea: undefined,
    // The manual alternate-air door takes unfiltered air warmed by the crossover exhaust (s.4): a small rpm drop at
    // the run-up (s.4 ESTIMATE 25-50 rpm). Set on it: 37 rpm at 2000 rpm (15 K and 0.02 gave 20; at the run-up's
    // air flow the drop follows the warming, hardly the pressure loss).
    alternateAir: { heatRise: 30, pressureLoss: 0.03 },
  },
  // Priming (s.9, s.10): the electric pump on, the mixture rich "until fuel flow shows" (ESTIMATE: about 5 gal/h on
  // the gauge with the engine at rest).
  metering: { kind: 'rsaInjection', takeoffFuelFlow: 15.8 * GPH, leanestFraction: 0.35, primeFlow: 5 * GPH },
  // Cowl flaps (s.4): closed, the cooling air flow through the baffles falls to about two thirds. Oil pressure
  // (s.7: green 60-90 psi, red line 90): cold oil overdrives the relief valve less than on the 172S's 115 psi gauge
  // (a cold start reads in the green at 15 C and reaches the red line only below about 0 C), and the direct-reading
  // gauge's capillary line takes a few seconds to come up with cold oil (s.10: "rising within 30 s").
  thermal: { ...C172_ENGINE.thermal, cowlFlapClosedFactor: 0.65, oilColdOverdrivePsi: 10, oilGauge: { time: 0.5, coldTime: 6 } },
  // Crankshaft, rods and flywheel of the 200 hp engine with its ring gear (the 172S's 0.5 with the heavier
  // counterweighted crank).
  rotatingInertia: 0.55,
  airStartRpm: 2300,
  // 12 V starter (s.4, s.9) on a 5.9 L engine: about 45 N m cranking near 180 rpm.
  starter: { k: 0.0011, r: 0.022 },
};

/** Time from the fine stop to feather, s (s.5: "about 6 s"). */
const FEATHER_SECONDS = 6;
/** Blade angles at the 30 in station (s.5; TCDS): low pitch 13.5 degrees, feather 79-81. */
const FINE_STOP = 13.5 * DEG;
const FEATHER = 80 * DEG;

/**
 * Blade section of the Hartzell C7666A-0 blade: the 172's (c172Powerplant.ts) with
 *  - the maximum lift a thinner, faster section keeps at high subsonic speed (1.6, falling 1.0 per unit Mach above
 *    0.3) and the broadside drag of a blade of aspect ratio about 12 (1.3, Hoerner, flat plates), as on the
 *    constant-speed test-bed (tests/propulsion/testbed.ts): with the 172's section the tips of a 76 in blade at
 *    2700 rpm (tip Mach 0.8) stall statically on the 13.5 degree fine stop. cdMax sets the drag of a STOPPED
 *    blade only (contract 3.2);
 *  - CALIBRATED (contract 5.4 calibration order, step 2): the drag rise with lift. The handbook's 1360 ft/min at
 *    Vy with the top speed's drag asks for a propeller efficiency of about 0.70 at J = 0.56 (s.8 verification
 *    note, contract 5.4), where the 172's 0.01 gave 0.775; 0.15 gives 1384 ft/min (0.12: 1421, which also left the
 *    one-engine climb at the top of its band) and keeps the top speed;
 *  - the zero-lift angle of a cambered section measured to its CHORD (Hartzell quotes blade angles to the chord,
 *    McCauley's fixed-pitch figures to the flat face), set within -1.5 to -0.8 degrees for the static rpm on the
 *    fine stop (s.5: 2650-2700): -0.8 degrees (2666 rpm with the drag rise above).
 */
const PA34_BLADE_SECTION: BladeSectionDef = { ...C172_BLADE_SECTION, alpha0: -0.8 * DEG, clMaxLowSpeed: 1.6, clMaxMachLoss: 1.0, cdMax: 1.3, dragDueToLift: 0.15 };

/** Twist table of a constant-geometric-pitch blade set to `design` at `station` (angles relative to that station). */
function helixTwist(design: number, station: number): PropellerDef['twist'] {
  const x = [0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  return { kind: 'table', x, angle: x.map((xi) => Math.atan((Math.tan(design) * station) / xi) - design) };
}

/**
 * Hartzell HC-C2YK-2( )E / C7666A-0 (left; the right is the -LE hub with JC7666A-0 blades, the mirror image) (s.5):
 * 76 in, two blades, constant speed and full feathering. Angles at the 30 in station (0.79 R). Oil from the F-6-18A
 * governor drives the blades fine; the dome's nitrogen charge and the counterweights drive them coarse and to
 * feather, which they also do with no oil pressure; centrifugal latches stop feathering below 800 rpm; no
 * accumulator, so the starter unfeathers it (s.5). Planform of a metal blade of this size (the 172's chord and
 * thickness distributions); the twist that of a blade of constant geometric pitch set to 22 degrees at the
 * reference station.
 */
export const PA34_PROPELLER: PropellerDef = {
  ...C172_PROPELLER,
  name: 'Hartzell HC-C2YK-2 / C7666A-0',
  diameter: LEFT_PROP.diameter,
  blades: LEFT_PROP.blades,
  hubRadius: 0.16,
  twist: helixTwist(22 * DEG, 0.79),
  referenceStation: 0.79,
  section: PA34_BLADE_SECTION,
  // Two aluminium blades, hub, dome and spinner (about 25 kg).
  inertia: 1.7,
  pitchControl: {
    kind: 'constantSpeed',
    fineStop: FINE_STOP,
    coarseStop: FEATHER,
    feather: { angle: FEATHER, latchRpm: 800, latchAngle: 17 * DEG, unfeather: 'starter' },
    rateToFine: 12 * DEG,
    rateToCoarse: (FEATHER - FINE_STOP) / FEATHER_SECONDS,
    // 2700 rpm at the lever's top (TCDS). The lower governing limit is the sheet's estimate of 1900-2000 rpm, but
    // the run-up's propeller exercise at 2000 rpm asks for a 200-300 rpm drop (s.10), so the low end is put at
    // 1700 (contract 5.4). Gain and rate sensing as the constant-speed test-bed's (settled within a second).
    governor: { minRpm: 1700, maxRpm: 2700, gain: 0.03, dampingTime: 0.2 },
    failsTo: 'feather',
    // Every 2.5 degrees through the governing range (to 33.5: a dive at low rpm), sparse on the way to feather.
    pitchNodes: [13.5, 16, 18.5, 21, 23.5, 26, 28.5, 31, 33.5, 38, 46, 58, 80].map((deg) => deg * DEG),
  },
};

/**
 * Usable fuel per side: 46.5 US gal of the 49 (two interconnected 24.5 gal tanks in each wing's leading edge,
 * outboard of the nacelle; s.6), 6.0 lb/gal.
 */
const SIDE_USABLE = 46.5 * 6.0 * LB;
/** Arm 93.6 in (TCDS); spanwise centroid about 3.4 m out (s.2.5 ESTIMATE), at the leading edge's height there. */
const TANK_X = pa34StationX(93.6);
const TANK_Y = 3.4;
const TANK_Z = pa34HeightZ(0.4);

const C172_FEED = C172_POWERPLANT.fuel.feeds[0];

/**
 * The ports of a cold engine (s.10: a cold start is primed, a hot one is not; ESTIMATE, general Lycoming practice):
 * on cold heads most of the spray wets the walls and evaporates slowly, so cranked with the mixture rich and no
 * prime the engine fires only after about 6 s of cranking at 15 C and about 20 s at -10 C, while a 3-5 s prime
 * (longer in the cold) fires it at once. Warm (70 C heads) it is the 172S's film. The four ports hold about 40 mL
 * before fuel runs out of the induction drains: a minute of priming floods the engine.
 */
const COLD_PORTS: ColdFilmDef = {
  temperatureC: [-20, 0, 15, 40, 70],
  fraction: [0.92, 0.86, 0.78, 0.6, C172_FEED.film.fraction],
  time: [55, 32, 25, 6, C172_FEED.film.time],
  capacity: 0.03,
};

/**
 * Engine `own`'s feed: its own side ON, the other side on CROSSFEED (s.9: two floor selectors, ON / OFF / X-FEED).
 * The engine-driven pump and the electric auxiliary pump behind the firewall each feed the RSA servo; the gauge's
 * green arc is 14-35 psi (s.7). The tanks are below the engines: no head of fuel.
 */
function feed(own: number, other: number): FuelFeedDef {
  return {
    ...C172_FEED, positions: { on: [own], crossfeed: [other] }, gravityHeadPsi: 0, enginePump: { psi: 25 }, auxPump: { psi: 20, minVolts: 9 },
    film: { ...C172_FEED.film, cold: COLD_PORTS },
  };
}

export const PA34_POWERPLANT: PowerplantDef = {
  engines: [
    { engine: PA34_ENGINE, propeller: PA34_PROPELLER, hub: LEFT_PROP.hub, rotation: LEFT_PROP.rotation },
    { engine: PA34_ENGINE, propeller: PA34_PROPELLER, hub: RIGHT_PROP.hub, rotation: RIGHT_PROP.rotation },
  ],
  fuel: {
    tanks: [
      { id: 'left', side: 'left', capacity: SIDE_USABLE, position: { x: TANK_X, y: -TANK_Y, z: TANK_Z } },
      { id: 'right', side: 'right', capacity: SIDE_USABLE, position: { x: TANK_X, y: TANK_Y, z: TANK_Z } },
    ],
    feeds: [feed(0, 1), feed(1, 0)],
  },
  electrical: {
    nominalVolts: 14,
    regulatorVolts: 14.0,
    // 12 V, 35 Ah battery in the nose (s.9).
    battery: { capacityAh: 35, ocvEmpty: 11.6, ocvSpan: 1.3, rDischarge: 0.01, rChargeBase: 0.035, rChargeFull: 0.65 },
    // Two 60 A alternators with solid-state regulators, one on each engine (s.9).
    alternators: [
      { engine: 0, maxAmps: 60, cutInRpm: 500, fullRpm: 1500, efficiency: 0.55 },
      { engine: 1, maxAmps: 60, cutInRpm: 500, fullRpm: 1500, efficiency: 0.55 },
    ],
    // Nominal load currents at 14 V, A (the 28 V figures of the C172S doubled where the equipment is alike): two
    // nav / coms, ADF, transponder and audio panel; the landing light on the nose leg (no taxi light), nav lights,
    // beacon and strobes; pitot heat with the heated stall vanes; one electric fuel pump (each engine's counts
    // once); the hydraulic power pack of the gear while it runs.
    loads: {
      master: 3.0,
      avionics: 10.0,
      nav: 5.6,
      beacon: 4.2,
      strobe: 7.0,
      landing: 8.0,
      taxi: 0,
      panelFull: 3.0,
      pitotHeat: 12.0,
      fuelPump: 2.5,
      gearPump: 30,
    },
    // The over-voltage relays trip at about 16.5 V (s.9); the bus-powered instruments die below 9 V.
    lowVoltsLamp: 12.5,
    overVolts: 16.5,
    busDeadVolts: 9,
  },
};
