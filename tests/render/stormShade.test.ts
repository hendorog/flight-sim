// The storm cells' cloud overhead on the CPU (render/weather/stormShade.ts): the vertical optical depth of a cell's
// core column and anvil, 0 beside and above them, and the sky-light factors under it, (1, 0) without cloud.

import { describe, expect, it } from 'vitest';
import { defaultWeather, type StormCell } from '../../src/core/types';
import { cellGeometry, makeCellGeometry } from '../../src/render/weather/cellGeometry';
import { STORM_ANVIL_DEPTH_M, STORM_ANVIL_SIGMA, STORM_CORE_SIGMA, STORM_SHADOW_ANVIL_FILL, STORM_SHADOW_ANVIL_LIFT_M, STORM_SHADOW_CORE_FILL, STORM_SHADOW_CORE_TOP_M } from '../../src/render/weather/stormGlsl';
import { cellOverheadTau, overheadSkyFactors } from '../../src/render/weather/stormShade';

const cell: StormCell = { northM: 0, eastM: 0, radiusM: 3000, topM: 11_000, intensity: 0.8, motionDeg: 0, motionKt: 0 };

describe('cellOverheadTau', () => {
  const w = { ...defaultWeather(), cloudBaseM: 900, windDirectionDeg: 270, windSpeedKt: 0 };
  const g = cellGeometry(cell, w, 0, makeCellGeometry());
  const anvilBot = g.top - STORM_ANVIL_DEPTH_M;

  it('under the core centre: the core column from the base and the anvil', () => {
    const core = STORM_CORE_SIGMA * STORM_SHADOW_CORE_FILL * (anvilBot + STORM_SHADOW_CORE_TOP_M - g.base);
    const anvil = STORM_ANVIL_SIGMA * STORM_SHADOW_ANVIL_FILL * (g.top - anvilBot - STORM_SHADOW_ANVIL_LIFT_M);
    expect(cellOverheadTau(g, g.x, 200, g.z)).toBeCloseTo(core + anvil, 9);
  });

  it('under the anvil beyond the core only the anvil, beyond the anvil nothing, above the top nothing', () => {
    const x = g.x + 0.8 * g.anvilRadius;
    // The biweight profile at 0.8 of the anvil's radius: (1 - 0.8^2)^2.
    const anvil = 0.1296 * STORM_ANVIL_SIGMA * STORM_SHADOW_ANVIL_FILL * (g.top - anvilBot - STORM_SHADOW_ANVIL_LIFT_M);
    expect(cellOverheadTau(g, x, 200, g.z)).toBeCloseTo(anvil, 9);
    expect(cellOverheadTau(g, g.x + 1.01 * g.anvilRadius, 200, g.z)).toBe(0);
    expect(cellOverheadTau(g, g.x, g.top + 10, g.z)).toBe(0);
  });

  it('scales with the core and anvil shares', () => {
    const h = { ...g, core: 0.5, anvil: 0 };
    const core = 0.5 * STORM_CORE_SIGMA * STORM_SHADOW_CORE_FILL * (anvilBot + STORM_SHADOW_CORE_TOP_M - g.base);
    expect(cellOverheadTau(h, g.x, 200, g.z)).toBeCloseTo(core, 9);
  });
});

describe('overheadSkyFactors', () => {
  it('leaves the sky light unchanged without cloud and dims it under an anvil', () => {
    const out = { sky: 0, light: 0 };
    expect(overheadSkyFactors(0, 0.7, out)).toEqual({ sky: 1, light: 0 });
    overheadSkyFactors(40, 0.7, out);
    expect(out.sky).toBeCloseTo(4 / (4 + 18), 12);
    expect(out.light).toBeGreaterThan(0);
    expect(out.light).toBeLessThan(0.7 / Math.PI);
    expect(overheadSkyFactors(40, 0, out).light).toBe(0);
  });
});
