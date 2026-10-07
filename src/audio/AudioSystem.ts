// Procedural aircraft audio: a synthesis AudioWorklet producing four stems (engine, propeller, airframe,
// cabin) and a Web Audio graph that places the listener inside or outside the aircraft.
//
//   stems --> interior chain: low-pass (the cabin blocks highs) + cabin resonance peaks --> interior gain --+
//         \-> exterior chain: propagation delay (Doppler) -> air absorption -> distance gain -> pan ---> exterior gain -+-> speech duck -> master -> limiter -> out
//
// Flight School speech cues (setDuck, chime) live in the same AudioContext: the duck lowers the engine/air mix
// under cabin speech; chimes (synthChime) feed the master directly, so they are never ducked.
//
// The interior/exterior crossfade follows ctx.cameraMode ('cockpit' = interior). Web Audio may only start
// after a user gesture, so the context is created on the first pointer/key event (or by calling start()).
// Must update after CameraSystem so the listener position is this frame's camera.

import * as THREE from 'three';
import { C172S_AUDIO } from '../aircraft/c172s/audio';
import type { SimContext, Subsystem } from '../core/context';
import { nedToThree } from '../core/frames';
import { airAbsorptionCutoff, chirpAmplitude, distanceGain, gearThumpAmplitude, propagationDelay, SoundTracker } from './mapping';
import { DEFAULT_VOLUME, LIMITER, mixFor, type BiquadSpec, type StemRoute } from './mix';
import { STEM_COUNT } from './params';
import type { AudioProfile } from './profile';
import { SYNTH_PROCESSOR_NAME, SYNTH_SOURCE } from './synthSource';

const VOLUME_KEY = 'fs.audio.volume';
/** Events that can carry the user activation an AudioContext needs to start or resume. */
const GESTURES = ['pointerdown', 'pointerup', 'click', 'keydown', 'touchend'] as const;
/** Relative speed above which a distance change is treated as a camera cut rather than motion, m/s. */
const CUT_SPEED = 250;
/** Longest propagation delay the exterior path supports, s (about 4 km). */
const MAX_DELAY = 12;
/** Wait for the master fade-out (time constant 80 ms) before suspending the AudioContext, ms. */
const SUSPEND_DELAY_MS = 400;

interface Graph {
  ac: AudioContext;
  synth: AudioWorkletNode;
  interior: GainNode;
  exterior: GainNode;
  delay: DelayNode;
  absorb: BiquadFilterNode;
  distance: GainNode;
  pan: StereoPannerNode;
  /** Instructor-speech duck on the engine/air mix (interior + exterior), before the master. */
  duck: GainNode;
  master: GainNode;
  /** The nodes of the profile's mix (stem routes, the two sums, the cabin resonances), kept so that another profile can replace them. */
  mix: AudioNode[];
}

/** Deepest duck of the engine/air mix under cabin speech, dB (section 3.7.2). */
export const MAX_DUCK_DB = 6;
/** Duck ramp time, s. */
export const DUCK_RAMP_S = 0.15;

/** Linear gain for a duck amount 0..1 (0 dB .. -6 dB). */
export function duckGain(amount: number): number {
  const a = Number.isFinite(amount) ? Math.min(1, Math.max(0, amount)) : 0;
  return 10 ** ((-MAX_DUCK_DB * a) / 20);
}

export type ChimeKind = 'intercom' | 'caption' | 'radio';

/**
 * Synthesise a speech cue into `dest` at audio time `t` (section 3.7.2): 'intercom' is a 15 ms band-passed noise
 * click before instructor lines, 'caption' a soft two-tone chime for new lines in captions-only mode, 'radio'
 * a squelch tail. One-shot nodes only: each source is stopped, so the graph frees itself.
 */
export function synthChime(ac: BaseAudioContext, dest: AudioNode, kind: ChimeKind, t: number): void {
  const noise = (seconds: number): AudioBufferSourceNode => {
    const n = Math.max(1, Math.round(ac.sampleRate * seconds));
    const buf = ac.createBuffer(1, n, ac.sampleRate);
    const data = buf.getChannelData(0);
    // Deterministic noise (a small LCG): the click sounds the same every time.
    let x = 0x2545f491;
    for (let i = 0; i < n; i++) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      data[i] = x / 0x80000000 - 1;
    }
    return new AudioBufferSourceNode(ac, { buffer: buf });
  };
  if (kind === 'caption') {
    // Two soft sine tones a fifth apart (E5, B5), each with a 10 ms attack and a 350 ms decay.
    [659.25, 987.77].forEach((f, i) => {
      const at = t + i * 0.12;
      const osc = new OscillatorNode(ac, { type: 'sine', frequency: f });
      const env = new GainNode(ac, { gain: 0 });
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(0.12, at + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, at + 0.36);
      osc.connect(env).connect(dest);
      osc.start(at);
      osc.stop(at + 0.4);
    });
    return;
  }
  const radio = kind === 'radio';
  const dur = radio ? 0.12 : 0.015;
  const src = noise(dur);
  const band = new BiquadFilterNode(ac, { type: 'bandpass', frequency: radio ? 2500 : 1800, Q: radio ? 0.8 : 1.2 });
  const env = new GainNode(ac, { gain: 0 });
  env.gain.setValueAtTime(radio ? 0.18 : 0.25, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(band).connect(env).connect(dest);
  src.start(t);
  src.stop(t + dur + 0.01);
}

function loadVolume(): number {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY));
    return localStorage.getItem(VOLUME_KEY) !== null && Number.isFinite(v) ? v : DEFAULT_VOLUME;
  } catch {
    return DEFAULT_VOLUME;
  }
}

/** The audio graph cannot be built here; the message is written for the user. */
export class AudioUnavailableError extends Error {}

export interface AudioSystemOptions {
  /** Sound profile of the aircraft type flown. Default: the Cessna 172S. */
  profile?: AudioProfile;
}

export class AudioSystem implements Subsystem {
  private g: Graph | null = null;
  private starting: Promise<void> | null = null;
  private ctx!: SimContext;
  private volume = loadVolume();
  private muted = false;
  /** Speech duck amount 0..1 (setDuck). */
  private duckAmount = 0;
  /** The simulation is paused (in-app pause, hidden tab, lost WebGL context): silence and suspend. */
  private pausedMute = false;
  /** The page is hidden (the frame loop, and so update(), no longer runs). */
  private hidden = false;
  /** The WebGL context was lost (the frame loop stops rendering). */
  private contextLost = false;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  private profile: AudioProfile;
  private tracker: SoundTracker;
  private lastDistance = -1;
  private lastWall = 0;
  /** Audio time until which a camera-cut duck owns the exterior delay/gain automation. */
  private holdUntil = 0;
  private readonly aircraftPos = new THREE.Vector3();
  private readonly toSource = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly unsubscribe: (() => void)[] = [];

  constructor(opts: AudioSystemOptions = {}) {
    this.profile = opts.profile ?? C172S_AUDIO;
    this.tracker = new SoundTracker(this.profile);
  }

  init(ctx: SimContext): void {
    this.ctx = ctx;
    this.pausedMute = ctx.paused;
    if (typeof document !== 'undefined') {
      this.hidden = document.hidden;
      document.addEventListener('visibilitychange', this.onVisibility);
    }
    ctx.renderer?.domElement?.addEventListener('webglcontextlost', this.onContextLost);
    ctx.renderer?.domElement?.addEventListener('webglcontextrestored', this.onContextRestored);
    for (const type of GESTURES) window.addEventListener(type, this.onGesture, { capture: true });
    this.unsubscribe.push(
      ctx.events.on('touchdown', (e) => this.g?.synth.port.postMessage({ type: 'chirp', amp: chirpAmplitude(e.sinkRate) })),
      ctx.events.on('crash', () => this.g?.synth.port.postMessage({ type: 'crash', amp: 1 })),
      // Retractable gear: a leg unlocking, locking down or reaching its well.
      ctx.events.on('gear', (e) => this.g?.synth.port.postMessage({ type: 'thump', amp: gearThumpAmplitude(e.kind) })),
      // React to a pause at once: update() runs in the frame loop, which stops altogether when the tab is
      // hidden or the WebGL context is lost, and the worklet would otherwise keep synthesising the last
      // engine, propeller and wind parameters indefinitely.
      ctx.events.on('paused', (e) => this.setSilenced('pause', e.paused)),
      // A scenario reset teleports the aircraft: restart the gyro and flap-motor trackers and treat the
      // listener jump as a camera cut (no Doppler sweep).
      ctx.events.on('reset', () => {
        this.tracker.reset(ctx.state);
        this.lastDistance = -1;
      }),
    );
    // Gyros already spinning if the simulation starts with the engine running.
    this.tracker.reset(ctx.state);
  }

  dispose(): void {
    this.removeGestureListeners();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    this.ctx?.renderer?.domElement?.removeEventListener('webglcontextlost', this.onContextLost);
    this.ctx?.renderer?.domElement?.removeEventListener('webglcontextrestored', this.onContextRestored);
    if (this.suspendTimer !== null) clearTimeout(this.suspendTimer);
    this.unsubscribe.forEach((u) => u());
    void this.g?.ac.close();
    this.g = null;
  }

  /** True once the audio graph is running. */
  get running(): boolean {
    return this.g !== null && this.g.ac.state === 'running';
  }

  /** Master volume 0..1, persisted. */
  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    try {
      localStorage.setItem(VOLUME_KEY, String(this.volume));
    } catch {
      // Not persisted in private mode.
    }
    this.applyMaster();
  }

  getVolume(): number {
    return this.volume;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyMaster();
  }

  isMuted(): boolean {
    return this.muted;
  }

  /**
   * Lower the engine/air mix while cabin speech plays: `amount` 0..1 maps to 0..-6 dB, ramped over 150 ms.
   * Remembered before the graph exists. Chimes and the master volume are not affected.
   */
  setDuck(amount: number): void {
    this.duckAmount = Number.isFinite(amount) ? Math.min(1, Math.max(0, amount)) : 0;
    const g = this.g;
    if (!g) return;
    const now = g.ac.currentTime;
    const p = g.duck.gain;
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.linearRampToValueAtTime(duckGain(this.duckAmount), now + DUCK_RAMP_S);
  }

  /**
   * Change the sound profile: the worklet's voices (a message), the parameter mapping and the two mix chains.
   * Remembered before the graph exists.
   */
  setProfile(profile: AudioProfile): void {
    if (profile === this.profile) return;
    this.profile = profile;
    this.tracker = new SoundTracker(profile);
    if (this.ctx) this.tracker.reset(this.ctx.state);
    const g = this.g;
    if (!g) return;
    g.synth.port.postMessage({ type: 'config', profile });
    g.mix = this.buildMix(g.ac, g.synth, g.interior, g.delay, g.mix);
  }

  /** Play a speech cue (intercom click, captions-only chime, radio squelch). Silent before the first gesture. */
  chime(kind: ChimeKind): void {
    const g = this.g;
    if (!g || g.ac.state !== 'running') return;
    synthChime(g.ac, g.master, kind, g.ac.currentTime + 0.005);
  }

  /** Create and start the audio graph. Called automatically on the first user gesture. */
  start(): Promise<void> {
    this.starting ??= this.build().catch((err: unknown) => {
      console.error('[audio] failed to start', err);
      this.starting = null;
      this.onError?.(err instanceof AudioUnavailableError ? err.message : 'Sound could not start: see the browser console for the reason.');
    });
    return this.starting;
  }

  private meter: { node: AnalyserNode; buf: Float32Array<ArrayBuffer> } | null = null;

  /** One-line state of the audio path for the F8 readout: enough to tell why there is no sound. */
  status(): string {
    const g = this.g;
    if (!g) return this.starting ? 'audio: starting...' : 'audio: not started (waiting for a click or key press)';
    if (!this.meter || this.meter.node.context !== g.ac) {
      const node = new AnalyserNode(g.ac, { fftSize: 1024 });
      g.master.connect(node);
      this.meter = { node, buf: new Float32Array(node.fftSize) };
    }
    this.meter.node.getFloatTimeDomainData(this.meter.buf);
    let sum = 0;
    for (const v of this.meter.buf) sum += v * v;
    const db = 20 * Math.log10(Math.sqrt(sum / this.meter.buf.length) + 1e-9);
    const why = [this.muted && 'muted', this.pausedMute && 'paused', this.hidden && 'hidden', this.contextLost && 'gl-lost'].filter(Boolean).join(',');
    const f = (v: number): string => v.toFixed(2);
    return `audio: ${g.ac.state} t=${g.ac.currentTime.toFixed(1)}s ${Math.round(g.ac.sampleRate)}Hz out=${db.toFixed(0)}dB vol=${f(this.volume)} `
      + `master=${f(g.master.gain.value)} duck=${f(g.duck.gain.value)} int=${f(g.interior.gain.value)} ext=${f(g.exterior.gain.value)}${why ? ` silenced:${why}` : ''}`;
  }

  /** Called when the audio graph cannot be built, with a reason fit to show the user. */
  onError: ((reason: string) => void) | null = null;

  /**
   * Every user gesture, for the life of the page: the first builds the graph, later ones wake a context the
   * browser left suspended. A context is only allowed to run from an activating gesture (not every event that
   * starts one qualifies, e.g. Escape or the start of a touch), and a suspend that lands after sound was wanted
   * again can only be undone by a resume, so one attempt at start-up is not enough.
   */
  private readonly onGesture = (): void => {
    if (!this.g) void this.start().then(() => this.applyRunState());
    else this.ensureRunning();
  };

  /** Wall time of the last resume attempt made from the frame loop, ms. */
  private lastResumeTry = -Infinity;

  /**
   * Resume a context that is not running when sound is wanted. Any state but 'running' and 'closed' counts:
   * Safari reports 'interrupted' (not 'suspended') after a phone call, the screen lock, another app taking the
   * audio session or the tab going to the background, and only a resume brings it back. From the frame loop
   * (`throttle`) it tries at most once a second, since without a user gesture the browser refuses and warns.
   */
  private ensureRunning(throttle = false): void {
    const g = this.g;
    if (!g || this.silenced) return;
    const state = g.ac.state as string;
    if (state === 'running' || state === 'closed') return;
    if (throttle) {
      const now = performance.now();
      if (now - this.lastResumeTry < 1000) return;
      this.lastResumeTry = now;
    }
    void g.ac.resume().catch(() => undefined);
  }

  private readonly onVisibility = (): void => this.setSilenced('hidden', document.hidden);
  private readonly onContextLost = (): void => this.setSilenced('context', true);
  private readonly onContextRestored = (): void => this.setSilenced('context', false);

  /** True while the sound must be silent and the audio clock stopped. */
  private get silenced(): boolean {
    return this.pausedMute || this.hidden || this.contextLost;
  }

  private setSilenced(reason: 'pause' | 'hidden' | 'context', on: boolean): void {
    if (reason === 'pause') this.pausedMute = on;
    else if (reason === 'hidden') this.hidden = on;
    else this.contextLost = on;
    this.applyMaster();
    this.applyRunState();
  }

  /**
   * Suspend the AudioContext while silenced (after the master fade, so there is no click; this also stops
   * the synthesis worklet using CPU in a background tab) and resume it when sound returns.
   */
  private applyRunState(): void {
    const g = this.g;
    if (!g || g.ac.state === 'closed') return;
    if (this.suspendTimer !== null) {
      clearTimeout(this.suspendTimer);
      this.suspendTimer = null;
    }
    if (this.silenced) {
      this.suspendTimer = setTimeout(() => {
        this.suspendTimer = null;
        // The suspend is asynchronous: if sound is wanted again before it lands, the context reports 'running'
        // to that request and would then stay suspended, so check again once it has settled.
        if (this.silenced && this.g === g && g.ac.state === 'running') void g.ac.suspend().then(() => this.ensureRunning());
      }, SUSPEND_DELAY_MS);
    } else if (g.ac.state !== 'running') {
      void g.ac.resume().catch(() => undefined);
    }
  }

  private removeGestureListeners(): void {
    for (const type of GESTURES) window.removeEventListener(type, this.onGesture, { capture: true });
  }

  private async build(): Promise<void> {
    if (typeof AudioContext === 'undefined') throw new AudioUnavailableError('Sound is not available: this browser has no Web Audio.');
    // iPhone and iPad: Web Audio is 'ambient' by default and the ring/silent switch mutes it altogether (while
    // speech and video still play). The simulator's sound is the point of the page, so ask for media playback.
    try {
      const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
      if (session && session.type !== 'playback') session.type = 'playback';
    } catch {
      // Not supported: leave the default.
    }
    const ac = new AudioContext({ latencyHint: 'interactive' });
    // The browser can stop the context on its own (Safari: 'interrupted'); bring it back as soon as it allows.
    ac.addEventListener('statechange', () => {
      if (this.g?.ac === ac) this.ensureRunning();
    });
    // AudioWorklet exists only in secure contexts (https, or http://localhost). Opening the dev server by IP
    // address or host name from another device is not one, and the synthesis cannot start there.
    if (!ac.audioWorklet) {
      void ac.close();
      throw new AudioUnavailableError(
        'No sound: this address is not a secure page. Open the simulator at http://localhost or over HTTPS (npm run dev:https).',
      );
    }
    const url = URL.createObjectURL(new Blob([SYNTH_SOURCE], { type: 'application/javascript' }));
    try {
      await ac.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const synth = new AudioWorkletNode(ac, SYNTH_PROCESSOR_NAME, {
      numberOfInputs: 0,
      numberOfOutputs: STEM_COUNT,
      outputChannelCount: new Array(STEM_COUNT).fill(1),
    });
    // The worklet's built-in voices are the Cessna 172S: another type is a message, ahead of the first parameters.
    if (this.profile !== C172S_AUDIO) synth.port.postMessage({ type: 'config', profile: this.profile });

    const gain = (v: number): GainNode => new GainNode(ac, { gain: v });

    // The profile's mix (see mix.ts): interior (cockpit) into its path gain; exterior, the raw sources, into
    // the propagation chain.
    const interior = gain(0);
    const delay = new DelayNode(ac, { maxDelayTime: MAX_DELAY, delayTime: 0.05 });
    const mix = this.buildMix(ac, synth, interior, delay, []);
    const absorb = new BiquadFilterNode(ac, { type: 'lowpass', frequency: 20000, Q: 0.5 });
    const distance = gain(1);
    const pan = new StereoPannerNode(ac, { pan: 0 });
    const exterior = gain(0);
    delay.connect(absorb).connect(distance).connect(pan).connect(exterior);

    // Master: volume/mute, then a limiter so a crash or a close flyby never clips.
    // The speech duck sits on the engine/air mix only, so chimes (fed to the master) are never ducked.
    const master = gain(0);
    const limiter = new DynamicsCompressorNode(ac, LIMITER);
    const duck = gain(duckGain(this.duckAmount));
    interior.connect(duck);
    exterior.connect(duck);
    duck.connect(master);
    master.connect(limiter).connect(ac.destination);

    this.g = { ac, synth, interior, exterior, delay, absorb, distance, pan, duck, master, mix };
    this.lastDistance = -1;
    this.pushParams(0);
    this.applyMaster();
    this.applyRunState();
  }

  /**
   * Connect the worklet's stems through the mix of the profile: the interior routes and cabin resonances into
   * `interior`, the exterior routes into `delay`. `old`: the nodes of the mix this one replaces. Returns its nodes.
   */
  private buildMix(ac: AudioContext, synth: AudioWorkletNode, interior: AudioNode, delay: AudioNode, old: AudioNode[]): AudioNode[] {
    if (old.length > 0) {
      synth.disconnect();
      for (const node of old) node.disconnect();
    }
    const nodes: AudioNode[] = [];
    const gain = (v: number): GainNode => {
      const node = new GainNode(ac, { gain: v });
      nodes.push(node);
      return node;
    };
    const filter = (f: BiquadSpec): BiquadFilterNode => {
      const node = new BiquadFilterNode(ac, { type: f.type, frequency: f.frequency, Q: f.Q, gain: f.gainDb ?? 0 });
      nodes.push(node);
      return node;
    };
    /** stem -> filters -> gain -> bus, as described by a route in mix.ts. */
    const route = (r: StemRoute, bus: AudioNode): void => {
      let node: AudioNode = gain(r.gain);
      synth.connect(node, r.stem);
      for (const f of r.filters) node = node.connect(filter(f));
      node.connect(bus);
    };
    const chain = (from: AudioNode, filters: BiquadSpec[], to: AudioNode): void => {
      let node = from;
      for (const f of filters) node = node.connect(filter(f));
      node.connect(to);
    };

    const mix = mixFor(this.profile);
    const interiorSum = gain(mix.interiorLevel);
    for (const r of mix.interiorRoutes) route(r, interiorSum);
    chain(interiorSum, mix.interiorBus, interior);
    const exteriorSum = gain(mix.exteriorLevel);
    for (const r of mix.exteriorRoutes) route(r, exteriorSum);
    exteriorSum.connect(delay);
    return nodes;
  }

  private applyMaster(): void {
    const g = this.g;
    if (!g) return;
    const target = this.muted || this.silenced ? 0 : this.volume;
    g.master.gain.setTargetAtTime(target, g.ac.currentTime, 0.08);
  }

  update(dt: number, ctx: SimContext): void {
    const g = this.g;
    if (!g) return;
    // Normally already handled by the 'paused' event; this catches a pause set without one.
    if (ctx.paused !== this.pausedMute) this.setSilenced('pause', ctx.paused);
    if (ctx.paused) return;
    this.ensureRunning(true);
    this.pushParams(dt);
    this.spatialise(g, ctx);
  }

  private pushParams(dt: number): void {
    const ctx = this.ctx;
    const params = this.tracker.update(ctx.state, ctx.controls, ctx.env, ctx.weather, dt);
    this.g?.synth.port.postMessage(params);
  }

  private spatialise(g: Graph, ctx: SimContext): void {
    const now = g.ac.currentTime;
    const interior = ctx.cameraMode === 'cockpit' ? 1 : 0;
    g.interior.gain.setTargetAtTime(interior, now, 0.12);
    g.exterior.gain.setTargetAtTime(1 - interior, now, 0.12);

    const cam = ctx.camera;
    nedToThree(ctx.state.position, this.aircraftPos);
    const d = this.toSource.subVectors(this.aircraftPos, cam.position).length();
    const wall = performance.now();
    const wallDt = Math.max(1e-3, (wall - this.lastWall) / 1000);
    this.lastWall = wall;

    const delay = propagationDelay(d);
    const cut = this.lastDistance < 0 || Math.abs(d - this.lastDistance) / wallDt > CUT_SPEED;
    this.lastDistance = d;
    if (cut) {
      // Camera cut: jumping the delay line would sweep the pitch. Duck the exterior path, move the delay
      // while silent, and bring it back.
      g.distance.gain.cancelScheduledValues(now);
      g.distance.gain.setTargetAtTime(0, now, 0.008);
      g.delay.delayTime.cancelScheduledValues(now);
      g.delay.delayTime.setValueAtTime(delay, now + 0.04);
      g.distance.gain.setTargetAtTime(distanceGain(d), now + 0.05, 0.03);
      this.holdUntil = now + 0.06;
    } else if (now >= this.holdUntil) {
      // Moving source/listener: a smoothly varying delay is exactly the Doppler shift.
      g.delay.delayTime.setTargetAtTime(delay, now, 0.05);
      g.distance.gain.setTargetAtTime(distanceGain(d), now, 0.05);
    }
    g.absorb.frequency.setTargetAtTime(airAbsorptionCutoff(d), now, 0.1);

    // Stereo position: the source's direction projected on the camera's right axis.
    this.right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    const pan = d > 0.5 ? (this.toSource.dot(this.right) / d) * 0.8 : 0;
    g.pan.pan.setTargetAtTime(pan, now, 0.05);
  }
}
