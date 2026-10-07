// Golden master of the C172 aerodynamic model (src/physics/aero AeroModel.compute): forces, moments, flow
// angles, stall state, lift and drag at fixed conditions, pinned in tests/golden/data/c172Aero.json to a
// relative 1e-9 (tests/golden/golden.ts). The conditions are built with the frozen rig's makeInput
// (tests/golden/rigs/aero.ts).
//
// 'steady' uses the quasi-steady model the trim solver uses (every call settles to the solution of its own
// input), a new model per condition; 'marched' uses the time-marched model the flight model flies, whose
// separation, downwash-lag and slipstream-path states carry from call to call.
//
// REGENERATE ONLY DELIBERATELY, after a change that is meant to alter the aerodynamics, and review the diff of
// the JSON:
//   FS_GOLDEN_UPDATE=1 npx vitest run tests/golden/c172Aero.golden.test.ts

import { describe, it } from 'vitest';
import { C172 } from '../../src/core/c172';
import { DEG } from '../../src/core/math';
import { AeroModel } from '../../src/physics/aero';
import type { Slipstream } from '../../src/physics/interfaces';
import { Propeller } from '../../src/physics/propulsion/propeller';
import { makeInput, type Condition } from './rigs/aero';
import { golden, type Recorder } from './golden';

const FILE = 'c172Aero';

/** A uniform-swirl slipstream at the propeller hub, as the aero tests build it. */
const slip = (vi: number): Slipstream => ({ origin: { ...C172.prop.hub }, radius: 0.75, inducedVelocity: vi, swirlRate: 1.2 * vi });

/** The slipstream of the real propeller (with its radial swirl profile) at axial speed V and 2350 rpm, sea level. */
function propellerSlipstream(V: number): Slipstream {
  const prop = new Propeller();
  prop.evaluate({ x: -V, y: 0, z: 0 }, (2350 * Math.PI) / 30, 1.225, 340);
  const ss = prop.slipstream(C172.prop.hub, { origin: { x: 0, y: 0, z: 0 }, radius: 0, inducedVelocity: 0, swirlRate: 0 });
  return { ...ss, origin: { ...ss.origin }, swirlProfile: Float64Array.from(ss.swirlProfile!) };
}

/** The output of one call plus the by-products the flight model reads from the model after it. */
function record(r: Recorder, key: string, model: AeroModel, c: Condition): void {
  r.aero(key, model.compute(makeInput(c)));
  r.put(`${key}/tailplaneAlpha`, model.tailplaneAlpha());
  r.vec(`${key}/propellerInflow`, model.propellerInflow);
}

const STEADY: Record<string, Condition> = {
  cruise: { V: 55, alphaDeg: 2 },
  cruiseHigh: { V: 60, alphaDeg: 1, altitude: 3000 },
  negativeAlpha: { V: 65, alphaDeg: -4 },
  sideslip: { V: 45, alphaDeg: 4, betaDeg: 8 },
  rates: { V: 50, alphaDeg: 3, p: 0.3, q: 0.1, r: -0.2 },
  flaps30: { V: 33, alphaDeg: 5, surfaces: { flaps: 30 * DEG } },
  flaps20ElevatorTrim: { V: 36, alphaDeg: 3, surfaces: { flaps: 20 * DEG, elevator: -10 * DEG, elevatorTrim: 8 * DEG } },
  aileron: { V: 50, alphaDeg: 3, surfaces: { aileronLeft: 15 * DEG, aileronRight: -20 * DEG } },
  rudderInSlip: { V: 40, alphaDeg: 5, betaDeg: -5, surfaces: { rudder: -15 * DEG } },
  groundEffect: { V: 30, alphaDeg: 6, heightAGL: 1.25, surfaces: { flaps: 10 * DEG } },
  nearStall: { V: 26, alphaDeg: 15 },
  stalled: { V: 26, alphaDeg: 19, betaDeg: 3 },
  deepStall: { V: 25, alphaDeg: 35, betaDeg: 10, r: 0.5 },
  aftCg: { V: 55, alphaDeg: 2, cgOffset: { x: -0.2, y: 0.02, z: -0.05 } },
  slipstreamNone: { V: 30, alphaDeg: 8, slipstream: null },
  slipstreamOff: { V: 30, alphaDeg: 8, slipstream: slip(0) },
  slipstreamOn: { V: 30, alphaDeg: 8, slipstream: slip(8) },
  slipstreamOnControls: { V: 30, alphaDeg: 8, slipstream: slip(8), surfaces: { rudder: -10 * DEG, elevator: -10 * DEG, flaps: 10 * DEG } },
  staticFullPower: { V: 2, alphaDeg: 0, heightAGL: 1.25, slipstream: slip(12) },
};

describe('C172 aerodynamics golden master', () => {
  it('quasi-steady model at fixed conditions', () => {
    golden(FILE, 'steady', (r) => {
      // A new model for every condition: a model that has already computed other conditions answers a little
      // differently (the aileron case's lift moves in the fifth digit after two other cases).
      const steady = () => new AeroModel(undefined, { quasiSteady: true });
      for (const [name, c] of Object.entries(STEADY)) record(r, name, steady(), c);
      // The real propeller's slipstream with its radial swirl distribution, in a full-power climb.
      record(r, 'propellerSlipstream', steady(), { V: 38, alphaDeg: 7, slipstream: propellerSlipstream(38) });

      // One model asked for several conditions in turn, as the trim solver uses it: what it carries over is pinned too.
      const shared = steady();
      ['cruise', 'flaps20ElevatorTrim', 'aileron', 'slipstreamOn', 'cruise'].forEach((name, i) => record(r, `shared/${i}.${name}`, shared, STEADY[name]));
    });
  });

  it('time-marched model: settle, step in angle of attack, pitch oscillation through the stall', () => {
    golden(FILE, 'marched', (r) => {
      const dt = 1 / 240;
      const model = new AeroModel();
      // The first call starts from the steady solution; the lag states then march.
      record(r, 'first', model, { V: 50, alphaDeg: 2, dt });
      for (let i = 0; i < 240; i++) model.compute(makeInput({ V: 50, alphaDeg: 2, dt }));
      record(r, 'settled', model, { V: 50, alphaDeg: 2, dt });
      // A stage evaluation (dt = 0) leaves the lags where they are.
      record(r, 'stage', model, { V: 50, alphaDeg: 2.5, q: 0.05 });
      // Step in angle of attack: the tail still sees the old downwash.
      record(r, 'stepFirst', model, { V: 50, alphaDeg: 6, dt });
      for (let i = 0; i < 60; i++) model.compute(makeInput({ V: 50, alphaDeg: 6, dt }));
      record(r, 'stepQuarterSecond', model, { V: 50, alphaDeg: 6, dt });

      // Pitch oscillation through the stall with power on, a little sideslip and some flap: dynamic stall.
      const pitching = new AeroModel();
      const ss = propellerSlipstream(30);
      for (let i = 0; i <= 480; i++) {
        const t = i * dt;
        const c: Condition = {
          V: 30,
          alphaDeg: 13 + 6 * Math.sin(2 * Math.PI * t),
          betaDeg: 2,
          q: 6 * DEG * 2 * Math.PI * Math.cos(2 * Math.PI * t),
          surfaces: { flaps: 10 * DEG },
          slipstream: ss,
          dt,
        };
        if (i % 60 === 0) record(r, `oscillation/step${String(i).padStart(3, '0')}`, pitching, c);
        else pitching.compute(makeInput(c));
      }

      // Near the ground with a rolling and yawing motion.
      const low = new AeroModel();
      const flare: Condition = { V: 28, alphaDeg: 9, p: 0.2, r: 0.1, heightAGL: 2, surfaces: { flaps: 30 * DEG }, dt };
      for (let i = 0; i < 120; i++) low.compute(makeInput(flare));
      record(r, 'lowAndSlow', low, flare);
    });
  });
});
