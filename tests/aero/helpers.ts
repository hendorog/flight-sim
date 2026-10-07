// Shared set-up for the aerodynamics tests: build an AeroInput for a given flight condition and
// reduce the output to standard body-axis coefficients, referred to the reference area, span and chord of
// the model's own definition. What is not in an aerodynamic definition keeps the Cessna 172S as its default:
// the mass in the body state (Condition.mass) and the elevator travel of trimmed().

import { C172 } from '../../src/core/c172';
import { DEG, quat, type Vec3 } from '../../src/core/math';
import type { SurfaceState } from '../../src/core/types';
import { atmosphereAt } from '../../src/physics/atmosphere';
import type { AeroInput, AeroOutput, Slipstream } from '../../src/physics/interfaces';
import type { AeroModel } from '../../src/physics/aero';

export interface Condition {
  /** True airspeed, m/s. */
  V: number;
  alphaDeg?: number;
  betaDeg?: number;
  /** Body rates, rad/s. */
  p?: number;
  q?: number;
  r?: number;
  surfaces?: Partial<SurfaceState>;
  heightAGL?: number;
  slipstream?: Slipstream | null;
  cgOffset?: Vec3;
  altitude?: number;
  dt?: number;
  /** Mass in the body state, kg (the aerodynamic model does not read it). Default: the C172S at maximum take-off mass. */
  mass?: number;
}

export function neutralSurfaces(): SurfaceState {
  return { elevator: 0, aileronLeft: 0, aileronRight: 0, rudder: 0, flaps: 0, elevatorTrim: 0, rudderTrim: 0 };
}

export function makeInput(c: Condition): AeroInput {
  const a = (c.alphaDeg ?? 0) * DEG;
  const b = (c.betaDeg ?? 0) * DEG;
  const alt = c.altitude ?? 1000;
  return {
    body: {
      time: 0,
      position: { x: 0, y: 0, z: -alt },
      orientation: quat.identity(),
      velocityBody: { x: c.V * Math.cos(a) * Math.cos(b), y: c.V * Math.sin(b), z: c.V * Math.sin(a) * Math.cos(b) },
      angularVelocity: { x: c.p ?? 0, y: c.q ?? 0, z: c.r ?? 0 },
      cgOffset: c.cgOffset ?? { x: 0, y: 0, z: 0 },
      mass: c.mass ?? C172.mass.maxTakeoff,
    },
    atmosphere: atmosphereAt(alt),
    windNED: { x: 0, y: 0, z: 0 },
    surfaces: { ...neutralSurfaces(), ...c.surfaces },
    slipstream: c.slipstream ?? null,
    // Out of ground effect unless asked for.
    heightAGL: c.heightAGL ?? 1000,
    dt: c.dt ?? 0,
  };
}

export interface Coefficients {
  CL: number;
  CD: number;
  CY: number;
  /** Rolling, pitching and yawing moment coefficients (body axes, about the CG). */
  Cl: number;
  Cm: number;
  Cn: number;
  out: AeroOutput;
}

export function coefficients(model: AeroModel, c: Condition): Coefficients {
  const input = makeInput(c);
  const out = model.compute(input);
  const { referenceArea, referenceSpan, referenceChord } = model.definition;
  const qS = 0.5 * input.atmosphere.density * c.V * c.V * referenceArea;
  return {
    CL: out.lift / qS,
    CD: out.drag / qS,
    CY: out.force.y / qS,
    Cl: out.moment.x / (qS * referenceSpan),
    Cm: out.moment.y / (qS * referenceChord),
    Cn: out.moment.z / (qS * referenceSpan),
    out,
  };
}

/**
 * Coefficients with the elevator set for zero pitching moment (secant iteration). Returns null if the
 * elevator needed lies outside [minElevator, maxElevator] (default: the C172S elevator's travel).
 */
export function trimmed(
  model: AeroModel,
  c: Condition,
  minElevator = -C172.hTail.elevator.maxUp,
  maxElevator = C172.hTail.elevator.maxDown,
): (Coefficients & { elevator: number }) | null {
  const at = (e: number) => coefficients(model, { ...c, surfaces: { ...c.surfaces, elevator: e } });
  let e0 = 0;
  let e1 = -5 * DEG;
  let c0 = at(e0);
  let c1 = at(e1);
  for (let k = 0; k < 20 && Math.abs(c1.Cm) > 1e-5; k++) {
    const slope = (c1.Cm - c0.Cm) / (e1 - e0);
    if (!(Math.abs(slope) > 1e-9)) return null;
    const e2 = Math.min(Math.max(e1 - c1.Cm / slope, minElevator - 0.2), maxElevator + 0.2);
    e0 = e1;
    c0 = c1;
    e1 = e2;
    c1 = at(e1);
  }
  if (Math.abs(c1.Cm) > 1e-4 || e1 < minElevator || e1 > maxElevator) return null;
  return { ...c1, elevator: e1 };
}
