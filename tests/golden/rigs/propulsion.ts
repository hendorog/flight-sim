// FROZEN rig of the golden tests (see README.md). Copied from tests/propulsion/helpers.ts of the untouched
// tree; do not "improve" it: the defaults below (ISA constants, 1100 kg, 72 kg per tank, 1/240 s) are part of
// the recorded numbers.
//
// Drives a PropulsionSystem at a fixed flight condition, standing in for the flight-model assembly.

import { FT, KT, type Vec3 } from '../../../src/core/math';
import { defaultControls, type AtmosphereSample, type ControlInputs } from '../../../src/core/types';
import type { PropulsionInput, PropulsionOutput } from '../../../src/physics/interfaces';
import { PropulsionSystem } from '../../../src/physics/propulsion';

export const DT = 1 / 240;

/** ISA atmosphere at a pressure altitude, m. */
export function isa(altitude: number): AtmosphereSample {
  const T = 288.15 - 0.0065 * altitude;
  const p = 101325 * Math.pow(T / 288.15, 5.25588);
  return {
    temperature: T,
    pressure: p,
    density: p / (287.053 * T),
    speedOfSound: Math.sqrt(1.4 * 287.053 * T),
    viscosity: (1.458e-6 * Math.pow(T, 1.5)) / (T + 110.4),
  };
}

export interface Condition {
  altitudeFt?: number;
  /** True airspeed along the propeller axis, kt. */
  ktas?: number;
  /** Angle of attack of the inflow at the hub, rad (air arriving from below for positive values). */
  alpha?: number;
  controls?: Partial<ControlInputs>;
}

export function makeInput(c: Condition): PropulsionInput {
  const v = (c.ktas ?? 0) * KT;
  const alpha = c.alpha ?? 0;
  const air: Vec3 = { x: -v * Math.cos(alpha), y: 0, z: -v * Math.sin(alpha) };
  return {
    body: {
      time: 0,
      position: { x: 0, y: 0, z: 0 },
      orientation: { w: 1, x: 0, y: 0, z: 0 },
      velocityBody: { x: v, y: 0, z: 0 },
      angularVelocity: { x: 0, y: 0, z: 0 },
      cgOffset: { x: 0, y: 0, z: 0 },
      mass: 1100,
    },
    atmosphere: isa((c.altitudeFt ?? 0) * FT),
    airVelocityBody: air,
    controls: { ...defaultControls(), throttle: 1, ...c.controls },
    dt: DT,
  };
}

/** Run for `seconds` at a fixed condition; returns the final output (a live reference, see PropulsionSystem.step). */
export function run(sys: PropulsionSystem, c: Condition, seconds: number): PropulsionOutput {
  const input = makeInput(c);
  let out!: PropulsionOutput;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) out = sys.step(input);
  return out;
}

/** A warm, running engine at `rpm` with full tanks. */
export function runningSystem(rpm = 2000): PropulsionSystem {
  const sys = new PropulsionSystem();
  sys.reset({ running: true, fuelLeft: 72, fuelRight: 72, rpm });
  return sys;
}
