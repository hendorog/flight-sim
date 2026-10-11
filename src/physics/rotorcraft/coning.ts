import { clamp } from '../../core/math';

/** One blade, SI units/radians. Radii and polar inertia are measured from the shaft.
 * No renderer, blade-count or teetering assumptions; an articulated rotor can call this per blade.
 * Sources, derivation and Robinson estimates: docs/rotor-coning.md. */
export interface BladeConingDefinition {
  mass: number;
  cgRadius: number;
  /** Per-blade polar inertia (kg m²), including the existing model's root/hub allowance. */
  inertia: number;
  hingeRadius: number;
  /** Centre of thrust when a resolved aerodynamic hinge moment is unavailable. */
  thrustRadius: number;
  /** Unstrained spring angle. A free coning hinge (stiffness = 0) has no fixed precone. */
  precone: number;
  hingeStiffness: number;
  droopStop: number;
  /** Optional mechanical upper stop; absent uses the 90° limit of the geometric domain. */
  coningStop?: number;
  /** Uniform cantilever approximation for low-speed gravitational blade sag. */
  bending?: { rootRadius: number; radius: number; rigidity: number };
}

export interface BladeConingState {
  /** Rigid blade angle about its hinge, positive up. */
  angle: number;
  /** Additional curved tip displacement normal to the blade, metres, negative down. */
  tipBend: number;
}

/** Quasi-static hinge balance: Ma - m g (rcg-e) = Ω² (Ishaft-m e rcg) β + K(β-β0).
 * Thrust is signed and PER BLADE; omega is rad/s. normalGravity is gravity projected onto the
 * rotor's normal, positive down. Supply aerodynamicMoment (Nm about the hinge) for resolved blades.
 * Hard stops are continuous in angle (their derivative changes on contact); no RPM thresholds/lerps.
 * This is a small-angle equilibrium, not a transient flapping or high-coning failure solver. */
export function bladeConing(d: BladeConingDefinition, omega: number, thrust: number,
  normalGravity = 9.80665, aerodynamicMoment = thrust * (d.thrustRadius - d.hingeRadius)): BladeConingState {
  // Ihinge + m e (rcg-e) = Ishaft - m e rcg: include the centrifugal effect of hinge offset.
  const centrifugalInertia = d.inertia - d.mass * d.hingeRadius * d.cgRadius;
  const stiffness = centrifugalInertia * omega ** 2 + d.hingeStiffness;
  const moment = aerodynamicMoment - d.mass * normalGravity * (d.cgRadius - d.hingeRadius)
    + d.hingeStiffness * d.precone;
  const upper = d.coningStop ?? Math.PI / 2;
  // At rest a free hinge rests on its loaded stop. An exactly unloaded free hinge is indeterminate;
  // choose neutral. Avoid 0/0 without an arbitrary speed floor in the physical balance.
  const free = stiffness > 0 ? moment / stiffness : moment < 0 ? d.droopStop : moment > 0 ? upper : 0;
  const angle = clamp(free, d.droopStop, upper);
  let tipBend = 0;
  if (d.bending) {
    const b = d.bending, length = b.radius - b.rootRadius;
    // Rayleigh–Ritz with f(x)=x²(6-4x+x²)/3. Integral f dx=2/5; elastic stiffness
    // is 16 EI/(5 L³). Centrifugal tension adds m Ω² (122/405 + 2 root/(5 L)).
    // At rest this reduces to the uniform-cantilever result -m g L³/(8 EI).
    const elastic = 16 * b.rigidity / (5 * length ** 3);
    const tension = d.mass * omega ** 2 * (122 / 405 + 2 * b.rootRadius / (5 * length));
    tipBend = -0.4 * d.mass * normalGravity * Math.cos(angle) / (elastic + tension);
  }
  return { angle, tipBend };
}

/** Unit tip-deflection shape of a uniformly loaded cantilever; x is fractional flexible span. */
export function bladeBendShape(x: number): number {
  x = clamp(x, 0, 1);
  return x * x * (6 - 4 * x + x * x) / 3;
}

/** Resolve a blade's mean loading plus its dynamic harmonic flap. Represent the harmonic as
 * an equivalent hinge moment so the shared balance applies weight and stops exactly once.
 * Away from stops this preserves the individual flap deviations; at rest a free hinge is
 * supported by its stop even if the airborne solver retains a stale harmonic. This pose
 * adapter does not feed stop reactions back into the reduced airborne dynamics. */
export function articulatedBladeConing(d: BladeConingDefinition, omega: number, thrust: number,
  harmonic: number, normalGravity = 9.80665,
  meanMoment = thrust * (d.thrustRadius - d.hingeRadius)): BladeConingState {
  const stiffness = (d.inertia - d.mass * d.hingeRadius * d.cgRadius) * omega ** 2 + d.hingeStiffness;
  return bladeConing(d, omega, thrust, normalGravity, meanMoment + stiffness * harmonic);
}
