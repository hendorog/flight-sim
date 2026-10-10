// Paired moving-coil engine instruments in a rectangular case (R22 lower console).
import { clamp, DEG } from '../../core/math';
import type { InstrumentReadings } from '../dynamics/instrumentSet';
import type { ScaleDef } from '../panelDef';
import { ARC_COLORS, arcBand, centredText, dialText, tick } from './art';
import type { Ctx2D } from './canvas';
import { Latch, LIGHT_DIAL, type PanelComponent, type Rect } from './component';

export class DualSectorGauge implements PanelComponent {
  private readonly latch = new Latch(2);
  constructor(readonly id: string, readonly bounds: Rect, private readonly left: ScaleDef, private readonly right: ScaleDef) {}
  private angle(value: number, scale: ScaleDef): number {
    return (-50 + 100 * clamp((value - scale.min) / (scale.max - scale.min), 0, 1)) * DEG;
  }
  sample(r: InstrumentReadings): boolean {
    [this.left, this.right].forEach((s, i) => this.latch.track(i, this.angle(s.read(r), s), 0.003));
    return this.latch.take();
  }
  draw(g: Ctx2D): void {
    const b = this.bounds;
    g.save(); g.translate(b.x, b.y);
    g.fillStyle = '#111213'; g.strokeStyle = '#6b6c68'; g.lineWidth = 2;
    g.beginPath(); g.roundRect(2, 2, b.w - 4, b.h - 4, 12); g.fill(); g.stroke();
    [this.left, this.right].forEach((s, i) => {
      g.save(); g.translate(b.w * (i ? 0.75 : 0.25), b.h - 13);
      const radius = Math.min(b.w * 0.23, b.h - 19);
      for (const a of s.arcs ?? []) arcBand(g, this.angle(a.from, s), this.angle(a.to, s), radius, 4, ARC_COLORS[a.color]);
      for (let v = s.min; v <= s.max + 1e-8; v += s.minorStep) tick(g, this.angle(v, s), radius - 4, radius, 1);
      for (const v of s.majors) {
        tick(g, this.angle(v, s), radius - 7, radius, 1.3);
        dialText(g, String(v), this.angle(v, s), radius - 15, 8);
      }
      for (const v of s.redLines ?? []) tick(g, this.angle(v, s), radius - 8, radius + 1, 2.5, ARC_COLORS.red);
      centredText(g, s.label, 0, -radius * 0.34, 8);
      g.rotate(this.latch.get(i));
      g.strokeStyle = '#eee9d6'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 2); g.lineTo(0, -radius + 4); g.stroke();
      g.fillStyle = '#666'; g.beginPath(); g.arc(0, 0, 3, 0, 2 * Math.PI); g.fill();
      g.restore();
    });
    g.restore();
  }
  paintLightMask(g: Ctx2D): void { const b = this.bounds; g.fillStyle = LIGHT_DIAL; g.fillRect(b.x, b.y, b.w, b.h); }
}
