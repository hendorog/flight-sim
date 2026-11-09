// Round T repairs: probes (read-only), run from the worktree root with --config out/fs/R/probes/vitest.config.ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  root: fileURLToPath(new URL('../../../..', import.meta.url)),
  test: { include: ['out/fs/R/probes/*.test.ts'], environment: 'node', testTimeout: 0, setupFiles: ['scripts/probes/slopeSetup.ts'] },
});
