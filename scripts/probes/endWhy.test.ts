// Round V A3r: the stream pass's notes on lines EW_LINES (report.endWhy), and the stream-pass ponds within EW_R m of
// EW_AT. EW_SEED.
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('end why', () => {
  setWorldSeed(Number(env.EW_SEED ?? 42));
  terrainHeight(0, 0);
  const rep = (hydrology as unknown as { streamReport?: { endWhy?: Record<number, string> } }).streamReport;
  for (const l of (env.EW_LINES ?? '').split(',').filter(Boolean).map(Number)) console.log(`EW line ${l}: ${rep?.endWhy?.[l] ?? '(none)'}`);
  setWorldSeed(0);
});
