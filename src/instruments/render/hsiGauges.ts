// Horizontal situation indicator and radio magnetic indicator in the 3-1/8" case (drawn on the six-pack's
// geometry: aperture about 74 px). Both have a slaved compass card that turns with the heading.

import { DEG } from '../../core/math';
import type { InstrumentReadings } from '../dynamics/instrumentSet';
import { ARC_RED, centredText, font, INK, knob, tick } from './art';
import { context2d, makeCanvas, type Ctx2D } from './canvas';
import { SIXPACK_BEZEL } from './pitotStaticGauges';
import { RoundGauge } from './roundGauge';

const ORANGE = '#f08a1c';
const COURSE = '#e9c120';
const NEEDLE2 = '#3fbf5a';
/** HSI deviation dots: two each side, full scale (receiver signal 1) at the second dot. */
const DOT = 13;
/** Glideslope scale on the right: two dots each side. */
const GS_DOT = 12;

/** A compass card of radius R: ticks every 5 deg, numbers every 30 (N, E, S, W at the cardinals). */
function compassCard(R: number): HTMLCanvasElement {
  const size = 2 * R + 4;
  const c = makeCanvas(size, size);
  const g = context2d(c);
  g.translate(size / 2, size / 2);
  for (let d = 0; d < 360; d += 5) {
    const major = d % 10 === 0;
    tick(g, d * DEG, R - (major ? 9 : 5), R - 1, major ? 1.6 : 1);
  }
  const labels: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  for (let d = 0; d < 360; d += 30) {
    g.save();
    g.rotate(d * DEG);
    g.font = font(labels[d] ? 13 : 11, 600);
    g.fillStyle = INK;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(labels[d] ?? String(d / 10), 0, -R + 17);
    g.restore();
  }
  return c;
}

/** The card turned to the heading, the lubber line and 45-degree marks on the fixed ring. */
function drawCard(g: Ctx2D, card: HTMLCanvasElement, cx: number, cy: number, hdg: number): void {
  const c = Math.cos(-hdg);
  const s = Math.sin(-hdg);
  g.save();
  g.transform(c, s, -s, c, cx, cy);
  g.drawImage(card, -card.width / 2, -card.height / 2);
  g.restore();
}

function fixedRing(g: Ctx2D, R: number): void {
  for (const d of [45, 135, 225, 315]) tick(g, d * DEG, R + 1, R + 6, 2);
  g.fillStyle = ORANGE;
  g.beginPath();
  g.moveTo(0, -R + 1);
  g.lineTo(-4, -R - 6);
  g.lineTo(4, -R - 6);
  g.closePath();
  g.fill();
}

function flag(g: Ctx2D, x: number, y: number, text: string): void {
  g.fillStyle = ARC_RED;
  g.fillRect(x, y, 22, 11);
  g.fillStyle = '#f5f1e6';
  g.font = font(7, 700);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, x + 11, y + 6);
}

/**
 * HSI: slaved card, heading bug, course pointer with its deviation bar between two dots each side (full-scale
 * localiser / VOR deflection at the second dot), a fixed aircraft symbol, glideslope pointer on the right and
 * NAV / GS flags. Course from the OBS (NAV 1) or fixed (NAV 2, no receiver here).
 */
export class HsiGauge extends RoundGauge {
  private card: HTMLCanvasElement | null = null;

  constructor(
    id: string,
    cx: number,
    cy: number,
    aperture: number,
    private readonly receiver: 'nav1' | 'nav2',
    private readonly fixedCourseDeg: number,
  ) {
    super(id, cx, cy, { bezel: SIXPACK_BEZEL, aperture, shape: 'square', values: 7, seed: receiver === 'nav1' ? 131 : 132 });
  }

  private get R(): number {
    return this.r - 3;
  }

  sample(r: InstrumentReadings): boolean {
    const live = this.receiver === 'nav1' && r.avionicsPowered;
    this.latch.track(0, r.headingDeg * DEG, 0.002);
    this.latch.track(1, r.headingBugDeg * DEG, 0.002);
    const course = this.receiver === 'nav1' && Number.isFinite(r.obsDeg) ? r.obsDeg : this.fixedCourseDeg;
    this.latch.set(2, ((course % 360) + 360) % 360, 0.25);
    this.latch.track(3, live && r.ils.locValid ? r.ils.loc : 0, 0.004);
    this.latch.track(4, live && r.ils.gsValid ? r.ils.gs : 0, 0.004);
    this.latch.set(5, live && r.ils.locValid ? 1 : 0, 1);
    this.latch.set(6, live && r.ils.gsValid ? 1 : 0, 1);
    return this.latch.take();
  }

  protected paintFace(): void {
    // The card covers the face.
  }

  protected drawDynamic(g: Ctx2D): void {
    const R = this.R;
    if (!this.card) this.card = compassCard(R);
    const hdg = this.latch.get(0);
    drawCard(g, this.card, this.cx, this.cy, hdg);
    g.save();
    g.translate(this.cx, this.cy);
    // Heading bug on the card's rim.
    g.save();
    g.rotate(this.latch.get(1) - hdg);
    g.fillStyle = ORANGE;
    g.fillRect(-6, -R + 1, 12, 5);
    g.clearRect(-1.5, -R + 1, 3, 3);
    g.restore();
    // Course pointer, deviation dots and bar, turned to the course on the card.
    g.save();
    g.rotate(this.latch.get(2) * DEG - hdg);
    g.fillStyle = INK;
    for (const i of [-2, -1, 1, 2]) {
      g.beginPath();
      g.arc(i * DOT, 0, 2.2, 0, Math.PI * 2);
      g.fill();
    }
    const dev = Math.max(-1.25, Math.min(1.25, this.latch.get(3))) * 2 * DOT;
    for (const [dx, dy, color] of [[1, 2, 'rgba(0,0,0,0.45)'], [0, 0, COURSE]] as const) {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(dx, -R + 13 + dy);
      g.lineTo(-6 + dx, -R + 24 + dy);
      g.lineTo(-2 + dx, -R + 24 + dy);
      g.lineTo(-2 + dx, -30 + dy);
      g.lineTo(2 + dx, -30 + dy);
      g.lineTo(2 + dx, -R + 24 + dy);
      g.lineTo(6 + dx, -R + 24 + dy);
      g.closePath();
      g.fill();
      g.fillRect(-2 + dx, 30 + dy, 4, R - 42);
      g.fillRect(dev - 2 + dx, -28 + dy, 4, 56);
    }
    g.restore();
    // Glideslope scale and pointer on the right.
    g.fillStyle = INK;
    for (const i of [-2, -1, 1, 2]) {
      g.beginPath();
      g.arc(R - 12, i * GS_DOT, 2, 0, Math.PI * 2);
      g.fill();
    }
    if (this.latch.get(6)) {
      const y = -Math.max(-1.25, Math.min(1.25, this.latch.get(4))) * 2 * GS_DOT;
      g.fillStyle = NEEDLE2;
      g.beginPath();
      g.moveTo(R - 18, y);
      g.lineTo(R - 7, y - 5);
      g.lineTo(R - 7, y + 5);
      g.closePath();
      g.fill();
    } else flag(g, R - 34, -26, 'GS');
    if (!this.latch.get(5)) flag(g, -R + 14, -26, 'NAV');
    g.restore();
  }

  protected paintFixtures(g: Ctx2D): void {
    const R = this.R;
    fixedRing(g, R);
    // The aircraft symbol, fixed at the centre.
    g.strokeStyle = INK;
    g.lineWidth = 2.4;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(0, -11);
    g.lineTo(0, 11);
    g.moveTo(-10, -2);
    g.lineTo(10, -2);
    g.moveTo(-4, 9);
    g.lineTo(4, 9);
    g.stroke();
  }

  protected paintOverBezel(g: Ctx2D): void {
    const o = SIXPACK_BEZEL / 2 - 15;
    knob(g, -o, o, 11, COURSE);
    knob(g, o, o, 11, ORANGE);
    centredText(g, 'CRS', -o + 24, o + 5, 6);
    centredText(g, 'HDG', o - 24, o + 5, 6);
  }
}

/**
 * RMI: slaved card with two bearing needles. No. 1 (single bar, yellow) on the GPS's active waypoint (there is no
 * VOR bearing in the simulation); no. 2 (double bar, green, the ADF) parked at three o'clock with no receiver.
 */
export class RmiGauge extends RoundGauge {
  private card: HTMLCanvasElement | null = null;

  constructor(id: string, cx: number, cy: number, aperture: number) {
    super(id, cx, cy, { bezel: SIXPACK_BEZEL, aperture, shape: 'square', values: 3, seed: 133 });
  }

  private get R(): number {
    return this.r - 3;
  }

  sample(r: InstrumentReadings): boolean {
    const live = r.avionicsPowered && r.gps.distanceNm > 0;
    this.latch.track(0, r.headingDeg * DEG, 0.002);
    this.latch.track(1, live ? r.gps.bearingDeg * DEG : r.headingDeg * DEG + Math.PI / 2, 0.004);
    this.latch.set(2, live ? 1 : 0, 1);
    return this.latch.take();
  }

  protected paintFace(): void {
    // The card covers the face.
  }

  protected drawDynamic(g: Ctx2D): void {
    const R = this.R;
    if (!this.card) this.card = compassCard(R);
    const hdg = this.latch.get(0);
    drawCard(g, this.card, this.cx, this.cy, hdg);
    g.save();
    g.translate(this.cx, this.cy);
    const L = R - 12;
    // No. 2 (ADF): double bar, parked at three o'clock.
    g.save();
    g.rotate(Math.PI / 2);
    g.strokeStyle = NEEDLE2;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-3, L - 4);
    g.lineTo(-3, -L + 10);
    g.moveTo(3, L - 4);
    g.lineTo(3, -L + 10);
    g.stroke();
    g.fillStyle = NEEDLE2;
    g.beginPath();
    g.moveTo(0, -L);
    g.lineTo(-6, -L + 11);
    g.lineTo(6, -L + 11);
    g.closePath();
    g.fill();
    g.restore();
    // No. 1 (GPS bearing): single bar.
    g.save();
    g.rotate(this.latch.get(1) - hdg);
    g.fillStyle = COURSE;
    g.fillRect(-1.8, -L + 10, 3.6, 2 * L - 14);
    g.beginPath();
    g.moveTo(0, -L);
    g.lineTo(-6, -L + 12);
    g.lineTo(6, -L + 12);
    g.closePath();
    g.fill();
    g.restore();
    g.fillStyle = '#2a2b2d';
    g.beginPath();
    g.arc(0, 0, 6, 0, Math.PI * 2);
    g.fill();
    if (!this.latch.get(2)) flag(g, -11, 16, 'GPS');
    g.restore();
  }

  protected paintFixtures(g: Ctx2D): void {
    fixedRing(g, this.R);
    centredText(g, '1 GPS', -26, 38, 6.5, COURSE);
    centredText(g, '2 ADF', 26, 38, 6.5, NEEDLE2);
  }

  protected paintOverBezel(g: Ctx2D): void {
    const o = SIXPACK_BEZEL / 2 - 15;
    centredText(g, 'RMI', o - 8, o + 5, 6);
  }
}
