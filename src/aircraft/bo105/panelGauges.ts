// MBB Bo 105 CB-4: the pedestal's bespoke dials (FM Fig 7-3). Three families the shared gauge set does not have:
//  - the mast-moment indicator (green / yellow / red bands, CAL, TEST and LIMIT),
//  - the triple dials (triple tachometer N2 1 / N2 2 / NR, triple oil temperature, triple oil pressure): two engine pointers on
//    the outer scale and a short R pointer on an inner scale, and
//  - a vertical speed indicator of +/-6000 ft/min (the shared one stops at 2000).
// Dial spacing is ESTIMATE artwork; every band comes from panelMarkings.ts (tagged there). Readings come through
// InstrumentSystemsDef.extra (mast moment) and InstrumentReadings.engines (per-engine figures).
import { clamp, DEG } from '../../core/math';
import type { InstrumentReadings } from '../../instruments/dynamics/instrumentSet';
import type { ArcDef } from '../../instruments/panelDef';
import { LARGE_BEZEL } from '../../instruments/panelParts';
import { ARC_COLORS, ARC_RED, arcBand, centredText, dialText, font, INK, NeedleSprite, paintPointer, tick } from '../../instruments/render/art';
import type { Ctx2D } from '../../instruments/render/canvas';
import { RoundGauge } from '../../instruments/render/roundGauge';
import { BO105_MAST_MOMENT as MM } from './panelMarkings';

const RED_LAMP = '#ff4538';

// ---------------------------------------------------------------------------------------------------
// Mast-moment indicator

/** Needle angle of a mast-moment percent: 0 at -135 deg, 120 % at +135 deg. */
export const mastMomentAngle = (pct: number): number => (-135 + 270 * clamp(pct / MM.max, 0, 1.04)) * DEG;

/**
 * Reads `extra.mastMomentPct` (percent of the LIMIT moment) and `extra.mastMomentYellowPct` (where the yellow band begins),
 * both from InstrumentSystemsDef.extra. The TEST button (lamp id 'mmTest') drives the needle to the LIMIT mark and lights
 * the LIMIT lamp; CAL is the calibration potentiometer's slot, painted only (P5 FM 7-13 describes the indicator, with no
 * scale numbers). Electric: the needle falls to zero and the lamp is dark without bus power.
 */
export class Bo105MastMomentGauge extends RoundGauge {
  constructor(id: string, x: number, y: number, aperture: number) {
    super(id, x, y, { bezel: LARGE_BEZEL, aperture, shape: 'square', values: 3, seed: 1051 });
  }
  /** What the pointer and lamp show for the readings. */
  static shown(r: InstrumentReadings): { pct: number; limit: boolean } {
    const test = r.lamps.mmTest === true;
    const pct = !r.busPowered ? 0 : test ? 100 : r.extra?.mastMomentPct ?? 0;
    return { pct, limit: r.busPowered && (test || pct >= 100) };
  }
  sample(r: InstrumentReadings): boolean {
    const s = Bo105MastMomentGauge.shown(r);
    this.latch.track(0, mastMomentAngle(s.pct), 0.002);
    this.latch.set(1, s.limit ? 1 : 0, 1);
    this.latch.set(2, Math.round((r.extra?.mastMomentYellowPct ?? MM.yellowFallback * 100) / 2.5), 1);
    return this.latch.take();
  }
  protected paintFace(g: Ctx2D): void {
    const R = this.r - 3, yellow = MM.yellowFallback * 100;
    arcBand(g, mastMomentAngle(0), mastMomentAngle(yellow), R, 7, ARC_COLORS.green);
    arcBand(g, mastMomentAngle(yellow), mastMomentAngle(100), R, 7, ARC_COLORS.yellow);
    arcBand(g, mastMomentAngle(100), mastMomentAngle(MM.max), R, 7, ARC_COLORS.red);
    for (let v = 0; v <= MM.max; v += 10) tick(g, mastMomentAngle(v), R - (v % 50 === 0 ? 14 : 8), R, v % 50 === 0 ? 2.4 : 1.3);
    tick(g, mastMomentAngle(100), R - 16, R + 1, 3.4, ARC_RED);
    centredText(g, 'MAST', 0, -30, 9.5);
    centredText(g, 'MOMENT', 0, -19, 9.5);
    // CAL: the calibration potentiometer's slot; TEST: the legend of the test button below the pivot.
    g.strokeStyle = INK; g.lineWidth = 1; g.beginPath(); g.arc(-22, 38, 5, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(-25, 38); g.lineTo(-19, 38); g.stroke();
    centredText(g, 'CAL', -22, 49, 7, INK, 500);
    centredText(g, 'TEST', 22, 49, 7, INK, 500);
    // The LIMIT lamp window.
    g.fillStyle = '#2a0b09'; g.fillRect(-19, 24, 38, 14);
    g.strokeStyle = INK; g.lineWidth = 0.8; g.strokeRect(-19, 24, 38, 14);
  }
  protected drawDynamic(g: Ctx2D): void {
    // The yellow onset follows the hub definition: repaint the band edge as a tick when it differs from the painted fallback.
    const yellow = this.latch.get(2) * 2.5;
    if (Math.abs(yellow - MM.yellowFallback * 100) > 1.5) {
      g.save(); g.translate(this.cx, this.cy);
      tick(g, mastMomentAngle(yellow), this.r - 17, this.r - 2, 2.6, ARC_COLORS.yellow);
      g.restore();
    }
    // LIMIT lamp.
    const on = this.latch.get(1) === 1;
    g.save(); g.translate(this.cx, this.cy);
    g.fillStyle = on ? RED_LAMP : '#3a100d'; g.fillRect(-17, 26, 34, 10);
    g.font = '700 8px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = on ? '#2a0605' : 'rgba(225,220,205,0.5)'; g.fillText('LIMIT', 0, 31.5);
    g.restore();
    needle(g, this.cx, this.cy, this.latch.get(0));
  }
  paintLightMask(g: Ctx2D): void {
    super.paintLightMask(g);
    if (this.latch.get(1) === 1) { g.fillStyle = '#ffffff'; g.fillRect(this.cx - 17, this.cy + 26, 34, 10); }
  }
}

/** A long pointer with its engine's number in a disc on the shaft (as the twin gauges' L / R needles). */
function letteredPointer(letter: string): NeedleSprite {
  const length = 64;
  return new NeedleSprite(length + 4, (g) => {
    paintPointer(g, length, 5.5, 14);
    const at = -length * 0.56;
    g.fillStyle = '#101112'; g.beginPath(); g.arc(0, at, 7.5, 0, Math.PI * 2); g.fill();
    g.strokeStyle = INK; g.lineWidth = 1.2; g.stroke();
    g.font = font(10, 700); g.fillStyle = INK; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(letter, 0, at + 0.5);
  });
}

const POINTER = new Map<string, NeedleSprite>();
function needle(g: Ctx2D, cx: number, cy: number, angle: number): void {
  let n = POINTER.get('plain');
  if (!n) { n = new NeedleSprite(70, (c) => paintPointer(c, 64, 5.5, 14)); POINTER.set('plain', n); }
  n.draw(g, cx, cy, angle);
}

// ---------------------------------------------------------------------------------------------------
// Triple dials

/** One scale of a triple dial: its range and the angles of its ends, rad clockwise from 12 o'clock. */
export interface TripleScale {
  min: number; max: number; a0: number; a1: number;
  /** Long ticks (numbered when `labels`), the step of the short ones. */
  majors: readonly number[]; minorStep: number; labels?: readonly number[] | 'majors';
  /** Colour bands, red radials, red dots. */
  arcs?: readonly ArcDef[]; redLines?: readonly number[]; redDots?: readonly number[];
  /** Radius of the scale's outer edge as a fraction of the glass radius, band width px. */
  radius: number; width?: number;
  /** Text divisor of the printed numbers (scale x100). */
  divisor?: number;
}
export type TripleReader = (r: InstrumentReadings) => number;
export interface TripleDialSpec {
  outer: TripleScale; inner: TripleScale;
  /** Legend lines inside the dial. */
  legend: readonly string[];
  /** The three pointer readers: the two engine pointers (1, 2) on the outer scale, R on the inner one (scalar readers: no per-frame tuple). */
  reads: readonly [TripleReader, TripleReader, TripleReader];
  /** Whether the dial needs bus power (an electric indicator); the tach generators are self-powered. */
  electric: boolean;
  seed: number;
}

const angleOn = (s: TripleScale, v: number): number => s.a0 + clamp((v - s.min) / (s.max - s.min), -0.03, 1.05) * (s.a1 - s.a0);

/** Two numbered engine pointers (1, 2) on the outer scale and the short R pointer on the inner one. */
export class Bo105TripleGauge extends RoundGauge {
  private static pointers: { engine: readonly [NeedleSprite, NeedleSprite]; rotor: NeedleSprite } | null = null;
  constructor(id: string, x: number, y: number, aperture: number, private readonly spec: TripleDialSpec) {
    super(id, x, y, { bezel: LARGE_BEZEL, aperture, shape: 'square', values: 3, seed: spec.seed });
  }
  private static sprites() {
    return Bo105TripleGauge.pointers ??= {
      engine: [letteredPointer('1'), letteredPointer('2')] as const,
      rotor: new NeedleSprite(46, (g) => { paintPointer(g, 42, 4.5, 9);
        g.fillStyle = '#101112'; g.beginPath(); g.arc(0, -24, 6, 0, Math.PI * 2); g.fill();
        g.strokeStyle = INK; g.lineWidth = 1; g.stroke(); centredText(g, 'R', 0, -23.5, 8, INK, 700); }),
    };
  }
  sample(r: InstrumentReadings): boolean {
    const live = !this.spec.electric || r.busPowered, [a, b, c] = this.spec.reads, { outer, inner } = this.spec;
    this.latch.track(0, angleOn(outer, live ? a(r) : outer.min), 0.002);
    this.latch.track(1, angleOn(outer, live ? b(r) : outer.min), 0.002);
    this.latch.track(2, angleOn(inner, live ? c(r) : inner.min), 0.002);
    return this.latch.take();
  }
  private paintScale(g: Ctx2D, s: TripleScale, textSize: number): void {
    const R = (this.r - 3) * s.radius, w = s.width ?? 6;
    const angle = (v: number): number => angleOn(s, v);
    for (const b of s.arcs ?? []) arcBand(g, angle(b.from), angle(b.to), R, w, ARC_COLORS[b.color]);
    for (let v = s.min; v <= s.max + 1e-6; v += s.minorStep) tick(g, angle(v), R - 4, R, 0.9);
    for (const v of s.majors) tick(g, angle(v), R - 8, R, 1.6);
    const labels = s.labels === 'majors' ? s.majors : s.labels ?? [];
    for (const v of labels) dialText(g, String(v / (s.divisor ?? 1)), angle(v), R - 16, textSize);
    for (const v of s.redLines ?? []) tick(g, angle(v), R - 10, R + 1, 2.2, ARC_RED);
    g.fillStyle = ARC_RED;
    for (const v of s.redDots ?? []) { g.beginPath(); g.arc(Math.sin(angle(v)) * (R - 3), -Math.cos(angle(v)) * (R - 3), 2.6, 0, Math.PI * 2); g.fill(); }
  }
  protected paintFace(g: Ctx2D): void {
    this.paintScale(g, this.spec.outer, 9.5);
    this.paintScale(g, this.spec.inner, 7.5);
    this.spec.legend.forEach((line, i) => centredText(g, line, 0, 24 + i * 9, 7.5, INK, 600));
  }
  protected drawDynamic(g: Ctx2D): void {
    const p = Bo105TripleGauge.sprites();
    p.rotor.draw(g, this.cx, this.cy, this.latch.get(2));
    p.engine[1].draw(g, this.cx, this.cy, this.latch.get(1));
    p.engine[0].draw(g, this.cx, this.cy, this.latch.get(0));
  }
}

// ---------------------------------------------------------------------------------------------------
// Vertical speed indicator, +/-6000 ft/min

const VSI_MAX = 6000;
/** Needle angle: zero at 9 o'clock, +/-6000 ft/min 170 deg above and below it, linear (the FM figure shows a linear scale; ESTIMATE). */
export const bo105VsiAngle = (fpm: number): number => (-90 + 170 * clamp(fpm / VSI_MAX, -1.04, 1.04)) * DEG;

export class Bo105VerticalSpeedGauge extends RoundGauge {
  private readonly pointer = new NeedleSprite(70, (g) => paintPointer(g, 64, 5, 14));
  constructor(id: string, x: number, y: number, aperture: number) {
    super(id, x, y, { bezel: LARGE_BEZEL, aperture, shape: 'square', values: 1, seed: 1052 });
  }
  sample(r: InstrumentReadings): boolean {
    this.latch.track(0, bo105VsiAngle(r.verticalSpeedFpm), 0.002);
    return this.latch.take();
  }
  protected paintFace(g: Ctx2D): void {
    const R = this.r - 3;
    for (const sgn of [1, -1]) {
      for (let v = 500; v <= VSI_MAX; v += 500) tick(g, bo105VsiAngle(sgn * v), R - (v % 1000 === 0 ? 13 : 7), R, v % 1000 === 0 ? 2.4 : 1.3);
      for (const v of [1, 2, 3, 4, 5, 6]) dialText(g, String(v), bo105VsiAngle(sgn * v * 1000), R - 23, 15);
    }
    tick(g, bo105VsiAngle(0), R - 15, R, 3);
    dialText(g, '0', bo105VsiAngle(0), R - 24, 15);
    centredText(g, 'UP', -6, -28, 9); centredText(g, 'DOWN', -6, 30, 9);
    centredText(g, 'VERTICAL SPEED', 12, -10, 5.5); centredText(g, '1000 FT/MIN', 12, 0, 5.5, INK, 500);
  }
  protected drawDynamic(g: Ctx2D): void {
    this.pointer.draw(g, this.cx, this.cy, this.latch.get(0));
  }
}
