import type { RotorcraftDefinition } from './definition';

type Skids = RotorcraftDefinition['skids'];
export interface SuspensionState { plastic: number; plasticWork: number; dampingWork: number }
export const emptySuspension = (): SuspensionState => ({ plastic: 0, plasticWork: 0, dampingWork: 0 });

/** Gas force at a vertical stroke from full extension. Mount ratio is absorbed in A and V/A.
 * P V^n = const, with a linear bump stop beyond usable stroke (never a singular gas volume).
 * Parameters are explicit estimates; see docs/helicopter-ground-contact.md. */
export function gasForce(d: NonNullable<Skids['oleo']>, stroke: number, station: number): number {
  const q = Math.min(Math.max(0, stroke), d.maxStroke);
  const pressure = d.pressure[station] * (d.gasLength / (d.gasLength - q)) ** d.exponent;
  const bump = Math.max(0, stroke - d.maxStroke) * 1e6;
  return d.area * (pressure - 101325) + bump;
}

/** Foot/cross-member compliance in series with the precharged strut. Below breakaway the oleo
 * stays on its extension stop; this avoids either subtracting real preload or a force discontinuity. */
function oleoSupport(d: NonNullable<Skids['oleo']>, depth: number, station: number) {
  let lo = 0, hi = Math.max(0, depth);
  for (let i = 0; i < 32; i++) {
    const stroke = (lo + hi) / 2;
    if (d.contactStiffness * (depth - stroke) > gasForce(d, stroke, station)) lo = stroke; else hi = stroke;
  }
  const stroke = (lo + hi) / 2;
  return { stroke, force: d.contactStiffness * Math.max(0, depth - stroke) };
}

/** Inverse of the static force law, also used by spawn/restingPose (not a hard-coded ride height). */
export function suspensionStroke(d: Skids, load: number, station: number): number {
  if (!d.oleo) return load / d.stiffness;
  if (load <= gasForce(d.oleo, 0, station)) return load / d.oleo.contactStiffness;
  let lo = 0, hi = d.oleo.maxStroke;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (gasForce(d.oleo, mid, station) < load) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2 + load / d.oleo.contactStiffness;
}

/** Unilateral support. A return map keeps permanent set on unloading; no tensile ground force.
 * RK probes evaluate the return map without committing history. Plastic dissipation is Fy dp;
 * the hardening work H p dp is stored separately in the elasticEnergy diagnostic. */
export function suspensionLoad(d: Skids, old: SuspensionState, depth: number, speed: number,
  station: number, dt: number): { load: number; elasticEnergy: number; spread: number; state: SuspensionState } {
  let plastic = old.plastic, plasticWork = old.plasticWork;
  let spring: number, energy: number;
  if (d.oleo) {
    const o = d.oleo, support = oleoSupport(o, depth, station);
    spring = support.force;
    const q = Math.min(support.stroke, o.maxStroke);
    const gas = o.pressure[station] * o.area * o.gasLength /
      (o.exponent - 1) * ((1 - q / o.gasLength) ** (1 - o.exponent) - 1);
    energy = gas - 101325 * o.area * q + 0.5 * spring ** 2 / o.contactStiffness +
      gasForce(o, o.maxStroke, station) * Math.max(0, support.stroke - o.maxStroke) +
      0.5e6 * Math.max(0, support.stroke - o.maxStroke) ** 2;
  } else {
    if (d.flexure) {
      const p = d.flexure;
      plastic = Math.max(plastic, (d.stiffness * depth - p.yieldForce) / (d.stiffness + p.hardening));
      plasticWork += p.yieldForce * (plastic - old.plastic);
    }
    const elastic = Math.max(0, depth - plastic);
    spring = d.stiffness * elastic;
    energy = 0.5 * d.stiffness * elastic ** 2 + 0.5 * (d.flexure?.hardening ?? 0) * plastic ** 2;
  }
  // Oil orifice loss is quadratic; a relief valve adds flow above cracking pressure. Rebound
  // has its own metering coefficient. Both branches oppose stroke velocity and are passive.
  let damper = d.damping * speed;
  if (d.oleo) {
    const o = d.oleo, v = Math.abs(speed), coeff = speed >= 0 ? o.orifice : o.rebound;
    const quadratic = coeff * v * v, opening = Math.sqrt(o.reliefForce / coeff);
    damper += Math.sign(speed) * (quadratic <= o.reliefForce ? quadratic :
      o.reliefForce + o.reliefDamping * (v - opening));
  }
  const load = Math.max(0, spring + damper);
  const dissipation = Math.max(0, (load - spring) * speed);
  return { load, elasticEnergy: energy, spread: (d.flexure?.spread ?? 0) * Math.max(0, depth),
    state: { plastic, plasticWork, dampingWork: old.dampingWork + dissipation * Math.max(0, dt) } };
}
