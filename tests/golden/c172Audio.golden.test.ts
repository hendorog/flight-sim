// Golden master of the SOUND of the Cessna 172S: the synthesis worklet (src/audio/worklet/aircraftSynth.js) run in
// node on the frozen host (tests/golden/rigs/workletHost.ts) through a fixed 4 s script of parameter blocks: a
// start (cranking, first firing, the stumble up to idle), an idle with the flap motor, a throttle slam to full
// power with the aircraft starting to roll, a tyre chirp, and a shut-down. Recorded for each of the four stems:
// the RMS of every 100 ms, 100 raw samples (25 consecutive ones at four moments) and the sum and the sum of
// squares of all 192 000 samples. Pinned in tests/golden/data/c172Audio.json (tests/golden/golden.ts).
//
// This is the permanent guard of contract 3.8: whatever is added to the worklet for other aircraft types
// (a second engine voice, geared and diesel voices, gear sounds, a configuration message), the DEFAULT
// configuration is the Cessna 172S and its samples stay identical (FS_GOLDEN_EXACT=1). The host sends nothing
// but parameter blocks and the one-shot { type: 'chirp' }; parameters appended to the block later are sent as 0.
//
// The parameter values are written out here (not taken from src/audio/mapping.ts, which
// c172Instruments.golden.test.ts pins): a failure of this file alone is a change in the worklet.
//
// REGENERATE ONLY DELIBERATELY, after a change that is meant to alter the sound of the C172, and review the diff
// of the JSON:
//   FS_GOLDEN_UPDATE=1 npx vitest run tests/golden/c172Audio.golden.test.ts

import { describe, it } from 'vitest';
import { golden } from './golden';
import { BLOCK, SR, SynthHost } from './rigs/workletHost';

const FILE = 'c172Audio';

/** The four stems of today's worklet by output index (src/audio/params.ts STEM), written out. */
const STEMS = ['engine', 'prop', 'airframe', 'cabin'] as const;

const SECONDS = 4;
/** A new parameter block every 6 render quanta (16 ms: about one 60 Hz frame of the application). */
const BLOCKS_PER_UPDATE = 6;
/** 100 ms of samples. */
const WINDOW = SR / 10;
/** Raw samples: 25 consecutive ones starting at each of these times, s (cranking, the first firing strokes, the slam, the run-down). */
const RAW_AT = [0.5, 1.2, 2.5, 3.6] as const;
const RAW_COUNT = 25;

/** 0 before t0, 1 after t1, linear between. */
const ramp = (t: number, t0: number, t1: number): number => Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));
/** 1 from t0 until t1, else 0. */
const pulse = (t: number, t0: number, t1: number): number => (t >= t0 && t < t1 ? 1 : 0);

/**
 * The parameter block at script time t (s). Every one of today's 23 parameters is set on every update.
 *
 *   0.0  master on: gyros and the avionics fan run up, a little wind over the parked aircraft
 *   0.3  starter: cranking at 0 -> 150 rpm
 *   1.0  the engine fires; starter released at 1.05; 150 -> 800 rpm by 1.5, rough at first
 *   1.6  flap motor for 0.4 s
 *   2.2  throttle slam: 800 -> 2300 rpm by 3.0, the load and the propeller with it; the aircraft rolls from 2.6
 *   3.0  a tyre chirp (one-shot message), the stall horn for 0.15 s
 *   3.4  mixture cut: combustion stops, the propeller runs down to 300 rpm by 4.0
 */
function script(t: number) {
  const cranking = 150 * ramp(t, 0.3, 0.9);
  const idle = 650 * ramp(t, 1.0, 1.5);
  const slam = 1500 * ramp(t, 2.2, 3.0);
  const rundown = 1 - (2000 / 2300) * ramp(t, 3.4, 4.0);
  const rpm = (cranking + idle + slam) * rundown;
  const power = ramp(t, 2.2, 2.9) * (1 - ramp(t, 3.4, 3.45));
  return {
    rpm,
    firing: pulse(t, 1.0, 3.4),
    load: (0.12 * ramp(t, 1.0, 1.3) + 0.98 * power) * (1 - ramp(t, 3.4, 3.5)),
    throttle: 0.12 + 0.88 * ramp(t, 2.2, 2.3) * (1 - ramp(t, 3.4, 3.5)),
    starter: pulse(t, 0.3, 1.05),
    roughness: 0.6 * (1 - ramp(t, 1.0, 1.8)) + 0.5 * ramp(t, 3.4, 3.5),
    propLoad: 0.15 * ramp(t, 1.0, 1.5) + 1.15 * power,
    tipMach: (rpm / 2300) * 0.72,
    windLevel: 0.02 + 0.25 * ramp(t, 2.6, 4.0),
    windFreq: 300 + 250 * ramp(t, 2.6, 4.0),
    slip: 0.2 * ramp(t, 2.8, 3.2),
    flapNoise: 0.3 * pulse(t, 3.0, 4.0),
    buffet: 0.25 * pulse(t, 3.1, 3.3),
    horn: 0.7 * pulse(t, 3.0, 3.15),
    flapMotor: pulse(t, 1.6, 2.0),
    rolling: 0.6 * ramp(t, 2.6, 3.2),
    rollSpeed: 14 * ramp(t, 2.6, 4.0),
    surface: t < 3.5 ? 0 : 1,
    brakeSqueal: 0.4 * pulse(t, 3.7, 3.9),
    skid: 0.5 * pulse(t, 3.0, 3.1),
    gyro: ramp(t, 0, 3),
    fan: ramp(t, 0.1, 0.4),
    turbulence: 0.3,
  };
}

describe('C172 sound golden master (synthesis worklet)', () => {
  it('start, idle, throttle slam, chirp and shut-down: per-stem RMS per 100 ms, raw samples, sums', () => {
    golden(FILE, 'script', (r) => {
      const host = new SynthHost();
      const blocks = (SECONDS * SR) / BLOCK;
      const stems = STEMS.map(() => new Float32Array(blocks * BLOCK));
      const chirpBlock = Math.round((3.0 * SR) / BLOCK);
      for (let b = 0; b < blocks; b++) {
        if (b % BLOCKS_PER_UPDATE === 0) host.set(script((b * BLOCK) / SR));
        if (b === chirpBlock) host.message({ type: 'chirp', amp: 1.2 });
        const out = host.block();
        for (let s = 0; s < STEMS.length; s++) stems[s].set(out[s], b * BLOCK);
      }
      r.put('sampleRate', SR);
      r.put('samples', blocks * BLOCK);
      STEMS.forEach((name, s) => {
        const x = stems[s];
        let sum = 0, squares = 0;
        for (let i = 0; i < x.length; i++) {
          sum += x[i];
          squares += x[i] * x[i];
        }
        r.put(`${name}/sum`, sum);
        r.put(`${name}/sumSquares`, squares);
        for (let w = 0; w < x.length / WINDOW; w++) {
          let e = 0;
          for (let i = w * WINDOW; i < (w + 1) * WINDOW; i++) e += x[i] * x[i];
          r.put(`${name}/rms@${(w / 10).toFixed(1)}`, Math.sqrt(e / WINDOW));
        }
        for (const t of RAW_AT) r.list(`${name}/raw@${t.toFixed(1)}`, x.subarray(t * SR, t * SR + RAW_COUNT));
      });
    });
  });
});
