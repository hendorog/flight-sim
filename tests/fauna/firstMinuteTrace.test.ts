// The scripted first minute plays exactly as in increment 2 (Deep Time inc 2b review fix). The landscape's herds,
// roaming T. rexes and ambient kettles stream in around the safari start; none of them may change what the showcase
// animals do. This flies the safari's first 75 s at 30 Hz on the real terrain, at high and ultra, and hashes every
// frame of the showcase state: each pinned herd (centroid, alarm, every member's position, height, yaw and speed),
// every showcase agent (the T. rex charge, the resting pair...) and every showcase flyer (kettle 0...).
//
// The expected hashes were recorded with this file run against the inc-2 code (4f85c4f), BEFORE any inc-2b edit:
//   git worktree add --detach <dir> 4f85c4f && cp tests/fauna/firstMinuteTrace.test.ts <dir>/tests/fauna/
//   CAPTURE_FIRST_MINUTE=1 npx vitest run tests/fauna/firstMinuteTrace.test.ts   (in <dir>)
// Never re-capture them with later code to make a change pass.

import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEventBus, type QualityLevel, type SimContext } from '../../src/core/context';
import { defaultWeather } from '../../src/core/types';
import { createWorldEnvironment } from '../../src/sim/worldEnvironment';
import { SAFARI, SAFARI_FLIGHT, safariAt, safariHeading } from '../../src/world/era/cretaceousAnchors';
import { setEra } from '../../src/world/era/eraState';
import { eraById } from '../../src/world/era/registry';
import { createFaunaSystem, type FaunaSystemImpl } from '../../src/world/fauna/FaunaSystem';
import { MAX_HERDS, MAX_HERD_SIZE } from '../../src/world/fauna/presets';

const CAPTURE = !!(globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env.CAPTURE_FIRST_MINUTE;

/** Recorded on 4f85c4f (see the header). */
const EXPECTED: Record<'high' | 'ultra', string> = {
  high: '4ecd9c5d',
  ultra: '4ecd9c5d',
};

beforeAll(() => {
  setEra('cretaceous');
});
afterAll(() => {
  setEra('present');
});

/** FNV-1a over the bytes of the values pushed (Float64), as a hex string. */
class Hash {
  private h = 0x811c9dc5;
  private readonly f = new Float64Array(1);
  private readonly b = new Uint8Array(this.f.buffer);
  push(v: number): void {
    this.f[0] = v;
    for (let k = 0; k < 8; k++) this.h = Math.imul(this.h ^ this.b[k], 0x01000193) >>> 0;
  }
  hex(): string {
    return this.h.toString(16).padStart(8, '0');
  }
}

function makeCtx(quality: QualityLevel) {
  const weather = { ...defaultWeather(), timeOfDay: SAFARI.tod, cloudCover: 0.35, windSpeedKt: 6 };
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 400000);
  const state = { position: { x: 0, y: 0, z: -400 }, velocity: { x: 0, y: 50, z: 0 }, tas: 50, altitudeAGL: 400 };
  const ctx = { scene: new THREE.Scene(), camera, state, weather, env: createWorldEnvironment(weather), sky: { dayFactor: 1 }, simTime: 0, quality, events: createEventBus() };
  return ctx as unknown as SimContext & { state: typeof state; simTime: number };
}

const AT = { north: 0, east: 0, alt: 0 };
function flyTo(ctx: ReturnType<typeof makeCtx>, t: number): void {
  safariAt(t, AT);
  const hd = safariHeading();
  ctx.state.position.x = AT.north;
  ctx.state.position.y = AT.east;
  ctx.state.position.z = -AT.alt;
  ctx.state.velocity.x = SAFARI_FLIGHT.groundSpeed * Math.cos(hd);
  ctx.state.velocity.y = SAFARI_FLIGHT.groundSpeed * Math.sin(hd);
  ctx.camera.position.set(AT.east, AT.alt, -AT.north);
  ctx.camera.lookAt(AT.east + 1000 * Math.sin(hd), AT.alt - 100, -(AT.north + 1000 * Math.cos(hd)));
  ctx.camera.updateMatrixWorld();
}

function firstMinuteHash(quality: QualityLevel): { hash: string; pinned: number; agents: number; flyers: number } {
  const ctx = makeCtx(quality);
  const sys = createFaunaSystem(eraById('cretaceous'), {}) as FaunaSystemImpl;
  flyTo(ctx, 0);
  sys.init(ctx);
  // Inc-2b bookkeeping, absent on 4f85c4f: roaming T. rexes are not showcase agents.
  const ambient = (sys as unknown as { ambientAgent?: Uint8Array }).ambientAgent;
  const showcaseFlyer = (sys as unknown as { showcaseFlyer: Uint8Array }).showcaseFlyer;
  const H = sys.herds;
  const A = sys.agents;
  const F = sys.flyers;
  const hash = new Hash();
  const dt = 1 / 30;
  let pinned = 0;
  let agents = 0;
  let flyers = 0;
  for (let f = 1; f <= 75 * 30; f++) {
    ctx.simTime = f * dt;
    flyTo(ctx, f * dt);
    sys.update(dt, ctx);
    pinned = agents = flyers = 0;
    for (let h = 0; h < MAX_HERDS; h++) {
      if (!H.active[h] || !H.pinned[h]) continue;
      pinned++;
      hash.push(h);
      hash.push(H.cN[h]);
      hash.push(H.cE[h]);
      hash.push(H.cH[h]);
      hash.push(H.fleeing[h]);
      hash.push(H.react[h]);
      for (let k = 0; k < H.size[h]; k++) {
        const i = h * MAX_HERD_SIZE + k;
        hash.push(H.mN[i]);
        hash.push(H.mE[i]);
        hash.push(H.mH[i]);
        hash.push(H.yaw[i]);
        hash.push(H.speed[i]);
      }
    }
    for (let i = 0; i < A.capacity; i++) {
      if (!A.active[i] || ambient?.[i]) continue;
      agents++;
      hash.push(i);
      hash.push(A.n[i]);
      hash.push(A.e[i]);
      hash.push(A.h[i]);
      hash.push(A.yaw[i]);
      hash.push(A.state[i]);
      hash.push(A.head[i]);
      hash.push(A.flap[i]);
    }
    for (let i = 0; i < F.capacity; i++) {
      if (!F.active[i] || !showcaseFlyer[i]) continue;
      flyers++;
      hash.push(i);
      hash.push(F.n[i]);
      hash.push(F.e[i]);
      hash.push(F.alt[i]);
      hash.push(F.heading[i]);
      hash.push(F.mode[i]);
    }
  }
  sys.dispose();
  return { hash: hash.hex(), pinned, agents, flyers };
}

describe('the scripted first minute is the inc-2 one, frame for frame', () => {
  for (const quality of ['high', 'ultra'] as const) {
    it(`${quality}: the showcase herds, agents and flyers trace exactly as on 4f85c4f`, () => {
      const r = firstMinuteHash(quality);
      if (CAPTURE) console.log(`first-minute trace ${quality}: ${JSON.stringify(r)}`);
      expect(r.pinned).toBeGreaterThanOrEqual(3);
      expect(r.agents).toBeGreaterThanOrEqual(1);
      expect(r.flyers).toBeGreaterThanOrEqual(1);
      if (!CAPTURE) expect(r.hash).toBe(EXPECTED[quality]);
    });
  }
});
