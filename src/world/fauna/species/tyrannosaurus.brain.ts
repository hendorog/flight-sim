// The T. rex's brain (WP1 owns this file; the export name TYRANNOSAURUS_BRAIN is fixed: brains.ts registers it).
// A SoloBrain (agents.ts): set wants, actions and state per frame from the AgentContext only; no allocation.
//
// WP1 builds, per the plan: LURK at anchors.TREX_LAIR -> STALK (aircraft within 2500 m of the river herd's
// centroid; 1.2 m/s toward the herd edge) -> CHARGE (aircraft within 1100 m, or 7 s into the stalk; never before
// 4 s; up to 8 m/s at the nearest member; ctx.herds.setExternalThreat(ctx.riverHerd, ..., ctx.time + 20,
// THREAT.flee, lead) and the same on any 'face' herd within 300 m) -> ROAR (5 s after the charge starts, a 2.5 s
// stop; flap = roar) -> WANDER back to the lair. Seeded, no kill; head-turn to the aircraft inside 300 m.
//
// WP0b STUB: an idle wander on a 60 m leash about its spawn point (stand 4-10 s, walk to a random point, repeat),
// turning its head toward the aircraft inside 300 m.

import type { AgentContext, SoloAgentPool, SoloBrain } from '../agents';
import { AGENT_MEM } from '../agents';
import { cellRandom } from '../habitat';
import { PROFILES } from '../profiles';

const IDLE = 0;
const WALK = 1;
const LEASH = 60;
const LOOK_RANGE = 300;

const wrapPi = (a: number): number => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));

export const TYRANNOSAURUS_BRAIN: SoloBrain = {
  init(pool: SoloAgentPool, i: number): void {
    pool.setState(i, IDLE);
    pool.wantSpeed[i] = 0;
    pool.turnRate[i] = 0.6;
    pool.accel[i] = 1;
  },
  step(pool: SoloAgentPool, i: number, ctx: AgentContext): void {
    const m = i * AGENT_MEM;
    const seed = pool.seed[i];
    const k = Math.floor(pool.stateT[i]);
    const inState = ctx.time - pool.stateT[i];
    if (pool.state[i] === IDLE) {
      pool.wantSpeed[i] = 0;
      if (inState > 4 + 6 * cellRandom(seed, 0x7e1, k)) {
        const a = 2 * Math.PI * cellRandom(seed, 0x7e2, k);
        const r = LEASH * Math.sqrt(cellRandom(seed, 0x7e3, k));
        pool.mem[m] = pool.homeN[i] + r * Math.cos(a);
        pool.mem[m + 1] = pool.homeE[i] + r * Math.sin(a);
        pool.setState(i, WALK);
      }
    } else {
      const dn = pool.mem[m] - pool.n[i];
      const de = pool.mem[m + 1] - pool.e[i];
      pool.wantYaw[i] = Math.atan2(de, dn);
      pool.wantSpeed[i] = PROFILES.tyrannosaurus.speed.walk;
      if (dn * dn + de * de < 9 || inState > 60) pool.setState(i, IDLE);
    }
    // Head toward the aircraft inside 300 m (body-relative, +right), else back to straight.
    const ac = ctx.aircraft;
    let look = 0;
    if (ac && (ac.n - pool.n[i]) ** 2 + (ac.e - pool.e[i]) ** 2 < LOOK_RANGE * LOOK_RANGE) look = Math.max(-0.9, Math.min(0.9, wrapPi(Math.atan2(ac.e - pool.e[i], ac.n - pool.n[i]) - pool.yaw[i])));
    pool.head[i] += (look - pool.head[i]) * Math.min(1, 2 * ctx.dt);
    pool.flap[i] = 0;
  },
};
