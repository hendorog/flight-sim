// Probes (foundation stage 4): SLOPE_PARAMS (JSON) sets the threshold-hillslope pass's settings (hillslopes.ts) before
// any world is built, for every probe.
import { setSlopeParams } from '../../src/world/terrain/hillslopes';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
if (env.SLOPE_PARAMS) setSlopeParams(JSON.parse(env.SLOPE_PARAMS));
