// Drives a PropulsionSystem at a fixed flight condition, standing in for the flight-model assembly.

import { FT, KT, type Vec3 } from '../../src/core/math';
import { defaultControls, type AtmosphereSample, type ControlInputs } from '../../src/core/types';
import type { PropulsionInput, PropulsionOutput } from '../../src/physics/interfaces';
import { FUEL_DENSITY, PropulsionSystem, type Powerplant } from '../../src/physics/propulsion';
import type { PowerplantDef } from '../../src/physics/propulsion/defs';

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
  /** Number of engines the controls are for (each gets its own entry for per-engine levers and switches). Default 1. */
  engines?: number;
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
    // A twin's propellers are given the same air here; a test of asymmetric inflow sets airVelocityAt itself.
    airVelocityAt: c.engines === undefined ? undefined : Array.from({ length: c.engines }, () => air),
    controls: { ...defaultControls(c.engines === undefined ? undefined : { engineCount: c.engines, controlDefaults: {} }), throttle: 1, ...c.controls },
    dt: DT,
  };
}

/** Run for `seconds` at a fixed condition; returns the final output (a live reference, see PropulsionSystem.step). */
export function run(sys: Powerplant, c: Condition, seconds: number): PropulsionOutput {
  return advance(sys, makeInput(c), seconds);
}

/** Step `sys` for `seconds` with `input` as it stands; returns the final output (a live reference). */
export function advance(sys: Powerplant, input: PropulsionInput, seconds: number): PropulsionOutput {
  let out!: PropulsionOutput;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) out = sys.step(input);
  return out;
}

/** A warm, running engine at `rpm` with full tanks: the Cessna 172S, or the single-engine powerplant of `def`. */
export function runningSystem(rpm = 2000, def?: PowerplantDef): PropulsionSystem {
  const sys = new PropulsionSystem(undefined, def);
  sys.reset({ running: true, fuelLeft: sys.tankCapacities[0], fuelRight: sys.tankCapacities[1], rpm });
  return sys;
}

/** Propeller efficiency T V / P_shaft of the last step. */
export function propEfficiency(out: PropulsionOutput, ktas: number): number {
  return (out.propeller.thrust * ktas * KT) / out.engine.power;
}

/** US gallons per hour per kg/s of 100LL. */
export const GPH_PER_KG_S = 3600 / (FUEL_DENSITY * 3.785411784e-3);
