// Position lights and the small controls beside them: the landing gear lights and selector, the flap position
// lights and switch, the trim position bars, guarded knobs, and the magneto toggles / engine masters with the
// starter of a panel whose ignition is not a key.

import { clamp } from '../../core/math';
import { engineControl, type ControlInputs } from '../../core/types';
import type { InstrumentReadings } from '../dynamics/instrumentSet';
import type { ArcColor, GaugeDef, IgnitionPanelDef } from '../panelDef';
import { FLAP_SWITCH, flapLeverValues, flapPositionOf, flapSwitchRect, GEAR_LEVER, gearLeverRect, GUARDED_KNOB, guardedKnobRect, type IgnitionLayout } from '../panelParts';
import { knob, screw } from './art';
import { rng, type Ctx2D } from './canvas';
import { Latch, LIGHT_DISPLAY, type PanelComponent, type Rect } from './component';
import { label, PAINT_WHITE, rocker } from './controls';

/** Lamp colours, lit: [core, glow]. */
const LAMP: Record<ArcColor, readonly [string, string]> = {
  green: ['#7dff8e', '#19d43c'],
  red: ['#ff8d7c', '#ff2a14'],
  yellow: ['#ffe58a', '#ffb81e'],
  white: ['#ffffff', '#dfe6ee'],
  blue: ['#a9d2ff', '#2f7fd6'],
};

/** A round indicator lamp behind its lens: dark unless lit. */
function lamp(g: Ctx2D, x: number, y: number, r: number, color: ArcColor, on: boolean): void {
  g.fillStyle = '#050505';
  g.beginPath();
  g.arc(x, y, r + 2, 0, Math.PI * 2);
  g.fill();
  const [core, glow] = LAMP[color];
  if (on) {
    g.save();
    g.shadowColor = glow;
    g.shadowBlur = r * 0.9;
    const lens = g.createRadialGradient(x, y, 0, x, y, r);
    lens.addColorStop(0, core);
    lens.addColorStop(1, glow);
    g.fillStyle = lens;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.restore();
  } else {
    const lens = g.createRadialGradient(x - r * 0.3, y - r * 0.4, 0, x, y, r);
    lens.addColorStop(0, '#2c2d2c');
    lens.addColorStop(1, '#141514');
    g.fillStyle = lens;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = 'rgba(255,255,255,0.14)';
  g.lineWidth = 0.8;
  g.beginPath();
  g.arc(x, y, r - 0.5, 0, Math.PI * 2);
  g.stroke();
}

/** Black sub-plate with two screws that a cluster of lamps or a small control sits on. */
function plate(g: Ctx2D, b: Rect, seed: number): void {
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.6)';
  g.shadowBlur = 4;
  g.shadowOffsetY = 2;
  g.fillStyle = '#17181a';
  g.beginPath();
  g.roundRect(b.x + 2, b.y + 2, b.w - 4, b.h - 5, 4);
  g.fill();
  g.restore();
  g.strokeStyle = 'rgba(255,255,255,0.07)';
  g.lineWidth = 1;
  g.beginPath();
  g.roundRect(b.x + 2.5, b.y + 2.5, b.w - 5, b.h - 6, 4);
  g.stroke();
  const rand = rng(seed);
  screw(g, b.x + 8, b.y + 8, 2.4, rand);
  screw(g, b.x + b.w - 8, b.y + 8, 2.4, rand);
}

// ---------------------------------------------------------------------------------------------------
/** Where the four lamps of a gear light cluster are in its rectangle: the red one, then nose, left, right. */
export function gearLampPlaces(b: Rect): { x: number; y: number; r: number }[] {
  const r = Math.min(b.w, b.h) * 0.1;
  return [
    { x: b.x + b.w * 0.5, y: b.y + b.h * 0.17, r },
    { x: b.x + b.w * 0.5, y: b.y + b.h * 0.47, r },
    { x: b.x + b.w * 0.24, y: b.y + b.h * 0.76, r },
    { x: b.x + b.w * 0.76, y: b.y + b.h * 0.76, r },
  ];
}

const GEAR_LEGENDS = ['UNSAFE', 'NOSE', 'LEFT', 'RIGHT'];
const GEAR_COLORS: readonly ArcColor[] = ['red', 'green', 'green', 'green'];

/**
 * Landing gear position lights: a green one per leg, lit while that leg is down and locked, and the red one,
 * lit while any leg is neither up nor down and locked. All dark with the gear up, and without bus power.
 */
export class GearLights implements PanelComponent {
  private readonly latch = new Latch(4);
  private readonly lamps: { x: number; y: number; r: number }[];

  constructor(
    readonly id: string,
    readonly bounds: Rect,
  ) {
    this.lamps = gearLampPlaces(bounds);
  }

  sample(r: InstrumentReadings): boolean {
    const gear = r.gear;
    this.latch.set(0, gear !== null && gear.inTransit ? 1 : 0, 1);
    this.latch.set(1, gear !== null && gear.nose ? 1 : 0, 1);
    this.latch.set(2, gear !== null && gear.left ? 1 : 0, 1);
    this.latch.set(3, gear !== null && gear.right ? 1 : 0, 1);
    return this.latch.take();
  }

  /** Whether lamp i (red, nose, left, right) is drawn lit. */
  lit(i: number): boolean {
    return this.latch.get(i) === 1;
  }

  drawStatic(g: Ctx2D): void {
    plate(g, this.bounds, 411);
    this.lamps.forEach((l, i) => label(g, GEAR_LEGENDS[i], l.x, l.y + l.r + 8, 6.5));
  }

  paintLightMask(g: Ctx2D): void {
    g.fillStyle = LIGHT_DISPLAY;
    for (const l of this.lamps) {
      g.beginPath();
      g.arc(l.x, l.y, l.r, 0, Math.PI * 2);
      g.fill();
    }
  }

  draw(g: Ctx2D): void {
    this.lamps.forEach((l, i) => lamp(g, l.x, l.y, l.r, GEAR_COLORS[i], this.latch.get(i) === 1));
  }
}

/** The gear selector of a gear light cluster: a wheel-shaped knob in a slot, at the top with the gear selected UP. */
export class GearSelector implements PanelComponent {
  readonly bounds: Rect;
  private readonly latch = new Latch(1);

  constructor(
    readonly id: string,
    private readonly at: readonly [number, number],
  ) {
    this.bounds = gearLeverRect(at);
  }

  sample(_r: InstrumentReadings, c: ControlInputs): boolean {
    this.latch.set(0, c.gearLever === 'up' ? 0 : 1, 1);
    return this.latch.take();
  }

  drawStatic(g: Ctx2D): void {
    const b = this.bounds;
    const [x, y] = this.at;
    plate(g, b, 412);
    label(g, 'GEAR', x, b.y + 16, 8);
    label(g, 'UP', x - 22, y - GEAR_LEVER.travel / 2, 7);
    label(g, 'DN', x - 22, y + GEAR_LEVER.travel / 2, 7);
    g.fillStyle = '#050505';
    g.beginPath();
    g.roundRect(x - 4, y - GEAR_LEVER.travel / 2 - 8, 8, GEAR_LEVER.travel + 16, 4);
    g.fill();
  }

  draw(g: Ctx2D): void {
    const [x, y] = this.at;
    const ly = y + (this.latch.get(0) - 0.5) * GEAR_LEVER.travel;
    // The knob is a little wheel seen edge-on (so it cannot be mistaken for the flap switch by feel).
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.beginPath();
    g.ellipse(x + 2, ly + 4, 15, 11, 0, 0, Math.PI * 2);
    g.fill();
    const tyre = g.createLinearGradient(0, ly - 11, 0, ly + 11);
    tyre.addColorStop(0, '#f6f5ee');
    tyre.addColorStop(0.5, '#dddcd4');
    tyre.addColorStop(1, '#8f8e88');
    g.fillStyle = tyre;
    g.beginPath();
    g.ellipse(x, ly, 15, 11, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.4)';
    g.lineWidth = 0.8;
    g.stroke();
    g.fillStyle = '#3a3b3d';
    g.beginPath();
    g.ellipse(x, ly, 5, 3.6, 0, 0, Math.PI * 2);
    g.fill();
  }
}

// ---------------------------------------------------------------------------------------------------
type FlapLightsDef = Extract<GaugeDef, { kind: 'flapLights' }>;

/** Flaps within this of a position's deflection are at it, degrees. */
export const FLAP_AT_POSITION_DEG = 1;

/**
 * Which lamps of a flap light cluster are lit, as bits (bit i = position i). With the deflections given: the
 * lamp of the position the flaps have reached, or the lamps of BOTH neighbouring positions while they travel
 * between two. Without: the lamp of the position the lever selects.
 */
export function flapLampBits(def: FlapLightsDef, levers: readonly number[], flapsDeg: number, lever: number): number {
  const d = def.degrees;
  if (!d) return 1 << flapPositionOf(levers, lever);
  const n = d.length;
  for (let i = 0; i < n; i++) if (Math.abs(flapsDeg - d[i]) <= FLAP_AT_POSITION_DEG) return 1 << i;
  if (flapsDeg < d[0]) return 1;
  for (let i = 0; i < n - 1; i++) if (flapsDeg < d[i + 1]) return (1 << i) | (1 << (i + 1));
  return 1 << (n - 1);
}

/**
 * Flap position lights, one per position (a column in a tall rectangle, a row in a wide one), each with its
 * legend. They need bus power.
 */
export class FlapLights implements PanelComponent {
  readonly bounds: Rect;
  private readonly latch = new Latch(1);
  private readonly levers: number[];
  private readonly colors: readonly ArcColor[];

  constructor(private readonly def: FlapLightsDef) {
    this.bounds = def.bounds;
    this.levers = flapLeverValues(def);
    // Green for flaps up, white for every extended position, unless the definition colours them.
    this.colors = def.colors ?? def.positions.map((_, i) => (i === 0 ? 'green' : 'white'));
  }

  get id(): string {
    return this.def.id;
  }

  sample(r: InstrumentReadings, c: ControlInputs): boolean {
    this.latch.set(0, r.busPowered ? flapLampBits(this.def, this.levers, r.flapsDeg, c.flaps) : 0, 1);
    return this.latch.take();
  }

  /** Whether the lamp of position i is drawn lit. */
  lit(i: number): boolean {
    return (this.latch.get(0) & (1 << i)) !== 0;
  }

  private place(i: number): { x: number; y: number; r: number; column: boolean } {
    const b = this.bounds;
    const n = this.def.positions.length;
    const column = b.h >= b.w;
    const r = Math.min(9, (column ? b.h / n : b.w / n) * 0.3);
    return column
      ? { x: b.x + Math.min(b.w * 0.3, 22), y: b.y + ((i + 0.5) / n) * b.h, r, column }
      : { x: b.x + ((i + 0.5) / n) * b.w, y: b.y + b.h * 0.4, r, column };
  }

  drawStatic(g: Ctx2D): void {
    plate(g, this.bounds, 413);
    this.def.positions.forEach((text, i) => {
      const p = this.place(i);
      if (p.column) label(g, text, p.x + p.r + 8, p.y, 8, 'left');
      else label(g, text, p.x, p.y + p.r + 9, 8);
    });
  }

  paintLightMask(g: Ctx2D): void {
    g.fillStyle = LIGHT_DISPLAY;
    for (let i = 0; i < this.def.positions.length; i++) {
      const p = this.place(i);
      g.beginPath();
      g.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      g.fill();
    }
  }

  draw(g: Ctx2D): void {
    for (let i = 0; i < this.def.positions.length; i++) {
      const p = this.place(i);
      lamp(g, p.x, p.y, p.r, this.colors[i] ?? 'white', this.lit(i));
    }
  }
}

/** The flap switch of a flap light cluster: a flap-shaped paddle in a slot, one detent per position, flaps up at the top. */
export class FlapSwitch implements PanelComponent {
  readonly bounds: Rect;
  private readonly latch = new Latch(1);
  private readonly levers: number[];

  constructor(
    readonly id: string,
    private readonly at: readonly [number, number],
    private readonly def: FlapLightsDef,
  ) {
    this.bounds = flapSwitchRect(at, def.positions.length);
    this.levers = flapLeverValues(def);
  }

  sample(_r: InstrumentReadings, c: ControlInputs): boolean {
    this.latch.set(0, flapPositionOf(this.levers, c.flaps), 1);
    return this.latch.take();
  }

  private detentY(i: number): number {
    return this.at[1] + (i - (this.def.positions.length - 1) / 2) * FLAP_SWITCH.pitch;
  }

  drawStatic(g: Ctx2D): void {
    const b = this.bounds;
    const x = this.at[0];
    const n = this.def.positions.length;
    plate(g, b, 414);
    label(g, 'FLAPS', x, b.y + 13, 8);
    for (let i = 0; i < n; i++) {
      g.strokeStyle = PAINT_WHITE;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x - 20, this.detentY(i));
      g.lineTo(x - 12, this.detentY(i));
      g.stroke();
    }
    g.fillStyle = '#050505';
    g.beginPath();
    g.roundRect(x - 4, this.detentY(0) - 7, 8, (n - 1) * FLAP_SWITCH.pitch + 14, 4);
    g.fill();
  }

  draw(g: Ctx2D): void {
    const x = this.at[0];
    const y = this.detentY(this.latch.get(0));
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.beginPath();
    g.roundRect(x - 12 + 2, y - 6 + 4, 34, 12, 5);
    g.fill();
    const paddle = g.createLinearGradient(0, y - 6, 0, y + 6);
    paddle.addColorStop(0, '#ffffff');
    paddle.addColorStop(0.5, '#e4e3dc');
    paddle.addColorStop(1, '#9d9c95');
    g.fillStyle = paddle;
    // An airfoil-shaped paddle (so it cannot be mistaken for the gear selector by feel).
    g.beginPath();
    g.moveTo(x - 12, y);
    g.quadraticCurveTo(x - 12, y - 6, x - 2, y - 6);
    g.lineTo(x + 22, y - 2);
    g.lineTo(x + 22, y + 2);
    g.lineTo(x - 2, y + 6);
    g.quadraticCurveTo(x - 12, y + 6, x - 12, y);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 0.8;
    g.stroke();
  }
}

// ---------------------------------------------------------------------------------------------------
/**
 * Where the index of a trim bar is along it, 0..1 from its first end: the top of a tall bar, the left of a wide
 * one. Elevator trim: nose DOWN at the first end. Rudder trim: nose LEFT at the first end.
 */
export function trimBarFraction(axis: 'elevator' | 'rudder', c: ControlInputs): number {
  return (clamp(axis === 'elevator' ? c.elevatorTrim : c.rudderTrim, -1, 1) + 1) / 2;
}

/**
 * Trim position indicator: an index along a graduated bar with the neutral (take-off) mark at its middle. It
 * shows where the trim control stands. A tall rectangle gives an upright bar, a wide one a level bar.
 */
export class TrimBar implements PanelComponent {
  private readonly latch = new Latch(1);
  private readonly upright: boolean;

  constructor(
    readonly id: string,
    readonly bounds: Rect,
    private readonly axis: 'elevator' | 'rudder',
  ) {
    this.upright = bounds.h >= bounds.w;
  }

  sample(_r: InstrumentReadings, c: ControlInputs): boolean {
    this.latch.track(0, trimBarFraction(this.axis, c), 0.004);
    return this.latch.take();
  }

  /** The two ends of the bar's travel, panel px. */
  private track(): { x0: number; y0: number; x1: number; y1: number } {
    const b = this.bounds;
    return this.upright
      ? { x0: b.x + b.w / 2, y0: b.y + 26, x1: b.x + b.w / 2, y1: b.y + b.h - 26 }
      : { x0: b.x + 30, y0: b.y + b.h / 2 + 4, x1: b.x + b.w - 30, y1: b.y + b.h / 2 + 4 };
  }

  drawStatic(g: Ctx2D): void {
    const b = this.bounds;
    const t = this.track();
    const [first, last] = this.axis === 'elevator' ? ['NOSE DN', 'NOSE UP'] : ['L', 'R'];
    g.fillStyle = '#050505';
    g.strokeStyle = PAINT_WHITE;
    g.lineWidth = 1.2;
    g.beginPath();
    if (this.upright) {
      g.roundRect(t.x0 - 4, t.y0 - 6, 8, t.y1 - t.y0 + 12, 4);
      g.fill();
      label(g, first, t.x0, b.y + 10, 7);
      label(g, last, t.x0, b.y + b.h - 10, 7);
      for (let i = 0; i <= 4; i++) {
        const y = t.y0 + (i / 4) * (t.y1 - t.y0);
        g.beginPath();
        g.moveTo(t.x0 + 8, y);
        g.lineTo(t.x0 + (i === 2 ? 20 : 14), y);
        g.stroke();
      }
      label(g, this.axis === 'elevator' ? 'T/O' : '0', t.x0 + 24, (t.y0 + t.y1) / 2, 6.5, 'left');
    } else {
      g.roundRect(t.x0 - 6, t.y0 - 4, t.x1 - t.x0 + 12, 8, 4);
      g.fill();
      label(g, first, b.x + 14, t.y0, 7);
      label(g, last, b.x + b.w - 14, t.y0, 7);
      for (let i = 0; i <= 4; i++) {
        const x = t.x0 + (i / 4) * (t.x1 - t.x0);
        g.beginPath();
        g.moveTo(x, t.y0 - 8);
        g.lineTo(x, t.y0 - (i === 2 ? 20 : 14));
        g.stroke();
      }
      label(g, this.axis === 'elevator' ? 'ELEV TRIM' : 'RUDDER TRIM', b.x + b.w / 2, b.y + 9, 7);
    }
  }

  draw(g: Ctx2D): void {
    const t = this.track();
    const f = this.latch.get(0);
    const x = t.x0 + f * (t.x1 - t.x0);
    const y = t.y0 + f * (t.y1 - t.y0);
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.beginPath();
    if (this.upright) g.roundRect(x - 9 + 1, y - 3 + 2, 18, 6, 2);
    else g.roundRect(x - 3 + 1, y - 9 + 2, 6, 18, 2);
    g.fill();
    g.fillStyle = '#f2f1ea';
    g.beginPath();
    if (this.upright) g.roundRect(x - 9, y - 3, 18, 6, 2);
    else g.roundRect(x - 3, y - 9, 6, 18, 2);
    g.fill();
  }
}

// ---------------------------------------------------------------------------------------------------
/**
 * A guarded knob or push-button with its legend: emergency gear extension, gear-warning test. `pulled` gives the
 * latched state of a knob that stays out (drawn pulled toward the pilot); a push-button has none.
 */
export class GuardedKnob implements PanelComponent {
  readonly bounds: Rect;
  private readonly latch = new Latch(1);

  constructor(
    readonly id: string,
    private readonly at: readonly [number, number],
    private readonly legend: string,
    private readonly pulled?: (c: ControlInputs) => boolean,
  ) {
    this.bounds = guardedKnobRect(at);
  }

  sample(_r: InstrumentReadings, c: ControlInputs): boolean {
    this.latch.set(0, this.pulled?.(c) ? 1 : 0, 1);
    return this.latch.take();
  }

  drawStatic(g: Ctx2D): void {
    const [x, y] = this.at;
    const r = GUARDED_KNOB.r;
    // The guard: a red collar around the knob.
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.beginPath();
    g.arc(x + 1, y + 3, r + 7, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#a3170f';
    g.beginPath();
    g.arc(x, y, r + 6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#0a0a0a';
    g.beginPath();
    g.arc(x, y, r + 1, 0, Math.PI * 2);
    g.fill();
    // The legend, on up to two lines under the knob.
    const words = this.legend.split(' ');
    const half = Math.ceil(words.length / 2);
    const lines = this.legend.length > 12 && words.length > 1 ? [words.slice(0, half).join(' '), words.slice(half).join(' ')] : [this.legend];
    lines.forEach((text, i) => label(g, text, x, y + r + 16 + i * 9, 7));
  }

  draw(g: Ctx2D): void {
    const [x, y] = this.at;
    const out = this.latch.get(0) === 1;
    // Pulled, the knob stands nearer the eye: larger, with a longer shadow.
    const r = GUARDED_KNOB.r * (out ? 1 : 0.86);
    g.fillStyle = `rgba(0,0,0,${out ? 0.6 : 0.4})`;
    g.beginPath();
    g.arc(x + (out ? 3 : 1), y + (out ? 7 : 2), r, 0, Math.PI * 2);
    g.fill();
    const cap = g.createRadialGradient(x - r * 0.3, y - r * 0.4, 1, x, y, r);
    cap.addColorStop(0, '#f0513f');
    cap.addColorStop(1, '#8e1109');
    g.fillStyle = cap;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.4)';
    g.lineWidth = 0.8;
    g.stroke();
  }
}

// ---------------------------------------------------------------------------------------------------
/**
 * The ignition group of a panel without a key: the left and right magneto switch of each engine with the starter
 * rocker ('toggles'), or the ENGINE MASTER of each engine with the START key ('engineMaster'). Each switch shows
 * its own engine's control (engineControl); the starter leans toward the engine being cranked.
 */
export class IgnitionSwitches implements PanelComponent {
  readonly id = 'ignition';
  readonly bounds: Rect;
  private readonly latch: Latch;
  private readonly engines: number;

  constructor(
    private readonly kind: Exclude<IgnitionPanelDef['kind'], 'key'>,
    private readonly layout: IgnitionLayout,
  ) {
    this.bounds = layout.rect;
    this.latch = new Latch(layout.toggles.length + 1);
    this.engines = layout.starters.length;
  }

  sample(_r: InstrumentReadings, c: ControlInputs): boolean {
    const toggles = this.layout.toggles;
    for (let i = 0; i < toggles.length; i++) {
      const t = toggles[i];
      const on =
        t.kind === 'engineMaster'
          ? engineControl(c, t.engine, 'engineMaster')
          : (engineControl(c, t.engine, 'magnetos') & (t.kind === 'magnetoLeft' ? 2 : 1)) !== 0;
      this.latch.set(i, on ? 1 : 0, 1);
    }
    // -1 = cranking the left engine (or the only one), +1 = the right one.
    let crank = 0;
    for (let e = this.engines - 1; e >= 0; e--) if (engineControl(c, e, 'starter')) crank = e === 0 ? -1 : 1;
    this.latch.set(toggles.length, crank, 1);
    return this.latch.take();
  }

  /** Whether switch i of the layout is drawn ON. */
  on(i: number): boolean {
    return this.latch.get(i) === 1;
  }

  drawStatic(g: Ctx2D): void {
    const L = this.layout;
    const b = this.bounds;
    plate(g, b, 415);
    const twin = this.engines > 1;
    for (const t of L.toggles) {
      const w = t.kind === 'engineMaster' ? 26 : 20;
      g.fillStyle = '#0b0b0c';
      g.beginPath();
      g.roundRect(t.x - w / 2 - 3, t.y - 21 - 3, w + 6, 42 + 6, 3);
      g.fill();
      if (t.kind === 'engineMaster') {
        label(g, twin ? `ENG MASTER ${t.engine === 0 ? 'L' : 'R'}` : 'ENG MASTER', t.x, b.y + 14, 6.5);
      } else {
        label(g, t.kind === 'magnetoLeft' ? 'L' : 'R', t.x, t.y - 31, 7.5);
      }
    }
    if (this.kind === 'toggles') {
      // One legend over the pair of each engine.
      for (let e = 0; e < this.engines; e++) {
        const pair = L.toggles.filter((t) => t.engine === e);
        const x = (pair[0].x + pair[1].x) / 2;
        label(g, twin ? `${e === 0 ? 'LEFT' : 'RIGHT'} MAG` : 'MAGNETOS', x, b.y + 12, 6.5);
      }
    }
    label(g, 'START', L.starter.x, b.y + (this.kind === 'toggles' ? 12 : 14), 7);
    if (twin) {
      label(g, 'L', L.starter.x - 24, L.starter.y + 30, 7);
      label(g, 'R', L.starter.x + 24, L.starter.y + 30, 7);
    }
  }

  draw(g: Ctx2D): void {
    const L = this.layout;
    L.toggles.forEach((t, i) => {
      const w = t.kind === 'engineMaster' ? 26 : 20;
      rocker(g, t.x - w / 2, t.y - 21, w, 42, this.latch.get(i) === 1, false);
    });
    const crank = this.latch.get(L.toggles.length);
    const { x, y } = L.starter;
    if (this.kind === 'toggles') {
      // Spring-centred rocker lying across: the pressed half is the darker one.
      const w = 50;
      const h = 24;
      for (const side of [-1, 1]) {
        const pressed = crank === side || (this.engines === 1 && crank !== 0);
        g.fillStyle = pressed ? '#9b9a94' : '#e9e8e2';
        g.fillRect(side < 0 ? x - w / 2 : x, y - h / 2, w / 2, h);
      }
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(x - 1.5, y - h / 2, 3, h);
      g.strokeStyle = 'rgba(0,0,0,0.5)';
      g.lineWidth = 1;
      g.strokeRect(x - w / 2 + 0.5, y - h / 2 + 0.5, w - 1, h - 1);
    } else {
      // The START key: turned toward the engine it cranks.
      g.save();
      g.translate(x, y);
      g.fillStyle = '#101011';
      g.beginPath();
      g.arc(0, 0, 17, 0, Math.PI * 2);
      g.fill();
      g.rotate(crank * (this.engines === 1 ? -1 : 1) * 40 * (Math.PI / 180));
      knob(g, 0, 0, 12, PAINT_WHITE);
      g.restore();
    }
  }
}
