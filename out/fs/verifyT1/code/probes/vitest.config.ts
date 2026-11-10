import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  root: fileURLToPath(new URL('../../../../..', import.meta.url)),
  test: { include: ['out/fs/verifyT1/code/probes/**/*.test.ts'], environment: 'node', testTimeout: 0, setupFiles: ['scripts/probes/slopeSetup.ts'] },
});
