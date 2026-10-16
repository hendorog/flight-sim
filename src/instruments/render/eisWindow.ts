// One window of a legacy engine instrument system (the Pilatus PC-12/47's EIS: a 3 x 3 grid of small self-lit
// windows). A black window with a title, an optional round dial (bands, red lines, numbered marks, a needle),
// up to three digital readouts and optional vertical bars. Everything it shows is the type's panel data
// (EisDial, EisReadout, EisBars in panelDef.ts); nothing here knows a type. The window is dark while the bus is
// unpowered, and self-lit (LIGHT_DISPLAY) in the night map.

import { clamp } from '../../core/math';
import type { ControlInputs } from '../../core/types';
import type { InstrumentReadings } from '../dynamics/instrumentSet';
import type { ArcColor, EisBars, EisDial, EisReadout, GaugeDef } from '../panelDef';
import { DIAL_FONT, LABEL_FONT, type Ctx2D } from './canvas';
import { Latch, LIGHT_DISPLAY, type PanelComponent, type Rect } from './component';

type Def = Extract<GaugeDef, { kind: 'eisWindow' }>;

/** Display colours (LCD primaries, brighter than the painted dial arcs). */
export const EIS_BAND: Record<ArcColor, string> = { green: '#2fd45a', yellow: '#ffd21e', red: '#ff3b2a', white: '#e8f3ff', blue: '#5fb4ff' };
const FIGURE = '#e8f3ff';
const TITLE = '#9fb4c4';
const ALERT = { red: '#ff3b2a', amber: '#ffb21e' } as const;
const RAD = Math.PI / 180;

/** The colour of the figure of a readout at value v. */
export function eisFigureColor(r: EisReadout, v: number): string {
  const a = r.alert?.(v);
  return a ? ALERT[a] : FIGURE;
}
/** The colour of the band that contains v in a list of arcs (null outside every band; a later band wins). */
export function eisBandAt(arcs: readonly { from: number; to: number; color: ArcColor }[] | undefined, v: number): ArcColor | null {
  let c: ArcColor | null = null;
  for (const a of arcs ?? []) if (v >= a.from && v <= a.to) c = a.color;
  return c;
}

export class EisWindow implements PanelComponent {
  readonly id: string;
  readonly bounds: Rect;
  /** 0 power, 1 dial value, then the readouts, then the bars. */
  private readonly latch: Latch;
  private readonly def: Def;

  constructor(def: Def) {
    this.def = def;
    this.id = def.id;
    this.bounds = def.bounds;
    this.latch = new Latch(2 + def.readouts.length + (def.bars?.items.length ?? 0));
  }

  sample(r: InstrumentReadings, _c: ControlInputs, _time: number): boolean {
    const d = this.def;
    const on = r.busPowered;
    this.latch.set(0, on ? 1 : 0, 1);
    if (!on) return this.latch.take();
    if (d.dial) this.latch.track(1, clamp(d.dial.read(r), d.dial.min, d.dial.max), (d.dial.max - d.dial.min) / 400);
    d.readouts.forEach((ro, i) => this.latch.set(2 + i, ro.read(r), 10 ** -ro.decimals));
    const bars = d.bars;
    if (bars) bars.items.forEach((it, i) => this.latch.set(2 + d.readouts.length + i, clamp(it.read(r), bars.min, bars.max), (bars.max - bars.min) / 200));
    return this.latch.take();
  }

  /** What the window shows now: its dial value and readout figures (NaN while dark), for tests. */
  shown(): { powered: boolean; dial: number; readouts: number[]; bars: number[] } {
    const on = this.latch.get(0) === 1;
    return {
      powered: on,
      dial: this.latch.get(1),
      readouts: this.def.readouts.map((_, i) => this.latch.get(2 + i)),
      bars: (this.def.bars?.items ?? []).map((_, i) => this.latch.get(2 + this.def.readouts.length + i)),
    };
  }

  private chassis(g: Ctx2D): void {
    const b = this.bounds;
    g.fillStyle = '#0d0f10';
    g.beginPath();
    g.roundRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2, 5);
    g.fill();
    g.strokeStyle = '#2b3033';
    g.lineWidth = 2;
    g.stroke();
  }

  drawStatic(g: Ctx2D): void {
    const b = this.bounds;
    g.save();
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.beginPath();
    g.roundRect(b.x - 2, b.y - 1, b.w + 4, b.h + 5, 7);
    g.fill();
    g.restore();
  }

  paintLightMask(g: Ctx2D): void {
    const b = this.bounds;
    g.fillStyle = LIGHT_DISPLAY;
    g.beginPath();
    g.roundRect(b.x + 4, b.y + 4, b.w - 8, b.h - 8, 3);
    g.fill();
  }

  draw(g: Ctx2D): void {
    this.chassis(g);
    if (this.latch.get(0) !== 1) return;
    const d = this.def;
    const b = this.bounds;
    g.save();
    g.beginPath();
    g.roundRect(b.x + 3, b.y + 3, b.w - 6, b.h - 6, 3);
    g.clip();
    const u = b.w / 150;
    // Title, top left.
    g.font = `700 ${Math.round(11 * u)}px ${LABEL_FONT}`;
    g.fillStyle = TITLE;
    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.fillText(d.title, b.x + 9 * u, b.y + 7 * u);
    let digitsTop = b.y + 30 * u;
    if (d.dial) {
      const r = 38 * u;
      const cx = b.x + b.w / 2;
      const cy = b.y + 28 * u + r + 6 * u;
      this.drawDial(g, d.dial, this.latch.get(1), cx, cy, r, u);
      digitsTop = cy + r * 0.28;
    }
    if (d.bars) this.drawBars(g, d.bars, b, u, d.readouts.length > 0);
    this.drawReadouts(g, d.readouts, b, u, digitsTop, !!d.dial, !!d.bars);
    g.restore();
  }

  private drawDial(g: Ctx2D, dial: EisDial, v: number, cx: number, cy: number, r: number, u: number): void {
    const ang = (x: number): number => (dial.fromDeg + ((x - dial.min) / (dial.max - dial.min)) * (dial.toDeg - dial.fromDeg)) * RAD;
    const pt = (a: number, rad: number): [number, number] => [cx + rad * Math.sin(a), cy - rad * Math.cos(a)];
    // Bands on the rim.
    g.lineCap = 'butt';
    for (const a of dial.arcs ?? []) {
      g.strokeStyle = EIS_BAND[a.color];
      g.lineWidth = 5 * u;
      g.beginPath();
      g.arc(cx, cy, r - 2.5 * u, ang(a.from) - Math.PI / 2, ang(a.to) - Math.PI / 2);
      g.stroke();
    }
    // Ticks and numbers.
    g.strokeStyle = '#cfd9e0';
    g.lineWidth = 1.2 * u;
    for (const m of dial.majors) {
      const a = ang(m);
      const [x0, y0] = pt(a, r - 6 * u);
      const [x1, y1] = pt(a, r - 12 * u);
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    }
    const labels = dial.labels ?? dial.majors;
    const div = dial.labelDivisor ?? 1;
    g.font = `600 ${Math.round(9 * u)}px ${DIAL_FONT}`;
    g.fillStyle = '#cfd9e0';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const m of labels) {
      const [x, y] = pt(ang(m), r - 19 * u);
      g.fillText(String(Math.round((m / div) * 10) / 10), x, y);
    }
    // Red lines across the rim.
    g.strokeStyle = EIS_BAND.red;
    g.lineWidth = 2.4 * u;
    for (const m of dial.redLines ?? []) {
      const a = ang(m);
      const [x0, y0] = pt(a, r + 1 * u);
      const [x1, y1] = pt(a, r - 9 * u);
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    }
    // Needle and hub.
    const a = ang(clamp(v, dial.min, dial.max));
    const [nx, ny] = pt(a, r - 3 * u);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2.6 * u;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(nx, ny);
    g.stroke();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(cx, cy, 3 * u, 0, Math.PI * 2);
    g.fill();
  }

  private drawBars(g: Ctx2D, bars: EisBars, b: Rect, u: number, hasText: boolean): void {
    const n = bars.items.length;
    const top = b.y + 30 * u;
    const h = (hasText ? 60 : 92) * u;
    const w = 15 * u;
    const gap = n > 1 ? (b.w - 2 * 26 * u - n * w) / (n - 1) : 0;
    const x0 = n > 1 ? b.x + 26 * u : b.x + (b.w - w) / 2;
    const yOf = (v: number): number => top + h - ((v - bars.min) / (bars.max - bars.min)) * h;
    bars.items.forEach((it, i) => {
      const x = x0 + i * (w + gap);
      g.fillStyle = '#1b2023';
      g.fillRect(x, top, w, h);
      for (const a of bars.arcs ?? []) {
        g.fillStyle = EIS_BAND[a.color];
        g.globalAlpha = 0.35;
        g.fillRect(x, yOf(a.to), 3 * u, yOf(a.from) - yOf(a.to));
        g.globalAlpha = 1;
      }
      const v = this.latch.get(2 + this.def.readouts.length + i);
      const band = eisBandAt(bars.arcs, v);
      g.fillStyle = band === 'red' ? EIS_BAND.red : band === 'yellow' ? EIS_BAND.yellow : EIS_BAND.green;
      g.fillRect(x + 4 * u, yOf(v), w - 4 * u, top + h - yOf(v));
      for (const rl of bars.redLines ?? []) {
        g.fillStyle = EIS_BAND.red;
        g.fillRect(x - 1 * u, yOf(rl) - 1 * u, w + 2 * u, 2 * u);
      }
      g.font = `600 ${Math.round(8.5 * u)}px ${LABEL_FONT}`;
      g.fillStyle = TITLE;
      g.textAlign = 'center';
      g.textBaseline = 'top';
      g.fillText(it.label, x + w / 2, top + h + 3 * u);
    });
  }

  private drawReadouts(g: Ctx2D, readouts: readonly EisReadout[], b: Rect, u: number, top: number, hasDial: boolean, hasBars: boolean): void {
    const n = readouts.length;
    if (!n) return;
    const area = b.y + b.h - 6 * u - top;
    const rowH = Math.min(hasDial ? 24 * u : 28 * u, area / n);
    // A dialled window puts its first figure under the needle; the rest stack below it. Without a dial the rows fill the window.
    const y0 = hasBars ? b.y + b.h - 6 * u - rowH * n : hasDial ? b.y + b.h - 6 * u - rowH * n : top;
    readouts.forEach((ro, i) => {
      const v = this.latch.get(2 + i);
      const y = y0 + i * rowH + rowH / 2;
      const big = Math.round((hasDial && n === 1 ? 19 : n >= 3 ? 12 : 15) * u);
      g.font = `700 ${Math.round(9 * u)}px ${LABEL_FONT}`;
      g.fillStyle = TITLE;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText(ro.label, b.x + 9 * u, y);
      g.font = `700 ${big}px ${DIAL_FONT}`;
      g.fillStyle = eisFigureColor(ro, v);
      g.textAlign = 'right';
      g.fillText(v.toFixed(ro.decimals), b.x + b.w - 9 * u - (ro.unit ? 24 * u : 0), y);
      if (ro.unit) {
        g.font = `600 ${Math.round(8.5 * u)}px ${LABEL_FONT}`;
        g.fillStyle = TITLE;
        g.textAlign = 'left';
        g.fillText(ro.unit, b.x + b.w - 7 * u - 24 * u, y + 1 * u);
      }
    });
  }
}
