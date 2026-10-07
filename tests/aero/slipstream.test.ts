// The propeller slipstream's swirl: its radial distribution from the blade loading, angular-momentum
// conservation along the jet, and how the airframe meets it (fuselage sections, wing roots over the cabin).

import { describe, expect, it } from 'vitest';
import { SlipstreamField } from '../../src/physics/aero/slipstream';
import { Propeller } from '../../src/physics/propulsion/propeller';
import { SWIRL_BINS, sharedPropellerMap } from '../../src/physics/propulsion/propellerMap';
import { PROP_RADIUS } from '../../src/physics/propulsion/bladeGeometry';
import type { Slipstream } from '../../src/physics/interfaces';
import { C172 } from '../../src/core/c172';

const RPM = (2350 * Math.PI) / 30;
const empty = (): Slipstream => ({ origin: { x: 0, y: 0, z: 0 }, radius: 0, inducedVelocity: 0, swirlRate: 0 });

/** Propeller and its slipstream at axial speed V (m/s), full-power shaft speed, sea-level density. */
function propAt(V: number) {
  const prop = new Propeller();
  const loads = { ...prop.evaluate({ x: -V, y: 0, z: 0 }, RPM, 1.225, 340) };
  const ss = prop.slipstream(C172.prop.hub, empty());
  return { loads, ss };
}

describe('swirl distribution (Glauert annulus momentum over the BEMT blade loading)', () => {
  it('is normalised to the shaft torque and grows outboard roughly linearly, not as solid-body rotation', () => {
    const map = sharedPropellerMap();
    const k = new Float64Array(SWIRL_BINS);
    for (const advanceDeg of [3, 10, 15, 20]) {
      map.swirlProfile((advanceDeg * Math.PI) / 180, k);
      let sum = 0;
      for (let j = 0; j < SWIRL_BINS; j++) sum += (k[j] * 2 * ((j + 0.5) / SWIRL_BINS)) / SWIRL_BINS;
      expect(sum).toBeCloseTo(1, 6);
      // The spinner and blade shanks carry no torque; mid-blade carries far more than solid-body rotation gives it.
      expect(k[0]).toBeLessThan(0.05);
      const xi = 0.35;
      expect(k[3]).toBeGreaterThan(2 * 2 * xi * xi);
      expect(k[7]).toBeGreaterThan(k[3]);
    }
  });

  it('carries the shaft torque as angular-momentum flux from the disc to the tail', () => {
    for (const V of [5, 35, 55]) {
      const { loads, ss } = propAt(V);
      const f = new SlipstreamField(PROP_RADIUS, -1.2);
      f.prepare(ss, { x: -V, y: 0, z: 0 });
      const flux = (x: number) => {
        let am = 0;
        const n = 300, rmax = 3;
        for (let i = 0; i < n; i++) {
          const r = ((i + 0.5) / n) * rmax, dr = rmax / n;
          const o = { x: 0, y: 0, z: 0 };
          f.add({ x, y: 0, z: -r }, o, 1); // above the axis the swirl is toward +y
          am += 1.225 * (V - o.x) * o.y * r * 2 * Math.PI * r * dr;
        }
        return am;
      };
      const atWing = flux(0), atTail = flux(-4.6);
      // The uniform axial velocity of the actuator disc and the jet's soft edge put 75-95 % of the torque in it.
      expect(atWing / loads.torque).toBeGreaterThan(0.7);
      expect(atWing / loads.torque).toBeLessThan(1.05);
      expect(Math.abs(atTail / atWing - 1)).toBeLessThan(0.15);
    }
  });

  it('turns the flow at the fin by a few degrees at full power and low speed, more near the jet axis', () => {
    const V = 33;
    const { ss } = propAt(V);
    const f = new SlipstreamField(PROP_RADIUS, -1.2);
    f.prepare(ss, { x: -V, y: 0, z: 0 });
    const angle = (h: number) => {
      const o = { x: 0, y: 0, z: 0 };
      f.add({ x: -4.9, y: 0, z: C172.prop.hub.z - h }, o, 1);
      return (Math.atan2(o.y, V - o.x) * 180) / Math.PI;
    };
    // Torque / (rho A V_jet r): ~5-9 deg at a third of the radius, fading toward the jet's edge.
    expect(angle(0.3)).toBeGreaterThan(4);
    expect(angle(0.3)).toBeLessThan(12);
    expect(angle(0.9)).toBeLessThan(angle(0.3));
    // Near the jet's edge (0.9 m of 0.97) the swirl is ~1 deg. Measured 8.9 / 7.9 / 0.98 deg at 0.3 / 0.6 / 0.9 m
    // since the blade section's zero-lift angle is taken to its flat face (propulsion/airfoil.ts); it was 8.6 / 7.4
    // / 1.08: more torque, carried a little further inboard, so the edge value dips just under 1.
    expect(angle(0.9)).toBeGreaterThan(0.9);
  });
});

describe('deficit tube behind a windmilling propeller', () => {
  // V 40 m/s, u = -3 m/s: momentum theory's far wake runs at V + 2u = 34 m/s in a tube of R sqrt((V + u) / (V + 2u)).
  const V = 40, u = -3;
  const ss: Slipstream = { origin: { x: 0, y: 0, z: 0 }, radius: PROP_RADIUS * Math.sqrt((V + u) / (V + 2 * u)), inducedVelocity: u, swirlRate: 0 };
  const axialAt = (f: SlipstreamField, x: number, r: number) => {
    const out = { x: 0, y: 0, z: 0 };
    f.add({ x, y: r, z: 0 }, out, 1);
    return out.x;
  };
  const wake = new SlipstreamField(PROP_RADIUS, -100);
  wake.prepare(ss, { x: -V, y: 0, z: 0 });
  // The undiminished deficit on the axis 6 m behind the disc (momentum theory's developing increment, no mixing).
  const undiminished = -u * (1 + 6 / Math.hypot(6, PROP_RADIUS));

  // Until the C172S golden update the C172S's field held a deficit tube at the disc radius and never mixed it: the
  // figures it gave are quoted below (4.4 and 0 m/s at 0.9 and 1.0 R, 6 m behind; 0 at 1.0 R, 3 m behind).
  it('expands as momentum theory has it (1.04 R here) instead of holding the disc radius', () => {
    expect(wake.radius).toBeCloseTo(ss.radius, 12);
    expect(wake.radius / PROP_RADIUS).toBeGreaterThan(1.03);
    // Just outside the disc radius, a few radii behind: inside the expanded tube only.
    expect(axialAt(wake, -3, 1.0 * PROP_RADIUS)).toBeGreaterThan(0.5);
  });

  it('mixes out like an excess jet of the same velocity ratio |Vj - V| / (Vj + V) instead of reaching the tail undiminished', () => {
    // The deficit on the axis (the slowing air pushes the axial velocity, -x, toward +x: out.x > 0).
    const near = axialAt(wake, -0.5, 0), tail = axialAt(wake, -6, 0);
    expect(near).toBeGreaterThan(0);
    expect(tail).toBeLessThan(undiminished);
    // The tube is wider: at 0.9 and 1.0 R, 6 m behind the disc (the twin's tailplane), the deficit is 5.8 and 1.1 m/s
    // where a tube held at the disc radius had 4.4 and 0.
    expect(axialAt(wake, -6, 0.9 * PROP_RADIUS)).toBeGreaterThan(1.2 * 4.416);
    expect(axialAt(wake, -6, PROP_RADIUS)).toBeGreaterThan(0.5);
    // An excess jet with the same velocity ratio: Vj = V (1 + l) / (1 - l), l = (V - (V + 2u)) / (2V + 2u).
    const l = -2 * u / (2 * V + 2 * u);
    const ue = (V * (1 + l) / (1 - l) - V) / 2;
    const jet = new SlipstreamField(PROP_RADIUS, -100);
    jet.prepare({ ...ss, radius: PROP_RADIUS * Math.sqrt((V + ue) / (V + 2 * ue)), inducedVelocity: ue }, { x: -V, y: 0, z: 0 });
    const decayJet = -axialAt(jet, -6, 0) / (ue * (1 + 6 / Math.hypot(6, PROP_RADIUS)));
    const decayDeficit = tail / (-u * (1 + 6 / Math.hypot(6, PROP_RADIUS)));
    // At this small velocity ratio (0.08) the shear layer grows 0.15 m in 6 m and has not reached the axis, for the
    // deficit as for the jet: the dead engine's deficit arrives at a twin's tailplane nearly whole either way.
    expect(Math.abs(decayDeficit / decayJet - 1)).toBeLessThan(0.01);
  });

  it('widens only a deficit: a jet that adds momentum is held at the disc radius', () => {
    const wide = 1.1 * PROP_RADIUS;
    const jet = new SlipstreamField(PROP_RADIUS, -1.2), deficit = new SlipstreamField(PROP_RADIUS, -1.2);
    jet.prepare({ ...ss, radius: wide, inducedVelocity: 8, swirlRate: 30 }, { x: -V, y: 0, z: 0 });
    deficit.prepare({ ...ss, radius: wide }, { x: -V, y: 0, z: 0 });
    expect(jet.radius).toBe(PROP_RADIUS);
    expect(deficit.radius).toBeCloseTo(wide, 12);
  });
});
