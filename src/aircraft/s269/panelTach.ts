// RFM Fig 2-3 sheet 4: concentric absolute scales, ENGINE outside / ROTOR inside, RPM ×100.
// Ready for a supervisor-owned component-factory hook; PanelDef cannot select this renderer yet.
import { clamp, DEG } from '../../core/math';
import type { InstrumentReadings } from '../../instruments/dynamics/instrumentSet';
import { LARGE_BEZEL } from '../../instruments/panelParts';
import { ARC_COLORS, arcBand, centredText, dialText, INK, tick } from '../../instruments/render/art';
import type { Ctx2D } from '../../instruments/render/canvas';
import { RoundGauge } from '../../instruments/render/roundGauge';
import { S269_DISENGAGED_RPM, S269_ENGINE_RPM, S269_ROTOR_RPM, s269EngineRpm, s269RotorRpm } from './panelMarkings';
import { S269_REFERENCE as V } from './reference';

/** Angular spacing estimated from the RFM figure. The frozen 2700:471 reference ratio
 * approximates the drive ratio; matched shaft speeds must superimpose. */
export function s269TachAngle(rpm: number, rotor = false): number {
  const engineEquivalent = rotor ? rpm * V.engineRpm100 / V.rotorRpm100 : rpm;
  return (-145 + 290 * clamp(engineEquivalent / 3500, 0, 1)) * DEG;
}

export class S269AbsoluteTach extends RoundGauge {
  constructor(id: string, x: number, y: number, aperture: number) {
    super(id, x, y, { bezel: LARGE_BEZEL, aperture, shape: 'round', values: 2, seed: 269 });
  }
  sample(r: InstrumentReadings): boolean {
    this.latch.track(0, s269TachAngle(s269EngineRpm(r)), 0.0015);
    this.latch.track(1, s269TachAngle(s269RotorRpm(r), true), 0.0015);
    return this.latch.take();
  }
  protected paintFace(g: Ctx2D): void {
    for (const rotor of [false, true]) {
      const s = rotor ? S269_ROTOR_RPM : S269_ENGINE_RPM;
      const radius = rotor ? 44 : 70;
      const angle = (v: number): number => s269TachAngle(v, rotor);
      for (const a of s.arcs ?? []) arcBand(g, angle(a.from), angle(a.to), radius, 4, ARC_COLORS[a.color]);
      for (let v = 0; v <= s.max; v += s.minorStep) tick(g, angle(v), radius - 4, radius, 0.9);
      for (const v of s.majors) {
        tick(g, angle(v), radius - 7, radius, 1.5);
        dialText(g, String(v / 100), angle(v), radius - 12, rotor ? 7.5 : 9);
      }
      for (const v of s.redLines ?? []) tick(g, angle(v), radius - 8, radius + 1, 2, ARC_COLORS.red);
    }
    g.save(); g.rotate(s269TachAngle(S269_DISENGAGED_RPM));
    g.fillStyle = ARC_COLORS.red; g.beginPath();
    g.moveTo(-3, -72); g.lineTo(3, -72); g.lineTo(0, -64); g.closePath(); g.fill(); g.restore();
    centredText(g, 'RPM', 0, 6, 9); centredText(g, '×100', 0, 17, 7);
    centredText(g, 'ROTOR', 0, 34, 6.5); centredText(g, 'ENGINE', 0, 61, 7);
  }
  protected drawDynamic(g: Ctx2D): void {
    for (let i = 0; i < 2; i++) {
      g.save(); g.translate(this.cx, this.cy); g.rotate(this.latch.get(i));
      g.fillStyle = INK; g.strokeStyle = INK; g.lineWidth = 1.2;
      const length = i === 0 ? 65 : 40;
      g.beginPath(); g.moveTo(0, -length); g.lineTo(2, -length + 8);
      g.lineTo(2, 9); g.lineTo(-2, 9); g.lineTo(-2, -length + 8); g.closePath();
      if (i === 0) g.fill(); else { g.fillStyle = '#171819'; g.fill(); g.stroke(); }
      g.restore();
    }
    g.fillStyle = '#898a86'; g.beginPath(); g.arc(this.cx, this.cy, 3, 0, Math.PI * 2); g.fill();
  }
}
