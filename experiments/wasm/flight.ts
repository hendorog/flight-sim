import assert from 'node:assert/strict';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { defaultWeather } from '../../src/core/types';
import { loadAircraft } from '../../src/aircraft/registry';
import { counters, resetCounters } from './profile';

declare const BENCH_MODE: string;
const [aircraft = 'c172s', scenario = 'cruise', scaleText = '1', framesText = '360'] = process.argv.slice(2);
const scale = Number(scaleText), frames = Number(framesText);
assert([1, 16].includes(scale));
assert(Number.isInteger(frames) && frames >= 60);
const definition = await loadAircraft(aircraft as any);
const weather = { ...defaultWeather(), turbulence: 0.5 };
const start = performance.now();
const sim = new SimPhysics({ weather, aircraft: definition });
sim.autoflightOnReset = scenario !== 'runway';
sim.reset(scenario as any);
const startupMs = performance.now() - start;
// JIT warm-up is outside the timed region; reset for the same flight in each mode.
for (let frame = 0; frame < 240; frame++) sim.advance(scale / 60, scale);
sim.reset(scenario as any);
if (BENCH_MODE === 'profile') resetCounters();
let steps = 0;
const samples: number[] = [];
const trajectory: unknown[] = [];
for (let frame = 0; frame < frames; frame++) {
  const t = performance.now();
  // Unlimited budget measures the work due, without hiding slower execution by
  // dropping simulation time. The application's actual 16x coarse rate is used.
  steps += sim.advance(scale / 60, scale);
  samples.push(performance.now() - t);
  if (frame % 60 === 59) {
    assert(!sim.state.crashed, 'benchmark flight crashed');
    trajectory.push(JSON.parse(JSON.stringify(sim.state)));
  }
}
const totalMs = samples.reduce((a, b) => a + b, 0);
const sorted = [...samples].sort((a, b) => a - b);
console.log(JSON.stringify({ mode: BENCH_MODE, aircraft, scenario, scale, frames,
  startupMs, totalMs, steps, msPerStep: totalMs / steps, msPerFrame: totalMs / frames,
  p95FrameMs: sorted[Math.floor(0.95 * sorted.length)], simulatedSeconds: sim.state.time,
  profile: BENCH_MODE === 'profile' ? counters : undefined, trajectory }));
