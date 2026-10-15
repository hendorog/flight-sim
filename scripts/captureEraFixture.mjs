#!/usr/bin/env node
// (Re)write tests/fixtures/eraPresent.json, the present-day world guard of the Deep Time eras
// (tests/era/presentGuard.test.ts holds the code that computes it, so capture and check cannot drift apart).
//
//   node scripts/captureEraFixture.mjs
//
// Run it ONLY on a commit whose present world is the reference (it was first captured on untouched main,
// before any era code). A failing presentGuard means the present world changed: fix the change, do not
// re-capture.

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const r = spawnSync('npx', ['vitest', 'run', 'tests/era/presentGuard.test.ts'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, CAPTURE_ERA_FIXTURE: '1' },
});
if (r.status !== 0) {
  console.error('[captureEraFixture] failed');
  process.exit(r.status ?? 1);
}
console.log('[captureEraFixture] wrote tests/fixtures/eraPresent.json');
