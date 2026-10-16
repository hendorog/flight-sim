// Research probes: long simulated flights that print measurements rather than assert.
//   npx vitest run --config scripts/probes/vitest.config.ts [heliHold|apYaw]   (env options at the top of each probe)
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  test: { include: ['scripts/probes/**/*.test.ts'], environment: 'node', testTimeout: 0 },
});
