// A parked aircraft in a light breeze: the cockpit view and the buffet rumble must hold still. The flight model
// reports the wing as stalled whenever the breeze is not on the nose (at 2-4 m/s of airflow a gust swings the angle
// of attack by tens of degrees, and the stalled share flickers between frames); the stall buffet used to shake the
// pilot's head with it at full strength, and its fast sines aliased into a frame-to-frame jitter of up to a degree
// at a laptop's uneven frame rate. The buffet now scales with the dynamic pressure (core/buffet.ts).

import { describe, expect, it } from 'vitest';
import { fillSynthParams, makeParamBlock } from '../../src/audio/mapping';
import { P } from '../../src/audio/params';
import { BUFFET_FULL_IAS, stallBuffet } from '../../src/core/buffet';
import { makeMockState } from '../../src/core/mockState';
import { defaultControls } from '../../src/core/types';
import { HeadMotion } from '../../src/render/cameras/headMotion';

/** Frame times measured in the browser on the apron (s): uneven, 14-38 ms. */
const DTS = [0.0303, 0.016, 0.0383, 0.0186, 0.0356, 0.0142, 0.0352, 0.0226, 0.0167, 0.0333];

/** Largest frame-to-frame change of the head's offset (m) and shake (rad) over `frames` frames. */
function jitter(head: HeadMotion, state: (i: number) => ReturnType<typeof makeMockState>, frames: number): { offset: number; shake: number; amplitude: number } {
  let offset = 0;
  let shake = 0;
  let amplitude = 0;
  let prev: number[] | null = null;
  for (let i = 0; i < frames; i++) {
    const h = head.update(DTS[i % DTS.length], state(i), 0.1, 'taxiway');
    const now = [h.offset.x, h.offset.y, h.offset.z, h.shake.x, h.shake.y, h.shake.z];
    if (prev && i > 120) {
      for (let k = 0; k < 3; k++) offset = Math.max(offset, Math.abs(now[k] - prev[k]));
      for (let k = 3; k < 6; k++) shake = Math.max(shake, Math.abs(now[k] - prev[k]));
    }
    if (i > 120) amplitude = Math.max(amplitude, ...now.slice(3).map(Math.abs));
    prev = now;
  }
  return { offset, shake, amplitude };
}

describe('stall buffet needs airflow', () => {
  it('is full at a stall in flight and falls with the dynamic pressure below BUFFET_FULL_IAS', () => {
    expect(stallBuffet(1, 25)).toBe(1);
    expect(stallBuffet(0.4, BUFFET_FULL_IAS)).toBe(0.4);
    expect(stallBuffet(1, BUFFET_FULL_IAS / 2)).toBeCloseTo(0.25, 12);
    expect(stallBuffet(1, 3)).toBeLessThan(0.05);
    expect(stallBuffet(1, -2)).toBe(0);
  });

  it('holds the cockpit view still on the apron with the wing "stalled" by a flickering breeze', () => {
    const s = makeMockState({ heightAGL: 0 });
    s.ias = 2.5;
    const j = jitter(new HeadMotion(), (i) => {
      s.stallFraction = i % 3 === 0 ? 1 : 0.2;
      s.ias = 2 + (i % 5) * 0.4;
      return s;
    }, 600);
    // Was 6.5 mm per frame (the whole panel jumping 5-20 px); now about 0.3 mm, under half a pixel.
    expect(j.offset).toBeLessThan(5e-4);
    expect(j.shake).toBeLessThan(5e-4);
  });

  it('still buffets the pilot at a stall in flight', () => {
    const s = makeMockState({ heightAGL: 300, tas: 26 });
    s.stallFraction = 0.8;
    const j = jitter(new HeadMotion(), () => s, 600);
    expect(j.amplitude).toBeGreaterThan(2e-3);
  });

  it('keeps the buffet rumble quiet on the apron and full at a stall in flight', () => {
    const c = defaultControls();
    const ctx = { surface: 'runway' as const, speedOfSound: 340, turbulence: 0, gyroSpin: 0, flapMotor: 0 };
    const parked = makeMockState({ heightAGL: 0 });
    parked.ias = 2.5;
    parked.stallFraction = 1;
    expect(fillSynthParams(parked, c, ctx, makeParamBlock())[P.buffet]).toBeLessThan(0.05);
    const stalled = makeMockState({ heightAGL: 300, tas: 26 });
    stalled.stallFraction = 1;
    expect(fillSynthParams(stalled, c, ctx, makeParamBlock())[P.buffet]).toBe(1);
  });
});
