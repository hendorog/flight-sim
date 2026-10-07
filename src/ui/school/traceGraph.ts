// Debrief trace graph (section 5.5): up to four stacked strips of the 2 Hz trace with the target line and
// tolerance band (pale green, half band darker), greyed demonstration spans, labelled phase boundaries and
// event markers; a hover read-out, a scrubber, replay at 1/4/16x and a "Compare with best" ghost line.
// Canvas 2D, redrawn on demand (never per frame unless replaying).

import type { TraceBand, TraceChannel, TraceData, TraceEvent } from '../../training/types';
import { el } from '../dom';
import {
  angleTicks, channelForSig, chooseStrips, formatClock, formatValue, headingTick, linearScale, niceTicks, settledStart, STRIP_DEFS,
  stripRange, timeTicks, unwrapAngles, wrap180, type LinearScale, type StripDef,
} from './format';

const GUTTER_L = 70;
const GUTTER_R = 12;
const TOP = 22;
const STRIP_H = 64;
const STRIP_GAP = 10;
const EVENT_LANE = 16;
const AXIS_H = 20;

const LINE = '#52c3ff';
const GHOST = 'rgba(255,255,255,.38)';
const BAND = 'rgba(95,227,154,.13)';
const HALF = 'rgba(95,227,154,.22)';
const TARGET = 'rgba(95,227,154,.85)';
const TEXT = '#9aa8b6';
const FG = '#eef3f8';

/** What a criterion row selects in the graph: its signal's bands (by target) and its worst point. */
export interface GraphSelection { sig: string; target?: number; worst?: { value: number; atS: number } }

interface Strip { def: StripDef; values: number[]; ghost: number[] | null; bands: TraceBand[]; y0: number; y: LinearScale }

const EVENT_STYLE: Record<string, { color: string; shape: 'up' | 'down' | 'tick' | 'diamond' }> = {
  liftoff: { color: '#5fe39a', shape: 'up' },
  touchdown: { color: '#eef3f8', shape: 'down' },
  landing: { color: '#eef3f8', shape: 'down' },
  stallWarn: { color: '#ffb224', shape: 'tick' },
  stallWarnOn: { color: '#ffb224', shape: 'tick' },
  stallBreak: { color: '#ff6b5b', shape: 'tick' },
  intervention: { color: '#ff4d3d', shape: 'diamond' },
  coach: { color: '#3fd6c6', shape: 'tick' },
  handover: { color: '#52c3ff', shape: 'diamond' },
};

export class TraceGraph {
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly tip: HTMLElement;
  private readonly timeText: HTMLElement;
  private readonly t: number[];
  private readonly t0: number;
  private readonly t1: number;
  private readonly channels: TraceChannel[];
  /** Samples before this index were taken before the start settled and are not drawn (settledStart). */
  private readonly first: number;
  private strips: Strip[] = [];
  private width = 0;
  private height = 0;
  private x = linearScale(0, 1, 0, 1);
  private compare = false;
  private selection: GraphSelection | null = null;
  /** Replay / scrub position (trace time, s); null shows the whole flight. */
  private cursor: number | null = null;
  private hoverT: number | null = null;
  private replay: { speed: number; last: number; raf: number } | null = null;
  private dragging = false;
  /** Called when the scrub / replay position changes (the track map follows it). */
  onCursor?: (t: number | null) => void;

  constructor(parent: HTMLElement, private readonly trace: TraceData, private readonly best: TraceData | null) {
    this.root = el('div', 'sc-graph', parent);
    this.canvas = el('canvas', '', this.root);
    this.g = this.canvas.getContext('2d')!;
    this.tip = el('div', 'sc-graph-tip hidden', this.root);
    this.t = trace.channels.t ?? [];
    this.t0 = this.t[0] ?? 0;
    this.t1 = this.t[this.t.length - 1] ?? 1;
    this.channels = chooseStrips(trace);
    this.first = settledStart(trace.channels);

    const bar = el('div', 'sc-graph-bar', this.root);
    el('span', '', bar, 'Replay');
    for (const s of [1, 4, 16]) {
      const b = el('button', '', bar, `${s}×`);
      b.tabIndex = -1;
      b.addEventListener('click', () => this.startReplay(s));
    }
    const stop = el('button', '', bar, '■');
    stop.tabIndex = -1;
    stop.title = 'Stop and show the whole flight';
    stop.addEventListener('click', () => this.setCursor(null));
    this.timeText = el('span', 'num', bar);
    el('span', 'sc-spacer', bar);
    if (best) {
      const l = el('label', '', bar);
      const cb = el('input', '', l);
      cb.type = 'checkbox';
      cb.tabIndex = -1;
      el('span', '', l, 'Compare with best');
      cb.addEventListener('change', () => {
        this.compare = cb.checked;
        this.layout();
        this.draw();
      });
    }
    if (trace.interrupted) el('span', '', bar, '(trace interrupted)');

    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerleave', this.onLeave);
    this.canvas.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('resize', this.onResize);
  }

  dispose(): void {
    this.stopReplay();
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('resize', this.onResize);
  }

  /** Lay out for the container's current width and draw. Call once the graph is in the document. */
  render(): void {
    this.layout();
    this.draw();
  }

  /** Highlight a criterion's band and worst point (null clears). */
  select(sel: GraphSelection | null): void {
    this.selection = sel;
    this.draw();
  }

  setCursor(t: number | null): void {
    if (t === null) this.stopReplay();
    this.cursor = t === null ? null : Math.max(this.t0, Math.min(this.t1, t));
    this.timeText.textContent = this.cursor === null ? '' : `${formatClock(this.cursor - this.t0)} / ${formatClock(this.t1 - this.t0)}`;
    this.onCursor?.(this.cursor);
    this.draw();
  }

  // ---- Layout -------------------------------------------------------------------------------------------

  private layout(): void {
    const w = Math.max(320, Math.floor(this.root.clientWidth || 640));
    const n = this.channels.length;
    const h = TOP + n * STRIP_H + Math.max(0, n - 1) * STRIP_GAP + EVENT_LANE + AXIS_H;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = w;
    this.height = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.height = `${h}px`;
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.x = linearScale(this.t0, this.t1, GUTTER_L, w - GUTTER_R);

    const bestT = this.best?.channels.t ?? [];
    this.strips = this.channels.map((ch, i) => {
      const def = STRIP_DEFS[ch] ?? { channel: ch, label: ch, unit: '', minSpan: 10, angle: false };
      const raw = blankBefore(this.trace.channels[ch] ?? [], this.first);
      const values = def.angle ? unwrapAngles(raw) : [...raw];
      let ghost: number[] | null = null;
      if (this.compare && this.best) {
        const g = blankBefore(this.best.channels[ch] ?? [], settledStart(this.best.channels));
        // The best run is re-timed to start with this one; angles are unwrapped next to this run's values.
        ghost = def.angle ? alignAngles(unwrapAngles(g), values) : [...g];
        ghost = ghost.slice(0, bestT.length);
      }
      const bands = this.trace.bands
        .filter((b) => channelForSig(b.sig) === ch)
        .map((b) => (def.angle ? { ...b, target: nearestTurn(b.target, valueNear(values, this.t, (b.fromS + b.toS) / 2)) } : b));
      const y0 = TOP + i * (STRIP_H + STRIP_GAP);
      const [lo, hi] = stripRange(ghost ? values.concat(ghost) : values, bands, def.minSpan);
      return { def, values, ghost, bands, y0, y: linearScale(lo, hi, y0 + STRIP_H - 2, y0 + 2) };
    });
  }

  // ---- Drawing ------------------------------------------------------------------------------------------

  private draw(): void {
    const g = this.g;
    const { width: w, height: h } = this;
    if (!w) return;
    g.clearRect(0, 0, w, h);
    const plotBottom = TOP + this.strips.length * STRIP_H + Math.max(0, this.strips.length - 1) * STRIP_GAP;

    // Demonstration spans, greyed across every strip.
    g.fillStyle = 'rgba(255,255,255,.06)';
    for (const [a, b] of this.trace.demoSpans) {
      const x0 = this.x(a);
      g.fillRect(x0, TOP - 4, this.x(b) - x0, plotBottom - TOP + 4);
    }
    if (this.trace.demoSpans.length) {
      g.fillStyle = TEXT;
      g.font = '600 9.5px Inter, system-ui, sans-serif';
      g.textAlign = 'left';
      const [a] = this.trace.demoSpans[0];
      g.fillText('DEMO', this.x(a) + 4, TOP + 8);
    }

    for (const s of this.strips) this.drawStrip(s);

    // Phase boundaries with labels along the top.
    g.font = '600 10px Inter, system-ui, sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    let labelRight = -Infinity;
    for (const p of this.trace.phases) {
      const px = Math.round(this.x(p.t)) + 0.5;
      g.strokeStyle = 'rgba(255,255,255,.22)';
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(px, TOP - 6);
      g.lineTo(px, plotBottom);
      g.stroke();
      g.setLineDash([]);
      if (px > labelRight + 6) {
        g.fillStyle = FG;
        const label = clipText(g, p.label, Math.max(40, w - GUTTER_R - px - 4));
        g.fillText(label, px + 4, TOP - 9);
        labelRight = px + 4 + g.measureText(label).width;
      }
    }

    this.drawEvents(plotBottom + 2);
    this.drawTimeAxis(plotBottom + EVENT_LANE);

    // Replay / scrub cursor, and the hover line.
    for (const [t, color] of [[this.cursor, '#ffffff'], [this.hoverT, 'rgba(255,255,255,.45)']] as const) {
      if (t === null) continue;
      const px = Math.round(this.x(t)) + 0.5;
      g.strokeStyle = color;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(px, TOP - 6);
      g.lineTo(px, plotBottom + EVENT_LANE);
      g.stroke();
    }
  }

  private drawStrip(s: Strip): void {
    const g = this.g;
    const { def, y0 } = s;
    const x0 = GUTTER_L;
    const x1 = this.width - GUTTER_R;
    g.fillStyle = 'rgba(255,255,255,.025)';
    g.fillRect(x0, y0, x1 - x0, STRIP_H);

    // Value ticks.
    const [lo, hi] = [s.y.invert(y0 + STRIP_H - 2), s.y.invert(y0 + 2)];
    g.font = '500 10px Inter, system-ui, sans-serif';
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    for (const v of def.angle ? angleTicks(lo, hi, 3) : niceTicks(lo, hi, 3)) {
      const py = Math.round(s.y(v)) + 0.5;
      if (py < y0 + 5 || py > y0 + STRIP_H - 5) continue;
      g.strokeStyle = 'rgba(255,255,255,.06)';
      g.beginPath();
      g.moveTo(x0, py);
      g.lineTo(x1, py);
      g.stroke();
      g.fillStyle = TEXT;
      g.fillText(def.angle ? headingTick(v) : formatValue(v, ''), x0 - 6, py);
    }
    g.textAlign = 'left';
    g.fillStyle = FG;
    g.font = '700 10.5px Inter, system-ui, sans-serif';
    g.fillText(def.label, 6, y0 + 10);
    g.fillStyle = TEXT;
    g.font = '500 9.5px Inter, system-ui, sans-serif';
    g.fillText(def.unit === 'deg' ? 'deg' : def.unit, 6, y0 + 23);

    // Tolerance bands: full band pale, half band darker, target dashed; the selected one outlined.
    const sel = this.selection;
    for (const b of s.bands) {
      const bx0 = this.x(b.fromS);
      const bx1 = this.x(b.toS);
      const yHi = s.y(b.target + b.plus);
      const yLo = s.y(b.target - b.minus);
      g.fillStyle = BAND;
      g.fillRect(bx0, yHi, bx1 - bx0, yLo - yHi);
      const hHi = s.y(b.target + b.plus / 2);
      const hLo = s.y(b.target - b.minus / 2);
      g.fillStyle = HALF;
      g.fillRect(bx0, hHi, bx1 - bx0, hLo - hHi);
      g.strokeStyle = TARGET;
      g.setLineDash([5, 4]);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(bx0, Math.round(s.y(b.target)) + 0.5);
      g.lineTo(bx1, Math.round(s.y(b.target)) + 0.5);
      g.stroke();
      g.setLineDash([]);
      if (sel && channelForSig(sel.sig as TraceBand['sig']) === def.channel && (sel.target === undefined || Math.abs(wrapIf(def.angle, b.target - sel.target)) < 1e-6)) {
        g.strokeStyle = '#ffd36b';
        g.lineWidth = 1.5;
        g.strokeRect(bx0 + 0.75, yHi + 0.75, bx1 - bx0 - 1.5, yLo - yHi - 1.5);
        g.lineWidth = 1;
      }
    }

    g.save();
    g.beginPath();
    g.rect(x0, y0, x1 - x0, STRIP_H);
    g.clip();
    if (s.ghost && this.best) this.polyline(s.ghost, this.best.channels.t.map((t) => t - (this.best!.channels.t[0] ?? 0) + this.t0), s.y, GHOST, 1.25, null);
    this.polyline(s.values, this.t, s.y, LINE, 1.75, this.cursor);
    g.restore();

    // Worst point of the selected criterion.
    if (sel?.worst && channelForSig(sel.sig as TraceBand['sig']) === def.channel) {
      const v = def.angle ? nearestTurn(sel.worst.value, valueNear(s.values, this.t, sel.worst.atS)) : sel.worst.value;
      const px = this.x(sel.worst.atS);
      const py = Math.max(y0 + 3, Math.min(y0 + STRIP_H - 3, s.y(v)));
      g.fillStyle = '#ffd36b';
      g.strokeStyle = '#0b1118';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(px, py, 4.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.lineWidth = 1;
    }
  }

  /** A NaN-broken line; beyond `until` (replay) it is drawn faint. */
  private polyline(values: readonly number[], ts: readonly number[], y: (v: number) => number, color: string, width: number, until: number | null): void {
    const g = this.g;
    g.lineWidth = width;
    g.lineJoin = 'round';
    const pass = (from: number, to: number, alpha: number): void => {
      g.globalAlpha = alpha;
      g.strokeStyle = color;
      g.beginPath();
      let pen = false;
      for (let i = 0; i < values.length && i < ts.length; i++) {
        const t = ts[i];
        if (t < from - 1e-9 || t > to + 1e-9) {
          pen = false;
          continue;
        }
        const v = values[i];
        if (!Number.isFinite(v)) {
          pen = false;
          continue;
        }
        const px = this.x(t);
        const py = y(v);
        if (pen) g.lineTo(px, py);
        else g.moveTo(px, py);
        pen = true;
      }
      g.stroke();
    };
    if (until === null) pass(-Infinity, Infinity, 1);
    else {
      pass(until, Infinity, 0.22);
      pass(-Infinity, until, 1);
    }
    g.globalAlpha = 1;
    g.lineWidth = 1;
  }

  private drawEvents(y: number): void {
    const g = this.g;
    for (const e of this.trace.events) {
      const st = EVENT_STYLE[e.type] ?? { color: TEXT, shape: 'tick' as const };
      const px = this.x(e.t);
      g.fillStyle = st.color;
      g.strokeStyle = st.color;
      g.lineWidth = 1.5;
      g.beginPath();
      const cy = y + EVENT_LANE / 2 - 1;
      if (st.shape === 'up') {
        g.moveTo(px, cy - 5);
        g.lineTo(px + 5, cy + 4);
        g.lineTo(px - 5, cy + 4);
        g.closePath();
        g.fill();
      } else if (st.shape === 'down') {
        g.moveTo(px, cy + 5);
        g.lineTo(px + 5, cy - 4);
        g.lineTo(px - 5, cy - 4);
        g.closePath();
        g.fill();
      } else if (st.shape === 'diamond') {
        g.moveTo(px, cy - 5);
        g.lineTo(px + 4.5, cy);
        g.lineTo(px, cy + 5);
        g.lineTo(px - 4.5, cy);
        g.closePath();
        g.fill();
      } else {
        g.moveTo(px, cy - 5);
        g.lineTo(px, cy + 5);
        g.stroke();
      }
    }
    g.lineWidth = 1;
  }

  private drawTimeAxis(y: number): void {
    const g = this.g;
    g.fillStyle = TEXT;
    g.font = '500 10px Inter, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'top';
    const span = this.t1 - this.t0;
    // Ticks on whole minutes (or nice fractions of them) of flight time.
    for (const v of timeTicks(span, Math.max(2, Math.floor((this.width - GUTTER_L) / 80)))) {
      const px = this.x(this.t0 + v);
      g.fillRect(Math.round(px), y, 1, 4);
      g.fillText(formatClock(v), px, y + 6);
    }
  }

  // ---- Interaction --------------------------------------------------------------------------------------

  private timeAt(clientX: number): number {
    const r = this.canvas.getBoundingClientRect();
    return Math.max(this.t0, Math.min(this.t1, this.x.invert(clientX - r.left)));
  }

  private readonly onMove = (e: PointerEvent): void => {
    const t = this.timeAt(e.clientX);
    if (this.dragging) this.setCursor(t);
    this.hoverT = t;
    this.showTip(t, e.clientX);
    this.draw();
  };

  private readonly onLeave = (): void => {
    this.hoverT = null;
    this.tip.classList.add('hidden');
    this.draw();
  };

  private readonly onDown = (e: PointerEvent): void => {
    this.stopReplay();
    this.dragging = true;
    this.setCursor(this.timeAt(e.clientX));
  };

  private readonly onUp = (): void => {
    this.dragging = false;
  };

  private readonly onResize = (): void => {
    if (!this.root.isConnected) return;
    this.layout();
    this.draw();
  };

  private showTip(t: number, clientX: number): void {
    const parts = [formatClock(t - this.t0)];
    for (const s of this.strips) {
      const v = valueNear(s.def.angle ? this.trace.channels[s.def.channel] : s.values, this.t, t);
      if (Number.isFinite(v)) parts.push(`${s.def.label} ${s.def.angle ? formatValue(v, 'deg', true) : formatValue(v, s.def.unit)}`);
    }
    const ev = nearestEvent(this.trace.events, t, (this.t1 - this.t0) / Math.max(1, this.width) * 6);
    if (ev) parts.push(ev.label);
    this.tip.textContent = parts.join('  ·  ');
    const r = this.canvas.getBoundingClientRect();
    const rr = this.root.getBoundingClientRect();
    this.tip.style.left = `${Math.max(120, Math.min(rr.width - 120, clientX - rr.left))}px`;
    this.tip.style.top = `${r.top - rr.top + TOP}px`;
    this.tip.classList.remove('hidden');
  }

  private startReplay(speed: number): void {
    this.stopReplay();
    const start = this.cursor === null || this.cursor >= this.t1 ? this.t0 : this.cursor;
    this.replay = { speed, last: performance.now(), raf: 0 };
    this.setCursor(start);
    const tick = (now: number): void => {
      const r = this.replay;
      if (!r) return;
      const dt = Math.min(0.1, (now - r.last) / 1000);
      r.last = now;
      const t = (this.cursor ?? this.t0) + dt * r.speed;
      if (t >= this.t1) {
        this.replay = null;
        this.setCursor(this.t1);
        return;
      }
      this.setCursor(t);
      r.raf = requestAnimationFrame(tick);
    };
    this.replay.raf = requestAnimationFrame(tick);
  }

  private stopReplay(): void {
    if (this.replay) cancelAnimationFrame(this.replay.raf);
    this.replay = null;
  }
}

// ---- Helpers -----------------------------------------------------------------------------------------------

/** The sample at (or just before) trace time t. */
function valueNear(values: readonly number[] | undefined, ts: readonly number[], t: number): number {
  if (!values || ts.length === 0) return NaN;
  let lo = 0;
  let hi = ts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ts[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return values[lo];
}

/** A copy of `values` with the samples before `first` set to NaN (not drawn, not scaled). */
function blankBefore(values: readonly number[], first: number): number[] {
  return first <= 0 ? [...values] : values.map((v, i) => (i < first ? Number.NaN : v));
}

/** `a` moved by whole turns to be nearest `ref` (a band target next to an unwrapped heading line). */
function nearestTurn(a: number, ref: number): number {
  return Number.isFinite(ref) ? ref + wrap180(a - ref) : a;
}

function wrapIf(angle: boolean, d: number): number {
  return angle ? wrap180(d) : d;
}

/** Shift an unwrapped ghost series by whole turns so it starts next to the current run. */
function alignAngles(ghost: number[], ref: readonly number[]): number[] {
  const g0 = ghost.find(Number.isFinite);
  const r0 = ref.find(Number.isFinite);
  if (g0 === undefined || r0 === undefined) return ghost;
  const shift = nearestTurn(g0, r0) - g0;
  return ghost.map((v) => v + shift);
}

function nearestEvent(events: readonly TraceEvent[], t: number, within: number): TraceEvent | null {
  let best: TraceEvent | null = null;
  for (const e of events) if (Math.abs(e.t - t) <= within && (!best || Math.abs(e.t - t) < Math.abs(best.t - t))) best = e;
  return best;
}

function clipText(g: CanvasRenderingContext2D, s: string, max: number): string {
  if (g.measureText(s).width <= max) return s;
  let out = s;
  while (out.length > 1 && g.measureText(`${out}…`).width > max) out = out.slice(0, -1);
  return `${out}…`;
}
