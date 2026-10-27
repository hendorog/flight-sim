// Moving-coil engine instruments in a rectangular case: paired (R22 lower console) or single (C152 lower panel).
import { clamp, DEG } from '../../core/math';
import type { InstrumentReadings } from '../dynamics/instrumentSet';
import type { ScaleDef } from '../panelDef';
import { ARC_COLORS, arcBand, centredText, dialText, tick } from './art';
import type { Ctx2D } from './canvas';
import { Latch, LIGHT_DIAL, type PanelComponent, type Rect } from './component';

/** Pointer angle of a value on a 100 degree sector centred on 12 o'clock, rad. */
const sectorAngle = (value: number, scale: ScaleDef): number =>
  (-50 + 100 * clamp((value - scale.min) / (scale.max - scale.min), 0, 1)) * DEG;

/** The dark case of a rectangular instrument, local px. */
function paintCase(g: Ctx2D, w: number, h: number): void {
  g.fillStyle = '#111213'; g.strokeStyle = '#6b6c68'; g.lineWidth = 2;
  g.beginPath(); g.roundRect(2, 2, w - 4, h - 4, 12); g.fill(); g.stroke();
}

/** One scale with its pointer at `angle`, pivot at the origin; the scale's label inside the arc unless `label` is false. */
function paintSector(g: Ctx2D, s: ScaleDef, radius: number, angle: number, label = true, numberSize = 8): void {
  for (const a of s.arcs ?? []) arcBand(g, sectorAngle(a.from, s), sectorAngle(a.to, s), radius, 4, ARC_COLORS[a.color]);
  for (let v = s.min; v <= s.max + 1e-8; v += s.minorStep) tick(g, sectorAngle(v, s), radius - 4, radius, 1);
  for (const v of s.majors) {
    tick(g, sectorAngle(v, s), radius - 7, radius, 1.3);
    dialText(g, String(v), sectorAngle(v, s), radius - 15, numberSize);
  }
  for (const v of s.redLines ?? []) tick(g, sectorAngle(v, s), radius - 8, radius + 1, 2.5, ARC_COLORS.red);
  if (label) centredText(g, s.label, 0, -radius * 0.34, 8);
  g.rotate(angle);
  g.strokeStyle = '#eee9d6'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 2); g.lineTo(0, -radius + 4); g.stroke();
  g.fillStyle = '#666'; g.beginPath(); g.arc(0, 0, 3, 0, 2 * Math.PI); g.fill();
}

export class DualSectorGauge implements PanelComponent {
  private readonly latch = new Latch(2);
  constructor(readonly id: string, readonly bounds: Rect, private readonly left: ScaleDef, private readonly right: ScaleDef) {}
  sample(r: InstrumentReadings): boolean {
    [this.left, this.right].forEach((s, i) => this.latch.track(i, sectorAngle(s.read(r), s), 0.003));
    return this.latch.take();
  }
  draw(g: Ctx2D): void {
    const b = this.bounds;
    g.save(); g.translate(b.x, b.y);
    paintCase(g, b.w, b.h);
    [this.left, this.right].forEach((s, i) => {
      g.save(); g.translate(b.w * (i ? 0.75 : 0.25), b.h - 13);
      paintSector(g, s, Math.min(b.w * 0.23, b.h - 19), this.latch.get(i));
      g.restore();
    });
    g.restore();
  }
  paintLightMask(g: Ctx2D): void { const b = this.bounds; g.fillStyle = LIGHT_DIAL; g.fillRect(b.x, b.y, b.w, b.h); }
}

/** One such instrument on its own: a single scale in a small case, the pivot low, its title (in place of the scale's label) along the foot. */
export class SectorGauge implements PanelComponent {
  private readonly latch = new Latch(1);
  constructor(readonly id: string, readonly bounds: Rect, private readonly title: string, private readonly scale: ScaleDef) {}
  sample(r: InstrumentReadings): boolean {
    this.latch.track(0, sectorAngle(this.scale.read(r), this.scale), 0.003);
    return this.latch.take();
  }
  draw(g: Ctx2D): void {
    const b = this.bounds;
    g.save(); g.translate(b.x, b.y);
    paintCase(g, b.w, b.h);
    centredText(g, this.title, b.w / 2, b.h - 9, 6.5);
    g.translate(b.w / 2, b.h - 19);
    paintSector(g, this.scale, Math.min(b.w * 0.5, b.h - 22), this.latch.get(0), false, 7);
    g.restore();
  }
  paintLightMask(g: Ctx2D): void { const b = this.bounds; g.fillStyle = LIGHT_DIAL; g.fillRect(b.x, b.y, b.w, b.h); }
}
