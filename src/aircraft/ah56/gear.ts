// Lockheed AH-56A Cheyenne: the wheel gear and ground contact (GearConfig). Owner: AG (stage 2). Plan revision 2, sect. 7.2.
//
// Retractable tail-wheel gear (P ASTA-72 App B para 2, para 93): the mains retract into the sponsons, the full-swivelling,
// lockable tail wheel (5.00x4 at 100 psi, P) into the lower end of the ventral fin. The tail wheel sits in the "nose" slot
// of the three-wheel LandingGear (aft of the CG: the loads, the castering and the lock work the same; its crash wording
// is "Tail"). Main axles FS 268, track 62 in, tail wheel FS 640 (dimensions.ts, 3V/D). Toe brakes on the mains and a
// parking brake (P: "reverse prop and main-gear brakes"; the AMCS ship's parking brake). Gear limit 130 KCAS (P).
//
// Design point: the test loading, 18,300 lb at FS 298 (P): the tail wheel carries 8 % (6.6 kN), each main 37.4 kN. The
// springs below compress the mains 0.025 m of oleo and 0.019 m of tyre and the tail wheel 0.09 m and 0.017 m; the
// extended contacts are the rest contacts (geometry.gear, at the ground line WL 18) plus those deflections, so the
// aircraft rests level at the design loading (wheelRestingPose). Every spring, damper and tyre number is an ESTIMATE
// sized for the P touchdown sink limit (9.5 ft/s at 18,300 lb) with margin. The main oleos are stiff (a short gas column):
// with the CG about 77 in above the ground over a 62 in track, softer struts let the tail rotor's side force lean the
// aircraft several degrees on the ground (the gravity overturning term W h is about 160 kN m/rad against the struts'
// 2 k (track/2)^2).
import { DEG, G0, LB, type Vec3 } from '../../core/math';
import type { GearConfig, RetractConfig, StructuralPoint, WheelConfig } from '../../physics/gear/gearConfig';
import { OleoPneumaticSpring, SeriesSpring, type StrutSpring, type TyreSpring } from '../../physics/gear/springs';
import type { SteeringParams, TyreParams } from '../../physics/gear/tyre';
import * as D from './dimensions';
import { AH56_MASS_LB } from './facts';

const { x, y, z } = D;

/** Static wheel loads at the design point, N (D). */
const W = AH56_MASS_LB.test * LB * G0;
const TAIL_LOAD = W * D.MAIN_GEAR.x / (D.MAIN_GEAR.x - D.TAIL_WHEEL.x);
const MAIN_LOAD = (W - TAIL_LOAD) / 2;

// Gas column 0.16 m (was 0.22): 37 % stiffer in roll at the static load, so the running ground lean at centred pedals
// (the tail rotor's 3.6 kN at flat pitch) is 1.9 deg instead of 3.0, with the worst-case 9.5 ft/s drop (collective full
// down) peaking at 93 kN on one main against the 140 kN limit then (79 kN before; the limit is 180 kN since tune round 3, below). ESTIMATE (ah56Ground.test.ts G13).
const MAIN_STRUT: StrutSpring = new OleoPneumaticSpring(30e3, 0.16, 1.3, 0.20);
const MAIN_TYRE_SPRING: TyreSpring = { stiffness: 2.0e6, hardening: 0.09 };
const TAIL_STRUT: StrutSpring = new OleoPneumaticSpring(3e3, 0.2, 1.3, 0.15);
const TAIL_TYRE_SPRING: TyreSpring = { stiffness: 4.0e5, hardening: 0.05 };

/** Total vertical deflection (strut + tyre) at a load, m. */
const sag = (strut: StrutSpring, tyre: TyreSpring, load: number): number => new SeriesSpring(strut, tyre).deflectionAt(load);
/** The rest contacts (geometry.gear): the ground line at the design loading. */
export const AH56_REST_CONTACTS = {
  tail: { x: D.TAIL_WHEEL.x, y: 0, z: D.GROUND_Z },
  left: { x: D.MAIN_GEAR.x, y: -D.MAIN_GEAR_HALF_TRACK, z: D.GROUND_Z },
  right: { x: D.MAIN_GEAR.x, y: D.MAIN_GEAR_HALF_TRACK, z: D.GROUND_Z },
} as const;
const extended = (p: Vec3, s: number): Vec3 => ({ x: p.x, y: p.y, z: p.z + s });
const MAIN_SAG = sag(MAIN_STRUT, MAIN_TYRE_SPRING, MAIN_LOAD);
const TAIL_SAG = sag(TAIL_STRUT, TAIL_TYRE_SPRING, TAIL_LOAD);

/** Tyres: the other types' brush-model coefficients (NASA TR R-64 class). */
const tyre = (radius: number, inertia: number): TyreParams => ({
  radius, inertia, slipStiffness: 15, corneringStiffness: 8, relaxationLong: 0.3, relaxationLat: 0.5, lowSpeedDamping: 1.5,
});

/** Full-swivelling tail wheel (P) with the lock pin (P: the lock lever; locked for take-off and landing, unlocked for turns,
 *  ASTA-72 para 79). Trail, swivel drag and friction ESTIMATE; centring cam on extension. */
const TAIL_STEERING: SteeringParams = {
  maxCommand: 0, casterLimit: 175 * DEG, trail: 0.09, linkStiffness: 0, breakoutTorque: 0, bungeeStiffness: 0,
  damper: 80, centeringTime: 0.3, mode: 'castering', friction: 20, lock: { engageAngle: 2 * DEG },
};

/** Oleo damping: a valve-limited linear term and a metering orifice, firmer on rebound. */
function oleoDamping(linear: number, compression: number, rebound: number): WheelConfig['damping'] {
  const knee = 0.6;
  return (strutRate, totalRate) => linear * knee * Math.tanh(totalRate / knee) + (strutRate > 0 ? compression : rebound) * strutRate * Math.abs(strutRate);
}

/**
 * Hydraulic retraction (P: mains into the sponsons, tail wheel into the fin; hydraulic systems 1, 1A, 2): about 6 s either
 * way (ESTIMATE; plan G13 asks 3-8 s), the selector on the 28 V bus, a squat switch, up-locks, free fall in 10 s
 * (ESTIMATE). The horn: the lever UP on the ground only (no gear-warning rule published for the Cheyenne).
 */
export const AH56_RETRACT: RetractConfig = {
  extendTime: 6, retractTime: 6, legDelay: [0, 0.3, 0.3], minBusVolts: 18, squatInhibit: true, upLocks: true,
  emergency: { freeFallTime: 10 }, warning: { leverUpOnGround: true },
};

function main(name: 'left' | 'right'): WheelConfig {
  const side = name === 'left' ? -1 : 1;
  return {
    name,
    position: extended(name === 'left' ? AH56_REST_CONTACTS.left : AH56_REST_CONTACTS.right, MAIN_SAG),
    axis: { x: 0, y: 0, z: -1 },
    strut: MAIN_STRUT, tyreSpring: MAIN_TYRE_SPRING,
    damping: oleoDamping(30e3, 6e3, 60e3),
    tyre: tyre(D.MAIN_TYRE_RADIUS, 2.5),
    steering: null,
    brake: name,
    // About 0.26 g at full pedal at the test weight with the rotor unloaded: from 60 KCAS in about 190 m (G13 asks
    // <= 300 m), below the 0.39 g at which the aircraft would tip onto its nose about the mains (0.76 m ahead of the CG,
    // the CG 1.96 m up). ESTIMATE.
    maxBrakeTorque: 3000,
    // The leg's collapse load (the model's limitLoad is where it breaks, so the ULTIMATE). Tune round 3 (KNOWN_ISSUES T11, D from
    // P with FAR 27): the P 9.5 ft/s touchdown sink limit, flown with this strut at the hover collective (W/tune2/ah56 out/d3_gear.log),
    // gives 103 kN on a main in a level landing; FAR 27.483 puts the level-landing load on ONE wheel for the one-wheel condition, and
    // the ultimate is 1.5 x the limit: 155 kN. This aircraft hovers 4.7 deg left wing low (P APE-I para 96), so a vertical landing
    // from the hover IS a one-wheel touchdown: 173 kN at 9.5 ft/s. 180 kN covers both (was 140 kN, about 3.5 g on the static share,
    // which collapsed the left main from about 375 fpm in the hover attitude); the one-wheel touchdown at the 1.2 x reserve-energy
    // sink (11.4 ft/s, FAR 27.725) still collapses it (279 kN). ESTIMATE.
    limitLoad: 180e3,
    // Stowed in the sponson, forward and up (3V: the leg swings forward).
    stowed: { x: x(250), y: side * D.MAIN_GEAR_HALF_TRACK, z: z(58) },
  };
}

/** Airframe points that must not touch the ground (the rotors are RotorClearance's, wheels.ts; the pusher disc below). */
const HALF_SPAN = D.WING.tipBl;
const STRUCTURE: readonly StructuralPoint[] = [
  // The belly turret (XM52, FS 190, the lowest point of the airframe: 21 in above the ground, P ASTA-72 para 91) and the
  // sponsons with the mains stowed: a gear-up landing slides on them.
  { position: { x: D.BELLY_TURRET.x, y: 0, z: D.GROUND_Z - D.BELLY_TURRET.clearanceM }, message: 'Belly turret struck the ground',
    tolerance: 0.5, part: 'belly turret', belly: true },
  { position: { x: x(250), y: -D.MAIN_GEAR_HALF_TRACK, z: z(52) }, message: 'Left sponson struck the ground', tolerance: 0.5,
    part: 'left sponson', belly: true },
  { position: { x: x(250), y: D.MAIN_GEAR_HALF_TRACK, z: z(52) }, message: 'Right sponson struck the ground', tolerance: 0.5,
    part: 'right sponson', belly: true },
  // The chin turret under the nose (3V: about WL 50 at FS 60).
  { position: { x: x(60), y: 0, z: z(50) }, message: 'Nose turret struck the ground', tolerance: 0 },
  // The ventral fin's tip (P: WL 37.6), with the tail wheel retracted into it: a tail-down arrival.
  { position: { x: x(632), y: 0, z: D.VENTRAL_FIN.tipZ }, message: 'Ventral fin struck the ground', tolerance: 1.0, part: 'ventral fin', belly: true },
  // Roll-over points: the wing tips (P tip BL 160.2; 5 deg dihedral from about WL 60 at the root, 3V) and the stabiliser
  // tips (span 3.30 m at the tail cone, P).
  { position: { x: D.WING.quarterMacX, y: -y(HALF_SPAN), z: z(60 + HALF_SPAN * Math.tan(5 * DEG)) }, message: 'Left wingtip struck the ground', tolerance: 0 },
  { position: { x: D.WING.quarterMacX, y: y(HALF_SPAN), z: z(60 + HALF_SPAN * Math.tan(5 * DEG)) }, message: 'Right wingtip struck the ground', tolerance: 0 },
  { position: { x: D.HORIZONTAL_STABILIZER.quarterMacX, y: -D.HORIZONTAL_STABILIZER.span / 2, z: D.TAIL_HUB.z },
    message: 'Left horizontal stabilizer struck the ground', tolerance: 0 },
  { position: { x: D.HORIZONTAL_STABILIZER.quarterMacX, y: D.HORIZONTAL_STABILIZER.span / 2, z: D.TAIL_HUB.z },
    message: 'Right horizontal stabilizer struck the ground', tolerance: 0 },
  // Upper points for a nose-over or roll-over: the canopy top over the rear seat and the engine fairing behind the mast.
  { position: { x: x(170), y: 0, z: z(150) }, message: 'Aircraft rolled over', tolerance: 0 },
  { position: { x: x(330), y: 0, z: z(150) }, message: 'Aircraft rolled over', tolerance: 0 },
];

/** The AH-56A's gear (AircraftDefinition.gear). */
export function ah56Gear(): GearConfig {
  return {
    wheels: [
      {
        name: 'nose',
        label: 'Tail',
        position: extended(AH56_REST_CONTACTS.tail, TAIL_SAG),
        axis: { x: 0, y: 0, z: -1 },
        strut: TAIL_STRUT, tyreSpring: TAIL_TYRE_SPRING,
        damping: oleoDamping(6e3, 1.5e3, 12e3),
        tyre: tyre(D.TAIL_TYRE_RADIUS, 0.15),
        steering: TAIL_STEERING,
        brake: null, maxBrakeTorque: 0,
        limitLoad: 45e3,
        // Stowed in the lower end of the ventral fin (P), swung aft and up (3V).
        stowed: { x: x(650), y: 0, z: z(46) },
      },
      main('left'),
      main('right'),
    ],
    structure: STRUCTURE,
    // The pusher (P: 10 ft, hub FS 675.7, WL 114.5): its lowest tip is about 3 ft above the ground (D).
    propellers: [{ hub: D.PUSHER_HUB, radius: D.PUSHER_RADIUS, message: 'Propeller strike', part: 'pusher propeller' }],
    // A helicopter's arrival energies: beyond 4 m/s of sink (the P 2.9 m/s touchdown limit with margin), 45 m/s (88 kt,
    // well above the 70 KCAS run-on limit, P), or 30 m/s on a path steeper than 15 deg: a terrain impact. ESTIMATE.
    impact: { sinkRate: 4, speed: 45, steepSpeed: 30, steepPath: 15 * DEG },
    retract: AH56_RETRACT,
  };
}
