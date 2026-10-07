// Debrief ground track (section 5.5) for circuit, forced-landing and navigation lessons: the runway, the
// ideal left-hand circuit for 07 (or the lesson's route), and the flown track coloured by who had control.
// North is up; the scale is equal in both axes and fits the track, the runway and the reference.

import { AIRPORT } from '../../core/world';
import { DOWNWIND_OFFSET } from '../../sim/scenarios';
import type { NavRoute, TraceData } from '../../training/types';
import { el } from '../dom';

const STUDENT = '#5fe39a';
const INSTRUCTOR = '#52c3ff';
const REF = 'rgba(255,255,255,.4)';

/** Runway-frame (along 07, across + right of 07) to NED north/east, m. */
export function fromRunway(along: number, across: number): { north: number; east: number } {
  const h = AIRPORT.runway.heading;
  const c = Math.cos(h);
  const s = Math.sin(h);
  return { north: AIRPORT.runway.center.north + along * c - across * s, east: AIRPORT.runway.center.east + along * s + across * c };
}

/**
 * The ideal left-hand circuit for runway 07 as a closed polyline (north/east, m): upwind to 1 km past the
 * far end, crosswind, downwind at DOWNWIND_OFFSET on the north-west side, base 1.2 km before the threshold.
 */
export function idealCircuit(): { north: number; east: number }[] {
  const half = AIRPORT.runway.length / 2;
  const up = half + 1000;
  const base = -half - 1200;
  const off = -DOWNWIND_OFFSET;
  return [[-half, 0], [up, 0], [up, off], [base, off], [base, 0], [-half, 0]].map(([a, x]) => fromRunway(a, x));
}

export class TrackMap {
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private cursor: number | null = null;

  constructor(parent: HTMLElement, private readonly trace: TraceData, private readonly route: NavRoute | null, private readonly heightPx = 250) {
    this.root = el('div', 'sc-map', parent);
    this.canvas = el('canvas', '', this.root);
    this.g = this.canvas.getContext('2d')!;
  }

  /** The aircraft marker follows the graph's scrub / replay position (null hides it). */
  setCursor(t: number | null): void {
    this.cursor = t;
    this.render();
  }

  render(): void {
    const w = Math.max(240, Math.floor(this.root.clientWidth || 400));
    const h = this.heightPx;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.canvas.style.height = `${h}px`;
    }
    const g = this.g;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,.25)';
    g.fillRect(0, 0, w, h);

    const N = this.trace.channels.north ?? [];
    const E = this.trace.channels.east ?? [];
    const auth = this.trace.channels.authority ?? [];
    const ref = this.route ? this.route.waypoints.map((p) => ({ north: p.north, east: p.east })) : idealCircuit();
    const rwyEnds = [fromRunway(-AIRPORT.runway.length / 2, 0), fromRunway(AIRPORT.runway.length / 2, 0)];

    // Fit: everything that is drawn, with a margin; equal scale (m per px) both ways.
    let n0 = Infinity, n1 = -Infinity, e0 = Infinity, e1 = -Infinity;
    const fit = (n: number, e: number): void => {
      if (!Number.isFinite(n) || !Number.isFinite(e)) return;
      n0 = Math.min(n0, n); n1 = Math.max(n1, n); e0 = Math.min(e0, e); e1 = Math.max(e1, e);
    };
    for (let i = 0; i < N.length; i++) fit(N[i], E[i]);
    for (const p of ref) fit(p.north, p.east);
    for (const p of rwyEnds) fit(p.north, p.east);
    const pad = 18;
    const scale = Math.max((e1 - e0) / (w - 2 * pad), (n1 - n0) / (h - 2 * pad), 1);
    const cx = (e0 + e1) / 2;
    const cn = (n0 + n1) / 2;
    const X = (e: number): number => w / 2 + (e - cx) / scale;
    const Y = (n: number): number => h / 2 - (n - cn) / scale;

    // 1 km grid.
    g.strokeStyle = 'rgba(255,255,255,.05)';
    g.lineWidth = 1;
    const step = scale * w > 30000 ? 5000 : 1000;
    for (let e = Math.ceil((cx - (w / 2) * scale) / step) * step; X(e) < w; e += step) {
      g.beginPath(); g.moveTo(Math.round(X(e)) + 0.5, 0); g.lineTo(Math.round(X(e)) + 0.5, h); g.stroke();
    }
    for (let n = Math.ceil((cn - (h / 2) * scale) / step) * step; Y(n) > 0; n += step) {
      g.beginPath(); g.moveTo(0, Math.round(Y(n)) + 0.5); g.lineTo(w, Math.round(Y(n)) + 0.5); g.stroke();
    }

    // Reference: the ideal circuit or the route, dashed.
    g.strokeStyle = REF;
    g.setLineDash([6, 5]);
    g.lineWidth = 1.5;
    g.beginPath();
    ref.forEach((p, i) => (i ? g.lineTo(X(p.east), Y(p.north)) : g.moveTo(X(p.east), Y(p.north))));
    g.stroke();
    g.setLineDash([]);
    if (this.route) {
      g.font = '600 10px Inter, system-ui, sans-serif';
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      for (const p of this.route.waypoints) {
        g.strokeStyle = REF;
        g.beginPath();
        g.arc(X(p.east), Y(p.north), 5, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = '#c6d0da';
        g.fillText(p.name, X(p.east) + 8, Y(p.north));
      }
    }

    // Runway, at least 4 px wide so it reads at any scale.
    g.strokeStyle = '#7d8896';
    g.lineCap = 'butt';
    g.lineWidth = Math.max(4, AIRPORT.runway.width / scale);
    g.beginPath();
    g.moveTo(X(rwyEnds[0].east), Y(rwyEnds[0].north));
    g.lineTo(X(rwyEnds[1].east), Y(rwyEnds[1].north));
    g.stroke();

    // Flown track, coloured by authority; beyond the cursor (replay) faint.
    g.lineWidth = 2;
    g.lineJoin = 'round';
    const t = this.trace.channels.t ?? [];
    for (let i = 1; i < N.length; i++) {
      if (![N[i - 1], E[i - 1], N[i], E[i]].every(Number.isFinite)) continue;
      g.strokeStyle = auth[i] > 0.5 ? INSTRUCTOR : STUDENT;
      g.globalAlpha = this.cursor !== null && t[i] > this.cursor ? 0.2 : 1;
      g.beginPath();
      g.moveTo(X(E[i - 1]), Y(N[i - 1]));
      g.lineTo(X(E[i]), Y(N[i]));
      g.stroke();
    }
    g.globalAlpha = 1;

    if (this.cursor !== null && t.length) {
      let i = t.findIndex((x) => x >= this.cursor!);
      if (i < 0) i = t.length - 1;
      if (Number.isFinite(N[i]) && Number.isFinite(E[i])) {
        g.fillStyle = '#fff';
        g.strokeStyle = '#0b1118';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(X(E[i]), Y(N[i]), 5, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
    }

    // Legend, north arrow and scale bar.
    g.font = '600 10px Inter, system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    const legend: [string, string][] = [[STUDENT, 'You'], [INSTRUCTOR, 'Instructor'], [REF, this.route ? 'Planned route' : 'Ideal circuit']];
    legend.forEach(([c, s], k) => {
      g.fillStyle = c;
      g.fillRect(10, 12 + k * 14, 12, 3);
      g.fillStyle = '#c6d0da';
      g.fillText(s, 28, 13.5 + k * 14);
    });
    g.fillStyle = '#c6d0da';
    g.textAlign = 'center';
    g.fillText('N', w - 16, 12);
    g.beginPath();
    g.moveTo(w - 16, 18); g.lineTo(w - 20, 28); g.lineTo(w - 12, 28); g.closePath();
    g.fill();
    const bar = step / scale;
    g.fillRect(w - 14 - bar, h - 14, bar, 2);
    g.fillText(step >= 1000 ? `${step / 1000} km` : `${step} m`, w - 14 - bar / 2, h - 24);
  }
}
