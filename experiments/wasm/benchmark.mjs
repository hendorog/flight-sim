import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { cpus, platform, arch } from 'node:os';
import { fileURLToPath } from 'node:url';

const trials = Number(process.env.TRIALS ?? 7);
const frames = Number(process.env.FRAMES ?? 360);
assert(Number.isInteger(trials) && trials >= 3);
assert(Number.isInteger(frames) && frames >= 60);
const cases = [['c172s', 'cruise', 1], ['pa34', 'cruise', 1], ['c172s', 'runway', 1], ['c172s', 'cruise', 16]];
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
let maxNormalizedDifference = 0;
function compare(a, b, path = 'state') {
  assert.equal(typeof a, typeof b, path);
  if (typeof a === 'number') {
    assert(Number.isFinite(a) && Number.isFinite(b), path);
    const difference = Math.abs(a - b) / Math.max(1, Math.abs(a), Math.abs(b));
    maxNormalizedDifference = Math.max(maxNormalizedDifference, difference);
    assert(difference <= 1e-8, `${path}: ${a} vs ${b}`);
  } else if (a !== null && typeof a === 'object') {
    assert(b !== null, path);
    assert.deepEqual(Object.keys(a), Object.keys(b), path);
    for (const k of Object.keys(a)) compare(a[k], b[k], `${path}.${k}`);
  } else assert.equal(a, b, path);
}
function run(mode, args) {
  return JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL(`build/flight-${mode}.mjs`, import.meta.url)),
    ...args.map(String), String(frames)], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
}
const results = [];
for (const args of cases) {
  const runs = { js: [], wasm: [] };
  for (let trial = 0; trial < trials; trial++) {
    // Fresh processes avoid module-level state leaking between backends. Alternate
    // execution order to reduce systematic thermal/JIT ordering bias.
    for (const mode of trial % 2 ? ['wasm', 'js'] : ['js', 'wasm']) runs[mode].push(run(mode, args));
    const a = runs.js[trial], b = runs.wasm[trial];
    assert.equal(a.steps, b.steps);
    compare(a.trajectory, b.trajectory);
    for (const r of [a, b]) delete r.trajectory;
    console.error(`${args.join('/')} trial ${trial + 1}/${trials}: JS ${a.totalMs.toFixed(1)} ms, WASM ${b.totalMs.toFixed(1)} ms`);
  }
  const profile = run('profile', args);
  delete profile.trajectory;
  const jsMs = median(runs.js.map(r => r.totalMs));
  const wasmMs = median(runs.wasm.map(r => r.totalMs));
  const result = { case: args, jsMs, wasmMs, speedup: jsMs / wasmMs,
    savedMsPerFrame: (jsMs - wasmMs) / frames,
    approximateLuShare: (profile.profile.factorMs + profile.profile.solveMs) / profile.totalMs,
    profile, runs };
  results.push(result);
  console.error(`  median speedup ${result.speedup.toFixed(3)}x; LU share (instrumented) ${(result.approximateLuShare * 100).toFixed(1)}%`);
}
const report = { generatedAt: new Date().toISOString(), node: process.version,
  platform: platform(), arch: arch(), cpu: cpus()[0]?.model, trials, frames,
  maxNormalizedDifference, results };
writeFileSync(new URL('results.local.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, results: results.map(({ runs, profile, ...r }) => r) }, null, 2));
