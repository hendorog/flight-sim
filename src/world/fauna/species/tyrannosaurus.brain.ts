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
// THE AMBIENT HUNT (inc 2b; every agent that is not the scripted one): a roaming T. rex anywhere on the map.
//   An agent is SCRIPTED iff ctx.riverHerd >= 0 and its home is within SCRIPTED_HOME_M (2 m) of anchors.TREX_LAIR:
//   its prey is ctx.riverHerd and every branch and number above is unchanged (tests/fauna/tyrannosaurus.test.ts
//   pins its 30 s trace hash). Every other agent is AMBIENT:
//   PREY    the nearest active herd with pinned === 0 and kind !== ignore (never the Alamosaurus) whose centroid is
//           within PREY_RADIUS (1500 m); 'flee' herds (Edmontosaurus) are preferred over 'face' herds (Triceratops)
//           when both are in range. Re-picked only in LURK, on each PREY_REPICK_S (2 s) boundary; LOCKED at
//           LURK -> STALK and held through charge, roar and wander. The lock is the herd slot plus
//           H.seed[slot]: a released slot, or one reused by another herd, loses it (-> WANDER, then LURK re-picks).
//   LURK    shadows the prey, keeping within SHADOW_NEAR..SHADOW_FAR (220-450 m; 100 m further out from 'face' prey):
//           it walks in (or backs off) once SHADOW_PAD (15 m) inside an edge, to SHADOW_AT (320 m), and otherwise
//           stands facing it.
//   STALK   once re-armed (AMB_REARM_S after the last hunt), within AMB_STALK_FROM (600 m) of the prey, with the
//           aircraft horizontally within AMB_STALK_RANGE (3000 m) of the prey's centroid and less than
//           AMB_STALK_AGL (1000 m) above its ground: the scripted stalk toward the near edge.
//   CHARGE  at AMB_CHARGE_RANGE (1300 m) or AMB_STALK_TIMEOUT (30 s) into the stalk, never before CHARGE_EARLIEST;
//           the same alert -> flee threat sequence on the prey (lasting AMB_THREAT_S, 30 s), but an Edmontosaurus
//           herd stands alert, heads up, until the T. rex is within AMB_BREAK_COVER_M (180 m) of it (or
//           AMB_BREAK_COVER_MAX_S, 14 s, into the charge, or the roar) and only then bolts: a close chase. The face fan-out reaches UNPINNED
//           herds only: an ambient agent never threatens a pinned (showcase) herd. Against 'face' prey (Triceratops)
//           it pulls up FACE_STANDOFF_M (240 m) from the nearest member, outside their predatorFleeRange (200 m):
//           they face it, horns forward, and never run (poetic licence). It roars as the aircraft goes by (the range
//           opening, within AMB_ROAR_PASS_M; at least AMB_ROAR_MIN_S, 8 s, into the charge) or AMB_ROAR_AFTER (30 s)
//           into it.
//   WANDER  home (its spawn point beside the herd), then LURK; re-armed after AMB_REARM_S (120 s).
//   All of these numbers are agent choices (tuned to tests/fauna/ambientHunt.test.ts's pass: a 60 m/s pass from
//   5 km out sees the stalk at ~3 km and the charge at ~1.3 km, the stampede running as it goes by).
//
// The flee direction: the lair is placed (cretaceousAnchors.ts TREX_LAIR) so that "away from the T. rex" is
// TREX_FLEE_HEADING, 45 deg right of the track: the stampede runs ahead and inward.

import type { AgentContext, SoloAgentPool, SoloBrain } from '../agents';
import { AGENT_MEM } from '../agents';
import { cellRandom } from '../habitat';
import { makeSample } from '../../terrain/heightfield';
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
  /** While moving it looks WATER_AHEAD m ahead every WATER_CHECK_S (one terrain read) and stops at a river's edge
   * (closer than WATER_MARGIN to the channel): the lair is across the river from the herd. */
  WATER_AHEAD: 14,
  WATER_CHECK_S: 0.5,
  WATER_MARGIN: 4,
  /** The threat's source is re-sent once the animal has moved this far from where it was last sent, m (a call per
   * frame would box its double arguments, ~20 B a frame; the herds read it at their 10 Hz brain tick anyway). */
  RESEND_M: 8,
  // ---- the ambient hunt (inc 2b; agent choices)
  /** An agent is the scripted one iff ctx.riverHerd >= 0 and its home is this close to anchors.TREX_LAIR, m. */
  SCRIPTED_HOME_M: 2,
  /** Prey: herds whose centroid is within this of the agent, m. */
  PREY_RADIUS: 1500,
  /** LURK re-picks its prey on each boundary of this period, s. */
  PREY_REPICK_S: 2,
  /** Shadowing: walk in beyond SHADOW_FAR, back off inside SHADOW_NEAR, settle at SHADOW_AT from the centroid, m. */
  SHADOW_AT: 320,
  SHADOW_NEAR: 220,
  SHADOW_FAR: 450,
  /** It starts walking this far inside the band's edges (the herd keeps moving while it gets going), m. */
  SHADOW_PAD: 15,
  /** It only stalks from within this of the prey's centroid, m. */
  AMB_STALK_FROM: 600,
  AMB_STALK_RANGE: 3000,
  /** The aircraft must be less than this above the prey's ground, m. */
  AMB_STALK_AGL: 1000,
  AMB_CHARGE_RANGE: 1300,
  AMB_STALK_TIMEOUT: 30,
  /** Ambient: it roars as the aircraft goes by (the range to the prey opening, within AMB_ROAR_PASS_M), at least
   * AMB_ROAR_MIN_S into the charge, and at the latest AMB_ROAR_AFTER into it, s. */
  AMB_ROAR_MIN_S: 8,
  AMB_ROAR_PASS_M: 1500,
  AMB_ROAR_AFTER: 30,
  /** Ambient: the threat lasts this long from the charge start, s (the chase runs longer than the scripted one). */
  AMB_THREAT_S: 30,
  /** Ambient, 'flee' prey: the herd only bolts (the flee-level threat) once the T. rex is this near its nearest
   * member, m, AMB_BREAK_COVER_MAX_S into the charge, or at the roar; until then it stands alert, heads up, watching it come. */
  AMB_BREAK_COVER_M: 180,
  AMB_BREAK_COVER_MAX_S: 14,
  AMB_REARM_S: 120,
  /** Against 'face' prey the charge pulls up this far from the nearest member (outside predatorFleeRange), m. */
  FACE_STANDOFF_M: 240,
  /** It starts braking this much earlier than the computed braking distance, m. */
  FACE_BRAKE_PAD: 3,
  /** 'face' prey: the shadowing band (and AMB_STALK_FROM) sits this much further out, m. */
  FACE_SHADOW_EXTRA: 100,
  /** 'face' prey: the stalk creeps no nearer than FACE_STANDOFF_M + this, m. */
  FACE_STALK_ROOM: 80,
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
/** Water check: the next check time (pool clock), negated while the way ahead is water. */
const M_WATER = 7;
/** Ambient: the prey herd's slot (-1 none) and its H.seed (the lock's identity). */
const M_PREY = 8;
const M_PREY_SEED = 9;
/** Ambient LURK shadowing: 0 standing, 1 walking in, -1 backing off. */
const M_SHADOW = 10;

const SAMPLE = makeSample();

/** True while the way ahead (WATER_AHEAD m along the heading) is the river; re-checked every WATER_CHECK_S. */
function waterAhead(pool: SoloAgentPool, i: number, ctx: AgentContext): boolean {
  const m = i * AGENT_MEM;
  const w = pool.mem[m + M_WATER];
  const blocked = w < 0;
  if (ctx.time < Math.abs(w) || ctx.terrainLeft() <= 1) return blocked;
  const n = pool.n[i] + K.WATER_AHEAD * Math.cos(pool.yaw[i]);
  const e = pool.e[i] + K.WATER_AHEAD * Math.sin(pool.yaw[i]);
  const s = ctx.terrain.sample(n, e, SAMPLE);
  const wet = s.riverDist - s.riverHalfWidth < K.WATER_MARGIN || s.standing > s.ground;
  pool.mem[m + M_WATER] = (wet ? -1 : 1) * (ctx.time + K.WATER_CHECK_S);
  return wet;
}

const wrapPi = (a: number): number => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));


/**
 * Send the threat to the prey herd p (the scripted agent: the river herd) and the face herds near it (level
 * THREAT.alert or THREAT.flee). An ambient agent (scripted false) never reaches a pinned herd.
 */
function threaten(pool: SoloAgentPool, i: number, ctx: AgentContext, level: number, until: number, rh: number, scripted: boolean): void {
  const m = i * AGENT_MEM;
  const H = ctx.herds;
  const n = pool.n[i];
  const e = pool.e[i];
  const vN = pool.mem[m + M_VN];
  const vE = pool.mem[m + M_VE];
  if (rh >= 0 && H.active[rh] && (scripted || !H.pinned[rh])) H.setExternalThreat(rh, n, e, vN, vE, until, level, K.LEAD);
  if (level < THREAT.flee) return;
  for (let h = 0; h < H.capacity; h++) {
    if (!H.active[h] || h === rh || H.kind[h] !== REACTION_KIND.face) continue;
    if (!scripted && H.pinned[h]) continue;
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

/**
 * HerdPool.nearestMember(h, pool.n[i], pool.e[i]) with the same arithmetic and tie order (the same member), but
 * reading the agent's position itself: a call with double arguments boxes them (~36 B a frame) once this brain's
 * step is too large for TurboFan to inline nearestMember.
 */
function nearestMemberOf(pool: SoloAgentPool, i: number, H: AgentContext['herds'], h: number): number {
  if (!(h >= 0 && h < H.capacity) || !H.active[h]) return -1;
  const n = pool.n[i];
  const e = pool.e[i];
  const base = h * H.memberCap;
  let best = -1;
  let bd = Infinity;
  for (let k = 0; k < H.size[h]; k++) {
    const d = (H.mN[base + k] - n) ** 2 + (H.mE[base + k] - e) ** 2;
    if (d < bd) {
      bd = d;
      best = base + k;
    }
  }
  return best;
}

/**
 * True when the agent is inside its stand-off from 'face' prey p: its distance (the nearer of the nearest member and
 * the centroid less the formation radius, the latter being the herd's own predatorFleeRange test) is under
 * FACE_STANDOFF_M plus FACE_STALK_ROOM (stalk) or plus its braking distance at the pool's 1.5 x accel deceleration
 * and FACE_BRAKE_PAD (charge). A boolean, with the limit worked out here: a double return or argument boxes
 * (~20 B a frame) once this brain's step is too large for TurboFan to inline the call.
 */
function insideStandOff(pool: SoloAgentPool, i: number, H: AgentContext['herds'], p: number, charging: boolean): boolean {
  const n = pool.n[i];
  const e = pool.e[i];
  let dn = H.cN[p] - n;
  let de = H.cE[p] - e;
  let d = Math.sqrt(dn * dn + de * de) - H.radius[p];
  const k = nearestMemberOf(pool, i, H, p);
  if (k >= 0) {
    dn = H.mN[k] - n;
    de = H.mE[k] - e;
    const dm = Math.sqrt(dn * dn + de * de);
    if (dm < d) d = dm;
  }
  if (!charging) return d < K.FACE_STANDOFF_M + K.FACE_STALK_ROOM;
  const v = pool.speed[i];
  return d < K.FACE_STANDOFF_M + (v * v) / (3 * K.CHARGE_ACCEL) + K.FACE_BRAKE_PAD;
}

/** True while the ambient lock (slot + seed in mem) names a live herd. */
function preyHeld(pool: SoloAgentPool, i: number, ctx: AgentContext): boolean {
  const m = i * AGENT_MEM;
  const p = pool.mem[m + M_PREY] | 0;
  const H = ctx.herds;
  return p >= 0 && H.active[p] === 1 && H.seed[p] === pool.mem[m + M_PREY_SEED];
}

/** Pick the ambient prey (nearest unpinned, non-ignore herd within PREY_RADIUS; 'flee' herds first) into mem. */
function pickPrey(pool: SoloAgentPool, i: number, ctx: AgentContext): void {
  const m = i * AGENT_MEM;
  const H = ctx.herds;
  const r2 = K.PREY_RADIUS * K.PREY_RADIUS;
  let bestFlee = -1;
  let dFlee = r2;
  let bestFace = -1;
  let dFace = r2;
  for (let h = 0; h < H.capacity; h++) {
    if (!H.active[h] || H.pinned[h] || H.kind[h] === REACTION_KIND.ignore) continue;
    const dn = H.cN[h] - pool.n[i];
    const de = H.cE[h] - pool.e[i];
    const d2 = dn * dn + de * de;
    if (H.kind[h] === REACTION_KIND.flee) {
      if (d2 < dFlee) {
        dFlee = d2;
        bestFlee = h;
      }
    } else if (d2 < dFace) {
      dFace = d2;
      bestFace = h;
    }
  }
  const p = bestFlee >= 0 ? bestFlee : bestFace;
  pool.mem[m + M_PREY] = p;
  pool.mem[m + M_PREY_SEED] = p >= 0 ? H.seed[p] : 0;
}

export const TYRANNOSAURUS_BRAIN: SoloBrain = {
  init(pool: SoloAgentPool, i: number): void {
    pool.setState(i, S.lurk);
    pool.wantSpeed[i] = 0;
    pool.turnRate[i] = 0.5;
    pool.accel[i] = 1;
    pool.blendOverride[i] = -1;
    pool.mem[i * AGENT_MEM + M_REARM_T] = -1e9;
    pool.mem[i * AGENT_MEM + M_PREY] = -1;
  },
  step(pool: SoloAgentPool, i: number, ctx: AgentContext): void {
    const m = i * AGENT_MEM;
    const H = ctx.herds;
    // The scripted agent (the safari's lair T. rex hunting the river herd) or an ambient one (a locked prey herd).
    const L = ctx.anchors.TREX_LAIR;
    const hn = pool.homeN[i] - L.north;
    const he = pool.homeE[i] - L.east;
    const scripted = ctx.riverHerd >= 0 && hn * hn + he * he < K.SCRIPTED_HOME_M * K.SCRIPTED_HOME_M;
    if (!scripted && pool.state[i] === S.lurk) {
      const T = K.PREY_REPICK_S;
      if (Math.floor(ctx.time / T) !== Math.floor((ctx.time - ctx.dt) / T)) pickPrey(pool, i, ctx);
    }
    // (An int: a double index or argument would be boxed.)
    const rh = scripted ? ctx.riverHerd : pool.mem[m + M_PREY] | 0;
    const herdOk = scripted ? rh >= 0 && H.active[rh] === 1 : preyHeld(pool, i, ctx);
    const face = !scripted && herdOk && H.kind[rh] === REACTION_KIND.face;
    const inState = ctx.time - pool.stateT[i];
    const seed = pool.seed[i];
    // Squared horizontal distance from the aircraft to the prey herd's centroid (inline: a double returned from a
    // call would be boxed every frame).
    const ac = ctx.aircraft;
    let acD2 = Infinity;
    // The aircraft is moving away from the prey (it has gone by).
    let acOpening = false;
    if (ac && herdOk) {
      const dn = ac.n - H.cN[rh];
      const de = ac.e - H.cE[rh];
      acD2 = dn * dn + de * de;
      acOpening = dn * ac.vN + de * ac.vE >= 0;
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
          let go: boolean;
          if (scripted) go = ctx.time >= pool.mem[m + M_REARM_T] && acD2 < K.STALK_RANGE * K.STALK_RANGE;
          else {
            // Shadowing: settle SHADOW_AT from the prey (further out from 'face' prey), standing while in the band.
            const dn = H.cN[rh] - pool.n[i];
            const de = H.cE[rh] - pool.e[i];
            const d = Math.sqrt(dn * dn + de * de);
            const extra = face ? K.FACE_SHADOW_EXTRA : 0;
            let mode = pool.mem[m + M_SHADOW];
            if (d > K.SHADOW_FAR - K.SHADOW_PAD + extra) mode = 1;
            else if (d < K.SHADOW_NEAR + K.SHADOW_PAD + extra) mode = -1;
            else if ((mode > 0 && d <= K.SHADOW_AT + extra) || (mode < 0 && d >= K.SHADOW_AT + extra)) mode = 0;
            pool.mem[m + M_SHADOW] = mode;
            if (mode !== 0) {
              if (mode < 0) pool.wantYaw[i] = Math.atan2(-de, -dn);
              pool.turnRate[i] = 0.5;
              pool.accel[i] = 1;
              if (!waterAhead(pool, i, ctx)) pool.wantSpeed[i] = PROFILE.speed.walk;
              else pool.mem[m + M_SHADOW] = 0;
            }
            go =
              ctx.time >= pool.mem[m + M_REARM_T] &&
              d < K.AMB_STALK_FROM + extra &&
              acD2 < K.AMB_STALK_RANGE * K.AMB_STALK_RANGE &&
              ac !== null &&
              ac.alt - H.cH[rh] < K.AMB_STALK_AGL;
          }
          if (go) {
            // Aim at the near edge of the herd, a seeded offset along it.
            const dn = H.cN[rh] - pool.n[i];
            const de = H.cE[rh] - pool.e[i];
            const d = Math.sqrt(dn * dn + de * de) || 1;
            const off = (cellRandom(seed, 0x57a1, Math.floor(ctx.time)) - 0.5) * 0.8 * H.radius[rh];
            pool.mem[m + M_AIM_N] = H.cN[rh] - (dn / d) * H.radius[rh] - (de / d) * off;
            pool.mem[m + M_AIM_E] = H.cE[rh] - (de / d) * H.radius[rh] + (dn / d) * off;
            pool.mem[m + M_THREAT] = 0;
            pool.mem[m + M_SHADOW] = 0;
            pool.setState(i, S.stalk);
          }
        }
        break;
      }
      case S.stalk: {
        const dn = pool.mem[m + M_AIM_N] - pool.n[i];
        const de = pool.mem[m + M_AIM_E] - pool.e[i];
        pool.wantYaw[i] = Math.atan2(de, dn);
        pool.wantSpeed[i] = dn * dn + de * de > 25 && !waterAhead(pool, i, ctx) ? K.STALK_SPEED : 0;
        pool.turnRate[i] = 0.5;
        pool.accel[i] = 0.8;
        lookN = pool.mem[m + M_AIM_N];
        lookE = pool.mem[m + M_AIM_E];
        if (!herdOk) {
          pool.setState(i, S.wander);
          break;
        }
        // Against 'face' prey the stalk creeps no nearer than the stand-off (plus a charge's worth of room).
        if (face && insideStandOff(pool, i, H, rh, false)) pool.wantSpeed[i] = 0;
        const chargeR = scripted ? K.CHARGE_RANGE : K.AMB_CHARGE_RANGE;
        const timeout = scripted ? K.STALK_TIMEOUT : K.AMB_STALK_TIMEOUT;
        if (inState >= K.CHARGE_EARLIEST && (acD2 < chargeR * chargeR || inState >= timeout)) {
          pool.mem[m + M_CHARGE_T] = ctx.time;
          pool.mem[m + M_THREAT] = 1;
          pool.mem[m + M_AIM_N] = pool.n[i];
          pool.mem[m + M_AIM_E] = pool.e[i];
          threaten(pool, i, ctx, THREAT.alert, ctx.time + (scripted ? K.THREAT_S : K.AMB_THREAT_S), rh, scripted);
          pool.setState(i, S.charge);
        }
        break;
      }
      case S.charge:
      case S.roar: {
        // An ambient agent whose prey is gone (released, or its slot reused) gives up: home, then a new pick.
        if (!scripted && !herdOk) {
          pool.flap[i] = 0;
          pool.setState(i, S.wander);
          break;
        }
        const t0 = pool.mem[m + M_CHARGE_T];
        const until = t0 + (scripted ? K.THREAT_S : K.AMB_THREAT_S);
        // The nearest member is within AMB_BREAK_COVER_M (a boolean: a double let merged across branches boxes).
        let memberClose = false;
        if (pool.state[i] === S.charge) {
          pool.accel[i] = K.CHARGE_ACCEL;
          pool.turnRate[i] = 0.7;
          pool.wantSpeed[i] = PROFILE.speed.run;
          const k = herdOk ? nearestMemberOf(pool, i, H, rh) : -1;
          if (k >= 0) {
            const dn = H.mN[k] - pool.n[i];
            const de = H.mE[k] - pool.e[i];
            pool.wantYaw[i] = Math.atan2(de, dn);
            memberClose = dn * dn + de * de < K.AMB_BREAK_COVER_M * K.AMB_BREAK_COVER_M;
            lookN = H.mN[k];
            lookE = H.mE[k];
            // No kill: pull up short of the nearest animal.
            if (dn * dn + de * de < K.STOP_SHORT * K.STOP_SHORT) pool.wantSpeed[i] = 0;
            // 'face' prey: pull up at the stand-off (braking distance at the pool's 1.5 x accel deceleration).
            if (face && insideStandOff(pool, i, H, rh, true)) pool.wantSpeed[i] = 0;
          }
          // ... and at the water's edge.
          if (waterAhead(pool, i, ctx)) pool.wantSpeed[i] = 0;
          const dtc = ctx.time - t0;
          let roar: boolean;
          if (scripted) roar = dtc >= K.ROAR_AFTER;
          else {
            // The aircraft has gone by: near the prey and the range opening.
            roar = dtc >= K.AMB_ROAR_AFTER || (dtc >= K.AMB_ROAR_MIN_S && acOpening && acD2 < K.AMB_ROAR_PASS_M * K.AMB_ROAR_PASS_M);
          }
          if (roar) pool.setState(i, S.roar);
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
          const dtc = ctx.time - t0;
          // Ambient 'flee' prey bolts when it is close, at AMB_BREAK_COVER_MAX_S, or at the roar (an early roar, the
          // aircraft already going away, must not end the hunt with the herd still standing alert).
          const bolt = scripted || face
            ? dtc >= K.BREAK_COVER_S
            : dtc >= K.AMB_BREAK_COVER_MAX_S || (pool.state[i] as number) === S.roar || (dtc >= K.BREAK_COVER_S && memberClose);
          if (pool.mem[m + M_THREAT] < 2 && bolt) {
            pool.mem[m + M_THREAT] = 2;
            send = true;
          }
          if (send) {
            pool.mem[m + M_AIM_N] = pool.n[i];
            pool.mem[m + M_AIM_E] = pool.e[i];
            threaten(pool, i, ctx, pool.mem[m + M_THREAT] >= 2 ? THREAT.flee : THREAT.alert, until, rh, scripted);
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
          pool.mem[m + M_REARM_T] = ctx.time + (scripted ? K.REARM_S : K.AMB_REARM_S);
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
