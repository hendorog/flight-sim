// Solo agent brains by species (Deep Time inc 2, WP0b contract, FROZEN for WP1-WP7). FaunaSystem spawns a 'solo'
// showcase entry with BRAINS[species] (or WANDER_BRAIN when a species has none). Each brain lives in its species'
// file species/<id>.brain.ts under a fixed export name; this registry only wires them.

import type { AgentContext, SoloAgentPool, SoloBrain } from './agents';
import { AGENT_MEM } from './agents';
import { cellRandom } from './habitat';
import type { FaunaSpeciesId } from './types';
import { TYRANNOSAURUS_BRAIN } from './species/tyrannosaurus.brain';

/** A generic idle wander about the spawn point on a 40 m leash, at the species' walk speed. */
export const WANDER_BRAIN: SoloBrain = {
  init(pool: SoloAgentPool, i: number): void {
    pool.setState(i, 0);
  },
  step(pool: SoloAgentPool, i: number, ctx: AgentContext): void {
    const m = i * AGENT_MEM;
    const k = Math.floor(pool.stateT[i]);
    if (pool.state[i] === 0) {
      pool.wantSpeed[i] = 0;
      if (ctx.time - pool.stateT[i] > 5 + 8 * cellRandom(pool.seed[i], 0x3a1, k)) {
        const a = 2 * Math.PI * cellRandom(pool.seed[i], 0x3a2, k);
        const r = 40 * Math.sqrt(cellRandom(pool.seed[i], 0x3a3, k));
        pool.mem[m] = pool.homeN[i] + r * Math.cos(a);
        pool.mem[m + 1] = pool.homeE[i] + r * Math.sin(a);
        pool.setState(i, 1);
      }
    } else {
      const dn = pool.mem[m] - pool.n[i];
      const de = pool.mem[m + 1] - pool.e[i];
      pool.wantYaw[i] = Math.atan2(de, dn);
      pool.wantSpeed[i] = 1;
      if (dn * dn + de * de < 9 || ctx.time - pool.stateT[i] > 60) pool.setState(i, 0);
    }
  },
};

export const BRAINS: Readonly<Partial<Record<FaunaSpeciesId, SoloBrain>>> = Object.freeze({
  tyrannosaurus: TYRANNOSAURUS_BRAIN,
});

/** The brain of a species' solo agents. */
export function brainFor(id: FaunaSpeciesId): SoloBrain {
  return BRAINS[id] ?? WANDER_BRAIN;
}
