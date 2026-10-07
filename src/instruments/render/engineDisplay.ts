// Boxed engine display: a screen with one row per engine parameter (LOAD %, RPM, fuel flow, temperatures,
// pressures, volts, amps), each a banded bar with a pointer and the figure, for one engine or for two side by
// side. The rows, their ranges, bands and limits are the type's panel data.

import { clamp } from '../../core/math';
import type { ControlInputs } from '../../core/types';
import type { InstrumentReadings } from '../dynamics/instrumentSet';
import type { ArcColor, PanelEngineDisplayRow } from '../panelDef';
import { font } from './art';
import { faceplate, RackUnit, screenGlass } from './avionics';
import { LABEL_FONT, type Ctx2D } from './canvas';
import { Latch, type Rect } from './component';

/** Display colours of a band and of a figure inside it. */
const BAND: Record<ArcColor, string> = { green: '#2fd45a', yellow: '#ffd21e', red: '#ff3b2a', white: '#e8f3ff', blue: '#5fb4ff' };
const FIGURE_NORMAL = '#e8f3ff';

/** The colour of the band a value lies in, or null outside every band. A later band wins where two meet. */
export function engineDisplayBand(row: PanelEngineDisplayRow, v: number): ArcColor | null {
  let color: ArcColor | null = null;
  for (const a of row.arcs ?? []) if (v >= a.from && v <= a.to) color = a.color;
  return color;
}

/** Colour of the figure of a row: red or yellow inside a band of that colour, else the normal white. */
export function engineDisplayFigureColor(row: PanelEngineDisplayRow, v: number): string {
  const band = engineDisplayBand(row, v);
  return band === 'red' || band === 'yellow' ? BAND[band] : FIGURE_NORMAL;
}

/** The figure of a row as lettered: fixed decimals, held at the ends of the row's range. */
export function engineDisplayFigure(row: PanelEngineDisplayRow, v: number): string {
  return clamp(v, row.min, row.max).toFixed(row.decimals ?? 0);
}

export class EngineDisplay extends RackUnit {
  /** The display refreshes four times a second (like the GPS, it is not redrawn every frame). */
  static readonly REFRESH = 0.25;
  private static readonly PAD = 10;
  protected readonly screens: readonly Rect[];
  private readonly screen: Rect;
  /** Power, then one figure per row and engine. */
  private readonly latch: Latch;
  private lastRefresh = -Infinity;

  constructor(
    id: string,
    bounds: Rect,
    private readonly engines: number,
    private readonly rows: readonly PanelEngineDisplayRow[],
  ) {
    super(id, bounds);
    const p = EngineDisplay.PAD;
    this.screen = { x: p, y: p, w: bounds.w - 2 * p, h: bounds.h - 2 * p - 2 };
    this.screens = [this.screen];
    this.latch = new Latch(1 + rows.length * engines);
  }

  sample(r: InstrumentReadings, _c: ControlInputs, time: number): boolean {
    this.latch.set(0, r.busPowered ? 1 : 0, 1);
    if (Math.abs(time - this.lastRefresh) >= EngineDisplay.REFRESH) {
      this.lastRefresh = time;
      const n = this.engines;
      for (let i = 0; i < this.rows.length; i++) {
        const row = this.rows[i];
        const quantum = 10 ** -(row.decimals ?? 0);
        for (let e = 0; e < n; e++) this.latch.set(1 + i * n + e, clamp(row.read(r, e), row.min, row.max), quantum);
      }
    }
    return this.latch.take();
  }

  /** The figure shown for a row and engine at the last refresh. */
  shown(row: number, engine: number): number {
    return this.latch.get(1 + row * this.engines + engine);
  }

  protected paintChassis(g: Ctx2D): void {
    const { w, h } = this.bounds;
    faceplate(g, w, h, 331);
    const s = this.screen;
    g.fillStyle = '#050505';
    g.fillRect(s.x - 3, s.y - 3, s.w + 6, s.h + 6);
  }

  protected drawDisplay(g: Ctx2D): void {
    const s = this.screen;
    g.fillStyle = '#020303';
    g.fillRect(s.x, s.y, s.w, s.h);
    if (this.latch.get(0)) {
      const twin = this.engines > 1;
      const head = twin ? 14 : 0;
      const rowH = (s.h - head) / Math.max(1, this.rows.length);
      // Two engines: the legend column in the middle, a bar and a figure on each side of it.
      const mid = s.x + s.w / 2;
      const legendW = Math.min(64, s.w * 0.3);
      if (twin) {
        g.font = `700 9px ${LABEL_FONT}`;
        g.fillStyle = '#7fc4ea';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('L', s.x + (s.w - legendW) / 4, s.y + head / 2 + 1);
        g.fillText('R', s.x + s.w - (s.w - legendW) / 4, s.y + head / 2 + 1);
      }
      this.rows.forEach((row, i) => {
        const y = s.y + head + i * rowH;
        g.textBaseline = 'middle';
        g.fillStyle = '#7fc4ea';
        if (twin) {
          g.textAlign = 'center';
          g.font = `600 8px ${LABEL_FONT}`;
          g.fillText(row.label, mid, y + rowH * 0.36);
          g.font = `500 6.5px ${LABEL_FONT}`;
          g.fillText(row.unit, mid, y + rowH * 0.74);
          this.drawSide(g, row, this.shown(i, 0), s.x + 4, mid - legendW / 2 - 2, y, rowH, false);
          this.drawSide(g, row, this.shown(i, 1), mid + legendW / 2 + 2, s.x + s.w - 4, y, rowH, true);
        } else {
          g.textAlign = 'left';
          g.font = `600 8px ${LABEL_FONT}`;
          g.fillText(row.label, s.x + 4, y + rowH * 0.36);
          g.font = `500 6.5px ${LABEL_FONT}`;
          g.fillText(row.unit, s.x + 4, y + rowH * 0.74);
          this.drawSide(g, row, this.shown(i, 0), s.x + legendW, s.x + s.w - 4, y, rowH, false);
        }
      });
    }
    screenGlass(g, s.x, s.y, s.w, s.h);
  }

  /** One engine's bar and figure of a row between x0 and x1; `mirrored` puts the figure on the inner (left) end. */
  private drawSide(g: Ctx2D, row: PanelEngineDisplayRow, v: number, x0: number, x1: number, y: number, rowH: number, mirrored: boolean): void {
    const figureW = Math.min(34, (x1 - x0) * 0.4);
    const bx0 = mirrored ? x0 + figureW : x0;
    const bx1 = mirrored ? x1 : x1 - figureW;
    const by = y + rowH * 0.62;
    const at = (value: number): number => bx0 + ((clamp(value, row.min, row.max) - row.min) / (row.max - row.min)) * (bx1 - bx0);
    g.fillStyle = '#2a3238';
    g.fillRect(bx0, by - 1.5, bx1 - bx0, 3);
    for (const a of row.arcs ?? []) {
      g.fillStyle = BAND[a.color];
      g.fillRect(at(a.from), by - 1.5, at(a.to) - at(a.from), 3);
    }
    g.fillStyle = BAND.red;
    for (const limit of row.redLines ?? []) g.fillRect(at(limit) - 0.75, by - 5, 1.5, 8);
    // Pointer: a white triangle riding on the bar.
    const px = at(v);
    g.fillStyle = FIGURE_NORMAL;
    g.beginPath();
    g.moveTo(px, by - 2);
    g.lineTo(px - 3.5, by - 8);
    g.lineTo(px + 3.5, by - 8);
    g.closePath();
    g.fill();
    g.font = font(Math.min(13, rowH * 0.55), 600);
    g.fillStyle = engineDisplayFigureColor(row, v);
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    g.fillText(engineDisplayFigure(row, v), mirrored ? x0 + figureW - 4 : x1, y + rowH * 0.5);
  }
}
