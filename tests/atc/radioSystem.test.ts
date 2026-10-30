// The radio's own timing (src/atc/RadioSystem.ts): a full-stop landing at the home field is told where to turn off
// once it has slowed; a touch and go is not. The radio window (R): quick-select tuning, the flip-flop, the MIC.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fieldPoint, HOME_AIRFIELD as H } from '../../src/world/airfields';
import { HOME_GROUND, radioTuning, resetRadios, tuneCom1, type ComRadio } from '../../src/instruments/dynamics/radios';
import '../../src/world/terrain/heightfield';

vi.mock('../../src/ui/radioMenu', () => ({
  RadioMenu: class {
    open = false; items: { key?: string; label: string; detail: string }[] = []; root = { remove() {} };
    constructor(_layer: unknown, readonly onPick: (i: number) => void) {}
    show(_t: string, items: { label: string; detail: string }[]) { this.open = true; this.items = items; }
    hide() { this.open = false; }
  },
}));
(globalThis as { window?: unknown }).window = { addEventListener() {}, removeEventListener() {} };
(globalThis as { HTMLElement?: unknown }).HTMLElement ??= class {};

const { RadioSystem } = await import('../../src/atc/RadioSystem');

function rig(traffic: () => unknown[] = () => [], coms: ComRadio = 2) {
  const said: { actor: string; caption: string }[] = [];
  const speech = { enqueue: (u: { actor: string; caption: string }) => said.push(u), busy: () => false, idle: () => true, speaking: () => false, cancel() {} };
  const inputs: string[] = [];
  const training = { speech, active: false, input: (c: string) => inputs.push(c), radioIdentity: () => ({ authority: 'easa', registration: 'G-FSCK', icaoType: 'C172' }) };
  const p = fieldPoint(H, -600, 0);
  const state = { position: { x: p.north, y: p.east }, onGround: false, groundSpeed: 30, track: H.heading, heading: H.heading, altitudeAGL: 20, altitudeMSL: H.elevation + 20 };
  const ctx = { state, weather: { windDirectionDeg: 70, windSpeedKt: 6, qnhHpa: 1013, timeOfDay: 10, visibilityM: 20000 }, events: { on: () => () => {} }, paused: false };
  const radio = new RadioSystem({ training: training as never, readings: () => ({ avionicsPowered: true }) as never, layer: {} as never, traffic: traffic as never, comRadios: () => coms });
  radio.init(ctx as never);
  const r = radio as unknown as { onKey: (e: unknown) => void; menu: { open: boolean; onPick: (i: number) => void; items: { key?: string; label: string; detail: string; action?: boolean }[] } };
  const key = (code: string, shiftKey = false) => r.onKey({ code, shiftKey, repeat: false, target: null, preventDefault() {}, stopImmediatePropagation() {} });
  return { radio, state, said, training, inputs, key, menu: r.menu };
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

describe('the radio window (R)', () => {
  beforeEach(() => resetRadios());

  it('lists the nearest stations first and tunes one with its number, the old frequency to standby', () => {
    const { key, menu } = rig();
    key('KeyR');
    expect(menu.open).toBe(true);
    expect(menu.items.slice(0, 3).map((i) => i.label.split(' ').slice(-2).join(' '))).toEqual(
      expect.arrayContaining([`Tower ${H.frequency.toFixed(3)}`, `Ground ${HOME_GROUND.toFixed(3)}`, 'ATIS 120.300']),
    );
    const g = menu.items.find((i) => i.label.includes('Ground'))!;
    key(`Digit${g.key}`);
    expect(radioTuning().com1).toEqual([HOME_GROUND, H.frequency]);
    expect(menu.open).toBe(false);
  });

  it('flip-flops with S, moves the MIC with C, and tunes the MIC\'s COM', () => {
    const { key, menu, radio } = rig();
    key('KeyR');
    key('KeyS');
    expect(radioTuning().com1).toEqual([120.3, H.frequency]);
    key('KeyR');
    key('KeyC');
    expect(radioTuning().mic).toBe(2);
    expect(menu.open).toBe(true);
    key('Digit1');
    expect(radioTuning().com2[1]).toBe(124.85);
    expect(radioTuning().com1).toEqual([120.3, H.frequency]);
    radio.update(0.1);
    expect(radioTuning().mic).toBe(2);
  });

  it('tunes a clicked station, and marks S and C as the actions row', () => {
    const { key, menu } = rig();
    key('KeyR');
    expect(menu.items.filter((i) => i.action).map((i) => i.key)).toEqual(['S', 'C', 'Tab']);
    menu.onPick(menu.items.findIndex((i) => i.label.includes('Ground')));
    expect(radioTuning().com1[0]).toBe(HOME_GROUND);
  });

  it('keeps the MIC on COM1 with one COM radio, and offers no C', () => {
    const { key, menu, radio } = rig(() => [], 1);
    key('KeyR');
    expect(menu.items.some((i) => i.key === 'C')).toBe(false);
    key('KeyC');
    expect(radioTuning().mic).toBe(1);
    radio.update(0.1);
    expect(radioTuning().mic).toBe(1);
  });

  it('offers say again during a lesson, as R then 0', () => {
    const { key, menu, training, inputs } = rig();
    key('KeyR');
    expect(menu.items.some((i) => i.key === '0')).toBe(false);
    key('Escape');
    training.active = true;
    key('KeyR');
    key('Digit0');
    expect(inputs).toEqual(['sayAgain']);
    expect(menu.open).toBe(false);
  });

  it('puts Ground first after the tower hands a landing over to it', () => {
    const { radio, state, key, menu } = rig();
    (radio as unknown as { intent: string }).intent = 'fullStop';
    for (let i = 0; i < 120; i++) radio.update(0.1);
    state.onGround = true;
    state.groundSpeed = 15;
    for (let i = 0; i < 20; i++) radio.update(0.1);
    key('KeyR');
    expect(menu.items[0]).toMatchObject({ key: '1', label: expect.stringContaining('Ground') });
    expect(menu.items[0].detail).toContain('as instructed');
    key('Digit1');
    expect(radioTuning().com1[0]).toBe(HOME_GROUND);
  });

  it('turns to the NAV page with Tab and tunes NAV1, then NAV2 after C', () => {
    const { key, menu } = rig();
    key('KeyR');
    key('Tab');
    expect(menu.items[0].label).toMatch(/ILS 07 110\.30|VOR 113\.90/);
    const vor = menu.items.find((i) => i.label.includes('VOR 113.90'))!;
    key(`Digit${vor.key}`);
    expect(radioTuning().nav1).toEqual([113.9, 110.3]);
    key('KeyR'); // the window reopens on the NAV page
    key('KeyC');
    const ils = menu.items.find((i) => i.label.includes('ILS 07'))!;
    key(`Digit${ils.key}`);
    expect(radioTuning().nav2).toEqual([110.3, 113.9]);
  });

  it('leaves Shift+R (the restart) alone', () => {
    const { key, menu } = rig();
    key('KeyR', true);
    expect(menu.open).toBe(false);
  });
});
