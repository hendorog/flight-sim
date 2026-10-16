// Pure constant module (no imports), so aircraft leaf files can read it without loading the control system.

/**
 * Stabiliser trim: incidence change per unit of equivalent elevator deflection the trim solver splits off to the
 * stabiliser (thin-aerofoil effectiveness of a 0.36-chord elevator, 0.71, times its viscous factor 0.88). It sets only
 * how the solver's pitch control maps to the two surfaces; the aerodynamics sees the real ones.
 */
export const STABILIZER_EQUIVALENCE = 0.63;
