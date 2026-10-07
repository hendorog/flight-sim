// Records the audio parameter stream of real flight phases (the real flight model in the real world, via
// SimPhysics) and renders it through the real synthesis worklet and the modelled mix. Shared by the audio
// level tests.

import { C172S_AUDIO } from '../../src/aircraft/c172s/audio';
import { SoundTracker, chirpAmplitude, gearThumpAmplitude } from '../../src/audio/mapping';
import { STEM, STEM_COUNT } from '../../src/audio/params';
import type { AudioProfile } from '../../src/audio/profile';
import { createEventBus, type ScenarioId } from '../../src/core/context';
import { defaultWeather, type WeatherSettings } from '../../src/core/types';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { BLOCK, SR, SynthHost } from './workletHost';

export const FPS = 60;
const SAMPLES_PER_FRAME = SR / FPS;

export interface AudioFrame {
  params: Float32Array;
  messages: unknown[];
}

export interface Recording {
  name: string;
  frames: AudioFrame[];
  /** Per-frame notes (e.g. whether the stall warning was on). */
  marks: Record<string, boolean[]>;
}

export class FlightRecorder {
  readonly physics: SimPhysics;
  readonly weather: WeatherSettings;
  private readonly tracker: SoundTracker;
  private pending: unknown[] = [];

  /** `profile`: the sound profile the parameter stream is mapped with (the flight model stays the one SimPhysics builds). */
  constructor(weather: Partial<WeatherSettings> = {}, profile: AudioProfile = C172S_AUDIO) {
    this.tracker = new SoundTracker(profile);
    this.weather = { ...defaultWeather(), turbulence: 0.1, ...weather };
    const events = createEventBus();
    this.physics = new SimPhysics({ weather: this.weather, events });
    events.on('touchdown', (e) => this.pending.push({ type: 'chirp', amp: chirpAmplitude(e.sinkRate) }));
    events.on('crash', () => this.pending.push({ type: 'crash', amp: 1 }));
    events.on('gear', (e) => this.pending.push({ type: 'thump', amp: gearThumpAmplitude(e.kind) }));
  }

  reset(id: ScenarioId): this {
    this.physics.reset(id, this.weather);
    this.tracker.reset(this.physics.state);
    this.pending = [];
    return this;
  }

  /** Fly `seconds` without recording (the tracker still follows). */
  skip(seconds: number, each?: (t: number) => boolean | void): void {
    for (let t = 0; t < seconds; t += 1 / FPS) {
      if (each?.(t) === true) break;
      this.frame();
    }
    this.pending = [];
  }

  /** Fly and record `seconds`; `each` runs before every frame (return true to stop early). */
  record(name: string, seconds: number, each?: (t: number) => boolean | void): Recording {
    const rec: Recording = { name, frames: [], marks: { stall: [], onGround: [] } };
    for (let t = 0; t < seconds; t += 1 / FPS) {
      if (each?.(t) === true) break;
      const params = this.frame();
      rec.frames.push({ params: params.slice(), messages: this.pending });
      this.pending = [];
      rec.marks.stall.push(this.physics.state.stallWarning);
      rec.marks.onGround.push(this.physics.state.onGround);
    }
    return rec;
  }

  private frame(): Float32Array {
    const p = this.physics;
    p.step(1 / FPS);
    return this.tracker.update(p.renderState, p.controls, p.env, this.weather, 1 / FPS);
  }
}

/** Render a recording through the synthesis worklet (configured for `profile` when given): one Float32Array per stem. */
export function renderRecording(rec: Recording, profile?: AudioProfile): Float32Array[] {
  const host = new SynthHost(profile);
  const blocks = Math.floor((rec.frames.length * SAMPLES_PER_FRAME) / BLOCK);
  const stems = Array.from({ length: STEM_COUNT }, () => new Float32Array(blocks * BLOCK));
  let frame = -1;
  for (let b = 0; b < blocks; b++) {
    const f = Math.floor((b * BLOCK) / SAMPLES_PER_FRAME);
    while (frame < f) {
      frame++;
      host.setBlock(rec.frames[frame].params);
      for (const m of rec.frames[frame].messages) host.message(m);
    }
    const out = host.block();
    for (let s = 0; s < STEM_COUNT; s++) stems[s].set(out[s], b * BLOCK);
  }
  return stems;
}

export { STEM };
