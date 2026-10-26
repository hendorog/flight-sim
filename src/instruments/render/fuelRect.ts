// A fuel quantity gauge in a small upright rectangular case (the Tomahawk's, in the quadrant's tilted housing): the
// tank letter, a quarter-sector scale with E at the bottom and its pointer pivoted in the lower outboard corner.
import { clamp, DEG } from '../../core/math';
import type { InstrumentReadings } from '../dynamics/instrumentSet';
import { ARC_COLORS, arcBand, centredText, dialText, tick } from './art';
import type { Ctx2D } from './canvas';
import { Latch, LIGHT_DIAL, type PanelComponent, type Rect } from './component';

export interface RectFuelGaugeDef {
  /** The tank letter, large, and the side the pivot is on (L: the lower left corner, R: the lower right). */
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

  /** Pointer angle (0 = up, + clockwise): from lying along the bottom (E) up to upright (full), swung away from the pivot's side. */
  private angle(gal: number): number {
    const f = clamp(gal / this.def.max, 0, 1);
    const s = this.def.tank === 'L' ? 1 : -1;
    return s * (90 - 80 * f) * DEG - s * 5 * DEG;
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
    // The tank letter at the top, on the side away from the pivot.
    centredText(g, d.tank, left ? b.w * 0.72 : b.w * 0.28, b.h * 0.24, b.w * 0.3);
    centredText(g, 'TANK', left ? b.w * 0.72 : b.w * 0.28, b.h * 0.34, b.w * 0.1);
    g.save();
    g.translate(left ? b.w * 0.2 : b.w * 0.8, b.h * 0.8);
    const radius = Math.min(b.w * 0.62, b.h * 0.55);
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
