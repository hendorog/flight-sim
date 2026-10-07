// Diamond DA20-C1: the powerplant as data. One Continental IO-240-B (125 hp at 2800 rpm, continuous-flow fuel
// injection, alternate air instead of carburettor heat, direct drive) driving a Sensenich W69EK7-63 (69 in
// diameter, 62.8 in pitch, two laminated-wood blades); one aluminium tank in the fuselage behind the seats feeding
// through an OPEN / CLOSED shut-off valve, a two-speed electric pump and the engine-driven pump; the 14 V bus.
// Plain data.
//
// Figures from the type's engineering data sheet (aircraft-data/da20.md in the design work folder; "s.N" is its
// section N). Where the sheet has nothing (induction areas, friction, thermal masses, the blade's planform and
// section) the numbers are those of the Cessna 172S's IO-360 (physics/propulsion/c172Powerplant.ts), scaled by
// the air flow (displacement x rpm) where the size matters, and say so.

import { DEG, HP } from '../../core/math';
import { C172_BLADE_SECTION, C172_ENGINE, C172_PROPELLER } from '../../physics/propulsion/c172Powerplant';
import { AVGAS_100LL, type BladeSectionDef, type EngineDef, type PowerplantDef, type PropellerDef } from '../../physics/propulsion/defs';
import { DA20_GEOMETRY, da20DatumX, da20FrlZ } from './geometry';

const INCH = 0.0254;
/** kg/s per US gal/h of 100LL. */
const GPH = (3.785411784e-3 * AVGAS_100LL.density) / 3600;
const PROP = DA20_GEOMETRY.propellers[0];
/** Rated air flow of the IO-240 at 2800 rpm over the IO-360's at 2700 (displacement x rpm). */
const FLOW = (3.93 * 2800) / (5.9 * 2700);

/**
 * Continental IO-240-B (AFM 2.4.1, TCM; s.4): 3.93 L, 8.5 : 1, 125 hp at 2800 rpm for take-off and continuous
 * operation, continuous-flow injection, two magnetos. The idle bypass is solved for the minimum ground idle of
 * AFM 2.4.2 (at least 975 rpm; warm-up 1000-1200), the full-rich mixture from the take-off fuel flow.
 */
export const DA20_ENGINE: EngineDef = {
  ...C172_ENGINE,
  name: 'Continental IO-240-B',
  ratedPower: 125 * HP,
  ratedRpm: 2800,
  // The idle bypass is solved for this speed; on the ground, warm, with the alternator's load and the propeller in
  // still air, the engine then idles at about 1010 rpm (AFM 2.4.2: at least 975).
  idleRpm: 1020,
  displacement: 3.93e-3,
  compressionRatio: 8.5,
  induction: {
    ...C172_ENGINE.induction,
    // Throttle body, filter and inlet box, and the exhaust: the IO-360's scaled by the rated air flow.
    throttleBoreArea: Math.PI * 0.0318 * 0.0318 * FLOW,
    idleArea: undefined,
    inletArea: 1.55e-3 * FLOW,
    exhaustCoeff: 1.8e5 / (FLOW * FLOW),
    // ALTERNATE AIR (AFM 7.9.2; s.4): a second, unfiltered inlet inside the lower cowl, for a blocked filter. It
    // takes warm cowl air without the chin inlet's ram (ESTIMATE: 15 K, 3 % of the pressure at the rated flow).
    alternateAir: { heatRise: 15, pressureLoss: 0.03 },
  },
  // Full rich at take-off power: 10 US gal/h (s.4 estimates 40-44 L/h, 11 gal/h, from TCM's maximum 0.56 lb/hp/h).
  // Set on the AFM's full-rich cruise flows (table 3: 8.7 gal/h at 83 % at 2000 ft, 8.6 at 79 % at 4000 ft, full rich
  // above 75 %), which 11 gal/h overstated by 14 %; it gives 8.5 gal/h at 83 % at 2000 ft.
  metering: { kind: 'continuousInjection', takeoffFuelFlow: 10.0 * GPH, leanestFraction: 0.35 },
  // The IO-360's heat paths with the smaller engine's thermal masses (head and oil capacities about 2/3). The
  // Continental's oil pressure is green from 30 to 60 psi (AFM 2.4.1): its relief valve holds about 55 psi hot.
  thermal: { ...C172_ENGINE.thermal, headCapacity: 27e3, headConductance: 160, oilCapacity: 30e3, oilCoolerConductance: 95, oilReliefPsi: 55, warm: { ...C172_ENGINE.thermal.warm, oilPressure: 50 } },
  compressionLossTorque: 20,
  breakawayTorque: 40,
  // Crankshaft, rods and ring gear of the 3.9 L engine; with the wooden propeller's 0.45 the assembly is 0.78 kg m^2.
  rotatingInertia: 0.33,
  airStartRpm: 2300,
  groundStartRpm: 1000,
  // 12 V starter (AFM 4.4.3): about 35 N m at 200 A, cranking near 200 rpm.
  starter: { k: 0.0009, r: 0.03 },
};

/**
 * The blade section: the 172's Clark-Y-like section (c172Powerplant.ts), CALIBRATED on what the type's propeller
 * must give with its 62.8 in face pitch: about 2150-2200 static rpm (AFM 4.4.7: at least 2000; owners 2100-2200,
 * s.5), about 2300 rpm in the full-throttle climb at 75 KIAS (s.5), and the cruise table's power coefficient at 2800
 * rpm (AFM table 3: 83 % at 129 KTAS at 2000 ft, C_P 0.040 at J 0.81; s.5, s.8). With the 172's section the
 * propeller absorbed 0.057 there: 2800 rpm came only at 145 KTAS.
 *  - alpha0 -1.5 deg to the flat face: a wooden blade's face is not the flat lower face of a Clark Y, and its
 *    aerodynamic pitch is close to the geometric one; C_P falls to zero near J 1.0 (the 172's blade: 1.13).
 *  - the maximum lift of a thick wooden section, 1.4 falling 1.0 per unit Mach above 0.3, and drag rising eight
 *    times as fast with lift away from the bucket (0.085): the thick, broad blade deeply stalled on the ground has
 *    a static figure of merit near 0.5, not the forged blade's 0.75. Set on the charted take-off roll (AFM fig 5.4:
 *    390 m) against the climb (AFM fig 5.5): with 1.6 and 0.04 the static thrust was 2430 N, about 5.5 lbf per
 *    horsepower, and the roll 313 m (request D-M-D2-01); more drag takes it from the climb as well, 10 ft/min for
 *    every 10 m of roll, and moves Vy beyond 82 KIAS.
 *  - the negative lift limit of the less cambered section, -1.0 (as the C152's): the AFM's best glide is
 *    "propeller windmilling" (AFM 3.3.2); it windmills at about 950 rpm there.
 */
const DA20_BLADE_SECTION: BladeSectionDef = { ...C172_BLADE_SECTION, alpha0: -1.5 * DEG, clMaxLowSpeed: 1.4, clMaxMachLoss: 1.0, clMin: -1.0, dragDueToLift: 0.085 };

/**
 * Sensenich W69EK7-63 (AFM 2.4.3, TCDS; s.5): laminated wood, 69.0 in, two blades, 62.8 in pitch at 0.75 R (21.1
 * degrees). Wooden blades are broader and thicker than forged aluminium ones of the same diameter: the 172's
 * planform with 20 % more chord (with the section above it sets the static rpm, about 2150) and the thickness of a wood blade
 * (about 12 % at 0.75 R). Propeller and spinner 5.7 kg (AFM 6.5).
 */
export const DA20_PROPELLER: PropellerDef = {
  ...C172_PROPELLER,
  name: 'Sensenich W69EK7-63',
  diameter: PROP.diameter,
  blades: PROP.blades,
  hubRadius: 0.13,
  chordOverR: C172_PROPELLER.chordOverR.map((c) => 1.2 * c),
  thickness: [0.26, 0.2, 0.15, 0.12, 0.09],
  twist: { kind: 'helix', pitch: 62.8 * INCH },
  section: DA20_BLADE_SECTION,
  inertia: 0.45,
  pitchControl: { kind: 'fixed' },
};

export const DA20_POWERPLANT: PowerplantDef = {
  engines: [{ engine: DA20_ENGINE, propeller: DA20_PROPELLER, hub: PROP.hub, rotation: PROP.rotation }],
  fuel: {
    // One tank in the fuselage behind the seats, under the baggage floor (AFM 7.10; s.6): 91 L usable of 93, arm
    // 0.824 m aft of RD, its centroid about 0.25 m below FRL (ESTIMATE). No wing tanks.
    tanks: [{ id: 'main', side: 'centre', capacity: 0.091 * AVGAS_100LL.density, position: { x: da20DatumX(0.824), y: 0, z: da20FrlZ(-0.25) } }],
    feeds: [
      {
        // The shut-off valve OPEN / CLOSED (s.9): 'on' (and 'both', the generic default the definition replaces).
        positions: { on: [0], both: [0] },
        // The tank sits below the engine: no head.
        gravityHeadPsi: 0,
        feedCapacity: 0.05,
        lineCapacity: 0.15,
        lineUnusable: 0.015,
        // Engine-driven pump; the electric pump's low speed (FUEL PUMP, s.9) works above 10 V. The gauge is green
        // between its red lines at 3.5 and 16.5 psi (AFM 2.5).
        enginePump: { psi: 12 },
        auxPump: { psi: 8, minVolts: 10 },
        delivery: { kind: 'injector', capacity: 0.03, openPsi: 1, fullPsi: 4 },
        film: { fraction: 0.3, time: 0.35 },
      },
    ],
  },
  electrical: {
    nominalVolts: 14,
    regulatorVolts: 14.2,
    // 12 V, about 20 Ah (Yuasa Y50-N18L-A, s.9).
    battery: { capacityAh: 20, ocvEmpty: 11.6, ocvSpan: 1.3, rDischarge: 0.012, rChargeBase: 0.04, rChargeFull: 0.75 },
    // 40 A engine-driven alternator ("generator") with an internal regulator (s.9).
    alternators: [{ engine: 0, maxAmps: 40, cutInRpm: 600, fullRpm: 1700, efficiency: 0.55 }],
    // Nominal load currents at 14 V, A: one NAV / COM, a GPS / COM and a transponder; LED position lights; the
    // strobes are on the wing tips and there is no beacon; landing and taxi lamps in the left wing.
    loads: {
      master: 3.0,
      avionics: 8.0,
      nav: 3.0,
      beacon: 0,
      strobe: 4.0,
      landing: 7.0,
      taxi: 7.0,
      panelFull: 2.0,
      pitotHeat: 10.0,
      fuelPump: 3.0,
    },
    // The voltmeter's yellow arc begins at 12.5 V (AFM 2.5); the bus-powered instruments die below 9 V.
    lowVoltsLamp: 12.5,
    overVolts: 16,
    busDeadVolts: 9,
  },
};
