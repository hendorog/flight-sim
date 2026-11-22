// Valley channelling (design section 6): below the ridge envelope a valley removes part of the cross-valley wind,
// V_h -= CHANNEL_SHARE c_depth (a n n^T) V_h, with the tensor a n n^T from terrainGrid.ts and
// c_depth = smoothstep(0, 1, (env - z) / max(env - h, 50)) smoothstep(150, 500, env - h): full at the valley floor,
// none at the envelope, and only in valleys at least 150-500 m deep. CHANNEL_SHARE unconfirmed.

import { smoothstep } from '../../../core/math';

const CHANNEL_SHARE = 0.7;
/** Valley depth (envelope - ground) over which channelling sets in, m. */
const DEPTH_LOW = 150;
const DEPTH_FULL = 500;
const MIN_DEPTH = 50;

/** The depth share c_depth for envelope env, ground h and height z (all m MSL). */
export function channelDepth(env: number, h: number, z: number): number {
  const depth = env - h;
  if (!(depth > DEPTH_LOW)) return 0;
  return smoothstep(0, 1, (env - z) / Math.max(depth, MIN_DEPTH)) * smoothstep(DEPTH_LOW, DEPTH_FULL, depth);
}

/** The change of the horizontal wind (vN, vE) from channelling, written into out[0], out[1]. */
export function channelDelta(nn: number, ne: number, ee: number, depthShare: number, vN: number, vE: number, out: Float64Array): Float64Array {
  const c = -CHANNEL_SHARE * depthShare;
  out[0] = c * (nn * vN + ne * vE);
  out[1] = c * (ne * vN + ee * vE);
  return out;
}
