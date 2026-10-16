// N1 (gas producer) tachometer with the 0-9 vernier of RFM Fig 2-5 sheet 2: the large needle reads percent on 0-110, the
// small sub-dial pointer turns once per 10 % (units digit). Green 64-105, red radials 59 and 105 (P). Spacing ESTIMATE.
import { clamp, DEG } from '../../core/math';
import type { InstrumentReadings } from '../../instruments/dynamics/instrumentSet';
import { SMALL_BEZEL } from '../../instruments/panelParts';
import { ARC_COLORS, arcBand, centredText, dialText, INK, tick } from '../../instruments/render/art';
import type { Ctx2D } from '../../instruments/render/canvas';
import { RoundGauge } from '../../instruments/render/roundGauge';
import { MD500_N1_SCALE as S } from './panelMarkings';

export const md500N1Angle = (pct: number): number => (-150 + 300 * clamp(pct / S.max, 0, 1.06)) * DEG;
/** Vernier pointer angle: one turn per 10 % N1. */
export const md500N1VernierAngle = (pct: number): number => (((pct % 10) + 10) % 10) / 10 * 2 * Math.PI;
const VERNIER = { x: 0, y: 24, r: 15 };

export class Md500N1Gauge extends RoundGauge {
  constructor(id: string, x: number, y: number, aperture: number) {
    super(id, x, y, { bezel: SMALL_BEZEL, aperture, shape: 'round', values: 2, seed: 501 });
  }
  /** Self-powered tach generator (no bus gate, ESTIMATE). */
  sample(r: InstrumentReadings): boolean {
    const n1 = r.engines[0].ngPct;
    this.latch.track(0, md500N1Angle(n1), 0.002);
    this.latch.track(1, md500N1VernierAngle(n1), 0.01);
    return this.latch.take();
  }
  protected paintFace(g: Ctx2D): void {
    const ro = 52;
    arcBand(g, md500N1Angle(S.green[0]), md500N1Angle(S.green[1]), ro, 4, ARC_COLORS.green);
    for (let v = 0; v <= S.max; v += 2) tick(g, md500N1Angle(v), ro - 3, ro, 0.8);
    for (const v of S.majors) {
      tick(g, md500N1Angle(v), ro - 6, ro, 1.4);
      if (v % 20 === 0 || v === 110) dialText(g, String(v), md500N1Angle(v), ro - 12, 8.5);
    }
    for (const v of S.redLines) tick(g, md500N1Angle(v), ro - 7, ro + 1, 2, ARC_COLORS.red);
    centredText(g, 'N1 %', 0, -18, 8);
    // Vernier sub-dial.
    g.strokeStyle = INK; g.lineWidth = 0.8; g.beginPath(); g.arc(VERNIER.x, VERNIER.y, VERNIER.r, 0, Math.PI * 2); g.stroke();
    for (let d = 0; d < 10; d++) {
      const a = d / 10 * 2 * Math.PI;
      g.save(); g.translate(VERNIER.x, VERNIER.y);
      tick(g, a, VERNIER.r - 3, VERNIER.r, 0.8);
      dialText(g, String(d), a, VERNIER.r - 8, 5.5);
      g.restore();
    }
  }
  protected drawDynamic(g: Ctx2D): void {
    g.save(); g.translate(this.cx, this.cy); g.rotate(this.latch.get(0));
    g.fillStyle = INK; g.beginPath(); g.moveTo(0, -48); g.lineTo(2, -40); g.lineTo(2, 8); g.lineTo(-2, 8); g.lineTo(-2, -40); g.closePath(); g.fill();
    g.restore();
    g.save(); g.translate(this.cx + VERNIER.x, this.cy + VERNIER.y); g.rotate(this.latch.get(1));
    g.fillStyle = INK; g.beginPath(); g.moveTo(0, -VERNIER.r + 2); g.lineTo(1.3, 0); g.lineTo(-1.3, 0); g.closePath(); g.fill();
    g.restore();
    g.fillStyle = '#898a86'; g.beginPath(); g.arc(this.cx, this.cy, 3, 0, Math.PI * 2); g.fill();
  }
}
