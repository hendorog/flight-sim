// Richard Pearse 1903 Monoplane: open tubular-steel tricycle undercarriage with large wire-spoked wheels.

import { DEG } from '../../core/math';
import type { GearConfig, StructuralPoint, WheelConfig } from '../../physics/gear/gearConfig';
import { LinearStrutSpring, OleoPneumaticSpring } from '../../physics/gear/springs';
import type { SteeringParams, TyreParams } from '../../physics/gear/tyre';
import { PEARSE_GEOMETRY } from './geometry';

const G = PEARSE_GEOMETRY;
const MAIN_TILT = 4 * DEG;

const MAIN_TYRE: TyreParams = {
  radius: G.gear.mainWheelRadius,
  inertia: 0.16,
  slipStiffness: 13,
  corneringStiffness: 7,
  relaxationLong: 0.14,
  relaxationLat: 0.26,
  lowSpeedDamping: 1.4,
};

const NOSE_TYRE: TyreParams = {
  radius: G.gear.noseWheelRadius,
  inertia: 0.1,
  slipStiffness: 13,
  corneringStiffness: 7,
  relaxationLong: 0.12,
  relaxationLat: 0.22,
  lowSpeedDamping: 1.4,
};

const NOSE_STEERING: SteeringParams = {
  maxCommand: G.gear.maxNoseSteer,
  casterLimit: 28 * DEG,
  trail: 0.045,
  linkStiffness: 1800,
  breakoutTorque: 12,
  bungeeStiffness: 45,
  damper: 18,
  centeringTime: 0.15,
};

const MAIN_DAMPING = 780;

function main(name: 'left' | 'right'): WheelConfig {
  const side = name === 'left' ? -1 : 1;
  return {
    name,
    position: name === 'left' ? G.gear.leftMain : G.gear.rightMain,
    axis: { x: 0, y: side * Math.sin(MAIN_TILT), z: -Math.cos(MAIN_TILT) },
    strut: new LinearStrutSpring(24e3),
    tyreSpring: { stiffness: 68e3, hardening: 0.06 },
    damping: (_strutRate, totalRate) => MAIN_DAMPING * totalRate,
    tyre: MAIN_TYRE,
    steering: null,
    brake: name,
    maxBrakeTorque: 105,
    limitLoad: 8.5e3,
  };
}

const HALF_SPAN = G.wing.span / 2;
const H_TAIL_HALF = G.hTail.span / 2;

const STRUCTURE: readonly StructuralPoint[] = [
  { position: { x: 0, y: -HALF_SPAN, z: G.wing.quarterChord.z }, message: 'Left wingtip struck the ground', tolerance: 0, item: 'wingtipLeft' },
  { position: { x: 0, y: HALF_SPAN, z: G.wing.quarterChord.z }, message: 'Right wingtip struck the ground', tolerance: 0, item: 'wingtipRight' },
  { position: { x: -2.48, y: -H_TAIL_HALF, z: G.hTail.quarterChord.z }, message: 'Rear wing elevator struck the ground', tolerance: 0, item: 'tail' },
  { position: { x: -2.48, y: H_TAIL_HALF, z: G.hTail.quarterChord.z }, message: 'Rear wing elevator struck the ground', tolerance: 0, item: 'tail' },
  { position: { x: -0.45, y: 0, z: 0.72 }, message: 'Lower undercarriage frame struck the ground', tolerance: 0, item: 'belly' },
  { position: { x: 0.75, y: 0, z: 0.68 }, message: 'Front fork frame struck the ground', tolerance: 0, item: 'nose' },
  { position: { x: G.vTail.tip.x, y: 0, z: G.vTail.tip.z }, message: 'Centre sail mast struck — aircraft overturned', tolerance: 0 },
  { position: { x: 0, y: 0, z: -1.1 }, message: 'Aircraft flipped over', tolerance: 0 },
];

export function createPearseGear(): GearConfig {
  const prop = G.propellers[0];
  return {
    wheels: [
      {
        name: 'nose',
        position: G.gear.nose,
        axis: { x: 0, y: 0, z: -1 },
        strut: new OleoPneumaticSpring(450, 0.08, 1.2, 0.11),
        tyreSpring: { stiffness: 68e3, hardening: 0.05 },
        damping: (strutRate, totalRate) =>
          3800 * 0.5 * Math.tanh(totalRate / 0.5) + (strutRate > 0 ? 900 : 1800) * strutRate * Math.abs(strutRate),
        tyre: NOSE_TYRE,
        steering: NOSE_STEERING,
        brake: null,
        maxBrakeTorque: 0,
        limitLoad: 7.5e3,
      },
      main('left'),
      main('right'),
    ],
    structure: STRUCTURE,
    propellers: [{ hub: prop.hub, radius: prop.diameter / 2, message: 'Paddle airscrew struck the ground' }],
    damage: {
      legs: [
        { kind: 'oleo', hardLoad: 4.5e3, yieldLoad: 6.2e3, ultimateLoad: 14e3, bottomedUltimate: 9e3, collapsedCompression: 0.11, yield: { text: 'Front steel fork bent', item: 'nose' } },
        { kind: 'spring', hardLoad: 3.8e3, yieldLoad: 7.5e3, ultimateLoad: 11e3, collapsedCompression: 0.22 },
        { kind: 'spring', hardLoad: 3.8e3, yieldLoad: 7.5e3, ultimateLoad: 11e3, collapsedCompression: 0.22 },
      ],
    },
    impact: { sinkRate: 6.5, speed: 28, steepSpeed: 24, steepPath: 14 * DEG },
  };
}
