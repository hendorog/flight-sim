// The safari's scripted encounter through the whole FaunaSystem (Deep Time inc 2, branch-final review):
//   - under time acceleration (a long frame dt) the herds and the T. rex still follow the sim time the aircraft
//     flies (sub-steps of <= 0.1 s), so the charge and the roar land where they do at 1x;
//   - a scenario reset ('reset' event) stages the showcase again: the replay has the opening hunt.

import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEventBus, type SimContext } from '../../src/core/context';
import { defaultWeather } from '../../src/core/types';
import { createWorldEnvironment } from '../../src/sim/worldEnvironment';
import { SAFARI, TREX_LAIR, safariAt, safariHeading, SAFARI_FLIGHT } from '../../src/world/era/cretaceousAnchors';
import { setEra } from '../../src/world/era/eraState';
import { eraById } from '../../src/world/era/registry';
import { createFaunaSystem, type FaunaSystemImpl } from '../../src/world/fauna/FaunaSystem';
import { countingTerrain } from '../../src/world/fauna/habitat';
import { TREX_STATE } from '../../src/world/fauna/species/tyrannosaurus.brain';

beforeAll(() => {
  setEra('cretaceous');
});
afterAll(() => {
  setEra('present');
});

function boot() {
  const weather = { ...defaultWeather(), timeOfDay: SAFARI.tod, cloudCover: 0.35, windSpeedKt: 6 };
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 400000);
  const state = { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, tas: 56.6, altitudeAGL: 137 };
  const ctx = { scene: new THREE.Scene(), camera, state, weather, env: createWorldEnvironment(weather), sky: { dayFactor: 1 }, simTime: 0, quality: 'high', events: createEventBus() } as unknown as SimContext & {
    state: typeof state;
    simTime: number;
  };
  const sys = createFaunaSystem(eraById('cretaceous'), { terrain: countingTerrain() }) as FaunaSystemImpl;
  place(ctx, 0);
  sys.init(ctx);
  return { sys, ctx };
}

const AT = { north: 0, east: 0, alt: 0 };
/** The aircraft (and the camera) on the safari's straight-line model at t s after the start. */
function place(ctx: SimContext & { state: { position: { x: number; y: number; z: number }; velocity: { x: number; y: number; z: number } } }, t: number): void {
  safariAt(t, AT);
  const hd = safariHeading();
  ctx.state.position.x = AT.north;
  ctx.state.position.y = AT.east;
  ctx.state.position.z = -AT.alt;
  ctx.state.velocity.x = SAFARI_FLIGHT.groundSpeed * Math.cos(hd);
  ctx.state.velocity.y = SAFARI_FLIGHT.groundSpeed * Math.sin(hd);
  ctx.camera.position.set(AT.east, AT.alt, -AT.north);
}

/** Fly `seconds` of the safari from `t0` in frames of `dt`; the sim time at which the T. rex charges and roars. */
function fly(sys: FaunaSystemImpl, ctx: ReturnType<typeof boot>['ctx'], seconds: number, dt: number, t0 = 0) {
  let charge = Number.NaN;
  let roar = Number.NaN;
  const frames = Math.round(seconds / dt);
  for (let f = 1; f <= frames; f++) {
    const t = t0 + f * dt;
    ctx.simTime = t;
    place(ctx, t - t0);
    sys.update(dt, ctx);
    const s = sys.agents.state[0];
    if (Number.isNaN(charge) && s === TREX_STATE.charge) charge = t - t0;
    if (Number.isNaN(roar) && s === TREX_STATE.roar) roar = t - t0;
  }
  return { charge, roar };
}

describe('the scripted encounter in the FaunaSystem', () => {
  it('keeps its timing under time acceleration (frame dt 0.5 s vs 1/60 s)', () => {
    const a = boot();
    const ref = fly(a.sys, a.ctx, 24, 1 / 60);
    const b = boot();
    const fast = fly(b.sys, b.ctx, 24, 0.5);
    expect(ref.charge).toBeGreaterThan(3);
    expect(ref.roar).toBeGreaterThan(ref.charge);
    // Seen at the end of a 0.5 s frame: at most one frame late, never early.
    expect(fast.charge).toBeGreaterThanOrEqual(ref.charge - 0.2);
    expect(fast.charge).toBeLessThanOrEqual(ref.charge + 0.6);
    expect(fast.roar).toBeGreaterThanOrEqual(ref.roar - 0.2);
    expect(fast.roar).toBeLessThanOrEqual(ref.roar + 0.6);
    // The herds' and the agents' clocks follow the sim time.
    expect(b.sys.agents.time).toBeCloseTo(24, 6);
    expect(b.sys.herds.time).toBeCloseTo(24, 6);
  });

  it('a reset after a minute of flight stages the opening hunt again', () => {
    const { sys, ctx } = boot();
    const first = fly(sys, ctx, 60, 1 / 30);
    expect(first.charge).toBeGreaterThan(0);
    // The T. rex is away from its lair or in its rearm cooldown now: without a re-seed there is no second hunt.
    const t0 = ctx.simTime;
    place(ctx, 0);
    ctx.events.emit('reset', { scenario: 'safari' });
    expect(sys.agents.count()).toBe(1);
    expect(sys.agents.state[0]).toBe(TREX_STATE.lurk);
    expect(Math.hypot(sys.agents.n[0] - TREX_LAIR.north, sys.agents.e[0] - TREX_LAIR.east)).toBeLessThan(1);
    expect(sys.riverHerd).toBeGreaterThanOrEqual(0);
    expect(sys.herds.count()).toBeGreaterThanOrEqual(3);
    const again = fly(sys, ctx, 24, 1 / 30, t0);
    expect(again.charge).toBeCloseTo(first.charge, 0);
    expect(again.roar).toBeCloseTo(first.roar, 0);
  });

  it('does not leak showcase slots over repeated resets', () => {
    const { sys, ctx } = boot();
    const pinned = (): number => {
      let c = 0;
      for (let h = 0; h < sys.herds.capacity; h++) c += sys.herds.active[h] && sys.herds.pinned[h] ? 1 : 0;
      return c;
    };
    const herds = pinned();
    const flyers = sys.flyers.count();
    for (let k = 0; k < 5; k++) {
      fly(sys, ctx, 2, 1 / 30, ctx.simTime);
      ctx.events.emit('reset', { scenario: 'safari' });
    }
    expect(sys.agents.count()).toBe(1);
    expect(sys.flyers.count()).toBe(flyers);
    // The river herd and the hooks' herds, once each (streamed herds come and go on their own).
    expect(pinned()).toBe(herds);
    expect(sys.showcaseHerds.length + 1).toBe(herds);
  });
});
