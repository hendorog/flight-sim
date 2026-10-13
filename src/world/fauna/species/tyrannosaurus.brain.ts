// The T. rex's brain (WP1; the export name TYRANNOSAURUS_BRAIN is fixed: brains.ts registers it). A SoloBrain
// (agents.ts): it sets the agent's wants, action channel and state every frame from the AgentContext only; it does
// not allocate and does not read the terrain (the pool's ground snaps take the agent reserve).
//
// THE SCRIPTED BEAT (the safari's first minute; seeded, trigger-based, no kill):
//   LURK    at home (anchors.TREX_LAIR, its spawn), standing in the crouch, facing the river herd.
//   STALK   once the aircraft is within STALK_RANGE (2500 m) of the river herd's centroid (in practice at boot):
//           walks at STALK_SPEED (1.2 m/s) toward the herd's near edge (a seeded aim point along it).
//   CHARGE  once the aircraft is within CHARGE_RANGE (1100 m) of the centroid or STALK_TIMEOUT (7 s) into the
//           stalk, whichever comes first, and never before CHARGE_EARLIEST (4 s) into it: accelerates toward the
//           nearest member at up to the charge speed (PROFILE.speed.run, 8 m/s). At once it sets an ALERT-level
//           external threat on the river herd (heads up and still, toward it); BREAK_COVER_S (3 s) into the charge,
//           when it is in full stride, the FLEE-level threat (ctx.herds.setExternalThreat(..., until charge start
//           + THREAT_S, THREAT.flee, LEAD)), and the same on any 'face' herd within FACE_RANGE (300 m) of the river
//           herd or of itself (they turn on the spot and stand: the Triceratops line). While the threat lasts it is
//           re-sent with the agent's position and velocity whenever it has moved RESEND_M (8 m) (that moves the source; the wave is not
//           restarted and untilT stays fixed). It stops short of the nearest member (no kill).
//   ROAR    ROAR_AFTER (5 s) after the charge starts: a ROAR_S (2.5 s) stop, flap = the roar (jaw open, head up).
//   WANDER  then walks home at the walk speed; LURK again at home. It will not stalk again for REARM_S.
//   Head: turns to the aircraft inside LOOK_RANGE (300 m) in every state; otherwise to its target.
//
// The flee direction: the lair is placed (cretaceousAnchors.ts TREX_LAIR) so that "away from the T. rex" is
// TREX_FLEE_HEADING, 45 deg right of the track: the stampede runs ahead and inward.

import type { AgentContext, SoloAgentPool, SoloBrain } from '../agents';
import { AGENT_MEM } from '../agents';
import { cellRandom } from '../habitat';
import { REACTION_KIND } from '../herds';
import { THREAT } from '../reactions';
import { PROFILE } from './tyrannosaurus.data';

export const TREX_STATE = { lurk: 0, stalk: 1, charge: 2, roar: 3, wander: 4 } as const;

export const TREX_BRAIN = Object.freeze({
  STALK_RANGE: 2500,
  CHARGE_RANGE: 1100,
  STALK_SPEED: 1.2,
  CHARGE_EARLIEST: 4,
  STALK_TIMEOUT: 7,
  BREAK_COVER_S: 3,
  THREAT_S: 20,
  LEAD: 0.5,
  FACE_RANGE: 300,
  ROAR_AFTER: 5,
  ROAR_S: 2.5,
  REARM_S: 90,
  LOOK_RANGE: 300,
  /** It stops this far from the nearest member, m. */
  STOP_SHORT: 25,
  CHARGE_ACCEL: 3,
  /** The threat's source is re-sent once the animal has moved this far from where it was last sent, m (a call per
   * frame would box its double arguments, ~20 B a frame; the herds read it at their 10 Hz brain tick anyway). */
  RESEND_M: 8,
});

const S = TREX_STATE;
const K = TREX_BRAIN;

// mem slots (pool.mem[i * AGENT_MEM + k]); the aim point (stalk) is reused for the last sent source (charge, roar)
const M_AIM_N = 0;
const M_AIM_E = 1;
const M_CHARGE_T = 2;
const M_REARM_T = 3;
const M_THREAT = 4; // 0 none, 1 alert sent, 2 flee sent
const M_VN = 5;
const M_VE = 6;

const wrapPi = (a: number): number => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));


/** Send the threat to the river herd and the face herds near it (level THREAT.alert or THREAT.flee). */
function threaten(pool: SoloAgentPool, i: number, ctx: AgentContext, level: number, until: number): void {
  const m = i * AGENT_MEM;
  const H = ctx.herds;
  const n = pool.n[i];
  const e = pool.e[i];
  const vN = pool.mem[m + M_VN];
  const vE = pool.mem[m + M_VE];
  const rh = ctx.riverHerd;
  if (rh >= 0 && H.active[rh]) H.setExternalThreat(rh, n, e, vN, vE, until, level, K.LEAD);
  if (level < THREAT.flee) return;
  for (let h = 0; h < H.capacity; h++) {
    if (!H.active[h] || h === rh || H.kind[h] !== REACTION_KIND.face) continue;
    const r = H.radius[h] + K.FACE_RANGE;
    let dn = H.cN[h] - n;
    let de = H.cE[h] - e;
    let near = dn * dn + de * de < r * r;
    if (!near && rh >= 0 && H.active[rh]) {
      dn = H.cN[h] - H.cN[rh];
      de = H.cE[h] - H.cE[rh];
      near = dn * dn + de * de < r * r;
    }
    if (near) H.setExternalThreat(h, n, e, vN, vE, until, THREAT.flee, 0);
  }
}

export const TYRANNOSAURUS_BRAIN: SoloBrain = {
  init(pool: SoloAgentPool, i: number): void {
    pool.setState(i, S.lurk);
    pool.wantSpeed[i] = 0;
    pool.turnRate[i] = 0.5;
    pool.accel[i] = 1;
    pool.blendOverride[i] = -1;
    pool.mem[i * AGENT_MEM + M_REARM_T] = -1e9;
  },
  step(pool: SoloAgentPool, i: number, ctx: AgentContext): void {
    const m = i * AGENT_MEM;
    const H = ctx.herds;
    const rh = ctx.riverHerd;
    const herdOk = rh >= 0 && H.active[rh] === 1;
    const inState = ctx.time - pool.stateT[i];
    const seed = pool.seed[i];
    // Squared horizontal distance from the aircraft to the river herd's centroid (inline: a double returned from a
    // call would be boxed every frame).
    const ac = ctx.aircraft;
    let acD2 = Infinity;
    if (ac && herdOk) {
      const dn = ac.n - H.cN[rh];
      const de = ac.e - H.cE[rh];
      acD2 = dn * dn + de * de;
    }
    let lookN = Number.NaN;
    let lookE = 0;
    // The agent's velocity (for the threat's lead), from the pool's speed and heading.
    pool.mem[m + M_VN] = pool.speed[i] * Math.cos(pool.yaw[i]);
    pool.mem[m + M_VE] = pool.speed[i] * Math.sin(pool.yaw[i]);
    pool.flap[i] = 0;
    switch (pool.state[i]) {
      case S.lurk: {
        pool.wantSpeed[i] = 0;
        pool.turnRate[i] = 0.4;
        if (herdOk) {
          pool.wantYaw[i] = Math.atan2(H.cE[rh] - pool.e[i], H.cN[rh] - pool.n[i]);
          if (ctx.time >= pool.mem[m + M_REARM_T] && acD2 < K.STALK_RANGE * K.STALK_RANGE) {
            // Aim at the near edge of the herd, a seeded offset along it.
            const dn = H.cN[rh] - pool.n[i];
            const de = H.cE[rh] - pool.e[i];
            const d = Math.sqrt(dn * dn + de * de) || 1;
            const off = (cellRandom(seed, 0x57a1, Math.floor(ctx.time)) - 0.5) * 0.8 * H.radius[rh];
            pool.mem[m + M_AIM_N] = H.cN[rh] - (dn / d) * H.radius[rh] - (de / d) * off;
            pool.mem[m + M_AIM_E] = H.cE[rh] - (de / d) * H.radius[rh] + (dn / d) * off;
            pool.mem[m + M_THREAT] = 0;
            pool.setState(i, S.stalk);
          }
        }
        break;
      }
      case S.stalk: {
        const dn = pool.mem[m + M_AIM_N] - pool.n[i];
        const de = pool.mem[m + M_AIM_E] - pool.e[i];
        pool.wantYaw[i] = Math.atan2(de, dn);
        pool.wantSpeed[i] = dn * dn + de * de > 25 ? K.STALK_SPEED : 0;
        pool.turnRate[i] = 0.5;
        pool.accel[i] = 0.8;
        lookN = pool.mem[m + M_AIM_N];
        lookE = pool.mem[m + M_AIM_E];
        if (!herdOk) {
          pool.setState(i, S.wander);
          break;
        }
        if (inState >= K.CHARGE_EARLIEST && (acD2 < K.CHARGE_RANGE * K.CHARGE_RANGE || inState >= K.STALK_TIMEOUT)) {
          pool.mem[m + M_CHARGE_T] = ctx.time;
          pool.mem[m + M_THREAT] = 1;
          pool.mem[m + M_AIM_N] = pool.n[i];
          pool.mem[m + M_AIM_E] = pool.e[i];
          threaten(pool, i, ctx, THREAT.alert, ctx.time + K.THREAT_S);
          pool.setState(i, S.charge);
        }
        break;
      }
      case S.charge:
      case S.roar: {
        const t0 = pool.mem[m + M_CHARGE_T];
        const until = t0 + K.THREAT_S;
        if (pool.state[i] === S.charge) {
          pool.accel[i] = K.CHARGE_ACCEL;
          pool.turnRate[i] = 0.7;
          pool.wantSpeed[i] = PROFILE.speed.run;
          const k = herdOk ? H.nearestMember(rh, pool.n[i], pool.e[i]) : -1;
          if (k >= 0) {
            const dn = H.mN[k] - pool.n[i];
            const de = H.mE[k] - pool.e[i];
            pool.wantYaw[i] = Math.atan2(de, dn);
            lookN = H.mN[k];
            lookE = H.mE[k];
            // No kill: pull up short of the nearest animal.
            if (dn * dn + de * de < K.STOP_SHORT * K.STOP_SHORT) pool.wantSpeed[i] = 0;
          }
          if (ctx.time - t0 >= K.ROAR_AFTER) pool.setState(i, S.roar);
        } else {
          // The roar: stop, rear the head up and open the jaw (eased in and out).
          pool.wantSpeed[i] = 0;
          pool.accel[i] = 4;
          const a = Math.min(1, inState / 0.35, (K.ROAR_S - inState) / 0.4);
          pool.flap[i] = a > 0 ? a : 0;
          if (inState >= K.ROAR_S) {
            pool.flap[i] = 0;
            pool.setState(i, S.wander);
          }
        }
        // The threat: alert at the charge start, flee once in stride; the source follows the animal.
        if (ctx.time < until && (pool.state[i] as number) !== S.wander) {
          const sn = pool.n[i] - pool.mem[m + M_AIM_N];
          const se = pool.e[i] - pool.mem[m + M_AIM_E];
          let send = sn * sn + se * se > K.RESEND_M * K.RESEND_M;
          if (pool.mem[m + M_THREAT] < 2 && ctx.time - t0 >= K.BREAK_COVER_S) {
            pool.mem[m + M_THREAT] = 2;
            send = true;
          }
          if (send) {
            pool.mem[m + M_AIM_N] = pool.n[i];
            pool.mem[m + M_AIM_E] = pool.e[i];
            threaten(pool, i, ctx, pool.mem[m + M_THREAT] >= 2 ? THREAT.flee : THREAT.alert, until);
          }
        }
        break;
      }
      default: {
        // WANDER home.
        const dn = pool.homeN[i] - pool.n[i];
        const de = pool.homeE[i] - pool.e[i];
        pool.wantYaw[i] = Math.atan2(de, dn);
        pool.wantSpeed[i] = PROFILE.speed.walk;
        pool.accel[i] = 1;
        pool.turnRate[i] = 0.5;
        if (dn * dn + de * de < 16 || inState > 600) {
          pool.mem[m + M_REARM_T] = ctx.time + K.REARM_S;
          pool.setState(i, S.lurk);
        }
        break;
      }
    }
    // Head: to the aircraft inside LOOK_RANGE, else toward the target (body-relative, + right), eased.
    if (ac) {
      const dn = ac.n - pool.n[i];
      const de = ac.e - pool.e[i];
      if (dn * dn + de * de < K.LOOK_RANGE * K.LOOK_RANGE) {
        lookN = ac.n;
        lookE = ac.e;
      }
    }
    let look = 0;
    if (lookN === lookN) {
      const b = wrapPi(Math.atan2(lookE - pool.e[i], lookN - pool.n[i]) - pool.yaw[i]);
      look = b > 0.9 ? 0.9 : b < -0.9 ? -0.9 : b;
    }
    pool.head[i] += (look - pool.head[i]) * Math.min(1, 2 * ctx.dt);
  },
};
