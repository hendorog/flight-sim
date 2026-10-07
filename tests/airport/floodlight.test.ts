import { describe, expect, it } from 'vitest';
import { createSharedUniforms, floodIlluminance } from '../../src/world/airport/shared';
import { localToWorld } from '../../src/world/airport/lights';
import { FLOODLIGHTS } from '../../src/world/airport/layout';

// Apron floodlighting: pools in front of each mast with darker gaps between them and a fall-off across the apron
// (masts on the building side only), rather than one near-constant term.
describe('apron floodlight pools', () => {
  const u = createSharedUniforms();
  const mastV = FLOODLIGHTS[0].v;
  const us = FLOODLIGHTS.map((f) => f.u);
  const mid = (us[1] + us[2]) / 2; // halfway between two masts
  // Across the apron (+v, away from the masts).
  const E = (uu: number, dv: number) => floodIlluminance(u, localToWorld(uu, mastV + dv, 0));

  it('lights the stands in front of a mast at apron levels (20-60 lux)', () => {
    expect(E(us[2], 10)).toBeGreaterThan(30);
    expect(E(us[2], 10)).toBeLessThan(70);
    expect(E(us[2], 20)).toBeGreaterThan(15);
    expect(E(us[2], 20)).toBeLessThan(40);
  });

  it('leaves darker gaps between the masts (pool / gap at least 3:1)', () => {
    for (const dv of [10, 20]) expect(E(us[2], dv) / E(mid, dv)).toBeGreaterThan(3);
  });

  it('falls off across the apron and keeps some spill at the mast foot', () => {
    expect(E(us[2], 60)).toBeLessThan(E(us[2], 20) / 5);
    expect(E(us[2], 100)).toBeLessThan(1);
    expect(E(us[2], 1)).toBeGreaterThan(2);
  });
});
