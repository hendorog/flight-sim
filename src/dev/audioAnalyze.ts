// Offline analysis for the audio dev page: renders scripted scenarios through the real synthesis worklet
// in an OfflineAudioContext and draws a labelled spectrogram per stem, so the synthesis can be checked
// visually (harmonic lines at the firing frequency, start stumble, blade-passage tone, horn pitch...).
//
//   type=<id>     the sound profile of that aircraft type (registry); default the Cessna 172S
//   engines=2     that profile with its engine twice (0.71 each) and a retractable gear with pump and horn: the
//                 two-engine path of the worklet for a type that has one engine
// With two engines the second runs 2 % faster than the script says (the beat shows as a slow ripple of the
// lines); with a retractable gear the script cycles it in the cruise and sounds its warning.

import { C172S_AUDIO } from '../aircraft/c172s/audio';
import { isAircraftId, loadPresentation } from '../aircraft/registry';
import { gearThumpAmplitude, gearWind, turboSpool } from '../audio/mapping';
import { ENGINE_P, ENGINE_PARAMS, P, PARAM_COUNT, STEM, STEM_COUNT, type SynthParamName } from '../audio/params';
import type { AudioProfile } from '../audio/profile';
import { SYNTH_PROCESSOR_NAME, SYNTH_SOURCE } from '../audio/synthSource';

const SR = 48000;

interface Step {
  t: number;
  set?: Partial<Record<SynthParamName, number>>;
  msg?: unknown;
  label?: string;
}

/** Engine start, idle, run-up to full power, cruise, stall horn, shutdown. */
const SCRIPT: Step[] = [
  { t: 0, set: { starter: 1, rpm: 170, throttle: 0.1, gyro: 0.3, fan: 1 }, label: 'crank' },
  { t: 1.6, set: { firing: 1, rpm: 750, load: 0.06 }, label: 'catch' },
  { t: 2.0, set: { starter: 0 } },
  { t: 2.4, set: { rpm: 650, propLoad: 0.1, tipMach: 0.19 }, label: 'idle' },
  { t: 4.5, set: { rpm: 1700, load: 0.4, throttle: 0.4, propLoad: 0.6, tipMach: 0.5 }, label: '1700' },
  { t: 6.5, set: { rpm: 2350, load: 1.0, throttle: 1, propLoad: 1.6, tipMach: 0.71 }, label: 'full' },
  { t: 8.5, set: { rpm: 2450, load: 0.75, throttle: 0.75, propLoad: 1.0, tipMach: 0.78, windLevel: 1.3, windFreq: 770 }, label: 'cruise' },
  { t: 10.5, set: { rpm: 1500, load: 0.2, throttle: 0.2, propLoad: 0.2, tipMach: 0.45, windLevel: 0.35, windFreq: 520, horn: 0.5 }, label: 'horn' },
  { t: 11.5, set: { horn: 1, buffet: 0.8 } },
  { t: 12.5, set: { horn: 0, buffet: 0, flapMotor: 1 }, label: 'flap motor' },
  { t: 13.5, set: { flapMotor: 0, rolling: 0.8, rollSpeed: 22, windLevel: 0.2 }, msg: { type: 'chirp', amp: 1 }, label: 'touchdown' },
  { t: 14.5, set: { rpm: 900, load: 0.08, throttle: 0.05, propLoad: 0.1, tipMach: 0.25, brakeSqueal: 0.7, rolling: 0.3, rollSpeed: 4 }, label: 'brakes' },
  { t: 16, set: { firing: 0, brakeSqueal: 0, rolling: 0 }, label: 'shutdown' },
  { t: 16.1, set: { rpm: 0, tipMach: 0 } },
];
const DURATION = 18;

/** Added for a type with retractable gear: up after the run-up (pump, the legs out of the flow), down in the descent, the warning before it. */
const GEAR_SCRIPT: Step[] = [
  { t: 7.2, set: { gearPump: 1 }, msg: { type: 'thump', amp: gearThumpAmplitude('unlock') }, label: 'gear up' },
  { t: 8.2, set: { gearPump: 0 }, msg: { type: 'thump', amp: gearThumpAmplitude('up') } },
  { t: 9.4, set: { gearHorn: 1 }, label: 'gear warning' },
  { t: 10.4, set: { gearHorn: 0, gearPump: 1 }, msg: { type: 'thump', amp: gearThumpAmplitude('unlock') } },
  { t: 11.2, set: { gearPump: 0, gearWind: gearWind(1, 38) }, msg: { type: 'thump', amp: gearThumpAmplitude('downLocked') }, label: 'gear down' },
  { t: 14.5, set: { gearWind: 0 } },
];

/** The sound profile the query asks for. */
async function profileFromQuery(): Promise<AudioProfile> {
  const query = new URLSearchParams(location.search);
  const type = query.get('type');
  const profile = type !== null && isAircraftId(type) ? (await loadPresentation(type)).audio : C172S_AUDIO;
  if (query.get('engines') !== '2' || profile.engines.length > 1) return profile;
  const voice = { engine: { ...profile.engines[0].engine, level: 0.71 }, prop: { ...profile.engines[0].prop, level: 0.71 } };
  return { ...profile, engines: [voice, voice], gear: profile.gear ?? { pump: true, warningHorn: true } };
}

/** Fill what the script does not name: the propeller speed and turbocharger of engine 0, and the blocks of further engines. */
function fillEngines(params: Float32Array, profile: AudioProfile): void {
  for (let e = 0; e < Math.min(profile.engines.length, ENGINE_P.length); e++) {
    const ix = ENGINE_P[e];
    const engine = profile.engines[e].engine;
    if (e > 0) {
      for (const name of ENGINE_PARAMS) params[ix[name]] = params[P[name]];
      params[ix.rpm] *= 1.02;
    }
    params[ix.propRpm] = params[ix.rpm] / engine.gearRatio;
    params[ix.turbo] = engine.turbo ? turboSpool(params[ix.load], params[ix.firing] > 0) : 0;
  }
}

async function render(profile: AudioProfile): Promise<{ buffer: AudioBuffer; script: Step[] }> {
  const script = profile.gear ? [...SCRIPT, ...GEAR_SCRIPT].sort((a, b) => a.t - b.t) : SCRIPT;
  const oac = new OfflineAudioContext({ numberOfChannels: STEM_COUNT, length: DURATION * SR, sampleRate: SR });
  const url = URL.createObjectURL(new Blob([SYNTH_SOURCE], { type: 'application/javascript' }));
  await oac.audioWorklet.addModule(url);
  const node = new AudioWorkletNode(oac, SYNTH_PROCESSOR_NAME, {
    numberOfInputs: 0,
    numberOfOutputs: STEM_COUNT,
    outputChannelCount: new Array(STEM_COUNT).fill(1),
  });
  const merger = oac.createChannelMerger(STEM_COUNT);
  for (let s = 0; s < STEM_COUNT; s++) node.connect(merger, s, s);
  merger.connect(oac.destination);

  // Offline rendering runs far faster than real time and port messages are asynchronous, so each step
  // suspends the render, posts, and gives the message time to arrive before resuming.
  const params = new Float32Array(PARAM_COUNT);
  // The worklet's built-in voices are the Cessna 172S: another profile is a message, ahead of the first parameters.
  if (profile !== C172S_AUDIO) node.port.postMessage({ type: 'config', profile });
  // Two steps at one time share one suspension.
  const times = [...new Set(script.map((step) => Math.max(step.t, 128 / SR)))];
  for (const at of times) {
    void oac.suspend(at).then(async () => {
      const steps = script.filter((x) => Math.max(x.t, 128 / SR) === at);
      for (const step of steps) if (step.set) for (const [k, v] of Object.entries(step.set)) params[P[k as SynthParamName]] = v as number;
      if (profile !== C172S_AUDIO) fillEngines(params, profile);
      node.port.postMessage(params.slice());
      for (const step of steps) if (step.msg) node.port.postMessage(step.msg);
      await new Promise((r) => setTimeout(r, 30));
      await oac.resume();
    });
  }
  return { buffer: await oac.startRendering(), script };
}

/** In-place radix-2 FFT magnitude of a Hann-windowed frame. */
function fftMag(frame: Float32Array, re: Float64Array, im: Float64Array, out: Float32Array): void {
  const n = frame.length;
  for (let i = 0; i < n; i++) {
    re[i] = frame[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
    im[i] = 0;
  }
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const ar = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const ai = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k + len / 2] = re[i + k] - ar;
        im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
      }
    }
  }
  for (let i = 0; i < n / 2; i++) out[i] = Math.hypot(re[i], im[i]);
}

/** Spectrogram with a log frequency axis (30 Hz - 8 kHz), 80 dB range. */
function drawSpectrogram(g: CanvasRenderingContext2D, x: Float32Array, x0: number, y0: number, w: number, h: number, title: string): void {
  const N = 4096;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const mag = new Float32Array(N / 2);
  const img = g.createImageData(w, h);
  const fMin = 30;
  const fMax = 8000;
  for (let col = 0; col < w; col++) {
    const start = Math.floor((col / w) * (x.length - N));
    fftMag(x.subarray(start, start + N), re, im, mag);
    for (let row = 0; row < h; row++) {
      const f = fMin * Math.pow(fMax / fMin, 1 - row / (h - 1));
      const bin = Math.min(N / 2 - 1, Math.round((f * N) / SR));
      const db = 20 * Math.log10(mag[bin] / (N / 4) + 1e-9);
      const v = Math.max(0, Math.min(1, (db + 90) / 80));
      const o = (row * w + col) * 4;
      img.data[o] = 255 * Math.min(1, v * 1.8);
      img.data[o + 1] = 255 * Math.max(0, v * 1.8 - 0.6);
      img.data[o + 2] = 255 * Math.max(0, 0.6 - v) * v * 3;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, x0, y0);
  g.fillStyle = '#fff';
  g.font = '13px system-ui, sans-serif';
  g.fillText(title, x0 + 6, y0 + 16);
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000]) {
    const y = y0 + (1 - Math.log(f / fMin) / Math.log(fMax / fMin)) * (h - 1);
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.fillRect(x0, y, 6, 1);
    g.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x0 + 8, y + 4);
  }
}

export async function runAnalysis(): Promise<void> {
  document.body.style.cssText = 'margin:0;background:#111;color:#ddd;font:13px system-ui,sans-serif';
  const profile = await profileFromQuery();
  const { buffer: buf, script } = await render(profile);
  const canvas = document.createElement('canvas');
  const W = window.innerWidth;
  const H = window.innerHeight;
  canvas.width = W;
  canvas.height = H;
  document.body.appendChild(canvas);
  const g = canvas.getContext('2d')!;
  const rowH = Math.floor((H - 30) / 3);
  const engine = buf.getChannelData(STEM.engine);
  const prop = buf.getChannelData(STEM.prop);
  const mix = new Float32Array(engine.length);
  for (let i = 0; i < mix.length; i++) mix[i] = engine[i] + prop[i];
  drawSpectrogram(g, engine, 0, 20, W, rowH, 'engine stem');
  drawSpectrogram(g, prop, 0, 20 + rowH, W, rowH, 'propeller stem');
  const air = buf.getChannelData(STEM.airframe);
  const cabin = buf.getChannelData(STEM.cabin);
  const rest = new Float32Array(air.length);
  for (let i = 0; i < rest.length; i++) rest[i] = air[i] + cabin[i];
  drawSpectrogram(g, rest, 0, 20 + 2 * rowH, W, rowH, 'airframe + cabin stems');
  g.fillStyle = '#ddd';
  for (const s of script) {
    if (!s.label) continue;
    const x = (s.t / DURATION) * W;
    g.fillRect(x, 0, 1, 18);
    g.fillText(s.label, x + 3, 13);
  }
  let peakAll = 0;
  for (let c = 0; c < STEM_COUNT; c++) for (const v of buf.getChannelData(c)) peakAll = Math.max(peakAll, Math.abs(v));
  const stemPeak = (stem: number): number => buf.getChannelData(stem).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  (window as unknown as { __analysis: unknown }).__analysis = {
    peak: peakAll,
    finite: mix.every(Number.isFinite),
    engines: profile.engines.length,
    stems: [STEM.engine, STEM.prop, STEM.airframe, STEM.cabin].map(stemPeak),
  };
  (window as unknown as { __ready: boolean }).__ready = true;
}
