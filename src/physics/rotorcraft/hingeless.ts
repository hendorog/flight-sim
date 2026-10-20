// Hingeless hub helpers. Owner after the scaffold: RC. Pure module (imports no aircraft file), so aircraft data files
// (bo105/coning.ts, ah56/coning.ts) may import it and importOrder.test.ts stays green. Plan revision 2, sections 3.1, 4.
import { estimatedArticulatedGeometry, type BladeMassMoments } from './articulated';
import type { RotorcraftDefinition } from './definition';

/** Blade mass moments about the equivalent hinge: the hub's measured set, else the uniform estimate from main.inertia
 *  at the equivalent offset (estimatedArticulatedGeometry, the solver's own assumption). */
export function hingelessBlade(d: RotorcraftDefinition): BladeMassMoments {
  const h = d.hubModel;
  if (h?.kind !== 'hingeless') throw new Error('hingelessBlade: not a hingeless hub');
  return h.blade ?? estimatedArticulatedGeometry(d.main, h.equivalentHingeOffset, h.equivalentHingeOffset).blade;
}

/**
 * Flap spring at the equivalent hinge, N m/rad, DERIVED from the rotating first flap frequency at referenceRpm and the
 * solver's own blade moments: K_beta = max(0, nu^2 - 1 - e M_beta / I_beta) I_beta Omega_ref^2. A constant spring,
 * so nu rises as Nr falls. The coning definition's hingeStiffness must equal this (consistency rule).
 */
export function hingelessSpring(d: RotorcraftDefinition): number {
  const h = d.hubModel;
  if (h?.kind !== 'hingeless') return 0;
  const b = hingelessBlade(d), omega = d.referenceRpm * Math.PI / 30;
  const iBeta = b.flapInertia, e = h.equivalentHingeOffset;
  return Math.max(0, h.flapFrequency ** 2 - 1 - e * b.flapFirst / iBeta) * iBeta * omega * omega;
}
