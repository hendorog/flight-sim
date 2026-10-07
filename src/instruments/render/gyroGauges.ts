// Attitude indicator, turn coordinator and heading indicator artwork.

import { DEG, clamp } from '../../core/math';
import type { InstrumentReadings } from '../dynamics/instrumentSet';
import { centredText, font, hub, INK, knob, NeedleSprite, polarX, polarY, tick } from './art';
import { context2d, makeCanvas, type Ctx2D } from './canvas';
import { SIXPACK_BEZEL } from './pitotStaticGauges';
import { RoundGauge } from './roundGauge';

const SIX = { bezel: SIXPACK_BEZEL, shape: 'square' as const };
const ORANGE = '#f08a1c';
const SKY_TOP = '#1d5f9e';
const SKY_HORIZON = '#4f9bd6';
const GROUND_HORIZON = '#7a5230';
const GROUND_BOTTOM = '#3e2814';

// ---------------------------------------------------------------------------------------------------
/**
 * Attitude indicator. The horizon card (sky/ground with pitch ladder) and the bank-scale ring are each
 * pre-rendered once; per frame they are rotated by -roll and the card shifted by pitch. The miniature
 * aeroplane, the fixed bank index and the lower mask are fixtures on the glass side.
 */
export class AttitudeGauge extends RoundGauge {
  /** Card scale, px per degree of pitch. */
  static readonly PX_PER_DEG = 2.3;
  private static readonly CARD_R = 58;
  private card: HTMLCanvasElement | null = null;
  private ring: HTMLCanvasElement | null = null;

  constructor(id: string, cx: number, cy: number, aperture: number) {
    super(id, cx, cy, { ...SIX, aperture, values: 2, seed: 102 });
  }

  sample(r: InstrumentReadings): boolean {
    this.latch.track(0, r.attitudeRoll, 0.002);
    this.latch.track(1, r.attitudePitch, 0.0015);
    return this.latch.take();
  }

  protected paintFace(): void {
    // The whole face is the moving card; nothing static behind it.
  }

  protected drawDynamic(g: Ctx2D): void {
    if (!this.card || !this.ring) this.buildSprites();
    const roll = this.latch.get(0);
    const pitch = this.latch.get(1);
    const c = Math.cos(-roll);
    const s = Math.sin(-roll);
    g.save();
    g.beginPath();
    g.arc(this.cx, this.cy, this.r, 0, Math.PI * 2);
    g.clip();
    g.setTransform(c, s, -s, c, this.cx, this.cy);
    g.drawImage(this.ring!, -this.ring!.width / 2, -this.ring!.height / 2);
    g.beginPath();
    g.arc(0, 0, AttitudeGauge.CARD_R, 0, Math.PI * 2);
    g.clip();
    const shift = (pitch / DEG) * AttitudeGauge.PX_PER_DEG;
    g.drawImage(this.card!, -this.card!.width / 2, -this.card!.height / 2 + shift);
    g.restore();
  }

  private buildSprites(): void {
    const R = AttitudeGauge.CARD_R;
    const ppd = AttitudeGauge.PX_PER_DEG;
    const half = Math.ceil(85 * ppd + R);
    const card = makeCanvas(2 * R + 4, 2 * half);
    const g = context2d(card);
    const w = card.width;
    const h0 = half; // horizon row
    const sky = g.createLinearGradient(0, 0, 0, h0);
    sky.addColorStop(0, SKY_TOP);
    sky.addColorStop(0.8, SKY_TOP);
    sky.addColorStop(1, SKY_HORIZON);
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h0);
    const ground = g.createLinearGradient(0, h0, 0, card.height);
    ground.addColorStop(0, GROUND_HORIZON);
    ground.addColorStop(0.2, GROUND_BOTTOM);
    ground.addColorStop(1, GROUND_BOTTOM);
    g.fillStyle = ground;
    g.fillRect(0, h0, w, card.height - h0);
    g.translate(w / 2, h0);
    // Perspective lines on the ground half.
    g.strokeStyle = 'rgba(241,240,232,0.8)';
    g.lineWidth = 1.2;
    for (const a of [-60, -35, 35, 60]) {
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(Math.tan(a * DEG) * 60, 60);
      g.stroke();
    }
    // Pitch ladder every 5 degrees to +/-30, numbered at 10 and 20.
    g.strokeStyle = INK;
    for (let p = -30; p <= 30; p += 5) {
      if (p === 0) continue;
      const y = -p * ppd;
      const long = p % 10 === 0;
      const hw = long ? 20 : 9;
      g.lineWidth = long ? 1.8 : 1.3;
      g.beginPath();
      g.moveTo(-hw, y);
      g.lineTo(hw, y);
      g.stroke();
      if (long && Math.abs(p) <= 20) {
        g.font = font(8, 600);
        g.fillStyle = INK;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(Math.abs(p)), -hw - 8, y);
        g.fillText(String(Math.abs(p)), hw + 8, y);
      }
    }
    // Horizon line
    g.fillStyle = '#f7f6f0';
    g.fillRect(-w / 2, -1.2, w, 2.4);

    // Bank ring: sky/ground halves with bank marks on the sky half.
    const size = 2 * this.r + 4;
    const ring = makeCanvas(size, size);
    const rg = context2d(ring);
    rg.translate(size / 2, size / 2);
    rg.fillStyle = SKY_TOP;
    rg.beginPath();
    rg.arc(0, 0, this.r + 1, Math.PI, 0);
    rg.fill();
    rg.fillStyle = GROUND_BOTTOM;
    rg.beginPath();
    rg.arc(0, 0, this.r + 1, 0, Math.PI);
    rg.fill();
    const Ro = this.r - 1;
    for (const b of [10, 20, 30, 45, 60, 90]) {
      for (const sgn of [-1, 1]) {
        const a = sgn * b * DEG;
        const big = b === 30 || b === 60 || b === 90;
        if (b === 45) {
          tri(rg, a, Ro - 9, 4.5, 8, INK);
        } else tick(rg, a, Ro - (big ? 13 : 8), Ro, big ? 2.6 : 1.8);
      }
    }
    tri(rg, 0, Ro - 11, 6.5, 11, INK);
    this.card = card;
    this.ring = ring;
  }

  protected paintFixtures(g: Ctx2D): void {
    // Lower mask with the pitch-trim knob stem, flat black.
    g.fillStyle = '#121213';
    g.beginPath();
    g.moveTo(-20, this.r + 2);
    g.lineTo(-7, 26);
    g.quadraticCurveTo(0, 22, 7, 26);
    g.lineTo(20, this.r + 2);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.1)';
    g.lineWidth = 0.8;
    g.stroke();
    // Fixed bank index at 12 o'clock, pointing at the ring.
    g.fillStyle = ORANGE;
    g.beginPath();
    g.moveTo(0, -this.r + 13);
    g.lineTo(-6, -this.r + 2);
    g.lineTo(6, -this.r + 2);
    g.closePath();
    g.fill();
    // Miniature aeroplane: two wing bars and a centre dot, orange, casting a shadow on the card.
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.6)';
    g.shadowBlur = 3;
    g.shadowOffsetY = 2.5;
    g.fillStyle = ORANGE;
    for (const sgn of [-1, 1]) {
      g.beginPath();
      g.moveTo(sgn * 44, -2);
      g.lineTo(sgn * 16, -2);
      g.lineTo(sgn * 9, 5);
      g.lineTo(sgn * 12, 6.5);
      g.lineTo(sgn * 18, 2);
      g.lineTo(sgn * 44, 2);
      g.closePath();
      g.fill();
    }
    g.beginPath();
    g.arc(0, 0, 3.2, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  protected paintOverBezel(g: Ctx2D): void {
    knob(g, 0, SIXPACK_BEZEL / 2 - 10, 9.5);
  }
}

/** Triangle on a dial pointing outward from radius r (apex at r + len). */
function tri(g: Ctx2D, a: number, r: number, halfW: number, len: number, color: string): void {
  g.save();
  g.rotate(a);
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(0, -r - len);
  g.lineTo(-halfW, -r);
  g.lineTo(halfW, -r);
  g.closePath();
  g.fill();
  g.restore();
}

/** Triangle on a fixed ring pointing inward, apex at radius r. */
function inwardTri(g: Ctx2D, a: number, r: number, halfW: number, len: number, color: string): void {
  g.save();
  g.rotate(a);
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(0, -r);
  g.lineTo(-halfW, -r - len);
  g.lineTo(halfW, -r - len);
  g.closePath();
  g.fill();
  g.restore();
}

// ---------------------------------------------------------------------------------------------------
/** Turn coordinator: aeroplane symbol banked by turn rate, inclinometer ball in its tube, OFF flag. */
export class TurnCoordinatorGauge extends RoundGauge {
  /** Symbol bank at the standard-rate index. */
  static readonly INDEX_ANGLE = 20 * DEG;
  private static readonly TUBE_Y = 36;
  private static readonly TUBE_R = 90;
  private static readonly TUBE_SPAN = 0.3; // rad each side
  private readonly symbol = new NeedleSprite(56, (g) => {
    g.fillStyle = INK;
    g.beginPath();
    g.moveTo(-54, -1.5);
    g.lineTo(-8, -3.5);
    g.lineTo(8, -3.5);
    g.lineTo(54, -1.5);
    g.lineTo(54, 2);
    g.lineTo(-54, 2);
    g.closePath();
    g.fill();
    g.fillRect(-1.6, -15, 3.2, 12);
    g.fillRect(-10, -4, 20, 3);
    g.beginPath();
    g.arc(0, 0, 7, 0, Math.PI * 2);
    g.fill();
    hub(g, 3);
  });

  constructor(id: string, cx: number, cy: number, aperture: number) {
    super(id, cx, cy, { ...SIX, aperture, values: 3, seed: 104 });
  }

  sample(r: InstrumentReadings): boolean {
    this.latch.track(0, clamp(r.turnRate, -2, 2) * TurnCoordinatorGauge.INDEX_ANGLE, 0.002);
    this.latch.track(1, r.ball, 0.004);
    this.latch.set(2, r.turnFlag ? 1 : 0, 1);
    return this.latch.take();
  }

  /** Point on the tube centreline for a ball deflection -1..1. */
  private tubePoint(b: number): [number, number] {
    const T = TurnCoordinatorGauge;
    const a = b * T.TUBE_SPAN;
    return [Math.sin(a) * T.TUBE_R, T.TUBE_Y + T.TUBE_R * (1 - Math.cos(a))];
  }

  protected paintFace(g: Ctx2D): void {
    const R = this.r - 3;
    const I = TurnCoordinatorGauge.INDEX_ANGLE;
    for (const a of [90 * DEG, -90 * DEG]) tick(g, a, R - 12, R, 3.2);
    for (const a of [90 * DEG + I, -90 * DEG - I]) tick(g, a, R - 12, R, 3.2);
    dialText2(g, 'L', -90 * DEG - I, R - 21, 12);
    dialText2(g, 'R', 90 * DEG + I, R - 21, 12);
    centredText(g, 'TURN COORDINATOR', 0, -40, 7.5);
    centredText(g, '2 MIN', 0, 62, 8.5);
    centredText(g, 'NO PITCH', 0, -26, 5.8, INK, 500);
    centredText(g, 'INFORMATION', 0, -19.5, 5.8, INK, 500);
    centredText(g, 'D.C. ELEC.', 0, 18, 6, INK, 500);
    // Inclinometer tube: dark liquid-filled glass with two reference wires.
    const T = TurnCoordinatorGauge;
    g.lineCap = 'round';
    g.strokeStyle = '#d9d5c4';
    g.lineWidth = 16;
    tubeArc(g, T.TUBE_Y, T.TUBE_R, T.TUBE_SPAN);
    g.strokeStyle = '#1c1c1b';
    g.lineWidth = 13;
    tubeArc(g, T.TUBE_Y, T.TUBE_R, T.TUBE_SPAN);
    const liquid = g.createLinearGradient(0, T.TUBE_Y - 7, 0, T.TUBE_Y + 7);
    liquid.addColorStop(0, '#6d6a5e');
    liquid.addColorStop(0.5, '#b9b5a1');
    liquid.addColorStop(1, '#8a8676');
    g.strokeStyle = liquid;
    g.lineWidth = 11;
    tubeArc(g, T.TUBE_Y, T.TUBE_R, T.TUBE_SPAN);
    g.strokeStyle = '#161616';
    g.lineWidth = 1.6;
    for (const b of [-0.28, 0.28]) {
      const [x, y] = this.tubePoint(b);
      g.beginPath();
      g.moveTo(x, y - 7);
      g.lineTo(x, y + 7);
      g.stroke();
    }
  }

  protected drawDynamic(g: Ctx2D): void {
    const [bx, by] = this.tubePoint(this.latch.get(1));
    const x = this.cx + bx;
    const y = this.cy + by;
    const ball = g.createRadialGradient(x - 1.5, y - 2, 0.5, x, y, 5.5);
    ball.addColorStop(0, '#6a6a6a');
    ball.addColorStop(0.5, '#141414');
    ball.addColorStop(1, '#000');
    g.fillStyle = ball;
    g.beginPath();
    g.arc(x, y, 5.3, 0, Math.PI * 2);
    g.fill();
    if (this.latch.get(2)) {
      // Red and white OFF flag in the lower left.
      const fx = this.cx - 50;
      const fy = this.cy + 4;
      g.fillStyle = '#c8221a';
      g.fillRect(fx, fy, 22, 11);
      g.fillStyle = '#f2efe6';
      g.font = font(7.5, 700);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('OFF', fx + 11, fy + 6);
    }
    this.symbol.draw(g, this.cx, this.cy, this.latch.get(0));
  }

  protected paintFixtures(g: Ctx2D): void {
    // Glass highlight on the tube, above the ball.
    const T = TurnCoordinatorGauge;
    g.strokeStyle = 'rgba(255,255,255,0.28)';
    g.lineWidth = 1.5;
    g.lineCap = 'round';
    tubeArc(g, T.TUBE_Y - 3.5, T.TUBE_R, T.TUBE_SPAN * 0.93);
  }
}

function tubeArc(g: Ctx2D, y: number, R: number, span: number): void {
  g.beginPath();
  g.arc(0, y + R, R, -Math.PI / 2 - span, -Math.PI / 2 + span);
  g.stroke();
}

function dialText2(g: Ctx2D, text: string, a: number, r: number, size: number): void {
  centredText(g, text, polarX(a, r), polarY(a, r), size);
}

// ---------------------------------------------------------------------------------------------------
/** Heading indicator: a rotating compass card behind a fixed lubber line and aeroplane symbol. */
export class HeadingGauge extends RoundGauge {
  private static readonly CARD_R = 64;
  private card: HTMLCanvasElement | null = null;
  private readonly bug = new NeedleSprite(70, (g) => {
    g.fillStyle = ORANGE;
    g.beginPath();
    g.moveTo(-7, -HeadingGauge.CARD_R - 1);
    g.lineTo(-7, -HeadingGauge.CARD_R + 7);
    g.lineTo(-2.5, -HeadingGauge.CARD_R + 7);
    g.lineTo(0, -HeadingGauge.CARD_R + 3);
    g.lineTo(2.5, -HeadingGauge.CARD_R + 7);
    g.lineTo(7, -HeadingGauge.CARD_R + 7);
    g.lineTo(7, -HeadingGauge.CARD_R - 1);
    g.closePath();
    g.fill();
  });

  constructor(id: string, cx: number, cy: number, aperture: number) {
    super(id, cx, cy, { ...SIX, aperture, values: 2, seed: 105 });
  }

  sample(r: InstrumentReadings): boolean {
    this.latch.track(0, r.headingDeg * DEG, 0.002);
    this.latch.track(1, r.headingBugDeg * DEG, 0.002);
    return this.latch.take();
  }

  protected paintFace(): void {
    // The card covers the face.
  }

  private buildCard(): void {
    const R = HeadingGauge.CARD_R;
    const size = 2 * R + 4;
    const c = makeCanvas(size, size);
    const g = context2d(c);
    g.translate(size / 2, size / 2);
    g.fillStyle = '#121314';
    g.beginPath();
    g.arc(0, 0, R, 0, Math.PI * 2);
    g.fill();
    for (let d = 0; d < 360; d += 5) {
      const major = d % 10 === 0;
      tick(g, d * DEG, R - (major ? 10 : 6), R - 1, major ? 1.8 : 1.1);
    }
    const labels: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
    for (let d = 0; d < 360; d += 30) {
      g.save();
      g.rotate(d * DEG);
      g.font = font(labels[d] ? 15 : 13, 600);
      g.fillStyle = INK;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(labels[d] ?? String(d / 10), 0, -R + 20);
      g.restore();
    }
    this.card = c;
  }

  protected drawDynamic(g: Ctx2D): void {
    if (!this.card) this.buildCard();
    const hdg = this.latch.get(0);
    const c = Math.cos(-hdg);
    const s = Math.sin(-hdg);
    g.setTransform(c, s, -s, c, this.cx, this.cy);
    g.drawImage(this.card!, -this.card!.width / 2, -this.card!.height / 2);
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.bug.draw(g, this.cx, this.cy, this.latch.get(1) - hdg, false);
  }

  protected paintFixtures(g: Ctx2D): void {
    const R = HeadingGauge.CARD_R;
    // 45-degree index marks on the fixed ring outside the card, lubber line at the top.
    for (const d of [45, 90, 135, 180, 225, 270, 315]) inwardTri(g, d * DEG, R + 1, 3.5, 6, INK);
    inwardTri(g, 0, R + 0.5, 5, 9, ORANGE);
    // Aeroplane symbol
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.6)';
    g.shadowBlur = 3;
    g.shadowOffsetY = 2;
    g.fillStyle = ORANGE;
    g.beginPath();
    g.moveTo(0, -26);
    g.quadraticCurveTo(3, -22, 3, -12);
    g.lineTo(3, -6);
    g.lineTo(22, 0);
    g.lineTo(22, 4);
    g.lineTo(3, 2);
    g.lineTo(2.5, 14);
    g.lineTo(9, 18);
    g.lineTo(9, 21);
    g.lineTo(-9, 21);
    g.lineTo(-9, 18);
    g.lineTo(-2.5, 14);
    g.lineTo(-3, 2);
    g.lineTo(-22, 4);
    g.lineTo(-22, 0);
    g.lineTo(-3, -6);
    g.lineTo(-3, -12);
    g.quadraticCurveTo(-3, -22, 0, -26);
    g.closePath();
    g.fill();
    g.restore();
  }

  protected paintOverBezel(g: Ctx2D): void {
    const o = SIXPACK_BEZEL / 2 - 15;
    knob(g, -o, o, 11);
    knob(g, o, o, 11, ORANGE);
    centredText(g, 'PUSH', -o + 22, o + 5, 6);
  }
}
