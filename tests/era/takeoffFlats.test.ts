// The Flats (Deep Time WP3): the Cretaceous era has no airport, so the flat airport zone is bare 'dirt' and the
// wheels feel the terrain, not pavement. The same C172S take-off roll is longer than on the runway, but not
// absurdly so; the present day is unchanged; the safari start is high above the ground.

import { afterEach, describe, expect, it } from 'vitest';
import { defaultWeather } from '../../src/core/types';
import { AIRPORT, runwayCoords } from '../../src/core/world';
import { buildScenario } from '../../src/sim/scenarios';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { worldTerrain } from '../../src/sim/worldEnvironment';
import { LINE_UP } from '../../src/world/airport/layout';
import { setEra } from '../../src/world/era/eraState';
import { terrainHeight } from '../../src/world/terrain/heightfield';

afterEach(() => setEra('present'));

/** Autoflight take-off from the line-up: distance rolled to the first lift-off of every wheel, and the outcome. */
function roll(): { roll: number; airborne: boolean; crashed: boolean; surfaces: Set<string>; maxAlt: number } {
  const p = new SimPhysics({ weather: defaultWeather() });
  p.autoflightOnReset = true;
  p.reset('runway');
  const s = p.state;
  const start = { x: s.position.x, y: s.position.y };
  const surfaces = new Set<string>();
  let rolled = NaN;
  for (let t = 0; t < 90 && !s.crashed; t += 0.1) {
    p.step(0.1);
    if (!s.wheels.every((w) => !w.onGround)) surfaces.add(worldTerrain.surface(s.position.x, s.position.y));
    if (Number.isNaN(rolled) && s.wheels.every((w) => !w.onGround)) rolled = Math.hypot(s.position.x - start.x, s.position.y - start.y);
  }
  return { roll: rolled, airborne: !Number.isNaN(rolled), crashed: s.crashed, surfaces, maxAlt: s.altitudeMSL };
}

describe('the Flats', () => {
  it('has dirt under the line-up and no pavement lift', () => {
    const p = LINE_UP.find((l) => l.runway === '07')!;
    expect(worldTerrain.surface(p.north, p.east)).toBe('runway');
    setEra('cretaceous');
    expect(worldTerrain.surface(p.north, p.east)).toBe('dirt');
    expect(worldTerrain.height(p.north, p.east)).toBe(terrainHeight(p.north, p.east));
    expect(worldTerrain.height(p.north, p.east)).toBeCloseTo(AIRPORT.elevation, 6);
    // Away from the Flats the usual surfaces remain (the river is water).
    expect(worldTerrain.surface(-2375, 2293)).toBe('water');
  });

  it('take-off roll on dirt is 5-40% longer than on the runway, with no crash', () => {
    const present = roll();
    expect(present.airborne).toBe(true);
    expect(present.surfaces.has('runway')).toBe(true);
    setEra('cretaceous');
    const flats = roll();
    expect(flats.crashed).toBe(false);
    expect(flats.airborne).toBe(true);
    expect([...flats.surfaces]).toEqual(['dirt']);
    expect(flats.roll).toBeGreaterThan(present.roll * 1.05);
    expect(flats.roll).toBeLessThan(present.roll * 1.4);
  }, 120000);

  it('safari starts airborne, well above the ground, over the river valley', () => {
    setEra('cretaceous');
    const env = new SimPhysics({ weather: defaultWeather() }).env;
    const sc = buildScenario('safari', env);
    expect(sc.id).toBe('safari');
    const { x, y, z } = sc.ic.position;
    expect(sc.ic.onGround).toBe(false);
    // SAFARI.aglFt (450 ft, cretaceousAnchors.ts) above the ground.
    expect(-z - terrainHeight(x, y)).toBeGreaterThan(130);
    const rc = runwayCoords(x, y);
    expect(rc.along).toBeGreaterThan(4000);
    expect(Math.abs(rc.across - 3000)).toBeLessThan(500);
  });

  it('safari flies 30 s on autoflight without a crash', () => {
    setEra('cretaceous');
    const p = new SimPhysics({ weather: defaultWeather() });
    p.autoflightOnReset = true;
    p.reset('safari');
    p.step(30);
    expect(p.state.crashed).toBe(false);
    // The hold keeps the start altitude (450 ft above the start's ground); the valley floor stays below it.
    expect(p.state.altitudeMSL - terrainHeight(p.state.position.x, p.state.position.y)).toBeGreaterThan(120);
  }, 60000);
});
