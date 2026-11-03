// Tyre-ground interaction properties per surface type.
//
// Friction: dry asphalt/concrete peak ~0.8-0.9 and locked-wheel ~0.6-0.7; dry mown grass ~0.4-0.5;
// compacted snow ~0.2-0.3 (FAA AC 150/5320-12C, ESDU 71026, NASA TN D-6098).
//
// Rolling drag: only the SURFACE's share of the rolling resistance, the sinkage and bulldozing of a soft
// surface (tyre.ts adds the tyre's own hysteresis, ~0.03-0.035 for a light aircraft's soft tyre, and the
// breakaway at rest). Pavement adds nothing. Totals for a light aircraft's tyre, against the handbook totals: dry
// pavement ~0.03-0.035 (Raymer, "Aircraft Design", table 17.1: 0.03-0.05); firm dirt ~0.05 (Raymer 0.04); gravel
// ~0.045; mown grass ~0.075-0.08 (Raymer: hard turf 0.05, soft turf 0.07, wet grass 0.08; Torenbeek, "Synthesis of Subsonic
// Airplane Design", table 5-6: short grass 0.05, long grass 0.10); compacted snow ~0.07 (Torenbeek
// 0.06-0.07). The grass figure is toward the soft-turf end: the owner (a pilot) reports that idle power does
// not move a light aircraft on a typical grass strip. Unpaved surfaces also get small undulations so a grass
// strip rumbles.

import type { SurfaceType } from '../../core/types';
import { valueNoise2, type NoiseSample } from '../weather/random';

export interface SurfaceProperties {
  /** Peak (adhesion-limited) friction coefficient. */
  muPeak: number;
  /** Friction coefficient of a fully sliding tyre at high slip speed. */
  muSlide: number;
  /** The surface's share of the rolling resistance (sinkage, bulldozing), resisting force / normal load. */
  rollingDrag: number;
  /** Peak height of the surface undulations, m (0 = smooth). */
  undulation: number;
  /** Typical wavelength of the undulations, m. */
  undulationWavelength: number;
}

export const SURFACES: Readonly<Record<SurfaceType, SurfaceProperties>> = {
  runway: { muPeak: 0.85, muSlide: 0.65, rollingDrag: 0, undulation: 0, undulationWavelength: 1 },
  taxiway: { muPeak: 0.8, muSlide: 0.6, rollingDrag: 0, undulation: 0.002, undulationWavelength: 6 },
  grass: { muPeak: 0.45, muSlide: 0.35, rollingDrag: 0.045, undulation: 0.012, undulationWavelength: 4 },
  dirt: { muPeak: 0.6, muSlide: 0.45, rollingDrag: 0.015, undulation: 0.015, undulationWavelength: 3 },
  rock: { muPeak: 0.65, muSlide: 0.5, rollingDrag: 0.01, undulation: 0.02, undulationWavelength: 2 },
  snow: { muPeak: 0.25, muSlide: 0.15, rollingDrag: 0.04, undulation: 0.01, undulationWavelength: 5 },
  water: { muPeak: 0.1, muSlide: 0.05, rollingDrag: 0.22, undulation: 0, undulationWavelength: 1 },
};

const UNDULATION_SEED = 0x51f15e;
const noise: NoiseSample = { value: 0, dx: 0, dy: 0 };

/**
 * Height of the surface undulation above the nominal terrain at a point, and its horizontal gradient.
 * Writes into `out` (height m, dNorth and dEast dimensionless slopes).
 */
export function surfaceUndulation(
  props: SurfaceProperties,
  north: number,
  east: number,
  out: { height: number; dNorth: number; dEast: number },
): void {
  if (props.undulation === 0) {
    out.height = 0;
    out.dNorth = 0;
    out.dEast = 0;
    return;
  }
  const inv = 1 / props.undulationWavelength;
  valueNoise2(UNDULATION_SEED, north * inv, east * inv, noise);
  out.height = props.undulation * noise.value;
  out.dNorth = props.undulation * noise.dx * inv;
  out.dEast = props.undulation * noise.dy * inv;
}
