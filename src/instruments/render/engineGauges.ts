// Engine and systems instruments: tachometer with hour meter, the 2-1/4" dual-pointer engine gauges, single-
// pointer gauges (suction, ammeter, manifold pressure), the twin-needle gauges of a twin and the digital clock/OAT.

import { C172S_AMMETER_SCALE, C172S_PANEL, C172S_SUCTION_SCALE } from '../../aircraft/c172s/panel';
import { DEG, clamp } from '../../core/math';
import type { ControlInputs } from '../../core/types';
import type { InstrumentReadings } from '../dynamics/instrumentSet';
import type { ScaleDef, TachMarkings } from '../panelDef';
import { SMALL_BEZEL as SMALL_BEZEL_PX } from '../panelParts';
import { ARC_COLORS, ARC_RED, arcBand, centredText, dialText, font, INK, knob, NeedleSprite, paintPointer, tick } from './art';
import type { Ctx2D } from './canvas';
import { SIXPACK_BEZEL } from './pitotStaticGauges';
import { RoundGauge } from './roundGauge';
import { drawSegments } from './sevenSegment';

/** Bezel of a 2-1/4" instrument, px; the radius of its glass aperture is the panel definition's. */
export const SMALL_BEZEL = SMALL_BEZEL_PX;
const SMALL = { bezel: SMALL_BEZEL, shape: 'round' as const };
const LARGE = { bezel: SIXPACK_BEZEL, shape: 'square' as const };
/** The pointer of a 3-1/8" dial and of a 2-1/4" one. */
const largePointer = (): NeedleSprite => new NeedleSprite(70, (g) => paintPointer(g, 64, 5.5, 14));
const smallPointer = (tail: number): NeedleSprite => new NeedleSprite(48, (g) => paintPointer(g, 44, 4, tail));

// ---------------------------------------------------------------------------------------------------
// Tachometer: the scale of the type's markings over 270 degrees, with the hour meter.
const TACH_A0 = -135 * DEG;
const TACH_SPAN = 270 * DEG;

/** Glass aperture the tachometer's dial is drawn for, px; a 2-1/4" tachometer is the same dial reduced. */
const TACH_ART_APERTURE = 74;

/**
 * @param size  'small': the same dial in a 2-1/4" case.
 * @param engine  the engine it reads (a twin with one tachometer per engine); absent: engine 0.
 */
export class TachometerGauge extends RoundGauge {
  private readonly needle: NeedleSprite;
  /** Scale of the dial art: 1 in the 3-1/8" case. */
  private readonly k: number;

  constructor(
    id: string,
    cx: number,
    cy: number,
    aperture: number,
    private readonly marks: TachMarkings,
    size: 'large' | 'small' = 'large',
    private readonly engine?: number,
  ) {
    super(id, cx, cy, size === 'large' ? { ...LARGE, aperture, values: 2, seed: 107 } : { ...SMALL, aperture, values: 2, seed: 107 + (engine ?? 0) });
    this.k = size === 'large' ? 1 : aperture / TACH_ART_APERTURE;
    this.needle = size === 'large' ? largePointer() : smallPointer(8);
  }

  private angle(rpm: number): number {
    return TACH_A0 + (clamp(rpm, 0, this.marks.max) / this.marks.max) * TACH_SPAN;
  }

  sample(r: InstrumentReadings): boolean {
    const e = this.engine === undefined ? r : r.engines[this.engine];
    this.latch.track(0, this.angle(e.rpm), 0.002);
    // Hour meter: the tenths drum rolls continuously; 1/200 h steps are sub-pixel.
    this.latch.set(1, e.tachHours, 0.005);
    return this.latch.take();
  }

  protected paintFace(g: Ctx2D): void {
    if (this.k !== 1) g.scale(this.k, this.k);
    const R = (this.k === 1 ? this.r : TACH_ART_APERTURE) - 3;
    const m = this.marks;
    for (const a of m.arcs) arcBand(g, this.angle(a.from), this.angle(a.to), R, 7, ARC_COLORS[a.color]);
    for (let rpm = 0; rpm <= m.max; rpm += m.minorStep) {
      const major = rpm % m.majorStep === 0;
      tick(g, this.angle(rpm), R - (major ? 14 : 8), R, major ? 2.4 : 1.3);
    }
    tick(g, this.angle(m.redLine), R - 16, R + 1, 3.4, ARC_RED);
    for (let rpm = 0; rpm <= m.max; rpm += m.numberStep) dialText(g, String(rpm / 100), this.angle(rpm), R - 26, 17);
    centredText(g, 'RPM', 0, -26, 10);
    centredText(g, 'X100', 0, -15, 7.5, INK, 500);
    centredText(g, 'HOURS', 0, 32, 6, INK, 500);
    // Hour meter window
    g.fillStyle = '#050505';
    g.fillRect(-23, 13, 46, 13);
    g.strokeStyle = 'rgba(255,255,255,0.2)';
    g.lineWidth = 0.8;
    g.strokeRect(-23, 13, 46, 13);
  }

  protected drawDynamic(g: Ctx2D): void {
    const hours = this.latch.get(1);
    const x0 = this.cx - 22;
    const y0 = this.cy + 14;
    const cw = 8.8;
    const tenths = hours * 10;
    g.save();
    if (this.k !== 1) {
      // The reduced dial: the hour meter shrinks about the dial centre with it.
      g.translate(this.cx, this.cy);
      g.scale(this.k, this.k);
      g.translate(-this.cx, -this.cy);
    }
    g.beginPath();
    g.rect(x0, y0, 5 * cw, 11);
    g.clip();
    g.font = font(9.5, 600);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // Four whole-hour drums and one rolling tenths drum (black on white).
    const whole = Math.floor(tenths / 10);
    for (let i = 0; i < 4; i++) {
      const d = Math.floor(whole / 10 ** (3 - i)) % 10;
      g.fillStyle = '#0c0c0c';
      g.fillRect(x0 + i * cw, y0, cw - 0.8, 11);
      g.fillStyle = INK;
      g.fillText(String(d), x0 + i * cw + cw / 2, y0 + 6);
    }
    const tx = x0 + 4 * cw;
    g.fillStyle = '#e8e5d8';
    g.fillRect(tx, y0, cw, 11);
    g.fillStyle = '#111';
    const frac = tenths - Math.floor(tenths);
    const d = Math.floor(tenths) % 10;
    g.fillText(String(d), tx + cw / 2, y0 + 6 - frac * 11);
    g.fillText(String((d + 1) % 10), tx + cw / 2, y0 + 17 - frac * 11);
    const shade = g.createLinearGradient(0, y0, 0, y0 + 11);
    shade.addColorStop(0, 'rgba(0,0,0,0.6)');
    shade.addColorStop(0.35, 'rgba(0,0,0,0)');
    shade.addColorStop(0.65, 'rgba(0,0,0,0)');
    shade.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = shade;
    g.fillRect(x0, y0, 5 * cw, 11);
    g.restore();
    this.needle.draw(g, this.cx, this.cy, this.latch.get(0));
  }
}

// ---------------------------------------------------------------------------------------------------
/**
 * Redraw step of the 44 px pointers of the small gauges, rad: 0.22 px at the tip (the panel texture is seen
 * at about 0.6-0.8 screen px per texel, so a step is invisible), large enough that fuel slosh and oil
 * pressure ripple of a tenth of a pixel no longer redraw the cluster every frame.
 */
const SMALL_NEEDLE_QUANTUM = 0.005;
/** The same for the 64 px pointers of the 3-1/8" dials (the tachometer's step). */
const LARGE_NEEDLE_QUANTUM = 0.002;

// Each half sweeps 100 degrees centred on 9 o'clock (left) or 3 o'clock (right).
const HALF_SWEEP = 100 * DEG;

/** One side of a dual-pointer gauge: the scale runs bottom to top along the left or right edge. */
function halfAngle(side: -1 | 1, s: ScaleDef, v: number): number {
  const t = clamp((v - s.min) / (s.max - s.min), -0.04, 1.04);
  // Left: from 7 o'clock up to 11 o'clock (clockwise); right: from 5 o'clock up to 1 o'clock (anticlockwise).
  return side < 0 ? -90 * DEG - HALF_SWEEP / 2 + t * HALF_SWEEP : 90 * DEG + HALF_SWEEP / 2 - t * HALF_SWEEP;
}

/**
 * 2-1/4" dual indicator in the Cessna style, e.g. FUEL QTY L/R, OIL TEMP/PRESS, EGT/FUEL FLOW. A scale's `label`
 * is the short legend beside the pivot (empty for none); its majors get a long tick, numbered when `numbers` is set.
 */
export class DualGauge extends RoundGauge {
  private readonly needle = new NeedleSprite(48, (g) => paintPointer(g, 44, 4, 8));

  constructor(
    id: string,
    cx: number,
    cy: number,
    aperture: number,
    seed: number,
    private readonly title: readonly [string, string],
    private readonly left: ScaleDef,
    private readonly right: ScaleDef,
  ) {
    super(id, cx, cy, { ...SMALL, aperture, values: 2, seed });
  }

  sample(r: InstrumentReadings): boolean {
    this.latch.track(0, halfAngle(-1, this.left, this.left.read(r)), SMALL_NEEDLE_QUANTUM);
    this.latch.track(1, halfAngle(1, this.right, this.right.read(r)), SMALL_NEEDLE_QUANTUM);
    return this.latch.take();
  }

  protected paintFace(g: Ctx2D): void {
    const R = this.r - 3;
    for (const [side, s] of [
      [-1, this.left],
      [1, this.right],
    ] as const) {
      for (const b of s.arcs ?? []) {
        const a0 = halfAngle(side, s, b.from);
        const a1 = halfAngle(side, s, b.to);
        arcBand(g, Math.min(a0, a1), Math.max(a0, a1), R, 5, ARC_COLORS[b.color]);
      }
      for (let v = s.min; v <= s.max + 1e-6; v += s.minorStep) tick(g, halfAngle(side, s, v), R - 5, R, 1.1);
      for (const v of s.majors) {
        tick(g, halfAngle(side, s, v), R - 9, R, 1.9);
        if (s.numbers) dialText(g, String(v), halfAngle(side, s, v), R - 15, 8);
      }
      for (const v of s.redLines ?? []) tick(g, halfAngle(side, s, v), R - 10, R + 1, 2.6, ARC_RED);
      if (s.label) centredText(g, s.label, side * 15, 0, 7);
    }
    centredText(g, this.title[0], 0, -24, 6.5);
    centredText(g, this.title[1], 0, 24, 6.5, INK, 500);
  }

  protected drawDynamic(g: Ctx2D): void {
    this.needle.draw(g, this.cx, this.cy, this.latch.get(0));
    this.needle.draw(g, this.cx, this.cy, this.latch.get(1));
  }
}

/** One side of a dual gauge with its colour bands as paint: the form the C172S engine cluster had in this module. */
export interface HalfScale {
  label: string;
  min: number;
  max: number;
  majors: readonly number[];
  minorStep: number;
  numbers?: boolean;
  bands?: { from: number; to: number; color: string }[];
  redLines?: readonly number[];
  read(r: InstrumentReadings): number;
}

const halfScale = (s: ScaleDef): HalfScale => ({
  label: s.label,
  min: s.min,
  max: s.max,
  majors: s.majors,
  minorStep: s.minorStep,
  numbers: s.numbers,
  bands: s.arcs?.map((a) => ({ from: a.from, to: a.to, color: ARC_COLORS[a.color] })),
  redLines: s.redLines,
  read: s.read,
});

function c172sDual(id: string): { seed: number; title: readonly [string, string]; left: HalfScale; right: HalfScale } {
  const g = C172S_PANEL.gauges.find((gauge) => gauge.id === id);
  if (g?.kind !== 'dual') throw new Error(`The C172S panel has no dual gauge '${id}'`);
  return { seed: g.seed, title: g.title, left: halfScale(g.left), right: halfScale(g.right) };
}

/** The three dual gauges of the C172S engine cluster under the name they had here: members of its panel definition. */
export const ENGINE_CLUSTER: Record<'fuel' | 'oil' | 'egtff', { seed: number; title: readonly [string, string]; left: HalfScale; right: HalfScale }> = {
  fuel: c172sDual('fuel'),
  oil: c172sDual('oil'),
  egtff: c172sDual('egtff'),
};

// ---------------------------------------------------------------------------------------------------
/** The dial of a single-pointer gauge: the angles of the scale's ends, the values that are numbered, the legends. */
export interface SingleDial {
  a0: number;
  a1: number;
  labels: readonly number[];
  title: string;
  units: string;
}

/** Glass aperture the single-pointer dial is lettered for, px; in a 3-1/8" case the lettering grows with the glass. */
const SINGLE_ART_APERTURE = 51;

/** Needle angle of a value on a single-pointer dial: linear between the ends of the scale, held at its stops. */
function dialAngle(d: SingleDial, s: Pick<ScaleDef, 'min' | 'max'>, v: number): number {
  return d.a0 + ((clamp(v, s.min, s.max) - s.min) / (s.max - s.min)) * (d.a1 - d.a0);
}

/** The face of a single-pointer dial (one needle or two): bands, ticks, red lines, numbers, legends. */
function paintDial(g: Ctx2D, aperture: number, large: boolean, d: SingleDial, s: Omit<ScaleDef, 'read'>): void {
  const R = aperture - 3;
  const k = large ? aperture / SINGLE_ART_APERTURE : 1;
  for (const b of s.arcs ?? []) arcBand(g, dialAngle(d, s, b.from), dialAngle(d, s, b.to), R, 5 * k, ARC_COLORS[b.color]);
  for (let v = s.min; v <= s.max + 1e-6; v += s.minorStep) tick(g, dialAngle(d, s, v), R - 5 * k, R, 1.1 * k);
  for (const v of s.majors) tick(g, dialAngle(d, s, v), R - 9 * k, R, 1.9 * k);
  for (const v of s.redLines ?? []) tick(g, dialAngle(d, s, v), R - 10 * k, R + 1, 2.6 * k, ARC_RED);
  for (const v of d.labels) dialText(g, String(Math.abs(v)), dialAngle(d, s, v), R - 17 * k, 10 * k);
  // A scale that sweeps beyond 130 degrees each way leaves no room between its end numbers: the legends go above the pivot.
  const below = Math.max(Math.abs(d.a0), Math.abs(d.a1)) <= 130 * DEG ? 1 : -1;
  centredText(g, d.title, 0, below > 0 ? 18 * k : -27 * k, 7 * k);
  centredText(g, d.units, 0, below > 0 ? 27 * k : -18 * k, 6 * k, INK, 500);
}

/** Simple single-pointer gauge (suction, ammeter, manifold pressure), in a 2-1/4" case or a 3-1/8" one. */
export class SingleGauge extends RoundGauge {
  private readonly needle: NeedleSprite;
  private readonly large: boolean;

  constructor(
    id: string,
    cx: number,
    cy: number,
    aperture: number,
    seed: number,
    private readonly dial: SingleDial,
    private readonly s: ScaleDef,
    size: 'large' | 'small' = 'small',
  ) {
    super(id, cx, cy, { ...(size === 'large' ? LARGE : SMALL), aperture, values: 1, seed });
    this.large = size === 'large';
    this.needle = this.large ? largePointer() : smallPointer(9);
  }

  sample(r: InstrumentReadings): boolean {
    this.latch.track(0, dialAngle(this.dial, this.s, this.s.read(r)), this.large ? LARGE_NEEDLE_QUANTUM : SMALL_NEEDLE_QUANTUM);
    return this.latch.take();
  }

  protected paintFace(g: Ctx2D): void {
    paintDial(g, this.r, this.large, this.dial, this.s);
  }

  protected drawDynamic(g: Ctx2D): void {
    this.needle.draw(g, this.cx, this.cy, this.latch.get(0));
  }
}

/** A pointer that carries its engine's letter in a disc on the shaft, as the needles of a twin's gauges do. */
function letteredPointer(large: boolean, letter: string): NeedleSprite {
  const length = large ? 64 : 44;
  return new NeedleSprite(length + 4, (g) => {
    paintPointer(g, length, large ? 5.5 : 4, large ? 14 : 9);
    const at = -length * 0.56;
    const r = large ? 7.5 : 5.5;
    g.fillStyle = '#101112';
    g.beginPath();
    g.arc(0, at, r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = large ? 1.2 : 1;
    g.stroke();
    g.font = font(large ? 10 : 7.5, 700);
    g.fillStyle = INK;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(letter, 0, at + 0.5);
  });
}

/**
 * Two needles on one dial, lettered L and R: the tachometer, manifold pressure or fuel flow gauge of a twin.
 * Both read the one scale, so matched engines show as one needle over the other.
 */
export class TwinNeedleGauge extends RoundGauge {
  private readonly needles: readonly [NeedleSprite, NeedleSprite];
  private readonly large: boolean;

  constructor(
    id: string,
    cx: number,
    cy: number,
    aperture: number,
    seed: number,
    private readonly dial: SingleDial,
    private readonly s: Omit<ScaleDef, 'read'>,
    private readonly left: (r: InstrumentReadings) => number,
    private readonly right: (r: InstrumentReadings) => number,
    size: 'large' | 'small' = 'large',
  ) {
    super(id, cx, cy, { ...(size === 'large' ? LARGE : SMALL), aperture, values: 2, seed });
    this.large = size === 'large';
    this.needles = [letteredPointer(this.large, 'L'), letteredPointer(this.large, 'R')];
  }

  /** Needle angle of a value, rad clockwise from 12 o'clock. */
  angle(v: number): number {
    return dialAngle(this.dial, this.s, v);
  }

  sample(r: InstrumentReadings): boolean {
    const quantum = this.large ? LARGE_NEEDLE_QUANTUM : SMALL_NEEDLE_QUANTUM;
    this.latch.track(0, this.angle(this.left(r)), quantum);
    this.latch.track(1, this.angle(this.right(r)), quantum);
    return this.latch.take();
  }

  protected paintFace(g: Ctx2D): void {
    paintDial(g, this.r, this.large, this.dial, this.s);
  }

  protected drawDynamic(g: Ctx2D): void {
    // The right needle lies under the left one.
    this.needles[1].draw(g, this.cx, this.cy, this.latch.get(1));
    this.needles[0].draw(g, this.cx, this.cy, this.latch.get(0));
  }
}

/** Suction gauge: every major of the scale is numbered. The scale is the type's (the C172S's when none is given). */
export const suctionGauge = (id: string, cx: number, cy: number, aperture: number, scale: ScaleDef = C172S_SUCTION_SCALE): SingleGauge =>
  new SingleGauge(id, cx, cy, aperture, 204, { a0: -125 * DEG, a1: 125 * DEG, labels: scale.majors, title: 'SUCTION', units: 'IN HG' }, scale);

/** Battery ammeter, centre zero: the ends of the scale and the zero are numbered. */
export const ammeterGauge = (id: string, cx: number, cy: number, aperture: number, scale: ScaleDef = C172S_AMMETER_SCALE): SingleGauge =>
  new SingleGauge(id, cx, cy, aperture, 205, { a0: -70 * DEG, a1: 70 * DEG, labels: [scale.min, 0, scale.max], title: '-  AMPS  +', units: 'BATT' }, scale);

// ---------------------------------------------------------------------------------------------------
/**
 * Digital clock / OAT / voltmeter in a 2-1/4" case with a reflective LCD (readable in sunlight; the
 * segments are dark on a grey-green ground). Shows local time and outside air temperature. Blank when
 * the bus is unpowered.
 */
export class ClockOatGauge extends RoundGauge {
  constructor(id: string, cx: number, cy: number, aperture: number) {
    super(id, cx, cy, { ...SMALL, aperture, values: 3, seed: 206 });
  }

  sample(r: InstrumentReadings, _c: ControlInputs): boolean {
    this.latch.set(0, r.busPowered ? 1 : 0, 1);
    this.latch.set(1, Math.floor(r.clockSeconds / 60), 1);
    this.latch.set(2, r.oatC, 1);
    return this.latch.take();
  }

  protected paintFace(g: Ctx2D): void {
    g.fillStyle = '#050505';
    g.fillRect(-38, -24, 76, 44);
    centredText(g, 'OAT', -24, 30, 6.5);
    centredText(g, 'CLOCK', 22, 30, 6.5);
    centredText(g, 'SEL', -24, -32, 6.5, INK, 500);
    centredText(g, 'CTL', 22, -32, 6.5, INK, 500);
  }

  protected drawDynamic(g: Ctx2D): void {
    const x = this.cx - 35;
    const y = this.cy - 21;
    const lcd = g.createLinearGradient(x, y, x, y + 38);
    lcd.addColorStop(0, '#7f8a74');
    lcd.addColorStop(1, '#69735f');
    g.fillStyle = lcd;
    g.fillRect(x, y, 70, 38);
    if (this.latch.get(0)) {
      const on = '#1a1d17';
      const off = 'rgba(40,45,35,0.10)';
      const mins = this.latch.get(1);
      const hh = String(Math.floor(mins / 60) % 24).padStart(2, '0');
      const mm = String(mins % 60).padStart(2, '0');
      drawSegments(g, `${hh}:${mm}`, x + 64, y + 4, { height: 17, on, off });
      const oat = this.latch.get(2);
      drawSegments(g, `${oat < 0 ? '-' : ' '}${String(Math.abs(oat)).padStart(2, ' ')}°C`, x + 64, y + 25, { height: 9, on, off });
      g.fillStyle = on;
      g.font = font(6, 700);
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText('LT', x + 3, y + 12);
      g.fillText('OAT', x + 3, y + 30);
    }
  }

  protected paintOverBezel(g: Ctx2D): void {
    knob(g, -40, 44, 6);
    knob(g, 40, 44, 6);
  }
}
