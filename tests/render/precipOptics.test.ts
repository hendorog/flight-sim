// The pure geometry and tables of the precipitation streaks (src/render/weather/precipOptics.ts) and the
// precipitation extinction they sit beside (src/core/weatherFields.ts precipExtinctionPerM).

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { precipExtinctionPerM } from '../../src/core/weatherFields';
import {
  CELL_ANGLE,
  FALL_SPEED_MS,
  PHI_CELLS,
  PSI_TILE,
  RATE_COUNT_SCALE,
  RATE_FULL_MMH,
  SHELL_RADII_M,
  SLOTS_PER_DROP,
  SNOW_STREAK_EXPOSURE_S,
  STREAK_EXPOSURE_S,
  STREAK_MAX_M,
  MAX_DROPS_PER_CELL,
  MAX_DROP_WEIGHT,
  dropProbability,
  dropSlots,
  dropWeight,
  dropsPerCell,
  fallSpeed,
  psiScale,
  psiOf,
  relativeVelocity,
  shellPhase,
  streakAxis,
  streakLengthM,
  transportReference,
} from '../../src/render/weather/precipOptics';
import { MAX_SHELLS, PRECIP_LOOK } from '../../src/render/weather/PrecipOverlay';

describe('precipitation tables', () => {
  it('fall speeds: rain 7, drizzle 2.5, snow 1, none 0 m/s', () => {
    expect(FALL_SPEED_MS).toEqual({ none: 0, rain: 7, drizzle: 2.5, snow: 1 });
    expect(fallSpeed('rain')).toBe(7);
    expect(fallSpeed('none')).toBe(0);
  });

  it('extinction: the power-law fits, 1/m, 0 for none or rate 0', () => {
    expect(precipExtinctionPerM('rain', 1)).toBeCloseTo(0.25e-3, 12);
    expect(precipExtinctionPerM('rain', 10)).toBeCloseTo((0.25 * 10 ** 0.63) / 1000, 12);
    expect(precipExtinctionPerM('drizzle', 4)).toBeCloseTo((1.5 * 2) / 1000, 12);
    expect(precipExtinctionPerM('snow', 2)).toBeCloseTo((1.3 * 2 ** 0.8) / 1000, 12);
    expect(precipExtinctionPerM('none', 10)).toBe(0);
    expect(precipExtinctionPerM('rain', 0)).toBe(0);
  });

  it('shells: ascending radii, none on low, at most the shader array length', () => {
    expect(SHELL_RADII_M.low).toEqual([]);
    expect(SHELL_RADII_M.medium).toEqual([2, 6, 20]);
    expect(SHELL_RADII_M.high).toEqual([2, 5, 12, 30]);
    for (const radii of Object.values(SHELL_RADII_M)) {
      expect(radii.length).toBeLessThanOrEqual(MAX_SHELLS);
      for (let i = 1; i < radii.length; i++) expect(radii[i]).toBeGreaterThan(radii[i - 1]);
    }
    expect(RATE_FULL_MMH.length).toBeGreaterThanOrEqual(MAX_SHELLS);
  });

  it('every precipitation type but none has a look', () => {
    expect(Object.keys(PRECIP_LOOK).sort()).toEqual(['drizzle', 'rain', 'snow']);
  });
});

describe('streak geometry', () => {
  it('relative velocity: wind minus camera velocity plus the fall', () => {
    const out = { x: 0, y: 0, z: 0 };
    expect(relativeVelocity({ x: 3, y: 0, z: -2 }, { x: 0, y: 0, z: -50 }, 7, out)).toEqual({ x: 3, y: -7, z: 48 });
  });

  it('streak length: the motion in one 60 Hz frame, at most 3 m', () => {
    expect(STREAK_EXPOSURE_S).toBeCloseTo(1 / 60, 12);
    expect(streakLengthM(7)).toBeCloseTo(7 / 60, 12);
    expect(streakLengthM(1000)).toBe(STREAK_MAX_M);
    expect(streakLengthM(-1)).toBe(0);
  });

  it('snow streaks over SNOW_STREAK_EXPOSURE_S: a round flake in a 6 kt wind, a streak at 100 kt', () => {
    expect(SNOW_STREAK_EXPOSURE_S).toBeLessThan(STREAK_EXPOSURE_S);
    // Parked in 6 kt (3.1 m/s) of wind with 1 m/s of fall: 4 mm of motion, under the mean flake (7 mm).
    expect(streakLengthM(Math.hypot(3.1, 1), 'snow')).toBeLessThan(0.0045);
    // 100 kt: 6.4 cm.
    expect(streakLengthM(51.4, 'snow')).toBeCloseTo(51.4 * SNOW_STREAK_EXPOSURE_S, 12);
    expect(streakLengthM(51.4, 'snow')).toBeGreaterThan(0.06);
    expect(streakLengthM(7, 'drizzle')).toBe(streakLengthM(7));
  });

  it('for a stationary camera in still air a raindrop streak points down the screen', () => {
    const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
    cam.position.set(100, 2, -40);
    cam.lookAt(150, 2, -90);
    cam.updateMatrixWorld();
    const v = relativeVelocity({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, fallSpeed('rain'), { x: 0, y: 0, z: 0 });
    const [x, y] = streakAxis(v, cam.matrixWorldInverse.elements);
    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeCloseTo(-1, 9);
    // Rolled 90 degrees right (the camera's right axis now points down), the fall runs to the screen's right.
    cam.rotateZ(-Math.PI / 2);
    cam.updateMatrixWorld();
    const [x2, y2] = streakAxis(v, cam.matrixWorldInverse.elements);
    expect(x2).toBeCloseTo(1, 9);
    expect(y2).toBeCloseTo(0, 9);
  });

  it('a streak along the view axis has no screen direction', () => {
    const cam = new THREE.PerspectiveCamera();
    cam.lookAt(0, 0, -1);
    cam.updateMatrixWorld();
    expect(streakAxis({ x: 0, y: 0, z: 5 }, cam.matrixWorldInverse.elements)).toEqual([0, 0]);
  });

  it('psi moves at the same rate -|v| / R for every direction (the grid scrolls uniformly)', () => {
    const R = 5, speed = 12, dt = 1e-4;
    const a = new THREE.Vector3(0.3, -0.8, 0.52).normalize();
    for (const theta of [0.3, 0.9, 1.57, 2.2, 2.8]) {
      // A drop on the shell at angle theta from the motion axis, moving at speed along it.
      const perp = new THREE.Vector3(1, 0, 0).sub(a.clone().multiplyScalar(a.x)).normalize();
      const p0 = a.clone().multiplyScalar(Math.cos(theta)).add(perp.clone().multiplyScalar(Math.sin(theta))).multiplyScalar(R);
      const p1 = p0.clone().addScaledVector(a, speed * dt);
      // Its direction from the camera after dt (it leaves the shell by a second-order amount).
      const c0 = p0.clone().normalize().dot(a), c1 = p1.clone().normalize().dot(a);
      const rate = (psiOf(c1) - psiOf(c0)) / dt;
      expect(rate).toBeCloseTo(-speed / R, 3);
    }
  });

  it('psi cells hold the streak: a power of 2 of CELL_ANGLE at least the streak plus 0.3 cells', () => {
    expect(psiScale(0, 2)).toBe(1);
    for (const [L, R] of [[0.12, 2], [0.83, 2], [3, 2], [3, 30], [0.5, 12]] as const) {
      const scale = psiScale(L, R);
      expect(Math.log2(scale) % 1).toBe(0);
      expect(CELL_ANGLE * scale).toBeGreaterThanOrEqual(L / R + 0.3 * CELL_ANGLE - 1e-12);
      if (scale > 1) expect((CELL_ANGLE * scale) / 2).toBeLessThan(L / R + 0.3 * CELL_ANGLE);
    }
  });

  it('the grid closes around phi and spans psi without repeating', () => {
    expect(PHI_CELLS).toBe(Math.round((2 * Math.PI) / CELL_ANGLE));
    expect(PHI_CELLS).toBe(126);
    // |psi| <= 5.3 at the clamp: 10.6 / CELL_ANGLE cells is fewer than one tile.
    expect(Math.abs(psiOf(1))).toBeLessThan(5.3);
    expect((2 * Math.abs(psiOf(1))) / CELL_ANGLE).toBeLessThan(PSI_TILE);
  });

  it('drops per cell: rate over the full rate, times the cell length', () => {
    expect(dropsPerCell(0, 0, 1)).toBe(0);
    expect(dropsPerCell(RATE_FULL_MMH[0] / 4, 0, 1)).toBeCloseTo(0.25, 12);
    expect(dropsPerCell(RATE_FULL_MMH[0] / 4, 0, 2)).toBeCloseTo(0.5, 12);
    expect(dropsPerCell(1, 9, 1)).toBeCloseTo(1 / RATE_FULL_MMH[RATE_FULL_MMH.length - 1], 12);
    // Snow counts RATE_COUNT_SCALE.snow flakes per drop of the same water rate; none counts nothing.
    expect(dropsPerCell(1, 0, 1, 'snow')).toBeCloseTo(RATE_COUNT_SCALE.snow / RATE_FULL_MMH[0], 12);
    expect(dropsPerCell(10, 0, 1, 'none')).toBe(0);
  });

  it('drop slots: one per CELL_ANGLE of cell length and SLOTS_PER_DROP per mean drop, at most MAX_DROPS_PER_CELL', () => {
    expect(dropSlots(1)).toBe(1);
    expect(dropSlots(2)).toBe(2);
    expect(dropSlots(16)).toBe(MAX_DROPS_PER_CELL);
    expect(SLOTS_PER_DROP).toBe(3);
    expect(dropSlots(1, 0.2)).toBe(1);
    expect(dropSlots(1, 0.5)).toBe(2);
    expect(dropSlots(1, 1)).toBe(3);
    expect(dropSlots(2, 0.5)).toBe(2);
    expect(dropSlots(1, 10)).toBe(MAX_DROPS_PER_CELL);
    // Snow at 2 mm/h on the 2 m shell, parked (a cell of 1 CELL_ANGLE): a mean of 1.67 flakes in 4 slots, so a cell
    // holds 0 to 4 flakes.
    const perCell = dropsPerCell(2, 0, 1, 'snow');
    expect(perCell).toBeCloseTo((2 * RATE_COUNT_SCALE.snow) / RATE_FULL_MMH[0], 12);
    expect(dropSlots(1, perCell)).toBe(MAX_DROPS_PER_CELL);
    expect(dropProbability(2, 0, 1, 'snow')).toBeCloseTo(perCell / MAX_DROPS_PER_CELL, 12);
  });

  it('rain at 25 mm/h fills more slots than at 4 mm/h (parked, the 2 m shell)', () => {
    const slots = (rate: number) => dropSlots(2, dropsPerCell(rate, 0, 2));
    expect(slots(4)).toBe(2);
    expect(slots(25)).toBe(MAX_DROPS_PER_CELL);
    const mean = (rate: number) => slots(rate) * dropProbability(rate, 0, 2) * dropWeight(rate, 0, 2);
    expect(mean(25) / mean(4)).toBeCloseTo(25 / 4, 12);
  });

  it('drop probability and weight: unsaturated, the probability carries the rate; saturated, the weight does', () => {
    expect(dropProbability(RATE_FULL_MMH[0] / 4, 0, 2)).toBeCloseTo(0.25, 12);
    expect(dropWeight(RATE_FULL_MMH[0] / 4, 0, 2)).toBe(1);
    expect(dropProbability(50, 0, 8)).toBe(1);
    expect(dropWeight(50, 0, 8)).toBe(MAX_DROP_WEIGHT);
    expect(dropWeight(10, 9, 1, 'none')).toBe(1);
    // 110 kt (streak 0.94 m) on the 2 m shell: a cell of 16 CELL_ANGLE, 4 slots. The probability x weight (the mean
    // coverage per slot) is proportional to the rate up to MAX_DROP_WEIGHT slots' worth.
    const scale = psiScale(0.94, 2);
    expect(scale).toBe(16);
    const mean = (rate: number) => dropProbability(rate, 0, scale) * dropWeight(rate, 0, scale);
    for (const rate of [0.5, 1, 4, 12]) expect(mean(rate)).toBeCloseTo(dropsPerCell(rate, 0, scale) / MAX_DROPS_PER_CELL, 12);
    expect(mean(25)).toBeGreaterThan(mean(4));
  });

  it('shell phase advances at speed / R and wraps into one tile period', () => {
    const cell = CELL_ANGLE * 2;
    expect(shellPhase(0, 10, 5, 0.5, cell)).toBeCloseTo(1, 12);
    const period = cell * PSI_TILE;
    const p = shellPhase(period - 0.25, 10, 5, 0.5, cell);
    expect(p).toBeCloseTo(0.75, 9);
    expect(shellPhase(0.1, -10, 5, 0.5, cell)).toBeCloseTo(period - 0.9, 9);
  });

  it('the phi reference is carried perpendicular to the axis with the least rotation', () => {
    const u = { x: 1, y: 0, z: 0 };
    const a = new THREE.Vector3(0.1, -1, 0).normalize();
    transportReference(a, u);
    expect(u.x * a.x + u.y * a.y + u.z * a.z).toBeCloseTo(0, 12);
    expect(Math.hypot(u.x, u.y, u.z)).toBeCloseTo(1, 12);
    expect(u.x).toBeGreaterThan(0.99);
    // A reference parallel to the axis is replaced by some perpendicular.
    const v = { x: 0, y: 1, z: 0 };
    transportReference({ x: 0, y: 1, z: 0 }, v);
    expect(Math.abs(v.y)).toBeLessThan(1e-12);
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 12);
  });
});
