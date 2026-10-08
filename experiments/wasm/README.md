# WebAssembly evaluation

This is a standalone, opt-in experiment on `perf/wasm-evaluation`, based on
`4d222a273036c7bc358427506acbdd0c77c50366`. The application continues to use the
original TypeScript physics. No application dependency or source file changes are
needed to run this experiment, and no WASM is included in the production build.

## Question and scope

Would moving the lifting-line solver's dense LU factorisation and back substitution
to WebAssembly measurably reduce **complete physics stepping time**?

The port preserves double precision, operation ordering, the `1e-12` singularity
threshold, and the existing LINPACK-style pivot convention. An AssemblyScript
compiler produces a small module with a fixed 64 KiB memory. A reusable scratch
arena accepts systems up to 64 unknowns. The adapter copies matrices and right-hand
sides in and results out: those copies and the JS/WASM calls are timed. It preserves
the existing TypeScript array ownership, including factorisation reuse. There is
no fast-math, SIMD, threading, or production feature flag in this experiment.

`build.mjs` bundles the same `SimPhysics` entry three ways:

- `js`: original source and uninstrumented LU routines.
- `wasm`: a build-time alias substitutes the experimental LU adapter.
- `profile`: original LU routines wrapped with timers and call counters.

The independent Gaussian elimination routine used during trim remains JavaScript.
This experiment does not port section aerodynamics, wake calculations, the full
Newton iteration, rigid-body integration, terrain, or graphics.

## Reproduce

Use Node 22 or newer, with npm. From the repository root:

```sh
npm ci
npm ci --prefix experiments/wasm
npm run bench --prefix experiments/wasm
```

The experiment's compiler and bundler versions are pinned in its own lockfile.
Generated bundles and the WASM binary are in the ignored `build/` directory.
`npm run test --prefix experiments/wasm` builds and runs just the numerical checks.
The benchmark saves raw samples and machine details in `results.local.json`.
For longer runs:

```sh
TRIALS=11 FRAMES=1200 npm run bench --prefix experiments/wasm
```

Each backend runs in a fresh Node process. Execution order alternates between
trials. Each process constructs and trims its aircraft, warms up with 240 calls
to `advance` at the selected time scale, resets, then times 360 further calls.
Both backends use the same weather, controls, aircraft and scenario. Turbulence
is set to 0.5. Cruise uses autoflight; the runway case does not. No rendering or
frame pacing runs. At 1x this measures six simulated seconds; at 16x it measures
96 seconds with the application's existing coarse airborne physics rate.

The CPU budget is unlimited so a slower backend cannot hide its cost by dropping
simulation time. Totals include per-frame physics, controls, world queries and
state interpolation. State serialization and comparisons are outside the timed
regions. Reported construction/reset time excludes module import and WASM
instantiation and is not an end-to-end loading benchmark.

Seven timing trials per backend are summarized by their median. The additional
profile run estimates LU's share, but its per-call timers perturb the workload;
use it as a rough diagnostic, not a precise attribution of the uninstrumented
time. No other builds or tests were run concurrently with the recorded benchmark.

## Correctness

The numerical checks cover 221 systems of sizes 1 through 64, forced pivoting,
the repository's regression for a row interchange after the first column, reuse
with a second right-hand side, singular and NaN inputs, and the adapter's bounds.
Results are checked against the original LU and independent Gaussian elimination,
with normalized residual checks.

During A/B flights, the harness compares the complete serialized aircraft state
every 60 frames. It checks identical step counts, no crashes, matching discrete
values, and a maximum normalized numeric difference of `1e-8`. These finite test
flights do not establish equivalence in all stalls, landings, aircraft types or
browsers. A production port would also need the existing aero, flight-model,
gear, trim and time-acceleration regression suites against both implementations.

## Interpretation

This measures CPU physics in Node/V8 on a cloud machine. It does not measure
browser FPS, GPU performance, terrain streaming, loading, battery use or mobile
performance. The README's previously recorded GPU times and physics-step times
are from different hardware and must not be combined with these results to
predict a frame rate.

The simulator already uses typed arrays, cached section constants and reused
Jacobian factorisations. A tiny numerical port can be fast in isolation yet save
little overall time. A future larger aerodynamic port could retain state in WASM
memory and reduce copies, but it would move much more code and require broader
numerical validation. These results alone cannot predict that port's speedup.

## Recorded results and decision

Recorded on 2026-10-08: Node v24.19.0, Linux x64, Intel Xeon Platinum 8573C.
The generated WASM module is 785 bytes. Raw trials, timings, call counts and
matrix sizes are in [results.json](results.json).

| Workload | JS physics ms/frame | WASM physics ms/frame | Throughput ratio (JS time / WASM time) | Approximate LU share |
| --- | ---: | ---: | ---: | ---: |
| C172S cruise, 1x | 1.181 | 1.180 | 1.001x | 4.4% |
| PA34 cruise, 1x | 1.347 | 1.359 | 0.991x | 4.4% |
| C172S runway, 1x | 1.999 | 1.977 | 1.012x | 2.6% |
| C172S cruise, 16x | 4.880 | 4.742 | 1.029x | 4.6% |

Normal-speed results are mixed and small compared with trial variation. All seven
paired 16x trials favored WASM, but the median-total saving was only 0.138 ms per
requested frame. LU is a small part of the workload: even eliminating its cost
entirely would only remove roughly 3–5% of the instrumented physics time in these
cases. There is no measured browser frame-rate benefit here.

The maximum observed numeric difference across all 168 sampled A/B flight-state
comparisons was zero. All 221 solver systems passed. The unchanged application's
typecheck, production build and existing three LU regression tests also passed.

**Decision: retain this as an evaluation branch; do not adopt the small LU-only
port in the application.** The measured saving is too small to justify another
production compiler, loader and numerical implementation at this point.

If CPU physics limits time acceleration on the actual target device, profile the
complete aerodynamic evaluation next and consider a larger port that owns its
state in WASM memory. If loading is the problem, measure terrain-worker tile
generation and propeller-map construction separately. If GPU time limits FPS,
work on shader cost and rendering quality; this port cannot accelerate those GPU
operations. Require a repeatable end-to-end improvement on target browsers before
integrating any of these candidates.
