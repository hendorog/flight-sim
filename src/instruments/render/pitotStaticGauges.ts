// Airspeed indicator, altimeter and vertical speed indicator artwork.

import { DEG, clamp, interp1 } from '../../core/math';
import type { InstrumentReadings } from '../dynamics/instrumentSet';
import type { AsiMarkings } from '../panelDef';
import { LARGE_BEZEL } from '../panelParts';
import { ARC_COLORS, arcBand, centredText, dialText, font, INK, knob, NeedleSprite, paintPointer, tick } from './art';
import type { Ctx2D } from './canvas';
import { RoundGauge } from './roundGauge';

/** Bezel of a 3-1/8" instrument, px; the radius of its glass aperture is the panel definition's. */
export const SIXPACK_BEZEL = LARGE_BEZEL;
const SIX = { bezel: SIXPACK_BEZEL, shape: 'square' as const };

// ---------------------------------------------------------------------------------------------------
// Airspeed indicator. The dial map (knots against needle angle), the ticks, the operating arcs and the red
// line are the type's markings.
export class AirspeedGauge extends RoundGauge {
  private readonly needle = new NeedleSprite(70, (g) => paintPointer(g, 66, 5.5, 16));

  constructor(
    id: string,
    cx: number,
    cy: number,
    aperture: number,
    private readonly marks: AsiMarkings,
  ) {
    super(id, cx, cy, { ...SIX, aperture, values: 1, seed: 101 });
  }

  private angle(kt: number): number {
    return interp1(this.marks.scaleKt, this.marks.scaleDeg, kt) * DEG;
  }

  sample(r: InstrumentReadings): boolean {
    this.latch.track(0, this.angle(r.airspeedKt), 0.002);
    return this.latch.take();
  }

  protected paintFace(g: Ctx2D): void {
    const R = this.r - 3;
    const m = this.marks;
    // Operating arcs; the flap operating range lies inside the others.
    for (const a of m.arcs) arcBand(g, this.angle(a.from), this.angle(a.to), a.inner ? R - 7 : R, a.inner ? 5 : 7, ARC_COLORS[a.color]);
    // Every other tick is a long one.
    for (let kt = m.tickFrom; kt <= m.tickTo; kt += m.minorStep) {
      const major = kt % (2 * m.minorStep) === 0;
      tick(g, this.angle(kt), R - (major ? 14 : 8), R, major ? 2.2 : 1.4);
    }
    tick(g, this.angle(m.redLine), R - 16, R + 1, 3.2, ARC_COLORS.red);
    // Twins: the red radial at the minimum control speed and the blue one at the best single-engine rate of climb.
    if (m.redRadial !== undefined) tick(g, this.angle(m.redRadial), R - 20, R + 1, 2.6, ARC_COLORS.red);
    if (m.blueLine !== undefined) tick(g, this.angle(m.blueLine), R - 20, R + 1, 2.6, ARC_COLORS.blue);
    for (let kt = m.tickFrom; kt <= m.tickTo; kt += m.numberStep) dialText(g, String(kt), this.angle(kt), R - 26, 15);
    centredText(g, 'AIRSPEED', 0, -19, 8.5);
    centredText(g, 'KNOTS', 0, 19, 9);
  }

  protected drawDynamic(g: Ctx2D): void {
    this.needle.draw(g, this.cx, this.cy, this.latch.get(0));
  }
}

// ---------------------------------------------------------------------------------------------------
// Sensitive altimeter: 100 ft pointer (one turn per 1000 ft), 1000 ft pointer, 10 000 ft pointer with a
// rim triangle, Kollsman window in inHg and the striped low-altitude flag visible below 10 000 ft.
export class AltimeterGauge extends RoundGauge {
  private readonly p100 = new NeedleSprite(70, (g) => paintPointer(g, 64, 5, 12));
  private readonly p1000 = new NeedleSprite(46, (g) => {
    g.fillStyle = INK;
    g.beginPath();
    g.moveTo(-5, 0);
    g.lineTo(-7, -28);
    g.lineTo(0, -42);
    g.lineTo(7, -28);
    g.lineTo(5, 0);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.4)';
    g.lineWidth = 0.6;
    g.stroke();
  });
  private readonly p10k = new NeedleSprite(72, (g) => {
    g.strokeStyle = INK;
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(0, -60);
    g.stroke();
    g.fillStyle = INK;
    g.beginPath();
    g.moveTo(-5, -60);
    g.lineTo(0, -70);
    g.lineTo(5, -60);
    g.closePath();
    g.fill();
  });

  constructor(id: string, cx: number, cy: number, aperture: number) {
    super(id, cx, cy, { ...SIX, aperture, values: 3, seed: 103 });
  }

  sample(r: InstrumentReadings): boolean {
    this.latch.track(0, r.altitudeFt, 0.5);
    this.latch.set(1, r.kollsmanInHg, 0.01);
    return this.latch.take();
  }

  protected paintFace(g: Ctx2D): void {
    const R = this.r - 3;
    for (let i = 0; i < 50; i++) {
      const major = i % 5 === 0;
      tick(g, (i / 50) * Math.PI * 2, R - (major ? 12 : 6), R, major ? 2.4 : 1.3);
    }
    for (let n = 0; n < 10; n++) dialText(g, String(n), (n / 10) * Math.PI * 2, R - 22, 18);
    centredText(g, 'ALT', 0, -30, 8.5);
    centredText(g, '100 FEET', 0, 27, 7.5);
    // Kollsman window frame (3 o'clock inside the numerals) and the low-altitude flag window.
    windowFrame(g, KOLL.x, KOLL.y, KOLL.w, KOLL.h);
    centredText(g, 'IN.HG', KOLL.x + KOLL.w / 2, 14, 5.5, INK, 500);
    windowFrame(g, -34, -24, 22, 10);
  }

  protected drawDynamic(g: Ctx2D): void {
    const alt = this.latch.get(0);
    const cx = this.cx;
    const cy = this.cy;
    // Kollsman drum digits.
    const kx = cx + KOLL.x;
    const ky = cy + KOLL.y;
    g.save();
    g.beginPath();
    g.rect(kx, ky, KOLL.w, KOLL.h);
    g.clip();
    g.fillStyle = '#e9e6da';
    g.fillRect(kx, ky, KOLL.w, KOLL.h);
    g.fillStyle = '#121212';
    g.font = font(11, 700);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(this.latch.get(1).toFixed(2), kx + KOLL.w / 2, ky + KOLL.h / 2 + 0.5);
    const shade = g.createLinearGradient(0, ky, 0, ky + KOLL.h);
    shade.addColorStop(0, 'rgba(0,0,0,0.55)');
    shade.addColorStop(0.3, 'rgba(0,0,0,0)');
    shade.addColorStop(0.7, 'rgba(0,0,0,0)');
    shade.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = shade;
    g.fillRect(kx, ky, KOLL.w, KOLL.h);
    g.restore();
    // Low-altitude flag: black/white hatching that slides out of view between 10 000 and 11 000 ft.
    const hidden = clamp((alt - 10000) / 1000, 0, 1);
    g.save();
    g.beginPath();
    g.rect(cx - 34, cy - 24, 22, 10);
    g.clip();
    g.fillStyle = '#0c0c0c';
    g.fillRect(cx - 34, cy - 24, 22, 10);
    g.translate(-hidden * 22, 0);
    g.fillStyle = '#e9e6da';
    for (let x = -12; x < 24; x += 6) {
      g.beginPath();
      g.moveTo(cx - 34 + x, cy - 14);
      g.lineTo(cx - 34 + x + 3, cy - 14);
      g.lineTo(cx - 34 + x + 13, cy - 24);
      g.lineTo(cx - 34 + x + 10, cy - 24);
      g.closePath();
      g.fill();
    }
    g.restore();
    const turn = Math.PI * 2;
    this.p10k.draw(g, cx, cy, (alt / 100000) * turn);
    this.p1000.draw(g, cx, cy, (alt / 10000) * turn);
    this.p100.draw(g, cx, cy, (alt / 1000) * turn);
  }

  protected paintOverBezel(g: Ctx2D): void {
    knob(g, -SIXPACK_BEZEL / 2 + 16, SIXPACK_BEZEL / 2 - 14, 11);
  }
}

/** Kollsman window, dial coordinates: inside the numeral ring at 3 o'clock. */
const KOLL = { x: 11, y: -7, w: 29, h: 14 };

/** Recessed rectangular window in a dial. */
function windowFrame(g: Ctx2D, x: number, y: number, w: number, h: number): void {
  g.fillStyle = '#050505';
  g.fillRect(x - 1.5, y - 1.5, w + 3, h + 3);
  g.strokeStyle = 'rgba(255,255,255,0.18)';
  g.lineWidth = 0.8;
  g.strokeRect(x - 1.5, y - 1.5, w + 3, h + 3);
}

// ---------------------------------------------------------------------------------------------------
// Vertical speed indicator: zero at 9 o'clock, climb clockwise, both scales meeting at 2000 ft/min at
// 3 o'clock. Compressed above 1000 ft/min like the real dial.
const VSI_FPM = [0, 500, 1000, 1500, 2000];
const VSI_DEG = [0, 58, 108, 146, 180];
const vsiAngle = (fpm: number): number =>
  (-90 + Math.sign(fpm) * interp1(VSI_FPM, VSI_DEG, Math.min(Math.abs(fpm), 2000))) * DEG;

export class VerticalSpeedGauge extends RoundGauge {
  private readonly needle = new NeedleSprite(70, (g) => paintPointer(g, 64, 5, 14));

  constructor(id: string, cx: number, cy: number, aperture: number) {
    super(id, cx, cy, { ...SIX, aperture, values: 1, seed: 106 });
  }

  sample(r: InstrumentReadings): boolean {
    // Needle stops just past the 2000 ft/min marks.
    this.latch.track(0, vsiAngle(clamp(r.verticalSpeedFpm, -2080, 2080)), 0.002);
    return this.latch.take();
  }

  protected paintFace(g: Ctx2D): void {
    const R = this.r - 3;
    for (const sgn of [1, -1]) {
      for (let v = 100; v <= 2000; v += 100) {
        if (v > 1000 && v % 250 !== 0 && v % 500 !== 0) continue;
        const major = v % 500 === 0;
        tick(g, vsiAngle(sgn * v), R - (major ? 13 : 7), R, major ? 2.4 : 1.3);
      }
      for (const v of [5, 10, 15]) dialText(g, String(v), vsiAngle(sgn * v * 100), R - 24, 18);
    }
    tick(g, vsiAngle(0), R - 15, R, 3);
    dialText(g, '0', vsiAngle(0), R - 25, 18);
    dialText(g, '20', vsiAngle(2000), R - 24, 18);
    centredText(g, 'UP', -24, -14, 9);
    centredText(g, 'DOWN', -24, 15, 9);
    arrow(g, -36, -14, -1);
    arrow(g, -40, 15, 1);
    centredText(g, 'VERTICAL SPEED', 8, -27, 5.5);
    centredText(g, '100 FEET', 14, 17, 5.5, INK, 500);
    centredText(g, 'PER MINUTE', 14, 24, 5.5, INK, 500);
  }

  protected drawDynamic(g: Ctx2D): void {
    this.needle.draw(g, this.cx, this.cy, this.latch.get(0));
  }
}

function arrow(g: Ctx2D, x: number, y: number, dir: 1 | -1): void {
  g.fillStyle = INK;
  g.beginPath();
  g.moveTo(x, y - dir * 5);
  g.lineTo(x - 3.5, y + dir * 1);
  g.lineTo(x + 3.5, y + dir * 1);
  g.closePath();
  g.fill();
}
