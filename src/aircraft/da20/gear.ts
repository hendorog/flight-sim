// Diamond DA20-C1: the landing gear and ground contact. Fixed tricycle: flat aluminium leaf-spring main legs
// cantilevered from the fuselage under the wing, a tubular nose leg sprung by an elastomer pack on the engine
// mount, its fork on a free castering pivot (+/-60 degrees, not linked to the pedals); spats on all three wheels;
// hydraulic disc brakes on the mains, toe pedals (s.3 of the type's data sheet, aircraft-data/da20.md in the design
// work folder). A factory's value: the configuration holds spring objects and damping closures.
//
// Design point: 800 kg with the centre of gravity 0.288 m aft of RD (the maximum-weight loading of systems.ts),
// which puts 20 % of the weight on the nose wheel (s.3: 19 % at the training CG): about 1.55 kN on the nose and
// 3.15 kN on each main. The springs and tyres then compress about 0.07 m at the mains and 0.065 m at the nose
// (geometry.ts gives the fully extended points from that): the reference point 1.07 m above the ground.

import { DEG } from '../../core/math';
import type { GearConfig, StructuralPoint, WheelConfig } from '../../physics/gear/gearConfig';
import { LinearStrutSpring } from '../../physics/gear/springs';
import type { SteeringParams, TyreParams } from '../../physics/gear/tyre';
import { DA20_GEOMETRY, da20FrlZ, da20NoseX } from './geometry';

const G = DA20_GEOMETRY;
/** The leaf springs run out and down at about 40 degrees (s.12): their wheels move up and slightly outboard. */
const MAIN_TILT = 10 * DEG;

/** 5.00-5, 6-ply, at 2.3 bar (AFM 1.5.4; s.3). Cornering and slip as the 172's tyres (NASA TR R-64). */
const MAIN_TYRE: TyreParams = {
  radius: G.gear.mainWheelRadius,
  inertia: 0.2,
  slipStiffness: 15,
  corneringStiffness: 8,
  relaxationLong: 0.15,
  relaxationLat: 0.3,
  lowSpeedDamping: 1.5,
};

/** 5.00-4, 6-ply, at 1.8 bar (AFM 1.5.4; s.3). */
const NOSE_TYRE: TyreParams = {
  radius: G.gear.noseWheelRadius,
  inertia: 0.1,
  slipStiffness: 15,
  corneringStiffness: 8,
  relaxationLong: 0.12,
  relaxationLat: 0.25,
  lowSpeedDamping: 1.5,
};

/**
 * The castering fork (AFM 7.5; s.3): free through +/-60 degrees, the pedals not linked to it. Trail, swivel
 * friction and its viscous drag are not published: ESTIMATES (tests/gear/testbed.ts DA20_CASTER: fork offset
 * about 7 cm; a few N m of friction washer; `damper` is the rate constant of the inertia-free swivel). In flight
 * the wheel trails in the airflow, here within `centeringTime`.
 */
const NOSE_CASTER: SteeringParams = {
  mode: 'castering',
  maxCommand: 0,
  casterLimit: G.gear.maxNoseSteer,
  trail: 0.07,
  linkStiffness: 0,
  breakoutTorque: 0,
  bungeeStiffness: 0,
  damper: 10,
  friction: 4,
  centeringTime: 0.3,
};

/**
 * Main-leg damping: the aluminium leaf is "an undamped spring leaf, so expect a bouncy response" (s.3); with the
 * tyre's carcass about 0.12 of critical in heave.
 */
const MAIN_DAMPING = 1500;
/**
 * Nose: the elastomer pack's hysteresis, "moderate" (s.3): about 0.5 of critical in the pitch-rocking mode on the
 * gear, so the nod when the idle thrust comes on (the DA20 idles at 1000 rpm) has died out within 2 s.
 */
const NOSE_DAMPING = 6000;

function main(name: 'left' | 'right'): WheelConfig {
  const side = name === 'left' ? -1 : 1;
  return {
    name,
    position: name === 'left' ? G.gear.leftMain : G.gear.rightMain,
    axis: { x: 0, y: side * Math.sin(MAIN_TILT), z: -Math.cos(MAIN_TILT) },
    // 60-70 kN/m per leg at the wheel, about 0.05 m static deflection (s.3, ESTIMATE).
    strut: new LinearStrutSpring(65e3),
    // About 2.5 cm of tyre deflection at the static load.
    tyreSpring: { stiffness: 120e3, hardening: 0.06 },
    damping: (_strutRate, totalRate) => MAIN_DAMPING * totalRate,
    tyre: MAIN_TYRE,
    steering: null,
    brake: name,
    // Single-disc hydraulic brake (AFM 7.5.1). It must hold the aircraft at full throttle (the short-field take-off,
    // AFM 4.4.7: about 2.4 kN of static thrust and the slipstream's yaw against a nosewheel that gives no
    // restraint); with 250 N m it crept and turned. The same torque stops a landing in about 140 m where the AFM
    // (5.3.12) has 201 m: request D-D-pa38-phys-01 (a holding torque apart from the sliding one).
    maxBrakeTorque: 300,
    // About 3.4 g on one leg.
    limitLoad: 21e3,
  };
}

/** Wing-tip lower surface: the end of the upturned tip, and the start of the tip (the lowest outboard point). */
const HALF_SPAN = G.wing.span / 2;
const PANEL_END = G.wing.winglet!.rootY!;
const panelZ = (y: number) => G.wing.quarterChord.z - (y - G.wing.rootY) * Math.tan(G.wing.dihedral) + 0.06;
const TIP_Z = panelZ(PANEL_END) - G.wing.winglet!.height * Math.sin(G.wing.winglet!.cant);
const H_TAIL_TIP_X = G.hTail.tipQuarterChordX ?? G.hTail.quarterChord.x;
const H_TAIL_HALF = G.hTail.span / 2;

/** Airframe points that must not touch the ground (positions from s.2, s.12 and the fuselage table there). */
const STRUCTURE: readonly StructuralPoint[] = [
  // Low wing: the tips (the tip's lower edge, and where the upturn begins) and a mid-span point on each side.
  { position: { x: -0.4, y: -HALF_SPAN, z: TIP_Z }, message: 'Left wingtip struck the ground', tolerance: 0 },
  { position: { x: -0.4, y: HALF_SPAN, z: TIP_Z }, message: 'Right wingtip struck the ground', tolerance: 0 },
  { position: { x: -0.1, y: -PANEL_END, z: panelZ(PANEL_END) }, message: 'Left wingtip struck the ground', tolerance: 0 },
  { position: { x: -0.1, y: PANEL_END, z: panelZ(PANEL_END) }, message: 'Right wingtip struck the ground', tolerance: 0 },
  { position: { x: -0.2, y: -2.7, z: panelZ(2.7) }, message: 'Left wing struck the ground', tolerance: 0 },
  { position: { x: -0.2, y: 2.7, z: panelZ(2.7) }, message: 'Right wing struck the ground', tolerance: 0 },
  // Ventral tail skid under the rudder (s.2.5, s.12): it touches at about 12 degrees of rotation on the mains ("the
  // tail skid can touch if the flare is over-rotated", s.11). A scrape at landing speed is survivable.
  { position: { x: da20NoseX(6.6), y: 0, z: da20FrlZ(-0.22) }, message: 'Tail strike', tolerance: 2.5 },
  // Tailplane tips (a roll-over on the T-tail).
  { position: { x: H_TAIL_TIP_X, y: -H_TAIL_HALF, z: G.hTail.quarterChord.z }, message: 'Left horizontal stabilizer struck the ground', tolerance: 0 },
  { position: { x: H_TAIL_TIP_X, y: H_TAIL_HALF, z: G.hTail.quarterChord.z }, message: 'Right horizontal stabilizer struck the ground', tolerance: 0 },
  // Belly under the cabin and the boom, and the lower cowl.
  { position: { x: da20NoseX(2.2), y: 0, z: da20FrlZ(-0.48) }, message: 'Belly struck the ground', tolerance: 0 },
  { position: { x: da20NoseX(4.0), y: 0, z: da20FrlZ(-0.3) }, message: 'Belly struck the ground', tolerance: 0 },
  { position: { x: da20NoseX(0.6), y: 0, z: da20FrlZ(-0.26) }, message: 'Nose struck the ground', tolerance: 0 },
  // Upper surfaces, for a nose-over or roll-over: the fin's tip fairing and the canopy apex.
  { position: { x: G.hTail.quarterChord.x, y: 0, z: G.hTail.quarterChord.z - 0.1 }, message: 'Aircraft flipped over', tolerance: 0 },
  { position: { x: da20NoseX(2.15), y: 0, z: da20FrlZ(0.69) }, message: 'Aircraft flipped over', tolerance: 0 },
];

export function createDA20Gear(): GearConfig {
  const prop = G.propellers[0];
  return {
    wheels: [
      {
        name: 'nose',
        position: G.gear.nose,
        axis: { x: 0, y: 0, z: -1 },
        // Elastomer pack, 25-35 kN/m (s.3, ESTIMATE).
        strut: new LinearStrutSpring(30e3),
        tyreSpring: { stiffness: 100e3, hardening: 0.05 },
        damping: (_strutRate, totalRate) => NOSE_DAMPING * totalRate,
        tyre: NOSE_TYRE,
        steering: NOSE_CASTER,
        brake: null,
        maxBrakeTorque: 0,
        // The light nose leg (s.11: a bounced, nose-first arrival risks it): about 8 x its static load.
        limitLoad: 12e3,
      },
      main('left'),
      main('right'),
    ],
    structure: STRUCTURE,
    propellers: [{ hub: prop.hub, radius: prop.diameter / 2, message: 'Propeller strike' }],
    // Contact speeds of a 45 KCAS (23 m/s) landing stall: 1.6 and 1.4 times it (gearConfig.ts rule of thumb).
    impact: { sinkRate: 7, speed: 37, steepSpeed: 32.5, steepPath: 12 * DEG },
  };
}
