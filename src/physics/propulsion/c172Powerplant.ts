// The powerplant of the Cessna 172S as data: one Lycoming IO-360-L2A (180 hp at 2700 rpm, fuel injected,
// naturally aspirated, direct drive) driving a McCauley 1A170E/JHA7660 (76 in diameter, 60 in geometric pitch,
// two blades), two gravity-feed wing tanks behind a LEFT / RIGHT / BOTH / OFF selector, and the 28 V bus.
//
// The numbers of the type are written HERE and nowhere else. The propulsion classes take a definition and
// default to this one; the constants their modules export (ROTOR_INERTIA, PROP_RADIUS, TANK_CAPACITY, ...) are
// read from it. A pure module: it imports core/ and the definition types only, never a propulsion class.
//
// Three of them need a word:
//  - cowlFlapClosedFactor 1: no cowl flaps;
//  - gravityHeadPsi 0: no head of fuel is added to the pressure at the servo. The high wing shows as the
//    unrestricted gravity feed that refills the lines (feedCapacity); the pressure is the pumps' alone;
//  - airStartRpm and groundStartRpm, the crank speeds a start is primed with, are the flight model's
//    AIR_START_RPM and GROUND_START_RPM (physics/c172FlightModel.ts, which this module must not import).

import { C172 } from '../../core/c172';
import { DEG } from '../../core/math';
import { AVGAS_100LL, type BladeSectionDef, type EngineDef, type PowerplantDef, type PropellerDef } from './defs';

const INCH = 0.0254;
/** Intake-air heating by the engine compartment, K. */
const INDUCTION_HEATING = 8;
const TANK = C172.mass.tank;

/**
 * The blade section of the McCauley 1A170E: a Clark-Y-like cambered section with a flat lower face, the face
 * the blade angle is measured on. Also the section of a propeller definition that names none.
 */
export const C172_BLADE_SECTION: BladeSectionDef = {
  /**
   * Zero-lift angle of the blade section relative to its flat lower face, the face the blade angle (and so the
   * 60 in pitch) is measured on.
   *
   * The blade is of the Clark Y propeller family, whose thinner members are the 11.7 % Clark Y with every ordinate
   * above the flat face scaled by the thickness ratio (Weick, "Aircraft Propeller Design", 1930; the Clark Y blades
   * of NACA TR 640), so camber and zero-lift angle scale with t/c. For the 11.7 % parent the zero-lift angle is
   * -3.5 to -3.9 deg to its chord line (wind-tunnel values at Re 1-2e5, growing in magnitude with Reynolds number;
   * thin-aerofoil theory on the published ordinates gives -3.5), and that chord line, from the leading edge 3.5 %
   * above the face to the trailing edge on it, is inclined 1.97 deg to the face: -5.9 deg to the face for the
   * parent. One section stands for the whole blade, so it is the family member at the blade's load-weighted
   * thickness ratio, 0.09 (thrust- and torque-weighted t/c from this BEMT: 0.088-0.091 in the climb and cruise):
   * -5.9 * 0.09 / 0.117 = -4.5 deg.
   *
   * It was -3.8 deg, the parent's chord-line figure read as if it were measured to the face. That left the blade
   * aerodynamically 0.7 deg flat: the propeller absorbed too little power at cruise advance ratios (CP ~6-8 % low at
   * J 0.72-0.75), so the engine reached 2,780 rpm in full-throttle level flight at sea level, 80 rpm past the red line.
   */
  alpha0: -4.5 * DEG,
  /** Incompressible lift-curve slope, 1/rad (0.9 of the thin-airfoil 2*pi, typical at Re 1-2 million). */
  liftSlope: 2 * Math.PI * 0.9,
  /** Maximum lift coefficient at low Mach number, and its loss per unit Mach above M 0.3. */
  clMaxLowSpeed: 1.45,
  clMaxMachLoss: 1.6,
  clMin: -0.75,
  /** Drag coefficient of the section broadside to the flow; flat plate normal-force data, finite blade. */
  cdMax: 1.6,
  /** Lift coefficient of minimum drag for a cambered section. */
  clMinDrag: 0.3,
  /** Growth of drag with lift away from the drag bucket. */
  dragDueToLift: 0.01,
  /**
   * Ideal (design) lift coefficient of the cambered section: the lift at which the stagnation point sits on the
   * leading edge and the camber carries the load with no leading-edge suction peak. For a circular-arc mean line of
   * camber m, alpha0 = -2m and cl_i = 4 pi m (thin-aerofoil theory), so cl_i = 2 pi |alpha0| with alpha0 measured to
   * the chord line, not the face: 0.42 for a Clark Y's -3.8 deg (Abbott & von Doenhoff give 0.4-0.5 for sections of
   * this camber). It is the value the tip sections' critical Mach number is calibrated with (blade-tip
   * compressibility tests), so it is not tied to alpha0, which is measured to the face.
   */
  clIdeal: 2 * Math.PI * 3.8 * DEG,
};

/**
 * McCauley 1A170E/JHA7660. Chord and thickness follow the planform of McCauley's fixed-pitch GA blades (widest
 * at about 55 % radius, rounded tip, activity factor about 90 per blade). The blade angle follows a
 * constant-pitch helix, theta(r) = atan(P / (2 pi r)), measured to the flat lower face as McCauley specifies
 * pitch.
 */
export const C172_PROPELLER: PropellerDef = {
  name: 'McCauley 1A170E/JHA7660',
  diameter: C172.prop.diameter,
  blades: C172.prop.blades,
  /** Blade root (the airfoil starts outboard of the spinner), m. */
  hubRadius: 0.14,
  // Chord / R and thickness / chord versus r / R.
  stationX: [0.14, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.92, 0.97, 1.0],
  chordOverR: [0.094, 0.115, 0.132, 0.142, 0.146, 0.144, 0.135, 0.122, 0.106, 0.083, 0.050],
  thicknessX: [0.14, 0.3, 0.5, 0.75, 1.0],
  thickness: [0.22, 0.16, 0.11, 0.08, 0.06],
  twist: { kind: 'helix', pitch: C172.prop.pitchIn * INCH },
  section: C172_BLADE_SECTION,
  // Propeller and spinner: with the engine's 0.5 this is the 1.7 kg m^2 of the whole rotating assembly (the sum
  // is exactly 1.7 in doubles; 0.9 + 0.8 or 1.1 + 0.6 would not be).
  inertia: 1.2,
  pitchControl: { kind: 'fixed' },
};

/** Lycoming IO-360-L2A. */
export const C172_ENGINE: EngineDef = {
  name: 'Lycoming IO-360-L2A',
  kind: 'sparkPiston',
  cylinders: 4,
  ratedPower: C172.engine.ratedPower,
  ratedRpm: C172.engine.ratedRpm,
  idleRpm: C172.engine.idleRpm,
  displacement: C172.engine.displacementM3,
  /** Lycoming type certificate data sheet E-286. */
  compressionRatio: 8.5,
  fuel: AVGAS_100LL,
  induction: {
    /** Throttle bore of the RSA-5 servo (about 2.5 in) and its discharge coefficient. */
    throttleBoreArea: Math.PI * 0.0318 * 0.0318,
    throttleCd: 0.8,
    /** Butterfly angle from the bore normal at the idle stop. */
    closedAngle: 7 * DEG,
    /** Effective leak area past the closed butterfly at the idle-speed stop, m^2 (sets the ~680 rpm static idle). */
    idleArea: 4.0e-5,
    /** Effective area of the filter, inlet box and bends in series with the throttle (sets ~1 inHg loss at 2700 rpm). */
    inletArea: 1.55e-3,
    /** Exhaust back-pressure coefficient, Pa / (kg/s)^2 (about 3 kPa at rated airflow). */
    exhaustCoeff: 1.8e5,
    inductionHeating: INDUCTION_HEATING,
    /** Fraction of dynamic pressure recovered by the ram-air inlet. */
    ramRecovery: 0.6,
    /**
     * Charge temperature at which the volumetric-efficiency table applies (sea-level ISA plus the induction heating), K.
     * The cylinder walls and the hot intake ports heat a cold charge more than a warm one during induction, so the
     * delivered air mass does not rise as 1/T when the air gets colder: volumetric efficiency grows as T^(1/2)
     * (Heywood, "Internal Combustion Engine Fundamentals", sec. 6.2.1), and the trapped mass goes as p / sqrt(T),
     * which is the standard altitude-temperature power correction (power ~ MAP rpm / sqrt(T); Lycoming's operator
     * charts: about 1 % per 6 C off standard). With 1/T the model gave 2.8 % too much power at 8000 ft ISA and 4.4 % at
     * 12000 ft (and too much on cold days at any altitude).
     */
    veReferenceT: 288.15 + INDUCTION_HEATING,
    // Volumetric efficiency at wide-open throttle versus rpm (tuned intake runners peak mid-range).
    veRpm: [0, 1000, 2000, 2500, 2800, 3300],
    ve: [0.8, 0.84, 0.875, 0.88, 0.87, 0.83],
  },
  metering: {
    kind: 'rsaInjection',
    /**
     * Equivalence ratio delivered at full-rich mixture at sea-level density (rich of best power, for cooling). The
     * take-off fuel flow of a normally aspirated 100-octane engine is about 9 % of its rated horsepower in gph
     * (Busch, "What's your fuel flow at take-off?", AVweb Savvy Aviator #65, after Continental SID97-3): 16.2 gph for
     * 180 hp, which the rated air flow of this engine meets at phi 1.37 (BSFC ~0.54 lb/hp/h). Full rich then gives
     * ~3 % less power than best power, as the C172S POH climb chart shows: flown full rich below 3,000 ft and leaned
     * above, its climb rate falls only 133 fpm from sea level to 4,000 ft but 189 fpm from 4,000 to 8,000 ft.
     * The rating (180 hp at 2,700 rpm) is at full rich, so leaning at altitude now recovers that ~3 %; at phi 1.28
     * (15.1 gph, 1.2 % below best power) the leaned climbs at altitude came out ~5 % low against the POH once the
     * propeller absorbed the right power at cruise.
     */
    fullRichPhi: 1.37,
    /** Metered fuel just above cut-off, as a fraction of full rich (the leanest the lever can set). */
    leanestFraction: 0.35,
  },
  ignition: {
    kind: 'magnetos',
    /** The impulse couplings give a usable spark from this crank speed upward (starter cranking is 150-300 rpm). */
    minFiringRpm: 80,
    /** A single magneto fires one plug per cylinder. The slower burn costs a few percent of indicated work at full
     *  throttle and much more in the residual-diluted part-throttle charge, which gives the POH run-up drop of
     *  roughly 75-150 rpm at 1800 rpm. Loss = base + sensitivity * (excess residual fraction). */
    singleLoss: 0.04,
    singleDilutionLoss: 1.7,
    /** Relative loss of indicated efficiency per unit residual-gas fraction above the wide-open-throttle value. */
    dilutionSensitivity: 1.2,
  },
  // Chosen so that a warm C172S shows about 350 F CHT and 180 F oil in 75 % cruise leaned to best power, about
  // 420 F CHT and 200 F oil in a full-power Vy climb, about 220 F CHT at ground idle, and CHT time constants of a
  // few minutes as seen on engine monitors.
  thermal: {
    cooling: 'air',
    /** Cylinder-head heat capacity, J/K, and cooling conductance at a reference mass flux, W/K. */
    headCapacity: 40e3,
    headConductance: 240,
    /** Fraction of indicated power that flows into the cylinder heads. */
    headHeatFraction: 0.4,
    /** Reference cooling mass flux rho * V, kg/(m^2 s) (about 110 KTAS at 8000 ft). */
    referenceMassFlux: 60,
    oilCapacity: 45e3,
    oilCoolerConductance: 140,
    crankcaseConductance: 15,
    /** Oil pump: pressure rises with rpm and viscosity until the relief valve (about 80 psi hot) opens. */
    oilPsiPerRpm: 0.0385,
    oilReliefPsi: 80,
    cowlFlapClosedFactor: 1,
    /** Temperatures (degrees C) and oil pressure (psi) a reset with the engine running starts from. */
    warm: { egt: 650, cht: 170, oilTemp: 80, oilPressure: 65 },
  },
  /** Friction mean effective pressure with hot oil, Pa, as a0 + a1 N + a2 N^2 with N in thousands of rpm
   *  (the Sandoval-Heywood form), scaled to about 18 hp of rubbing and accessory-drive friction at 2700 rpm: a
   *  mechanical efficiency of ~89 % at the rating, typical of a large-bore air-cooled aircraft engine with its
   *  loose running clearances, oil pump, magnetos and vacuum-pump drive; the speed-dependent (hydrodynamic and
   *  accessory) part dominates at high rpm. It sets how hard a windmilling
   *  propeller has to work to turn the dead engine over (the drag of the engine-out glide). */
  fmep: [0.45e5, 0.09e5, 0.045e5],
  /** Cold oil raises friction; the factor reaches this value at 0 C and fades out by the hot reference temperature. */
  coldFrictionFactor: 1.8,
  /** At cranking and slow windmilling speeds blow-by and heat loss during the slow compression stroke mean the
   *  expansion returns less work than compression absorbed: a mean resisting torque that fades out by 400 rpm.
   *  It is what stops a windmilling propeller when a dead-engine glide is slowed toward the stall. */
  compressionLossTorque: 30,
  /** Torque needed to turn a stopped engine over its compression, N*m. */
  breakawayTorque: 60,
  // Crankshaft, rods and flywheel ring gear: with the propeller's 1.2 this is the 1.7 of the rotating assembly.
  rotatingInertia: 0.5,
  gearRatio: 1,
  /** Engine is considered running when firing above this speed. */
  runningRpm: 350,
  airStartRpm: 2300,
  groundStartRpm: 800,
  /**
   * Starter: a series-wound DC motor (field in series with the armature, so torque = k I^2 and back-EMF = k I omega,
   * which gives the high stall torque that breaks a cold engine away and spins it up quickly), referred to the
   * crankshaft through its reduction gear: k in N*m/A^2 (= V*s/(rad*A)) and armature + field + cable resistance,
   * ohm. Balanced against the cold engine's cranking torque (~55-60 N m at 200 rpm: cold-oil friction ~36,
   * compression losses ~15, pumping and the propeller the rest) so it cranks at ~200 rpm drawing ~200 A from a
   * ~20.5 V bus, with ~100 N m at stall.
   */
  starter: { k: 0.00145, r: 0.072 },
};

export const C172_POWERPLANT: PowerplantDef = {
  engines: [{ engine: C172_ENGINE, propeller: C172_PROPELLER, hub: C172.prop.hub, rotation: 1 }],
  fuel: {
    // Usable fuel per tank, kg (26.5 US gal).
    tanks: [
      { id: 'left', side: 'left', capacity: C172.mass.usableFuel / 2, position: { x: TANK.x, y: -TANK.y, z: TANK.z } },
      { id: 'right', side: 'right', capacity: C172.mass.usableFuel / 2, position: { x: TANK.x, y: TANK.y, z: TANK.z } },
    ],
    feeds: [
      {
        positions: { left: [0], right: [1], both: [0, 1] },
        gravityHeadPsi: 0,
        /** Gravity feed capacity through the selector, kg/s (far above the 0.011 kg/s full-power flow). */
        feedCapacity: 0.05,
        /** Fuel held between the selector and the injectors, kg (about 0.2 L). */
        lineCapacity: 0.15,
        /** Fuel left in the lines when the pumps lose prime, kg. */
        lineUnusable: 0.015,
        /** Engine-driven vane pump: pressure approaches its regulated value with rpm. */
        enginePump: { psi: 30 },
        /** Auxiliary (boost) pump output and the bus voltage it needs. */
        auxPump: { psi: 22, minVolts: 18 },
        // Fuel volume of the flow divider and the four injector lines, kg (about 50 mL); injector flow is throttled
        // below the flow divider's opening pressure (about 3 psi).
        delivery: { kind: 'injector', capacity: 0.036, openPsi: 1, fullPsi: 4 },
        /** Fraction of the sprayed fuel that is deposited on the port walls, and the film's evaporation time, s. */
        film: { fraction: 0.3, time: 0.35 },
      },
    ],
  },
  electrical: {
    nominalVolts: 28,
    /** Alternator: regulated set point, 60 A rating, output available from ~400 rpm and full from 1400 rpm. */
    regulatorVolts: 28.5,
    /** Battery: 12 cells, 13.6 Ah (Concorde RG-24-15). Open-circuit volts run 23.2 (flat) to 25.8 (full). */
    battery: {
      capacityAh: 13.6,
      ocvEmpty: 23.2,
      ocvSpan: 2.6,
      rDischarge: 0.025,
      /** Charge acceptance falls steeply as the battery fills (gassing), modelled as a rising charge resistance. */
      rChargeBase: 0.08,
      rChargeFull: 1.5,
    },
    alternators: [{ engine: 0, maxAmps: 60, cutInRpm: 400, fullRpm: 1400, efficiency: 0.55 }],
    /** Nominal load currents at 28 V, A. */
    loads: {
      master: 2.0, // relays, engine instruments, annunciators
      avionics: 9.0, // G1000 displays, radios, autopilot
      nav: 2.8,
      beacon: 2.1,
      strobe: 3.5,
      landing: 3.6,
      taxi: 3.6,
      panelFull: 2.0,
      pitotHeat: 9.0,
      fuelPump: 3.0,
    },
    // LOW VOLTS annunciator, the top of the bus voltage range, and the voltage below which the bus-powered
    // instruments and lamps are dead.
    lowVoltsLamp: 24.5,
    overVolts: 32,
    busDeadVolts: 18,
  },
};
