// Cessna 172S landing gear: steel-tube spring main legs, oleo-pneumatic steerable nose strut.
//
// Design point: 1050 kg at the reference CG, so each main carries ~3.77 kN and the nose ~2.76 kN (26.7 %).
// The springs are sized so the aircraft then sits with the reference point 1.25 m above the ground and the
// fuselage level (core/c172.ts): the nose goes down 6 cm (oleo 4 cm + 5.00-5 tyre 2 cm) and the mains 8 cm
// (steel leg 5.7 cm + 6.00-6 tyre 2.4 cm, along a leg axis tilted 10 degrees outboard because the spring leg
// deflects up and out). Tyre stiffnesses follow from ~2 cm static deflection at the rated ~30-40 psi; the
// cornering and slip stiffnesses and relaxation lengths are typical of small bias-ply aircraft tyres
// (NASA TR R-64, Smiley & Horne; ESDU 86032).

import { C172 } from '../../core/c172';
import { DEG } from '../../core/math';
import type { GearConfig, WheelConfig } from './gearConfig';
import { LinearStrutSpring, OleoPneumaticSpring } from './springs';
import { C172_PROPELLER, C172_STRUCTURE } from './structure';
import type { SteeringParams, TyreParams } from './tyre';

export type { GearConfig, WheelConfig } from './gearConfig';

const MAIN_TILT = 10 * DEG;

const MAIN_TYRE: TyreParams = {
  radius: C172.gear.mainWheelRadius,
  inertia: 0.3,
  slipStiffness: 15,
  corneringStiffness: 8,
  relaxationLong: 0.15,
  relaxationLat: 0.3,
  lowSpeedDamping: 1.5,
};

const NOSE_TYRE: TyreParams = {
  radius: C172.gear.noseWheelRadius,
  inertia: 0.15,
  slipStiffness: 15,
  corneringStiffness: 8,
  relaxationLong: 0.13,
  relaxationLat: 0.26,
  lowSpeedDamping: 1.5,
};

const NOSE_STEERING: SteeringParams = {
  maxCommand: C172.gear.maxNoseSteer,
  casterLimit: 30 * DEG,
  trail: 0.05,
  linkStiffness: 2000,
  // The bungee preload holds the wheel at the pedal angle against the aligning torque of a normal taxi turn
  // (a full-pedal turn at 6-8 kt puts ~400-600 N of side force on the nose tyre, 20-30 N m about the steering
  // axis; at 10 kt it starts to yield and the turn widens) and gives way when one main wheel is braked, which
  // makes the nose tyre scrub sideways (mu N ~2 kN): the wheel then casters toward its 30 degree stops, the
  // POH minimum turn (wingtip radius ~8.4 m).
  breakoutTorque: 35,
  bungeeStiffness: 60,
  damper: 25,
  centeringTime: 0.15,
};

/** Main-leg damping: structural hysteresis of the steel leg plus tyre carcass damping (~30 % of critical in heave). */
const MAIN_DAMPING = 2500;
/**
 * Nose oleo. A damping valve that is stiff at low stroke rates (it damps the ~1.3 Hz pitch-rocking mode on the
 * stiff, highly compressed gas column at ~0.6-0.7 of critical, so the nose neither bounces after a nosewheel
 * touchdown nor rocks under braking) but blows off above ~0.6 m/s
 * so it does not spike the load in a hard arrival; plus the metering orifice (force ~ velocity squared,
 * ~8 kN at 2 m/s), stiffer in rebound.
 */
const NOSE_DAMPING_LINEAR = 10000;
const NOSE_VALVE_KNEE = 0.6;
const NOSE_ORIFICE_COMPRESSION = 2000;
const NOSE_ORIFICE_REBOUND = 5000;

function main(name: 'left' | 'right'): WheelConfig {
  const side = name === 'left' ? -1 : 1;
  return {
    name,
    position: name === 'left' ? C172.gear.leftMain : C172.gear.rightMain,
    axis: { x: 0, y: side * Math.sin(MAIN_TILT), z: -Math.cos(MAIN_TILT) },
    strut: new LinearStrutSpring(65e3),
    tyreSpring: { stiffness: 150e3, hardening: 0.07 },
    damping: (_strutRate, totalRate) => MAIN_DAMPING * totalRate,
    tyre: MAIN_TYRE,
    steering: null,
    brake: name,
    // Cleveland single-disc brake; sized so a full-pedal stop on dry pavement averages ~0.33 g.
    maxBrakeTorque: 340,
    // ~3.5 g on one leg (a 3 m/s limit sink rate lands at roughly half this).
    limitLoad: 28e3,
  };
}

export const C172_GEAR: GearConfig = {
  wheels: [
    {
      name: 'nose',
      position: C172.gear.nose,
      axis: { x: 0, y: 0, z: -1 },
      // 13-15 cm stroke (5.15-5.30 in extension, C172S maintenance manual ch. 32), serviced to 45 psi fully
      // extended: on the ~2.5 in piston (~4.9 in^2) that is a ~1 kN precharge force. A small gas volume above the
      // oil (column ~7 cm) puts the static nose load (2.76 kN) 4 cm into the stroke and makes the strut stiffen
      // quickly beyond it (polytropic compression): doubling the nose load under hard braking compresses it only
      // ~1.3 cm more, so the nose dips 1-2 degrees, tyres and main legs included.
      strut: new OleoPneumaticSpring(1000, 0.07, 1.2, 0.15),
      tyreSpring: { stiffness: 140e3, hardening: 0.06 },
      damping: (strutRate, totalRate) =>
        NOSE_DAMPING_LINEAR * NOSE_VALVE_KNEE * Math.tanh(totalRate / NOSE_VALVE_KNEE) +
        (strutRate > 0 ? NOSE_ORIFICE_COMPRESSION : NOSE_ORIFICE_REBOUND) * strutRate * Math.abs(strutRate),
      tyre: NOSE_TYRE,
      steering: NOSE_STEERING,
      brake: null,
      maxBrakeTorque: 0,
      // ~7x the static nose load: a flat (three-point) arrival much above 2.5 m/s folds the nose leg.
      limitLoad: 20e3,
    },
    main('left'),
    main('right'),
  ],
  structure: C172_STRUCTURE,
  propellers: [C172_PROPELLER],
};
