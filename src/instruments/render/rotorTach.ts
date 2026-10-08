// Electronic helicopter dual tachometer: independent, mirrored E/R scales in one 3-1/8 inch case.
// Needles move together in powered flight and split when the freewheel overruns the engine.
import { clamp, DEG } from '../../core/math';
import type { InstrumentReadings } from '../dynamics/instrumentSet';
import type { RotorTachMarkings } from '../panelDef';
import { LARGE_BEZEL } from '../panelParts';
import { ARC_COLORS, arcBand, centredText, INK, tick } from './art';
import type { Ctx2D } from './canvas';
import { RoundGauge } from './roundGauge';

/** Unoccupied instrument hole closed by a black plate. */
export class BlankGauge extends RoundGauge {
  constructor(id: string, x: number, y: number, aperture: number) {
    super(id, x, y, { bezel: LARGE_BEZEL, aperture, shape: 'square', values: 0, seed: 323 });
  }
  sample(): boolean { return this.latch.take(); }
  protected paintFace(): void {}
  protected drawDynamic(): void {}
  paintLightMask(): void {}
}

export class RotorTachGauge extends RoundGauge {
  constructor(id: string, x: number, y: number, aperture: number, private readonly marks: RotorTachMarkings) {
    super(id, x, y, { bezel: LARGE_BEZEL, aperture, shape: 'square', values: 2, seed: 322 });
  }
  /** The left scale runs upward clockwise from the lower stop; the right is its mirror. */
  angle(percent: number, rotor = false): number {
    const m = this.marks;
    const a = (145 - 110 * (clamp(percent, m.min, m.max) - m.min) / (m.max - m.min)) * DEG;
    return rotor ? -a : a;
  }
  sample(r: InstrumentReadings): boolean {
    this.latch.track(0, this.angle(r.engineRpmPct), 0.0015);
    this.latch.track(1, this.angle(r.rotorRpmPct, true), 0.0015);
    return this.latch.take();
  }
  protected paintFace(g: Ctx2D): void {
    const m = this.marks;
    const radius = 57;
    for (const rotor of [false, true]) {
      const sign = rotor ? 1 : -1;
      g.save();
      g.translate(sign * 57, 0);
      for (const arc of rotor ? m.rotorArcs : m.engineArcs) {
        const a = this.angle(arc.from, rotor), b = this.angle(arc.to, rotor);
        arcBand(g, Math.min(a, b), Math.max(a, b), radius, 6, ARC_COLORS[arc.color]);
      }
      for (let v = m.min; v <= m.max; v += m.minorStep) {
        const major = v % m.majorStep === 0;
        const a = this.angle(v, rotor);
        tick(g, a, radius - (major ? 8 : 4), radius + 1, major ? 1.4 : 0.8);
        if (major) centredText(g, String(v), Math.sin(a) * (radius - 17), -Math.cos(a) * (radius - 17), 8.5);
      }
      if (rotor) for (const v of m.rotorRedLines) tick(g, this.angle(v, true), radius - 8, radius + 2, 2, ARC_COLORS.red);
      g.restore();
    }
    centredText(g, 'E', -18, -57, 12);
    centredText(g, 'R', 18, -57, 12);
    centredText(g, '% RPM', 0, 60, 8);
  }
  protected drawDynamic(g: Ctx2D): void {
    for (let i = 0; i < 2; i++) {
      g.save();
      g.translate(this.cx + (i === 0 ? -57 : 57), this.cy);
      g.rotate(this.latch.get(i));
      g.strokeStyle = INK;
      g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(0, 3); g.lineTo(0, -61); g.stroke();
      g.restore();
    }
  }
}
