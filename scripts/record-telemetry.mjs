// Record the Flight School's telemetry fixtures (docs/instructor-spec.md section 6.4.2): real flights of the
// flight model in node, sampled through the real Telemetry at 30 Hz, written to tests/training/fixtures/*.json
// for the event, grading and coach replay tests (tests/training/fixtures/replay.test.ts).
//
// Usage: node scripts/record-telemetry.mjs [name ...]     (default: every fixture)
//
// The flights live in tests/training/fixtures/record.ts (TypeScript); this script loads that module through
// Vite's SSR loader (no build step, no new dependency) and writes the JSON. The flights are deterministic,
// so recording again reproduces the files byte for byte.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'tests/training/fixtures');
const wanted = process.argv.slice(2);

const server = await createServer({ root, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true } });
try {
  const mod = await server.ssrLoadModule('/tests/training/fixtures/record.ts');
  const makers = {
    circuit: mod.recordCircuit,
    hardLanding: mod.recordHardLanding,
    noseFirst: mod.recordNoseFirst,
    goAround: mod.recordGoAround,
    stall: mod.recordStall,
    steepTurn: mod.recordSteepTurn,
    descentBust: mod.recordDescentBust,
  };
  const names = wanted.length ? wanted : Object.keys(makers);
  mkdirSync(outDir, { recursive: true });
  for (const name of names) {
    const make = makers[name];
    if (!make) {
      console.error(`unknown fixture '${name}' (have: ${Object.keys(makers).join(', ')})`);
      process.exitCode = 1;
      continue;
    }
    const t0 = Date.now();
    const fx = make();
    const file = resolve(outDir, `${name}.json`);
    const json = JSON.stringify(fx);
    writeFileSync(file, json + '\n');
    const secs = fx.t.length ? fx.t[fx.t.length - 1] : 0;
    console.log(`${name}: ${fx.t.length} frames (${secs.toFixed(0)} s flown), ${fx.touchdowns.length} wheel contacts, ${fx.crashes.length} crashes, ${(json.length / 1024).toFixed(0)} kB, recorded in ${Date.now() - t0} ms`);
  }
} finally {
  await server.close();
}
