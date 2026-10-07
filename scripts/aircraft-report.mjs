#!/usr/bin/env node
// Measured against target for one aircraft type, without the test runner: runs the conformance plan of the type
// (tests/conformance/plan.ts with the targets of tests/conformance/targets/<id>.ts, the same measurements as the
// conformance suite) in node and prints one row per item.
//
//   node scripts/aircraft-report.mjs <id> [--flown] [--block "climb"]
//
//   --flown    also the flown tier (stalls, ground rolls, cruise and the climb table, systems, the engine cut)
//   --block    only the blocks whose name contains this text
//
// The TypeScript is loaded through vite's SSR module loader. Exits 1 when an item fails or a measurement throws,
// 2 when the type has no targets file.

import { createServer } from 'vite';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flown = argv.includes('--flown');
const blockAt = argv.indexOf('--block');
const only = blockAt >= 0 ? argv[blockAt + 1] : undefined;
const id = argv.find((a, i) => !a.startsWith('--') && (blockAt < 0 || i !== blockAt + 1));
if (!id || !/^[a-z0-9]+$/.test(id)) {
  console.error('usage: node scripts/aircraft-report.mjs <id> [--flown] [--block text]');
  process.exit(2);
}
if (!existsSync(`${root}/tests/conformance/targets/${id}.ts`)) {
  console.error(`[aircraft-report] no targets for ${id}: tests/conformance/targets/${id}.ts does not exist`);
  process.exit(2);
}

const server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null } });
let code = 0;
try {
  const plan = await server.ssrLoadModule('/tests/conformance/plan.ts');
  const targetsModule = await server.ssrLoadModule(`/tests/conformance/targets/${id}.ts`);
  const targets = Object.values(targetsModule).find((v) => v && typeof v === 'object' && v.aircraft === id);
  if (!targets) throw new Error(`tests/conformance/targets/${id}.ts exports no ConformanceTargets for ${id}`);
  const { loadAircraft } = await server.ssrLoadModule('/src/aircraft/registry.ts');
  const def = await loadAircraft(id);
  console.log(`${def.name} (${id})${def.placeholder ? ' -- PLACEHOLDER definition' : ''}`);

  const blocks = plan.conformancePlan(targets, () => def).filter((b) => (flown || b.tier === 'quick') && (!only || b.name.includes(only)));
  const rows = [];
  const t0 = performance.now();
  for (const b of blocks) {
    const tb = performance.now();
    for (const r of plan.runBlock(b)) {
      rows.push(r);
      const measured = Number.isNaN(r.measured) ? '' : plan.num(r.measured);
      const mark = r.verdict === 'pass' ? 'ok  ' : r.verdict === 'skip' ? 'SKIP' : r.verdict === 'error' ? 'ERR ' : 'FAIL';
      const what = r.verdict === 'error' ? r.error : r.limit;
      console.log(`${mark} ${r.label.padEnd(72)} ${measured.padStart(10)} ${r.unit.padEnd(7)} ${what}`);
    }
    console.log(`     -- ${b.name} (${b.tier}): ${((performance.now() - tb) / 1000).toFixed(1)} s`);
  }
  const count = (v) => rows.filter((r) => r.verdict === v).length;
  console.log(`[aircraft-report] ${id}: ${count('pass')} passed, ${count('fail')} failed, ${count('skip')} skipped (blocked), ${count('error')} errors; ${blocks.length} blocks${flown ? '' : ' (quick tier; --flown for all)'}; ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  if (count('fail') || count('error')) code = 1;
} catch (e) {
  console.error('[aircraft-report]', e.stack ?? e.message);
  code = 1;
} finally {
  await server.close();
}
process.exit(code);
