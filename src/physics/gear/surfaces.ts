// Tyre-ground interaction properties per surface type.
//
// Friction: dry asphalt/concrete peak ~0.8-0.9 and locked-wheel ~0.6-0.7; dry mown grass ~0.4-0.5;
// compacted snow ~0.2-0.3 (FAA AC 150/5320-12C, ESDU 71026, NASA TN D-6098). Rolling resistance: paved
// 0.02, hard turf 0.04-0.05, compacted snow ~0.06-0.07 (Torenbeek, "Synthesis of Subsonic Airplane
// Design", table 5-6). Unpaved surfaces also get small undulations so a grass strip rumbles.

import type { SurfaceType } from '../../core/types';
import { valueNoise2, type NoiseSample } from '../weather/random';

export interface SurfaceProperties {
  /** Peak (adhesion-limited) friction coefficient. */
  muPeak: number;
  /** Friction coefficient of a fully sliding tyre at high slip speed. */
  muSlide: number;
  /** Rolling resistance coefficient (resisting force / normal load). */
  rollingResistance: number;
  /** Peak height of the surface undulations, m (0 = smooth). */
  undulation: number;
  /** Typical wavelength of the undulations, m. */
  undulationWavelength: number;
}

export const SURFACES: Readonly<Record<SurfaceType, SurfaceProperties>> = {
  runway: { muPeak: 0.85, muSlide: 0.65, rollingResistance: 0.02, undulation: 0, undulationWavelength: 1 },
  taxiway: { muPeak: 0.8, muSlide: 0.6, rollingResistance: 0.02, undulation: 0.002, undulationWavelength: 6 },
  grass: { muPeak: 0.45, muSlide: 0.35, rollingResistance: 0.05, undulation: 0.012, undulationWavelength: 4 },
  dirt: { muPeak: 0.6, muSlide: 0.45, rollingResistance: 0.04, undulation: 0.015, undulationWavelength: 3 },
  rock: { muPeak: 0.65, muSlide: 0.5, rollingResistance: 0.03, undulation: 0.02, undulationWavelength: 2 },
  snow: { muPeak: 0.25, muSlide: 0.15, rollingResistance: 0.07, undulation: 0.01, undulationWavelength: 5 },
  water: { muPeak: 0.1, muSlide: 0.05, rollingResistance: 0.25, undulation: 0, undulationWavelength: 1 },
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
