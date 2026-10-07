import { describe, expect, it } from 'vitest';
import { airportLights, dayBrightnessStep, LightKind, PAPI_HOUSING } from '../../src/world/airport/lights';
import { BUILDINGS, nedToLocal, pavedSD, PAPIS, RUNWAY_HALF_LENGTH, RUNWAY_HALF_WIDTH } from '../../src/world/airport/layout';
import { threeToNed } from '../../src/core/frames';

const lights = airportLights();
const local = (p: { x: number; y: number; z: number }) => {
  const n = threeToNed(p);
  return nedToLocal(n.x, n.y);
};

describe('airfield lights', () => {
  it('has a full set of runway edge, threshold and PAPI lights', () => {
    const edge = lights.specs.filter((s) => s.kind === undefined && Math.abs(Math.abs(local(s.position).v) - RUNWAY_HALF_WIDTH - 1) < 0.01);
    expect(edge.length).toBe(62);
    const ends = lights.specs.filter((s) => Math.abs(Math.abs(local(s.position).u) - RUNWAY_HALF_LENGTH - 1) < 0.01);
    expect(ends.length).toBe(16);
    const papi = lights.specs.filter((s) => s.kind === LightKind.PapiFacingLowU || s.kind === LightKind.PapiFacingHighU);
    expect(papi.length).toBe(PAPIS.length * 4 * 2);
  });
  it('turns edge lights yellow in the last 600 m seen from each landing direction', () => {
    for (const s of lights.specs.filter((x) => x.kind === undefined && x.colorB)) {
      const { u, v } = local(s.position);
      if (Math.abs(Math.abs(v) - RUNWAY_HALF_WIDTH - 1) > 0.01) continue;
      const yellowFromLow = s.colorA.b < 0.1 && s.colorA.g < 0.6;
      const yellowFromHigh = s.colorB!.b < 0.1 && s.colorB!.g < 0.6;
      expect(yellowFromLow).toBe(u > RUNWAY_HALF_LENGTH - 600);
      expect(yellowFromHigh).toBe(u < -RUNWAY_HALF_LENGTH + 600);
    }
  });
  it('shows green toward the approach and red toward the runway at each threshold', () => {
    for (const s of lights.specs) {
      const { u } = local(s.position);
      if (Math.abs(Math.abs(u) - RUNWAY_HALF_LENGTH - 1) > 0.01) continue;
      const approach = u < 0 ? s.colorA : s.colorB!; // colorA is seen from lower u
      const runway = u < 0 ? s.colorB! : s.colorA;
      expect(approach.g).toBeGreaterThan(0.9);
      expect(runway.r).toBeGreaterThan(0.9);
      expect(runway.g).toBeLessThan(0.05);
    }
  });
  it('keeps blue edge lights off the pavement and out of buildings', () => {
    const blue = lights.specs.filter((s) => s.colorA.b > 0.9 && s.colorA.r < 0.1);
    expect(blue.length).toBeGreaterThan(40);
    for (const s of blue) {
      const { u, v } = local(s.position);
      expect(pavedSD(u, v)).toBeGreaterThan(1);
      expect(BUILDINGS.some((b) => u > b.u0 && u < b.u1 && v > b.v0 && v < b.v1)).toBe(false);
    }
  });
});

describe('airfield light photometry', () => {
  it('specifies every light in candela with a physical lens size', () => {
    for (const s of lights.specs) {
      expect(s.cd).toBeGreaterThan(0);
      expect(s.cdDay).toBeGreaterThanOrEqual(0);
      expect(s.lens).toBeGreaterThan(0.05);
      expect(s.lens).toBeLessThan(1);
    }
  });
  it('uses HIRL intensities: ~10 000 cd white by day, dimmed at night', () => {
    const edge = lights.specs.filter((s) => s.kind === undefined && Math.abs(Math.abs(local(s.position).v) - RUNWAY_HALF_WIDTH - 1) < 0.01);
    const white = edge.filter((s) => s.colorA.b > 0.5);
    expect(Math.max(...white.map((s) => s.cdDay))).toBe(10000);
    for (const s of edge) expect(s.cd).toBeLessThan(s.cdDay);
  });
  it('has a MALSF ahead of runway 07 with sequenced flashers, and REIL on runway 25', () => {
    const approach = lights.specs.filter((s) => local(s.position).u < -RUNWAY_HALF_LENGTH - 10);
    expect(approach.filter((s) => !s.flash).length).toBe(7 * 5 + 6);
    const flashers = approach.filter((s) => s.flash);
    expect(flashers.length).toBe(3);
    // The sequence runs toward the threshold: the outermost flasher fires first.
    const sorted = flashers.slice().sort((a, b) => local(a.position).u - local(b.position).u);
    expect(sorted.map((s) => s.flash!.phase)).toEqual(sorted.map((s) => s.flash!.phase).slice().sort((a, b) => a - b));
    const reil = lights.specs.filter((s) => s.flash && local(s.position).u > RUNWAY_HALF_LENGTH);
    expect(reil.length).toBe(2);
    expect(lights.approachBars.length).toBe(7);
  });
});

describe('PAPI and day brightness steps', () => {
  it('puts every PAPI lamp in front of its housing face, toward the approach', () => {
    for (const papi of PAPIS) {
      const lamps = lights.specs.filter((s) => (papi.facingU < 0 ? s.kind === LightKind.PapiFacingLowU : s.kind === LightKind.PapiFacingHighU));
      expect(lamps.length).toBe(8);
      for (const s of lamps) {
        const { u } = local(s.position);
        // Housing front face at unit.u + facingU * depth / 2; the lamp sits beyond it by the lens protrusion.
        const ahead = (u - papi.units[0].u) * papi.facingU;
        expect(ahead).toBeGreaterThan(PAPI_HOUSING.depth / 2 + 0.03);
        expect(ahead).toBeLessThan(PAPI_HOUSING.depth / 2 + 0.2);
      }
    }
  });
  it('dims runway-class lights by day in good visibility (FAA intensity steps), not the PAPI', () => {
    expect(dayBrightnessStep(800)).toBe(1);
    expect(dayBrightnessStep(2500)).toBe(0.25);
    expect(dayBrightnessStep(60000)).toBe(0.05);
    const papi = lights.specs.filter((s) => s.kind === LightKind.PapiFacingLowU || s.kind === LightKind.PapiFacingHighU);
    expect(papi.every((s) => !s.daySteps)).toBe(true);
    const edge = lights.specs.filter((s) => s.kind === undefined && Math.abs(Math.abs(local(s.position).v) - RUNWAY_HALF_WIDTH - 1) < 0.01);
    expect(edge.every((s) => s.daySteps)).toBe(true);
  });
});
