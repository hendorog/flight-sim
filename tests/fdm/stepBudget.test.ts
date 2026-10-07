// Absolute CPU budget of the C172S physics step, measured against a fixed reference workload.
//
// A step's cost in microseconds belongs to the machine as much as to the code: the same tree took 145 us a step
// in turbulence on the idle laptop and 230 us once a suspend had left its cores capped at 3 GHz, and a full-core
// suite run adds as much again. The reference unit below is a fixed piece of numeric work of the flight model's
// kind (influence-matrix products over Float64Arrays, small vectors on objects, square roots and trigonometry).
// The replayed flight is timed in quarter-second pieces with one burst of reference work after each, both in
// process CPU time, so the two share the clock speed, the cache and the neighbours of the moment and a
// descheduled thread is not counted; the median round counts. Measured on the laptop: the cost in reference
// units moves by at most 7 % between idle and 32 competing processes (where the microseconds rise by 75-100 %),
// and 1:1 with a slowdown planted in the sub-step. The bounds are the checkpoint-C cost (the same as the
// original tree's) plus 15 %; a much faster or slower machine of another make may need them re-measured.

import { describe, expect, it } from 'vitest';
import { FT, KT } from '../../src/core/math';
import { ELEVATION, at, calmWeather, flatEnvironment, makeRig, resetTo } from './helpers';

/** Reference units per physics step at checkpoint C (= checkpoint P0), median of idle runs. */
const REFERENCE_COST = { air: 4.45, taxi: 8.4 };
const MARGIN = 1.15;

// Twice the wing's lifting line each way: a working set in the second-level cache, as the model's is.
const NT = 96, NS = 80;
const A = new Float64Array(NT * NS), B = new Float64Array(NT * NS), C = new Float64Array(NT * NS);
const gamma = new Float64Array(NS), u = new Float64Array(3 * NT);
for (let k = 0; k < NT * NS; k++) {
  A[k] = Math.sin(k * 0.37);
  B[k] = Math.cos(k * 0.11);
  C[k] = Math.sin(k * 0.05 + 1);
}
for (let j = 0; j < NS; j++) gamma[j] = 0.5 + 0.01 * j;

/** One reference unit (about 53 us on the laptop at 3 GHz); returns a checksum so that nothing is optimised away. */
function referenceUnit(): number {
  let sum = 0;
  for (let rep = 0; rep < 3; rep++) {
    u.fill(0);
    for (let i = 0; i < NT; i++) {
      const row = i * NS;
      let x = 0, y = 0, z = 0;
      for (let j = 0; j < NS; j++) {
        const g = gamma[j];
        x += A[row + j] * g;
        y += B[row + j] * g;
        z += C[row + j] * g;
      }
      u[3 * i] += x;
      u[3 * i + 1] += y;
      u[3 * i + 2] += z;
    }
    const v = { x: 1, y: 0.2, z: -0.1 }, w = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < NT; i++) {
      const vx = u[3 * i] + v.x, vy = u[3 * i + 1] + v.y, vz = u[3 * i + 2] + v.z;
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const alpha = Math.atan2(vz, vx);
      const cl = alpha < 0.25 ? 6 * alpha : Math.sin(2 * alpha) * Math.exp(-alpha);
      w.x += cl * speed * Math.cos(alpha);
      w.y += vy * Math.abs(cl);
      w.z -= cl * speed * Math.sin(alpha);
    }
    sum += w.x + w.y + w.z;
  }
  return sum;
}

const proc = (globalThis as unknown as { process: { cpuUsage(): { user: number; system: number } } }).process;
/** Process CPU time, ms. */
const cpuMs = (): number => {
  const c = proc.cpuUsage();
  return (c.user + c.system) / 1000;
};

describe('CPU budget', () => {
  it('a C172S physics step costs at most 15 % more reference work than at checkpoint C', () => {
    // The original cost scenarios: 15 kt of wind with turbulence 0.5 in the cruise at 2000 ft, and taxiing at
    // throttle 0.4. Every round replays the same flight from the same reset (the model is deterministic).
    const gusty = () => makeRig({ env: flatEnvironment(calmWeather({ windSpeedKt: 15, turbulence: 0.5 })) });
    const air = gusty(), taxi = gusty();
    const startAir = (): void => resetTo(air, { position: at(ELEVATION + 2000 * FT), airspeed: 100 * KT });
    const startTaxi = (): void => {
      resetTo(taxi, { onGround: true });
      taxi.controls.parkingBrake = false;
      taxi.controls.throttle = 0.4;
    };
    const SECONDS = 2, PIECE = 0.25, UNITS = 4;
    let check = 0;
    /** One round: [reference units per step, us per step]. */
    const round = (rig: typeof air, start: () => void): [number, number] => {
      start();
      let steps = 0, reference = 0;
      for (let piece = 0; piece < SECONDS / PIECE; piece++) {
        const c0 = cpuMs();
        rig.run(PIECE);
        const c1 = cpuMs();
        for (let k = 0; k < UNITS; k++) check += referenceUnit();
        steps += c1 - c0;
        reference += cpuMs() - c1;
      }
      const n = SECONDS * rig.fm.physicsRate;
      return [steps / n / (reference / ((SECONDS / PIECE) * UNITS)), (steps * 1000) / n];
    };
    round(air, startAir);
    round(taxi, startTaxi);
    const ra: [number, number][] = [], rt: [number, number][] = [];
    for (let i = 0; i < 9; i++) {
      ra.push(round(air, startAir));
      rt.push(round(taxi, startTaxi));
    }
    const median = (r: [number, number][], k: 0 | 1): number => r.map((x) => x[k]).sort((p, q) => p - q)[r.length >> 1];
    const air_ = median(ra, 0), taxi_ = median(rt, 0);
    console.log(
      `[cost] reference units per physics step (bound ${MARGIN} x checkpoint C): in turbulence ${air_.toFixed(2)} ` +
        `(${REFERENCE_COST.air}), taxiing ${taxi_.toFixed(2)} (${REFERENCE_COST.taxi}); CPU ${median(ra, 1).toFixed(0)} and ` +
        `${median(rt, 1).toFixed(0)} us${Number.isFinite(check) ? '' : ' (reference diverged)'}`,
    );
    expect(air_).toBeLessThan(REFERENCE_COST.air * MARGIN);
    expect(taxi_).toBeLessThan(REFERENCE_COST.taxi * MARGIN);
  }, 120000);
});
