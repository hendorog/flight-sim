// The radio's own timing (src/atc/RadioSystem.ts): a full-stop landing at the home field is told where to turn off
// once it has slowed; a touch and go is not.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fieldPoint, HOME_AIRFIELD as H } from '../../src/world/airfields';
import { resetRadios, tuneCom1 } from '../../src/instruments/dynamics/radios';
import '../../src/world/terrain/heightfield';

vi.mock('../../src/ui/radioMenu', () => ({
  RadioMenu: class { open = false; root = { remove() {} }; show() { this.open = true; } hide() { this.open = false; } },
}));
(globalThis as { window?: unknown }).window = { addEventListener() {}, removeEventListener() {} };

const { RadioSystem } = await import('../../src/atc/RadioSystem');

function rig(traffic: () => unknown[] = () => []) {
  const said: { actor: string; caption: string }[] = [];
  const speech = { enqueue: (u: { actor: string; caption: string }) => said.push(u), busy: () => false, idle: () => true, cancel() {} };
  const training = { speech, radioIdentity: () => ({ authority: 'easa', registration: 'G-FSCK', icaoType: 'C172' }) };
  const p = fieldPoint(H, -600, 0);
  const state = { position: { x: p.north, y: p.east }, onGround: false, groundSpeed: 30, track: H.heading, heading: H.heading, altitudeAGL: 20, altitudeMSL: H.elevation + 20 };
  const ctx = { state, weather: { windDirectionDeg: 70, windSpeedKt: 6, qnhHpa: 1013, timeOfDay: 10, visibilityM: 20000 }, events: { on: () => () => {} }, paused: false };
  const radio = new RadioSystem({ training: training as never, readings: () => ({ avionicsPowered: true }) as never, layer: {} as never, traffic: traffic as never });
  radio.init(ctx as never);
  return { radio, state, said };
}

describe('the tower after a landing', () => {
  beforeEach(() => resetRadios());

  it('tells a full-stop landing where to vacate once below 35 kt, once', () => {
    const { radio, state, said } = rig();
    (radio as unknown as { intent: string }).intent = 'fullStop';
    for (let i = 0; i < 120; i++) radio.update(0.1); // 12 s airborne on short final
    state.onGround = true;
    radio.update(0.1);
    expect(said).toHaveLength(0); // still fast
    state.groundSpeed = 15;
    for (let i = 0; i < 20; i++) radio.update(0.1);
    expect(said.map((s) => s.caption)).toEqual(['G-CK, vacate left at A2, when vacated contact Ground 121.9']);
  });

  it('says nothing to a touch and go', () => {
    const { radio, state, said } = rig();
    (radio as unknown as { intent: string }).intent = 'touchAndGo';
    for (let i = 0; i < 120; i++) radio.update(0.1);
    state.onGround = true;
    state.groundSpeed = 15;
    for (let i = 0; i < 20; i++) radio.update(0.1);
    expect(said).toHaveLength(0);
  });
});

describe('circuit traffic on the radio', () => {
  beforeEach(() => resetRadios());
  const call = (frequency: number, north: number) => ({ frequency, north, east: 0, heightAgl: 300, line: { text: 'Bramcombe Traffic, G-ABCD, left hand downwind runway 25, touch and go', speak: '...' }, speaker: 2 });

  it('is heard on its frequency within line of sight, by its own voice', () => {
    let q = [call(122.8, 30000)];
    const { radio, said, state } = rig(() => { const out = q; q = []; return out; });
    tuneCom1(122.8);
    state.position.x = 0;
    radio.update(0.1);
    expect(said).toEqual([expect.objectContaining({ actor: 'traffic', voice: 2, channel: 'radio' })]);
  });

  it('is not heard on another frequency or beyond the horizon', () => {
    let q = [call(122.8, 1000), call(122.8, 400000)];
    const { radio, said } = rig(() => { const out = q; q = []; return out; });
    radio.update(0.1); // COM1 on the home tower
    tuneCom1(122.8);
    q = [call(122.8, 400000)];
    radio.update(0.1);
    expect(said).toHaveLength(0);
  });
});
