// Lockheed AH-56A Cheyenne: the bespoke rectangular instruments of the reconstructed rear-seat pilot panel (UNVERIFIED, AGENT
// reconstruction from report text, research-ah56 section 12): the vertical-tape engine gauges (torque, TIT, Ng, Nf / Nr), the
// collective blade-angle and propeller blade-angle indicators, the triple hydraulic pressure bars and the gyro configuration
// placard with the ICS buttons. They own a rectangle of the panel canvas (GaugeDef 'customRect'); everything that does not change is
// painted once as static art, only the pointers and digits redraw. Values come through InstrumentSystemsDef.extra and the
// engine / rotor readings. Bands: panelMarkings.ts (tagged there).
import { clamp } from '../../core/math';
import type { ControlInputs } from '../../core/types';
import type { InstrumentReadings } from '../../instruments/dynamics/instrumentSet';
import { ARC_COLORS, ARC_RED, ARC_BLUE, INK, font } from '../../instruments/render/art';
import { LABEL_FONT, type Ctx2D } from '../../instruments/render/canvas';
import { Latch, LIGHT_DIAL, LIGHT_DISPLAY, type PanelComponent, type Rect } from '../../instruments/render/component';
import { drawSegments } from '../../instruments/render/sevenSegment';
import type { AngleSpec, TapeBand, TapeSpec } from './panelMarkings';
import { AH56_HYDRAULIC as HYD, AH56_INERT_CONTROLS, type Ah56InertControl } from './panelMarkings';

const BODY = '#0d0e0f';
const BAR = '#d9d7cc';
const AMBER = '#ffba35';
/** Unlit seven-segment colour, and three blank cells: a dark readout (no bus power) shows the unlit segments only. */
const SEGMENT_OFF = 'rgba(255,186,53,0.08)';
const DARK_DIGITS = '   ';
const text = (g: Ctx2D, s: string, x: number, y: number, size: number, align: CanvasTextAlign = 'center', color = INK, weight = 600): void => {
  g.font = font(size, weight); g.fillStyle = color; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(s, x, y);
};
const plate = (g: Ctx2D, b: Rect, color = BODY): void => {
  g.save();
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.beginPath(); g.roundRect(b.x - 1, b.y + 1, b.w + 2, b.h + 3, 5); g.fill();
  g.fillStyle = color; g.beginPath(); g.roundRect(b.x, b.y, b.w, b.h, 4); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.10)'; g.lineWidth = 1; g.stroke();
  g.restore();
};

// ---------------------------------------------------------------------------------------------------
// Vertical tape

/** Value the tape reads, or NaN for a bar that has no signal (drawn empty). */
export type TapeReader = (r: InstrumentReadings) => number;

const TAPE = { top: 34, bottom: 56, bar: 14, gap: 3 };
/** Latched in place of a missing reading (NaN would redraw every frame): far below any scale. */
const NO_SIGNAL = -1e9;
const hasSignal = (v: number): boolean => v > NO_SIGNAL / 2;

/**
 * One vertical-tape gauge: a dark window with a rule down the left, the bar (one, or two side by side for Nf / Nr), tick marks with
 * numbers on the right, the colour bands as a strip beside the bar and a digital readout under it. The bar is a filled column
 * with a bright cap, as the production tape gauges are described ("rectangular (vertical tape) gauges", ASTA-72 para 73e).
 * A two-bar tape with `firstBarBands` draws that strip LEFT of the first bar, per configuration (`extra.gyroMode`), and the `bands`
 * strip right of the last one, so each strip sits beside its own bar.
 * The bars of a self-powered tape (torque transducer, thermocouple, tach generators) stay live without the bus; the digital readouts
 * are electronic and go dark (unlit segments only) whenever the bus is dead.
 */
export class Ah56TapeGauge implements PanelComponent {
  private readonly latch: Latch;
  private readonly span: number;
  /** Latch slots after the bar values: bus powered, ICS configuration. */
  private readonly busSlot: number;
  private readonly icsSlot: number;
  constructor(readonly id: string, readonly bounds: Rect, private readonly spec: TapeSpec, private readonly readers: readonly TapeReader[],
    /** Bus-powered (electric) indication: empty bars without power. Torque and rotor speeds are self-powered. The readouts always need the bus. */
    private readonly electric = false) {
    this.busSlot = readers.length; this.icsSlot = readers.length + 1;
    this.latch = new Latch(readers.length + 2);
    this.span = bounds.h - TAPE.top - TAPE.bottom;
  }
  private y(v: number): number { return this.bounds.y + TAPE.top + this.span * (1 - (clamp(v, this.spec.min, this.spec.max) - this.spec.min) / (this.spec.max - this.spec.min)); }
  sample(r: InstrumentReadings): boolean {
    const live = !this.electric || r.busPowered;
    const q = (this.spec.max - this.spec.min) / this.span;
    for (let i = 0; i < this.readers.length; i++) { const v = live ? this.readers[i](r) : NaN; this.latch.track(i, Number.isFinite(v) ? v : NO_SIGNAL, q); }
    this.latch.set(this.busSlot, r.busPowered ? 1 : 0, 1);
    this.latch.set(this.icsSlot, this.spec.firstBarBands && r.extra?.gyroMode === 1 ? 1 : 0, 1);
    return this.latch.take();
  }
  private barX(i: number): number {
    const b = this.bounds, n = this.readers.length;
    return b.x + 5 + i * (TAPE.bar + TAPE.gap) + (n === 1 ? 2 : 0);
  }
  private strip(g: Ctx2D, x: number, w: number, bands: readonly TapeBand[]): void {
    for (const band of bands) { g.fillStyle = ARC_COLORS[band.color]; g.fillRect(x, this.y(band.to), w, this.y(band.from) - this.y(band.to)); }
  }
  drawStatic(g: Ctx2D): void {
    const b = this.bounds, s = this.spec, n = this.readers.length;
    plate(g, b);
    text(g, s.title, b.x + b.w / 2, b.y + 11, 9.5);
    text(g, s.unit, b.x + b.w / 2, b.y + 23, 7.5, 'center', INK, 500);
    const x0 = this.barX(0), x1 = this.barX(n - 1) + TAPE.bar;
    // The empty slot of each bar and the band strip beside the last one (the first bar's strip depends on the configuration: draw()).
    for (let i = 0; i < n; i++) { g.fillStyle = '#1b1d1e'; g.fillRect(this.barX(i), b.y + TAPE.top, TAPE.bar, this.span); }
    const sx = x1 + 2;
    this.strip(g, sx, 4, s.bands);
    g.lineWidth = 1;
    for (let v = s.min; v <= s.max + 1e-6; v += s.minorStep) { g.strokeStyle = 'rgba(241,240,232,0.55)'; g.beginPath(); g.moveTo(sx + 5, this.y(v)); g.lineTo(sx + 9, this.y(v)); g.stroke(); }
    for (const v of s.majors) {
      g.strokeStyle = INK; g.lineWidth = 1.4; g.beginPath(); g.moveTo(sx + 5, this.y(v)); g.lineTo(sx + 13, this.y(v)); g.stroke();
      text(g, String(v), sx + 15, this.y(v), 8, 'left');
    }
    for (const m of s.marks) {
      g.strokeStyle = m.color === 'red' ? ARC_RED : ARC_BLUE; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x0 - (s.firstBarBands ? 5 : 2), this.y(m.at)); g.lineTo(sx + 5, this.y(m.at)); g.stroke();
    }
    if (n === 2) { text(g, 'F', this.barX(0) + TAPE.bar / 2, b.y + b.h - TAPE.bottom + 9, 7.5); text(g, 'R', this.barX(1) + TAPE.bar / 2, b.y + b.h - TAPE.bottom + 9, 7.5); }
    // Readout windows.
    g.fillStyle = '#050505'; g.fillRect(b.x + 4, b.y + b.h - 40, b.w - 8, 34);
  }
  draw(g: Ctx2D): void {
    const b = this.bounds, s = this.spec, n = this.readers.length;
    // The first bar's strip for the configuration in use (Nf: ICS yellow 95-98 / green 98-105, AMCS green 95-105).
    if (s.firstBarBands) this.strip(g, this.barX(0) - 4, 3, this.latch.get(this.icsSlot) === 1 ? s.firstBarBands.ics : s.firstBarBands.amcs);
    for (let i = 0; i < n; i++) {
      const v = this.latch.get(i), x = this.barX(i);
      if (!hasSignal(v)) continue;
      const top = this.y(v);
      g.fillStyle = BAR; g.fillRect(x, top, TAPE.bar, b.y + TAPE.top + this.span - top);
      g.fillStyle = '#ffffff'; g.fillRect(x - 1, top - 1.5, TAPE.bar + 2, 3);
    }
    const lit = this.latch.get(this.busSlot) === 1;
    for (let i = 0; i < n; i++) {
      const v = this.latch.get(i), valid = hasSignal(v);
      const h = n === 2 ? 11 : 17, y = b.y + b.h - 38 + (n === 2 ? i * 15 + 3 : 8), x = b.x + b.w - 10;
      // Dead bus: the unlit segments only (the readout is electronic even where the bar is self-powered).
      if (!lit) { drawSegments(g, DARK_DIGITS, x, y, { height: h, on: SEGMENT_OFF, off: SEGMENT_OFF }); continue; }
      drawSegments(g, valid ? v.toFixed(s.decimals) : '--', x, y, { height: h, on: AMBER, off: SEGMENT_OFF });
    }
  }
  paintLightMask(g: Ctx2D): void {
    const b = this.bounds;
    g.fillStyle = LIGHT_DIAL; g.fillRect(b.x + 3, b.y + 3, b.w - 6, b.h - 46);
    g.fillStyle = LIGHT_DISPLAY; g.fillRect(b.x + 4, b.y + b.h - 40, b.w - 8, 34);
  }
}

// ---------------------------------------------------------------------------------------------------
// Angle indicator (collective blade angle, propeller blade angle)

export type AngleReader = (r: InstrumentReadings) => number;

/**
 * A window with a vertical scale, detent marks with legends, a pointer and a digital readout in degrees ("--" when the quantity is absent).
 * The indicator is electric: without bus power the pointer is not drawn and the readout shows its unlit segments only.
 */
export class Ah56AngleIndicator implements PanelComponent {
  private readonly latch = new Latch(2);
  constructor(readonly id: string, readonly bounds: Rect, private readonly spec: AngleSpec, private readonly read: AngleReader) {}
  private y(v: number): number {
    const b = this.bounds, s = this.spec, top = b.y + 30, h = b.h - 30 - 52;
    return top + h * (1 - (clamp(v, s.min, s.max) - s.min) / (s.max - s.min));
  }
  sample(r: InstrumentReadings): boolean {
    const v = r.busPowered ? this.read(r) : NaN;
    this.latch.track(0, Number.isFinite(v) ? v : NO_SIGNAL, 0.05);
    this.latch.set(1, r.busPowered ? 1 : 0, 1);
    return this.latch.take();
  }
  drawStatic(g: Ctx2D): void {
    const b = this.bounds, s = this.spec;
    plate(g, b);
    text(g, s.title, b.x + b.w / 2, b.y + 12, 10);
    text(g, 'DEG', b.x + b.w / 2, b.y + 23, 7, 'center', INK, 500);
    const rail = b.x + 34;
    g.fillStyle = '#1b1d1e'; g.fillRect(rail - 3, this.y(s.max), 6, this.y(s.min) - this.y(s.max));
    for (const band of s.bands ?? []) { g.fillStyle = ARC_COLORS[band.color]; g.globalAlpha = 0.75; g.fillRect(rail - 3, this.y(band.to), 6, this.y(band.from) - this.y(band.to)); g.globalAlpha = 1; }
    for (const v of s.majors) {
      g.strokeStyle = INK; g.lineWidth = 1.3; g.beginPath(); g.moveTo(rail + 5, this.y(v)); g.lineTo(rail + 13, this.y(v)); g.stroke();
      text(g, String(v), rail + 16, this.y(v), 8, 'left');
    }
    for (const m of s.marks) {
      g.strokeStyle = ARC_BLUE; g.lineWidth = 2; g.beginPath(); g.moveTo(rail - 9, this.y(m.at)); g.lineTo(rail + 5, this.y(m.at)); g.stroke();
      text(g, m.label, b.x + 3, this.y(m.at) - 5, 6.5, 'left', '#9fc4ee', 500);
    }
    g.fillStyle = '#050505'; g.fillRect(b.x + 6, b.y + b.h - 44, b.w - 12, 36);
  }
  draw(g: Ctx2D): void {
    const b = this.bounds, v = this.latch.get(0), valid = hasSignal(v);
    const rail = b.x + 34;
    if (valid) {
      const y = this.y(v);
      g.fillStyle = BAR; g.beginPath(); g.moveTo(rail - 4, y); g.lineTo(rail - 15, y - 6); g.lineTo(rail - 15, y + 6); g.closePath(); g.fill();
    }
    const x = b.x + b.w - 14, y = b.y + b.h - 38;
    if (this.latch.get(1) !== 1) { drawSegments(g, DARK_DIGITS, x, y, { height: 24, on: SEGMENT_OFF, off: SEGMENT_OFF }); return; }
    drawSegments(g, valid ? v.toFixed(1) : '--.-', x, y, { height: 24, on: AMBER, off: SEGMENT_OFF });
  }
  paintLightMask(g: Ctx2D): void {
    const b = this.bounds;
    g.fillStyle = LIGHT_DIAL; g.fillRect(b.x + 3, b.y + 3, b.w - 6, b.h - 54);
    g.fillStyle = LIGHT_DISPLAY; g.fillRect(b.x + 6, b.y + b.h - 44, b.w - 12, 36);
  }
}

// ---------------------------------------------------------------------------------------------------
// Triple hydraulic pressure

/** Systems 1, 1A and 2: three bars, normal 2800-3400 psi marked (P APE-I SoF 1.1). Dark and empty without bus power. */
export class Ah56HydraulicsGauge implements PanelComponent {
  private readonly latch = new Latch(4);
  /** `read(r, system)`: pressure of system 0 (1), 1 (1A) or 2 (2), psi. */
  constructor(readonly id: string, readonly bounds: Rect, private readonly read: (r: InstrumentReadings, system: number) => number) {}
  private y(v: number): number {
    const b = this.bounds, top = b.y + 30, h = b.h - 30 - 24;
    return top + h * (1 - (clamp(v, HYD.min, HYD.max) - HYD.min) / (HYD.max - HYD.min));
  }
  private x(i: number): number { return this.bounds.x + 14 + i * 36; }
  sample(r: InstrumentReadings): boolean {
    for (let i = 0; i < 3; i++) this.latch.track(i, r.busPowered ? this.read(r, i) : 0, 25);
    this.latch.set(3, r.busPowered ? 1 : 0, 1);
    return this.latch.take();
  }
  drawStatic(g: Ctx2D): void {
    const b = this.bounds;
    plate(g, b);
    text(g, 'HYD PSI', b.x + b.w / 2, b.y + 12, 9.5);
    text(g, '× 1000', b.x + b.w / 2, b.y + 23, 7, 'center', INK, 500);
    ['1', '1A', '2'].forEach((label, i) => {
      g.fillStyle = '#1b1d1e'; g.fillRect(this.x(i), this.y(HYD.max), 12, this.y(HYD.min) - this.y(HYD.max));
      text(g, label, this.x(i) + 6, b.y + b.h - 11, 8);
    });
    g.fillStyle = ARC_COLORS.green; g.fillRect(this.x(2) + 16, this.y(HYD.normal[1]), 4, this.y(HYD.normal[0]) - this.y(HYD.normal[1]));
    for (const v of HYD.majors) { text(g, String(v / 1000), b.x + b.w - 14, this.y(v), 7.5, 'right'); }
  }
  draw(g: Ctx2D): void {
    for (let i = 0; i < 3; i++) {
      const v = this.latch.get(i);
      if (v <= 0) continue;
      const top = this.y(v);
      g.fillStyle = BAR; g.fillRect(this.x(i), top, 12, this.y(HYD.min) - top);
      g.fillStyle = '#fff'; g.fillRect(this.x(i) - 1, top - 1, 14, 2);
    }
  }
  paintLightMask(g: Ctx2D): void { g.fillStyle = LIGHT_DIAL; g.fillRect(this.bounds.x + 3, this.bounds.y + 3, this.bounds.w - 6, this.bounds.h - 6); }
}

// ---------------------------------------------------------------------------------------------------
// Gyro configuration placard and the ICS buttons

/**
 * What the panel says about the control system, from `extra.gyroMode` (1 = ICS, 0 = AMCS). AMCS: the 1973 advanced mechanical control
 * system, a rate command with attitude hold at stick centre. ICS: the 1972 improved control system with the feathering-moment gyro;
 * its two augmentation push buttons (roll compensator, pitch desensitizer) are fitted and drawn engaged, because the sim has no switch
 * for them (they run whenever the ICS flies; a contract request), and the stir limit is placarded.
 */
export class Ah56GyroPlacard implements PanelComponent {
  private readonly latch = new Latch(1);
  constructor(readonly id: string, readonly bounds: Rect) {}
  sample(r: InstrumentReadings, _c: ControlInputs): boolean {
    this.latch.set(0, r.extra?.gyroMode === 1 ? 1 : 0, 1);
    return this.latch.take();
  }
  drawStatic(g: Ctx2D): void {
    const b = this.bounds;
    plate(g, b);
    text(g, 'FLIGHT CONTROL SYSTEM', b.x + b.w / 2, b.y + 12, 9);
  }
  draw(g: Ctx2D): void {
    const b = this.bounds, ics = this.latch.get(0) === 1;
    g.fillStyle = '#050505'; g.fillRect(b.x + 10, b.y + 24, b.w - 20, 40);
    text(g, ics ? 'ICS' : 'AMCS', b.x + b.w / 2, b.y + 40, 20, 'center', AMBER, 700);
    text(g, ics ? '1972 FEATHERING-MOMENT GYRO' : '1973 RATE COMMAND, ATTITUDE HOLD', b.x + b.w / 2, b.y + 57, 6.5, 'center', INK, 500);
    // The two ICS push buttons.
    ['ROLL COMP', 'PITCH DESENS'].forEach((label, i) => {
      const x = b.x + 12 + i * ((b.w - 30) / 2 + 6), w = (b.w - 30) / 2, y = b.y + 76;
      g.fillStyle = '#17181a'; g.fillRect(x, y, w, 34);
      if (ics) {
        g.save(); g.shadowColor = AMBER; g.shadowBlur = 8; g.fillStyle = AMBER; g.globalAlpha = 0.9; g.fillRect(x + 3, y + 3, w - 6, 28); g.restore();
        g.fillStyle = 'rgba(20,14,6,0.92)';
      } else { g.fillStyle = 'rgba(225,220,205,0.20)'; g.fillRect(x + 3, y + 3, w - 6, 28); g.fillStyle = 'rgba(225,220,205,0.35)'; }
      g.font = `700 8.5px ${LABEL_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ics ? label : 'NOT FITTED', x + w / 2, y + 17);
    });
    text(g, ics ? 'STIRS > 0.5 Hz PROHIBITED' : 'STICK RELEASED = ATTITUDE HELD', b.x + b.w / 2, b.y + b.h - 18, 7.5, 'center', ics ? '#ff9d8f' : INK, 600);
  }
  paintLightMask(g: Ctx2D): void {
    const b = this.bounds;
    g.fillStyle = LIGHT_DIAL; g.fillRect(b.x + 3, b.y + 3, b.w - 6, b.h - 6);
    g.fillStyle = LIGHT_DISPLAY; g.fillRect(b.x + 10, b.y + 24, b.w - 20, 40);
  }
}

// ---------------------------------------------------------------------------------------------------
// Engine, rotor and hydraulic controls drawn without a model behind them

/**
 * The APU, Nf ALTERNATE, abort-stop, rotor brake, directional trim and hydraulic 1 / 1A / 2 controls (panelMarkings.ts
 * AH56_INERT_CONTROLS), painted once as static art in their normal in-flight positions. No hotspot: the sim models none of them.
 */
export class Ah56InertControls implements PanelComponent {
  constructor(readonly id: string, readonly bounds: Rect) {}
  sample(): boolean { return false; }
  draw(): void { /* static art only */ }
  /** Column centres of the groups, in panel px: each group gets a share of the width by its item count. */
  private layout(): { title: string; x0: number; x1: number; items: { item: Ah56InertControl; cx: number }[] }[] {
    const b = this.bounds, total = AH56_INERT_CONTROLS.reduce((n, gr) => n + gr.items.length, 0), pitch = (b.w - 24) / total;
    let x = b.x + 12;
    return AH56_INERT_CONTROLS.map(gr => {
      const x0 = x, items = gr.items.map((item, i) => ({ item, cx: x0 + pitch * (i + 0.5) }));
      x += pitch * gr.items.length;
      return { title: gr.title, x0, x1: x, items };
    });
  }
  drawStatic(g: Ctx2D): void {
    const b = this.bounds, cy = b.y + 118;
    plate(g, b);
    for (const [k, gr] of this.layout().entries()) {
      text(g, gr.title, (gr.x0 + gr.x1) / 2, b.y + 14, 9);
      g.strokeStyle = 'rgba(241,240,232,0.45)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(gr.x0 + 6, b.y + 24); g.lineTo(gr.x1 - 6, b.y + 24); g.stroke();
      if (k > 0) { g.beginPath(); g.moveTo(gr.x0, b.y + 10); g.lineTo(gr.x0, b.y + b.h - 10); g.stroke(); }
      for (const { item, cx } of gr.items) this.control(g, item, cx, cy);
    }
  }
  private control(g: Ctx2D, c: Ah56InertControl, cx: number, cy: number): void {
    const b = this.bounds;
    text(g, c.label, cx, b.y + 42, 8.5);
    if (c.kind === 'toggle') {
      // Legends from top to bottom; the bat points at the shown one (up, centre or down).
      // A centre position is drawn as the bat seen end-on (a larger knob on the nut).
      const n = c.positions.length, span = 46;
      c.positions.forEach((pos, i) => {
        const y = cy - span + (n === 1 ? 0 : i * 2 * span / (n - 1));
        // A middle legend sits beside the nut, clear of the bat.
        if (Math.abs(y - cy) < 1) text(g, pos, cx + 17, cy, 7.5, 'left', INK, 500); else text(g, pos, cx, y, 7.5, 'center', INK, 500);
      });
      const dir = n === 1 ? 0 : (c.shown / (n - 1)) * 2 - 1, centre = Math.abs(dir) < 0.01;
      g.fillStyle = '#9a9c98'; g.beginPath(); g.arc(cx, cy, 12, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#3a3c3d'; g.beginPath(); g.arc(cx, cy, 8, 0, Math.PI * 2); g.fill();
      if (centre) { g.fillStyle = '#e4e5e0'; g.beginPath(); g.arc(cx, cy, 6.5, 0, Math.PI * 2); g.fill(); }
      else {
        const tip = cy + dir * 28;
        g.strokeStyle = '#d8d9d4'; g.lineWidth = 7; g.lineCap = 'round';
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx, tip); g.stroke();
        g.fillStyle = '#eeeeea'; g.beginPath(); g.arc(cx, tip, 5.5, 0, Math.PI * 2); g.fill();
      }
    } else if (c.kind === 'guarded') {
      // A red button under a closed yellow-and-black striped guard.
      g.fillStyle = '#7a1d18'; g.beginPath(); g.arc(cx, cy, 13, 0, Math.PI * 2); g.fill();
      g.save(); g.beginPath(); g.roundRect(cx - 19, cy - 19, 38, 38, 5); g.clip();
      for (let k = -4; k <= 4; k++) { g.fillStyle = k % 2 === 0 ? '#d9b52a' : '#151515'; g.beginPath();
        g.moveTo(cx - 19 + k * 9, cy - 19); g.lineTo(cx - 10 + k * 9, cy - 19); g.lineTo(cx - 10 + k * 9 + 38, cy + 19); g.lineTo(cx - 19 + k * 9 + 38, cy + 19); g.fill(); }
      g.restore();
      g.fillStyle = 'rgba(160,40,30,0.55)'; g.beginPath(); g.arc(cx, cy, 10, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#0b0b0b'; g.lineWidth = 2; g.strokeRect(cx - 19, cy - 19, 38, 38);
      text(g, 'GUARD', cx, cy + 34, 7.5, 'center', INK, 500);
    } else {
      // Pull T-handle in its stowed (OFF) position, its legends beside it.
      g.fillStyle = '#141516'; g.fillRect(cx - 3, cy - 6, 6, 18);
      g.fillStyle = '#d9b52a'; g.beginPath(); g.roundRect(cx - 22, cy - 14, 44, 12, 4); g.fill();
      g.fillStyle = '#151515'; g.font = font(7, 700); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('PULL', cx, cy - 8);
      text(g, c.positions.join(' — '), cx, cy + 30, 7.5, 'center', INK, 500);
    }
  }
  paintLightMask(g: Ctx2D): void { g.fillStyle = LIGHT_DIAL; g.fillRect(this.bounds.x + 3, this.bounds.y + 3, this.bounds.w - 6, this.bounds.h - 6); }
}
