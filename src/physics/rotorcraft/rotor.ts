import { clamp } from '../../core/math';
import type { RotorDefinition } from './definition';

export interface RotorLoads { thrust: number; torque: number; inPlane: number; stalledFraction: number }
/** Azimuth-averaged blade elements, including reverse flow and signed aerodynamic shaft torque.
 * axial is aircraft velocity along thrust axis, positive climbing; inflow is wake velocity opposite thrust.
 * A driving region in descent has negative torque: autorotation draws energy from the air, never an RPM servo.
 * Section polar is analytic and unvalidated; this is not a free-wake or elastic-blade solver.
 */
export function bladeElements(d: RotorDefinition, omega: number, pitch: number, axial: number,
  inPlaneSpeed: number, inflow: number, density: number, radial = 12, azimuthal = 16): RotorLoads {
  let thrust = 0, torque = 0, inPlane = 0, stalled = 0;
  const dr = (d.radius - d.rootCutout) / radial;
  for (let j = 0; j < azimuthal; j++) {
    const sin = Math.sin(2 * Math.PI * (j + 0.5) / azimuthal);
    for (let i = 0; i < radial; i++) {
      const r = d.rootCutout + (i + 0.5) * dr;
      const ut = omega * r + inPlaneSpeed * sin;
      const up = axial + inflow;
      const phi = Math.atan2(up, ut);
      const theta = pitch + d.twist * (r / d.radius - 0.75);
      const alpha = Math.atan2(Math.sin(theta - phi), Math.cos(theta - phi));
      const linear = d.liftSlope * alpha;
      const stall = Math.abs(linear) > d.maxCl;
      // Smooth saturation, then separated flat-plate flow at large incidence, including reverse flow.
      const blend = clamp((Math.abs(alpha) - 0.25) / 0.35, 0, 1);
      const cl = (1 - blend) * clamp(linear, -d.maxCl, d.maxCl) + blend * Math.sin(2 * alpha);
      const cd = d.profileCd + d.inducedDrag * cl * cl + blend * 1.8 * Math.sin(alpha) ** 2;
      const scale = 0.5 * density * (ut * ut + up * up) * d.chord * dr * d.blades / azimuthal;
      const lift = scale * cl, drag = scale * cd;
      thrust += lift * Math.cos(phi) - drag * Math.sin(phi);
      const tangential = lift * Math.sin(phi) + drag * Math.cos(phi);
      torque += tangential * r;
      inPlane += tangential * sin;
      if (stall) stalled++;
    }
  }
  return { thrust, torque, inPlane, stalledFraction: stalled / (radial * azimuthal) };
}

/** Uniform momentum inflow. Relaxing this target gives dynamic inflow and translational lift.
 * Through the vortex-ring region use a bounded empirical continuation; no singular axial momentum root.
 */
export function inflowTarget(thrust: number, density: number, radius: number, axial: number, horizontal: number): number {
  const vh = Math.sqrt(Math.abs(thrust) / Math.max(2 * density * Math.PI * radius * radius, 1e-6));
  if (vh < 1e-6) return 0;
  if (axial < 0 && axial > -2 * vh && horizontal < 2 * vh) {
    return Math.sign(thrust) * vh * (1 + 0.35 * Math.sin(-Math.PI * axial / (2 * vh)) ** 2) /
      Math.sqrt(1 + (horizontal / vh) ** 2);
  }
  // Damped fixed-point solve of vi = T / (2 rho A sqrt(Vh² + (Va+vi)²)).
  let vi = vh;
  for (let i = 0; i < 24; i++) {
    const speed = Math.max(Math.hypot(horizontal, axial + vi), 0.5 * vh);
    vi = 0.75 * vi + 0.25 * vh * vh / speed;
  }
  return Math.sign(thrust) * vi;
}
