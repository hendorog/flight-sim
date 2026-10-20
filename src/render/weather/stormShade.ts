// The storm cells' cloud overhead, on the CPU: the vertical optical depth of the core columns and anvils above a
// point (the vertical ray of stormGlsl.ts STORM_SHADOW_GLSL), and the sky light under it (render/sky/SkySystem.ts:
// ctx.sky.skyColor while the camera is beneath a cell's anvil or core). No cell above: 0, and the sky light unchanged.

import type { SimContext } from '../../core/context';
import { MAX_STORMS } from '../../core/weatherFields';
import { cellGeometry, makeCellGeometry, type CellGeometry } from './cellGeometry';
import { cameraStormsAt } from './stormSelection';
import {
  STORM_ANVIL_DEPTH_M,
  STORM_ANVIL_SIGMA,
  STORM_CORE_SIGMA,
  STORM_SHADOW_ANVIL_FILL,
  STORM_SHADOW_ANVIL_LIFT_M,
  STORM_SHADOW_ANVIL_R,
  STORM_SHADOW_CORE_FILL,
  STORM_SHADOW_CORE_R,
  STORM_SHADOW_CORE_TOP_M,
} from './stormGlsl';

/** The shadow columns' radial profile at a distance x (in column radii): (1 - x^2)^2, 0 beyond 1. */
export function biweight(x: number): number {
  const v = 1 - x * x;
  return v > 0 ? v * v : 0;
}

/** Vertical optical depth of one cell's core column and anvil above (x, y, z), three.js world (STORM_SHADOW_GLSL). */
export function cellOverheadTau(g: CellGeometry, x: number, y: number, z: number): number {
  const anvilBot = g.top - STORM_ANVIL_DEPTH_M;
  let tau = 0;
  const rc = Math.hypot(x - g.x, z - g.z);
  const coreLen = Math.max(anvilBot + STORM_SHADOW_CORE_TOP_M - Math.max(y, g.base), 0);
  if (g.core > 0 && coreLen > 0) tau += g.core * STORM_CORE_SIGMA * STORM_SHADOW_CORE_FILL * biweight(rc / (STORM_SHADOW_CORE_R * g.radius)) * coreLen;
  const ra = Math.hypot(x - g.anvilX, z - g.anvilZ);
  const anvilLen = Math.max(g.top - Math.max(y, anvilBot + STORM_SHADOW_ANVIL_LIFT_M), 0);
  if (g.anvil > 0 && anvilLen > 0) tau += g.anvil * STORM_ANVIL_SIGMA * STORM_SHADOW_ANVIL_FILL * biweight(ra / (STORM_SHADOW_ANVIL_R * g.anvilRadius)) * anvilLen;
  return tau;
}

const _g = makeCellGeometry();

/** Vertical optical depth of the cells in effect at the camera (cameraStormsAt) above the camera, at ctx.simTime. */
export function stormOverheadTau(ctx: SimContext): number {
  const p = ctx.camera?.position;
  if (!p) return 0;
  const cells = cameraStormsAt(ctx);
  let tau = 0;
  for (let i = 0; i < Math.min(cells.length, MAX_STORMS); i++) tau += cellOverheadTau(cellGeometry(cells[i], ctx.weather, ctx.simTime, _g), p.x, p.y, p.z);
  return tau;
}

/**
 * Factors on the sky light under cloud of vertical optical depth `tau` for a light at cos zenith mu0 (the two-stream
 * slab of the mid-level sheet, render/clouds/cloudModel.ts midTransmission): x the diffuse transmission of the sky
 * light, y the share of the light's normal irradiance x mu0 / pi it adds as diffuse radiance. tau 0: (1, 0).
 */
export function overheadSkyFactors(tau: number, mu0: number, out: { sky: number; light: number }): { sky: number; light: number } {
  if (!(tau > 0)) {
    out.sky = 1;
    out.light = 0;
    return out;
  }
  const m = Math.max(mu0, 0);
  out.sky = Math.min(1, 4 / (4 + 0.45 * tau));
  out.light = m > 0 ? ((m / Math.PI) * Math.max(Math.min(1, (2 + 3 * m) / (4 + 0.45 * tau)) - Math.exp(-tau / Math.max(m, 0.05)), 0)) : 0;
  return out;
}
