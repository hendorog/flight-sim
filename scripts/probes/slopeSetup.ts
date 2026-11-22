// Probes (foundation stage 4): SLOPE_PARAMS (JSON) sets the threshold-hillslope pass's settings (hillslopes.ts) before
// any world is built, for every probe.
import { setSlopeParams } from '../../src/world/terrain/hillslopes';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
if (env.SLOPE_PARAMS) setSlopeParams(JSON.parse(env.SLOPE_PARAMS));
// Foundation stage 3: STRUCT_PARAMS (JSON) sets the mountains' structure (structure.ts) the same way.
import { setStructParams } from '../../src/world/terrain/structure';
if (env.STRUCT_PARAMS) setStructParams(JSON.parse(env.STRUCT_PARAMS));
import { setCourseTaper } from '../../src/world/terrain/erosion';
if (env.COURSE_TAPER) setCourseTaper(Number(env.COURSE_TAPER));
