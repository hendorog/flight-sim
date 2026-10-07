// Trace recording and encoding (section 3.11): 2 Hz on sim time, round trip within 0.5 % of each channel's
// range, missing samples preserved, truncation at a checkpoint, rejection of garbage.

import { describe, expect, it } from 'vitest';
import { TRACE_CHANNELS, TraceRecorder, decodeTrace, encodeTrace } from '../../src/training/grading/trace';
import type { TraceChannel } from '../../src/training/types';

/** A 15-minute climbing turn with realistic magnitudes, sampled each 1/60 s of sim time. */
function record(minutes = 15): TraceRecorder {
  const r = new TraceRecorder('tr-1', 'L04');
  for (let t = 0; t < minutes * 60; t += 1 / 60) {
    r.sample({
      altFt: 2500 + t * 1.3 + 30 * Math.sin(t / 7), asiKt: 80 + 5 * Math.sin(t / 3), hdgDeg: (100 + t * 0.4) % 360,
      aiBankDeg: 20 * Math.sin(t / 11), vsiFpm: 500 * Math.cos(t / 9), pitchDeg: 5 + 3 * Math.sin(t / 5), aglFt: 1500 + t,
      throttle: 0.8, flapsDeg: t > 600 ? 10 : 0, gpDevFt: Number.NaN, rwyAcrossM: -0.5 * t,
    }, t, t < 60, { x: 4000 + t * 40, y: -8000 + t * 10 });
  }
  r.phase(0, 'Demonstration');
  r.phase(60, 'Your climb');
  r.demoSpan(0, 60);
  r.band({ sig: 'altFt', fromS: 70, toS: 300, target: 3500, minus: 200, plus: 200, taskId: 'climb' });
  r.event({ t: 120, type: 'coach', label: 'Speed high, 81' });
  return r;
}

describe('TraceRecorder', () => {
  it('records at 2 Hz of sim time whatever the frame rate', () => {
    const r = record(1);
    expect(r.length).toBe(120);
    const t = r.data().channels.t;
    // Each sample is the first frame at or after its 0.5 s grid point (frames here are 1/60 s).
    for (let i = 1; i < t.length; i++) expect(Math.abs(t[i] - i * 0.5)).toBeLessThan(1 / 60 + 1e-9);
    expect(t[119] - t[0]).toBeCloseTo(59.5, 1);
    // A coarse frame rate stays on the grid.
    const c = new TraceRecorder('c', 'L');
    for (let s = 0; s < 10; s += 0.3) c.sample({ altFt: 1 }, s, false);
    expect(c.length).toBe(20);
  });

  it('records the authority and the position channels', () => {
    const d = record(2).data();
    expect(d.channels.authority[0]).toBe(1);
    expect(d.channels.authority[200]).toBe(0);
    expect(d.channels.north[2]).toBeCloseTo(4040, 6);
    expect(d.channels.east[2]).toBeCloseTo(-7990, 6);
    const noPos = new TraceRecorder('n', 'L');
    noPos.sample({ altFt: 1 }, 0, false);
    expect(Number.isNaN(noPos.data().channels.north[0])).toBe(true);
  });

  it('truncates samples, bands, events and spans at a checkpoint offset and continues the grid', () => {
    const r = record(10);
    const n = r.length;
    r.truncate(200);                 // t = 99.5 s is the last kept sample
    const d = r.data();
    expect(r.length).toBe(200);
    expect(d.channels.altFt.length).toBe(200);
    expect(d.bands).toHaveLength(1);
    expect(d.bands[0].toS).toBeCloseTo(99.5, 1);
    expect(d.bands[0].toS).toBe(d.channels.t[199]);
    expect(d.events).toEqual([]);
    expect(d.phases.map((p) => p.label)).toEqual(['Demonstration', 'Your climb']);
    r.sample({ altFt: 1 }, 99.8, false);   // the restored flight resumes between grid points: wait for the grid
    expect(r.length).toBe(200);
    r.sample({ altFt: 1 }, 100.1, false);
    expect(r.length).toBe(201);
    expect(r.data().channels.t[200]).toBe(100.1);
    r.truncate(n + 10);              // beyond the end: nothing happens
    expect(r.length).toBe(201);
  });
});

describe('trace encoding', () => {
  it('round-trips every channel within 0.5 % of its range and keeps missing samples', () => {
    const d = record().data();
    d.interrupted = true;
    const enc = encodeTrace(d);
    expect(enc.length).toBeLessThan(80_000);     // about 45 kB for a 15-minute lesson plus JSON overhead
    const back = decodeTrace(enc);
    expect(back).not.toBeNull();
    for (const c of TRACE_CHANNELS as readonly TraceChannel[]) {
      const a = d.channels[c], b = back!.channels[c];
      expect(b.length).toBe(a.length);
      const finite = a.filter(Number.isFinite);
      const range = finite.length ? Math.max(...finite) - Math.min(...finite) : 0;
      for (let i = 0; i < a.length; i++) {
        if (!Number.isFinite(a[i])) {
          expect(Number.isNaN(b[i])).toBe(true);
          continue;
        }
        expect(Math.abs(b[i] - a[i])).toBeLessThanOrEqual(Math.max(0.005 * range, 1e-9));
      }
    }
    expect(back!.bands).toEqual(d.bands);
    expect(back!.events).toEqual(d.events);
    expect(back!.demoSpans).toEqual(d.demoSpans);
    expect(back!.phases).toEqual(d.phases);
    expect(back!.interrupted).toBe(true);
    expect(back!.hz).toBe(2);
  });

  it('encodes an empty trace and a constant channel exactly', () => {
    const empty = decodeTrace(encodeTrace(new TraceRecorder('e', 'L01').data()));
    expect(empty?.channels.t).toEqual([]);
    const r = new TraceRecorder('k', 'L');
    for (let t = 0; t < 5; t += 0.5) r.sample({ throttle: 0.72 }, t, false);
    expect(decodeTrace(encodeTrace(r.data()))!.channels.throttle.every((x) => x === 0.72)).toBe(true);
  });

  it('rejects garbage and damaged traces', () => {
    expect(decodeTrace('not json')).toBeNull();
    expect(decodeTrace('{}')).toBeNull();
    const enc = JSON.parse(encodeTrace(record(1).data()));
    expect(decodeTrace(JSON.stringify({ ...enc, n: enc.n + 1 }))).toBeNull();
    expect(decodeTrace(JSON.stringify({ ...enc, ch: { ...enc.ch, altFt: [0, 1, '!!!'] } }))).toBeNull();
    const { altFt: _drop, ...partial } = enc.ch;
    void _drop;
    expect(decodeTrace(JSON.stringify({ ...enc, ch: partial }))).toBeNull();
  });
});
