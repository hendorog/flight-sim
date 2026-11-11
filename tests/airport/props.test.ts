import { describe, expect, it } from 'vitest';
import { parkedPlacements, staticParkedSpots } from '../../src/world/airport/props';

describe('parked aircraft', () => {
  it('park on the spots the AI traffic keeps clear of, as the traffic\'s own types', () => {
    const placed = parkedPlacements();
    expect(placed.length).toBeGreaterThan(3);
    expect(new Set(placed.map((p) => p.spot.name))).toEqual(staticParkedSpots());
    for (const p of placed) expect(['c172s', 'c152', 'pa38', 'da20']).toContain(p.type);
    // A mix, and the same every time.
    expect(new Set(placed.map((p) => p.type)).size).toBeGreaterThan(1);
    expect(parkedPlacements()).toEqual(placed);
  });
});
