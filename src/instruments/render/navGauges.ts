// Course deviation indicators (VOR/LOC/GS) for NAV1 and NAV2.

import { DEG } from '../../core/math';
import type { InstrumentReadings } from '../dynamics/instrumentSet';
import { centredText, font, INK, knob, tick } from './art';
import { context2d, makeCanvas, type Ctx2D } from './canvas';
import { SIXPACK_BEZEL } from './pitotStaticGauges';
import { RoundGauge } from './roundGauge';

const DOT_SPACING = 8.5;
const NEEDLE_HALF = 40;

/**
 * CDI with glideslope. Full-scale deflection (5 dots) corresponds to the full-scale signal from the
 * receiver. NAV2 is not connected to a receiver in this simulation, so its flags are always in view.
 */
export class CdiGauge extends RoundGauge {
  private card: HTMLCanvasElement | null = null;

  constructor(
    id: string,
    cx: number,
    cy: number,
    aperture: number,
    private readonly receiver: 'nav1' | 'nav2',
    /** Course set on the OBS when the receiver has no knob input (NAV2). */
    private readonly fixedCourseDeg: number,
  ) {
    super(id, cx, cy, { bezel: SIXPACK_BEZEL, aperture, shape: 'square', values: 5, seed: receiver === 'nav1' ? 108 : 109 });
  }

  sample(r: InstrumentReadings): boolean {
    const live = this.receiver === 'nav1' && r.avionicsPowered;
    this.latch.track(0, live && r.ils.locValid ? r.ils.loc : 0, 0.004);
    this.latch.track(1, live && r.ils.gsValid ? r.ils.gs : 0, 0.004);
    this.latch.set(2, live && r.ils.locValid ? 1 : 0, 1);
    this.latch.set(3, live && r.ils.gsValid ? 1 : 0, 1);
    // NAV1's OBS knob is ControlInputs.obsDeg (via readings.obsDeg). A localizer ignores the OBS, as on
    // the real receiver; the card still turns so the pilot can set the inbound course as a reminder.
    const course = this.receiver === 'nav1' && Number.isFinite(r.obsDeg) ? r.obsDeg : this.fixedCourseDeg;
    this.latch.set(4, ((course % 360) + 360) % 360, 0.25);
    return this.latch.take();
  }

  protected paintFace(g: Ctx2D): void {
    // Deviation dots and the centre ring.
    g.fillStyle = INK;
    for (let i = -5; i <= 5; i++) {
      if (i === 0) continue;
      g.beginPath();
      g.arc(i * DOT_SPACING, 0, 1.9, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(0, i * DOT_SPACING * 0.9, 1.6, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = INK;
    g.lineWidth = 1.4;
    g.beginPath();
    g.arc(0, 0, 5, 0, Math.PI * 2);
    g.stroke();
    centredText(g, this.receiver === 'nav1' ? 'NAV 1' : 'NAV 2', -26, 30, 7);
    centredText(g, 'GS', 44, -34, 6.5);
  }

  private buildCard(): void {
    // OBS compass rose, rotated so the selected course is under the top index.
    const size = 2 * this.r;
    const c = makeCanvas(size, size);
    const g = context2d(c);
    g.translate(size / 2, size / 2);
    const R = this.r - 2;
    for (let d = 0; d < 360; d += 5) {
      const major = d % 10 === 0;
      tick(g, d * DEG, R - (major ? 9 : 5), R, major ? 1.6 : 1);
    }
    for (let d = 0; d < 360; d += 30) {
      g.save();
      g.rotate(d * DEG);
      g.font = font(11, 600);
      g.fillStyle = INK;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(d / 10), 0, -R + 16);
      g.restore();
    }
    this.card = c;
  }

  protected drawDynamic(g: Ctx2D): void {
    if (!this.card) this.buildCard();
    const cx = this.cx;
    const cy = this.cy;
    g.save();
    g.beginPath();
    g.arc(cx, cy, this.r, 0, Math.PI * 2);
    g.clip();
    g.save();
    g.translate(cx, cy);
    g.rotate(-this.latch.get(4) * DEG);
    g.drawImage(this.card!, -this.r, -this.r);
    g.restore();
    const loc = this.latch.get(0) * 5 * DOT_SPACING;
    const gs = this.latch.get(1) * 5 * DOT_SPACING * 0.9;
    // Needles: localizer vertical, glideslope horizontal, with shadows.
    for (const [dx, dy, color] of [
      [1.2, 3, 'rgba(0,0,0,0.45)'],
      [0, 0, INK],
    ] as const) {
      g.fillStyle = color;
      g.fillRect(cx + loc - 1.4 + dx, cy - NEEDLE_HALF + dy, 2.8, 2 * NEEDLE_HALF);
      g.fillRect(cx - NEEDLE_HALF + dx, cy - gs - 1.4 + dy, 2 * NEEDLE_HALF, 2.8);
    }
    // Warning flags: NAV (red, left) and GS (red, right), in view when the signal is invalid.
    if (!this.latch.get(2)) flag(g, cx - 34, cy - 20, 'NAV');
    if (!this.latch.get(3)) flag(g, cx + 22, cy - 20, 'GS');
    g.restore();
  }

  protected paintFixtures(g: Ctx2D): void {
    // Fixed course index at the top and reciprocal index at the bottom.
    g.fillStyle = '#f08a1c';
    g.beginPath();
    g.moveTo(0, -this.r + 12);
    g.lineTo(-5, -this.r + 2);
    g.lineTo(5, -this.r + 2);
    g.closePath();
    g.fill();
    g.fillStyle = INK;
    g.beginPath();
    g.moveTo(0, this.r - 10);
    g.lineTo(-4, this.r - 2);
    g.lineTo(4, this.r - 2);
    g.closePath();
    g.fill();
  }

  protected paintOverBezel(g: Ctx2D): void {
    knob(g, -SIXPACK_BEZEL / 2 + 16, SIXPACK_BEZEL / 2 - 14, 11);
    centredText(g, 'OBS', -SIXPACK_BEZEL / 2 + 36, SIXPACK_BEZEL / 2 - 8, 6);
  }
}

function flag(g: Ctx2D, x: number, y: number, text: string): void {
  g.fillStyle = 'rgba(0,0,0,0.4)';
  g.fillRect(x + 1, y + 2, 16, 11);
  const grad = g.createLinearGradient(x, y, x, y + 11);
  grad.addColorStop(0, '#d9362b');
  grad.addColorStop(1, '#a8211a');
  g.fillStyle = grad;
  g.fillRect(x, y, 16, 11);
  g.fillStyle = '#f5f1e6';
  g.font = font(6, 700);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, x + 8, y + 6);
}
