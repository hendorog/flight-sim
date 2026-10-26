// A fuel quantity gauge in a small upright rectangular case (the Tomahawk's, in the quadrant's tilted housing): the
// pointer pivoted at the inboard edge reads outboard across a quarter sector, 45 deg below the horizontal (E) to 45 deg
// above it (full), so the left and right gauges are mirror images; the tank letter and the legend.
import { clamp, DEG } from '../../core/math';
import type { InstrumentReadings } from '../dynamics/instrumentSet';
import { ARC_COLORS, arcBand, centredText, dialText, tick } from './art';
import type { Ctx2D } from './canvas';
import { Latch, LIGHT_DIAL, type PanelComponent, type Rect } from './component';

export interface RectFuelGaugeDef {
  /** The tank letter, and the side the pointer reads on (L: pointing left, pivot on the right edge; R: the mirror). */
  tank: 'L' | 'R';
  /** Full scale and the numbered marks, US gal. */
  max: number;
  majors: readonly number[];
  minorStep: number;
  /** The legend under the scale. */
  legend: string;
  read(r: InstrumentReadings): number;
}

export class RectFuelGauge implements PanelComponent {
  private readonly latch = new Latch(1);
  constructor(readonly id: string, readonly bounds: Rect, private readonly def: RectFuelGaugeDef) {}

  /** Pointer angle (0 = up, + clockwise): 45 deg below the horizontal at E to 45 deg above it at full, outboard. */
  private angle(gal: number): number {
    const f = clamp(gal / this.def.max, 0, 1);
    return (this.def.tank === 'L' ? -135 + 90 * f : 135 - 90 * f) * DEG;
  }

  sample(r: InstrumentReadings): boolean {
    this.latch.track(0, this.angle(this.def.read(r)), 0.003);
    return this.latch.take();
  }

  draw(g: Ctx2D): void {
    const b = this.bounds;
    const d = this.def;
    const left = d.tank === 'L';
    g.save();
    g.translate(b.x, b.y);
    g.fillStyle = '#0d0e0f';
    g.strokeStyle = '#55565a';
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(1.5, 1.5, b.w - 3, b.h - 3, 6);
    g.fill();
    g.stroke();
    // The tank letter in the upper inboard corner, over the pivot.
    centredText(g, d.tank, left ? b.w * 0.8 : b.w * 0.2, b.h * 0.2, b.w * 0.24);
    centredText(g, 'TANK', left ? b.w * 0.8 : b.w * 0.2, b.h * 0.29, b.w * 0.09);
    g.save();
    g.translate(left ? b.w * 0.84 : b.w * 0.16, b.h * 0.54);
    const radius = b.w * 0.66;
    // The red band at E (arcBand runs clockwise from its first angle).
    const e0 = this.angle(0), e1 = this.angle(d.max * 0.06);
    arcBand(g, Math.min(e0, e1), Math.max(e0, e1), radius - 2, 4, ARC_COLORS.red);
    for (let v = 0; v <= d.max + 1e-8; v += d.minorStep) tick(g, this.angle(v), radius - 5, radius, 1);
    for (const v of d.majors) {
      tick(g, this.angle(v), radius - 9, radius, 1.6);
      dialText(g, v === 0 ? 'E' : String(v), this.angle(v), radius - 17, b.w * 0.13);
    }
    g.rotate(this.latch.get(0));
    g.strokeStyle = '#f2eedc';
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(0, 3);
    g.lineTo(0, -radius + 3);
    g.stroke();
    g.fillStyle = '#5b5c5e';
    g.beginPath();
    g.arc(0, 0, 4, 0, 2 * Math.PI);
    g.fill();
    g.restore();
    centredText(g, d.legend, b.w / 2, b.h - 7, b.w * 0.095);
    g.restore();
  }

  paintLightMask(g: Ctx2D): void {
    const b = this.bounds;
    g.fillStyle = LIGHT_DIAL;
    g.fillRect(b.x, b.y, b.w, b.h);
  }
}
