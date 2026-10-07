// Trace recording and encoding (section 3.11): 2 Hz channels, Int16Array per channel with scale and offset,
// base64; bands, events, demo spans and phase marks stored alongside. Round trip error < 0.5 % of each
// channel's range (in practice 1/65534 of it).
//
// Stored form (JSON text, about 45 kB for a 15-minute lesson):
//   { f: 'fs-trace', v: 1, id, lessonId, hz, n, ch: { <channel>: [offset, scale, base64] }, bands, events,
//     demoSpans, phases, interrupted }
// Int16 values are little-endian; -32768 encodes a missing sample (NaN).

import type { SignalFrame, TraceBand, TraceChannel, TraceData, TraceEvent } from '../types';

export const TRACE_HZ = 2;
export const TRACE_CHANNELS: readonly TraceChannel[] = [
  't', 'altFt', 'asiKt', 'hdgDeg', 'aiBankDeg', 'vsiFpm', 'pitchDeg', 'aglFt', 'north', 'east',
  'throttle', 'flapsDeg', 'gpDevFt', 'rwyAcrossM', 'authority',
];
const MISSING = -32768;
const QMAX = 32767;

const reading = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : NaN);

function emptyChannels(): Record<TraceChannel, number[]> {
  return Object.fromEntries(TRACE_CHANNELS.map((c) => [c, [] as number[]])) as unknown as Record<TraceChannel, number[]>;
}

export class TraceRecorder {
  private readonly id: string;
  private readonly lessonId: string;
  private channels = emptyChannels();
  private bands: TraceBand[] = [];
  private events: TraceEvent[] = [];
  private phases: { t: number; label: string }[] = [];
  private demoSpans: [number, number][] = [];
  private interrupted = false;
  private nextT = -Infinity;

  constructor(id: string, lessonId: string) {
    this.id = id;
    this.lessonId = lessonId;
  }

  /**
   * Called every frame; records at 2 Hz of sim time. `instructor`: authority channel. `pos` is the aircraft
   * position (NED, m: x north, y east) for the ground track: the signal frame has no position signal, so the
   * runner passes `src.state.position` here (omitted: the north/east channels record as missing).
   */
  sample(frame: Readonly<SignalFrame>, simT: number, instructor: boolean, pos?: Readonly<{ x: number; y: number }>): void {
    if (simT < this.nextT) return;
    // Stay on the 2 Hz grid (a long frame never makes the grid drift).
    const step = 1 / TRACE_HZ;
    this.nextT = Number.isFinite(this.nextT) && simT - this.nextT < step ? this.nextT + step : simT + step;
    const ch = this.channels;
    for (const c of TRACE_CHANNELS) {
      let v: number;
      if (c === 't') v = simT;
      else if (c === 'authority') v = instructor ? 1 : 0;
      else if (c === 'north') v = pos ? pos.x : NaN;
      else if (c === 'east') v = pos ? pos.y : NaN;
      else v = reading(frame[c]);
      ch[c].push(v);
    }
  }

  band(b: TraceBand): void {
    this.bands.push({ ...b });
  }

  event(e: TraceEvent): void {
    this.events.push({ ...e });
  }

  phase(t: number, label: string): void {
    this.phases.push({ t, label });
  }

  demoSpan(fromS: number, toS: number): void {
    this.demoSpans.push([fromS, toS]);
  }

  /** Samples recorded so far (CheckpointBlob.traceOffset). */
  get length(): number {
    return this.channels.t.length;
  }

  /** Drop samples, bands and events after `offset` samples (checkpoint retry). */
  truncate(offset: number): void {
    const n = this.length;
    if (offset >= n) return;
    const keep = Math.max(0, offset);
    // Everything stamped after the last kept sample belongs to the discarded attempt.
    const cutT = keep > 0 ? this.channels.t[keep - 1] : -Infinity;
    for (const c of TRACE_CHANNELS) this.channels[c].length = keep;
    this.bands = this.bands.filter((b) => b.fromS <= cutT).map((b) => ({ ...b, toS: Math.min(b.toS, cutT) }));
    this.events = this.events.filter((e) => e.t <= cutT);
    this.phases = this.phases.filter((p) => p.t <= cutT);
    this.demoSpans = this.demoSpans.filter(([a]) => a <= cutT).map(([a, b]) => [a, Math.min(b, cutT)] as [number, number]);
    this.nextT = keep > 0 ? cutT + 1 / TRACE_HZ : -Infinity;
  }

  markInterrupted(): void {
    this.interrupted = true;
  }

  data(): TraceData {
    const channels = Object.fromEntries(TRACE_CHANNELS.map((c) => [c, [...this.channels[c]]])) as unknown as Record<TraceChannel, number[]>;
    return {
      id: this.id, lessonId: this.lessonId, hz: TRACE_HZ, channels,
      bands: this.bands.map((b) => ({ ...b })), events: this.events.map((e) => ({ ...e })),
      demoSpans: this.demoSpans.map(([a, b]) => [a, b] as [number, number]),
      phases: this.phases.map((p) => ({ ...p })), interrupted: this.interrupted,
    };
  }
}

// ---- encoding ------------------------------------------------------------------------------------------

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** [offset, scale, base64 Int16 LE]: value = offset + q * scale. */
function encodeChannel(values: readonly number[]): [number, number, string] {
  let lo = Infinity, hi = -Infinity;
  for (const v of values) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (!Number.isFinite(lo)) { lo = 0; hi = 0; }
  const offset = (lo + hi) / 2;
  const scale = hi > lo ? (hi - lo) / (2 * QMAX) : 1;
  const view = new DataView(new ArrayBuffer(values.length * 2));
  values.forEach((v, i) => {
    const q = Number.isFinite(v) ? Math.max(-QMAX, Math.min(QMAX, Math.round((v - offset) / scale))) : MISSING;
    view.setInt16(i * 2, q, true);
  });
  return [offset, scale, toBase64(new Uint8Array(view.buffer))];
}

function decodeChannel(enc: unknown, n: number): number[] | null {
  if (!Array.isArray(enc) || enc.length !== 3) return null;
  const [offset, scale, b64] = enc as [unknown, unknown, unknown];
  if (typeof offset !== 'number' || typeof scale !== 'number' || typeof b64 !== 'string' || !Number.isFinite(offset) || !Number.isFinite(scale)) return null;
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(b64);
  } catch {
    return null;
  }
  if (bytes.length !== n * 2) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const q = view.getInt16(i * 2, true);
    out[i] = q === MISSING ? NaN : offset + q * scale;
  }
  return out;
}

export function encodeTrace(t: TraceData): string {
  const n = t.channels.t?.length ?? 0;
  const ch: Record<string, [number, number, string]> = {};
  for (const c of TRACE_CHANNELS) {
    const vals = t.channels[c] ?? [];
    ch[c] = encodeChannel(vals.length === n ? vals : Array.from({ length: n }, (_, i) => vals[i] ?? NaN));
  }
  return JSON.stringify({
    f: 'fs-trace', v: 1, id: t.id, lessonId: t.lessonId, hz: t.hz, n, ch,
    bands: t.bands, events: t.events, demoSpans: t.demoSpans, phases: t.phases, interrupted: t.interrupted,
  });
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Null when the string is not a valid encoded trace. */
export function decodeTrace(s: string): TraceData | null {
  let v: unknown;
  try {
    v = JSON.parse(s);
  } catch {
    return null;
  }
  if (!isObj(v) || v.f !== 'fs-trace' || v.v !== 1 || typeof v.id !== 'string' || typeof v.lessonId !== 'string') return null;
  if (!isNum(v.hz) || !isNum(v.n) || v.n < 0 || !Number.isInteger(v.n) || !isObj(v.ch)) return null;
  const n = v.n;
  const channels = {} as Record<TraceChannel, number[]>;
  for (const c of TRACE_CHANNELS) {
    const d = decodeChannel(v.ch[c], n);
    if (!d) return null;
    channels[c] = d;
  }
  const bands = Array.isArray(v.bands) ? v.bands.filter((b): b is TraceBand =>
    isObj(b) && typeof b.sig === 'string' && isNum(b.fromS) && isNum(b.toS) && isNum(b.target) && isNum(b.minus) && isNum(b.plus) && typeof b.taskId === 'string') : [];
  const events = Array.isArray(v.events) ? v.events.filter((e): e is TraceEvent => isObj(e) && isNum(e.t) && typeof e.type === 'string' && typeof e.label === 'string') : [];
  const demoSpans = Array.isArray(v.demoSpans) ? v.demoSpans.filter((d): d is [number, number] => Array.isArray(d) && d.length === 2 && isNum(d[0]) && isNum(d[1])) : [];
  const phases = Array.isArray(v.phases) ? v.phases.filter((p): p is { t: number; label: string } => isObj(p) && isNum(p.t) && typeof p.label === 'string') : [];
  return { id: v.id, lessonId: v.lessonId, hz: v.hz, channels, bands, events, demoSpans, phases, interrupted: v.interrupted === true };
}
