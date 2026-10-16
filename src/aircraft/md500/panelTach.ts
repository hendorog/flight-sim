// RFM Fig 2-5 sheet 2 dual tachometer: N2 percent (outer scale, long needle) over rotor rpm x 100 (inner scale,
// short needle lettered R). Both needles share ONE angle law (rotor rpm / 477.67 = percent) so that in powered flight
// they superimpose (RFM 4-17: within half a needle width) and split when the rotor overruns the freewheel.
// Dial spacing ESTIMATE; band boundaries P (panelMarkings.ts).
import { clamp, DEG } from '../../core/math';
import type { InstrumentReadings } from '../../instruments/dynamics/instrumentSet';
import { LARGE_BEZEL } from '../../instruments/panelParts';
import { ARC_COLORS, arcBand, centredText, dialText, INK, tick } from '../../instruments/render/art';
import type { Ctx2D } from '../../instruments/render/canvas';
import { RoundGauge } from '../../instruments/render/roundGauge';
import { MD500_N2_SCALE as N2, MD500_NR_SCALE as NR, nrToDialPct } from './panelMarkings';

/** Needle angle (rad from 12 o'clock) of an N2 percent (or the rotor's equivalent percent): 0 at -150 deg, 120 % at +150 deg. */
export function md500TachAngle(pct: number): number {
  return (-150 + 300 * clamp(pct / N2.max, 0, 1.06)) * DEG;
}

export class Md500DualTach extends RoundGauge {
  constructor(id: string, x: number, y: number, aperture: number) {
    super(id, x, y, { bezel: LARGE_BEZEL, aperture, shape: 'round', values: 2, seed: 500 });
  }
  /** N2 from the engine's output-shaft speed (engineRpmPct), Nr from the rotor (rotorRpmPct is percent of 477.67 rpm). */
  sample(r: InstrumentReadings): boolean {
    this.latch.track(0, md500TachAngle(r.engineRpmPct), 0.0015);
    this.latch.track(1, md500TachAngle(r.rotorRpmPct), 0.0015);
    return this.latch.take();
  }
  protected paintFace(g: Ctx2D): void {
    // Outer scale: N2 percent.
    const ro = 76;
    arcBand(g, md500TachAngle(N2.green[0]), md500TachAngle(N2.green[1]), ro, 5, ARC_COLORS.green);
    for (let v = 0; v <= N2.max; v += N2.minorStep) tick(g, md500TachAngle(v), ro - 4, ro, 0.9);
    for (const v of N2.majors) {
      tick(g, md500TachAngle(v), ro - 8, ro, 1.6);
      if (v % 20 === 0 || v >= 100) dialText(g, String(v), md500TachAngle(v), ro - 15, 9.5);
    }
    for (const v of N2.redLines) tick(g, md500TachAngle(v), ro - 9, ro + 1, 2, ARC_COLORS.red);
    g.fillStyle = ARC_COLORS.red; g.beginPath();
    g.arc(Math.sin(md500TachAngle(N2.redDot)) * (ro - 3), -Math.cos(md500TachAngle(N2.redDot)) * (ro - 3), 2.6, 0, Math.PI * 2); g.fill();
    // Inner scale: rotor rpm x 100 (the same angle law through nrToDialPct).
    const ri = 46, a = (rpm: number): number => md500TachAngle(nrToDialPct(rpm));
    arcBand(g, a(NR.green[0]), a(NR.green[1]), ri, 4, ARC_COLORS.green);
    for (let v = 0; v <= 560; v += 20) tick(g, a(v), ri - 3, ri, 0.8);
    for (const v of NR.majorsHundreds) {
      tick(g, a(v * 100), ri - 6, ri, 1.4);
      dialText(g, String(v), a(v * 100), ri - 12, 8);
    }
    for (const v of NR.redLines) tick(g, a(v), ri - 7, ri + 1, 2, ARC_COLORS.red);
    centredText(g, 'N2 %', 0, -30, 8); centredText(g, 'RPM ×100', 0, 28, 7.5); centredText(g, 'ROTOR', 0, 38, 6.5);
  }
  protected drawDynamic(g: Ctx2D): void {
    for (let i = 0; i < 2; i++) {
      g.save(); g.translate(this.cx, this.cy); g.rotate(this.latch.get(i));
      g.fillStyle = INK; g.strokeStyle = INK; g.lineWidth = 1.2;
      const length = i === 0 ? 70 : 42;
      g.beginPath(); g.moveTo(0, -length); g.lineTo(2.2, -length + 9);
      g.lineTo(2.2, 9); g.lineTo(-2.2, 9); g.lineTo(-2.2, -length + 9); g.closePath();
      if (i === 0) g.fill(); else {
        g.fillStyle = '#171819'; g.fill(); g.stroke();
        // The R of the short rotor needle.
        centredText(g, 'R', 0, -length + 20, 8, INK, 700);
      }
      g.restore();
    }
    g.fillStyle = '#898a86'; g.beginPath(); g.arc(this.cx, this.cy, 3.2, 0, Math.PI * 2); g.fill();
  }
}
